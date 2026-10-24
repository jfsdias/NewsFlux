from __future__ import annotations

import math
from datetime import datetime
from itertools import combinations
from typing import Protocol, Sequence

CANDIDATE_K = 250
PAIR_WINDOW_HOURS = 168


class Embedder(Protocol):
    def embed(self, titles: Sequence[str]) -> Sequence[Sequence[float]]: ...


class Reranker(Protocol):
    def score(self, pairs: Sequence[tuple[str, str]]) -> Sequence[float]: ...


def _positive_int(value, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a positive integer")
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a positive integer") from exc
    if numeric <= 0 or str(numeric) != str(value).strip():
        if not isinstance(value, int):
            raise ValueError(f"{field} must be a positive integer")
    return numeric


def _timestamp(value: object) -> float:
    if not isinstance(value, str) or not value:
        raise ValueError("published_at must be an ISO-8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("published_at must be an ISO-8601 string") from exc
    if parsed.tzinfo is None:
        raise ValueError("published_at must include a timezone")
    return parsed.timestamp()


def normalize_entries(entries: Sequence[dict]) -> list[dict]:
    normalized: list[dict] = []
    seen_ids: set[int] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("entries must contain objects")
        entry_id = _positive_int(entry.get("id"), "id")
        feed_id = _positive_int(entry.get("feed_id"), "feed_id")
        title = entry.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("title must be a non-empty string")
        published_at = entry.get("published_at")
        published_ts = _timestamp(published_at)
        if entry_id in seen_ids:
            raise ValueError("entry ids must be unique")
        seen_ids.add(entry_id)
        normalized.append(
            {
                "id": entry_id,
                "feed_id": feed_id,
                "published_at": published_at,
                "published_ts": published_ts,
                "title": title.strip(),
            }
        )
    return normalized


def _validate_vectors(vectors: Sequence[Sequence[float]], expected_count: int) -> list[list[float]]:
    if len(vectors) != expected_count:
        raise ValueError("embedding vector count does not match entries")
    normalized: list[list[float]] = []
    dimension: int | None = None
    for vector in vectors:
        values = [float(value) for value in vector]
        if not values or not all(math.isfinite(value) for value in values):
            raise ValueError("embedding vectors must contain finite values")
        if dimension is None:
            dimension = len(values)
        elif len(values) != dimension:
            raise ValueError("embedding vectors must use one dimension")
        if math.sqrt(sum(value * value for value in values)) <= 0:
            raise ValueError("embedding vectors must have non-zero norm")
        normalized.append(values)
    return normalized


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return dot / (left_norm * right_norm)


def _finite_scores(scores: Sequence[float], expected_count: int) -> list[float]:
    if len(scores) != expected_count:
        raise ValueError("reranker score count does not match candidates")
    values = [float(score) for score in scores]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("reranker scores must be finite")
    return values


def rank_story_candidates(
    entries: Sequence[dict],
    *,
    embedder: Embedder,
    reranker: Reranker,
    candidate_k: int = CANDIDATE_K,
    window_hours: int = PAIR_WINDOW_HOURS,
) -> list[dict]:
    if candidate_k <= 0:
        raise ValueError("candidate_k must be positive")
    if window_hours <= 0:
        raise ValueError("window_hours must be positive")

    records = normalize_entries(entries)
    if len(records) < 2:
        return []

    vectors = _validate_vectors(embedder.embed([record["title"] for record in records]), len(records))
    window_seconds = window_hours * 60 * 60
    candidates: list[dict] = []

    for left_index, right_index in combinations(range(len(records)), 2):
        left = records[left_index]
        right = records[right_index]
        if left["feed_id"] == right["feed_id"]:
            continue
        if abs(left["published_ts"] - right["published_ts"]) > window_seconds:
            continue

        if left["id"] <= right["id"]:
            entry_a, entry_b = left, right
            vector_a, vector_b = vectors[left_index], vectors[right_index]
        else:
            entry_a, entry_b = right, left
            vector_a, vector_b = vectors[right_index], vectors[left_index]

        candidates.append(
            {
                "entry_a_id": entry_a["id"],
                "entry_b_id": entry_b["id"],
                "title_a": entry_a["title"],
                "title_b": entry_b["title"],
                "qwen_score": _cosine(vector_a, vector_b),
            }
        )

    candidates.sort(
        key=lambda candidate: (
            -candidate["qwen_score"],
            candidate["entry_a_id"],
            candidate["entry_b_id"],
        )
    )
    candidates = candidates[:candidate_k]
    if not candidates:
        return []

    for qwen_rank, candidate in enumerate(candidates, start=1):
        candidate["qwen_rank"] = qwen_rank

    ab_pairs = [(candidate["title_a"], candidate["title_b"]) for candidate in candidates]
    ba_pairs = [(right, left) for left, right in ab_pairs]
    scores_ab = _finite_scores(reranker.score(ab_pairs), len(candidates))
    scores_ba = _finite_scores(reranker.score(ba_pairs), len(candidates))

    for candidate, score_ab, score_ba in zip(candidates, scores_ab, scores_ba, strict=True):
        candidate["reranker_score"] = (score_ab + score_ba) / 2.0

    candidates.sort(
        key=lambda candidate: (
            -candidate["reranker_score"],
            candidate["qwen_rank"],
            candidate["entry_a_id"],
            candidate["entry_b_id"],
        )
    )

    return [
        {
            "entry_a_id": candidate["entry_a_id"],
            "entry_b_id": candidate["entry_b_id"],
            "rank": rank,
            "qwen_score": candidate["qwen_score"],
            "reranker_score": candidate["reranker_score"],
        }
        for rank, candidate in enumerate(candidates, start=1)
    ]
