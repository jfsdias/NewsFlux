#!/usr/bin/env python3
"""Emit only aggregate usage state for the isolated pilot test ledger."""
import json
import sqlite3
import sys


def main(path: str) -> None:
    uri = f"file:{path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        rows = connection.execute(
            "SELECT state, COUNT(*) FROM inference_usage GROUP BY state ORDER BY state"
        ).fetchall()
        spend = connection.execute(
            "SELECT COALESCE(SUM(CAST(actual_cost_usd AS REAL)), 0) "
            "FROM inference_usage WHERE state = 'settled'"
        ).fetchone()[0]
    summary = {"states": dict(rows), "settled_spend_usd": round(spend, 12)}
    if sum(summary["states"].values()) == 0 or summary["states"].get("in_flight", 0):
        raise SystemExit("LEDGER_GATE=FAIL_EMPTY_OR_IN_FLIGHT")
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-ledger.py /path/to/usage.sqlite3")
    main(sys.argv[1])
