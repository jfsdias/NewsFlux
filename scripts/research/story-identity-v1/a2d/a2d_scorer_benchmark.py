#!/usr/bin/env python3
"""STORY-02-A2D safety-aware scorer research; no product/runtime integration."""

from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


RESEARCH_DIR = Path(__file__).resolve().parents[1]
if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

import gold_v2_benchmark as gold
from direct_scorer_benchmark import (
    cluster_with_p3,
    evaluate_full_home_gold_observation,
    get_feed_identity,
)
from harness import FeatureExtractor, extract_significant_words
from model_benchmark import DEFAULT_SEED, load_and_materialize_features
from production_feature_ablation import LeakageTracker, fit_train_only_pipeline
from split_audit import ArticleGraph, simulate_protocol_a

EXPECTED_FOLD_COUNTS = [190, 26, 17]
EXPECTED_FOLD_SHA256 = "6a2526e9de76ee9f1fec6159a0b105ea35b5df48f637507fc443d465e313d75f"
MIN_CAPTURE = 15
SEMANTIC_GRID = [round(0.50 + index * 0.025, 3) for index in range(15)]
LEXICAL_GRID = [round(0.10 + index * 0.05, 2) for index in range(12)]
TEMPORAL_GRID = [1, 2, 4, 8, 12, 24]
P3_MAX_HOURS = 24.0


def verify_frozen_artifact_hash(actual_sha256: str, expected_sha256: str) -> bool:
    if actual_sha256 != expected_sha256:
        raise AssertionError("GOLD_V2_SHA_GATE=FAIL")
    return True


def verify_frozen_split_metadata(split: dict[str, Any]) -> bool:
    if split.get("strategy") != "COMPONENT_GROUP_3FOLD":
        raise AssertionError("FROZEN_FOLD_STRATEGY_DRIFT")
    if split.get("fold_pair_counts") != EXPECTED_FOLD_COUNTS:
        raise AssertionError("FROZEN_FOLD_PAIR_COUNTS_DRIFT")
    if split.get("fold_assignment_sha256") != EXPECTED_FOLD_SHA256:
        raise AssertionError("FROZEN_FOLD_ASSIGNMENT_DRIFT")
    if any(split.get(key) != "ZERO" for key in ("article_leakage", "pair_leakage", "family_leakage")):
        raise AssertionError("ZERO_LEAKAGE_GATE=FAIL")
    return True


def assert_inner_outer_disjoint(inner_rows: list[dict[str, Any]], outer_rows: list[dict[str, Any]]) -> bool:
    inner = {row["pair_key"] for row in inner_rows}
    outer = {row["pair_key"] for row in outer_rows}
    if inner & outer:
        raise AssertionError("OUTER_TEST_NOT_USED_FOR_TUNING: overlapping pair keys")
    return True


def assert_baseline_parity(baseline: dict[str, Any], replay: dict[str, Any]) -> bool:
    fields = (
        "oof_predictions",
        "thresholds_by_fold",
        "research_operating_points",
        "tp",
        "fp",
        "fn",
        "precision",
        "recall",
        "f05",
        "f1",
    )
    for key in ("d0", "d1", "pf1"):
        for field in fields:
            if baseline[key].get(field) != replay[key].get(field):
                raise AssertionError(f"BASELINE_DRIFT_{key.upper()}_{field.upper()}")
    for key in ("split", "d0_safety", "d1_safety", "pf1_safety", "retrieval_coverage"):
        if baseline.get(key) != replay.get(key):
            raise AssertionError(f"BASELINE_DRIFT_{key.upper()}")
    return True


def is_private_output_path(output_path: str | Path, repo_root: str | Path) -> bool:
    path = Path(output_path).resolve()
    repo = Path(repo_root).resolve()
    return not path.is_relative_to(repo)


def score_family_a(row: dict[str, Any], params: dict[str, float]) -> bool:
    return (
        float(row["qwen_embedding_cosine"]) >= float(params["semantic_threshold"])
        and float(row["title_overlap_coefficient"]) >= float(params["lexical_threshold"])
    )


def score_family_b(row: dict[str, Any], params: dict[str, float]) -> bool:
    return (
        float(row["qwen_embedding_cosine"]) >= float(params["semantic_threshold"])
        and float(row["published_delta_hours"]) <= min(float(params["max_delta_hours"]), P3_MAX_HOURS)
    )


def score_family_c(row: dict[str, Any], params: dict[str, float]) -> bool:
    if float(row["qwen_embedding_cosine"]) < float(params["semantic_threshold"]):
        return False
    lacks_corroboration = (
        float(row["title_overlap_coefficient"]) < 0.25
        and float(row["entity_anchor_overlap"]) < 0.25
        and float(row["number_overlap"]) == 0.0
        and float(row["date_overlap"]) == 0.0
    )
    return not lacks_corroboration


