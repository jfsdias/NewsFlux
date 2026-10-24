from __future__ import annotations

import json
import logging
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from services.story_ranker.adapters import (
    QWEN_EMBEDDING_DIGEST,
    QWEN_EMBEDDING_MODEL,
    QWEN_RERANKER_MODEL,
    QWEN_RERANKER_REVISION,
    OllamaEmbedder,
    QwenReranker,
)
from services.story_ranker.core import CANDIDATE_K, PAIR_WINDOW_HOURS, rank_story_candidates

MAX_ENTRIES = 200
MAX_REQUEST_BYTES = 256 * 1024
HOST = os.environ.get("STORY_RANKER_HOST", "0.0.0.0")
PORT = int(os.environ.get("STORY_RANKER_PORT", "8787"))

_EMBEDDER = OllamaEmbedder()
_RERANKER = QwenReranker()
_INFERENCE_LOCK = threading.Lock()
_LOGGER = logging.getLogger("newsflux.story_ranker")


def _model_contract() -> dict:
    return {
        "candidate_generator": QWEN_EMBEDDING_MODEL,
        "embedding_digest": QWEN_EMBEDDING_DIGEST,
        "candidate_k": CANDIDATE_K,
        "pair_window_hours": PAIR_WINDOW_HOURS,
        "reranker": QWEN_RERANKER_MODEL,
        "reranker_revision": QWEN_RERANKER_REVISION,
        "scoring": "mean(raw_logit_A_B,raw_logit_B_A)",
    }


class StoryRankerHandler(BaseHTTPRequestHandler):
    server_version = "NewsFluxStoryRanker/1"

    def _write_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status.value)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        self._write_json(
            HTTPStatus.OK,
            {"status": "ok", "model": _model_contract(), "persistent_state": False},
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/rank":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid_body_size"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        entries = payload.get("entries") if isinstance(payload, dict) else None
        if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_entries"})
            return
        if not _INFERENCE_LOCK.acquire(blocking=False):
            self._write_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "ranker_busy"})
            return

        try:
            candidates = rank_story_candidates(
                entries,
                embedder=_EMBEDDER,
                reranker=_RERANKER,
                candidate_k=CANDIDATE_K,
                window_hours=PAIR_WINDOW_HOURS,
            )
        except ValueError as exc:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_entries", "detail": str(exc)})
            return
        except RuntimeError:
            self._write_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "model_unavailable"})
            return
        except Exception:
            _LOGGER.exception("unexpected story ranking failure")
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ranking_failed"})
            return
        finally:
            _INFERENCE_LOCK.release()

        self._write_json(
            HTTPStatus.OK,
            {
                "candidates": candidates,
                "model": _model_contract(),
                "persistent_state": False,
            },
        )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), StoryRankerHandler)
    print(f"NewsFlux story ranker listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
