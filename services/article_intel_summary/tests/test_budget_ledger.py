from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from services.article_intel_summary.budget import BudgetBlocked, BudgetLedger, UsageLedgerError


class BudgetLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "usage.sqlite3"
        self.ledger = BudgetLedger(self.path)
        self.now = datetime(2026, 11, 9, 12, 0, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def reserve(self, **overrides: object) -> str:
        values: dict[str, object] = {
            "estimated_cost_usd": Decimal("0.10"),
            "input_tokens": 100,
            "output_tokens": 25,
            "monthly_budget_usd": Decimal("1.00"),
            "requests_per_minute": 10,
            "tokens_per_minute": 10_000,
            "now": self.now,
        }
        values.update(overrides)
        return self.ledger.reserve(**values)

    def test_ledger_file_is_created_with_owner_only_permissions(self) -> None:
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(self.tempdir.name).stat().st_mode & 0o077, 0)

    def test_settlement_replaces_reservation_with_actual_cost(self) -> None:
        reservation_id = self.reserve()
        self.assertEqual(self.ledger.current_month_spend(now=self.now), Decimal("0.10"))

        self.ledger.settle(reservation_id, Decimal("0.003"))

        self.assertEqual(self.ledger.current_month_spend(now=self.now), Decimal("0.003"))

    def test_monthly_budget_blocks_before_reserving_excess_cost(self) -> None:
        self.reserve(estimated_cost_usd=Decimal("0.90"))
        with self.assertRaises(BudgetBlocked):
            self.reserve(estimated_cost_usd=Decimal("0.11"))
        self.assertEqual(self.ledger.current_month_spend(now=self.now), Decimal("0.90"))

    def test_request_rate_and_token_rate_are_independently_enforced(self) -> None:
        self.reserve(requests_per_minute=1)
        with self.assertRaisesRegex(BudgetBlocked, "request rate"):
            self.reserve(requests_per_minute=1)

        other_path = Path(self.tempdir.name) / "token-usage.sqlite3"
        token_ledger = BudgetLedger(other_path)
        base = {
            "estimated_cost_usd": Decimal("0.01"),
            "input_tokens": 7,
            "output_tokens": 3,
            "monthly_budget_usd": Decimal("1.00"),
            "requests_per_minute": 10,
            "tokens_per_minute": 15,
            "now": self.now,
        }
        token_ledger.reserve(**base)
        with self.assertRaisesRegex(BudgetBlocked, "token rate"):
            token_ledger.reserve(**base)

    def test_single_concurrent_reservation_and_lease_expiry(self) -> None:
        self.reserve(max_concurrent=1, lease_seconds=10)
        with self.assertRaisesRegex(BudgetBlocked, "concurrency"):
            self.reserve(max_concurrent=1, lease_seconds=10)

        next_minute = self.now + timedelta(seconds=11)
        reservation_id = self.ledger.reserve(
            estimated_cost_usd=Decimal("0.10"),
            input_tokens=100,
            output_tokens=25,
            monthly_budget_usd=Decimal("1.00"),
            requests_per_minute=10,
            tokens_per_minute=10_000,
            max_concurrent=1,
            lease_seconds=10,
            now=next_minute,
        )
        self.assertTrue(reservation_id)

    def test_uncertain_outcome_keeps_worst_case_cost_without_content(self) -> None:
        reservation_id = self.reserve()
        self.ledger.mark_uncertain(reservation_id)

        self.assertEqual(self.ledger.uncertain_count(), 1)
        self.assertEqual(self.ledger.current_month_spend(now=self.now), Decimal("0.10"))
        raw = self.path.read_bytes()
        self.assertNotIn(b"article body synthetic", raw)
        self.assertNotIn(b"miniflux-user-42", raw)
        self.assertNotIn(b"synthetic-virtual-key", raw)

    def test_insecure_existing_file_or_directory_fails_closed(self) -> None:
        self.path.chmod(0o644)
        with self.assertRaises(UsageLedgerError):
            BudgetLedger(self.path)

        unsafe_dir = Path(self.tempdir.name) / "shared"
        unsafe_dir.mkdir(mode=0o755)
        unsafe_dir.chmod(0o755)
        with self.assertRaises(UsageLedgerError):
            BudgetLedger(unsafe_dir / "usage.sqlite3")

    def test_ledger_schema_has_no_article_or_identity_fields(self) -> None:
        connection = sqlite3.connect(self.path)
        try:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(inference_usage)")}
        finally:
            connection.close()

        self.assertEqual(
            columns,
            {
                "reservation_id",
                "budget_month",
                "minute_bucket",
                "reserved_input_tokens",
                "reserved_output_tokens",
                "estimated_cost_usd",
                "actual_cost_usd",
                "state",
                "created_at",
                "lease_until",
            },
        )


if __name__ == "__main__":
    unittest.main()
