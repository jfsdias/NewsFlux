from __future__ import annotations

import json
import os
import urllib.request
from typing import Sequence

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


class OllamaEmbedder:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 180.0):
        self.base_url = (base_url or os.environ.get("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._verified = False

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
        tags = self._request("/api/tags")
        for model in tags.get("models", []):
            name = model.get("name") or model.get("model")
            if name != QWEN_EMBEDDING_MODEL:
                continue
            if model.get("digest") != QWEN_EMBEDDING_DIGEST:
                raise RuntimeError("Ollama embedding model digest does not match the R3C baseline")
            self._verified = True
            return
        raise RuntimeError("Required Ollama embedding model is not installed")

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
        if any(not isinstance(vector, list) or len(vector) != QWEN_EMBEDDING_DIMENSION for vector in vectors):
            raise RuntimeError("Ollama embedding dimension does not match the R3C baseline")
        return vectors


class QwenReranker:
    def __init__(self, *, device: str | None = None, batch_size: int | None = None):
        self.device = device or os.environ.get("STORY_RANKER_DEVICE") or "cpu"
        self.batch_size = batch_size or int(os.environ.get("STORY_RANKER_BATCH_SIZE", "8"))
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(
                QWEN_RERANKER_MODEL,
                revision=QWEN_RERANKER_REVISION,
                device=self.device,
                prompts={"story_identity": QWEN_RERANKER_INSTRUCTION},
                default_prompt_name="story_identity",
                local_files_only=os.environ.get("STORY_RANKER_OFFLINE", "1") != "0",
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
