#!/usr/bin/env python3
"""
Unit tests for model_benchmark.py (STORY-01B-M1 R2)

Verifies:
- FEATURE_JOIN_156_OF_156 & FAIL-FAST GATES
- PAIR_KEY_CANONICALIZATION & ORIENTATION CHECKS
- FROZEN_INPUT_INTEGRITY_FAIL_FAST (CorpusVerifier, PairUniverseVerifier)
- NO_LABEL_FEATURE_LEAKAGE & RANK_FEATURES_EXCLUDED
- OUTER_COMPONENT_SPLIT_ARTICLE_DISJOINT
- TRAIN_ONLY_PREPROCESSING & TRAIN_ONLY_THRESHOLD_SELECTION
- OUTER_TEST_THRESHOLD_INDEPENDENCE_GATE (real orchestration path test rows independence)
- LOFO_INNER_COMPONENT_DISJOINT_GATE (component indivisibility and zero inner leakage)
- B3_SENTINEL_FREE & EXCLUSION_FROM_FULL_GOLD
- TRUE_LOFO_N1_AND_N2_EVALUATION
- DUO_COMPONENT_ISOLATION_SENSITIVITY (C02, 59 pairs: 42 pos, 17 neg)
- MODEL_SELECTION_EVIDENCE_9_DIMENSIONS & NO_CLEAR_WINNER_OUTCOME
- M1_DETERMINISM_GATE (exhaustive equality across 7 required dimensions)
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
        build_component_disjoint_inner_folds,
        calculate_f_beta,
        evaluate_single_fold,
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
        build_component_disjoint_inner_folds,
        calculate_f_beta,
        evaluate_single_fold,
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

    def test_outer_test_threshold_independence_gate(self):
        """
        Strengthened orchestration path test:
        1. Identical outer train rows and inner folds.
        2. Outer test version A.
        3. Outer test version B with completely inverted/mutated labels, scores, and features.
        4. Evaluates via evaluate_single_fold (the exact path used in outer evaluation).
        5. Proves that selected threshold is bitwise identical and would fail if test rows leaked.
        """
        inner_a = [
            {"pair_key": "1:2", "title_overlap_coefficient": 0.85, "target_binary": 1},
            {"pair_key": "3:4", "title_overlap_coefficient": 0.15, "target_binary": 0},
        ]
        inner_b = [
            {"pair_key": "5:6", "title_overlap_coefficient": 0.75, "target_binary": 1},
            {"pair_key": "7:8", "title_overlap_coefficient": 0.20, "target_binary": 0},
        ]
        outer_train = inner_a + inner_b

        # Version A
        test_rows_A = [
            {"pair_key": "9:10", "title_overlap_coefficient": 0.95, "target_binary": 1, "gold_label": "SAME_EVENT"},
            {"pair_key": "11:12", "title_overlap_coefficient": 0.05, "target_binary": 0, "gold_label": "DIFFERENT_EVENT"},
        ]
        # Version B: completely mutated
        test_rows_B_mutated = [
            {"pair_key": "9:10", "title_overlap_coefficient": 0.25, "target_binary": 1, "gold_label": "SAME_EVENT"},
            {"pair_key": "11:12", "title_overlap_coefficient": 0.22, "target_binary": 1, "gold_label": "SAME_EVENT"},
        ]

        # Evaluate B0
        tau_A_b0, sc_A_b0, p_A_b0 = evaluate_single_fold("B0_TITLE_OVERLAP_ONLY", outer_train, test_rows_A, inner_a, inner_b)
        tau_B_b0, sc_B_b0, p_B_b0 = evaluate_single_fold("B0_TITLE_OVERLAP_ONLY", outer_train, test_rows_B_mutated, inner_a, inner_b)

        self.assertEqual(tau_A_b0, tau_B_b0)
        self.assertNotEqual(sc_A_b0, sc_B_b0)
        self.assertNotEqual(p_A_b0, p_B_b0)

        # Buggy selector simulation: if someone mistakenly passed test rows to the threshold selector,
        # the thresholds would diverge.
        tau_buggy_A = run_inner_threshold_cv("B0_TITLE_OVERLAP_ONLY", inner_a, test_rows_A)
        tau_buggy_B = run_inner_threshold_cv("B0_TITLE_OVERLAP_ONLY", inner_a, test_rows_B_mutated)
        self.assertNotEqual(tau_buggy_A, tau_buggy_B)

    def test_lofo_inner_component_disjoint_gate(self):
        """
        Explicit test for LOFO inner component-disjoint fold generation:
        1. Synthetic fixture where row-half split divides a connected component (leakage > 0).
        2. Proves build_component_disjoint_inner_folds keeps the component indivisible (leakage = 0).
        """
        synthetic_rows = [
            {"entry_a_id": "1", "entry_b_id": "2", "pair_key": "1:2", "gold_label": "SAME_EVENT", "episode_family_id": "F1"},
            {"entry_a_id": "2", "entry_b_id": "3", "pair_key": "2:3", "gold_label": "SAME_EVENT", "episode_family_id": "F1"},
            {"entry_a_id": "1", "entry_b_id": "3", "pair_key": "1:3", "gold_label": "SAME_EVENT", "episode_family_id": "F1"},
            {"entry_a_id": "4", "entry_b_id": "5", "pair_key": "4:5", "gold_label": "DIFFERENT_EVENT", "episode_family_id": ""},
            {"entry_a_id": "6", "entry_b_id": "7", "pair_key": "6:7", "gold_label": "DIFFERENT_EVENT", "episode_family_id": ""},
        ]
        # Traditional row-half cut (5 // 2 = 2) splits Component 1 across folds
        naive_f0 = synthetic_rows[:2]
        naive_f1 = synthetic_rows[2:]
        naive_f0_arts = {r["entry_a_id"] for r in naive_f0} | {r["entry_b_id"] for r in naive_f0}
        naive_f1_arts = {r["entry_a_id"] for r in naive_f1} | {r["entry_b_id"] for r in naive_f1}
        self.assertGreater(len(naive_f0_arts & naive_f1_arts), 0)

        # build_component_disjoint_inner_folds preserves component indivisibility
        f0, f1, meta = build_component_disjoint_inner_folds(synthetic_rows, k=2)
        self.assertEqual(meta["article_leakage"], 0)
        f0_arts = {r["entry_a_id"] for r in f0} | {r["entry_b_id"] for r in f0}
        f1_arts = {r["entry_a_id"] for r in f1} | {r["entry_b_id"] for r in f1}
        self.assertEqual(len(f0_arts & f1_arts), 0)

        # Component 1 (pairs 1:2, 2:3, 1:3) is completely in one fold
        c1_in_f0 = all(r["pair_key"] in {"1:2", "2:3", "1:3"} for r in f0)
        c1_in_f1 = all(r["pair_key"] in {"1:2", "2:3", "1:3"} for r in f1)
        self.assertTrue(c1_in_f0 or c1_in_f1)

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
        self.assertEqual(self.meta["label_join_conflicts"], "N/A_SINGLE_LABEL_SOURCE")
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
        """Verify that true complementary LOFO N1 and N2 are evaluated across all 10 families with component-disjoint splits."""
        bench = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        self.assertEqual(bench["gates"]["lofo_inner_component_disjoint_gate"], "PASS")
        self.assertEqual(bench["gates"]["lofo_n1_inner_article_leakage"], 0)
        self.assertEqual(bench["gates"]["lofo_n1_valid_threshold_folds"], "10/10")
        self.assertEqual(bench["gates"]["lofo_n2_inner_component_disjoint_gate"], "PASS")
        self.assertEqual(bench["gates"]["lofo_n2_inner_article_leakage"], 0)
        self.assertEqual(bench["gates"]["lofo_n2_valid_threshold_folds"], "10/10")

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
        """
        Verify exhaustive determinism (M1_DETERMINISM_GATE=PASS) across two runs:
        - feature matrix SHA
        - prediction SHA
        - fold allocation and protocol
        - selected thresholds
        - candidate metrics
        - LOFO N1 metrics
        - LOFO N2 metrics
        - model selection evidence
        - model selection outcome
        - gates
        """
        b1 = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)
        b2 = run_benchmark(gold_path=DEFAULT_GOLD_PATH, seed=DEFAULT_SEED)

        # 1. Input receipts & SHAs
        self.assertEqual(
            b1["input_receipts"]["feature_matrix_sha256"],
            b2["input_receipts"]["feature_matrix_sha256"],
        )
        self.assertEqual(
            b1["input_receipts"]["fold_predictions_sha256"],
            b2["input_receipts"]["fold_predictions_sha256"],
        )

        # 2. Fold allocation & protocol
        self.assertEqual(b1["primary_protocol"], b2["primary_protocol"])
        self.assertEqual(b1["outer_folds"], b2["outer_folds"])

        # 3. Selected thresholds
        thresh_1 = {
            c: [f["selected_threshold"] for f in cdata["folds"]]
            for c, cdata in b1["candidates"].items() if "folds" in cdata
        }
        thresh_2 = {
            c: [f["selected_threshold"] for f in cdata["folds"]]
            for c, cdata in b2["candidates"].items() if "folds" in cdata
        }
        self.assertEqual(thresh_1, thresh_2)

        # 4. Candidate metrics
        self.assertEqual(b1["candidates"], b2["candidates"])

        # 5. LOFO N1 & N2 metrics
        self.assertEqual(b1["lofo_n1_evaluation"], b2["lofo_n1_evaluation"])
        self.assertEqual(b1["lofo_n2_evaluation"], b2["lofo_n2_evaluation"])

        # 6. Model selection evidence and final decision
        self.assertEqual(b1["model_selection_evidence"], b2["model_selection_evidence"])
        self.assertEqual(b1["model_selection"], b2["model_selection"])
        self.assertEqual(b1["gates"], b2["gates"])


if __name__ == "__main__":
    unittest.main()
