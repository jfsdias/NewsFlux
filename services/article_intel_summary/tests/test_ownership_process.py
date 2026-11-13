from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from services.article_intel_summary.budget import BudgetLedger, LedgerOwner, UsageLedgerError


class OwnershipProcessTests(unittest.TestCase):
    def test_owner_crash_releases_lock_for_successor(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "usage.sqlite3"
            BudgetLedger(path)
            code = ("from services.article_intel_summary.budget import LedgerOwner, BudgetLedger; "
                    "from decimal import Decimal; import sys; "
                    "o=LedgerOwner(sys.argv[1]); o.__enter__(); db=BudgetLedger(sys.argv[1]); "
                    "o.recover_orphans(db); "
                    "db.reserve(estimated_cost_usd=Decimal('0.1'), input_tokens=100, output_tokens=20, "
                    "monthly_budget_usd=Decimal('1'), requests_per_minute=10, tokens_per_minute=1000); "
                    "print('READY', flush=True); sys.stdin.read()")
            child = subprocess.Popen([sys.executable, "-c", code, str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "READY")
                with self.assertRaises(UsageLedgerError):
                    with LedgerOwner(path):
                        pass
                child.kill()
                child.wait(timeout=5)
                with LedgerOwner(path) as owner:
                    ledger = BudgetLedger(path)
                    self.assertEqual(owner.recover_orphans(ledger), 1)
                    self.assertEqual(ledger.uncertain_count(), 1)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                child.stdin.close()
                child.stdout.close()
