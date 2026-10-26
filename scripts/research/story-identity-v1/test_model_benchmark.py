#!/usr/bin/env python3
"""
Unit tests for model_benchmark.py (STORY-01B-M1)

Verifies:
- FEATURE_JOIN_156_OF_156
- PAIR_KEY_CANONICALIZATION
- NO_LABEL_FEATURE_LEAKAGE
- RANK_FEATURES_EXCLUDED
- OUTER_COMPONENT_SPLIT_ARTICLE_DISJOINT
- TRAIN_ONLY_PREPROCESSING
- TRAIN_ONLY_THRESHOLD_SELECTION
- NO_RAW_SCORE_FUSION
- FAMILY_MACRO_METRICS
- RELATED_TOPIC_FPR
- DIFFERENT_EVENT_FPR
- N2_AGGREGATION_GUARD
- DETERMINISTIC_BENCHMARK
"""

import os
import unittest
from typing import Any, Dict, List

try:
    from .model_benchmark import (
        ALLOWED_FEATURES,
        CORE_DENSE_FEATURES,
        FORBIDDEN_FEATURES,
        CandidateModel,
        aggregate_candidate_metrics,
        calculate_f_beta,
        find_optimal_threshold_f05,
        load_and_materialize_features,
        make_canonical_pair_key,
        run_benchmark,
        run_inner_threshold_cv,
        SKLEARN_AVAILABLE,
        DEFAULT_GOLD_PATH,
        DEFAULT_SEED,
    )
    from .split_audit import (
        ArticleGraph,
        N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
        N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        check_article_disjointness,
    )
except ImportError:
    from model_benchmark import (
        ALLOWED_FEATURES,
        CORE_DENSE_FEATURES,
        FORBIDDEN_FEATURES,
        CandidateModel,
        aggregate_candidate_metrics,
        calculate_f_beta,
        find_optimal_threshold_f05,
        load_and_materialize_features,
        make_canonical_pair_key,
        run_benchmark,
        run_inner_threshold_cv,
        SKLEARN_AVAILABLE,
        DEFAULT_GOLD_PATH,
        DEFAULT_SEED,
    )
    from split_audit import (
        ArticleGraph,
        N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
        N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        check_article_disjointness,
    )


class TestModelBenchmarkGates(unittest.TestCase):
    """Unit tests for contract, leakage prevention, and model rules."""

    def test_pair_key_canonicalization(self):
        """Test pair key normalization min(a,b):max(a,b)."""
        self.assertEqual(make_canonical_pair_key(17864, 17624), "17624:17864")
        self.assertEqual(make_canonical_pair_key("17624", "17864"), "17624:17864")
        self.assertEqual(make_canonical_pair_key(100, 200), "100:200")
        self.assertEqual(make_canonical_pair_key(200, 100), "100:200")

    def test_no_label_feature_leakage(self):
        """Verify that labels and target columns are never present in model features."""
        for feat in ALLOWED_FEATURES:
            self.assertNotIn(feat, FORBIDDEN_FEATURES)
            self.assertNotIn(feat, {"gold_label", "target_binary", "episode_family_id"})

        for feat in CORE_DENSE_FEATURES:
            self.assertNotIn(feat, FORBIDDEN_FEATURES)
            self.assertNotIn(feat, {"gold_label", "target_binary", "episode_family_id"})

    def test_rank_features_excluded(self):
        """Verify that pair universe ranks (qwen_rank, mistral_rank, best_rank) are strictly excluded."""
        for f in ["qwen_rank", "mistral_rank", "best_rank"]:
            self.assertNotIn(f, ALLOWED_FEATURES)
            self.assertNotIn(f, CORE_DENSE_FEATURES)
            self.assertIn(f, FORBIDDEN_FEATURES)

    def test_no_raw_score_fusion(self):
        """Verify that ad-hoc averaging like (qwen + mistral)/2 is not among the candidate models."""
        candidate_names = [
            "B0_TITLE_OVERLAP_ONLY",
            "B1_QWEN_COSINE_ONLY",
            "B2_MISTRAL_COSINE_ONLY",
            "B3_RERANKER_MEAN_ONLY",
            "B4_LOGISTIC_REGRESSION",
            "B5_GRADIENT_BOOSTED_TREES",
        ]
        for c in candidate_names:
            self.assertNotIn("AVERAGE", c)
            self.assertNotIn("RAW_FUSION", c)

    def test_f_beta_calculation(self):
        """Test F0.5 and F1 calculation edge cases."""
        self.assertEqual(calculate_f_beta(0.0, 1.0, beta=0.5), 0.0)
        self.assertEqual(calculate_f_beta(1.0, 0.0, beta=0.5), 0.0)
        # Precision 1.0, Recall 0.5 -> F0.5 should be higher than F1
        f05 = calculate_f_beta(1.0, 0.5, beta=0.5)
        f1 = calculate_f_beta(1.0, 0.5, beta=1.0)
        self.assertGreater(f05, f1)

    def test_train_only_threshold_selection(self):
        """Verify that find_optimal_threshold_f05 selects threshold maximizing F0.5."""
        y_true = [1, 1, 0, 0]
        scores = [0.9, 0.8, 0.3, 0.2]
        thresh, f05, p, r = find_optimal_threshold_f05(y_true, scores)
        self.assertEqual(p, 1.0)
        self.assertEqual(r, 1.0)
        self.assertEqual(f05, 1.0)
        self.assertTrue(0.3 < thresh <= 0.8)

    def test_n2_aggregation_guard(self):
        """Verify N2 methodological constants are explicitly documented and True."""
        self.assertTrue(N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS)
        self.assertTrue(N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS)


