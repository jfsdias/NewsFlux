#!/usr/bin/env python3
"""Unit tests for STORY-02-A2C Gold V2 Benchmark and Audit."""

import unittest
from pathlib import Path
import sys

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from gold_v2_benchmark import (
    verify_input_artifacts,
    load_gold_v2_materialized,
    run_gold_v2_benchmark,
    EXPECTED_GOLD_V2_SHA256,
)


class TestGoldV2Benchmark(unittest.TestCase):
    """Tests Gold V2 integrity, split feasibility, and benchmark executions."""

    def test_01_verify_input_artifacts(self):
        res = verify_input_artifacts()
        self.assertEqual(res["human_label_count"], 77)
        self.assertEqual(res["decision_source_gate"], "PASS")
        self.assertEqual(res["human_labels"]["gate"], "PASS")
        self.assertEqual(res["annotation_pack"]["gate"], "PASS")
        self.assertEqual(res["sidecar"]["gate"], "PASS")
        self.assertEqual(res["gold_v1"]["gate"], "PASS")
        self.assertEqual(res["home_200"]["gate"], "PASS")

    def test_02_load_gold_v2_materialized(self):
        rows, meta = load_gold_v2_materialized()
        self.assertEqual(len(rows), 233)
        self.assertEqual(meta["gold_v2_sha256"], EXPECTED_GOLD_V2_SHA256)
        self.assertEqual(meta["unique_articles"], 153)

        # Class counts
        counts = {}
        for r in rows:
            lbl = r["gold_label"]
            counts[lbl] = counts.get(lbl, 0) + 1

        self.assertEqual(counts["SAME_EVENT"], 57)
        self.assertEqual(counts["RELATED_TOPIC"], 27)
        self.assertEqual(counts["DIFFERENT_EVENT"], 149)

    def test_03_benchmark_invariants_and_leak_free(self):
        results = run_gold_v2_benchmark()
        self.assertEqual(results["split"]["article_leakage"], "ZERO")
        self.assertEqual(results["split"]["pair_leakage"], "ZERO")
        self.assertEqual(results["split"]["family_leakage"], "ZERO")

        # Invariant: Duo share is ~73.7%
        same_rows = [p for p in results["d0"]["oof_predictions"] if p["gold_label"] == "SAME_EVENT"]
        self.assertEqual(len(same_rows), 57)

        # Scorer results non-null
        self.assertGreater(results["d0"]["pr_auc"], 0.8)
        self.assertGreater(results["d1"]["pr_auc"], 0.9)
        self.assertGreater(results["pf1"]["pr_auc"], 0.85)


if __name__ == "__main__":
    unittest.main()
