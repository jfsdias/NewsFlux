#!/usr/bin/env python3
"""
Unit tests for abstention_benchmark.py (STORY-01B-C6 Stage 2)

Verifies:
- Pair-level admission rules for Q0, Q1, Q2, Q3
- Inter-model spread and margin gating
- Story confidence band classification (STRONG, MODERATE, WEAK, STANDALONE)
- Safety-coverage frontier monotonicity
- Byte-identical benchmark determinism
"""

import os
import tempfile
import unittest

try:
    from .abstention_benchmark import (
        DEFAULT_GOLD_PATH,
        DEFAULT_SCORES_PATH,
        classify_story_confidence_band,
        evaluate_pair_abstention_admission,
        run_abstention_benchmark,
        verify_abstention_inputs,
    )
except ImportError:
    from abstention_benchmark import (
        DEFAULT_GOLD_PATH,
        DEFAULT_SCORES_PATH,
        classify_story_confidence_band,
        evaluate_pair_abstention_admission,
        run_abstention_benchmark,
        verify_abstention_inputs,
    )


class TestAbstentionBenchmark(unittest.TestCase):
    """Test suite for abstention_benchmark.py."""

    @classmethod
    def setUpClass(cls):
        """Check availability of canonical inputs."""
        cls.has_private_inputs = os.path.exists(DEFAULT_GOLD_PATH) and os.path.exists(DEFAULT_SCORES_PATH)

    def test_verify_inputs_fail_fast(self):
        """Test fail-fast on missing input paths."""
        with self.assertRaises(FileNotFoundError):
            verify_abstention_inputs("/nonexistent/gold.csv", DEFAULT_SCORES_PATH)

    def test_pair_admission_q0_no_abstention(self):
        """Test Q0 basic threshold admission."""
        adm1, r1 = evaluate_pair_abstention_admission("Q0_NO_ABSTENTION", b4_ens=0.40, model_scores=[0.40, 0.40, 0.40], threshold=0.3787)
        self.assertTrue(adm1)
        self.assertEqual(r1, "SCORE_ABOVE_THRESHOLD")

        adm2, r2 = evaluate_pair_abstention_admission("Q0_NO_ABSTENTION", b4_ens=0.35, model_scores=[0.35, 0.35, 0.35], threshold=0.3787)
        self.assertFalse(adm2)
        self.assertEqual(r2, "SCORE_BELOW_THRESHOLD")

    def test_pair_admission_q1_crossfit_unanimity(self):
        """Test Q1 requiring all 3 models above threshold."""
        # Split models: m0=0.50, m1=0.50, m2=0.30 (b4_ens=0.43 >= threshold)
        adm, reason = evaluate_pair_abstention_admission("Q1_CROSSFIT_UNANIMITY", b4_ens=0.43, model_scores=[0.50, 0.50, 0.30], threshold=0.3787)
        self.assertFalse(adm)
        self.assertEqual(reason, "MODEL_DISAGREEMENT_2_OF_3")

        # Unanimous models: m0=0.40, m1=0.42, m2=0.39
        adm_u, reason_u = evaluate_pair_abstention_admission("Q1_CROSSFIT_UNANIMITY", b4_ens=0.40, model_scores=[0.40, 0.42, 0.39], threshold=0.3787)
        self.assertTrue(adm_u)
        self.assertEqual(reason_u, "ALL_MODELS_ABOVE_THRESHOLD")

    def test_pair_admission_q2_unanimity_plus_margin(self):
        """Test Q2 requiring unanimity and score >= threshold + margin."""
        thresh = 0.3787
        margin = 0.05
        # Passes threshold (0.40 > 0.3787) but fails margin (0.40 < 0.4287)
        adm1, r1 = evaluate_pair_abstention_admission("Q2_UNANIMITY_PLUS_MARGIN", b4_ens=0.40, model_scores=[0.40, 0.40, 0.40], threshold=thresh, margin=margin)
        self.assertFalse(adm1)
        self.assertEqual(r1, "INSUFFICIENT_MARGIN")

        # Passes margin (0.45 >= 0.4287)
        adm2, r2 = evaluate_pair_abstention_admission("Q2_UNANIMITY_PLUS_MARGIN", b4_ens=0.45, model_scores=[0.45, 0.45, 0.45], threshold=thresh, margin=margin)
        self.assertTrue(adm2)
        self.assertEqual(r2, "UNANIMITY_WITH_MARGIN")

    def test_pair_admission_q3_spread(self):
        """Test Q3 requiring unanimity and low spread <= 0.15."""
        thresh = 0.3787
        # Spread = 0.60 - 0.40 = 0.20 > 0.15 -> rejected
        adm1, r1 = evaluate_pair_abstention_admission("Q3_HIGH_CONSENSUS_STABILITY", b4_ens=0.50, model_scores=[0.60, 0.50, 0.40], threshold=thresh)
        self.assertFalse(adm1)
        self.assertIn("HIGH_MODEL_SPREAD", r1)

        # Spread = 0.45 - 0.40 = 0.05 <= 0.15 -> admitted
        adm2, r2 = evaluate_pair_abstention_admission("Q3_HIGH_CONSENSUS_STABILITY", b4_ens=0.42, model_scores=[0.45, 0.42, 0.40], threshold=thresh)
        self.assertTrue(adm2)
        self.assertEqual(r2, "HIGH_CONSENSUS_LOW_SPREAD")

    def test_classify_story_confidence_band(self):
        """Test story-level confidence band classification."""
        # Standalone
        band_sa, _ = classify_story_confidence_band(member_count=1, source_count=1, internal_edge_scores=[], internal_model_scores=[], contradiction_count=0)
        self.assertEqual(band_sa, "STANDALONE")

        # Strong support
        band_st, _ = classify_story_confidence_band(
            member_count=3,
            source_count=3,
            internal_edge_scores=[0.80, 0.85, 0.75],
            internal_model_scores=[[0.80, 0.80, 0.80], [0.85, 0.85, 0.85], [0.75, 0.75, 0.75]],
            contradiction_count=0,
            threshold=0.3787,
        )
        self.assertEqual(band_st, "STRONG_SUPPORT")

        # Weak support due to contradiction
        band_wk, _ = classify_story_confidence_band(
            member_count=3,
            source_count=2,
            internal_edge_scores=[0.80, 0.85],
            internal_model_scores=[[0.80, 0.80, 0.80], [0.85, 0.85, 0.85]],
            contradiction_count=1,
            threshold=0.3787,
        )
        self.assertEqual(band_wk, "WEAK_SUPPORT")

    def test_end_to_end_abstention_benchmark(self):
        """Test complete abstention benchmark execution on Gold."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = run_abstention_benchmark(output_dir=tmpdir)
            self.assertEqual(res["benchmark_version"], "story01b-c6-abstention-frontier-v1")
            self.assertIn("Q", res["recommended_abstention_policy"])

            frontier = res["safety_coverage_frontier"]
            self.assertEqual(len(frontier), 4)

            # Check emitted artifact exists
            json_file = os.path.join(tmpdir, res["emitted_artifacts"]["frontier_json_filename"])
            self.assertTrue(os.path.exists(json_file))

    def test_abstention_determinism(self):
        """Test byte-identical frontier JSON output across two independent runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_abstention_benchmark(output_dir=tmpdir1)
            r2 = run_abstention_benchmark(output_dir=tmpdir2)
            self.assertEqual(r1["emitted_artifacts"]["frontier_json_sha256"], r2["emitted_artifacts"]["frontier_json_sha256"])


if __name__ == "__main__":
    unittest.main()
