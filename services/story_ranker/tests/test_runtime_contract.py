import hashlib
import json
import os
import tempfile
import types
import unittest
from pathlib import Path

from services.story_ranker.adapters import (
    CANONICAL_CPU_PROFILE,
    CANONICAL_TORCH_CPU_VERSION,
    CROSS_BACKEND_VARIANCE_CLASSIFICATION,
    PYTORCH_CPU_INDEX_URL,
    QWEN_EMBEDDING_DIGEST,
    QWEN_EMBEDDING_MODEL,
    QWEN_RERANKER_MODEL,
    QWEN_RERANKER_REVISION,
    R3C_REFERENCE_PROFILE,
    OllamaEmbedder,
    QwenReranker,
    build_runtime_provenance_receipt,
    configure_deterministic_cpu_runtime,
    verify_cpu_only_torch_runtime,
    verify_offline_reranker_snapshot,
    write_reranker_snapshot_manifest,
)
from services.story_ranker.core import rank_story_candidates
from services.story_ranker.server import _model_contract


def _populate_fake_hf_snapshot(
    hf_home: Path,
    *,
    revision: str = QWEN_RERANKER_REVISION,
    include_manifest: bool = True,
    tamper_weights: bool = False,
) -> Path:
    repo_dir = hf_home / "hub" / "models--Qwen--Qwen3-Reranker-0.6B"
    snapshots_dir = repo_dir / "snapshots" / revision
    refs_dir = repo_dir / "refs"
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)
    (refs_dir / "main").write_text(revision, encoding="utf-8")

    files = {
        "config.json": '{"model_type": "qwen3"}',
        "tokenizer.json": '{"version": "1.0"}',
        "tokenizer_config.json": '{"tokenizer_class": "Qwen2Tokenizer"}',
        "model.safetensors": "fake-safetensors-payload-v1",
    }
    for name, content in files.items():
        (snapshots_dir / name).write_text(content, encoding="utf-8")

    if include_manifest:
        write_reranker_snapshot_manifest(snapshots_dir, revision=revision)

    if tamper_weights:
        (snapshots_dir / "model.safetensors").write_text("tampered-weights", encoding="utf-8")

    return snapshots_dir


def _make_fake_torch(
    *,
    version: str = CANONICAL_TORCH_CPU_VERSION,
    cuda_version: str | None = None,
    cuda_available: bool = False,
):
    return types.SimpleNamespace(
        __version__=version,
        version=types.SimpleNamespace(cuda=cuda_version),
        cuda=types.SimpleNamespace(is_available=lambda: cuda_available),
    )


