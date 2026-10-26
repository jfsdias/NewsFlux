#!/usr/bin/env python3
"""
Unit tests for error_audit.py (STORY-01B-M2 Stage A & B)

Verifies:
- INPUT_SHA_FAIL_FAST
- PAIR_SET_PARITY
- DISAGREEMENT_COUNTS & 4-WAY MATRIX
- CLASS_SPECIFIC_ERRORS (SAME_EVENT, RELATED_TOPIC, DIFFERENT_EVENT)
- POOLED_FPR vs FOLD_MEAN_FPR
- FOLD_STABILITY_DISTRIBUTIONS
- LOFO_COMPARISON (family-level recall deltas)
- DUO_EXCLUSION (exact 97 pairs: 15 pos, 82 neg)
- ERROR_REGIME_BINNING & DETERMINISM
"""

import csv
import json
import os
import tempfile
import unittest

try:
    from .error_audit import (
        DEFAULT_GOLD_PATH,
        DEFAULT_M1_BENCHMARK_PATH,
        DEFAULT_M1_FEATURES_PATH,
        DEFAULT_M1_PREDICTIONS_PATH,
        FrozenInputIntegrityError,
        PredictionParityError,
        analyze_error_regimes,
        bin_continuous_value,
        compute_disagreement_matrix,
        compute_exact_non_duo_analysis,
        compute_false_merge_audit,
        compute_fold_mean_vs_pooled,
        compute_fold_stability,
        compute_lofo_comparison,
        compute_positive_gain,
        run_error_audit,
        verify_m2_canonical_inputs,
        verify_prediction_parity,
    )
    from .split_audit import ArticleGraph
except ImportError:
    from error_audit import (
        DEFAULT_GOLD_PATH,
        DEFAULT_M1_BENCHMARK_PATH,
        DEFAULT_M1_FEATURES_PATH,
        DEFAULT_M1_PREDICTIONS_PATH,
        FrozenInputIntegrityError,
        PredictionParityError,
        analyze_error_regimes,
        bin_continuous_value,
        compute_disagreement_matrix,
        compute_exact_non_duo_analysis,
        compute_false_merge_audit,
        compute_fold_mean_vs_pooled,
        compute_fold_stability,
        compute_lofo_comparison,
        compute_positive_gain,
        run_error_audit,
        verify_m2_canonical_inputs,
        verify_prediction_parity,
    )
    from split_audit import ArticleGraph


