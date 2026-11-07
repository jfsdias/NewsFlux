#!/usr/bin/env python3
"""
Unit tests for candidate_retrieval.py (STORY-01B-C5 Stage 1)

Verifies:
- Input fail-fast integrity
- Positive family connectivity graph preservation under spanning trees
- Monotonicity across K values
- Semantic & entity/numeric guard logic in R6
- Pareto frontier derivation
- Byte-identical benchmark determinism
"""

import os
import tempfile
import unittest

try:
    from .candidate_retrieval import (
        CANONICAL_TOTAL_PAIRS,
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        evaluate_candidate_set,
        execute_retrieval_method,
        run_candidate_retrieval_benchmark,
        verify_retrieval_inputs,
    )
except ImportError:
    from candidate_retrieval import (
        CANONICAL_TOTAL_PAIRS,
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        evaluate_candidate_set,
        execute_retrieval_method,
        run_candidate_retrieval_benchmark,
        verify_retrieval_inputs,
    )


class TestCandidateRetrieval(unittest.TestCase):
    """Test suite for candidate_retrieval.py."""

    @classmethod
    def setUpClass(cls):
        """Check availability of canonical inputs."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_GOLD_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
            and os.path.exists(DEFAULT_SCORES_PATH)
        )

    def test_verify_inputs_fail_fast(self):
        """Test that missing required inputs raise FileNotFoundError immediately."""
        with self.assertRaises(FileNotFoundError):
            verify_retrieval_inputs("/nonexistent/corpus.jsonl", DEFAULT_GOLD_PATH, DEFAULT_PAIRS_PATH, DEFAULT_SCORES_PATH)

    def test_evaluate_candidate_set_perfect_recall(self):
        """Test evaluation when all positive pairs are retrieved."""
        gold_rows = [
            {"pair_key": "1:2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_A", "entry_a_id": "1", "entry_b_id": "2"},
            {"pair_key": "2:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_A", "entry_a_id": "2", "entry_b_id": "3"},
            {"pair_key": "1:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_A", "entry_a_id": "1", "entry_b_id": "3"},
            {"pair_key": "4:5", "gold_label": "RELATED_TOPIC", "entry_a_id": "4", "entry_b_id": "5"},
            {"pair_key": "6:7", "gold_label": "DIFFERENT_EVENT", "entry_a_id": "6", "entry_b_id": "7"},
        ]
        fam_articles = {"FAM_A": {1, 2, 3}}
        fam_pairs = {"FAM_A": [(1, 2), (2, 3), (1, 3)]}

        retrieved = {"1:2", "2:3", "1:3"}
        metrics = evaluate_candidate_set(retrieved, gold_rows, fam_articles, fam_pairs, total_universe_pairs=100)

        self.assertEqual(metrics["retrieved_pair_count"], 3)
        self.assertEqual(metrics["pair_reduction_percent"], 97.0)
        self.assertEqual(metrics["same_event_pair_recall"], 1.0)
        self.assertEqual(metrics["positive_family_connectivity_recall"], 1.0)
        self.assertEqual(metrics["related_topic_candidate_rate"], 0.0)
        self.assertEqual(metrics["different_event_candidate_rate"], 0.0)

    def test_family_connectivity_spanning_tree(self):
        """Test that a spanning tree preserves 100% connectivity despite <100% pair recall."""
        # 3 articles triangle: edges (1, 2), (2, 3), (1, 3).
        # We retrieve ONLY (1, 2) and (2, 3).
        gold_rows = [
            {"pair_key": "1:2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "1", "entry_b_id": "2"},
            {"pair_key": "2:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "2", "entry_b_id": "3"},
            {"pair_key": "1:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "1", "entry_b_id": "3"},
        ]
        fam_articles = {"FAM_TRI": {1, 2, 3}}
        fam_pairs = {"FAM_TRI": [(1, 2), (2, 3), (1, 3)]}

        retrieved = {"1:2", "2:3"}  # missing 1:3
        metrics = evaluate_candidate_set(retrieved, gold_rows, fam_articles, fam_pairs, total_universe_pairs=100)

        # Pair recall is 2/3 = 0.6667
        self.assertAlmostEqual(metrics["same_event_pair_recall"], 0.6667, places=4)
        # But family connectivity is 100% preserved because 1-2-3 form a single connected component!
        self.assertEqual(metrics["positive_family_connectivity_recall"], 1.0)
        self.assertTrue(metrics["family_connectivity_breakdown"]["FAM_TRI"]["connectivity_preserved"])

    def test_family_connectivity_split(self):
        """Test that a disconnected member correctly causes family connectivity failure."""
        gold_rows = [
            {"pair_key": "1:2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "1", "entry_b_id": "2"},
            {"pair_key": "2:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "2", "entry_b_id": "3"},
            {"pair_key": "1:3", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_TRI", "entry_a_id": "1", "entry_b_id": "3"},
        ]
        fam_articles = {"FAM_TRI": {1, 2, 3}}
        fam_pairs = {"FAM_TRI": [(1, 2), (2, 3), (1, 3)]}

        retrieved = {"1:2"}  # article 3 is completely disconnected
        metrics = evaluate_candidate_set(retrieved, gold_rows, fam_articles, fam_pairs, total_universe_pairs=100)

        self.assertAlmostEqual(metrics["same_event_pair_recall"], 0.3333, places=4)
        self.assertEqual(metrics["positive_family_connectivity_recall"], 0.0)
        self.assertFalse(metrics["family_connectivity_breakdown"]["FAM_TRI"]["connectivity_preserved"])
        self.assertEqual(metrics["family_connectivity_breakdown"]["FAM_TRI"]["connected_components"], 2)

    def test_retrieval_monotonicity_across_k(self):
        """Test that larger K retrieves a superset or equal count of pairs compared to smaller K."""
        article_candidates = {
            1: [
                {"pair_key": "1:2", "b0": 0.5, "qw": 0.8, "ms": 0.8},
                {"pair_key": "1:3", "b0": 0.4, "qw": 0.7, "ms": 0.7},
                {"pair_key": "1:4", "b0": 0.3, "qw": 0.6, "ms": 0.6},
                {"pair_key": "1:5", "b0": 0.2, "qw": 0.5, "ms": 0.5},
            ]
        }
        all_pairs = {"1:2", "1:3", "1:4", "1:5"}

        ret_k1 = execute_retrieval_method("R2_QWEN_COSINE_TOP_K", 1, article_candidates, all_pairs)
        ret_k2 = execute_retrieval_method("R2_QWEN_COSINE_TOP_K", 2, article_candidates, all_pairs)
        ret_k3 = execute_retrieval_method("R2_QWEN_COSINE_TOP_K", 3, article_candidates, all_pairs)

        self.assertGreaterEqual(len(ret_k2), len(ret_k1))
        self.assertGreaterEqual(len(ret_k3), len(ret_k2))
        self.assertTrue(ret_k1.issubset(ret_k2))
        self.assertTrue(ret_k2.issubset(ret_k3))

    def test_synthetic_r6_hybrid_guards(self):
        """Test that R6 hybrid guards filter noisy low-similarity pairs unless guarded by entity/numeric token."""
        article_candidates = {
            1: [
                # High dense (passes)
                {"pair_key": "1:2", "b0": 0.05, "qw": 0.78, "ms": 0.70, "ea": 0.0, "num": 0.0},
                # Low dense, but high lexical (passes)
                {"pair_key": "1:3", "b0": 0.25, "qw": 0.55, "ms": 0.50, "ea": 0.0, "num": 0.0},
                # Low dense, low lexical, but has numeric overlap (passes guard)
                {"pair_key": "1:4", "b0": 0.10, "qw": 0.60, "ms": 0.50, "ea": 0.0, "num": 1.0},
                # Low dense, low lexical, no guard (rejected by R6)
                {"pair_key": "1:5", "b0": 0.05, "qw": 0.50, "ms": 0.40, "ea": 0.0, "num": 0.0},
            ]
        }
        all_pairs = {"1:2", "1:3", "1:4", "1:5"}
        ret = execute_retrieval_method("R6_HYBRID_WITH_GUARDS", 4, article_candidates, all_pairs)

        self.assertIn("1:2", ret)
        self.assertIn("1:3", ret)
        self.assertIn("1:4", ret)
        self.assertNotIn("1:5", ret)

    def test_end_to_end_retrieval_benchmark(self):
        """Test complete candidate retrieval pipeline and Pareto frontier output."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = run_candidate_retrieval_benchmark(output_dir=tmpdir)
            self.assertEqual(res["benchmark_version"], "story01b-c5-retrieval-benchmark-v1")
            self.assertEqual(res["full_universe_pair_count"], CANONICAL_TOTAL_PAIRS)
            self.assertIn("TEMPORAL_LOOKBACK_QUALITY_VALIDATION", res["corpus_temporal_note"])

            # Verify recommended method and K
            self.assertIn("R", res["recommended_retrieval_method"])
            self.assertIn(res["recommended_k"], [3, 5, 10, 20, 30, 50])

            # Check that files exist on disk
            emitted = res["emitted_artifacts"]
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["benchmark_json_filename"])))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["candidate_sets_json_filename"])))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["pareto_csv_filename"])))

            # Check Pareto frontier
            pareto = res["pareto_optimal_configurations"]
            self.assertGreater(len(pareto), 0)
            for p in pareto:
                self.assertEqual(p["positive_family_connectivity_recall"], 1.0)
                self.assertGreaterEqual(p["same_event_pair_recall"], 0.85)

    def test_retrieval_determinism(self):
        """Test byte-identical outputs across two consecutive runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_candidate_retrieval_benchmark(output_dir=tmpdir1)
            r2 = run_candidate_retrieval_benchmark(output_dir=tmpdir2)

            self.assertEqual(r1["emitted_artifacts"]["candidate_sets_sha256"], r2["emitted_artifacts"]["candidate_sets_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["pareto_csv_sha256"], r2["emitted_artifacts"]["pareto_csv_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["benchmark_json_sha256"], r2["emitted_artifacts"]["benchmark_json_sha256"])


if __name__ == "__main__":
    unittest.main()