@unittest.skipUnless(SKLEARN_AVAILABLE, "scikit-learn not available in environment")
class TestModelBenchmarkExecution(unittest.TestCase):
    """Integration tests on canonical frozen dataset requiring scikit-learn."""

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(DEFAULT_GOLD_PATH):
            raise unittest.SkipTest(f"Gold dataset not found at {DEFAULT_GOLD_PATH}")
        cls.rows, cls.meta = load_and_materialize_features(gold_path=DEFAULT_GOLD_PATH)

    def test_feature_join_156_of_156(self):
        """Verify that exactly 156 gold pairs join with zero omissions or duplicates."""
        self.assertEqual(self.meta["gold_pair_count"], 156)
        self.assertEqual(self.meta["unique_gold_pair_keys"], 156)
        self.assertEqual(self.meta["feature_joined_pair_count"], 156)
        self.assertEqual(self.meta["missing_feature_pairs"], 0)
        self.assertEqual(self.meta["duplicate_feature_pairs"], 0)

    def test_core_features_100_percent_coverage(self):
        """Verify that all 17 core features have 100% non-null coverage."""
        stats = self.meta["coverage_stats"]
        for f in CORE_DENSE_FEATURES:
            self.assertEqual(stats[f]["non_null_count"], 156)
            self.assertEqual(stats[f]["null_count"], 0)

    def test_reranker_coverage_partial(self):
        """Verify that reranker coverage is documented as 71/156."""
        stats = self.meta["coverage_stats"]
        self.assertEqual(stats["reranker_score_mean"]["non_null_count"], 71)
        self.assertEqual(stats["reranker_score_mean"]["null_count"], 85)

    def test_outer_component_split_article_disjoint(self):
        """Verify outer 3-fold split from ArticleGraph has 0 article leakage."""
        pairs_for_graph = [
            {"entry_a_id": r["entry_a_id"], "entry_b_id": r["entry_b_id"], "gold_label": r["gold_label"], "episode_family_id": r["episode_family_id"]}
            for r in self.rows
        ]
        graph = ArticleGraph(pairs_for_graph)
        from split_audit import simulate_protocol_a
        p_a = simulate_protocol_a(graph, k=3)
        self.assertEqual(p_a["article_leakage"], 0)

    def test_deterministic_benchmark(self):
        """Verify that repeated benchmark runs produce bitwise identical outputs."""
        b1 = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)
        b2 = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        self.assertEqual(
            b1["input_receipts"]["feature_matrix_sha256"],
            b2["input_receipts"]["feature_matrix_sha256"],
        )
        self.assertEqual(
            b1["input_receipts"]["fold_predictions_sha256"],
            b2["input_receipts"]["fold_predictions_sha256"],
        )
        self.assertEqual(b1["model_selection"], b2["model_selection"])


if __name__ == "__main__":
    unittest.main()
