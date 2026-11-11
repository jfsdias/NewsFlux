from __future__ import annotations

import os
import secrets
import sqlite3
import stat
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


class BudgetBlocked(RuntimeError):
    """A safe pre-dispatch budget, rate, or concurrency denial."""


class UsageLedgerError(RuntimeError):
    """The local usage ledger cannot safely authorize a request."""


class BudgetLedger:
    """Private SQLite accounting for token reservations and settled model usage.

    The ledger stores only token counts and monetary amounts. It never stores prompts,
    responses, article identifiers, Miniflux identities, or credentials.
    """

    RETENTION_MONTHS = 13

    def __init__(self, database_path: str | Path) -> None:
        self.path = Path(database_path)
        self._prepare_private_path()
        self._initialize()

    def _prepare_private_path(self) -> None:
        if not self.path.is_absolute():
            raise UsageLedgerError("usage ledger path must be absolute") from None
        parent = self.path.parent
        try:
            parent_info = parent.lstat()
        except OSError:
            raise UsageLedgerError("usage ledger directory is unavailable") from None
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or stat.S_ISLNK(parent_info.st_mode)
            or parent_info.st_uid != os.geteuid()
            or stat.S_IMODE(parent_info.st_mode) & 0o077
        ):
            raise UsageLedgerError("usage ledger directory must be private to the service user") from None

        try:
            info = self.path.lstat()
        except FileNotFoundError:
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            try:
                descriptor = os.open(self.path, flags, 0o600)
                os.close(descriptor)
            except OSError:
                raise UsageLedgerError("usage ledger could not be created securely") from None
            info = self.path.lstat()
        except OSError:
            raise UsageLedgerError("usage ledger path is unavailable") from None

        if (
            not stat.S_ISREG(info.st_mode)
            or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise UsageLedgerError("usage ledger file must be a private regular file") from None

    def _connect(self) -> sqlite3.Connection:
        try:
            connection = sqlite3.connect(self.path, timeout=2, isolation_level=None)
            connection.execute("PRAGMA busy_timeout = 2000")
            return connection
        except sqlite3.Error:
            raise UsageLedgerError("usage ledger is unavailable") from None

    def _initialize(self) -> None:
        connection = self._connect()
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS inference_usage (
                    reservation_id TEXT PRIMARY KEY,
                    budget_month TEXT NOT NULL,
                    minute_bucket INTEGER NOT NULL,
                    reserved_input_tokens INTEGER NOT NULL,
                    reserved_output_tokens INTEGER NOT NULL,
                    estimated_cost_usd TEXT NOT NULL,
                    actual_cost_usd TEXT,
                    state TEXT NOT NULL CHECK (state IN ('in_flight', 'settled', 'uncertain')),
                    created_at INTEGER NOT NULL,
                    lease_until INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS inference_usage_month_idx ON inference_usage (budget_month)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS inference_usage_minute_idx ON inference_usage (minute_bucket)"
            )
            connection.close()
            self._prepare_private_path()
        except sqlite3.Error:
            connection.close()
            raise UsageLedgerError("usage ledger schema could not be initialized") from None

    @staticmethod
    def _utc_now(now: datetime | None) -> datetime:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None or current.utcoffset() is None:
            raise UsageLedgerError("usage ledger clock must be timezone aware")
        return current.astimezone(timezone.utc)

    def reserve(
        self,
        *,
        estimated_cost_usd: Decimal,
        input_tokens: int,
        output_tokens: int,
        monthly_budget_usd: Decimal,
        requests_per_minute: int,
        tokens_per_minute: int,
        max_concurrent: int = 1,
        lease_seconds: int = 45,
        now: datetime | None = None,
    ) -> str:
        if (
            not isinstance(estimated_cost_usd, Decimal)
            or not estimated_cost_usd.is_finite()
            or estimated_cost_usd < 0
            or not isinstance(monthly_budget_usd, Decimal)
            or not monthly_budget_usd.is_finite()
            or monthly_budget_usd <= 0
            or not _positive_int(input_tokens)
            or not _positive_int(output_tokens)
            or not _positive_int(requests_per_minute)
            or not _positive_int(tokens_per_minute)
            or not _positive_int(max_concurrent)
            or not _positive_int(lease_seconds)
        ):
            raise UsageLedgerError("usage ledger admission settings are invalid") from None

        current = self._utc_now(now)
        epoch = int(current.timestamp())
        month = current.strftime("%Y-%m")
        minute_bucket = epoch // 60
        connection = self._connect()
        reservation_id = secrets.token_hex(16)
        try:
            connection.execute("BEGIN IMMEDIATE")
            cutoff_month = _month_offset(current.year, current.month, -self.RETENTION_MONTHS)
            connection.execute("DELETE FROM inference_usage WHERE budget_month < ?", (cutoff_month,))

            monthly_rows = connection.execute(
                "SELECT state, estimated_cost_usd, actual_cost_usd FROM inference_usage WHERE budget_month = ?",
                (month,),
            ).fetchall()
            month_total = Decimal("0")
            for state, estimate, actual in monthly_rows:
                amount = Decimal(actual) if state == "settled" and actual is not None else Decimal(estimate)
                month_total += amount
            if month_total + estimated_cost_usd > monthly_budget_usd:
                raise BudgetBlocked("monthly budget limit reached") from None

            minute_rows = connection.execute(
                "SELECT reserved_input_tokens, reserved_output_tokens FROM inference_usage WHERE minute_bucket = ?",
                (minute_bucket,),
            ).fetchall()
            if len(minute_rows) >= requests_per_minute:
                raise BudgetBlocked("request rate limit reached") from None
            minute_tokens = sum(input_count + output_count for input_count, output_count in minute_rows)
            if minute_tokens + input_tokens + output_tokens > tokens_per_minute:
                raise BudgetBlocked("token rate limit reached") from None

            active_count = connection.execute(
                "SELECT COUNT(*) FROM inference_usage WHERE state = 'in_flight' AND lease_until > ?",
                (epoch,),
            ).fetchone()[0]
            if active_count >= max_concurrent:
                raise BudgetBlocked("concurrency limit reached") from None

            connection.execute(
                """
                INSERT INTO inference_usage (
                    reservation_id, budget_month, minute_bucket, reserved_input_tokens,
                    reserved_output_tokens, estimated_cost_usd, actual_cost_usd, state,
                    created_at, lease_until
                ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'in_flight', ?, ?)
                """,
                (
                    reservation_id,
                    month,
                    minute_bucket,
                    input_tokens,
                    output_tokens,
                    str(estimated_cost_usd),
                    epoch,
                    epoch + lease_seconds,
                ),
            )
            connection.commit()
            return reservation_id
        except BudgetBlocked:
            connection.rollback()
            raise
        except (sqlite3.Error, InvalidOperation):
            connection.rollback()
            raise UsageLedgerError("usage ledger admission failed") from None
        finally:
            connection.close()

    def settle(self, reservation_id: str, actual_cost_usd: Decimal) -> None:
        if not isinstance(actual_cost_usd, Decimal) or not actual_cost_usd.is_finite() or actual_cost_usd < 0:
            raise UsageLedgerError("actual usage cost is invalid") from None
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            result = connection.execute(
                """
                UPDATE inference_usage
                SET state = 'settled', actual_cost_usd = ?, lease_until = 0
                WHERE reservation_id = ? AND state = 'in_flight'
                """,
                (str(actual_cost_usd), reservation_id),
            )
            if result.rowcount != 1:
                raise UsageLedgerError("usage reservation is no longer active") from None
            connection.commit()
        except UsageLedgerError:
            connection.rollback()
            raise
        except sqlite3.Error:
            connection.rollback()
            raise UsageLedgerError("usage accounting failed") from None
        finally:
            connection.close()

    def mark_uncertain(self, reservation_id: str) -> None:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE inference_usage
                SET state = 'uncertain', lease_until = 0
                WHERE reservation_id = ? AND state = 'in_flight'
                """,
                (reservation_id,),
            )
            connection.commit()
        except sqlite3.Error:
            connection.rollback()
            # The in-flight reservation remains charged at its maximum estimate.
            raise UsageLedgerError("uncertain usage could not be recorded") from None
        finally:
            connection.close()

    def current_month_spend(self, *, now: datetime | None = None) -> Decimal:
        month = self._utc_now(now).strftime("%Y-%m")
        connection = self._connect()
        try:
            rows = connection.execute(
                "SELECT state, estimated_cost_usd, actual_cost_usd FROM inference_usage WHERE budget_month = ?",
                (month,),
            ).fetchall()
            total = Decimal("0")
            for state, estimate, actual in rows:
                total += Decimal(actual) if state == "settled" and actual is not None else Decimal(estimate)
            return total
        except (sqlite3.Error, InvalidOperation):
            raise UsageLedgerError("usage total could not be read") from None
        finally:
            connection.close()

    def uncertain_count(self) -> int:
        connection = self._connect()
        try:
            return connection.execute(
                "SELECT COUNT(*) FROM inference_usage WHERE state = 'uncertain'"
            ).fetchone()[0]
        except sqlite3.Error:
            raise UsageLedgerError("usage uncertainty could not be read") from None
        finally:
            connection.close()


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _month_offset(year: int, month: int, offset: int) -> str:
    absolute = year * 12 + month - 1 + offset
    return f"{absolute // 12:04d}-{absolute % 12 + 1:02d}"
