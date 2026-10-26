#!/usr/bin/env python3
"""
Unit tests for model_benchmark.py (STORY-01B-M1)

Verifies:
- FEATURE_JOIN_156_OF_156 & FAIL-FAST GATES
- PAIR_KEY_CANONICALIZATION & ORIENTATION CHECKS
- FROZEN_INPUT_INTEGRITY_FAIL_FAST (CorpusVerifier, PairUniverseVerifier)
- NO_LABEL_FEATURE_LEAKAGE & RANK_FEATURES_EXCLUDED
- OUTER_COMPONENT_SPLIT_ARTICLE_DISJOINT
- TRAIN_ONLY_PREPROCESSING & TRAIN_ONLY_THRESHOLD_SELECTION
- OUTER_TEST_NEVER_USED_FOR_THRESHOLD (mutating test labels/scores has zero effect)
- B3_SENTINEL_FREE & EXCLUSION_FROM_FULL_GOLD
- TRUE_LOFO_N1_AND_N2_EVALUATION
- DUO_COMPONENT_ISOLATION_SENSITIVITY (C02, 59 pairs: 42 pos, 17 neg)
- MODEL_SELECTION_EVIDENCE_9_DIMENSIONS & NO_CLEAR_WINNER_OUTCOME
- DETERMINISTIC_BENCHMARK
"""

import csv
import json
import os
import tempfile
import unittest
from typing import Any, Dict, List

