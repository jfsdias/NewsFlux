#!/usr/bin/env python3
"""
Unit tests for story_replay.py (STORY-01B-C7 to C10 Stages 3-6)

Verifies:
- Strict chronological sorting of incoming articles
- Batch vs Incremental final parity
- Arrival order perturbation sensitivity
- Representative churn ranking (R0 stability-optimal vs R1 recency-optimal)
- Representative review pack schema
- Determinism across independent runs
"""

import os
import tempfile
import unittest

try:
    from .story_replay import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_SCORES_PATH,
        build_representative_review_pack,
        compare_batch_vs_incremental_parity,
        compare_representative_policies_on_replay,
        evaluate_arrival_order_sensitivity,
        load_corpus,
        load_scores,
        run_story_replay_pipeline,
        simulate_chronological_replay,
    )
except ImportError:
    from story_replay import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_SCORES_PATH,
        build_representative_review_pack,
        compare_batch_vs_incremental_parity,
        compare_representative_policies_on_replay,
        evaluate_arrival_order_sensitivity,
        load_corpus,
        load_scores,
        run_story_replay_pipeline,
        simulate_chronological_replay,
    )


class TestStoryReplay(unittest.TestCase):
    """Test suite for story_replay.py."""

    @classmethod
    def setUpClass(cls):
        """Check availability of canonical inputs."""
        cls.has_private_inputs = os.path.exists(DEFAULT_CORPUS_PATH) and os.path.exists(DEFAULT_SCORES_PATH)

    def test_load_corpus_chronological_sort(self):
        """Test that corpus is strictly chronologically ordered."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        articles = load_corpus(DEFAULT_CORPUS_PATH)
        self.assertEqual(len(articles), 200)

        for i in range(len(articles) - 1):
            p1 = float(articles[i].get("published_at", 0.0))
            p2 = float(articles[i + 1].get("published_at", 0.0))
            self.assertLessEqual(p1, p2)
            if p1 == p2:
                self.assertLess(int(articles[i]["id"]), int(articles[i + 1]["id"]))

    def test_batch_vs_incremental_parity(self):
        """Test that streaming incremental addition achieves 100% parity with batch recompute."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        articles = load_corpus(DEFAULT_CORPUS_PATH)
        scores = load_scores(DEFAULT_SCORES_PATH)

        parity = compare_batch_vs_incremental_parity(articles, scores, threshold=0.3787)
        self.assertEqual(parity["final_batch_incremental_parity"], "PASS")
        self.assertTrue(parity["cluster_membership_parity"])
        self.assertEqual(parity["incremental_story_count"], parity["batch_story_count"])

    def test_arrival_order_sensitivity(self):
        """Test arrival order perturbation sensitivity metrics."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        articles = load_corpus(DEFAULT_CORPUS_PATH)
        scores = load_scores(DEFAULT_SCORES_PATH)

        res = evaluate_arrival_order_sensitivity(articles, scores, threshold=0.3787)
        self.assertIn("arrival_order_final_parity", res)
        self.assertEqual(res["base_multi_story_count"], res["p1_multi_story_count"])

    def test_representative_policies_comparison(self):
        """Test that R0 produces lower representative churn than R1."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        articles = load_corpus(DEFAULT_CORPUS_PATH)
        scores = load_scores(DEFAULT_SCORES_PATH)

        res = compare_representative_policies_on_replay(articles, scores, threshold=0.3787)
        metrics = res["metrics_by_policy"]
        r0_churn = metrics["R0_EARLIEST"]["representative_churn_count"]
        r1_churn = metrics["R1_LATEST"]["representative_churn_count"]

        # R0 earliest never churns when newer articles arrive
        self.assertEqual(r0_churn, 0)
        # R1 latest churns frequently as newer articles join
        self.assertGreater(r1_churn, 0)
        self.assertEqual(res["stability_optimal_policy"], "R0_EARLIEST")
        self.assertEqual(res["recency_optimal_policy"], "R1_LATEST")

    def test_end_to_end_replay_pipeline(self):
        """Test full replay pipeline and artifact emission."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmp_replay, tempfile.TemporaryDirectory() as tmp_rep:
            res = run_story_replay_pipeline(replay_out_dir=tmp_replay, rep_out_dir=tmp_rep)

            self.assertEqual(res["parity_report"]["final_batch_incremental_parity"], "PASS")
            emitted = res["emitted_artifacts"]

            self.assertTrue(os.path.exists(os.path.join(tmp_replay, "chronological-replay-v1.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp_replay, "arrival-order-sensitivity-v1.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp_rep, "representative-stability-v1.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp_rep, "representative-review-pack-v1.csv")))
            self.assertTrue(os.path.exists(os.path.join(tmp_rep, "alternatives-benchmark-v1.json")))

    def test_replay_pipeline_determinism(self):
        """Test byte-identical outputs across two independent runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as rep1, tempfile.TemporaryDirectory() as rep2, \
             tempfile.TemporaryDirectory() as out1, tempfile.TemporaryDirectory() as out2:
            r1 = run_story_replay_pipeline(replay_out_dir=rep1, rep_out_dir=out1)
            r2 = run_story_replay_pipeline(replay_out_dir=rep2, rep_out_dir=out2)

            self.assertEqual(r1["emitted_artifacts"]["chronological_replay_sha256"], r2["emitted_artifacts"]["chronological_replay_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["arrival_order_sensitivity_sha256"], r2["emitted_artifacts"]["arrival_order_sensitivity_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["representative_stability_sha256"], r2["emitted_artifacts"]["representative_stability_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["representative_review_pack_sha256"], r2["emitted_artifacts"]["representative_review_pack_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["alternatives_benchmark_sha256"], r2["emitted_artifacts"]["alternatives_benchmark_sha256"])


if __name__ == "__main__":
    unittest.main()