class StoryRankerRuntimeContractTests(unittest.TestCase):
    def test_torch_version_cpu_pin_contract(self):
        self.assertEqual(CANONICAL_TORCH_CPU_VERSION, "2.14.1+cpu")
        self.assertEqual(PYTORCH_CPU_INDEX_URL, "https://download.pytorch.org/whl/cpu")

        valid_torch = _make_fake_torch(
            version="2.14.1+cpu",
            cuda_version=None,
            cuda_available=False,
        )
        receipt = verify_cpu_only_torch_runtime(torch_module=valid_torch, device="cpu")
        self.assertEqual(receipt["torch_version"], "2.14.1+cpu")
        self.assertTrue(receipt["torch_version_cpu_verified"])
        self.assertEqual(receipt["device"], "cpu")

        # Generic Linux torch==2.14.1 (without +cpu) must be rejected
        generic_torch = _make_fake_torch(
            version="2.14.1",
            cuda_version=None,
            cuda_available=False,
        )
        with self.assertRaises(RuntimeError):
            verify_cpu_only_torch_runtime(torch_module=generic_torch, device="cpu")

        # CUDA-tagged torch==2.14.1+cu124 must be rejected
        cu_torch = _make_fake_torch(
            version="2.14.1+cu124",
            cuda_version=None,
            cuda_available=False,
        )
        with self.assertRaises(RuntimeError):
            verify_cpu_only_torch_runtime(torch_module=cu_torch, device="cpu")

        # Non-cpu device must be rejected for PRODUCTION_CANONICAL_CPU
        for invalid_device in ("cuda", "cuda:0", "mps"):
            with self.assertRaises(RuntimeError):
                verify_cpu_only_torch_runtime(torch_module=valid_torch, device=invalid_device)

    def test_torch_version_cuda_none_contract(self):
        valid_torch = _make_fake_torch(
            version="2.14.1+cpu",
            cuda_version=None,
            cuda_available=False,
        )
        receipt = verify_cpu_only_torch_runtime(torch_module=valid_torch, device="cpu")
        self.assertIsNone(receipt["torch_cuda_version"])
        self.assertTrue(receipt["torch_cuda_none_verified"])

        cuda_linked_torch = _make_fake_torch(
            version="2.14.1+cpu",
            cuda_version="12.4",
            cuda_available=False,
        )
        with self.assertRaises(RuntimeError):
            verify_cpu_only_torch_runtime(torch_module=cuda_linked_torch, device="cpu")

    def test_torch_cuda_available_false_contract(self):
        valid_torch = _make_fake_torch(
            version="2.14.1+cpu",
            cuda_version=None,
            cuda_available=False,
        )
        receipt = verify_cpu_only_torch_runtime(torch_module=valid_torch, device="cpu")
        self.assertIs(receipt["torch_cuda_available"], False)
        self.assertTrue(receipt["torch_cuda_available_false_verified"])

        cuda_active_torch = _make_fake_torch(
            version="2.14.1+cpu",
            cuda_version=None,
            cuda_available=True,
        )
        with self.assertRaises(RuntimeError):
            verify_cpu_only_torch_runtime(torch_module=cuda_active_torch, device="cpu")
    def test_offline_model_snapshot_verification_and_revision_verification(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            hf_home = Path(tmp_dir)
            # 1. Missing snapshot directory must fail
            with self.assertRaises(RuntimeError):
                verify_offline_reranker_snapshot(hf_home=hf_home)

            # 2. Valid snapshot with manifest passes
            snapshot_dir = _populate_fake_hf_snapshot(hf_home)
            receipt = verify_offline_reranker_snapshot(hf_home=hf_home)
            self.assertTrue(receipt["offline_snapshot_verified"])
            self.assertTrue(receipt["revision_verified"])
            self.assertEqual(receipt["reranker_revision"], QWEN_RERANKER_REVISION)
            self.assertEqual(Path(receipt["snapshot_path"]), snapshot_dir)
            self.assertEqual(len(receipt["manifest_sha256"]), 64)

            # 3. Wrong revision must fail
            with self.assertRaises(RuntimeError):
                verify_offline_reranker_snapshot(
                    hf_home=hf_home,
                    expected_revision="0000000000000000000000000000000000000000",
                )

        # 4. Tampered weight file after manifest generation must fail
        with tempfile.TemporaryDirectory() as tmp_dir_tampered:
            hf_home_tampered = Path(tmp_dir_tampered)
            _populate_fake_hf_snapshot(hf_home_tampered, tamper_weights=True)
            with self.assertRaises(RuntimeError):
                verify_offline_reranker_snapshot(hf_home=hf_home_tampered)

    def test_embedding_digest_verification_and_provenance(self):
        class StubOllamaEmbedder(OllamaEmbedder):
            def __init__(self, digest_value: str):
                super().__init__(base_url="http://127.0.0.1:11434")
                self.digest_value = digest_value

            def _request(self, path: str, *, payload: dict | None = None) -> dict:
                if path == "/api/tags":
                    return {
                        "models": [
                            {
                                "name": QWEN_EMBEDDING_MODEL,
                                "digest": self.digest_value,
                            }
                        ]
                    }
                raise AssertionError(f"Unexpected path: {path}")

        valid_embedder = StubOllamaEmbedder(f"sha256:{QWEN_EMBEDDING_DIGEST}")
        valid_embedder.verify_model()
        receipt = valid_embedder.verification_receipt()
        self.assertTrue(receipt["embedding_digest_verified"])
        self.assertEqual(receipt["embedding_digest"], QWEN_EMBEDDING_DIGEST)

        invalid_embedder = StubOllamaEmbedder("deadbeef" * 8)
        with self.assertRaises(RuntimeError):
            invalid_embedder.verify_model()
        self.assertFalse(invalid_embedder.verification_receipt()["embedding_digest_verified"])

    def test_structured_runtime_provenance_receipt(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            hf_home = Path(tmp_dir)
            _populate_fake_hf_snapshot(hf_home)
            reranker = QwenReranker(device="cpu", batch_size=8, hf_home=hf_home)
            embedder = OllamaEmbedder(base_url="http://127.0.0.1:11434")
            embedder._verified = True
            embedder._verified_digest = QWEN_EMBEDDING_DIGEST

            valid_torch = _make_fake_torch(
                version="2.14.1+cpu",
                cuda_version=None,
                cuda_available=False,
            )
            provenance = build_runtime_provenance_receipt(
                embedder=embedder,
                reranker=reranker,
                torch_module=valid_torch,
            )
            self.assertEqual(provenance["profile"], CANONICAL_CPU_PROFILE)
            self.assertEqual(provenance["reference_profile"], R3C_REFERENCE_PROFILE)
            self.assertEqual(
                provenance["cross_backend_variance_classification"],
                CROSS_BACKEND_VARIANCE_CLASSIFICATION,
            )
            self.assertEqual(provenance["embedding_model"], QWEN_EMBEDDING_MODEL)
            self.assertEqual(provenance["embedding_digest"], QWEN_EMBEDDING_DIGEST)
            self.assertTrue(provenance["embedding_digest_verified"])
            self.assertEqual(provenance["reranker_model"], QWEN_RERANKER_MODEL)
            self.assertEqual(provenance["reranker_revision"], QWEN_RERANKER_REVISION)
            self.assertTrue(provenance["reranker_revision_verified"])
            self.assertTrue(provenance["reranker_offline_snapshot_verified"])
            self.assertEqual(len(provenance["reranker_snapshot_sha256"]), 64)
            self.assertEqual(provenance["device"], "cpu")
            self.assertEqual(provenance["expected_torch_version"], "2.14.1+cpu")
            self.assertEqual(
                provenance["pytorch_cpu_index_url"],
                "https://download.pytorch.org/whl/cpu",
            )
            self.assertEqual(provenance["torch_runtime"]["torch_version"], "2.14.1+cpu")
            self.assertTrue(provenance["torch_runtime"]["torch_version_cpu_verified"])
            self.assertIsNone(provenance["torch_runtime"]["torch_cuda_version"])
            self.assertTrue(provenance["torch_runtime"]["torch_cuda_none_verified"])
            self.assertIs(provenance["torch_runtime"]["torch_cuda_available"], False)
            self.assertTrue(provenance["torch_runtime"]["torch_cuda_available_false_verified"])
            self.assertIn("package_versions", provenance)

            contract = _model_contract(embedder=embedder, reranker=reranker)
            self.assertEqual(contract["candidate_k"], 250)
            self.assertEqual(contract["embedding_digest"], QWEN_EMBEDDING_DIGEST)
            self.assertEqual(contract["reranker_revision"], QWEN_RERANKER_REVISION)
            self.assertIn("runtime_provenance", contract)

    def test_cpu_repeated_run_determinism(self):
        """SYNTHETIC_DETERMINISM_GATE: verifies configure_deterministic_cpu_runtime()
        and rank_story_candidates() repeatability using deterministic synthetic stubs
        (does not claim REAL_MODEL_CPU_REPEATABILITY).
        """
        env_Config = configure_deterministic_cpu_runtime()
        self.assertEqual(env_Config["OMP_NUM_THREADS"], "1")
        self.assertEqual(env_Config["MKL_NUM_THREADS"], "1")
        self.assertEqual(env_Config["OPENBLAS_NUM_THREADS"], "1")
        self.assertEqual(env_Config["TOKENIZERS_PARALLELISM"], "false")

        entries = [
            {
                "id": idx,
                "feed_id": (idx % 5) + 1,
                "published_at": f"2026-10-20T{(idx % 24):02d}:00:00Z",
                "title": f"Headline {idx} about market regulation and central bank policy",
            }
            for idx in range(1, 25)
        ]

        class DeterministicEmbedder:
            def embed(self, titles):
                vectors = []
                for title in titles:
                    digest = hashlib.sha256(title.encode("utf-8")).digest()
                    vec = [((digest[i % len(digest)] / 255.0) * 2.0 - 1.0) for i in range(16)]
                    vectors.append(vec)
                return vectors

        class DeterministicReranker:
            def score(self, pairs):
                scores = []
                for left, right in pairs:
                    h = hashlib.sha256(f"{left}||{right}".encode("utf-8")).digest()
                    val = (int.from_bytes(h[:4], "big") / 0xFFFFFFFF) * 10.0 - 5.0
                    scores.append(round(val, 6))
                return scores

        baseline = rank_story_candidates(
            entries,
            embedder=DeterministicEmbedder(),
            reranker=DeterministicReranker(),
            candidate_k=50,
        )
        self.assertGreater(len(baseline), 0)

        for _ in range(5):
            run = rank_story_candidates(
                entries,
                embedder=DeterministicEmbedder(),
                reranker=DeterministicReranker(),
                candidate_k=50,
            )
            self.assertEqual(
                [(r["entry_a_id"], r["entry_b_id"], r["rank"]) for r in run],
                [(b["entry_a_id"], b["entry_b_id"], b["rank"]) for b in baseline],
            )
            max_qwen_delta = max(
                abs(r["qwen_score"] - b["qwen_score"]) for r, b in zip(run, baseline)
            )
            max_rerank_delta = max(
                abs(r["reranker_score"] - b["reranker_score"]) for r, b in zip(run, baseline)
            )
            self.assertEqual(max_qwen_delta, 0.0)
            self.assertEqual(max_rerank_delta, 0.0)

    def test_cpu_image_rebuild_reproducibility_contract(self):
        """STATIC_RUNTIME_CONTRACT_GATE: static inspection of Dockerfile and requirements.txt
        exact version pins (does not claim REAL_CONTAINER_REBUILD_REPRODUCIBILITY).
        """
        service_dir = Path(__file__).resolve().parent.parent
        dockerfile_text = (service_dir / "Dockerfile").read_text(encoding="utf-8")
        requirements_text = (service_dir / "requirements.txt").read_text(encoding="utf-8")

        # 1. Base image must be digest-pinned
        self.assertRegex(
            dockerfile_text,
            r"FROM\s+python:3\.12-slim@sha256:[0-9a-f]{64}",
        )

        # 2. Deterministic CPU env vars must be set in Dockerfile
        for required_env in (
            "OMP_NUM_THREADS=1",
            "MKL_NUM_THREADS=1",
            "OPENBLAS_NUM_THREADS=1",
            "TOKENIZERS_PARALLELISM=false",
            "HF_HUB_OFFLINE=1",
            "TRANSFORMERS_OFFLINE=1",
            "STORY_RANKER_OFFLINE=1",
        ):
            self.assertIn(required_env, dockerfile_text)

        # 3. Dockerfile must install torch==2.14.1+cpu from official PyTorch CPU index
        #    before installing requirements.txt, without global --extra-index-url
        self.assertNotIn("--extra-index-url", dockerfile_text)
        torch_cpu_cmd = (
            "pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu 'torch==2.14.1+cpu'"
        )
        req_install_cmd = "pip install --no-cache-dir -r /tmp/story-ranker-requirements.txt"
        self.assertIn(torch_cpu_cmd, dockerfile_text)
        self.assertIn(req_install_cmd, dockerfile_text)
        self.assertLess(
            dockerfile_text.index(torch_cpu_cmd),
            dockerfile_text.index(req_install_cmd),
        )

        # 4. Dockerfile must verify CPU-only torch & write/verify snapshot manifest at build time
        self.assertIn("verify_cpu_only_torch_runtime", dockerfile_text)
        self.assertIn("write_reranker_snapshot_manifest", dockerfile_text)
        self.assertIn("verify_offline_reranker_snapshot", dockerfile_text)

        # 5. requirements.txt must NOT contain generic torch and must preserve exact == pins
        req_lines = [
            line.strip()
            for line in requirements_text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        self.assertEqual(len(req_lines), 8)
        pinned_packages = {}
        for line in req_lines:
            self.assertNotIn(">=", line)
            self.assertNotIn("<", line)
            self.assertIn("==", line)
            name, version = line.split("==", 1)
            pinned_packages[name.strip().lower()] = version.strip()

        self.assertNotIn("torch", pinned_packages)
        expected_versions = {
            "sentence-transformers": "5.4.1",
            "transformers": "5.20.2",
            "tokenizers": "0.23.3",
            "huggingface-hub": "2.3.0",
            "safetensors": "0.8.0",
            "numpy": "2.5.4",
            "scipy": "1.18.1",
            "scikit-learn": "1.9.1",
        }
        self.assertEqual(pinned_packages, expected_versions)


if __name__ == "__main__":
    unittest.main()
