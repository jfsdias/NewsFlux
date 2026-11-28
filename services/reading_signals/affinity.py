"""Per-source affinity from daily aggregates (NF-E08, ADR 0002). Pure and deterministic."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

HALF_LIFE_DAYS = 30
PRIOR_STRENGTH = 20  # pseudo-impressions at the account-wide open rate
MIN_DECAYED_IMPRESSIONS = 30  # below this a source is still "learning" and gets no weight
PREFERRED_RATIO = 1.25
RARELY_OPENED_RATIO = 0.5
MAX_WEIGHT_DELTA = 0.3  # Home weight stays within [0.7, 1.3]

_REASONS = {
    "learning": "Not enough reading yet to learn about this source.",
    "neutral": "You open stories from this source about as often as from your other sources.",
    "preferred": "You open more of the stories you see from this source than from your other sources.",
    "rarely_opened": "You rarely open the stories you see from this source.",
}


@dataclass(frozen=True)
class DailyCounts:
    feed_id: int
    day: date
    impressions: int
    opens: int
    read_to_end: int
    stars: int


def _decay(day: date, today: date) -> float:
    age = max(0, (today - day).days)
    return 0.5 ** (age / HALF_LIFE_DAYS)


def compute_affinity(rows: list[DailyCounts], *, today: date) -> dict:
    totals: dict[int, list[float]] = {}
    for row in rows:
        factor = _decay(row.day, today)
        acc = totals.setdefault(row.feed_id, [0.0, 0.0, 0.0, 0.0])
        acc[0] += row.impressions * factor
        acc[1] += row.opens * factor
        acc[2] += row.read_to_end * factor
        acc[3] += row.stars * factor

    seen = sum(acc[0] for acc in totals.values())
    opened = sum(acc[1] for acc in totals.values())
    prior = min(1.0, opened / seen) if seen > 0 else 0.0

    sources = []
    for feed_id, (impressions, opens, read_to_end, stars) in totals.items():
        affinity = (opens + PRIOR_STRENGTH * prior) / (impressions + PRIOR_STRENGTH)
        ratio = affinity / prior if prior > 0 else 1.0
        if impressions < MIN_DECAYED_IMPRESSIONS or prior <= 0:
            state, weight = "learning", 1.0
        else:
            state = (
                "preferred"
                if ratio >= PREFERRED_RATIO
                else "rarely_opened"
                if ratio <= RARELY_OPENED_RATIO
                else "neutral"
            )
            delta = max(-MAX_WEIGHT_DELTA, min(MAX_WEIGHT_DELTA, MAX_WEIGHT_DELTA * math.log2(ratio)))
            weight = 1.0 if state == "neutral" else 1.0 + delta
        sources.append(
            {
                "feed_id": feed_id,
                "decayed_impressions": round(impressions, 2),
                "decayed_opens": round(opens, 2),
                "decayed_read_to_end": round(read_to_end, 2),
                "decayed_stars": round(stars, 2),
                "affinity": round(affinity, 4),
                "read_to_end_rate": round(read_to_end / opens, 4) if opens > 0 else None,
                "state": state,
                "weight": round(weight, 4),
                "reason": _REASONS[state],
            }
        )
    sources.sort(key=lambda source: (-source["affinity"], source["feed_id"]))
    return {
        "half_life_days": HALF_LIFE_DAYS,
        "account_open_rate": round(prior, 4),
        "sources": sources,
    }
