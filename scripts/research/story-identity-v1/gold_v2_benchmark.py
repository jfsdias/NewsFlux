#!/usr/bin/env python3
"""NEWSFLUX — STORY-02-A2C: Gold V2 Freeze + Leak-Free Benchmark + ScoreProvider Selection.

Methodological Principles:
1. Immutable input verification fail-fast (Gold V1, human labels, pack, sidecar, Home-200).
2. Frozen Gold V2 artifact generation & verification (233 pairs, 153 articles, 10 positive families).
3. Component-graph topological audit (detecting giant component dominance).
4. Strict zero-leakage evaluation (ARTICLE_LEAKAGE=ZERO, PAIR_LEAKAGE=ZERO, FAMILY_LEAKAGE=ZERO).
5. Downstream conservative P3 clustering evaluation under 24h temporal constraint.
6. Retrieval coverage separation (RF0R vs RF1).
7. Non-Duo generalization and positive robustness tracking.
8. Component-aware bootstrap uncertainty analysis.
9. Executive ScoreProvider selection & Home-200 shadow execution.
"""

from __future__ import annotations

import csv
import argparse
import hashlib
import json
import os
import random
import sys
import time
from importlib.metadata import version
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
from sklearn.metrics import auc, precision_recall_curve, roc_auc_score

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from harness import (
    FeatureExtractor,
    compute_overlap_coefficient,
    extract_significant_words,
)
from model_benchmark import (
    DEFAULT_SEED,
    find_optimal_threshold_f05,
    load_and_materialize_features,
)
from split_audit import (
    ArticleGraph,
    simulate_protocol_a,
    validate_gold_schema_and_invariants,
    verify_gold_integrity,
)
from direct_scorer_benchmark import (
    cluster_with_p3,
    evaluate_direct_scorer_3fold,
    evaluate_full_home_gold_observation,
    evaluate_gold_cluster_safety,
    execute_d0_raw_pipeline_on_home200,
    execute_d1_retrieved_pipeline_on_home200,
    get_feed_identity,
    retrieve_candidates_rf0r,
)
from production_feature_ablation import (
    LeakageTracker,
    PF0_LEXICAL_FEATURES,
    PF1_QWEN_FEATURES,
    evaluate_outer_3fold_leak_free,
)

# Canonical Paths & Hashes
CANONICAL_HUMAN_LABELS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/story02-gold-v2/human-labels-v1.csv"
EXPECTED_HUMAN_LABELS_SHA256 = "7cff732171abf4f7e410c8a0f14425652ec49d8d52a11ba4268fd9262e96c88c"

CANONICAL_ANNOTATION_PACK_PATH = "/tmp/newsflux-story01b-private/overnight-v2/annotation/annotation-pack-v1.csv"
EXPECTED_ANNOTATION_PACK_SHA256 = "b238f8bd77e75f0b3af0c6ab7510d4e2a45667ad2d38d6a8c361d30f627fa8ce"

CANONICAL_SIDECAR_PATH = "/tmp/newsflux-story01b-private/overnight-v2/annotation/annotation-audit-sidecar-v1.json"
EXPECTED_SIDECAR_SHA256 = "41bb677bf52c7cd3b8c2d0bbb55cfd8a83d49eb9cbd22bfa6907edfd7c744ad7"

CANONICAL_GOLD_V1_PATH = "/tmp/newsflux-story01b-private/checkpoints/story01b-gold-v1.csv"
EXPECTED_GOLD_V1_SHA256 = "150db715c499835c5ec4d7b2d4d0ea5875913f5c4717aa30258af4dfed640b2b"

CANONICAL_HOME200_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
EXPECTED_HOME200_SHA256 = "0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0"

CANONICAL_CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/corpus.jsonl"
CANONICAL_PAIRS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"

GOLD_V2_DIR = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/story02-gold-v2")
GOLD_V2_CSV_PATH = GOLD_V2_DIR / "story-identity-gold-v2.csv"
EXPECTED_GOLD_V2_SHA256 = "3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4"

OOF_THRESHOLD_STRATEGY = "INNER_TRAIN_ONLY_PER_OUTER_FOLD"
OPERATING_POINT_NAMES = ("STRICT", "MEDIAN", "PERMISSIVE")
MIN_SAME_EVENT_CAPTURE = 15  # Existing evaluator policy, unchanged by R1.
ORIGINAL_A2C_BASELINE = {
    "d0_strict": {"same_event_capture": 4, "hard_negative_cluster_contamination": 0},
    "d1_strict": {"same_event_capture": 19, "hard_negative_cluster_contamination": 1},
    "pf1_reported": {
        "same_event_capture": 14, "hard_negative_cluster_contamination": 1,
        "methodology": "HISTORICAL_REPORTED_VALUE_NOT_REPRODUCIBLE_BY_PREVIOUS_RUNNER",
    },
}


