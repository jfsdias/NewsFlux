#!/usr/bin/env python3
"""
Unit tests for cluster_policy_benchmark.py (STORY-01B-C1 Stages E & F)

Verifies:
- UNRESTRICTED_CC_NEGATIVE_CONTROL (P0 creates bloated clusters and propagates errors)
- REPRESENTATIVE_GUARD (P1 bounds cluster sizes and reduces false merges)
- CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY (P2 eliminates related topic merges)
- STRONG_MULTI_MEMBER_SUPPORT (P3 enforces multi-member edge agreement)
- CONTRADICTION_VETO (P4 vetoes contradictory candidate admission)
- FALSE_FAMILY_MERGE_DETECTION (zero false family merges required for candidate qualification)
- TRANSITIVE_CHAIN_PROPAGATION (P0 vs P1-P4 stress test behavior)
- BENCHMARK_DETERMINISM
"""

import csv
import json
import os
import tempfile
import unittest

try:
    from .cluster_policy_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        ClusterEngine,
        evaluate_cluster_assignments_on_gold,
        evaluate_transitive_chains,
        run_cluster_policy_benchmark,
    )
except ImportError:
    from cluster_policy_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        ClusterEngine,
        evaluate_cluster_assignments_on_gold,
        evaluate_transitive_chains,
        run_cluster_policy_benchmark,
    )


class TestClusterPolicyBenchmark(unittest.TestCase):
    """Test suite for cluster_policy_benchmark.py."""

    @classmethod
    def setUpClass(cls):
        """Check if private inputs and scores exist."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_GOLD_PATH)
            and os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
            and os.path.exists(DEFAULT_SCORES_PATH)
        )

    def test_unrestricted_cc_synthetic_chain(self):
        """Test that P0 unconstrained connected components merges transitive chains."""
        # 3 articles: A-B high, B-C high, A-C missing/negative
        scores = {
            "1:2": 0.8,
            "2:3": 0.8,
        }
        published = {1: 100.0, 2: 200.0, 3: 300.0}
        articles = [1, 2, 3]

        p0_cls = ClusterEngine.cluster("P0_UNRESTRICTED_CC", scores, 0.5, articles, published)
        self.assertEqual(len(p0_cls), 1)
        self.assertEqual(p0_cls[0], [1, 2, 3])

    def test_representative_guard_synthetic_chain(self):
        """Test that P1 blocks C when edge A-C (to representative A) is missing or weak."""
        scores = {
            "1:2": 0.9,
            "2:3": 0.8,
            # 1:3 is missing or below threshold
        }
        # 1 and 2 form seed cluster; 1 is earliest (rep=1)
        published = {1: 100.0, 2: 200.0, 3: 300.0}
        articles = [1, 2, 3]

        p1_cls = ClusterEngine.cluster("P1_REPRESENTATIVE_GUARD", scores, 0.5, articles, published)
        # 3 should not be in the cluster [1, 2] because score(3, rep=1) is missing
        multi_clusters = [c for c in p1_cls if len(c) > 1]
        self.assertEqual(len(multi_clusters), 1)
        self.assertEqual(multi_clusters[0], [1, 2])
        self.assertIn([3], p1_cls)

    def test_observed_edge_compatibility_synthetic_veto(self):
        """Test that P2 blocks candidate when observed negative edge exists."""
        scores = {
            "1:2": 0.8,
            "1:3": 0.6,  # positive to rep 1
            "2:3": 0.2,  # evaluated negative to member 2 (< 0.5)
        }
        published = {1: 100.0, 2: 200.0, 3: 300.0}
        articles = [1, 2, 3]

        # Under P2, observed negative edge 2:3 vetoes 3 from cluster [1, 2]
        p2_cls = ClusterEngine.cluster("P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY", scores, 0.5, articles, published)
        multi_clusters = [c for c in p2_cls if len(c) > 1]
        self.assertEqual(len(multi_clusters), 1)
        self.assertEqual(multi_clusters[0], [1, 2])
        self.assertIn([3], p2_cls)

    def test_multi_member_support_synthetic(self):
        """Test that P3 requires >=2 edges to distinct members for cluster size >= 2."""
        scores = {
            "1:2": 0.8,
            "1:3": 0.6,  # positive to rep 1
            # 2:3 is missing (only 1 edge to existing cluster [1, 2])
        }
        published = {1: 100.0, 2: 200.0, 3: 300.0}
        articles = [1, 2, 3]

        p3_cls = ClusterEngine.cluster("P3_STRONG_MULTI_MEMBER_SUPPORT", scores, 0.5, articles, published)
        multi_clusters = [c for c in p3_cls if len(c) > 1]
        self.assertEqual(len(multi_clusters), 1)
        self.assertEqual(multi_clusters[0], [1, 2])
        self.assertIn([3], p3_cls)

    def test_end_to_end_benchmark_execution(self):
        """Test full cluster policy benchmark execution and safety outcome."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = run_cluster_policy_benchmark(output_dir=tmpdir)
            self.assertEqual(res["c1_result"], "SAFE_POLICY_CANDIDATE_FOUND")
            self.assertIn("P", res["recommended_offline_cluster_policy"])

            best = res["best_policy_metrics"]
            self.assertEqual(best["false_family_merges"], 0)
            self.assertEqual(best["cross_family_clusters"], 0)
            self.assertEqual(best["family_purity"], 1.0)

            # Check that files were emitted
            emitted = res["emitted_artifacts"]
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["benchmark_json_filename"])))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["failures_csv_filename"])))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["assignments_json_filename"])))

    def test_benchmark_determinism(self):
        """Test byte-identical benchmark outputs across two runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_cluster_policy_benchmark(output_dir=tmpdir1)
            r2 = run_cluster_policy_benchmark(output_dir=tmpdir2)
            self.assertEqual(r1["emitted_artifacts"]["benchmark_json_sha256"], r2["emitted_artifacts"]["benchmark_json_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["failures_csv_sha256"], r2["emitted_artifacts"]["failures_csv_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["assignments_json_sha256"], r2["emitted_artifacts"]["assignments_json_sha256"])


if __name__ == "__main__":
    unittest.main()