class TestErrorAudit(unittest.TestCase):
    """Test suite for error_audit.py."""

    @classmethod
    def setUpClass(cls):
        """Load frozen data for tests."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_GOLD_PATH)
            and os.path.exists(DEFAULT_M1_BENCHMARK_PATH)
            and os.path.exists(DEFAULT_M1_FEATURES_PATH)
            and os.path.exists(DEFAULT_M1_PREDICTIONS_PATH)
        )
        if cls.has_private_inputs:
            with open(DEFAULT_GOLD_PATH, "r", encoding="utf-8") as f:
                cls.gold_rows = list(csv.DictReader(f))
            with open(DEFAULT_M1_PREDICTIONS_PATH, "r", encoding="utf-8") as f:
                cls.pred_rows = list(csv.DictReader(f))
            with open(DEFAULT_M1_FEATURES_PATH, "r", encoding="utf-8") as f:
                cls.feat_rows = {r["pair_key"]: r for r in csv.DictReader(f)}
            with open(DEFAULT_M1_BENCHMARK_PATH, "r", encoding="utf-8") as f:
                cls.bench_data = json.load(f)

            graph = ArticleGraph(cls.gold_rows)
            cls.comp_details = graph.get_component_details()
            cls.pair_to_component = {}
            for comp in cls.comp_details:
                cid = comp["component_id"]
                for p in comp["pairs"]:
                    cls.pair_to_component[p["pair_key"]] = cid

            cls.b0_dict = {r["pair_key"]: r for r in cls.pred_rows if r["candidate_model"] == "B0_TITLE_OVERLAP_ONLY"}
            cls.b4_dict = {r["pair_key"]: r for r in cls.pred_rows if r["candidate_model"] == "B4_LOGISTIC_REGRESSION"}

    def test_frozen_input_fail_fast_on_missing(self):
        """Test that missing input files fail immediately."""
        with self.assertRaises(FrozenInputIntegrityError):
            verify_m2_canonical_inputs(gold_path="/nonexistent/gold.csv")

    def test_frozen_input_fail_fast_on_mismatch(self):
        """Test that SHA mismatch fails immediately."""
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("corrupted,gold\n")
            f_path = f.name
        try:
            with self.assertRaises(FrozenInputIntegrityError):
                verify_m2_canonical_inputs(gold_path=f_path)
        finally:
            if os.path.exists(f_path):
                os.remove(f_path)

    def test_frozen_inputs_pass_canonical(self):
        """Test that actual canonical inputs pass SHA verification."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        shas = verify_m2_canonical_inputs()
        self.assertEqual(len(shas), 4)

    def test_prediction_parity(self):
        """Test prediction parity between B0, B4, and Gold."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        receipt = verify_prediction_parity(self.pred_rows, self.gold_rows)
        self.assertEqual(receipt["b0_pair_count"], 156)
        self.assertEqual(receipt["b4_pair_count"], 156)
        self.assertEqual(receipt["b0_unique_pair_keys"], 156)
        self.assertEqual(receipt["b4_unique_pair_keys"], 156)
        self.assertEqual(receipt["duplicate_pair_keys"], 0)
        self.assertEqual(receipt["missing_pair_keys"], 0)
        self.assertEqual(receipt["b0_b4_pair_key_parity"], "PASS")
        self.assertEqual(receipt["gold_prediction_pair_key_parity"], "PASS")

    def test_disagreement_matrix(self):
        """Test 4-way disagreement matrix calculations."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        matrix = compute_disagreement_matrix(self.b0_dict, self.b4_dict)
        self.assertEqual(matrix["total_disagreements"], 29)

        # SAME_EVENT (57)
        se = matrix["SAME_EVENT"]
        self.assertEqual(se["total_pairs"], 57)
        self.assertEqual(se["both_correct"], 32)
        self.assertEqual(se["both_wrong"], 7)
        self.assertEqual(se["b0_only_correct"], 10)
        self.assertEqual(se["b4_only_correct"], 8)

        # RELATED_TOPIC (19)
        rt = matrix["RELATED_TOPIC"]
        self.assertEqual(rt["total_pairs"], 19)
        self.assertEqual(rt["both_correct"], 12)
        self.assertEqual(rt["both_wrong"], 2)
        self.assertEqual(rt["b0_only_correct"], 3)
        self.assertEqual(rt["b4_only_correct"], 2)

        # DIFFERENT_EVENT (80)
        de = matrix["DIFFERENT_EVENT"]
        self.assertEqual(de["total_pairs"], 80)
        self.assertEqual(de["both_correct"], 71)
        self.assertEqual(de["both_wrong"], 3)
        self.assertEqual(de["b0_only_correct"], 1)
        self.assertEqual(de["b4_only_correct"], 5)

    def test_positive_gain(self):
        """Test SAME_EVENT positive gain breakdown."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        pg = compute_positive_gain(self.b0_dict, self.b4_dict, self.pair_to_component)
        self.assertEqual(pg["same_event_total"], 57)
        self.assertEqual(pg["shared_true_positives"], 32)
        self.assertEqual(pg["shared_false_negatives"], 7)
        self.assertEqual(pg["b4_rescues_b0_false_negatives"], 8)
        self.assertEqual(pg["b0_rescues_b4_false_negatives"], 10)
        self.assertEqual(pg["b4_same_event_net_gain"], -2)

        # Non-duo families have B4 rescuing 2 families (Mass Effect, watchOS) and B0 rescuing 1 pair (TSE)
        fams = pg["by_family"]
        self.assertEqual(fams["MASS_EFFECT_5_CANCELLED_PITCH"]["b4_rescues_b0"], 1)
        self.assertEqual(fams["WATCHOS_27_2_RELEASE_CANDIDATE"]["b4_rescues_b0"], 1)

    def test_false_merge_audit(self):
        """Test false merge audit on RELATED_TOPIC and DIFFERENT_EVENT."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        fma = compute_false_merge_audit(self.b0_dict, self.b4_dict)
        self.assertEqual(fma["related_topic"]["b0_fp_count"], 4)
        self.assertEqual(fma["related_topic"]["b4_fp_count"], 5)
        self.assertEqual(fma["b4_related_topic_fp_net_change"], 1)

        self.assertEqual(fma["different_event"]["b0_fp_count"], 8)
        self.assertEqual(fma["different_event"]["b4_fp_count"], 4)
        self.assertEqual(fma["b4_different_event_fp_net_change"], -4)

    def test_fold_mean_vs_pooled(self):
        """Test fold mean vs pooled calculation and explanation."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        fmp = compute_fold_mean_vs_pooled(self.bench_data)
        self.assertAlmostEqual(fmp["b0"]["related_fpr_fold_mean"], 0.1026, places=4)
        self.assertAlmostEqual(fmp["b0"]["related_fpr_pooled"], 0.2105, places=4)
        self.assertAlmostEqual(fmp["b4"]["related_fpr_fold_mean"], 0.1282, places=4)
        self.assertAlmostEqual(fmp["b4"]["related_fpr_pooled"], 0.2632, places=4)
        self.assertIn("Fold 2 accounts for", fmp["explanation"])

    def test_lofo_comparison(self):
        """Test LOFO N1 family-by-family delta classification."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        lofo = compute_lofo_comparison(self.bench_data)
        self.assertEqual(len(lofo["lofo_b4_better_families"]), 2)
        self.assertEqual(len(lofo["lofo_equal_families"]), 6)
        self.assertEqual(len(lofo["lofo_b0_better_families"]), 2)
        self.assertIn("MASS_EFFECT_5_CANCELLED_PITCH", lofo["lofo_b4_better_families"])
        self.assertIn("WATCHOS_27_2_RELEASE_CANDIDATE", lofo["lofo_b4_better_families"])
        self.assertIn("IPHONE_DUO_FIRST_GEN_LAUNCH", lofo["lofo_b0_better_families"])
        self.assertIn("TSE_EXERCITO_LULA_CHANNEL", lofo["lofo_b0_better_families"])

    def test_exact_non_duo_analysis(self):
        """Test exact non-Duo component isolation (97 pairs: 15 pos, 82 neg)."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        nd = compute_exact_non_duo_analysis(self.b0_dict, self.b4_dict, self.pair_to_component)
        self.assertEqual(nd["pair_count"], 97)
        self.assertEqual(nd["positive_count"], 15)
        self.assertEqual(nd["negative_count"], 82)

        # B0: 13 TP out of 15, rec = 0.8667
        self.assertEqual(nd["b0"]["tp"], 13)
        self.assertAlmostEqual(nd["b0"]["recall"], 0.8667, places=4)
        self.assertAlmostEqual(nd["b0"]["precision"], 0.6190, places=4)

        # B4: 14 TP out of 15, rec = 0.9333
        self.assertEqual(nd["b4"]["tp"], 14)
        self.assertAlmostEqual(nd["b4"]["recall"], 0.9333, places=4)
        self.assertAlmostEqual(nd["b4"]["precision"], 0.6364, places=4)

    def test_bin_continuous_value(self):
        """Test continuous binning helper."""
        bins = [(0.0, 0.2, "[0.0, 0.2)"), (0.2, 0.5, "[0.2, 0.5)"), (0.5, 1.0, "[0.5, 1.0]")]
        self.assertEqual(bin_continuous_value(0.1, bins), "[0.0, 0.2)")
        self.assertEqual(bin_continuous_value(0.2, bins), "[0.2, 0.5)")
        self.assertEqual(bin_continuous_value(0.75, bins), "[0.5, 1.0]")

    def test_error_regime_analysis(self):
        """Test error regime analysis groupings."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        regimes = analyze_error_regimes(self.b0_dict, self.b4_dict, self.feat_rows, self.pair_to_component)
        counts = regimes["group_counts"]
        self.assertEqual(counts["B4_ONLY_TRUE_POSITIVE"], 8)
        self.assertEqual(counts["B0_ONLY_TRUE_POSITIVE"], 10)
        self.assertEqual(counts["B4_ONLY_RELATED_TOPIC_FP"], 3)
        self.assertEqual(counts["B0_ONLY_RELATED_TOPIC_FP"], 2)
        self.assertEqual(counts["B4_ONLY_DIFFERENT_EVENT_FP"], 1)
        self.assertEqual(counts["B0_ONLY_DIFFERENT_EVENT_FP"], 5)
        self.assertEqual(len(regimes["disagreement_rows"]), 156)

    def test_end_to_end_audit_determinism(self):
        """Test that running the full audit twice generates identical outputs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_error_audit(output_dir=tmpdir1)
            r2 = run_error_audit(output_dir=tmpdir2)

            self.assertEqual(r1["emitted_artifacts"]["disagreements_sha256"], r2["emitted_artifacts"]["disagreements_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["error_audit_sha256"], r2["emitted_artifacts"]["error_audit_sha256"])
            self.assertEqual(r1["total_b0_b4_disagreements"], r2["total_b0_b4_disagreements"])


if __name__ == "__main__":
    unittest.main()