def _pair_metrics(rows: list[dict[str, Any]], predictions: list[int]) -> dict[str, Any]:
    if len(rows) != len(predictions):
        raise ValueError("prediction/row count mismatch")
    y_true = [int(row["target_binary"]) for row in rows]
    tp = sum(y == 1 and p == 1 for y, p in zip(y_true, predictions))
    fp = sum(y == 0 and p == 1 for y, p in zip(y_true, predictions))
    fn = sum(y == 1 and p == 0 for y, p in zip(y_true, predictions))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f05 = (1.25 * precision * recall) / (0.25 * precision + recall) if 0.25 * precision + recall else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if precision + recall else 0.0
    related = [i for i, row in enumerate(rows) if row["gold_label"] == "RELATED_TOPIC"]
    different = [i for i, row in enumerate(rows) if row["gold_label"] == "DIFFERENT_EVENT"]
    positive_families: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        if row["gold_label"] == "SAME_EVENT":
            positive_families[row.get("episode_family_id", "")].append(i)
    family_recalls = [
        sum(predictions[i] for i in indices) / len(indices)
        for indices in positive_families.values()
        if indices
    ]
    duo_indices = [
        i for i, row in enumerate(rows)
        if row["gold_label"] == "SAME_EVENT"
        and row.get("episode_family_id") == "IPHONE_DUO_FIRST_GEN_LAUNCH"
    ]
    non_duo_families = {
        family: indices for family, indices in positive_families.items()
        if family != "IPHONE_DUO_FIRST_GEN_LAUNCH"
    }
    non_duo_indices = [i for indices in non_duo_families.values() for i in indices]
    non_duo_family_recalls = [
        sum(predictions[i] for i in indices) / len(indices)
        for indices in non_duo_families.values()
        if indices
    ]
    return {
        "pair_precision": round(precision, 4),
        "pair_recall": round(recall, 4),
        "pair_f05": round(f05, 4),
        "pair_f1": round(f1, 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "related_topic_fpr": round(sum(predictions[i] for i in related) / len(related), 4) if related else 0.0,
        "different_event_fpr": round(sum(predictions[i] for i in different) / len(different), 4) if different else 0.0,
        "family_macro_recall": round(sum(family_recalls) / len(family_recalls), 4) if family_recalls else 0.0,
        "non_duo_pair_recall": round(sum(predictions[i] for i in non_duo_indices) / len(non_duo_indices), 4) if non_duo_indices else 0.0,
        "non_duo_family_macro_recall": round(sum(non_duo_family_recalls) / len(non_duo_family_recalls), 4) if non_duo_family_recalls else 0.0,
        "duo_pair_recall": round(sum(predictions[i] for i in duo_indices) / len(duo_indices), 4) if duo_indices else 0.0,
    }


def _prediction_records(
    rows: list[dict[str, Any]],
    predictions: list[int],
    scores: list[float],
    parameters: dict[str, Any],
    fold_idx: int | None = None,
) -> list[dict[str, Any]]:
    records = []
    for row, pred, score in zip(rows, predictions, scores):
        records.append({
            "pair_key": row["pair_key"],
            "entry_a_id": row["entry_a_id"],
            "entry_b_id": row["entry_b_id"],
            "target_binary": int(row["target_binary"]),
            "gold_label": row["gold_label"],
            "episode_family_id": row.get("episode_family_id"),
            "score": float(score),
            "pred": int(pred),
            "selected_parameters": dict(parameters),
            "test_fold": fold_idx,
        })
    return records


def _p3_metrics(records: list[dict[str, Any]], rows: list[dict[str, Any]], published: dict[int, float]) -> dict[str, Any]:
    return gold.evaluate_pf1_oof_cluster_safety(records, rows, published)


def _selection_key(
    rows: list[dict[str, Any]],
    predictions: list[int],
    records: list[dict[str, Any]],
    published: dict[int, float],
    conservative_tuple: tuple[Any, ...],
) -> tuple[Any, ...]:
    pair = _pair_metrics(rows, predictions)
    p3 = _p3_metrics(records, rows, published)
    return (
        p3["cluster_hard_negative_contamination_count"],
        p3["false_family_merge_count"],
        p3["cross_family_cluster_count"],
        -p3["same_event_capture"],
        -pair["pair_f05"],
        -pair["pair_precision"],
        *conservative_tuple,
    )


def _rule_score(function, rows, params):
    predictions = [int(function(row, params)) for row in rows]
    records = _prediction_records(rows, predictions, predictions, params)
    return predictions, records


def _select_rule_parameters(
    function,
    grid: list[dict[str, Any]],
    inner_rows: list[dict[str, Any]],
    outer_rows: list[dict[str, Any]],
    published: dict[int, float],
    conservative_key,
) -> tuple[dict[str, Any], dict[str, Any]]:
    assert_inner_outer_disjoint(inner_rows, outer_rows)
    best_params = None
    best_key = None
    best_evidence = None
    for params in grid:
        predictions, records = _rule_score(function, inner_rows, params)
        selection_key = _selection_key(
            inner_rows, predictions, records, published, conservative_key(params)
        )
        if best_key is None or selection_key < best_key:
            best_params, best_key, best_evidence = params, selection_key, {
                **_pair_metrics(inner_rows, predictions),
                **_p3_metrics(records, inner_rows, published),
            }
    return best_params, best_evidence


def _folds_from_rows(rows: list[dict[str, Any]], corpus_lookup: dict[int, dict[str, Any]]):
    graph = ArticleGraph(rows)
    comp_details = graph.get_component_details()
    comp_map = {component["component_id"]: component for component in comp_details}
    split = simulate_protocol_a(graph, 3)
    fold_data = []
    row_by_key = {row["pair_key"]: row for row in rows}
    for fold_info in split["folds"]:
        fold_rows = []
        articles = set()
        for component_id in fold_info["components"]:
            component = comp_map[component_id]
            articles.update(component["nodes"])
            for pair in component["pairs"]:
                key = f"{min(int(pair['entry_a_id']), int(pair['entry_b_id']))}:{max(int(pair['entry_a_id']), int(pair['entry_b_id']))}"
                fold_rows.append(row_by_key[key])
        fold_data.append({
            "fold_idx": fold_info["fold"],
            "components": fold_info["components"],
            "articles": articles,
            "rows": fold_rows,
        })
    fold_sha = gold.audit_frozen_folds(fold_data, rows)
    split_meta = {
        "strategy": "COMPONENT_GROUP_3FOLD",
        "fold_pair_counts": [len(fold["rows"]) for fold in fold_data],
        "fold_assignment_sha256": fold_sha,
        "article_leakage": "ZERO",
        "pair_leakage": "ZERO",
        "family_leakage": "ZERO",
    }
    verify_frozen_split_metadata(split_meta)
    return fold_data, comp_map, split_meta


def _rule_grid(name: str):
    if name == "A_SEMANTIC_LEXICAL_CONFIRMATION":
        return [
            {"semantic_threshold": semantic, "lexical_threshold": lexical}
            for semantic in SEMANTIC_GRID for lexical in LEXICAL_GRID
        ], score_family_a, lambda p: (-p["semantic_threshold"], -p["lexical_threshold"])
    if name == "B_SEMANTIC_TEMPORAL_CONFIRMATION":
        return [
            {"semantic_threshold": semantic, "max_delta_hours": hours}
            for semantic in SEMANTIC_GRID for hours in TEMPORAL_GRID
        ], score_family_b, lambda p: (-p["semantic_threshold"], p["max_delta_hours"])
    if name == "C_SEMANTIC_LOW_CORROBORATION_VETO":
        return [
            {"semantic_threshold": semantic}
            for semantic in SEMANTIC_GRID
        ], score_family_c, lambda p: (-p["semantic_threshold"],)
    raise ValueError(f"unknown rule family: {name}")


def _evaluate_rule_family(name, function, grid, conservative_key, fold_data, published):
    predictions = []
    selected_folds = []
    for test_idx, test_fold in enumerate(fold_data):
        train_folds = [fold for i, fold in enumerate(fold_data) if i != test_idx]
        inner_rows = train_folds[0]["rows"] + train_folds[1]["rows"]
        outer_rows = test_fold["rows"]
        params, inner_evidence = _select_rule_parameters(
            function, grid, inner_rows, outer_rows, published, conservative_key
        )
        fold_pred, _ = _rule_score(function, outer_rows, params)
        records = _prediction_records(outer_rows, fold_pred, fold_pred, params, test_idx)
        predictions.extend(records)
        selected_folds.append({
            "outer_fold": test_idx,
            "outer_test_count": len(outer_rows),
            "parameters_selected_on_outer_train_only": params,
            "inner_train_only_selection_metrics": inner_evidence,
        })
    return {
        "candidate": name,
        "class": "DIRECT_RULE",
        "features": _candidate_features(name),
        "oof_predictions": predictions,
        "outer_folds": selected_folds,
        "parameter_basis": "INNER_COMPONENT_FOLD_SELECTION_WITHIN_OUTER_TRAIN",
    }


def _candidate_features(name):
    return {
        "A_SEMANTIC_LEXICAL_CONFIRMATION": ["qwen_embedding_cosine", "title_overlap_coefficient"],
        "B_SEMANTIC_TEMPORAL_CONFIRMATION": ["qwen_embedding_cosine", "published_delta_hours"],
        "C_SEMANTIC_LOW_CORROBORATION_VETO": [
            "qwen_embedding_cosine", "title_overlap_coefficient", "entity_anchor_overlap",
            "number_overlap", "date_overlap",
        ],
        "D_LIGHTWEIGHT_LOGISTIC_REFERENCE": [
            "title_overlap_coefficient", "title_jaccard_similarity", "number_overlap",
            "date_overlap", "entity_anchor_overlap", "published_delta_hours",
            "same_calendar_day_utc", "qwen_embedding_cosine",
        ],
    }[name]


def _select_threshold_safety_first(
    scores: list[float],
    rows: list[dict[str, Any]],
    published: dict[int, float],
) -> tuple[float, dict[str, Any]]:
    unique = sorted(set(float(value) for value in scores))
    if not unique:
        return 1.0, {}
    candidates = [unique[0] - 1e-9]
    candidates.extend((left + right) / 2 for left, right in zip(unique, unique[1:]))
    candidates.append(unique[-1] + 1e-9)
    best_threshold = None
    best_key = None
    best_metrics = None
    for threshold in candidates:
        predictions = [int(float(score) >= threshold) for score in scores]
        records = _prediction_records(rows, predictions, scores, {"threshold": threshold})
        key = _selection_key(rows, predictions, records, published, (-threshold,))
        if best_key is None or key < best_key:
            best_threshold, best_key = threshold, key
            best_metrics = {
                **_pair_metrics(rows, predictions),
                **_p3_metrics(records, rows, published),
            }
    return float(best_threshold), best_metrics


def _evaluate_logistic(fold_data, published):
    features = _candidate_features("D_LIGHTWEIGHT_LOGISTIC_REFERENCE")
    tracker = LeakageTracker(total_gold_count=sum(len(fold["rows"]) for fold in fold_data))
    predictions = []
    selected_folds = []
    total_rows = sum(len(fold["rows"]) for fold in fold_data)
    for test_idx, test_fold in enumerate(fold_data):
        train_folds = [fold for i, fold in enumerate(fold_data) if i != test_idx]
        inner_a, inner_b = train_folds[0]["rows"], train_folds[1]["rows"]
        outer_test = test_fold["rows"]
        assert_inner_outer_disjoint(inner_a + inner_b, outer_test)
        _, scores_b = fit_train_only_pipeline(
            features, inner_a, inner_b, seed=DEFAULT_SEED, tracker=tracker,
            model_name=f"A2D_D_INNER_AB_{test_idx}", impute_missing=True, total_gold_count=total_rows,
        )
        _, scores_a = fit_train_only_pipeline(
            features, inner_b, inner_a, seed=DEFAULT_SEED, tracker=tracker,
            model_name=f"A2D_D_INNER_BA_{test_idx}", impute_missing=True, total_gold_count=total_rows,
        )
        inner_rows = inner_b + inner_a
        threshold, inner_metrics = _select_threshold_safety_first(scores_b + scores_a, inner_rows, published)
        outer_train_rows = inner_a + inner_b
        _, test_scores = fit_train_only_pipeline(
            features, outer_train_rows, outer_test, seed=DEFAULT_SEED, tracker=tracker,
            model_name=f"A2D_D_OUTER_{test_idx}", impute_missing=True, total_gold_count=total_rows,
        )
        test_predictions = [int(float(score) >= threshold) for score in test_scores]
        predictions.extend(_prediction_records(
            outer_test, test_predictions, test_scores, {"threshold_selected_inner_only": threshold}, test_idx
        ))
        selected_folds.append({
            "outer_fold": test_idx,
            "outer_test_count": len(outer_test),
            "threshold_selected_on_inner_train_only": threshold,
            "inner_train_only_selection_metrics": inner_metrics,
        })
    return {
        "candidate": "D_LIGHTWEIGHT_LOGISTIC_REFERENCE",
        "class": "TRAIN_ONLY_LOGISTIC_REFERENCE",
        "features": features,
        "oof_predictions": predictions,
        "outer_folds": selected_folds,
        "fit_audit": {
            "full_gold_final_fit": "NO" if tracker.full_gold_fits == 0 else "YES",
            "fit_count": len(tracker.fit_calls),
            "largest_fit_rows": max((call["n_train"] for call in tracker.fit_calls), default=0),
        },
        "parameter_basis": "FIXED_PREREGISTERED_C=1; INNER_COMPONENT_FOLD_THRESHOLD_SELECTION",
    }


def _evaluate_oof_candidate(candidate, gold_rows, published, comp_map):
    records = candidate["oof_predictions"]
    if len(records) != len(gold_rows) or len({row["pair_key"] for row in records}) != len(gold_rows):
        raise AssertionError("OOF_BINARY_EDGE_P3_GATE=FAIL")
    pair = _pair_metrics(gold_rows, [row["pred"] for row in records])
    p3 = _p3_metrics(records, gold_rows, published)
    ci = gold.compute_component_bootstrap_ci(records, comp_map)
    return {
        **pair,
        "oof_p3": p3,
        "component_bootstrap_ci95": {
            name: [float(bounds[0]), float(bounds[1])] for name, bounds in ci.items()
        },
        "qualification": (
            "OOF_SAFETY_AND_COVERAGE_PASS"
            if p3["same_event_capture"] >= MIN_CAPTURE
            and p3["cluster_hard_negative_contamination_count"] == 0
            and p3["false_family_merge_count"] == 0
            and p3["cross_family_cluster_count"] == 0
            else "NOT_QUALIFIED"
        ),
    }


def summarize_direct_fold_parameters(fold_parameters, directions):
    if not fold_parameters:
        raise ValueError("fold parameters required")
    output = {}
    for label in ("STRICT", "MEDIAN", "PERMISSIVE"):
        params = {}
        for key in fold_parameters[0]:
            values = [float(item[key]) for item in fold_parameters]
            direction = directions[key]
            if label == "MEDIAN":
                value = statistics.median(values)
            elif (label == "STRICT" and direction == "high") or (label == "PERMISSIVE" and direction == "low"):
                value = max(values)
            else:
                value = min(values)
            params[key] = round(value, 6)
        output[label] = params
    output["basis"] = "OUTER_FOLD_TRAIN_DERIVED_PARAMETERS_NOT_FULL_GOLD_FIT"
    return output


def candidate_is_promotable(oof_metrics, fixed_point=None, home_metrics=None):
    if fixed_point is None or home_metrics is None:
        return False
    for metrics in (oof_metrics, fixed_point):
        if metrics.get("same_event_capture", 0) < MIN_CAPTURE:
            return False
        if metrics.get("cluster_hard_negative_contamination_count", 0) != 0:
            return False
        if metrics.get("false_family_merge_count", 0) != 0:
            return False
        if metrics.get("cross_family_cluster_count", 0) != 0:
            return False
    return (
        home_metrics.get("observed_home_hard_negative_merges", 0) == 0
        and home_metrics.get("observed_home_false_family_merges", 0) == 0
    )


def build_per_fold_selection_audit(candidate, fold_data, published):
    """Return aggregate train/test evidence without exposing private pair rows."""
    records_by_fold: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for record in candidate["oof_predictions"]:
        records_by_fold[int(record["test_fold"])].append(record)

    audits = []
    for fold_idx, test_fold in enumerate(fold_data):
        test_rows = test_fold["rows"]
        train_rows = [
            row
            for other_idx, fold in enumerate(fold_data)
            if other_idx != fold_idx
            for row in fold["rows"]
        ]
        train_labels = Counter(row["gold_label"] for row in train_rows)
        train_positive_families = {
            row.get("episode_family_id")
            for row in train_rows
            if row["gold_label"] == "SAME_EVENT" and row.get("episode_family_id")
        }
        fold_records = records_by_fold.get(fold_idx, [])
        record_by_key = {record["pair_key"]: record for record in fold_records}
        expected_keys = [row["pair_key"] for row in test_rows]
        if len(record_by_key) != len(fold_records) or set(expected_keys) != set(record_by_key):
            raise AssertionError("PER_FOLD_SELECTION_AUDIT_GATE=FAIL")
        ordered_records = [record_by_key[key] for key in expected_keys]
        predictions = [int(record["pred"]) for record in ordered_records]
        pair = _pair_metrics(test_rows, predictions)
        p3 = _p3_metrics(ordered_records, test_rows, published)
        report = candidate["outer_folds"][fold_idx]
        selected = report.get("parameters_selected_on_outer_train_only")
        if selected is None:
            selected = {"threshold": report["threshold_selected_on_inner_train_only"]}
        inner = report["inner_train_only_selection_metrics"]
        audits.append({
            "outer_fold": fold_idx,
            "outer_test_pair_count": len(test_rows),
            "outer_train_pair_count": len(train_rows),
            "outer_train_same_count": train_labels["SAME_EVENT"],
            "outer_train_related_count": train_labels["RELATED_TOPIC"],
            "outer_train_different_count": train_labels["DIFFERENT_EVENT"],
            "outer_train_hard_negative_count": train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"],
            "outer_train_positive_family_count": len(train_positive_families),
            "selected_parameters": dict(selected),
            "inner_selected_same_capture": inner.get("same_event_capture"),
            "inner_selected_hard_negatives": inner.get("cluster_hard_negative_contamination_count"),
            "outer_test_pair_tp": pair["tp"],
            "outer_test_pair_fp": pair["fp"],
            "outer_test_pair_fn": pair["fn"],
            "outer_test_p3_same_capture": p3["same_event_capture"],
            "outer_test_p3_hard_negatives": p3["cluster_hard_negative_contamination_count"],
        })
    return audits


def summarize_giant_component_diagnosis(fold_data, comp_map):
    if not comp_map:
        raise ValueError("component map is required")
    component_id, component = max(comp_map.items(), key=lambda item: len(item[1]["pairs"]))
    outer_fold = next(
        (int(fold["fold_idx"]) for fold in fold_data if component_id in fold["components"]),
        None,
    )
    if outer_fold is None:
        raise AssertionError("GIANT_COMPONENT_DIAGNOSIS_GATE=FAIL")
    labels = Counter(pair["gold_label"] for pair in component["pairs"])
    train_rows = [
        row
        for fold in fold_data
        if int(fold["fold_idx"]) != outer_fold
        for row in fold["rows"]
    ]
    train_labels = Counter(row["gold_label"] for row in train_rows)
    return {
        "giant_component_outer_fold": outer_fold,
        "giant_component_pair_count": len(component["pairs"]),
        "giant_component_same_count": labels["SAME_EVENT"],
        "train_size_when_giant_component_is_test": len(train_rows),
        "train_same_count_when_giant_component_is_test": train_labels["SAME_EVENT"],
        "train_hard_negative_count_when_giant_component_is_test": (
            train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"]
        ),
        "train_positive_family_count_when_giant_component_is_test": len({
            row.get("episode_family_id")
            for row in train_rows
            if row["gold_label"] == "SAME_EVENT" and row.get("episode_family_id")
        }),
    }


def summarize_parameter_stability(parameter_sets, preregistered_grids):
    if not parameter_sets:
        raise ValueError("parameter sets are required")
    keys = tuple(parameter_sets[0])
    values_by_fold = {key: [item[key] for item in parameter_sets] for key in keys}
    ranges = {
        key: [round(min(map(float, values)), 6), round(max(map(float, values)), 6)]
        for key, values in values_by_fold.items()
    }
    medians = {
        key: round(float(statistics.median(map(float, values))), 6)
        for key, values in values_by_fold.items()
    }
    varying_axes = [key for key, values in values_by_fold.items() if len(set(values)) > 1]
    grid_spans = {}
    for key in varying_axes:
        grid = preregistered_grids.get(key)
        if not grid:
            grid_spans[key] = None
            continue
        positions = {value: index for index, value in enumerate(grid)}
        grid_spans[key] = max(positions[value] for value in values_by_fold[key]) - min(
            positions[value] for value in values_by_fold[key]
        )
    if not varying_axes:
        classification = "STABLE"
    elif len(varying_axes) == 1 and grid_spans[varying_axes[0]] == 1:
        classification = "MODERATELY_UNSTABLE"
    else:
        classification = "HIGHLY_UNSTABLE"
    return {
        "parameter_values_by_fold": values_by_fold,
        "parameter_range": ranges,
        "parameter_median": medians,
        "grid_step_span": grid_spans,
        "classification": classification,
        "classification_basis": (
            "stable=identical selections; moderate=one parameter varies by one preregistered grid step; "
            "high=multiple parameters vary or any parameter spans more than one grid step"
        ),
    }


def post_hoc_parameter_transfer_diagnostic(candidate, fold_data, published, score_function):
    """Cross-apply selected rule parameters for diagnosis only, never selection."""
    matrix = []
    for train_fold, report in enumerate(candidate["outer_folds"]):
        params = report["parameters_selected_on_outer_train_only"]
        for eval_fold, fold in enumerate(fold_data):
            rows = fold["rows"]
            predictions, _ = _rule_score(score_function, rows, params)
            records = _prediction_records(rows, predictions, predictions, params, eval_fold)
            p3 = _p3_metrics(records, rows, published)
            matrix.append({
                "train_derived_parameter_fold": train_fold,
                "evaluation_fold": eval_fold,
                "same_capture": p3["same_event_capture"],
                "hard_negatives": p3["cluster_hard_negative_contamination_count"],
            })
    return {
        "label": "POST_HOC_PARAMETER_TRANSFER_DIAGNOSTIC_ONLY",
        "used_for_parameter_selection": False,
        "matrix": matrix,
    }


def validate_targeted_gold_protocol(dev_article_ids, blind_article_ids, dev_pair_keys, blind_pair_keys):
    article_overlap = set(dev_article_ids) & set(blind_article_ids)
    if article_overlap:
        raise ValueError("ARTICLE_DISJOINT_TARGET=FAIL")
    pair_overlap = set(dev_pair_keys) & set(blind_pair_keys)
    if pair_overlap:
        raise ValueError("PAIR_DISJOINT_TARGET=FAIL")
    return {
        "article_overlap": 0,
        "pair_overlap": 0,
        "tuning_evaluation_reuse": "NO",
        "sampling_uses_unknown_human_labels": "NO",
        "blind_challenge_used_for_tuning": "NO",
    }


def evaluate_qualified_home_shadow(oof_metrics, fixed_point, runner, *args):
    """Exercise the gated candidate -> fixed point -> Home shadow path."""
    if not candidate_is_promotable(oof_metrics, fixed_point.get("gold_fixed_point_p3"), {
        "observed_home_hard_negative_merges": 0,
        "observed_home_false_family_merges": 0,
    }):
        return None
    return runner(fixed_point["parameters"], *args)


def classify_limiting_factor(per_fold_audits, transfer_diagnostics, giant_component):
    unsafe_folds = {
        audit["outer_fold"]
        for audits in per_fold_audits.values()
        for audit in audits
        if audit["outer_test_p3_hard_negatives"] > 0
    }
    safe_transfer_to_unsafe_fold = False
    for candidate_name, audits in per_fold_audits.items():
        candidate_unsafe_folds = {
            audit["outer_fold"]
            for audit in audits
            if audit["outer_test_p3_hard_negatives"] > 0
        }
        diagnostic = transfer_diagnostics.get(candidate_name, {})
        if any(
            cell["evaluation_fold"] in candidate_unsafe_folds
            and cell["train_derived_parameter_fold"] != cell["evaluation_fold"]
            and cell["same_capture"] >= MIN_CAPTURE
            and cell["hard_negatives"] == 0
            for cell in diagnostic.get("matrix", [])
        ):
            safe_transfer_to_unsafe_fold = True
            break
    giant_fold = giant_component["giant_component_outer_fold"]
    giant_is_the_unsafe_fold = giant_fold in unsafe_folds
    giant_positive_concentration = (
        giant_component["train_same_count_when_giant_component_is_test"]
        < giant_component["giant_component_same_count"]
    )
    if safe_transfer_to_unsafe_fold and giant_is_the_unsafe_fold and giant_positive_concentration:
        classification = "MIXED_THRESHOLD_AND_GOLD_LIMIT"
        why = (
            "A fold-specific threshold selected without the giant component produced an OOF hard negative; "
            "a parameter set selected with the giant component transfers to that fold at useful capture with "
            "zero observed hard negatives. The giant holdout also contains more SAME_EVENT evidence than its training remainder. "
            "Transfer is post-hoc diagnostic evidence, not an unbiased estimate."
        )
    elif safe_transfer_to_unsafe_fold:
        classification = "THRESHOLD_INSTABILITY"
        why = "A different already-selected fold parameter transfers to an unsafe OOF fold with useful capture and zero observed hard negatives; transfer is diagnostic only."
    else:
        classification = "OTHER"
        why = "The existing results do not establish feature separability or a safe transferable parameter region."
    return {
        "classification": classification,
        "why": why,
        "safe_transfer_to_unsafe_fold": safe_transfer_to_unsafe_fold,
        "giant_is_the_unsafe_fold": giant_is_the_unsafe_fold,
        "giant_positive_concentration": giant_positive_concentration,
        "unsafe_oof_folds": sorted(unsafe_folds),
    }


def _load_full_inputs():
    input_results = gold.verify_input_artifacts()
    rows, meta = gold.load_gold_v2_materialized()
    if meta["gold_v2_sha256"] != gold.EXPECTED_GOLD_V2_SHA256:
        raise AssertionError("GOLD_V2_SHA_GATE=FAIL")
    with open(gold.CANONICAL_CORPUS_PATH, encoding="utf-8") as handle:
        corpus_rows = [json.loads(line) for line in handle if line.strip()]
    corpus = {int(row["id"]): row for row in corpus_rows}
    fold_data, comp_map, split_meta = _folds_from_rows(rows, corpus)
    return input_results, rows, meta, corpus, fold_data, comp_map, split_meta


def _direct_fixed_points(candidate_name, candidate, gold_rows, published):
    if candidate["class"] != "DIRECT_RULE":
        return {"basis": "NO_GLOBAL_POINT_FOR_LEARNED_CROSS_FOLD_MODELS"}
    if candidate_name == "A_SEMANTIC_LEXICAL_CONFIRMATION":
        directions = {"semantic_threshold": "high", "lexical_threshold": "high"}
    elif candidate_name == "B_SEMANTIC_TEMPORAL_CONFIRMATION":
        directions = {"semantic_threshold": "high", "max_delta_hours": "low"}
    else:
        directions = {"semantic_threshold": "high"}
    fold_params = [
        report["parameters_selected_on_outer_train_only"]
        for report in candidate["outer_folds"]
    ]
    points = summarize_direct_fold_parameters(fold_params, directions)
    results = {"basis": points.pop("basis")}
    function = {
        "A_SEMANTIC_LEXICAL_CONFIRMATION": score_family_a,
        "B_SEMANTIC_TEMPORAL_CONFIRMATION": score_family_b,
        "C_SEMANTIC_LOW_CORROBORATION_VETO": score_family_c,
    }[candidate_name]
    for point_name in ("STRICT", "MEDIAN", "PERMISSIVE"):
        params = points[point_name]
        preds, records = _rule_score(function, gold_rows, params)
        p3 = _p3_metrics(records, gold_rows, published)
        results[point_name] = {
            "parameters": params,
            "pair_metrics": _pair_metrics(gold_rows, preds),
            "gold_fixed_point_p3": p3,
            "classification": (
                "GOLD_FIXED_POINT_SAFETY_AND_COVERAGE_PASS"
                if p3["same_event_capture"] >= MIN_CAPTURE
                and p3["cluster_hard_negative_contamination_count"] == 0
                and p3["false_family_merge_count"] == 0
                and p3["cross_family_cluster_count"] == 0
                else "NOT_QUALIFIED"
            ),
        }
    return results


def _home_shadow_for_rule(function, params, home_articles, gold_rows, corpus, pair_universe_path):
    home_ids = {int(article["id"]) for article in home_articles}
    home_order = [int(article["id"]) for article in home_articles]
    feed_lookup = {int(article["id"]): get_feed_identity(article) for article in home_articles}
    published = {int(article["id"]): float(article.get("published_at", 0.0)) for article in home_articles}
    candidates_by_article: dict[int, list[tuple[float, str, tuple[int, int]]]] = defaultdict(list)
    feature_by_pair = {}
    with open(pair_universe_path, encoding="utf-8") as handle:
        for pair in csv.DictReader(handle):
            u, v = int(pair["id_a"]), int(pair["id_b"])
            if u not in home_ids or v not in home_ids:
                continue
            if not feed_lookup.get(u) or not feed_lookup.get(v) or feed_lookup[u] == feed_lookup[v]:
                continue
            key = f"{min(u,v)}:{max(u,v)}"
            qwen = float(pair.get("qwen_score", 0.0))
            candidates_by_article[u].append((qwen, key, tuple(sorted((u,v)))))
            candidates_by_article[v].append((qwen, key, tuple(sorted((u,v)))))
            feature_by_pair[key] = FeatureExtractor.extract_features(pair, corpus_lookup=corpus)
    retrieved = set()
    for article_id in home_order:
        for _, _, pair in sorted(candidates_by_article.get(article_id, []), key=lambda item: (-item[0], item[1]))[:10]:
            retrieved.add(pair)
    edge_scores = {}
    for pair in retrieved:
        row = feature_by_pair.get(f"{pair[0]}:{pair[1]}")
        if row and function(row, params):
            edge_scores[pair] = 1.0
    clusters = cluster_with_p3(set(home_order), edge_scores, 0.5, published, max_temporal_span_hours=P3_MAX_HOURS)
    projections = [
        {"story_id": str(index), "member_article_ids": members}
        for index, members in enumerate(clusters)
    ]
    obs = evaluate_full_home_gold_observation(projections, gold_rows)
    multi = [cluster for cluster in clusters if len(cluster) > 1]
    compressed = sum(len(cluster) - 1 for cluster in multi)
    return {
        "home_items_before": len(home_articles),
        "home_items_after": len(clusters),
        "noise_reduction_percent": round(100 * compressed / len(home_articles), 2),
        "story_card_count": len(multi),
        "top20_story_cards": sum(min(home_order.index(aid) for aid in cluster) < 20 for cluster in multi),
        "top50_story_cards": sum(min(home_order.index(aid) for aid in cluster) < 50 for cluster in multi),
        "observed_home_hard_negative_merges": obs["cluster_hard_negative_contamination_count"],
        "observed_home_false_family_merges": obs["false_family_merge_count"],
        "observed_home_cross_family_clusters": obs["cross_family_cluster_count"],
        "home_gold_coverage_incomplete": True,
    }


def run_a2d_benchmark(
    output_path: str | Path = "/tmp/newsflux-story02-a2d-private/a2d-results-private.json",
    baseline_reference_path: str | Path = "/tmp/newsflux-story02-a2c-r1-private/r1-results.json",
):
    repo_root = Path(__file__).resolve().parents[4]
    if not is_private_output_path(output_path, repo_root):
        raise ValueError("PRIVATE_DATA_GIT_GATE=FAIL")
    baseline = json.load(open(baseline_reference_path, encoding="utf-8"))
    replay = gold.run_gold_v2_benchmark()
    assert_baseline_parity(baseline, replay)
    input_results, rows, meta, corpus, fold_data, comp_map, split_meta = _load_full_inputs()
    verify_frozen_split_metadata(split_meta)
    published = {aid: float(item.get("published_at", 0.0)) for aid, item in corpus.items()}
    if len(rows) != 233 or meta["unique_articles"] != 153:
        raise AssertionError("GOLD_V2_SCHEMA_GATE=FAIL")

    candidate_results = {}
    for name in (
        "A_SEMANTIC_LEXICAL_CONFIRMATION",
        "B_SEMANTIC_TEMPORAL_CONFIRMATION",
        "C_SEMANTIC_LOW_CORROBORATION_VETO",
    ):
        grid, function, conservative_key = _rule_grid(name)
        candidate = _evaluate_rule_family(name, function, grid, conservative_key, fold_data, published)
        candidate_results[name] = candidate
    candidate_results["D_LIGHTWEIGHT_LOGISTIC_REFERENCE"] = _evaluate_logistic(fold_data, published)

    summaries = {}
    for name, candidate in candidate_results.items():
        summaries[name] = _evaluate_oof_candidate(candidate, rows, published, comp_map)
    fixed_points = {
        name: _direct_fixed_points(name, candidate, rows, published)
        for name, candidate in candidate_results.items()
    }

    per_fold_audits = {
        name: build_per_fold_selection_audit(candidate, fold_data, published)
        for name, candidate in candidate_results.items()
    }
    giant_component = summarize_giant_component_diagnosis(fold_data, comp_map)
    direct_functions = {
        "A_SEMANTIC_LEXICAL_CONFIRMATION": score_family_a,
        "B_SEMANTIC_TEMPORAL_CONFIRMATION": score_family_b,
        "C_SEMANTIC_LOW_CORROBORATION_VETO": score_family_c,
    }
    preregistered_grids = {
        "A_SEMANTIC_LEXICAL_CONFIRMATION": {
            "semantic_threshold": SEMANTIC_GRID, "lexical_threshold": LEXICAL_GRID,
        },
        "B_SEMANTIC_TEMPORAL_CONFIRMATION": {
            "semantic_threshold": SEMANTIC_GRID, "max_delta_hours": TEMPORAL_GRID,
        },
        "C_SEMANTIC_LOW_CORROBORATION_VETO": {"semantic_threshold": SEMANTIC_GRID},
    }
    parameter_stability = {}
    transfer_diagnostics = {}
    for name, function in direct_functions.items():
        parameter_sets = [
            report["parameters_selected_on_outer_train_only"]
            for report in candidate_results[name]["outer_folds"]
        ]
        parameter_stability[name] = summarize_parameter_stability(
            parameter_sets, preregistered_grids[name]
        )
        transfer_diagnostics[name] = post_hoc_parameter_transfer_diagnostic(
            candidate_results[name], fold_data, published, function
        )
    d_thresholds = [
        float(report["threshold_selected_on_inner_train_only"])
        for report in candidate_results["D_LIGHTWEIGHT_LOGISTIC_REFERENCE"]["outer_folds"]
    ]
    parameter_stability["D_LIGHTWEIGHT_LOGISTIC_REFERENCE"] = {
        "thresholds_by_fold": d_thresholds,
        "threshold_range": [round(min(d_thresholds), 6), round(max(d_thresholds), 6)],
        "threshold_median": round(float(statistics.median(d_thresholds)), 6),
        "threshold_selections_differ": len(set(d_thresholds)) > 1,
        "classification_basis": "descriptive refit-specific probability thresholds; cross-fold calibration is not assumed",
    }
    limiting_factor_diagnosis = classify_limiting_factor(
        per_fold_audits, transfer_diagnostics, giant_component
    )
    selection_stability_audit = {
        "per_fold": per_fold_audits,
        "giant_component": giant_component,
        "parameter_stability": parameter_stability,
        "parameter_transfer": transfer_diagnostics,
        "limiting_factor_diagnosis": limiting_factor_diagnosis,
    }

    home_articles = [json.loads(line) for line in open(gold.CANONICAL_HOME200_PATH, encoding="utf-8") if line.strip()]
    home_shadows = {}
    for name, candidate in candidate_results.items():
        summary = summaries[name]["oof_p3"]
        if candidate["class"] != "DIRECT_RULE":
            continue
        function = direct_functions[name]
        candidate_home_shadows = {}
        for point_name in ("STRICT", "MEDIAN", "PERMISSIVE"):
            point = fixed_points[name].get(point_name)
            if not point:
                continue
            result = evaluate_qualified_home_shadow(
                summary,
                point,
                lambda params: _home_shadow_for_rule(
                    function, params, home_articles, rows, corpus, gold.CANONICAL_PAIRS_PATH
                ),
            )
            if result is not None:
                candidate_home_shadows[point_name] = result
        if candidate_home_shadows:
            home_shadows[name] = candidate_home_shadows

    retrieval = replay["retrieval_coverage"]
    public_result = {
        "research_version": "STORY_02_A2D_R1",
        "inputs": {
            "gold_v2_sha256": meta["gold_v2_sha256"],
            "gold_v2_pairs": meta["pair_count"],
            "gold_v2_unique_articles": meta["unique_articles"],
            "home200_sha256": input_results["home_200"]["sha256"],
            "human_labels_sha256": input_results["human_labels"]["sha256"],
            "split": split_meta,
            "zero_leakage": True,
        },
        "baseline_parity": {"d0": True, "d1": True, "pf1": True},
        "retrieval_coverage": retrieval,
        "candidates": candidate_results,
        "candidate_summaries": summaries,
        "global_points": fixed_points,
        "home_shadows": home_shadows,
        "selection_stability_audit": selection_stability_audit,
        "decision": _decision(candidate_results, summaries, fixed_points, home_shadows, limiting_factor_diagnosis),
    }
    gold.write_private_results(public_result, output_path)
    return {
        "output_path": str(Path(output_path).resolve()),
        "input_gates": {
            "gold_v2_sha": "PASS",
            "human_labels_sha": "PASS",
            "home200_sha": "PASS",
            "frozen_split": "PASS",
            "zero_leakage": "PASS",
        },
        "baseline_parity": {"d0": "PASS", "d1": "PASS", "pf1": "PASS"},
        "candidate_summaries": {
            name: {
                **{key: value for key, value in summary.items() if key != "oof_p3"},
                "oof_p3": {
                    key: value for key, value in summary["oof_p3"].items()
                    if key in (
                        "same_event_capture", "related_topic_cluster_contamination",
                        "different_event_cluster_contamination", "cluster_hard_negative_contamination_count",
                        "false_family_merge_count", "cross_family_cluster_count", "safety_classification",
                    )
                },
                "ci95": summary["component_bootstrap_ci95"],
                "qualification": summary["qualification"],
            }
            for name, summary in summaries.items()
        },
        "global_points": {
            name: {
                point: {
                    "parameters": values.get("parameters"),
                    "p3": {
                        key: val for key, val in values.get("gold_fixed_point_p3", {}).items()
                        if key in (
                            "same_event_capture", "related_topic_cluster_contamination",
                            "different_event_cluster_contamination", "cluster_hard_negative_contamination_count",
                            "false_family_merge_count", "cross_family_cluster_count", "safety_classification",
                        )
                    },
                    "classification": values.get("classification"),
                }
                for point, values in points.items() if point in ("STRICT", "MEDIAN", "PERMISSIVE")
            }
            for name, points in fixed_points.items()
        },
        "home_shadows": home_shadows,
        "selection_stability_audit": selection_stability_audit,
        "retrieval_coverage": retrieval,
        "decision": public_result["decision"],
    }


def _decision(candidates, summaries, fixed_points, home_shadows, limiting_factor_diagnosis=None):
    passing = []
    for name, summary in summaries.items():
        oof = summary["oof_p3"]
        if not (
            oof["same_event_capture"] >= MIN_CAPTURE
            and oof["cluster_hard_negative_contamination_count"] == 0
            and oof["false_family_merge_count"] == 0
            and oof["cross_family_cluster_count"] == 0
        ):
            continue
        points = fixed_points.get(name, {})
        shadows = home_shadows.get(name, {})
        for point_name in ("STRICT", "MEDIAN", "PERMISSIVE"):
            point = points.get(point_name, {})
            p3 = point.get("gold_fixed_point_p3", {})
            home = shadows.get(point_name, {})
            if candidate_is_promotable(oof, p3, home):
                passing.append((name, point_name, oof["same_event_capture"], summary["pair_f05"]))
    if passing:
        passing.sort(key=lambda item: (-item[2], -item[3], item[0], item[1]))
        winner = passing[0]
        return {
            "provider_candidate_found": "YES",
            "research_recommendation": "SAFETY_AWARE_DIRECT_SCORER_FOUND" if candidates[winner[0]]["class"] == "DIRECT_RULE" else "LIGHTWEIGHT_LEARNED_CANDIDATE_FOUND",
            "best_candidate": winner[0],
            "qualifying_global_point": winner[1],
            "limiting_factor": "NONE_OBSERVED_WITHIN_FROZEN_GOLD_AND_HOME_SHADOW",
            "next_recommended_track": "STORY_02_A2E_PROVIDER_CANDIDATE_FREEZE",
            "why": "All OOF, fixed Gold point, and observed Home safety/coverage gates passed; no product integration is implied.",
        }
    diagnosis = limiting_factor_diagnosis or {}
    supported_classifications = {
        "THRESHOLD_INSTABILITY",
        "FEATURE_SEPARABILITY_LIMIT",
        "GOLD_COVERAGE_LIMIT",
        "MODEL_CLASS_LIMIT",
        "MIXED_THRESHOLD_AND_GOLD_LIMIT",
        "OTHER",
    }
    limiting = diagnosis.get("classification")
    if limiting not in supported_classifications:
        limiting = "OTHER"
    why = diagnosis.get("why") or "No candidate passed the complete safety and coverage gates, and the available diagnostic evidence is inconclusive."
    next_track_by_limiting_factor = {
        "THRESHOLD_INSTABILITY": "STORY_02_A2D2_TARGETED_GOLD_DESIGN",
        "FEATURE_SEPARABILITY_LIMIT": "STORY_02_A2D2_TARGETED_GOLD_DESIGN",
        "GOLD_COVERAGE_LIMIT": "STORY_02_A2D2_TARGETED_GOLD_DESIGN",
        "MODEL_CLASS_LIMIT": "MORE_POSITIVE_GOLD_REQUIRED",
        "MIXED_THRESHOLD_AND_GOLD_LIMIT": "STORY_02_A2D2_TARGETED_GOLD_DESIGN",
        "OTHER": "HOLD_FOR_PM",
    }
    return {
        "provider_candidate_found": "NO",
        "research_recommendation": "NO_CLEAR_WINNER",
        "best_candidate": max(summaries, key=lambda name: (
            -summaries[name]["oof_p3"]["cluster_hard_negative_contamination_count"],
            summaries[name]["oof_p3"]["same_event_capture"],
            summaries[name]["pair_f05"],
        )),
        "limiting_factor": limiting,
        "next_recommended_track": next_track_by_limiting_factor[limiting],
        "why": why,
        "limiting_factor_evidence": diagnosis,
    }
