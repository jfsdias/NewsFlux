from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60
DEFAULT_MAX_ENTRIES = 512
DEFAULT_MAX_BYTES = 64 * 1024 * 1024
MAX_STORED_CONTENT_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class StoredRecovery:
    source_fingerprint: str
    content_html: str
    validation: dict[str, object]
    provider: str
    fetched_at: str


class RecoveryStore(Protocol):
    def get(self, entry_id: int, source_fingerprint: str) -> StoredRecovery | None: ...

    def put(self, entry_id: int, source_fingerprint: str, recovery: StoredRecovery) -> None: ...

    def delete(self, entry_id: int) -> None: ...


class MemoryRecoveryStore:
    """Test-friendly store. Production construction uses SQLiteRecoveryStore."""

    persistent = False

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values: dict[int, StoredRecovery] = {}

    def get(self, entry_id: int, source_fingerprint: str) -> StoredRecovery | None:
        with self._lock:
            value = self._values.get(entry_id)
            if value is None:
                return None
            if value.source_fingerprint != source_fingerprint:
                self._values.pop(entry_id, None)
                return None
            return value

    def put(self, entry_id: int, source_fingerprint: str, recovery: StoredRecovery) -> None:
        with self._lock:
            self._values[entry_id] = StoredRecovery(
                source_fingerprint=source_fingerprint,
                content_html=recovery.content_html,
                validation=dict(recovery.validation),
                provider=recovery.provider,
                fetched_at=recovery.fetched_at,
            )

    def delete(self, entry_id: int) -> None:
        with self._lock:
            self._values.pop(entry_id, None)


class SQLiteRecoveryStore:
    """Persistent, bounded cache for validated overlays, keyed by Miniflux entry ID."""

    persistent = True

    def __init__(
        self,
        path: str | Path,
        *,
        retention_seconds: int = DEFAULT_RETENTION_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        max_bytes: int = DEFAULT_MAX_BYTES,
        clock=time.time,
    ) -> None:
        if retention_seconds <= 0 or max_entries <= 0 or max_bytes <= 0:
            raise ValueError("recovery store limits must be positive")
        self.path = Path(path)
        if not self.path.is_absolute():
            raise ValueError("recovery store path must be absolute")
        self.retention_seconds = retention_seconds
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._clock = clock
        self._lock = threading.RLock()
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        previous_umask = os.umask(0o077)
        try:
            self._connection = sqlite3.connect(str(self.path), timeout=2, check_same_thread=False)
        finally:
            os.umask(previous_umask)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            self._connection.close()
            raise
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=FULL")
            self._connection.execute(
                """CREATE TABLE IF NOT EXISTS recovered_content (
                    entry_id INTEGER PRIMARY KEY,
                    source_fingerprint TEXT NOT NULL,
                    content_html TEXT NOT NULL,
                    validation_json TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    last_accessed_at REAL NOT NULL
                )"""
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS recovered_content_accessed "
                "ON recovered_content(last_accessed_at)"
            )
            self._connection.commit()
            self._prune_locked()

    def get(self, entry_id: int, source_fingerprint: str) -> StoredRecovery | None:
        now = self._clock()
        with self._lock:
            row = self._connection.execute(
                "SELECT source_fingerprint, content_html, validation_json, provider, fetched_at, created_at "
                "FROM recovered_content WHERE entry_id = ?",
                (entry_id,),
            ).fetchone()
            if row is None:
                return None
            stored_fingerprint, content_html, validation_json, provider, fetched_at, created_at = row
            if (
                stored_fingerprint != source_fingerprint
                or now - created_at >= self.retention_seconds
                or len(content_html.encode("utf-8")) > MAX_STORED_CONTENT_BYTES
            ):
                self._connection.execute("DELETE FROM recovered_content WHERE entry_id = ?", (entry_id,))
                self._connection.commit()
                return None
            try:
                validation = json.loads(validation_json)
            except json.JSONDecodeError:
                self._connection.execute("DELETE FROM recovered_content WHERE entry_id = ?", (entry_id,))
                self._connection.commit()
                return None
            if not isinstance(validation, dict):
                self._connection.execute("DELETE FROM recovered_content WHERE entry_id = ?", (entry_id,))
                self._connection.commit()
                return None
            self._connection.execute(
                "UPDATE recovered_content SET last_accessed_at = ? WHERE entry_id = ?",
                (now, entry_id),
            )
            self._connection.commit()
            return StoredRecovery(
                source_fingerprint=stored_fingerprint,
                content_html=content_html,
                validation=validation,
                provider=provider,
                fetched_at=fetched_at,
            )

    def put(self, entry_id: int, source_fingerprint: str, recovery: StoredRecovery) -> None:
        if len(recovery.content_html.encode("utf-8")) > MAX_STORED_CONTENT_BYTES:
            return
        now = self._clock()
        with self._lock:
            self._connection.execute(
                """INSERT INTO recovered_content (
                    entry_id, source_fingerprint, content_html, validation_json,
                    provider, fetched_at, created_at, last_accessed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(entry_id) DO UPDATE SET
                    source_fingerprint = excluded.source_fingerprint,
                    content_html = excluded.content_html,
                    validation_json = excluded.validation_json,
                    provider = excluded.provider,
                    fetched_at = excluded.fetched_at,
                    created_at = excluded.created_at,
                    last_accessed_at = excluded.last_accessed_at""",
                (
                    entry_id,
                    source_fingerprint,
                    recovery.content_html,
                    json.dumps(recovery.validation, ensure_ascii=False, separators=(",", ":")),
                    recovery.provider,
                    recovery.fetched_at,
                    now,
                    now,
                ),
            )
            self._prune_locked()
            self._connection.commit()
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass

    def delete(self, entry_id: int) -> None:
        with self._lock:
            self._connection.execute("DELETE FROM recovered_content WHERE entry_id = ?", (entry_id,))
            self._connection.commit()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def _prune_locked(self) -> None:
        cutoff = self._clock() - self.retention_seconds
        self._connection.execute("DELETE FROM recovered_content WHERE created_at <= ?", (cutoff,))
        self._connection.execute(
            """DELETE FROM recovered_content WHERE entry_id IN (
                SELECT entry_id FROM recovered_content
                ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?
            )""",
            (self.max_entries,),
        )
        while True:
            total_bytes = self._connection.execute(
                "SELECT COALESCE(SUM(length(CAST(content_html AS BLOB))), 0) FROM recovered_content"
            ).fetchone()[0]
            if total_bytes <= self.max_bytes:
                break
            self._connection.execute(
                "DELETE FROM recovered_content WHERE entry_id = "
                "(SELECT entry_id FROM recovered_content ORDER BY last_accessed_at ASC LIMIT 1)"
            )