def evaluate_partition_safety(
    clusters: List[List[int]], gold_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Measure P3 membership, including transitive contamination, on frozen labels."""
    projections = [
        {"story_id": str(idx), "member_article_ids": members}
        for idx, members in enumerate(clusters)
    ]
    obs = evaluate_full_home_gold_observation(projections, gold_rows)
    membership = {aid: idx for idx, members in enumerate(clusters) for aid in members}
    families: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in gold_rows:
        if row["gold_label"] == "SAME_EVENT":
            families[row["episode_family_id"]].append(row)

    def captured(row):
        u, v = int(row["entry_a_id"]), int(row["entry_b_id"])
        return u in membership and v in membership and membership[u] == membership[v]

    breakdown = {}
    fragmentation = {}
    for family, pairs in sorted(families.items()):
        count = sum(captured(row) for row in pairs)
        breakdown[family] = {"captured": count, "total": len(pairs), "recall": count / len(pairs)}
        members = {int(row[key]) for row in pairs for key in ("entry_a_id", "entry_b_id")}
        fragmentation[family] = len({membership[aid] for aid in members})
    non_duo = [name for name in families if name != "IPHONE_DUO_FIRST_GEN_LAUNCH"]
    non_duo_total = sum(breakdown[name]["total"] for name in non_duo)
    non_duo_capture = sum(breakdown[name]["captured"] for name in non_duo)
    capture = obs["same_event_pairs_captured"]
    hard_neg = obs["cluster_hard_negative_contamination_count"]
    cross_family = obs["cross_family_cluster_count"]
    safety = (
        "TOO_LOW_COVERAGE" if capture < MIN_SAME_EVENT_CAPTURE else
        "NONZERO_HARD_NEGATIVE_CONTAMINATION" if hard_neg or cross_family else
        "ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION"
    )
    return {
        "same_event_capture": capture,
        "same_event_capture_rate": obs["same_event_capture_rate"],
        "related_topic_cluster_contamination": obs["related_topic_cluster_contamination"],
        "different_event_cluster_contamination": obs["different_event_cluster_contamination"],
        "cluster_hard_negative_contamination_count": hard_neg,
        "false_family_merge_count": obs["false_family_merge_count"],
        "cross_family_cluster_count": cross_family,
        "multi_article_story_count": sum(len(c) > 1 for c in clusters),
        "total_articles_clustered": sum(len(c) for c in clusters if len(c) > 1),
        "family_fragmentation_breakdown": fragmentation,
        "family_capture_breakdown": breakdown,
        "family_macro_recall": round(float(np.mean([b["recall"] for b in breakdown.values()])), 4) if breakdown else 0.0,
        "non_duo_pair_recall": round(non_duo_capture / non_duo_total, 4) if non_duo_total else 0.0,
        "non_duo_family_macro_recall": round(float(np.mean([breakdown[name]["recall"] for name in non_duo])), 4) if non_duo else 0.0,
        "safety_classification": safety,
    }


def evaluate_direct_frontier(scorer_result, gold_rows, published_lookup):
    """Fixed-threshold research descriptions, distinct from pooled OOF estimates."""
    scores = {
        tuple(sorted((int(row["entry_a_id"]), int(row["entry_b_id"])))): float(row[scorer_result["feature_key"]])
        for row in gold_rows
    }
    articles = {aid for pair in scores for aid in pair}
    evaluations = {}
    for name in OPERATING_POINT_NAMES:
        threshold = scorer_result["research_operating_points"][name]
        clusters = cluster_with_p3(articles, scores, threshold, published_lookup, max_temporal_span_hours=24.0)
        evaluations[name] = {
            "operating_point": name, "threshold": threshold,
            "metrics_basis": "FIXED_THRESHOLD_RESEARCH_P3_NOT_POOLED_OOF",
            **evaluate_partition_safety(clusters, gold_rows),
        }
    return {"scorer_name": scorer_result["scorer_name"], "operating_points": evaluations}


def evaluate_pf1_oof_cluster_safety(oof_predictions, gold_rows, published_lookup):
    """OOF_BINARY_EDGE_P3: evaluation construct, never a global learned operating point.

    Only each pair's held-out binary decision becomes an edge. All positive
    edges have equal weight; canonical article IDs break ties. Cross-fold
    probabilities are neither sorted nor thresholded together.
    """
    # Preserve temporal constraints when replaying the runner's saved JSON.
    published_lookup = {int(aid): float(value) for aid, value in published_lookup.items()}
    expected = {row["pair_key"] for row in gold_rows}
    keys = [row["pair_key"] for row in oof_predictions]
    if len(keys) != len(set(keys)) or set(keys) != expected:
        raise ValueError("PF1 OOF decisions must cover every Gold pair exactly once")
    if any(row["pred"] not in (0, 1) for row in oof_predictions):
        raise ValueError("PF1 OOF decisions must be binary")
    scores = {}
    for row in oof_predictions:
        pair = tuple(sorted((int(row["entry_a_id"]), int(row["entry_b_id"]))))
        if row["pair_key"] != f"{pair[0]}:{pair[1]}":
            raise ValueError("PF1 OOF pair key does not match its article IDs")
        if row["pred"] == 1:
            scores[pair] = 1.0
    articles = {int(row[key]) for row in gold_rows for key in ("entry_a_id", "entry_b_id")}
    # 0.5 distinguishes binary presence/absence; it is not a PF1 score threshold.
    clusters = cluster_with_p3(articles, scores, 0.5, published_lookup, max_temporal_span_hours=24.0)
    return {
        "cluster_evaluation": "OOF_BINARY_EDGE_P3",
        "deployable_global_operating_point": False,
        "edge_order": "EQUAL_BINARY_WEIGHT_THEN_CANONICAL_ARTICLE_IDS",
        "positive_oof_edge_count": len(scores),
        **evaluate_partition_safety(clusters, gold_rows),
    }


def qualifies_for_integration(point):
    """Require conservative safety AND existing minimum useful coverage."""
    return (
        point["same_event_capture"] >= MIN_SAME_EVENT_CAPTURE
        and point["safety_classification"] != "TOO_LOW_COVERAGE"
        and point["false_family_merge_count"] == 0
        and point["cross_family_cluster_count"] == 0
        and point["cluster_hard_negative_contamination_count"] == 0
    )


def pareto_operating_points(points):
    """Pareto dominance across explicit dimensions, without a scalar loss."""
    def dimensions(point):
        return (
            -point["false_family_merge_count"], -point["cross_family_cluster_count"],
            -point["cluster_hard_negative_contamination_count"], point["same_event_capture"],
            point["family_macro_recall"], point["non_duo_pair_recall"],
            point["non_duo_family_macro_recall"], point["scorer"] == "D0_DIRECT_LEXICAL",
        )
    return [point for point in points if not any(
        all(x >= y for x, y in zip(dimensions(other), dimensions(point)))
        and any(x > y for x, y in zip(dimensions(other), dimensions(point)))
        for other in points
    )]


def select_research_provider(points):
    """R1 recommends only qualifying existing direct operating points for A3."""
    qualifying = [point for point in points
                  if point["scorer"] in ("D0_DIRECT_LEXICAL", "D1_DIRECT_QWEN")
                  and qualifies_for_integration(point)]
    if not qualifying:
        return {
            "qualifying_operating_points": [],
            "research_recommendation": "NO_CLEAR_WINNER",
            "scoreprovider_selection": "DEFERRED_NO_CLEAR_WINNER",
            "lightweight_model_artifact_decision_required": "DEFERRED",
            "next_recommended_track": "MORE_SCORER_RESEARCH",
            "why": "No D0/D1 point combines zero family/cross-family/hard-negative merges with capture >= 15; PF1 binary-edge clustering is evaluation-only.",
        }
    # Safety is a hard prerequisite, then compare in the PM's stated order.
    winner = max(qualifying, key=lambda p: (
        p["same_event_capture"], p["family_macro_recall"], p["non_duo_pair_recall"],
        p["non_duo_family_macro_recall"], p["scorer"] == "D0_DIRECT_LEXICAL",
    ))
    return {
        "qualifying_operating_points": [f"{p['scorer']}:{p['operating_point']}" for p in qualifying],
        "research_recommendation": "QUALIFYING_DIRECT_OPERATING_POINT",
        "scoreprovider_selection": winner["scorer"],
        "selected_operating_point": winner["operating_point"],
        "lightweight_model_artifact_decision_required": "NO",
        "next_recommended_track": "STORY_02_A3_PROVIDER_INTEGRATION",
        "why": "Zero observed safety violations and sufficient coverage; ordered by capture, family macro recall, non-Duo robustness, then runtime simplicity. Research recommendation only.",
    }


def audit_frozen_folds(fold_data, gold_rows):
    """Verify measured disjointness/coverage, preserving the existing assignments."""
    all_keys = [row["pair_key"] for fold in fold_data for row in fold["rows"]]
    expected = {row["pair_key"] for row in gold_rows}
    if len(all_keys) != len(set(all_keys)) or set(all_keys) != expected:
        raise AssertionError("PAIR_LEAKAGE_OR_COVERAGE_FAILURE")
    family_sets = [{row["episode_family_id"] for row in fold["rows"] if row["gold_label"] == "SAME_EVENT"} for fold in fold_data]
    for i, fold in enumerate(fold_data):
        for j in range(i):
            if fold["articles"] & fold_data[j]["articles"]:
                raise AssertionError("ARTICLE_LEAKAGE_DETECTED")
            if family_sets[i] & family_sets[j]:
                raise AssertionError("FAMILY_LEAKAGE_DETECTED")
    assignments = [
        {"fold": fold["fold_idx"], "components": fold["components"],
         "pair_keys": sorted(row["pair_key"] for row in fold["rows"])}
        for fold in fold_data
    ]
    return hashlib.sha256(json.dumps(assignments, sort_keys=True).encode()).hexdigest()


def write_private_results(results, output_path):
    """Full predictions/labels stay outside the repository, including symlink targets."""
    path = Path(output_path).resolve()
    repo_root = CUR_DIR.parents[2].resolve()
    if path.is_relative_to(repo_root):
        raise ValueError("Private benchmark output must stay outside the repository")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
        json.dump(results, handle, indent=2, sort_keys=True)
        handle.write("\n")


def compute_file_sha256(path: str | Path) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def verify_input_artifacts() -> Dict[str, Any]:
    """Verifies all input artifacts fail-fast against expected SHA256 hashes."""
    checks = {
        "human_labels": (CANONICAL_HUMAN_LABELS_PATH, EXPECTED_HUMAN_LABELS_SHA256),
        "annotation_pack": (CANONICAL_ANNOTATION_PACK_PATH, EXPECTED_ANNOTATION_PACK_SHA256),
        "sidecar": (CANONICAL_SIDECAR_PATH, EXPECTED_SIDECAR_SHA256),
        "gold_v1": (CANONICAL_GOLD_V1_PATH, EXPECTED_GOLD_V1_SHA256),
        "home_200": (CANONICAL_HOME200_PATH, EXPECTED_HOME200_SHA256),
    }

    results = {}
    for name, (path, exp_sha) in checks.items():
        if not os.path.exists(path):
            raise FileNotFoundError(f"Required artifact {name} missing at {path}")
        act_sha = compute_file_sha256(path)
        if act_sha != exp_sha:
            raise ValueError(f"Artifact {name} SHA256 mismatch: expected {exp_sha}, got {act_sha}")
        results[name] = {"path": str(path), "sha256": act_sha, "gate": "PASS"}

    # Human label rows & decision source verification
    with open(CANONICAL_HUMAN_LABELS_PATH, "r", encoding="utf-8") as f:
        r = list(csv.DictReader(f))
        if len(r) != 77:
            raise ValueError(f"Expected 77 human decisions, got {len(r)}")
        for row in r:
            if row.get("decision_source") != "EXPLICIT_USER_DECISION":
                raise ValueError(f"Invalid decision source: {row.get('decision_source')}")

    results["human_label_count"] = 77
    results["decision_source_gate"] = "PASS"
    return results


def load_gold_v2_materialized(
    corpus_lookup: Optional[Dict[int, Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Loads Gold V2 dataset and materializes all 25 features for all 233 pairs."""
    if not GOLD_V2_CSV_PATH.exists():
        raise FileNotFoundError(f"Gold V2 CSV not found at {GOLD_V2_CSV_PATH}")

    act_v2_sha = compute_file_sha256(GOLD_V2_CSV_PATH)
    if act_v2_sha != EXPECTED_GOLD_V2_SHA256:
        raise ValueError(f"Gold V2 SHA256 mismatch: expected {EXPECTED_GOLD_V2_SHA256}, got {act_v2_sha}")

    # Load corpus if not provided
    if corpus_lookup is None:
        corpus_lookup = {}
        with open(CANONICAL_CORPUS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    e = json.loads(line)
                    corpus_lookup[int(e["id"])] = e

    # Load pre-computed features from Gold V1
    v1_rows, _ = load_and_materialize_features(gold_path=CANONICAL_GOLD_V1_PATH)
    v1_map = {r["pair_key"]: r for r in v1_rows}

    # Load sidecar features
    with open(CANONICAL_SIDECAR_PATH, "r", encoding="utf-8") as f:
        sidecar = json.load(f)
    sidecar_dict = {p["pair_key"]: p for p in sidecar["candidate_pairs"]}

    # Load Gold V2 raw rows
    with open(GOLD_V2_CSV_PATH, "r", encoding="utf-8") as f:
        gold_v2_raw = list(csv.DictReader(f))

    validate_gold_schema_and_invariants(
        gold_v2_raw,
        expected_pair_count=233,
        expected_article_count=153,
        expected_class_counts={"SAME_EVENT": 57, "RELATED_TOPIC": 27, "DIFFERENT_EVENT": 149, "UNCERTAIN": 0},
        expected_family_count=10,
    )

    materialized_rows: List[Dict[str, Any]] = []
    for r in gold_v2_raw:
        pk = r["pair_key"]
        if pk in v1_map:
            materialized_rows.append(v1_map[pk])
        else:
            # New human label row: extract lexical + sidecar semantic features
            a_id = int(r["entry_a_id"])
            b_id = int(r["entry_b_id"])
            sc = sidecar_dict[pk]
            pair_row = {
                "pair_key": pk,
                "id_a": a_id,
                "id_b": b_id,
                "feed_id_a": corpus_lookup[a_id]["feed_id"],
                "feed_id_b": corpus_lookup[b_id]["feed_id"],
                "entry_a_id": str(a_id),
                "entry_b_id": str(b_id),
                "title_a": r["title_a"],
                "title_b": r["title_b"],
                "feed_a": r["feed_a"],
                "feed_b": r["feed_b"],
                "published_at_a": r["published_at_a"],
                "published_at_b": r["published_at_b"],
                "gold_label": r["gold_label"],
                "episode_family_id": "",
                "target_binary": 0,
            }
            feats = FeatureExtractor.extract_features(pair_row, corpus_lookup=corpus_lookup)
            feats["entry_a_id"] = str(a_id)
            feats["entry_b_id"] = str(b_id)
            feats["gold_label"] = r["gold_label"]
            feats["episode_family_id"] = ""
            feats["target_binary"] = 0
            feats["qwen_embedding_cosine"] = sc["blinded_features"]["qwen_embedding_cosine"]
            feats["mistral_embedding_cosine"] = sc["blinded_features"]["mistral_embedding_cosine"]
            materialized_rows.append(feats)

    meta = {
        "gold_v2_path": str(GOLD_V2_CSV_PATH),
        "gold_v2_sha256": act_v2_sha,
        "pair_count": len(materialized_rows),
        "unique_articles": len({r["entry_a_id"] for r in materialized_rows} | {r["entry_b_id"] for r in materialized_rows}),
    }
    return materialized_rows, meta


def compute_component_bootstrap_ci(
    oof_predictions: List[Dict[str, Any]],
    comp_map: Dict[str, Any],
    n_boot: int = 1000,
    seed: int = 42,
) -> Dict[str, Tuple[float, float]]:
    """Computes 95% bootstrap confidence intervals grouped by connected component."""
    pair_to_comp = {}
    for cid, c in comp_map.items():
        for p in c["pairs"]:
            pk = f"{min(int(p['entry_a_id']), int(p['entry_b_id']))}:{max(int(p['entry_a_id']), int(p['entry_b_id']))}"
            pair_to_comp[pk] = cid

    comps = list(comp_map.keys())
    by_comp = {cid: [] for cid in comps}
    for p in oof_predictions:
        cid = pair_to_comp.get(p["pair_key"])
        if cid:
            by_comp[cid].append(p)

    rng = random.Random(seed)
    metrics: Dict[str, List[float]] = {"precision": [], "recall": [], "f05": [], "rt_fpr": [], "de_fpr": []}

    for _ in range(n_boot):
        sample_comps = [rng.choice(comps) for _ in range(len(comps))]
        sample_preds = []
        for c in sample_comps:
            sample_preds.extend(by_comp[c])

        y_true = [p["target_binary"] for p in sample_preds]
        y_pred = [p["pred"] for p in sample_preds]
        labels = [p["gold_label"] for p in sample_preds]

        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f05 = (1.25 * prec * rec) / (0.25 * prec + rec) if (0.25 * prec + rec) > 0 else 0.0

        rt_tot = sum(1 for l in labels if l == "RELATED_TOPIC")
        rt_fp = sum(1 for l, yp in zip(labels, y_pred) if l == "RELATED_TOPIC" and yp == 1)
        rt_fpr = rt_fp / rt_tot if rt_tot > 0 else 0.0

        de_tot = sum(1 for l in labels if l == "DIFFERENT_EVENT")
        de_fp = sum(1 for l, yp in zip(labels, y_pred) if l == "DIFFERENT_EVENT" and yp == 1)
        de_fpr = de_fp / de_tot if de_tot > 0 else 0.0

        metrics["precision"].append(prec)
        metrics["recall"].append(rec)
        metrics["f05"].append(f05)
        metrics["rt_fpr"].append(rt_fpr)
        metrics["de_fpr"].append(de_fpr)

    ci = {}
    for k, vals in metrics.items():
        ci[k] = (round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4))
    return ci


def evaluate_retrieval_coverage(
    raw_articles: List[Dict[str, Any]],
    article_tokens: Dict[int, Set[str]],
    gold_rows: List[Dict[str, Any]],
    qwen_pair_scores: Dict[Tuple[int, int], float],
) -> Dict[str, Any]:
    """Evaluates candidate retrieval coverage of Gold V2 pairs under RF0R and RF1."""
    same_gold = [r for r in gold_rows if r["gold_label"] == "SAME_EVENT"]
    rel_gold = [r for r in gold_rows if r["gold_label"] == "RELATED_TOPIC"]
    diff_gold = [r for r in gold_rows if r["gold_label"] == "DIFFERENT_EVENT"]

    def get_pk(r: Dict[str, Any]) -> str:
        u = min(int(r["entry_a_id"]), int(r["entry_b_id"]))
        v = max(int(r["entry_a_id"]), int(r["entry_b_id"]))
        return f"{u}:{v}"

    # RF0R K=10
    rf0r_cands, _ = retrieve_candidates_rf0r(raw_articles, article_tokens, k_retrieval=10)
    rf0r_keys = {f"{u}:{v}" for u, v in rf0r_cands}

    rf0r_same = sum(1 for r in same_gold if get_pk(r) in rf0r_keys)
    rf0r_rel = sum(1 for r in rel_gold if get_pk(r) in rf0r_keys)
    rf0r_diff = sum(1 for r in diff_gold if get_pk(r) in rf0r_keys)

    # RF1 K=10
    feed_lookup = {int(a["id"]): get_feed_identity(a) for a in raw_articles}
    art_cands: Dict[int, List[Tuple[float, str, Tuple[int, int]]]] = defaultdict(list)
    for (u, v), sc in qwen_pair_scores.items():
        fu, fv = feed_lookup.get(u), feed_lookup.get(v)
        if fu and fv and fu != fv:
            pk = f"{u}:{v}"
            art_cands[u].append((sc, pk, (u, v)))
            art_cands[v].append((sc, pk, (u, v)))

    rf1_keys = set()
    for a in raw_articles:
        aid = int(a["id"])
        cands = art_cands.get(aid, [])
        sorted_cands = sorted(cands, key=lambda c: (-c[0], c[1]))[:10]
        for _, pk, _ in sorted_cands:
            rf1_keys.add(pk)

    rf1_same = sum(1 for r in same_gold if get_pk(r) in rf1_keys)
    rf1_rel = sum(1 for r in rel_gold if get_pk(r) in rf1_keys)
    rf1_diff = sum(1 for r in diff_gold if get_pk(r) in rf1_keys)

    return {
        "rf0r_lexical_k10": {
            "retrieved_candidate_count": len(rf0r_keys),
            "gold_same_retrieved": rf0r_same,
            "gold_same_not_retrieved": len(same_gold) - rf0r_same,
            "gold_same_total": len(same_gold),
            "gold_related_retrieved": rf0r_rel,
            "gold_related_total": len(rel_gold),
            "gold_different_retrieved": rf0r_diff,
            "gold_different_total": len(diff_gold),
        },
        "rf1_qwen_k10": {
            "retrieved_candidate_count": len(rf1_keys),
            "gold_same_retrieved": rf1_same,
            "gold_same_not_retrieved": len(same_gold) - rf1_same,
            "gold_same_total": len(same_gold),
            "gold_related_retrieved": rf1_rel,
            "gold_related_total": len(rel_gold),
            "gold_different_retrieved": rf1_diff,
            "gold_different_total": len(diff_gold),
        },
    }


def run_gold_v2_benchmark() -> Dict[str, Any]:
    """Full execution of Gold V2 freeze audit, leak-free benchmarking, and handoff generation."""
    # Step 1: Input verification
    input_results = verify_input_artifacts()

    # Step 2: Load corpus and Home-200
    with open(CANONICAL_HOME200_PATH, "r", encoding="utf-8") as f:
        home_articles = [json.loads(line) for line in f if line.strip()]

    corpus_lookup: Dict[int, Dict[str, Any]] = {}
    with open(CANONICAL_CORPUS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                e = json.loads(line)
                corpus_lookup[int(e["id"])] = e

    # Step 3: Materialize Gold V2
    gold_v2_rows, gold_v2_meta = load_gold_v2_materialized(corpus_lookup=corpus_lookup)

    # Step 4: Graph topology & Split Feasibility
    graph = ArticleGraph(gold_v2_rows)
    comp_details = graph.get_component_details()
    comp_map = {c["component_id"]: c for c in comp_details}

    p_a_3 = simulate_protocol_a(graph, 3)

    # Build fold_data for 3-fold
    fold_data = []
    for f_info in p_a_3["folds"]:
        fold_articles = set()
        fold_pairs = []
        for cid in f_info["components"]:
            c = comp_map[cid]
            fold_articles.update(c["nodes"])
            for p in c["pairs"]:
                pk = f"{min(int(p['entry_a_id']), int(p['entry_b_id']))}:{max(int(p['entry_a_id']), int(p['entry_b_id']))}"
                matching = [r for r in gold_v2_rows if r["pair_key"] == pk]
                fold_pairs.extend(matching)

        fold_data.append({
            "fold_idx": f_info["fold"],
            "components": f_info["components"],
            "articles": fold_articles,
            "rows": fold_pairs,
        })

    fold_assignment_sha = audit_frozen_folds(fold_data, gold_v2_rows)

    # Step 5: Benchmark D0
    d0_res = evaluate_direct_scorer_3fold("D0_DIRECT_LEXICAL", "title_overlap_coefficient", fold_data)
    ci_d0 = compute_component_bootstrap_ci(d0_res["oof_predictions"], comp_map)

    # Step 6: Benchmark D1
    d1_res = evaluate_direct_scorer_3fold("D1_DIRECT_QWEN", "qwen_embedding_cosine", fold_data)
    ci_d1 = compute_component_bootstrap_ci(d1_res["oof_predictions"], comp_map)
    for res in (d0_res, d1_res):
        res["oof_threshold_strategy"] = OOF_THRESHOLD_STRATEGY
        res["oof_metrics_basis"] = "POOLED_FOLD_SPECIFIC_BINARY_DECISIONS"
        res["research_operating_point_basis"] = "STRICT_MAX_MEDIAN_MEDIAN_PERMISSIVE_MIN_FOLD_THRESHOLDS"

    # Step 7: Benchmark PF1
    tracker = LeakageTracker(total_gold_count=233)
    pf1_res = evaluate_outer_3fold_leak_free(
        "PF1_LEXICAL_PLUS_QWEN",
        PF1_QWEN_FEATURES,
        fold_data,
        seed=DEFAULT_SEED,
        tracker=tracker,
        total_gold_count=233,
    )
    ci_pf1 = compute_component_bootstrap_ci(pf1_res["oof_predictions"], comp_map)
    pf1_res["oof_threshold_strategy"] = OOF_THRESHOLD_STRATEGY
    pf1_res["oof_metrics_basis"] = "POOLED_FOLD_SPECIFIC_BINARY_DECISIONS"
    pf1_res["pooled_probability_calibration"] = "NOT_GLOBALLY_CALIBRATED_ACROSS_OUTER_MODELS"

    # Step 8: Downstream Cluster Safety on Gold V2 Subgraph
    published_lookup = {int(a["id"]): float(a.get("published_at", 0.0)) for a in home_articles}
    d0_safety = evaluate_direct_frontier(d0_res, gold_v2_rows, published_lookup)
    d1_safety = evaluate_direct_frontier(d1_res, gold_v2_rows, published_lookup)
    pf1_safety = evaluate_pf1_oof_cluster_safety(pf1_res["oof_predictions"], gold_v2_rows, published_lookup)

    # Step 9: Retrieval Coverage
    article_tokens: Dict[int, Set[str]] = {}
    for a in home_articles:
        aid = int(a["id"])
        feed_title = a.get("feed_title", a.get("feed", ""))
        article_tokens[aid] = extract_significant_words(a.get("title", ""), feed_title)

    qwen_pair_scores: Dict[Tuple[int, int], float] = {}
    with open(CANONICAL_PAIRS_PATH, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            u = min(int(r["id_a"]), int(r["id_b"]))
            v = max(int(r["id_a"]), int(r["id_b"]))
            qwen_pair_scores[(u, v)] = float(r.get("qwen_score", 0.0))

    retrieval_cov = evaluate_retrieval_coverage(home_articles, article_tokens, gold_v2_rows, qwen_pair_scores)

    # Step 10: All six fixed-threshold shadows, including disqualified points
    # for transparency. No model is fitted on full Gold or activated in runtime.
    home_frontiers = {"d0": {}, "d1": {}}
    for scorer, res in (("d0", d0_res), ("d1", d1_res)):
        for name in OPERATING_POINT_NAMES:
            threshold = res["research_operating_points"][name]
            if scorer == "d0":
                proj, stats, _ = execute_d0_raw_pipeline_on_home200(
                    home_articles, threshold=threshold, k_retrieval=10, max_temporal_span_hours=24.0)
            else:
                proj, stats, _ = execute_d1_retrieved_pipeline_on_home200(
                    home_articles, qwen_pair_scores, threshold=threshold, k_retrieval=10, max_temporal_span_hours=24.0)
            home_frontiers[scorer][name] = {
                "threshold": threshold, "stats": stats,
                "top_rank_count_basis": "H1_ORIGINAL_HOME_MEMBER_POSITION",
                "observation": evaluate_full_home_gold_observation(proj, gold_v2_rows),
            }

    frontier = [
        {"scorer": safety["scorer_name"], **metrics}
        for safety in (d0_safety, d1_safety)
        for metrics in safety["operating_points"].values()
    ]
    results = {
        "research_version": "STORY_02_A2C_R1",
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__, "scikit_learn": version("scikit-learn")},
        "original_a2c_baseline": ORIGINAL_A2C_BASELINE,
        "input_results": input_results,
        "gold_v2_meta": gold_v2_meta,
        "split": {
            "strategy": "COMPONENT_GROUP_3FOLD",
            "folds": len(fold_data),
            "article_leakage": "ZERO",
            "pair_leakage": "ZERO",
            "family_leakage": "ZERO",
            "fold_assignment_sha256": fold_assignment_sha,
            "fold_pair_counts": [len(f["rows"]) for f in fold_data],
            "fold_component_assignments": [f["components"] for f in fold_data],
            "related_coverage_gate": "PASS" if p_a_3["all_related_topic_present"] else "FAIL",
            "different_coverage_gate": "PASS" if p_a_3["all_different_event_present"] else "FAIL",
        },
        "d0": d0_res,
        "d0_ci": ci_d0,
        "d0_safety": d0_safety,
        "d0_home_stats": home_frontiers["d0"]["STRICT"]["stats"],
        "d0_home_obs": home_frontiers["d0"]["STRICT"]["observation"],
        "d0_home_frontier": home_frontiers["d0"],
        "d1": d1_res,
        "d1_ci": ci_d1,
        "d1_safety": d1_safety,
        "d1_home_stats": home_frontiers["d1"]["STRICT"]["stats"],
        "d1_home_obs": home_frontiers["d1"]["STRICT"]["observation"],
        "d1_home_frontier": home_frontiers["d1"],
        "pf1": pf1_res,
        "pf1_ci": ci_pf1,
        "pf1_safety": pf1_safety,
        "pf1_fit_audit": {
            "fit_calls": tracker.fit_calls,
            "full_gold_final_fit": "NO" if tracker.full_gold_fits == 0 else "YES",
            "production_model_artifact": "NO",
        },
        "published_lookup": published_lookup,
        "frontier": frontier,
        "pareto_frontier": pareto_operating_points(frontier),
        "decision": select_research_provider(frontier),
        "uncertainty_basis": "COMPONENT_BOOTSTRAP_OF_FIXED_OOF_BINARY_DECISIONS_1000_DRAWS_SEED_42",
        "uncertainty_limitations": "Descriptive percentile intervals; not nested refit/threshold uncertainty. Giant component dominates. Existing zero-denominator draws yield zero.",
        "retrieval_coverage": retrieval_cov,
    }
    results["research_output"] = make_research_output(results)
    return results


def make_research_output(results):
    """Decision-critical handoff values are emitted by the versioned runner."""
    pf1 = results["pf1_safety"]
    output = {
        "PF1_CLUSTER_EVALUATION": pf1["cluster_evaluation"],
        "PF1_RELATED_CLUSTER_CONTAMINATION": pf1["related_topic_cluster_contamination"],
        "PF1_DIFFERENT_CLUSTER_CONTAMINATION": pf1["different_event_cluster_contamination"],
        "PF1_HARD_NEGATIVE_CLUSTER_CONTAMINATION": pf1["cluster_hard_negative_contamination_count"],
        "PF1_FALSE_FAMILY_MERGES": pf1["false_family_merge_count"],
        "PF1_CROSS_FAMILY_CLUSTERS": pf1["cross_family_cluster_count"],
        "PF1_SAME_EVENT_CAPTURE": pf1["same_event_capture"],
        "PF1_FAMILY_FRAGMENTATION": pf1["family_fragmentation_breakdown"],
        "FULL_GOLD_FINAL_FIT": results["pf1_fit_audit"]["full_gold_final_fit"],
        "PRODUCTION_MODEL_ARTIFACT": "NO",
        "GOLD_V2_SHA256": results["gold_v2_meta"]["gold_v2_sha256"],
        "OOF_THRESHOLD_STRATEGY": OOF_THRESHOLD_STRATEGY,
        "ENVIRONMENT": results["environment"],
        "ORIGINAL_A2C_BASELINE": results["original_a2c_baseline"],
        "SAFETY_FIRST_FRONTIER": results["frontier"],
        "PARETO_FRONTIER": results["pareto_frontier"],
        "DECISION": results["decision"],
    }
    for scorer in ("d0", "d1", "pf1"):
        for metric, ci_key in (("PRECISION", "precision"), ("RECALL", "recall"), ("F05", "f05"), ("RELATED_FPR", "rt_fpr"), ("DIFFERENT_FPR", "de_fpr")):
            output[f"{scorer.upper()}_{metric}_CI95"] = results[scorer + "_ci"][ci_key]
    for scorer in ("d0", "d1"):
        output[f"{scorer.upper()}_FOLD_THRESHOLDS"] = results[scorer]["thresholds_by_fold"]
        output[f"{scorer.upper()}_THRESHOLD_SUMMARY"] = results[scorer]["threshold_summary"]
        output[f"{scorer.upper()}_OOF_METRICS_BASIS"] = results[scorer]["oof_metrics_basis"]
        output[f"{scorer.upper()}_HOME_FRONTIER"] = results[scorer + "_home_frontier"]
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Private JSON destination outside the repository")
    args = parser.parse_args()
    if args.output and args.output.resolve().is_relative_to(CUR_DIR.parents[2].resolve()):
        parser.error("Private benchmark output must stay outside the repository")
    results = run_gold_v2_benchmark()
    if args.output:
        write_private_results(results, args.output)
    print(json.dumps(results["research_output"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
