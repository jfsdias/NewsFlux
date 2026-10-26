#!/usr/bin/env python3
"""Unit tests for STORY-02-A2C Gold V2 Benchmark and Audit."""

import unittest
from pathlib import Path
import sys
import copy
import json
import tempfile
import subprocess
from collections import Counter
from unittest.mock import patch

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

import gold_v2_benchmark as benchmark

from gold_v2_benchmark import (
    verify_input_artifacts,
    load_gold_v2_materialized,
    run_gold_v2_benchmark,
    EXPECTED_GOLD_V2_SHA256,
)


class TestGoldV2Benchmark(unittest.TestCase):
    """Tests Gold V2 integrity, split feasibility, and benchmark executions."""

    def test_01_verify_input_artifacts(self):
        res = verify_input_artifacts()
        self.assertEqual(res["human_label_count"], 77)
        self.assertEqual(res["decision_source_gate"], "PASS")
        self.assertEqual(res["human_labels"]["gate"], "PASS")
        self.assertEqual(res["annotation_pack"]["gate"], "PASS")
        self.assertEqual(res["sidecar"]["gate"], "PASS")
        self.assertEqual(res["gold_v1"]["gate"], "PASS")
        self.assertEqual(res["home_200"]["gate"], "PASS")

    def test_02_load_gold_v2_materialized(self):
        rows, meta = load_gold_v2_materialized()
        self.assertEqual(len(rows), 233)
        self.assertEqual(meta["gold_v2_sha256"], EXPECTED_GOLD_V2_SHA256)
        self.assertEqual(meta["unique_articles"], 153)

        # Class counts
        counts = {}
        for r in rows:
            lbl = r["gold_label"]
            counts[lbl] = counts.get(lbl, 0) + 1

        self.assertEqual(counts["SAME_EVENT"], 57)
        self.assertEqual(counts["RELATED_TOPIC"], 27)
        self.assertEqual(counts["DIFFERENT_EVENT"], 149)

    def test_03_benchmark_invariants_and_leak_free(self):
        results = run_gold_v2_benchmark()
        self.assertEqual(results["research_version"], "STORY_02_A2C_R1")
        self.assertEqual(results["split"]["article_leakage"], "ZERO")
        self.assertEqual(results["split"]["pair_leakage"], "ZERO")
        self.assertEqual(results["split"]["family_leakage"], "ZERO")
        self.assertEqual(results["split"]["fold_pair_counts"], [190, 26, 17])
        self.assertEqual(results["split"]["fold_assignment_sha256"], "6a2526e9de76ee9f1fec6159a0b105ea35b5df48f637507fc443d465e313d75f")

        # Invariant: Duo share is ~73.7%
        same_rows = [p for p in results["d0"]["oof_predictions"] if p["gold_label"] == "SAME_EVENT"]
        self.assertEqual(len(same_rows), 57)

        # Scorer results non-null
        self.assertGreater(results["d0"]["pr_auc"], 0.8)
        self.assertGreater(results["d1"]["pr_auc"], 0.9)
        self.assertGreater(results["pf1"]["pr_auc"], 0.85)

        # Pooled OOF decisions use each held-out fold's inner-train threshold,
        # whereas P3 frontiers use one stated fixed research threshold.
        for scorer in ("d0", "d1"):
            res = results[scorer]
            self.assertEqual(res["oof_threshold_strategy"], "INNER_TRAIN_ONLY_PER_OUTER_FOLD")
            self.assertEqual(res["oof_metrics_basis"], "POOLED_FOLD_SPECIFIC_BINARY_DECISIONS")
            self.assertEqual(res["threshold_summary"]["max"], res["research_operating_points"]["STRICT"])
            fold_thresholds = {f["fold_idx"]: f["selected_threshold"] for f in res["outer_folds"]}
            for pred in res["oof_predictions"]:
                self.assertAlmostEqual(pred["selected_threshold"], fold_thresholds[pred["test_fold"]], places=4)
            frontier = results[scorer + "_safety"]["operating_points"]
            self.assertEqual(set(frontier), {"STRICT", "MEDIAN", "PERMISSIVE"})
            for name, metrics in frontier.items():
                self.assertEqual(metrics["threshold"], res["research_operating_points"][name])
                self.assertEqual(metrics["same_event_capture_rate"], round(metrics["same_event_capture"] / 57, 4))
                self.assertIn("family_macro_recall", metrics)
                self.assertIn("non_duo_pair_recall", metrics)
                home = results[scorer + "_home_frontier"][name]
                self.assertEqual(home["stats"]["home_items_before"], 200)
                self.assertEqual(home["observation"]["gold_pairs_with_both_articles_present"], 233)
                self.assertIn("top20_story_card_count", home["stats"])
                self.assertIn("top50_story_card_count", home["stats"])

        self.assertEqual(results["d0_safety"]["operating_points"]["STRICT"]["same_event_capture"], 4)
        self.assertEqual(results["d0_safety"]["operating_points"]["STRICT"]["safety_classification"], "TOO_LOW_COVERAGE")
        self.assertEqual(results["d1_safety"]["operating_points"]["STRICT"]["same_event_capture"], 19)
        self.assertEqual(results["original_a2c_baseline"]["pf1_reported"]["same_event_capture"], 14)
        self.assertEqual(results["pf1_safety"]["cluster_evaluation"], "OOF_BINARY_EDGE_P3")
        reproduced = benchmark.evaluate_pf1_oof_cluster_safety(
            results["pf1"]["oof_predictions"], benchmark.load_gold_v2_materialized()[0],
            results["published_lookup"],
        )
        self.assertEqual(results["pf1_safety"], reproduced)
        self.assertEqual(reproduced["same_event_capture"], 13)
        self.assertEqual(reproduced["related_topic_cluster_contamination"], 2)
        self.assertEqual(reproduced["different_event_cluster_contamination"], 1)
        self.assertEqual(reproduced["false_family_merge_count"], 0)
        self.assertEqual(reproduced["cross_family_cluster_count"], 0)
        self.assertEqual(Counter(reproduced["family_fragmentation_breakdown"].values()), {1: 7, 2: 1, 3: 1, 10: 1})
        self.assertEqual(results["pf1_fit_audit"]["full_gold_final_fit"], "NO")
        self.assertEqual(results["pf1_fit_audit"]["production_model_artifact"], "NO")
        self.assertTrue(all(f["n_train"] < 233 for f in results["pf1_fit_audit"]["fit_calls"]))
        self.assertEqual(len(results["frontier"]), 6)
        self.assertEqual(results["decision"]["scoreprovider_selection"], "DEFERRED_NO_CLEAR_WINNER")
        self.assertEqual(results["decision"]["lightweight_model_artifact_decision_required"], "DEFERRED")
        self.assertEqual(results["decision"]["next_recommended_track"], "MORE_SCORER_RESEARCH")
        self.assertEqual(results["decision"]["qualifying_operating_points"], [])
        report = results["research_output"]
        for field, metric in (
            ("PF1_RELATED_CLUSTER_CONTAMINATION", "related_topic_cluster_contamination"),
            ("PF1_DIFFERENT_CLUSTER_CONTAMINATION", "different_event_cluster_contamination"),
            ("PF1_HARD_NEGATIVE_CLUSTER_CONTAMINATION", "cluster_hard_negative_contamination_count"),
            ("PF1_FALSE_FAMILY_MERGES", "false_family_merge_count"),
            ("PF1_CROSS_FAMILY_CLUSTERS", "cross_family_cluster_count"),
            ("PF1_SAME_EVENT_CAPTURE", "same_event_capture"),
            ("PF1_FAMILY_FRAGMENTATION", "family_fragmentation_breakdown"),
        ):
            self.assertEqual(report[field], reproduced[metric])
        for scorer in ("d0", "d1", "pf1"):
            ci = results[scorer + "_ci"]
            self.assertEqual(set(ci), {"precision", "recall", "f05", "rt_fpr", "de_fpr"})
            self.assertTrue(all(0 <= bounds[0] <= bounds[1] <= 1 for bounds in ci.values()))
            for metric, key in (("PRECISION", "precision"), ("RECALL", "recall"), ("F05", "f05"), ("RELATED_FPR", "rt_fpr"), ("DIFFERENT_FPR", "de_fpr")):
                self.assertEqual(report[f"{scorer.upper()}_{metric}_CI95"], ci[key])

        # All six full-Home observations stay visible, including unsafe points.
        expected_home = {"d0": {"STRICT": (196, 0), "MEDIAN": (180, 9), "PERMISSIVE": (180, 9)},
                         "d1": {"STRICT": (185, 1), "MEDIAN": (185, 1), "PERMISSIVE": (176, 5)}}
        for scorer, points in expected_home.items():
            for name, (after, negatives) in points.items():
                shadow = results[scorer + "_home_frontier"][name]
                self.assertEqual(shadow["stats"]["home_items_after"], after)
                self.assertEqual(shadow["observation"]["cluster_hard_negative_contamination_count"], negatives)


