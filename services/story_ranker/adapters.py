from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import urllib.request
from pathlib import Path
from typing import Sequence

CANONICAL_CPU_PROFILE = "PRODUCTION_CANONICAL_CPU"
R3C_REFERENCE_PROFILE = "R3C_REFERENCE_MPS"
CROSS_BACKEND_VARIANCE_CLASSIFICATION = "CROSS_BACKEND_NUMERIC_VARIANCE"

QWEN_EMBEDDING_MODEL = "qwen3-embedding:0.6b"
QWEN_EMBEDDING_DIGEST = "ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d"
QWEN_EMBEDDING_DIMENSION = 1024

QWEN_RERANKER_MODEL = "Qwen/Qwen3-Reranker-0.6B"
QWEN_RERANKER_REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473"
QWEN_RERANKER_INSTRUCTION = (
    "Judge whether the two news headlines describe the same specific "
    "underlying news story or event. Treat related topics, analyses, "
    "previews, reactions, or later follow-ups as different unless they "
    "report the same base event."
)

RERANKER_SNAPSHOT_MANIFEST_FILENAME = ".reranker_snapshot_manifest.json"
REQUIRED_SNAPSHOT_FILES = ("config.json", "model.safetensors")
REQUIRED_TOKENIZER_FILES = ("tokenizer.json", "tokenizer_config.json")
DETERMINISTIC_CPU_ENV_DEFAULTS = {
    "PYTHONHASHSEED": "0",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "TOKENIZERS_PARALLELISM": "false",
}
TRACKED_RUNTIME_PACKAGES = (
    "sentence-transformers",
    "torch",
    "transformers",
    "tokenizers",
    "huggingface-hub",
    "safetensors",
    "numpy",
    "scipy",
    "scikit-learn",
)


def configure_deterministic_cpu_runtime() -> dict[str, str]:
    applied: dict[str, str] = {}
    for key, value in DETERMINISTIC_CPU_ENV_DEFAULTS.items():
        os.environ[key] = value
        applied[key] = os.environ[key]

    try:
        import torch  # type: ignore[import-not-found]

        torch.manual_seed(0)
        if hasattr(torch, "set_num_threads"):
            torch.set_num_threads(1)
        if hasattr(torch, "use_deterministic_algorithms"):
            torch.use_deterministic_algorithms(True, warn_only=True)
    except ImportError:
        pass

    return applied


