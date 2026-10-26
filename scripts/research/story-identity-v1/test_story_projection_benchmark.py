#!/usr/bin/env python3
"""
Unit tests for story_projection_benchmark.py (STORY-01B-C4 Stage I)

Verifies:
- HOME200_PERFORMANCE_EXECUTION (latency and memory metrics within sane bounds)
- SYNTHETIC_SCALING_EXECUTION (N=200, 500, 1000 run deterministically)
- COMPLEXITY_REPORT_STRUCTURE (dominant cost, asymptotic risk, bounds)
- BENCHMARK_DETERMINISM
"""

import json
import os
import tempfile
import unittest

try:
    from .story_projection_benchmark import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        benchmark_home200_pipeline,
        run_performance_and_complexity_benchmark,
        run_synthetic_scaling_benchmark,
    )
except ImportError:
    from story_projection_benchmark import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        benchmark_home200_pipeline,
        run_performance_and_complexity_benchmark,
        run_synthetic_scaling_benchmark,
    )


class TestStoryProjectionBenchmark(unittest.TestCase):
    """Test suite for story_projection_benchmark.py."""

    @classmethod
    def setUpClass(cls):
        """Check if private inputs exist."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_ASSIGNMENTS_PATH)
            and os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
            and os.path.exists(DEFAULT_SCORES_PATH)
        )

    def test_synthetic_scaling_benchmark(self):
        """Test synthetic scaling benchmark for N=200, 500, 1000."""
        results = run_synthetic_scaling_benchmark([50, 100])
        self.assertEqual(len(results), 2)
        for r in results:
            self.assertEqual(r["synthetic_scaling_only"], "YES")
            self.assertGreater(r["article_count"], 0)
            self.assertGreater(r["candidate_pair_count"], 0)
            self.assertGreaterEqual(r["total_ms"], 0.0)

    def test_home200_pipeline_benchmark(self):
        """Test real Home-200 pipeline metrics."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        res = benchmark_home200_pipeline()
        self.assertEqual(res["article_count"], 200)
        self.assertEqual(res["candidate_pair_count"], 18953)
        self.assertGreater(res["cluster_count"], 0)
        self.assertGreater(res["total_projection_ms"], 0.0)
        self.assertGreater(res["peak_process_memory_mb"], 0.0)

    def test_full_benchmark_and_complexity_report(self):
        """Test full benchmark execution and complexity report structure."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = run_performance_and_complexity_benchmark(output_dir=tmpdir)
            comp = res["complexity_report"]
            self.assertEqual(comp["dominant_cost"], "PAIR_CANDIDATE_GENERATION_AND_SCORING")
            self.assertIn("QUADRATIC", comp["asymptotic_risk"])
            self.assertIn("HIGH", comp["pair_explosion_risk"])
            self.assertIn("lookback_window_hours", comp["recommended_research_bounds"])
            self.assertIn("max_candidate_pairs_per_article", comp["recommended_research_bounds"])
            self.assertIn("max_cluster_size", comp["recommended_research_bounds"])

            perf_file = os.path.join(tmpdir, res["emitted_artifacts"]["performance_json_filename"])
            self.assertTrue(os.path.exists(perf_file))

    def test_benchmark_determinism(self):
        """Test that synthetic scaling outputs and complexity report are deterministic."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_performance_and_complexity_benchmark(output_dir=tmpdir1)
            r2 = run_performance_and_complexity_benchmark(output_dir=tmpdir2)
            self.assertEqual(r1["complexity_report"], r2["complexity_report"])

            # Check synthetic scaling structure determinism
            s1 = r1["synthetic_scaling_benchmark"]
            s2 = r2["synthetic_scaling_benchmark"]
            self.assertEqual(len(s1), len(s2))
            for i in range(len(s1)):
                self.assertEqual(s1[i]["article_count"], s2[i]["article_count"])
                self.assertEqual(s1[i]["candidate_pair_count"], s2[i]["candidate_pair_count"])
                self.assertEqual(s1[i]["cluster_count"], s2[i]["cluster_count"])
                self.assertEqual(s1[i]["multi_article_cluster_count"], s2[i]["multi_article_cluster_count"])


if __name__ == "__main__":
    unittest.main()
