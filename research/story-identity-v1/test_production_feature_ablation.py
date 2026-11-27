#!/usr/bin/env python3
"""Tests for production_feature_ablation.py (STORY-02-A0 R1)."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from production_feature_ablation import (
    PF0_LEXICAL_FEATURES,
    PF1_QWEN_FEATURES,
    PF2_SIDECAR_FEATURES,
    PF3_REFERENCE_FEATURES,
    LeakageTracker,
    evaluate_outer_3fold_leak_free,
    fit_train_only_pipeline,
    run_production_feature_ablation,
)


class TestProductionFeatureAblation(unittest.TestCase):
    """Verifies leak-free 3-fold component group CV, no full-gold fits, and exact OOF coverage."""

    @classmethod
    def setUpClass(cls):
        cls.ablation, cls.matrix = run_production_feature_ablation()

    def test_no_full_gold_model_fit(self):
        """Verifies FULL_GOLD_FIT_COUNT == 0 and LeakageTracker intercepts full gold fit attempts."""
        self.assertEqual(self.ablation["full_gold_fit_count"], 0)
        self.assertGreaterEqual(self.ablation["total_model_fits_executed"], 10)

        # Test tracker intercept logic
        tracker = LeakageTracker()
        dummy_rows = [{"pair_key": f"p_{i}"} for i in range(156)]
        with self.assertRaises(AssertionError) as ctx:
            tracker.record_fit(dummy_rows, "malicious_full_gold_fit", total_gold_count=156)
        self.assertIn("LEAKAGE_DETECTED", str(ctx.exception))
        self.assertEqual(tracker.full_gold_fits, 1)

    def test_complete_oof_predictions(self):
        """Verifies all 156 Gold pairs receive exactly 1 OOF prediction (99 negative)."""
        self.assertEqual(self.ablation["gold_pair_count"], 156)
        self.assertEqual(self.ablation["same_event_count"], 57)
        self.assertEqual(self.ablation["related_topic_count"], 19)
        self.assertEqual(self.ablation["different_event_count"], 80)
        self.assertEqual(self.ablation["negative_oof_count"], 99)

        for m_name in ["PF0_LEXICAL_ONLY", "PF1_LEXICAL_PLUS_QWEN", "PF3_LEXICAL_QWEN_MISTRAL_REFERENCE"]:
            m = self.ablation["models"][m_name]
            self.assertEqual(m["oof_count"], 156, f"{m_name} must have 156 OOF predictions")
            self.assertEqual(m["negative_oof_count"], 99, f"{m_name} must have 99 negative OOF predictions")
            self.assertEqual(m["related_topic_total"], 19)
            self.assertEqual(m["different_event_total"], 80)

    def test_article_disjointness_across_folds(self):
        """Verifies zero article ID leakage across train and test for all outer folds."""
        self.assertEqual(self.ablation["article_id_cross_split_leakage"], 0)

    def test_outer_test_threshold_independence(self):
        """Verifies that mutating outer test labels has zero effect on selected threshold."""
        # Run test fold evaluation with pristine fold data
        from model_benchmark import load_and_materialize_features, make_canonical_pair_key, simulate_protocol_a
        from split_audit import ArticleGraph

        rows, _ = load_and_materialize_features()
        graph = ArticleGraph(rows)
        split = simulate_protocol_a(graph, 3)

        comp_lookup = {c["component_id"]: c for c in graph.get_component_details()}
        rows_by_key = {r["pair_key"]: r for r in rows}

        fold_data = []
        for f in split["folds"]:
            f_rows = []
            f_articles = set()
            for cid in f["components"]:
                c_info = comp_lookup[cid]
                f_articles.update(c_info["nodes"])
                for p in c_info["pairs"]:
                    pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                    f_rows.append(rows_by_key[pk])
            fold_data.append({"fold_idx": f["fold"], "rows": f_rows, "articles": f_articles})

        res_orig = evaluate_outer_3fold_leak_free("PF0_TEST", PF0_LEXICAL_FEATURES, fold_data)
        thresh_orig = [f["selected_threshold"] for f in res_orig["outer_folds"]]

        # Mutate labels in test fold 0
        mutated_fold_data = copy.deepcopy(fold_data)
        for r in mutated_fold_data[0]["rows"]:
            r["target_binary"] = 1 - int(r["target_binary"])

        res_mutated = evaluate_outer_3fold_leak_free("PF0_TEST", PF0_LEXICAL_FEATURES, mutated_fold_data)
        thresh_mutated = [f["selected_threshold"] for f in res_mutated["outer_folds"]]

        # Threshold for fold 0 must be 100% IDENTICAL because it depends strictly on folds 1 & 2
        self.assertEqual(thresh_orig[0], thresh_mutated[0])

    def test_reranker_missingness_accounting(self):
        """Verifies PF2 reranker coverage reporting and PF2_FULL_GOLD_COMPARABLE = False."""
        pf2 = self.ablation["models"]["PF2_LEXICAL_PLUS_SIDECAR"]
        self.assertEqual(pf2["status"], "NON_FULL_GOLD_COVERAGE")
        self.assertEqual(pf2["reranker_non_null_count"], 71)
        self.assertEqual(pf2["reranker_null_count"], 85)
        self.assertFalse(pf2["pf2_full_gold_comparable"])

    def test_feature_subset_definitions(self):
        """Verifies canonical feature subset progression."""
        self.assertEqual(len(PF0_LEXICAL_FEATURES), 15)
        self.assertEqual(len(PF1_QWEN_FEATURES), 16)
        self.assertEqual(len(PF2_SIDECAR_FEATURES), 17)
        self.assertEqual(len(PF3_REFERENCE_FEATURES), 17)

        self.assertTrue(set(PF0_LEXICAL_FEATURES).issubset(set(PF1_QWEN_FEATURES)))
        self.assertTrue(set(PF1_QWEN_FEATURES).issubset(set(PF2_SIDECAR_FEATURES)))
        self.assertTrue(set(PF1_QWEN_FEATURES).issubset(set(PF3_REFERENCE_FEATURES)))

        # PF0 contains no dense embeddings
        for f in PF0_LEXICAL_FEATURES:
            self.assertNotIn("embedding", f)
            self.assertNotIn("reranker", f)

    def test_q1_and_q3_abstention_reconciliation(self):
        """Verifies explicit denominators for Q1 and Q3 abstention."""
        abst = self.ablation["abstention_reconciliation"]
        self.assertEqual(abst["gold_positive_total"], 57)
        self.assertEqual(abst["base_model_true_positives"], 38)

        # Q1 retains 38/38 base TP, captures 38/57 gold positives
        q1 = abst["q1_metrics"]
        self.assertEqual(q1["retained_base_true_positives"], 38)
        self.assertAlmostEqual(q1["retained_base_tp_ratio"], 1.0)
        self.assertAlmostEqual(q1["gold_positive_capture"], 38 / 57, places=4)
        self.assertIn("QUALIFIED", q1["zero_loss_statement_validity"])

        # Q3 captures 14/57 gold positives, precision 1.0
        q3 = abst["q3_metrics"]
        self.assertEqual(q3["same_event_captured"], 14)
        self.assertAlmostEqual(q3["gold_positive_capture"], 14 / 57, places=4)
        self.assertEqual(q3["precision"], 1.0)
        self.assertIn("LIMITED", q3["home_compression_assessment"])

    def test_model_selection_policy(self):
        """Verifies FALSE_MERGE_COST > FALSE_SPLIT_COST model selection logic."""
        sel = self.ablation["model_selection"]
        self.assertEqual(sel["selected_outcome"], "PF1_PREFERRED")
        self.assertEqual(sel["priority"], "FALSE_MERGE_COST > FALSE_SPLIT_COST")

        # PF1 has higher precision and lower false positive rates than PF0
        pf0 = self.ablation["models"]["PF0_LEXICAL_ONLY"]
        pf1 = self.ablation["models"]["PF1_LEXICAL_PLUS_QWEN"]
        self.assertGreater(pf1["precision"], pf0["precision"])
        self.assertLess(pf1["different_event_fpr"], pf0["different_event_fpr"])
        self.assertLess(pf1["related_topic_fpr"], pf0["related_topic_fpr"])
        self.assertGreater(pf1["pr_auc"], pf0["pr_auc"])


if __name__ == "__main__":
    unittest.main()
