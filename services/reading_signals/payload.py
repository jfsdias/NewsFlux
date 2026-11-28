"""Strict validation of client signal batches: per-source daily counters only (ADR 0002)."""

from __future__ import annotations

import re
from datetime import date, timedelta

from services.reading_signals.affinity import DailyCounts

SCHEMA_VERSION = 1
MAX_ROWS = 200
MAX_COUNT = 100_000
MAX_FEED_ID = 9_223_372_036_854_775_807
MAX_PAST_DAYS = 7  # clients keep unsent increments for at most 7 days
MAX_FUTURE_DAYS = 1  # client time zones may be ahead of UTC
COUNT_FIELDS = ("impressions", "opens", "read_to_end", "stars")
_ROW_FIELDS = frozenset(("feed_id", "day", *COUNT_FIELDS))
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class PayloadError(ValueError):
    """The batch is not a valid aggregate payload; never echoes client content."""


def _positive_int(value: object, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise PayloadError("invalid integer")
    return value


def _count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_COUNT:
        raise PayloadError("invalid count")
    return value


def _day(value: object, today: date) -> date:
    if not isinstance(value, str) or not _DAY.fullmatch(value):
        raise PayloadError("invalid day")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise PayloadError("invalid day") from None
    if not today - timedelta(days=MAX_PAST_DAYS) <= parsed <= today + timedelta(days=MAX_FUTURE_DAYS):
        raise PayloadError("day out of range")
    return parsed


def parse_signals_payload(payload: object, *, today: date) -> list[DailyCounts]:
    if not isinstance(payload, dict) or set(payload) != {"schema", "rows"}:
        raise PayloadError("invalid payload")
    if payload["schema"] != SCHEMA_VERSION or isinstance(payload["schema"], bool):
        raise PayloadError("unsupported schema")
    rows = payload["rows"]
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise PayloadError("invalid rows")
    parsed = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != _ROW_FIELDS:
            raise PayloadError("invalid row")
        parsed.append(
            DailyCounts(
                feed_id=_positive_int(row["feed_id"], MAX_FEED_ID),
                day=_day(row["day"], today),
                **{field: _count(row[field]) for field in COUNT_FIELDS},
            )
        )
    return parsed
