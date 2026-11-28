"""SQLite store of per-source daily counters, keyed by account digest (ADR 0002)."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

from services.reading_signals.affinity import DailyCounts
from services.reading_signals.payload import COUNT_FIELDS, MAX_COUNT, SCHEMA_VERSION

RETENTION_DAYS = 180
_SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    account_digest TEXT NOT NULL CHECK (length(account_digest) = 64),
    feed_id INTEGER NOT NULL CHECK (feed_id > 0),
    day TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    opens INTEGER NOT NULL DEFAULT 0,
    read_to_end INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_digest, feed_id, day)
) WITHOUT ROWID
"""
_CAP = f"MIN({MAX_COUNT} * 10, {{0}} + excluded.{{0}})"  # bounded counters per feed and day


class SignalStore:
    def __init__(self, path: str | Path) -> None:
        self._path = str(path)
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """One short transaction per call; the connection is always closed."""
        conn = sqlite3.connect(self._path, timeout=10)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def add(self, account: str, rows: list[DailyCounts]) -> int:
        if not rows:
            return 0
        updates = ", ".join(f"{field} = {_CAP.format(field)}" for field in COUNT_FIELDS)
        sql = (
            f"INSERT INTO signals (account_digest, feed_id, day, {', '.join(COUNT_FIELDS)}) "
            f"VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (account_digest, feed_id, day) DO UPDATE SET {updates}"
        )
        values = [
            (account, row.feed_id, row.day.isoformat(), row.impressions, row.opens, row.read_to_end, row.stars)
            for row in rows
        ]
        with self._lock, self._connect() as conn:
            conn.executemany(sql, values)
        return len(rows)

    def counts(self, account: str) -> list[DailyCounts]:
        with self._lock, self._connect() as conn:
            result = conn.execute(
                "SELECT feed_id, day, impressions, opens, read_to_end, stars FROM signals "
                "WHERE account_digest = ? ORDER BY feed_id, day",
                (account,),
            ).fetchall()
        return [DailyCounts(r[0], date.fromisoformat(r[1]), r[2], r[3], r[4], r[5]) for r in result]

    def export(self, account: str) -> dict:
        return {
            "schema": SCHEMA_VERSION,
            "rows": [
                {
                    "feed_id": row.feed_id,
                    "day": row.day.isoformat(),
                    "impressions": row.impressions,
                    "opens": row.opens,
                    "read_to_end": row.read_to_end,
                    "stars": row.stars,
                }
                for row in self.counts(account)
            ],
        }

    def reset(self, account: str) -> int:
        with self._lock, self._connect() as conn:
            return conn.execute("DELETE FROM signals WHERE account_digest = ?", (account,)).rowcount

    def purge_unsubscribed(self, account: str, subscribed_feed_ids: set[int]) -> int:
        with self._lock, self._connect() as conn:
            existing = {r[0] for r in conn.execute("SELECT DISTINCT feed_id FROM signals WHERE account_digest = ?", (account,))}
            orphaned = sorted(existing - set(subscribed_feed_ids))
            conn.executemany(
                "DELETE FROM signals WHERE account_digest = ? AND feed_id = ?", [(account, feed_id) for feed_id in orphaned]
            )
        return len(orphaned)

    def prune(self, today: date) -> int:
        cutoff = (today - timedelta(days=RETENTION_DAYS)).isoformat()
        with self._lock, self._connect() as conn:
            return conn.execute("DELETE FROM signals WHERE day < ?", (cutoff,)).rowcount