def _compute_file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_hf_snapshot_dir(
    *,
    hf_home: str | Path | None = None,
    revision: str = QWEN_RERANKER_REVISION,
) -> Path:
    base_dir = Path(hf_home or os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface")
    repo_folder = f"models--{QWEN_RERANKER_MODEL.replace('/', '--')}"
    candidates = [
        base_dir / "hub" / repo_folder / "snapshots" / revision,
        base_dir / repo_folder / "snapshots" / revision,
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return candidates[0]


def write_reranker_snapshot_manifest(
    snapshot_dir: str | Path,
    *,
    revision: str = QWEN_RERANKER_REVISION,
) -> dict:
    target_dir = Path(snapshot_dir)
    if not target_dir.is_dir():
        raise RuntimeError(f"Reranker snapshot directory does not exist: {target_dir}")

    files_sha256: dict[str, str] = {}
    for entry in sorted(target_dir.iterdir(), key=lambda p: p.name):
        if entry.is_file() and entry.name != RERANKER_SNAPSHOT_MANIFEST_FILENAME:
            files_sha256[entry.name] = _compute_file_sha256(entry)

    manifest = {
        "model": QWEN_RERANKER_MODEL,
        "revision": revision,
        "files_sha256": files_sha256,
    }
    manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest["manifest_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    (target_dir / RERANKER_SNAPSHOT_MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return manifest


def verify_offline_reranker_snapshot(
    *,
    hf_home: str | Path | None = None,
    expected_revision: str = QWEN_RERANKER_REVISION,
) -> dict:
    if expected_revision != QWEN_RERANKER_REVISION:
        raise RuntimeError("Reranker revision does not match the frozen STORY01 R3C baseline")

    snapshot_dir = _resolve_hf_snapshot_dir(hf_home=hf_home, revision=expected_revision)
    if not snapshot_dir.is_dir():
        raise RuntimeError(f"Offline reranker snapshot directory not found: {snapshot_dir}")

    if snapshot_dir.name != expected_revision:
        raise RuntimeError("Offline reranker snapshot directory name does not match expected revision")

    refs_main = snapshot_dir.parent.parent / "refs" / "main"
    if refs_main.is_file():
        recorded_ref = refs_main.read_text(encoding="utf-8").strip()
        if recorded_ref and recorded_ref != expected_revision:
            raise RuntimeError("Hugging Face refs/main does not match the frozen reranker revision")

    for required_file in REQUIRED_SNAPSHOT_FILES:
        if not (snapshot_dir / required_file).is_file():
            raise RuntimeError(f"Offline reranker snapshot missing required file: {required_file}")

    if not any((snapshot_dir / name).is_file() for name in REQUIRED_TOKENIZER_FILES):
        raise RuntimeError("Offline reranker snapshot missing tokenizer configuration")

    manifest_path = snapshot_dir / RERANKER_SNAPSHOT_MANIFEST_FILENAME
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("model") != QWEN_RERANKER_MODEL or manifest.get("revision") != expected_revision:
            raise RuntimeError("Offline reranker snapshot manifest metadata mismatch")
        files_sha256 = manifest.get("files_sha256")
        if not isinstance(files_sha256, dict) or not files_sha256:
            raise RuntimeError("Offline reranker snapshot manifest contains no file hashes")
        for filename, expected_sha256 in sorted(files_sha256.items()):
            file_path = snapshot_dir / filename
            if not file_path.is_file():
                raise RuntimeError(f"Offline reranker snapshot missing manifest file: {filename}")
            actual_sha256 = _compute_file_sha256(file_path)
            if actual_sha256 != expected_sha256:
                raise RuntimeError(f"Offline reranker snapshot SHA-256 mismatch for {filename}")
        manifest_sha256 = str(manifest.get("manifest_sha256") or "")
        if len(manifest_sha256) != 64:
            canonical_bytes = json.dumps(
                {
                    "model": QWEN_RERANKER_MODEL,
                    "revision": expected_revision,
                    "files_sha256": files_sha256,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            manifest_sha256 = hashlib.sha256(canonical_bytes).hexdigest()
    else:
        computed_hashes = {
            entry.name: _compute_file_sha256(entry)
            for entry in sorted(snapshot_dir.iterdir(), key=lambda p: p.name)
            if entry.is_file()
        }
        canonical_bytes = json.dumps(
            {
                "model": QWEN_RERANKER_MODEL,
                "revision": expected_revision,
                "files_sha256": computed_hashes,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        manifest_sha256 = hashlib.sha256(canonical_bytes).hexdigest()

    return {
        "reranker_model": QWEN_RERANKER_MODEL,
        "reranker_revision": expected_revision,
        "revision_verified": True,
        "offline_snapshot_verified": True,
        "snapshot_path": str(snapshot_dir),
        "manifest_sha256": manifest_sha256,
    }


def _normalize_digest(raw_digest: str | None) -> str:
    if not isinstance(raw_digest, str):
        return ""
    cleaned = raw_digest.strip().lower()
    if cleaned.startswith("sha256:"):
        cleaned = cleaned[len("sha256:") :]
    return cleaned


def get_installed_package_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for pkg in TRACKED_RUNTIME_PACKAGES:
        try:
            versions[pkg] = importlib.metadata.version(pkg)
        except importlib.metadata.PackageNotFoundError:
            versions[pkg] = None
    return versions


class OllamaEmbedder:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 180.0):
        self.base_url = (
            base_url or os.environ.get("OLLAMA_BASE_URL") or "http://127.0.0.1:11434"
        ).rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._verified = False
        self._verified_digest: str | None = None

    def _request(self, path: str, *, payload: dict | None = None) -> dict:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"content-type": "application/json"} if data is not None else {},
            method="POST" if data is not None else "GET",
        )
        with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
            return json.load(response)

    def verify_model(self) -> None:
        self._verified = False
        self._verified_digest = None
        tags = self._request("/api/tags")
        for model in tags.get("models", []):
            name = model.get("name") or model.get("model")
            if name != QWEN_EMBEDDING_MODEL:
                continue
            normalized_digest = _normalize_digest(model.get("digest"))
            if not normalized_digest.startswith(QWEN_EMBEDDING_DIGEST):
                raise RuntimeError("Ollama embedding model digest does not match the R3C baseline")
            self._verified = True
            self._verified_digest = QWEN_EMBEDDING_DIGEST
            return
        raise RuntimeError("Required Ollama embedding model is not installed")

    def verification_receipt(self) -> dict:
        return {
            "embedding_model": QWEN_EMBEDDING_MODEL,
            "embedding_digest": self._verified_digest or QWEN_EMBEDDING_DIGEST,
            "embedding_digest_verified": bool(self._verified),
            "embedding_dimension": QWEN_EMBEDDING_DIMENSION,
        }

    def embed(self, titles: Sequence[str]) -> list[list[float]]:
        if not self._verified:
            self.verify_model()
        result = self._request(
            "/api/embed",
            payload={
                "model": QWEN_EMBEDDING_MODEL,
                "input": list(titles),
                "truncate": False,
            },
        )
        vectors = result.get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(titles):
            raise RuntimeError("Ollama returned an invalid embedding count")
        if any(
            not isinstance(vector, list) or len(vector) != QWEN_EMBEDDING_DIMENSION
            for vector in vectors
        ):
            raise RuntimeError("Ollama embedding dimension does not match the R3C baseline")
        return vectors


class QwenReranker:
    def __init__(
        self,
        *,
        device: str | None = None,
        batch_size: int | None = None,
        hf_home: str | Path | None = None,
    ):
        self.device = device or os.environ.get("STORY_RANKER_DEVICE") or "cpu"
        self.batch_size = batch_size or int(os.environ.get("STORY_RANKER_BATCH_SIZE", "8"))
        self.hf_home = hf_home
        self._model = None
        self._snapshot_receipt: dict | None = None

    def verify_offline_snapshot(self) -> dict:
        receipt = verify_offline_reranker_snapshot(
            hf_home=self.hf_home,
            expected_revision=QWEN_RERANKER_REVISION,
        )
        self._snapshot_receipt = receipt
        return receipt

    def verification_receipt(self) -> dict:
        if self._snapshot_receipt is None:
            try:
                self.verify_offline_snapshot()
            except RuntimeError:
                return {
                    "reranker_model": QWEN_RERANKER_MODEL,
                    "reranker_revision": QWEN_RERANKER_REVISION,
                    "revision_verified": False,
                    "offline_snapshot_verified": False,
                    "snapshot_path": None,
                    "manifest_sha256": None,
                }
        assert self._snapshot_receipt is not None
        return dict(self._snapshot_receipt)

    def _load(self):
        if self._model is None:
            configure_deterministic_cpu_runtime()
            offline_only = os.environ.get("STORY_RANKER_OFFLINE", "1") != "0"
            if offline_only:
                self.verify_offline_snapshot()
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(
                QWEN_RERANKER_MODEL,
                revision=QWEN_RERANKER_REVISION,
                device=self.device,
                prompts={"story_identity": QWEN_RERANKER_INSTRUCTION},
                default_prompt_name="story_identity",
                local_files_only=offline_only,
            )
        return self._model

    def score(self, pairs: Sequence[tuple[str, str]]) -> list[float]:
        if not pairs:
            return []
        scores = self._load().predict(
            list(pairs),
            batch_size=self.batch_size,
            show_progress_bar=False,
        )
        values = scores.tolist() if hasattr(scores, "tolist") else list(scores)
        normalized: list[float] = []
        for value in values:
            if isinstance(value, list):
                if len(value) != 1:
                    raise RuntimeError("Reranker returned an unexpected score shape")
                value = value[0]
            normalized.append(float(value))
        return normalized


def build_runtime_provenance_receipt(
    *,
    embedder: OllamaEmbedder | None = None,
    reranker: QwenReranker | None = None,
) -> dict:
    emb_receipt = (
        embedder.verification_receipt()
        if embedder is not None
        else {
            "embedding_model": QWEN_EMBEDDING_MODEL,
            "embedding_digest": QWEN_EMBEDDING_DIGEST,
            "embedding_digest_verified": False,
            "embedding_dimension": QWEN_EMBEDDING_DIMENSION,
        }
    )
    rerank_receipt = (
        reranker.verification_receipt()
        if reranker is not None
        else {
            "reranker_model": QWEN_RERANKER_MODEL,
            "reranker_revision": QWEN_RERANKER_REVISION,
            "revision_verified": False,
            "offline_snapshot_verified": False,
            "snapshot_path": None,
            "manifest_sha256": None,
        }
    )
    device = reranker.device if reranker is not None else (os.environ.get("STORY_RANKER_DEVICE") or "cpu")
    return {
        "profile": CANONICAL_CPU_PROFILE,
        "reference_profile": R3C_REFERENCE_PROFILE,
        "cross_backend_variance_classification": CROSS_BACKEND_VARIANCE_CLASSIFICATION,
        "embedding_model": emb_receipt["embedding_model"],
        "embedding_digest": emb_receipt["embedding_digest"],
        "embedding_digest_verified": emb_receipt["embedding_digest_verified"],
        "reranker_model": rerank_receipt["reranker_model"],
        "reranker_revision": rerank_receipt["reranker_revision"],
        "reranker_revision_verified": rerank_receipt["revision_verified"],
        "reranker_offline_snapshot_verified": rerank_receipt["offline_snapshot_verified"],
        "reranker_snapshot_sha256": rerank_receipt["manifest_sha256"],
        "device": device,
        "offline_mode": os.environ.get("STORY_RANKER_OFFLINE", "1") != "0",
        "deterministic_cpu_env": {
            key: os.environ.get(key, default)
            for key, default in DETERMINISTIC_CPU_ENV_DEFAULTS.items()
        },
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "package_versions": get_installed_package_versions(),
    }
