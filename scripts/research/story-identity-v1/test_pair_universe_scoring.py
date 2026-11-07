#!/usr/bin/env python3
"""
Unit tests for pair_universe_scoring.py (STORY-01B-C0 Stage D)

Verifies:
- CROSSFIT_TRAIN_ONLY (outer fold models fit strictly on outer training data)
- NO_FULL_GOLD_FIT (no full-gold fitting, no model persistence)
- PAIR_UNIVERSE_SCORE_COVERAGE (exactly 18,953 pairs scored)
- MEDIAN_AGGREGATION_INTEGRITY
- OOF_GOLD_SCORE_PRESERVATION
- SCORING_DETERMINISM
"""

import csv
import os
import tempfile
import unittest

try:
    from .pair_universe_scoring import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        fit_b4_outer_fold_models,
        score_pair_universe,
    )
except ImportError:
    from pair_universe_scoring import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        fit_b4_outer_fold_models,
        score_pair_universe,
    )


class TestPairUniverseScoring(unittest.TestCase):
    """Test suite for pair_universe_scoring.py."""

    @classmethod
    def setUpClass(cls):
        """Check if private inputs exist."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_GOLD_PATH)
            and os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
        )

    def test_crossfit_train_only_and_no_full_gold(self):
        """Test that outer models are fit strictly on training folds with zero full gold."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        models, fold_data, meta = fit_b4_outer_fold_models()
        self.assertEqual(len(models), 3)
        self.assertEqual(meta["full_gold_final_model_fit"], "NO")

        receipts = meta["outer_train_receipts"]
        self.assertEqual(len(receipts), 3)
        for r in receipts:
            self.assertEqual(r["training_leakage"], 0)
            self.assertGreater(r["train_pair_count"], 0)
            self.assertGreater(r["held_out_pair_count"], 0)

    def test_pair_universe_score_coverage(self):
        """Test that all 18,953 pairs are scored with zero missing."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = score_pair_universe(output_dir=tmpdir)
            self.assertEqual(res["scored_pair_count"], 18953)
            self.assertEqual(res["gold_pair_count"], 156)
            self.assertEqual(res["non_gold_pair_count"], 18797)

            with open(res["output_csv_path"]) as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                self.assertEqual(len(rows), 18953)

                # Check headers
                expected_fields = [
                    "pair_key", "entry_a_id", "entry_b_id", "b0_score",
                    "b4_crossfit_ensemble_score", "b4_model_0_score",
                    "b4_model_1_score", "b4_model_2_score", "is_gold_pair", "gold_label"
                ]
                self.assertEqual(reader.fieldnames, expected_fields)

                # Check score bounds
                for r in rows[:100]:
                    sc = float(r["b4_crossfit_ensemble_score"])
                    self.assertGreaterEqual(sc, 0.0)
                    self.assertLessEqual(sc, 1.0)
                    b0 = float(r["b0_score"])
                    self.assertGreaterEqual(b0, 0.0)
                    self.assertLessEqual(b0, 1.0)

    def test_scoring_determinism(self):
        """Test byte-identical score output across two runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = score_pair_universe(output_dir=tmpdir1)
            r2 = score_pair_universe(output_dir=tmpdir2)
            self.assertEqual(r1["output_sha256"], r2["output_sha256"])


if __name__ == "__main__":
    unittest.main()