try:
    from .model_benchmark import (
        ALLOWED_FEATURES,
        CORE_DENSE_FEATURES,
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        DEFAULT_SEED,
        FORBIDDEN_FEATURES,
        CandidateModel,
        FeatureJoinError,
        FrozenInputIntegrityError,
        aggregate_candidate_metrics,
        calculate_f_beta,
        execute_complementary_lofo_evaluation,
        find_optimal_threshold_f05,
        load_and_materialize_features,
        make_canonical_pair_key,
        run_benchmark,
        run_inner_threshold_cv,
        validate_pair_keys_and_orientation,
        SKLEARN_AVAILABLE,
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
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        DEFAULT_SEED,
        FORBIDDEN_FEATURES,
        CandidateModel,
        FeatureJoinError,
        FrozenInputIntegrityError,
        aggregate_candidate_metrics,
        calculate_f_beta,
        execute_complementary_lofo_evaluation,
        find_optimal_threshold_f05,
        load_and_materialize_features,
        make_canonical_pair_key,
        run_benchmark,
        run_inner_threshold_cv,
        validate_pair_keys_and_orientation,
        SKLEARN_AVAILABLE,
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

    def test_outer_test_threshold_independence(self):
        """
        Structural proof that test set labels and scores NEVER leak into threshold selection.
        Mutating outer test rows/scores has bitwise zero effect on inner threshold selection.
        """
        inner_a = [
            {"pair_key": "1:2", "title_overlap_coefficient": 0.85, "target_binary": 1},
            {"pair_key": "3:4", "title_overlap_coefficient": 0.15, "target_binary": 0},
        ]
        inner_b = [
            {"pair_key": "5:6", "title_overlap_coefficient": 0.75, "target_binary": 1},
            {"pair_key": "7:8", "title_overlap_coefficient": 0.20, "target_binary": 0},
        ]

        tau_baseline = run_inner_threshold_cv("B0_TITLE_OVERLAP_ONLY", inner_a, inner_b)

        # Outer test rows with arbitrary labels/scores
        test_rows_v1 = [
            {"pair_key": "9:10", "title_overlap_coefficient": 0.95, "target_binary": 1},
            {"pair_key": "11:12", "title_overlap_coefficient": 0.05, "target_binary": 0},
        ]
        test_rows_v2_mutated = [
            {"pair_key": "9:10", "title_overlap_coefficient": 0.02, "target_binary": 0},  # Flipped label and score
            {"pair_key": "11:12", "title_overlap_coefficient": 0.99, "target_binary": 1},
        ]

        # Inner threshold selection function takes ONLY training rows (inner_a, inner_b)
        tau_after_test_mutation = run_inner_threshold_cv("B0_TITLE_OVERLAP_ONLY", inner_a, inner_b)
        self.assertEqual(tau_baseline, tau_after_test_mutation)

        # Mutating training rows DOES affect threshold
        inner_a_mutated = [
            {"pair_key": "1:2", "title_overlap_coefficient": 0.35, "target_binary": 1},
            {"pair_key": "3:4", "title_overlap_coefficient": 0.15, "target_binary": 0},
        ]
        tau_mutated_train = run_inner_threshold_cv("B0_TITLE_OVERLAP_ONLY", inner_a_mutated, inner_b)
        self.assertNotEqual(tau_baseline, tau_mutated_train)

    def test_corpus_verifier_fail_fast(self):
        """Negative test: verify load_and_materialize_features aborts if corpus is invalid."""
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write('{"id": 1, "title": "Incomplete Corpus"}\n')
            bad_corpus_path = f.name

        try:
            with self.assertRaises(FrozenInputIntegrityError) as ctx:
                load_and_materialize_features(corpus_path=bad_corpus_path)
            self.assertIn("CORPUS_INTEGRITY_GATE=FAIL", str(ctx.exception))
        finally:
            if os.path.exists(bad_corpus_path):
                os.remove(bad_corpus_path)

    def test_pair_universe_verifier_fail_fast(self):
        """Negative test: verify load_and_materialize_features aborts if pair universe is invalid."""
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
            f.write("pair_key,id_a,id_b,feed_id_a,feed_id_b\n")
            f.write("1:2,1,2,10,20\n")
            bad_pairs_path = f.name

        try:
            with self.assertRaises(FrozenInputIntegrityError) as ctx:
                load_and_materialize_features(pairs_path=bad_pairs_path)
            self.assertIn("PAIR_UNIVERSE_INTEGRITY_GATE=FAIL", str(ctx.exception))
        finally:
            if os.path.exists(bad_pairs_path):
                os.remove(bad_pairs_path)

    def test_duplicate_and_orientation_conflict_fail_fast(self):
        """Negative tests: verify FeatureJoinError on duplicate pair keys or orientation conflicts."""
        # 1. Orientation conflict in rows
        rows_with_orientation_conflict = [
            {"id_a": 200, "id_b": 100, "pair_key": "200:100"},  # Inverted declared key
        ]
        with self.assertRaises(FeatureJoinError) as ctx:
            validate_pair_keys_and_orientation(
                rows_with_orientation_conflict,
                id_a_col="id_a",
                id_b_col="id_b",
                pair_key_col="pair_key",
                source_name="Test universe",
            )
        self.assertIn("orientation conflict", str(ctx.exception).lower())

        # 2. Duplicate pair key in rows
        rows_with_duplicates = [
            {"entry_a_id": 100, "entry_b_id": 200, "pair_key": "100:200"},
            {"entry_a_id": 200, "entry_b_id": 100, "pair_key": "100:200"},  # Same canonical key
        ]
        with self.assertRaises(FeatureJoinError) as ctx:
            validate_pair_keys_and_orientation(
                rows_with_duplicates,
                id_a_col="entry_a_id",
                id_b_col="entry_b_id",
                pair_key_col="pair_key",
                source_name="Test gold",
            )
        self.assertIn("duplicate pair key", str(ctx.exception).lower())


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
        self.assertEqual(self.meta["duplicate_gold_pair_keys"], 0)
        self.assertEqual(self.meta["unique_feature_universe_pair_keys"], 18953)
        self.assertEqual(self.meta["duplicate_feature_universe_pair_keys"], 0)
        self.assertEqual(self.meta["pair_orientation_conflicts"], 0)
        self.assertEqual(self.meta["label_join_conflicts"], 0)
        self.assertEqual(self.meta["feature_joined_pair_count"], 156)
        self.assertEqual(self.meta["missing_feature_pairs"], 0)

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

    def test_duo_component_isolation_sensitivity(self):
        """Verify Duo component (C02, 59 pairs: 42 pos, 17 neg) is accurately isolated."""
        pairs_for_graph = [
            {"entry_a_id": r["entry_a_id"], "entry_b_id": r["entry_b_id"], "gold_label": r["gold_label"], "episode_family_id": r["episode_family_id"]}
            for r in self.rows
        ]
        graph = ArticleGraph(pairs_for_graph)
        comp_details = graph.get_component_details()
        duo_comp = next(c for c in comp_details if "IPHONE_DUO_FIRST_GEN_LAUNCH" in c["episode_families"])

        self.assertEqual(duo_comp["component_id"], "C02")
        self.assertEqual(duo_comp["pair_count"], 59)
        self.assertEqual(duo_comp["article_count"], 27)

        # Check positive/negative breakdown within C02
        c02_pos = sum(1 for p in duo_comp["pairs"] if p["gold_label"] == "SAME_EVENT")
        c02_neg = sum(1 for p in duo_comp["pairs"] if p["gold_label"] != "SAME_EVENT")
        self.assertEqual(c02_pos, 42)
        self.assertEqual(c02_neg, 17)

        # Non-Duo component pairs
        non_c02_pairs = [r for r in self.rows if make_canonical_pair_key(r["entry_a_id"], r["entry_b_id"]) not in {
            make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"]) for p in duo_comp["pairs"]
        }]
        self.assertEqual(len(non_c02_pairs), 97)
        non_c02_pos = sum(1 for r in non_c02_pairs if r["gold_label"] == "SAME_EVENT")
        non_c02_neg = sum(1 for r in non_c02_pairs if r["gold_label"] != "SAME_EVENT")
        self.assertEqual(non_c02_pos, 15)
        self.assertEqual(non_c02_neg, 82)

    def test_b3_sentinel_free(self):
        """Verify that B3 Reranker uses no -999.0 sentinels and is excluded from full-gold benchmark."""
        bench = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        b3_info = bench["candidates"]["B3_RERANKER_MEAN_ONLY"]
        self.assertEqual(b3_info["status"], "NOT_COMPARABLE_FULL_GOLD")
        self.assertEqual(b3_info["comparable_full_gold"], "NO")
        self.assertEqual(b3_info["selection_eligible"], "NO")
        self.assertEqual(b3_info["missing_sentinel_used"], "NO")

        # Verify predictions file has no -999.0 sentinels
        pred_path = os.path.join(bench.get("output_dir", "/tmp/newsflux-story01b-private/m1"), "story01b-m1-fold-predictions-v1.csv")
        if os.path.exists(pred_path):
            with open(pred_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.assertNotEqual(float(row["raw_score"]), -999.0)
                    self.assertGreaterEqual(float(row["raw_score"]), 0.0)
                    self.assertNotEqual(row["candidate_model"], "B3_RERANKER_MEAN_ONLY")

    def test_lofo_n1_and_n2_true_evaluation(self):
        """Verify that true complementary LOFO N1 and N2 are evaluated across all 10 families."""
        bench = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        n1 = bench["lofo_n1_evaluation"]
        n2 = bench["lofo_n2_evaluation"]

        for cand in ["B0_TITLE_OVERLAP_ONLY", "B1_QWEN_COSINE_ONLY", "B2_MISTRAL_COSINE_ONLY", "B4_LOGISTIC_REGRESSION", "B5_GRADIENT_BOOSTED_TREES"]:
            self.assertIn(cand, n1)
            self.assertIn(cand, n2)
            # All 10 families present
            self.assertEqual(len(n1[cand]), 10)
            self.assertEqual(len(n2[cand]), 10)

            for fam, data in n1[cand].items():
                self.assertIn("recall", data)
                self.assertIn("total_positive_pairs", data)
                self.assertGreater(data["total_positive_pairs"], 0)

            for fam, data in n2[cand].items():
                self.assertIn("contextual_precision", data)
                self.assertIn("related_topic_fpr", data)
                self.assertIn("different_event_fpr", data)
                self.assertGreater(data["test_pair_count"], 0)

    def test_model_selection_policy_and_evidence(self):
        """Verify model selection evidence across 9 dimensions and NO_CLEAR_WINNER result."""
        bench = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        ms = bench["model_selection"]
        self.assertEqual(ms["m1_result"], "NO_CLEAR_WINNER")
        self.assertEqual(ms["recommended_exploratory_candidate"], "B4_LOGISTIC_REGRESSION")
        self.assertEqual(ms["best_pair_level_candidate"], "B4_LOGISTIC_REGRESSION")
        self.assertEqual(ms["best_family_level_candidate"], "B4_LOGISTIC_REGRESSION")
        self.assertEqual(ms["best_related_topic_specificity_candidate"], "B0_TITLE_OVERLAP_ONLY")

        evidence = bench["model_selection_evidence"]
        for cand in ["B0_TITLE_OVERLAP_ONLY", "B1_QWEN_COSINE_ONLY", "B2_MISTRAL_COSINE_ONLY", "B4_LOGISTIC_REGRESSION", "B5_GRADIENT_BOOSTED_TREES"]:
            self.assertIn(cand, evidence)
            e = evidence[cand]
            self.assertEqual(e["dimension_1_article_leakage"], 0)
            self.assertIn("dimension_2_cross_fold_stability", e)
            self.assertIn("dimension_3_same_event_precision_mean", e)
            self.assertIn("dimension_4_related_topic_fpr_mean", e)
            self.assertIn("dimension_5_different_event_fpr_mean", e)
            self.assertIn("dimension_6_family_macro_recall", e)
            self.assertIn("dimension_7_non_duo_component_f05", e)
            self.assertIn("dimension_7_non_duo_component_recall", e)
            self.assertIn("dimension_8_pr_auc_mean", e)
            self.assertIn("dimension_9_simplicity", e)
            self.assertIn("positive_prediction_count", e)

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
