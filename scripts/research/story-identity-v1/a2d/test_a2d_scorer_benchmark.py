import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH_DIR = HERE.parent
if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

from a2d.a2d_scorer_benchmark import (
    assert_baseline_parity,
    assert_inner_outer_disjoint,
    candidate_is_promotable,
    is_private_output_path,
    score_family_a,
    score_family_b,
    score_family_c,
    summarize_direct_fold_parameters,
    verify_frozen_artifact_hash,
    verify_frozen_split_metadata,
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


if __name__ == "__main__":
    unittest.main()
