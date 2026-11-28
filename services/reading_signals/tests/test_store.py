from __future__ import annotations

import sqlite3
import tempfile
from contextlib import closing
import unittest
from datetime import date
from pathlib import Path

from services.reading_signals.payload import PayloadError, parse_signals_payload
from services.reading_signals.store import RETENTION_DAYS, SignalStore

TODAY = date(2026, 11, 28)
ACCOUNT = "a" * 64
OTHER = "b" * 64


def payload(*rows):
    return {"schema": 1, "rows": list(rows)}


def row(feed_id=1, day="2026-11-28", **counts):
    return {"feed_id": feed_id, "day": day, **{"impressions": 0, "opens": 0, "read_to_end": 0, "stars": 0, **counts}}


class PayloadTests(unittest.TestCase):
    def test_accepts_aggregate_rows(self) -> None:
        parsed = parse_signals_payload(payload(row(impressions=3, opens=1)), today=TODAY)
        self.assertEqual(parsed[0].feed_id, 1)
        self.assertEqual(parsed[0].impressions, 3)

    def test_rejects_entry_level_and_unknown_fields(self) -> None:
        for extra in ("entry_id", "title", "url", "content", "timestamp", "device"):
            with self.subTest(extra=extra), self.assertRaises(PayloadError):
                parse_signals_payload(payload({**row(), extra: "x"}), today=TODAY)
        with self.assertRaises(PayloadError):
            parse_signals_payload({**payload(row()), "entries": []}, today=TODAY)

    def test_rejects_bad_values(self) -> None:
        bad_rows = [
            row(feed_id=0),
            row(feed_id=True),
            row(feed_id="1"),
            row(day="2026-11-29T00:00:00"),
            row(day="2026-12-01"),
            row(day="2026-11-01"),
            row(impressions=-1),
            row(opens=1.5),
            row(opens=100_001),
        ]
        for bad in bad_rows:
            with self.subTest(bad=bad), self.assertRaises(PayloadError):
                parse_signals_payload(payload(bad), today=TODAY)

    def test_rejects_wrong_schema_and_too_many_rows(self) -> None:
        with self.assertRaises(PayloadError):
            parse_signals_payload({"schema": 2, "rows": [row()]}, today=TODAY)
        with self.assertRaises(PayloadError):
            parse_signals_payload(payload(*[row(feed_id=i) for i in range(1, 202)]), today=TODAY)

    def test_accepts_tomorrow_for_client_time_zones(self) -> None:
        parse_signals_payload(payload(row(day="2026-11-29")), today=TODAY)


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "signals.sqlite3"
        self.store = SignalStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def add(self, account, *rows):
        self.store.add(account, parse_signals_payload(payload(*rows), today=TODAY))

    def test_increments_merge_per_feed_and_day(self) -> None:
        self.add(ACCOUNT, row(impressions=2, opens=1))
        self.add(ACCOUNT, row(impressions=3, read_to_end=1))
        exported = self.store.export(ACCOUNT)
        self.assertEqual(
            exported["rows"],
            [{"feed_id": 1, "day": "2026-11-28", "impressions": 5, "opens": 1, "read_to_end": 1, "stars": 0}],
        )

    def test_accounts_are_isolated_and_reset_only_affects_one(self) -> None:
        self.add(ACCOUNT, row(impressions=2))
        self.add(OTHER, row(impressions=7))
        self.assertEqual(self.store.reset(ACCOUNT), 1)
        self.assertEqual(self.store.export(ACCOUNT)["rows"], [])
        self.assertEqual(self.store.export(OTHER)["rows"][0]["impressions"], 7)

    def test_orphan_feeds_are_purged(self) -> None:
        self.add(ACCOUNT, row(feed_id=1, impressions=2), row(feed_id=2, impressions=2))
        self.store.purge_unsubscribed(ACCOUNT, {2})
        self.assertEqual([r["feed_id"] for r in self.store.export(ACCOUNT)["rows"]], [2])

    def test_retention_prunes_old_rows(self) -> None:
        self.add(ACCOUNT, row(impressions=1))
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute("UPDATE signals SET day = '2026-01-01'")
        self.assertEqual(self.store.prune(TODAY), 1)
        self.assertGreater((TODAY - date(2026, 1, 1)).days, RETENTION_DAYS)

    def test_schema_has_no_entry_level_columns(self) -> None:
        with closing(sqlite3.connect(self.path)) as conn:
            columns = {r[1] for r in conn.execute("PRAGMA table_info(signals)")}
        self.assertEqual(
            columns, {"account_digest", "feed_id", "day", "impressions", "opens", "read_to_end", "stars"}
        )

    def test_counts_for_affinity(self) -> None:
        self.add(ACCOUNT, row(impressions=4, opens=2))
        counts = self.store.counts(ACCOUNT)
        self.assertEqual((counts[0].feed_id, counts[0].impressions, counts[0].opens), (1, 4, 2))


if __name__ == "__main__":
    unittest.main()
