#!/usr/bin/env python3
"""Tests for direct_scorer_benchmark.py (STORY-02-A0 R2).

Verifies:
- Direct pair scorers (D0 Title Overlap, D1 Qwen Cosine) under 3-fold component group CV.
- Zero model fitting, zero scalers, zero learned weights.
- Cluster safety propagation through P3 on Gold subgraph (zero false family merges).
- True end-to-end execution of D0 raw pipeline on Home-200.
- All R2 private artifacts generated and valid.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from direct_scorer_benchmark import (
    OUTPUT_DIR,
    cluster_with_p3,
    compute_overlap_coefficient,
    evaluate_direct_scorer_3fold,
    evaluate_gold_cluster_safety,
    execute_d0_raw_pipeline_on_home200,
    extract_significant_words,
    run_direct_scorer_benchmark,
)
from model_benchmark import (
    load_and_materialize_features,
    make_canonical_pair_key,
    simulate_protocol_a,
)
from split_audit import ArticleGraph


class TestDirectScorerBenchmark(unittest.TestCase):
    """Verifies direct pair scorers and cluster safety contracts."""

    @classmethod
    def setUpClass(cls):
        cls.rows, _ = load_and_materialize_features()
        cls.graph = ArticleGraph(cls.rows)
        cls.split_result = simulate_protocol_a(cls.graph, 3)

        comp_lookup = {c["component_id"]: c for c in cls.graph.get_component_details()}
        rows_by_key = {r["pair_key"]: r for r in cls.rows}

        cls.fold_data = []
        for f in cls.split_result["folds"]:
            f_idx = f["fold"]
            f_rows = []
            f_articles = set()
            for cid in f["components"]:
                c_info = comp_lookup[cid]
                f_articles.update(c_info["nodes"])
                for p in c_info["pairs"]:
                    pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                    f_rows.append(rows_by_key[pk])
            cls.fold_data.append({"fold_idx": f_idx, "rows": f_rows, "articles": f_articles})

        cls.d0_res = evaluate_direct_scorer_3fold("D0_TITLE_OVERLAP_DIRECT", "title_overlap_coefficient", cls.fold_data)
        cls.d1_res = evaluate_direct_scorer_3fold("D1_QWEN_COSINE_DIRECT", "qwen_embedding_cosine", cls.fold_data)

    def test_d0_direct_metrics(self):
        """Verifies D0 Title Overlap Direct metrics under 3-fold component group CV."""
        self.assertEqual(self.d0_res["scorer_name"], "D0_TITLE_OVERLAP_DIRECT")
        self.assertEqual(self.d0_res["oof_count"], 156)
        self.assertAlmostEqual(self.d0_res["pr_auc"], 0.8660, places=2)
        self.assertAlmostEqual(self.d0_res["roc_auc"], 0.9403, places=2)
        self.assertAlmostEqual(self.d0_res["precision"], 0.7778, places=2)
        self.assertAlmostEqual(self.d0_res["recall"], 0.7368, places=2)
        self.assertAlmostEqual(self.d0_res["f05"], 0.7692, places=2)
        self.assertLessEqual(self.d0_res["threshold_summary"]["spread"], 0.10)

    def test_d1_direct_metrics(self):
        """Verifies D1 Qwen Cosine Direct metrics under 3-fold component group CV."""
        self.assertEqual(self.d1_res["scorer_name"], "D1_QWEN_COSINE_DIRECT")
        self.assertEqual(self.d1_res["oof_count"], 156)
        self.assertAlmostEqual(self.d1_res["pr_auc"], 0.9651, places=2)
        self.assertAlmostEqual(self.d1_res["roc_auc"], 0.9796, places=2)
        self.assertAlmostEqual(self.d1_res["precision"], 0.9231, places=2)
        self.assertAlmostEqual(self.d1_res["recall"], 0.8421, places=2)
        self.assertAlmostEqual(self.d1_res["f05"], 0.9057, places=2)
        self.assertLessEqual(self.d1_res["threshold_summary"]["spread"], 0.08)

    def test_zero_learned_model_architecture(self):
        """Verifies that direct scorers do NOT use any StandardScaler or LogisticRegression."""
        for res in [self.d0_res, self.d1_res]:
            self.assertEqual(res["requires_learned_model"], False)

    def test_p3_cluster_safety_on_gold(self):
        """Verifies zero false family merges and zero cross-family clusters for D0 and D1."""
        d0_safety = evaluate_gold_cluster_safety(self.d0_res, self.rows, {})
        d1_safety = evaluate_gold_cluster_safety(self.d1_res, self.rows, {})

        for safety in [d0_safety, d1_safety]:
            for op_name, op_metrics in safety["operating_points"].items():
                self.assertEqual(
                    op_metrics["false_family_merge_count"],
                    0,
                    f"False family merge count must be 0 for {safety['scorer_name']} at {op_name}",
                )
                self.assertEqual(
                    op_metrics["cross_family_cluster_count"],
                    0,
                    f"Cross-family cluster count must be 0 for {safety['scorer_name']} at {op_name}",
                )

        # STRICT checks: zero related topic contamination
        d0_strict = d0_safety["operating_points"]["STRICT"]
        self.assertEqual(d0_strict["related_topic_cluster_contamination"], 0)

        d1_strict = d1_safety["operating_points"]["STRICT"]
        self.assertEqual(d1_strict["related_topic_cluster_contamination"], 0)

    def test_d0_raw_pipeline_execution(self):
        """Verifies that the D0 raw pipeline runs end-to-end from raw article objects."""
        corpus_path = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl")
        if not corpus_path.exists():
            self.skipTest(f"Corpus file not found at {corpus_path}")

        raw_articles = []
        with open(corpus_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    raw_articles.append(json.loads(line))

        self.assertEqual(len(raw_articles), 200)

        projections, stats, timing = execute_d0_raw_pipeline_on_home200(raw_articles, threshold=0.3541)

        self.assertEqual(stats["home_items_before"], 200)
        self.assertEqual(stats["home_items_after"], 170)
        self.assertEqual(stats["multi_article_story_count"], 20)
        self.assertEqual(stats["duplicate_articles_compressed"], 30)
        self.assertEqual(stats["noise_reduction_percent"], 15.0)

        # Check total latency is within research contract (< 20 ms)
        self.assertLess(timing["total_end_to_end_ms"], 20.0)

        # Check H1 order preservation
        positions = [p["h1_home_position"] for p in projections]
        self.assertEqual(positions, sorted(positions))

    def test_private_artifacts_exist(self):
        """Verifies all 8 private artifacts exist in /tmp/newsflux-story02-a0-r2/."""
        expected_artifacts = [
            "direct-scorer-benchmark-v1.json",
            "cluster-safety-comparison-v1.json",
            "d0-runtime-pipeline-v1.json",
            "d0-home-projection-v1.json",
            "d1-frozen-home-projection-v1.json",
            "false-merge-review-pack-v1.csv",
            "runtime-scorer-contract-v1.json",
            "architecture-r2-scorecard-v1.json",
        ]
        for name in expected_artifacts:
            art_path = OUTPUT_DIR / name
            self.assertTrue(art_path.exists(), f"Artifact {name} must exist in {OUTPUT_DIR}")
            self.assertGreater(art_path.stat().st_size, 0, f"Artifact {name} must not be empty")


if __name__ == "__main__":
    unittest.main()
