import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
RESEARCH_DIR = HERE.parent
if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

from a2d.a2d_scorer_benchmark import (
    assert_baseline_parity,
    assert_inner_outer_disjoint,
    candidate_is_promotable,
    build_per_fold_selection_audit,
    classify_limiting_factor,
    evaluate_qualified_home_shadow,
    is_private_output_path,
    post_hoc_parameter_transfer_diagnostic,
    score_family_a,
    score_family_b,
    score_family_c,
    summarize_direct_fold_parameters,
    verify_frozen_artifact_hash,
    verify_frozen_split_metadata,
    summarize_giant_component_diagnosis,
    summarize_parameter_stability,
    validate_targeted_gold_protocol,
    _decision,
    _p3_metrics,
)


class A2DSafetyAwareScorerTests(unittest.TestCase):
    def test_family_a_requires_semantic_and_lexical_confirmation(self):
        params = {"semantic_threshold": 0.70, "lexical_threshold": 0.30}
        self.assertTrue(score_family_a({"qwen_embedding_cosine": 0.70, "title_overlap_coefficient": 0.30}, params))
        self.assertFalse(score_family_a({"qwen_embedding_cosine": 0.69, "title_overlap_coefficient": 0.90}, params))
        self.assertFalse(score_family_a({"qwen_embedding_cosine": 0.90, "title_overlap_coefficient": 0.29}, params))

    def test_family_b_never_relaxes_the_frozen_p3_temporal_ceiling(self):
        params = {"semantic_threshold": 0.65, "max_delta_hours": 24}
        self.assertTrue(score_family_b({"qwen_embedding_cosine": 0.70, "published_delta_hours": 23.99}, params))
        self.assertFalse(score_family_b({"qwen_embedding_cosine": 0.70, "published_delta_hours": 24.01}, params))
        self.assertFalse(score_family_b({"qwen_embedding_cosine": 0.64, "published_delta_hours": 1}, params))

    def test_family_c_vetoes_semantic_only_matches_without_deterministic_corroboration(self):
        params = {"semantic_threshold": 0.60}
        semantic_only = {
            "qwen_embedding_cosine": 0.80,
            "title_overlap_coefficient": 0.10,
            "entity_anchor_overlap": 0.10,
            "number_overlap": 0.0,
            "date_overlap": 0.0,
        }
        corroborated = {**semantic_only, "entity_anchor_overlap": 0.25}
        self.assertFalse(score_family_c(semantic_only, params))
        self.assertTrue(score_family_c(corroborated, params))

    def test_gold_v2_sha_gate_rejects_changed_artifact(self):
        self.assertTrue(verify_frozen_artifact_hash("expected", "expected"))
        with self.assertRaisesRegex(AssertionError, "GOLD_V2_SHA_GATE"):
            verify_frozen_artifact_hash("changed", "expected")

    def test_oof_binary_edge_p3_gate_detects_transitive_hard_negative(self):
        rows = [
            {"pair_key": "1:2", "entry_a_id": "1", "entry_b_id": "2", "gold_label": "SAME_EVENT", "episode_family_id": "F1", "target_binary": 1},
            {"pair_key": "2:3", "entry_a_id": "2", "entry_b_id": "3", "gold_label": "SAME_EVENT", "episode_family_id": "F1", "target_binary": 1},
            {"pair_key": "1:3", "entry_a_id": "1", "entry_b_id": "3", "gold_label": "DIFFERENT_EVENT", "episode_family_id": "", "target_binary": 0},
        ]
        records = [
            {**row, "pred": 1, "score": 1.0, "selected_parameters": {}, "test_fold": 0}
            for row in rows
        ]
        result = _p3_metrics(records, rows, {1: 1000.0, 2: 1100.0, 3: 1200.0})
        self.assertEqual(result["cluster_hard_negative_contamination_count"], 1)
        self.assertEqual(result["different_event_cluster_contamination"], 1)

    def test_promotion_requires_oof_fixed_gold_and_observed_home_safety(self):
        safe = {
            "same_event_capture": 15,
            "cluster_hard_negative_contamination_count": 0,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }
        home = {"observed_home_hard_negative_merges": 0, "observed_home_false_family_merges": 0}
        self.assertTrue(candidate_is_promotable(safe, safe, home))
        self.assertFalse(candidate_is_promotable(safe, safe, {**home, "observed_home_hard_negative_merges": 1}))

    def test_frozen_split_metadata_rejects_drift_and_leakage(self):
        expected = {
            "strategy": "COMPONENT_GROUP_3FOLD",
            "fold_pair_counts": [190, 26, 17],
            "fold_assignment_sha256": "6a2526e9de76ee9f1fec6159a0b105ea35b5df48f637507fc443d465e313d75f",
            "article_leakage": "ZERO",
            "pair_leakage": "ZERO",
            "family_leakage": "ZERO",
        }
        self.assertTrue(verify_frozen_split_metadata(expected))
        with self.assertRaisesRegex(AssertionError, "FROZEN_FOLD"):
            verify_frozen_split_metadata({**expected, "fold_pair_counts": [189, 27, 17]})
        with self.assertRaisesRegex(AssertionError, "LEAKAGE"):
            verify_frozen_split_metadata({**expected, "article_leakage": "1"})

    def test_outer_test_pair_cannot_enter_inner_parameter_selection(self):
        inner = [{"pair_key": "1:2"}, {"pair_key": "3:4"}]
        outer = [{"pair_key": "5:6"}]
        self.assertTrue(assert_inner_outer_disjoint(inner, outer))
        with self.assertRaisesRegex(AssertionError, "OUTER_TEST_NOT_USED_FOR_TUNING"):
            assert_inner_outer_disjoint(inner, [{"pair_key": "3:4"}])

    def test_baseline_parity_is_exact_for_d0_d1_and_pf1_predictions(self):
        baseline = {
            "d0": {"oof_predictions": [{"pair_key": "1:2", "pred": 0, "score": 0.1}]},
            "d1": {"oof_predictions": [{"pair_key": "1:2", "pred": 1, "score": 0.8}]},
            "pf1": {"oof_predictions": [{"pair_key": "1:2", "pred": 0, "score": 0.2}]},
        }
        replay = {
            key: {"oof_predictions": [dict(row) for row in baseline[key]["oof_predictions"]]}
            for key in ("d0", "d1", "pf1")
        }
        self.assertTrue(assert_baseline_parity(baseline, replay))
        replay["d1"]["oof_predictions"][0]["pred"] = 0
        with self.assertRaisesRegex(AssertionError, "BASELINE_DRIFT"):
            assert_baseline_parity(baseline, replay)

    def test_direct_global_points_are_summarized_from_fold_training_parameters(self):
        folds = [
            {"semantic_threshold": 0.60, "lexical_threshold": 0.20},
            {"semantic_threshold": 0.70, "lexical_threshold": 0.30},
            {"semantic_threshold": 0.80, "lexical_threshold": 0.40},
        ]
        points = summarize_direct_fold_parameters(folds, {"semantic_threshold": "high", "lexical_threshold": "high"})
        self.assertEqual(points["STRICT"], {"semantic_threshold": 0.80, "lexical_threshold": 0.40})
        self.assertEqual(points["MEDIAN"], {"semantic_threshold": 0.70, "lexical_threshold": 0.30})
        self.assertEqual(points["PERMISSIVE"], {"semantic_threshold": 0.60, "lexical_threshold": 0.20})
        self.assertEqual(points["basis"], "OUTER_FOLD_TRAIN_DERIVED_PARAMETERS_NOT_FULL_GOLD_FIT")

    def test_zero_hard_negative_is_not_promotable_below_coverage_boundary(self):
        safe_but_sparse = {
            "same_event_capture": 14,
            "cluster_hard_negative_contamination_count": 0,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }
        self.assertFalse(candidate_is_promotable(safe_but_sparse))

    def test_hard_negative_is_never_promotable_even_with_useful_coverage(self):
        unsafe = {
            "same_event_capture": 20,
            "cluster_hard_negative_contamination_count": 1,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }
        self.assertFalse(candidate_is_promotable(unsafe))

    def test_private_output_gate_rejects_repository_paths(self):
        repo_root = HERE.parents[3]
        self.assertFalse(is_private_output_path(repo_root / "private-output.json", repo_root))
        self.assertTrue(is_private_output_path(Path("/tmp/a2d-output.json"), repo_root))

    def test_per_fold_selection_audit_separates_outer_train_and_test(self):
        fold_data = [
            {"fold_idx": 0, "rows": [
                {"pair_key": "1:2", "gold_label": "SAME_EVENT", "target_binary": 1, "episode_family_id": "F1"},
                {"pair_key": "2:3", "gold_label": "DIFFERENT_EVENT", "target_binary": 0, "episode_family_id": ""},
            ]},
            {"fold_idx": 1, "rows": [
                {"pair_key": "4:5", "gold_label": "SAME_EVENT", "target_binary": 1, "episode_family_id": "F2"},
                {"pair_key": "5:6", "gold_label": "RELATED_TOPIC", "target_binary": 0, "episode_family_id": ""},
            ]},
        ]
        candidate = {
            "class": "DIRECT_RULE",
            "outer_folds": [
                {"outer_fold": 0, "parameters_selected_on_outer_train_only": {"threshold": 0.7},
                 "inner_train_only_selection_metrics": {"same_event_capture": 1, "cluster_hard_negative_contamination_count": 0}},
                {"outer_fold": 1, "parameters_selected_on_outer_train_only": {"threshold": 0.8},
                 "inner_train_only_selection_metrics": {"same_event_capture": 1, "cluster_hard_negative_contamination_count": 0}},
            ],
            "oof_predictions": [
                {"pair_key": "1:2", "pred": 1, "test_fold": 0}, {"pair_key": "2:3", "pred": 0, "test_fold": 0},
                {"pair_key": "4:5", "pred": 1, "test_fold": 1}, {"pair_key": "5:6", "pred": 0, "test_fold": 1},
            ],
        }
        with patch("a2d.a2d_scorer_benchmark._p3_metrics", return_value={
            "same_event_capture": 1, "cluster_hard_negative_contamination_count": 0,
        }):
            audits = build_per_fold_selection_audit(candidate, fold_data, {})
        self.assertEqual(audits[0]["outer_train_pair_count"], 2)
        self.assertEqual(audits[0]["outer_train_same_count"], 1)
        self.assertEqual(audits[0]["outer_train_related_count"], 1)
        self.assertEqual(audits[0]["outer_train_different_count"], 0)
        self.assertEqual(audits[0]["outer_train_positive_family_count"], 1)
        self.assertEqual(audits[0]["selected_parameters"], {"threshold": 0.7})
        self.assertEqual(audits[0]["outer_test_pair_tp"], 1)
        self.assertEqual(audits[0]["outer_test_pair_fp"], 0)
        self.assertEqual(audits[0]["outer_test_pair_fn"], 0)

    def test_giant_component_diagnosis_reports_training_evidence(self):
        fold_data = [
            {"fold_idx": 0, "components": ["giant"], "rows": [
                {"gold_label": "SAME_EVENT"}, {"gold_label": "SAME_EVENT"}, {"gold_label": "DIFFERENT_EVENT"},
            ]},
            {"fold_idx": 1, "components": ["small"], "rows": [
                {"gold_label": "SAME_EVENT"}, {"gold_label": "RELATED_TOPIC"},
            ]},
        ]
        comp_map = {
            "giant": {"pairs": [{"gold_label": "SAME_EVENT"}, {"gold_label": "SAME_EVENT"}, {"gold_label": "DIFFERENT_EVENT"}]},
            "small": {"pairs": [{"gold_label": "SAME_EVENT"}, {"gold_label": "RELATED_TOPIC"}]},
        }
        result = summarize_giant_component_diagnosis(fold_data, comp_map)
        self.assertEqual(result["giant_component_outer_fold"], 0)
        self.assertEqual(result["giant_component_pair_count"], 3)
        self.assertEqual(result["giant_component_same_count"], 2)
        self.assertEqual(result["train_size_when_giant_component_is_test"], 2)
        self.assertEqual(result["train_same_count_when_giant_component_is_test"], 1)
        self.assertEqual(result["train_hard_negative_count_when_giant_component_is_test"], 1)

    def test_parameter_stability_uses_preregistered_grid_steps(self):
        parameters = [
            {"semantic_threshold": 0.625, "lexical_threshold": 0.30},
            {"semantic_threshold": 0.625, "lexical_threshold": 0.35},
            {"semantic_threshold": 0.625, "lexical_threshold": 0.35},
        ]
        grids = {
            "semantic_threshold": [0.625, 0.65, 0.675],
            "lexical_threshold": [0.25, 0.30, 0.35, 0.40],
        }
        result = summarize_parameter_stability(parameters, grids)
        self.assertEqual(result["classification"], "MODERATELY_UNSTABLE")
        self.assertEqual(result["parameter_range"]["lexical_threshold"], [0.30, 0.35])
        self.assertEqual(result["parameter_median"]["lexical_threshold"], 0.35)

    def test_post_hoc_parameter_transfer_is_marked_diagnostic_only(self):
        folds = [
            {"fold_idx": 0, "rows": [{"pair_key": "1:2", "entry_a_id": "1", "entry_b_id": "2", "target_binary": 1, "gold_label": "SAME_EVENT", "episode_family_id": "F1", "qwen_embedding_cosine": 0.8, "title_overlap_coefficient": 0.4}]},
            {"fold_idx": 1, "rows": [{"pair_key": "3:4", "entry_a_id": "3", "entry_b_id": "4", "target_binary": 0, "gold_label": "DIFFERENT_EVENT", "episode_family_id": "", "qwen_embedding_cosine": 0.7, "title_overlap_coefficient": 0.3}]},
        ]
        candidate = {"outer_folds": [
            {"parameters_selected_on_outer_train_only": {"semantic_threshold": 0.6, "lexical_threshold": 0.2}},
            {"parameters_selected_on_outer_train_only": {"semantic_threshold": 0.7, "lexical_threshold": 0.3}},
        ]}
        with patch("a2d.a2d_scorer_benchmark._p3_metrics", return_value={
            "same_event_capture": 1, "cluster_hard_negative_contamination_count": 0,
        }):
            transfer = post_hoc_parameter_transfer_diagnostic(
                candidate, folds, {}, score_family_a,
            )
        self.assertEqual(transfer["label"], "POST_HOC_PARAMETER_TRANSFER_DIAGNOSTIC_ONLY")
        self.assertEqual(len(transfer["matrix"]), 4)
        self.assertEqual(transfer["matrix"][0]["train_derived_parameter_fold"], 0)
        self.assertEqual(transfer["matrix"][0]["evaluation_fold"], 0)

    def test_decision_uses_explicit_stability_diagnosis_not_any_oof_hard_negative(self):
        candidates = {"A": {"class": "DIRECT_RULE"}}
        summaries = {"A": {"oof_p3": {
            "same_event_capture": 20,
            "cluster_hard_negative_contamination_count": 1,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }, "pair_f05": 0.4}}
        fixed_points = {"A": {"STRICT": {"gold_fixed_point_p3": {
            "same_event_capture": 20, "cluster_hard_negative_contamination_count": 0,
            "false_family_merge_count": 0, "cross_family_cluster_count": 0,
        }}}}
        diagnosis = {"classification": "MIXED_THRESHOLD_AND_GOLD_LIMIT", "evidence": ["fold-specific audit"]}
        result = _decision(candidates, summaries, fixed_points, {}, diagnosis)
        self.assertEqual(result["provider_candidate_found"], "NO")
        self.assertEqual(result["limiting_factor"], "MIXED_THRESHOLD_AND_GOLD_LIMIT")
        self.assertNotEqual(result["limiting_factor"], "FEATURE_SEPARABILITY_LIMIT")

    def test_decision_without_supported_diagnosis_holds_and_uses_allowed_next_track(self):
        summaries = {"A": {"oof_p3": {
            "same_event_capture": 20,
            "cluster_hard_negative_contamination_count": 1,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }, "pair_f05": 0.4}}
        result = _decision({"A": {"class": "DIRECT_RULE"}}, summaries, {}, {})
        self.assertEqual(result["limiting_factor"], "OTHER")
        self.assertEqual(result["next_recommended_track"], "HOLD_FOR_PM")
        self.assertIn(result["next_recommended_track"], {
            "STORY_02_A2D2_TARGETED_GOLD_DESIGN",
            "MORE_SCORER_RESEARCH",
            "MORE_POSITIVE_GOLD_REQUIRED",
            "HOLD_FOR_PM",
        })

    def test_feature_separability_recommendation_uses_approved_track_name(self):
        summaries = {"A": {"oof_p3": {
            "same_event_capture": 20,
            "cluster_hard_negative_contamination_count": 1,
            "false_family_merge_count": 0,
            "cross_family_cluster_count": 0,
        }, "pair_f05": 0.4}}
        diagnosis = {"classification": "FEATURE_SEPARABILITY_LIMIT", "why": "supported fixture"}
        result = _decision({"A": {"class": "DIRECT_RULE"}}, summaries, {}, {}, diagnosis)
        self.assertEqual(result["next_recommended_track"], "STORY_02_A2D2_TARGETED_GOLD_DESIGN")

    def test_limiting_factor_requires_transfer_and_component_coverage_evidence(self):
        per_fold = {"A": [
            {"outer_fold": 0, "outer_test_p3_hard_negatives": 1},
            {"outer_fold": 1, "outer_test_p3_hard_negatives": 0},
        ]}
        transfer = {"A": {"matrix": [
            {"train_derived_parameter_fold": 1, "evaluation_fold": 0, "same_capture": 20, "hard_negatives": 0},
        ]}}
        giant = {
            "giant_component_outer_fold": 0,
            "giant_component_same_count": 51,
            "train_same_count_when_giant_component_is_test": 6,
        }
        result = classify_limiting_factor(per_fold, transfer, giant)
        self.assertEqual(result["classification"], "MIXED_THRESHOLD_AND_GOLD_LIMIT")
        self.assertTrue(result["safe_transfer_to_unsafe_fold"])
        self.assertTrue(result["giant_positive_concentration"])
        result_without_transfer = classify_limiting_factor(per_fold, {"A": {"matrix": []}}, giant)
        self.assertEqual(result_without_transfer["classification"], "OTHER")

    def test_targeted_gold_protocol_forbids_dev_blind_reuse(self):
        accepted = validate_targeted_gold_protocol(
            dev_article_ids={1, 2}, blind_article_ids={3, 4},
            dev_pair_keys={"1:2"}, blind_pair_keys={"3:4"},
        )
        self.assertEqual(accepted["article_overlap"], 0)
        self.assertEqual(accepted["pair_overlap"], 0)
        self.assertEqual(accepted["tuning_evaluation_reuse"], "NO")
        with self.assertRaisesRegex(ValueError, "ARTICLE_DISJOINT"):
            validate_targeted_gold_protocol(
                dev_article_ids={1, 2}, blind_article_ids={2, 3},
                dev_pair_keys={"1:2"}, blind_pair_keys={"2:3"},
            )
        with self.assertRaisesRegex(ValueError, "PAIR_DISJOINT"):
            validate_targeted_gold_protocol(
                dev_article_ids={1, 2}, blind_article_ids={3, 4},
                dev_pair_keys={"shared-pair"}, blind_pair_keys={"shared-pair"},
            )

    def test_qualified_home_shadow_path_uses_fixed_point_parameters(self):
        oof = {"same_event_capture": 15, "cluster_hard_negative_contamination_count": 0,
               "false_family_merge_count": 0, "cross_family_cluster_count": 0}
        point = {"parameters": {"semantic_threshold": 0.7}, "gold_fixed_point_p3": dict(oof)}
        observed = {"observed_home_hard_negative_merges": 0,
                    "observed_home_false_family_merges": 0, "observed_home_cross_family_clusters": 0}
        runner = unittest.mock.Mock(return_value=observed)
        result = evaluate_qualified_home_shadow(oof, point, runner, "fixture")
        self.assertEqual(result, observed)
        runner.assert_called_once_with({"semantic_threshold": 0.7}, "fixture")
        self.assertIsNone(evaluate_qualified_home_shadow(
            {**oof, "cluster_hard_negative_contamination_count": 1}, point, runner, "fixture"
        ))


if __name__ == "__main__":
    unittest.main()