class TestR1SafetyRules(unittest.TestCase):
    """Decision-critical contracts use small artificial unit fixtures, never Gold edits."""

    def safe_point(self, capture=15):
        return {
            "scorer": "D0_DIRECT_LEXICAL", "operating_point": "MEDIAN",
            "same_event_capture": capture, "false_family_merge_count": 0,
            "cross_family_cluster_count": 0, "cluster_hard_negative_contamination_count": 0,
            "safety_classification": "ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION",
            "family_macro_recall": 0.5, "non_duo_pair_recall": 0.5,
            "non_duo_family_macro_recall": 0.5,
        }

    def test_too_low_coverage_not_promotable_even_with_zero_contamination(self):
        self.assertFalse(benchmark.qualifies_for_integration(self.safe_point(14)))
        self.assertTrue(benchmark.qualifies_for_integration(self.safe_point(15)))
        point = self.safe_point()
        point["safety_classification"] = "TOO_LOW_COVERAGE"
        self.assertFalse(benchmark.qualifies_for_integration(point))

    def test_gold_v2_sha_fail_fast_without_materialization(self):
        with patch.object(Path, "exists", return_value=True), patch.object(benchmark, "compute_file_sha256", return_value="changed"):
            with self.assertRaisesRegex(ValueError, "Gold V2 SHA256 mismatch"):
                benchmark.load_gold_v2_materialized()

    def test_zero_leakage_audit_rejects_pair_article_and_family_overlap(self):
        rows, _ = self.pair_fixture()
        def fold(idx, row, articles):
            return {"fold_idx": idx, "components": [f"C{idx}"], "rows": [row], "articles": set(articles)}
        with self.assertRaisesRegex(AssertionError, "PAIR_LEAKAGE"):
            benchmark.audit_frozen_folds([fold(0, rows[0], [1, 2]), fold(1, rows[0], [3, 4])], rows)
        with self.assertRaisesRegex(AssertionError, "ARTICLE_LEAKAGE"):
            benchmark.audit_frozen_folds([fold(0, rows[0], [1, 2]), fold(1, rows[1], [2, 3])], rows)
        family_rows = [rows[0], dict(rows[0], pair_key="3:4", entry_a_id="3", entry_b_id="4")]
        with self.assertRaisesRegex(AssertionError, "FAMILY_LEAKAGE"):
            benchmark.audit_frozen_folds([fold(0, family_rows[0], [1, 2]), fold(1, family_rows[1], [3, 4])], family_rows)

    def test_each_safety_violation_blocks_promotion(self):
        for field in ("false_family_merge_count", "cross_family_cluster_count", "cluster_hard_negative_contamination_count"):
            point = self.safe_point(40)
            point[field] = 1
            self.assertFalse(benchmark.qualifies_for_integration(point), field)

    def test_no_clear_winner_and_direct_artifact_semantics(self):
        decision = benchmark.select_research_provider([self.safe_point(4)])
        self.assertEqual(decision["research_recommendation"], "NO_CLEAR_WINNER")
        self.assertEqual(decision["lightweight_model_artifact_decision_required"], "DEFERRED")
        for scorer in ("D0_DIRECT_LEXICAL", "D1_DIRECT_QWEN"):
            point = self.safe_point()
            point["scorer"] = scorer
            decision = benchmark.select_research_provider([point])
            self.assertEqual(decision["scoreprovider_selection"], scorer)
            self.assertEqual(decision["lightweight_model_artifact_decision_required"], "NO")

    def test_pf1_evaluation_construct_is_not_promoted_as_global_provider(self):
        point = dict(self.safe_point(30), scorer="PF1_LEXICAL_PLUS_QWEN")
        decision = benchmark.select_research_provider([point])
        self.assertEqual(decision["scoreprovider_selection"], "DEFERRED_NO_CLEAR_WINNER")

    def test_selection_prioritizes_capture_before_runtime_simplicity(self):
        d0 = self.safe_point(15)
        d1 = dict(self.safe_point(16), scorer="D1_DIRECT_QWEN")
        self.assertEqual(benchmark.select_research_provider([d0, d1])["scoreprovider_selection"], "D1_DIRECT_QWEN")
        d1["same_event_capture"] = 15
        self.assertEqual(benchmark.select_research_provider([d1, d0])["scoreprovider_selection"], "D0_DIRECT_LEXICAL")

    def test_pareto_keeps_safety_coverage_tradeoff_without_scalar_loss(self):
        inert = self.safe_point(4)
        useful = dict(self.safe_point(30), cluster_hard_negative_contamination_count=1)
        worse = dict(self.safe_point(20), cluster_hard_negative_contamination_count=2)
        frontier = benchmark.pareto_operating_points([inert, useful, worse])
        self.assertEqual(frontier, [inert, useful])

    def pair_fixture(self):
        rows = [
            {"entry_a_id": "1", "entry_b_id": "2", "pair_key": "1:2", "gold_label": "SAME_EVENT", "episode_family_id": "unit_family"},
            {"entry_a_id": "2", "entry_b_id": "3", "pair_key": "2:3", "gold_label": "DIFFERENT_EVENT", "episode_family_id": ""},
        ]
        predictions = [dict(r, pred=pred, score=score) for r, pred, score in zip(rows, [1, 0], [0.01, 0.99])]
        return rows, predictions

    def test_pf1_uses_oof_decisions_not_cross_fold_probability_order(self):
        rows, predictions = self.pair_fixture()
        times = {1: 0.0, 2: 0.0, 3: 0.0}
        first = benchmark.evaluate_pf1_oof_cluster_safety(predictions, rows, times)
        changed = copy.deepcopy(predictions)
        for pred in changed:
            pred["score"] = 1 - pred["score"]
        self.assertEqual(first, benchmark.evaluate_pf1_oof_cluster_safety(changed, rows, times))
        self.assertEqual(first["same_event_capture"], 1)
        self.assertEqual(first["cluster_hard_negative_contamination_count"], 0)
        self.assertEqual(first["cluster_evaluation"], "OOF_BINARY_EDGE_P3")
        self.assertIn("family_fragmentation_breakdown", first)

    def test_pf1_rejects_missing_duplicate_or_nonbinary_oof_decisions(self):
        rows, predictions = self.pair_fixture()
        for invalid in (predictions[:1], predictions + predictions[:1], [dict(predictions[0], pred=0.5), predictions[1]]):
            with self.assertRaises(ValueError):
                benchmark.evaluate_pf1_oof_cluster_safety(invalid, rows, {1: 0, 2: 0, 3: 0})

    def test_pf1_p3_preserves_multi_member_support_and_temporal_constraint(self):
        rows, predictions = self.pair_fixture()
        predictions[1]["pred"] = 1
        # A 1-2-3 chain has no second positive edge supporting addition of 3.
        safety = benchmark.evaluate_pf1_oof_cluster_safety(predictions, rows, {1: 0, 2: 0, 3: 0})
        self.assertEqual(safety["total_articles_clustered"], 2)
        safety = benchmark.evaluate_pf1_oof_cluster_safety(predictions, rows, {1: 0, 2: 25 * 3600, 3: 50 * 3600})
        self.assertEqual(safety["total_articles_clustered"], 0)
        # JSON persists integer dictionary keys as strings; replay must keep P3's times.
        serialized_times = json.loads(json.dumps({1: 0, 2: 25 * 3600, 3: 50 * 3600}))
        self.assertEqual(benchmark.evaluate_pf1_oof_cluster_safety(predictions, rows, serialized_times), safety)

    def test_private_output_path_cannot_resolve_inside_repository(self):
        with self.assertRaises(ValueError):
            benchmark.write_private_results({}, CUR_DIR / "must-not-write.json")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "result.json"
            benchmark.write_private_results({"safe": True}, path)
            self.assertEqual(json.loads(path.read_text()), {"safe": True})
            alias = Path(tmp) / "repo-alias"
            alias.symlink_to(CUR_DIR, target_is_directory=True)
            with self.assertRaises(ValueError):
                benchmark.write_private_results({}, alias / "must-not-write.json")

    def test_private_data_git_gate(self):
        repo = CUR_DIR.parents[2]
        files = subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", "scripts/research/story-identity-v1/"],
            cwd=repo, text=True,
        ).splitlines()
        private_extensions = {".csv", ".json", ".jsonl", ".pkl", ".joblib", ".onnx", ".npz", ".npy", ".pt", ".bin"}
        self.assertFalse([name for name in files if Path(name).suffix in private_extensions])
        for path in (benchmark.GOLD_V2_CSV_PATH, Path(benchmark.CANONICAL_HUMAN_LABELS_PATH), Path(benchmark.CANONICAL_HOME200_PATH)):
            self.assertFalse(path.resolve().is_relative_to(repo.resolve()))


if __name__ == "__main__":
    unittest.main()
