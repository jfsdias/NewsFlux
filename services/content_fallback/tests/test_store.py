from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from services.content_fallback.store import SQLiteRecoveryStore, StoredRecovery


def stored(fingerprint: str = "source-a", content: str = "<p>Validated text.</p>") -> StoredRecovery:
    return StoredRecovery(
        source_fingerprint=fingerprint,
        content_html=content,
        validation={"state": "SUFFICIENT", "word_count": 240},
        provider="wallhop.io",
        fetched_at="2026-11-07T00:00:00+00:00",
    )


class SQLiteRecoveryStoreTests(unittest.TestCase):
    def test_recovery_survives_store_recreation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "recovery.sqlite3"
            first = SQLiteRecoveryStore(path)
            first.put(42, "source-a", stored())
            first.close()

            second = SQLiteRecoveryStore(path)
            result = second.get(42, "source-a")
            self.assertIsNotNone(result)
            assert result is not None
            self.assertEqual(result.content_html, "<p>Validated text.</p>")
            self.assertEqual(result.validation["word_count"], 240)
            self.assertEqual(result.provider, "wallhop.io")
            second.close()

    def test_changed_source_fingerprint_invalidates_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRecoveryStore(Path(directory) / "recovery.sqlite3")
            store.put(42, "source-a", stored())
            self.assertIsNone(store.get(42, "source-b"))
            self.assertIsNone(store.get(42, "source-a"))
            store.close()

    def test_expired_entries_are_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            now = [100.0]
            store = SQLiteRecoveryStore(
                Path(directory) / "recovery.sqlite3",
                retention_seconds=10,
                clock=lambda: now[0],
            )
            store.put(42, "source-a", stored())
            now[0] = 111.0
            self.assertIsNone(store.get(42, "source-a"))
            store.close()

    def test_entry_limit_prunes_oldest_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            now = [100.0]
            store = SQLiteRecoveryStore(
                Path(directory) / "recovery.sqlite3",
                max_entries=2,
                clock=lambda: now[0],
            )
            for entry_id in (1, 2, 3):
                now[0] += 1
                store.put(entry_id, f"source-{entry_id}", stored(f"source-{entry_id}"))
            self.assertIsNone(store.get(1, "source-1"))
            self.assertIsNotNone(store.get(2, "source-2"))
            self.assertIsNotNone(store.get(3, "source-3"))
            store.close()

    def test_total_byte_limit_prunes_oversized_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRecoveryStore(Path(directory) / "recovery.sqlite3", max_bytes=30)
            store.put(42, "source-a", stored(content="<p>" + "x" * 40 + "</p>"))
            self.assertIsNone(store.get(42, "source-a"))
            store.close()

    def test_database_file_permissions_are_owner_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "recovery.sqlite3"
            store = SQLiteRecoveryStore(path)
            store.close()
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
