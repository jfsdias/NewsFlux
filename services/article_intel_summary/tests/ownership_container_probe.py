"""Synthetic ownership probe; all state must reside in an isolated test volume."""
from decimal import Decimal
import importlib.util
import sys
import time

spec = importlib.util.spec_from_file_location("budget", "/app/services/article_intel_summary/budget.py")
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)
BudgetLedger, LedgerOwner, UsageLedgerError = budget.BudgetLedger, budget.LedgerOwner, budget.UsageLedgerError

path = "/data/usage.sqlite3"
mode = sys.argv[1]
if mode == "holder":
    ledger = BudgetLedger(path)
    with LedgerOwner(path) as owner:
        owner.recover_orphans(ledger)
        ledger.reserve(estimated_cost_usd=Decimal("0.1"), input_tokens=100, output_tokens=20,
                       monthly_budget_usd=Decimal("1"), requests_per_minute=10, tokens_per_minute=1000)
        print("READY", flush=True)
        while True:
            time.sleep(1)
elif mode == "contender":
    try:
        with LedgerOwner(path):
            pass
    except UsageLedgerError:
        print("BLOCKED")
    else:
        raise SystemExit("concurrent owner admitted")
elif mode == "successor":
    ledger = BudgetLedger(path)
    with LedgerOwner(path) as owner:
        assert owner.recover_orphans(ledger) == 1
        assert ledger.uncertain_count() == 1
    print("RECOVERED_UNCERTAIN")
else:
    raise SystemExit("unknown probe")
