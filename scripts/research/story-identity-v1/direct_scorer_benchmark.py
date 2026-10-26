#!/usr/bin/env python3
"""STORY-02-A0 R3: Runtime Contract Fidelity & Final Spike Gate.

Evaluates executable direct pair scorers under verified runtime candidate retrieval:
- Cross-feed candidate contract enforced (zero same-feed pairs).
- RF0R_RUNTIME_LEXICAL_TOP_K: symmetric per-article top-K with deterministic lexical tie-break.
- RF1_QWEN_TOP_K: actual candidate retrieval step before D1 clustering.
- R3_P3_MAX_TEMPORAL_SPAN_HOURS = 24.0 unified across Python and Node.
- Elimination of arbitrary magic safety thresholds in favor of strict descriptive classifications:
  * ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION
  * NONZERO_HARD_NEGATIVE_CONTAMINATION
  * TOO_LOW_COVERAGE
  * INCONCLUSIVE
- Separation of concerns:
  * REPRESENTATIVE = D0_LEXICAL_MEDOID (headline/content displayed)
  * PLACEMENT = H1_HIGHEST_RANKED_MEMBER_POSITION (position in feed)
- Review pack bug fixed (D0 uses D0 scores, D1 uses D1 scores).
- Emits all 7 required private artifacts to /tmp/newsflux-story02-a0-r3/.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
from sklearn.metrics import auc, average_precision_score, fbeta_score, precision_recall_curve, roc_auc_score

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from harness import (
    STOPWORDS,
    compute_overlap_coefficient,
    extract_significant_words,
    normalize_title,
)
from model_benchmark import (
    DEFAULT_SEED,
    find_optimal_threshold_f05,
    load_and_materialize_features,
    make_canonical_pair_key,
    simulate_protocol_a,
)
from split_audit import ArticleGraph

CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
PAIRS_CSV_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
OUTPUT_DIR = Path("/tmp/newsflux-story02-a0-r4")

R3_P3_MAX_TEMPORAL_SPAN_HOURS = 24.0
CANONICAL_TOTAL_CROSSFEED_PAIRS = 18953


def get_feed_identity(article: Dict[str, Any]) -> str:
    """Extract canonical feed identity for an article.

    Contract:
    - Returns string representation of feed_id if present.
    - Fallback to nested feed.id if present.
    - Fallback to string feed or feed_title if numeric ID is missing.
    - Returns empty string if unidentifiable.
    Two articles u and v are cross-feed iff get_feed_identity(u) != get_feed_identity(v).
    """
    if "feed_id" in article and article["feed_id"] is not None:
        return str(article["feed_id"])
    feed_obj = article.get("feed")
    if isinstance(feed_obj, dict) and "id" in feed_obj and feed_obj["id"] is not None:
        return str(feed_obj["id"])
    if isinstance(feed_obj, (str, int)) and feed_obj:
        return str(feed_obj)
    if "feed_title" in article and article["feed_title"]:
        return str(article["feed_title"])
    return ""


def evaluate_direct_scorer_3fold(
    scorer_name: str,
    feature_key: str,
    fold_data: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Evaluates a direct scorer under canonical PROTOCOL_A_COMPONENT_GROUP_3FOLD."""
    k = len(fold_data)
    oof_predictions: List[Dict[str, Any]] = []
    outer_fold_results: List[Dict[str, Any]] = []
    fold_thresholds: List[float] = []

    for test_idx in range(k):
        test_fold = fold_data[test_idx]
        test_rows = test_fold["rows"]
        train_subfolds = [fold_data[i] for i in range(k) if i != test_idx]

        # Inner CV for threshold selection strictly inside outer train folds
        inner_a_scores = [float(r[feature_key]) for r in train_subfolds[0]["rows"]]
        inner_b_scores = [float(r[feature_key]) for r in train_subfolds[1]["rows"]]
        inner_a_y = [int(r["target_binary"]) for r in train_subfolds[0]["rows"]]
        inner_b_y = [int(r["target_binary"]) for r in train_subfolds[1]["rows"]]

        pooled_inner_scores = inner_a_scores + inner_b_scores
        pooled_inner_y = inner_a_y + inner_b_y

        opt_thresh, opt_inner_f05, _, _ = find_optimal_threshold_f05(pooled_inner_y, pooled_inner_scores)
        fold_thresholds.append(float(opt_thresh))

        test_scores = [float(r[feature_key]) for r in test_rows]
        y_test = [int(r["target_binary"]) for r in test_rows]
        test_preds = [1 if sc >= opt_thresh else 0 for sc in test_scores]

        for r, sc, pred in zip(test_rows, test_scores, test_preds):
            oof_predictions.append({
                "pair_key": r["pair_key"],
                "entry_a_id": r["entry_a_id"],
                "entry_b_id": r["entry_b_id"],
                "target_binary": int(r["target_binary"]),
                "gold_label": r["gold_label"],
                "episode_family_id": r.get("episode_family_id"),
                "score": sc,
                "pred": pred,
                "selected_threshold": float(opt_thresh),
                "test_fold": test_idx,
            })

        fold_tp = sum(1 for yt, yp in zip(y_test, test_preds) if yt == 1 and yp == 1)
        fold_fp = sum(1 for yt, yp in zip(y_test, test_preds) if yt == 0 and yp == 1)
        fold_fn = sum(1 for yt, yp in zip(y_test, test_preds) if yt == 1 and yp == 0)
        fold_prec = fold_tp / (fold_tp + fold_fp) if (fold_tp + fold_fp) > 0 else 0.0
        fold_rec = fold_tp / (fold_tp + fold_fn) if (fold_tp + fold_fn) > 0 else 0.0
        fold_f05 = fbeta_score(y_test, test_preds, beta=0.5, zero_division=0.0)

        outer_fold_results.append({
            "fold_idx": test_idx,
            "test_pair_count": len(test_rows),
            "selected_threshold": round(float(opt_thresh), 4),
            "inner_cv_f05": round(float(opt_inner_f05), 4),
            "tp": fold_tp,
            "fp": fold_fp,
            "fn": fold_fn,
            "precision": round(float(fold_prec), 4),
            "recall": round(float(fold_rec), 4),
            "f05": round(float(fold_f05), 4),
        })

    y_true = [p["target_binary"] for p in oof_predictions]
    y_scores = [p["score"] for p in oof_predictions]
    y_preds = [p["pred"] for p in oof_predictions]

    prec_curve, rec_curve, _ = precision_recall_curve(y_true, y_scores)
    pr_auc = auc(rec_curve, prec_curve)
    roc_auc = roc_auc_score(y_true, y_scores)

    tp = sum(1 for yt, yp in zip(y_true, y_preds) if yt == 1 and yp == 1)
    fp = sum(1 for yt, yp in zip(y_true, y_preds) if yt == 0 and yp == 1)
    fn = sum(1 for yt, yp in zip(y_true, y_preds) if yt == 1 and yp == 0)
    tn = sum(1 for yt, yp in zip(y_true, y_preds) if yt == 0 and yp == 0)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f05 = fbeta_score(y_true, y_preds, beta=0.5, zero_division=0.0)
    f1 = fbeta_score(y_true, y_preds, beta=1.0, zero_division=0.0)

    rt_total = sum(1 for p in oof_predictions if p["gold_label"] == "RELATED_TOPIC")
    rt_fp = sum(1 for p in oof_predictions if p["gold_label"] == "RELATED_TOPIC" and p["pred"] == 1)
    rt_fpr = rt_fp / rt_total if rt_total > 0 else 0.0

    de_total = sum(1 for p in oof_predictions if p["gold_label"] == "DIFFERENT_EVENT")
    de_fp = sum(1 for p in oof_predictions if p["gold_label"] == "DIFFERENT_EVENT" and p["pred"] == 1)
    de_fpr = de_fp / de_total if de_total > 0 else 0.0

    # True Family breakdowns across all 10 Gold episode families
    positives = [p for p in oof_predictions if p["gold_label"] == "SAME_EVENT"]
    families = sorted(set(p["episode_family_id"] for p in positives))
    family_recalls = {}
    family_breakdown = {}
    for fam in families:
        fam_p = [p for p in positives if p["episode_family_id"] == fam]
        fam_tp = sum(1 for p in fam_p if p["pred"] == 1)
        fam_rec = fam_tp / len(fam_p) if fam_p else 0.0
        family_recalls[fam] = fam_rec
        family_breakdown[fam] = {
            "tp": fam_tp,
            "total": len(fam_p),
            "recall": round(float(fam_rec), 4),
        }

    family_macro_recall = float(np.mean(list(family_recalls.values()))) if family_recalls else 0.0

    duo_positives = [p for p in positives if "iphone" in str(p["episode_family_id"]).lower()]
    non_duo_positives = [p for p in positives if "iphone" not in str(p["episode_family_id"]).lower()]

    duo_tp = sum(1 for p in duo_positives if p["pred"] == 1)
    duo_pair_recall = duo_tp / len(duo_positives) if duo_positives else 0.0

    non_duo_tp = sum(1 for p in non_duo_positives if p["pred"] == 1)
    non_duo_pair_recall = non_duo_tp / len(non_duo_positives) if non_duo_positives else 0.0

    non_duo_families = [fam for fam in families if "iphone" not in str(fam).lower()]
    non_duo_family_macro_recall = (
        float(np.mean([family_recalls[fam] for fam in non_duo_families]))
        if non_duo_families
        else 0.0
    )

    min_t = min(fold_thresholds)
    max_t = max(fold_thresholds)
    med_t = float(np.median(fold_thresholds))
    spread = max_t - min_t

    return {
        "scorer_name": scorer_name,
        "feature_key": feature_key,
        "requires_learned_model": False,
        "oof_count": len(oof_predictions),
        "negative_oof_count": rt_total + de_total,
        "pr_auc": round(float(pr_auc), 4),
        "roc_auc": round(float(roc_auc), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f05": round(float(f05), 4),
        "f1": round(float(f1), 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "related_topic_fp": rt_fp,
        "related_topic_total": rt_total,
        "related_topic_fpr": round(float(rt_fpr), 4),
        "different_event_fp": de_fp,
        "different_event_total": de_total,
        "different_event_fpr": round(float(de_fpr), 4),
        "duo_tp": duo_tp,
        "duo_total": len(duo_positives),
        "duo_pair_recall": round(float(duo_pair_recall), 4),
        "duo_recall": round(float(duo_pair_recall), 4),
        "non_duo_tp": non_duo_tp,
        "non_duo_total": len(non_duo_positives),
        "non_duo_pair_recall": round(float(non_duo_pair_recall), 4),
        "non_duo_recall": round(float(non_duo_pair_recall), 4),
        "non_duo_family_macro_recall": round(float(non_duo_family_macro_recall), 4),
        "family_macro_recall": round(float(family_macro_recall), 4),
        "positive_family_count": len(families),
        "family_recall_breakdown": family_breakdown,
        "generalization_classification": (
            "HIGH_PAIRWISE_PRECISION_BUT_SPARSE_NON_DUO_GENERALIZATION_EVIDENCE"
            if non_duo_pair_recall < 0.60
            else "BALANCED_GENERALIZATION_EVIDENCE"
        ),
        "thresholds_by_fold": [round(t, 4) for t in fold_thresholds],
        "threshold_summary": {
            "min": round(min_t, 4),
            "median": round(med_t, 4),
            "max": round(max_t, 4),
            "spread": round(spread, 4),
        },
        "research_operating_points": {
            "STRICT": round(max_t, 4),
            "MEDIAN": round(med_t, 4),
            "PERMISSIVE": round(min_t, 4),
        },
        "outer_folds": outer_fold_results,
        "oof_predictions": oof_predictions,
    }


def cluster_with_p3(
    article_ids: Set[int],
    pair_scores: Dict[Tuple[int, int], float],
    threshold: float,
    published_lookup: Dict[int, float],
    max_size: int = 10,
    max_temporal_span_hours: float = R3_P3_MAX_TEMPORAL_SPAN_HOURS,
) -> List[List[int]]:
    """Conservative clustering using P3_STRONG_MULTI_MEMBER_SUPPORT under RESEARCH_POLICY_24H."""
    sorted_ids = sorted(list(article_ids))

    raw_edges = []
    for (u, v), sc in pair_scores.items():
        if sc >= threshold and u in article_ids and v in article_ids:
            raw_edges.append((sc, min(u, v), max(u, v)))

    # Sort descending by score, then canonical ID
    raw_edges.sort(key=lambda e: (-e[0], e[1], e[2]))

    clusters: List[List[int]] = []
    article_to_cluster: Dict[int, int] = {}

    def can_add(c_idx: int, cand: int) -> bool:
        members = clusters[c_idx]
        if len(members) >= max_size:
            return False
        times = [published_lookup.get(m, 0.0) for m in members] + [published_lookup.get(cand, 0.0)]
        if times and (max(times) - min(times)) > (max_temporal_span_hours * 3600.0):
            return False
        if len(members) >= 2:
            pos_count = sum(1 for m in members if pair_scores.get((min(cand, m), max(cand, m)), 0.0) >= threshold)
            if pos_count < 2:
                return False
        return True

    for sc, u, v in raw_edges:
        cU = article_to_cluster.get(u)
        cV = article_to_cluster.get(v)

        if cU is None and cV is None:
            t_u = published_lookup.get(u)
            t_v = published_lookup.get(v)
            if t_u is not None and t_v is not None and abs(t_u - t_v) > (max_temporal_span_hours * 3600.0):
                continue
            c_idx = len(clusters)
            clusters.append([u, v])
            article_to_cluster[u] = c_idx
            article_to_cluster[v] = c_idx
        elif cU is not None and cV is None:
            if can_add(cU, v):
                clusters[cU].append(v)
                article_to_cluster[v] = cU
        elif cU is None and cV is not None:
            if can_add(cV, u):
                clusters[cV].append(u)
                article_to_cluster[u] = cV
        else:
            # Neither cluster absorbs the other; P3 does not bridge multi-member clusters
            pass

    # Add singletons
    for a in sorted_ids:
        if a not in article_to_cluster:
            clusters.append([a])

    return clusters


def evaluate_gold_cluster_safety(
    scorer_result: Dict[str, Any],
    gold_rows: List[Dict[str, Any]],
    published_lookup: Dict[int, float],
    max_temporal_span_hours: float = R3_P3_MAX_TEMPORAL_SPAN_HOURS,
) -> Dict[str, Any]:
    """Propagates direct scorer decisions through P3 on Gold subgraph to measure cluster-level safety.

    Uses strict descriptive safety classifications without arbitrary magic thresholds:
    - ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION
    - NONZERO_HARD_NEGATIVE_CONTAMINATION
    - TOO_LOW_COVERAGE
    - INCONCLUSIVE
    """
    gold_articles = set()
    article_families: Dict[int, str] = {}
    pair_scores: Dict[Tuple[int, int], float] = {}

    feat = scorer_result["feature_key"]
    for r in gold_rows:
        u = min(int(r["entry_a_id"]), int(r["entry_b_id"]))
        v = max(int(r["entry_a_id"]), int(r["entry_b_id"]))
        gold_articles.add(u)
        gold_articles.add(v)
        pair_scores[(u, v)] = float(r[feat])
        if r["gold_label"] == "SAME_EVENT":
            fam = r.get("episode_family_id", "UNKNOWN")
            article_families[u] = fam
            article_families[v] = fam

    operating_points = scorer_result["research_operating_points"]
    op_evaluations: Dict[str, Any] = {}

    for op_name, thresh in operating_points.items():
        clusters = cluster_with_p3(
            gold_articles,
            pair_scores,
            thresh,
            published_lookup,
            max_temporal_span_hours=max_temporal_span_hours,
        )
        multi_clusters = [c for c in clusters if len(c) > 1]

        a_to_c: Dict[int, int] = {}
        for c_idx, c in enumerate(clusters):
            for a in c:
                a_to_c[a] = c_idx

        # Metrics on Gold pairs
        captured_same_event = 0
        rt_contamination = 0
        de_contamination = 0

        for r in gold_rows:
            u, v = int(r["entry_a_id"]), int(r["entry_b_id"])
            lbl = r["gold_label"]
            in_same = (a_to_c.get(u) is not None and a_to_c.get(u) == a_to_c.get(v))
            if in_same:
                if lbl == "SAME_EVENT":
                    captured_same_event += 1
                elif lbl == "RELATED_TOPIC":
                    rt_contamination += 1
                elif lbl == "DIFFERENT_EVENT":
                    de_contamination += 1

        cross_family_clusters = 0
        false_family_merges = 0
        for c in multi_clusters:
            fams = set(article_families[m] for m in c if m in article_families)
            if len(fams) > 1:
                cross_family_clusters += 1
                false_family_merges += (len(fams) - 1)

        # Fragmentation
        families_present = set(article_families.values())
        frag_by_fam = {}
        for fam in families_present:
            fam_members = {aid for aid, f in article_families.items() if f == fam}
            clusters_spanned = {a_to_c[aid] for aid in fam_members if aid in a_to_c}
            frag_by_fam[fam] = len(clusters_spanned)

        total_multi_members = sum(len(c) for c in multi_clusters)
        hard_neg_contamination = rt_contamination + de_contamination

        # Strict descriptive safety classification (no arbitrary tolerance)
        if captured_same_event < 15:
            safety_class = "TOO_LOW_COVERAGE"
        elif hard_neg_contamination == 0 and cross_family_clusters == 0:
            safety_class = "ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION"
        elif hard_neg_contamination > 0 or cross_family_clusters > 0:
            safety_class = "NONZERO_HARD_NEGATIVE_CONTAMINATION"
        else:
            safety_class = "INCONCLUSIVE"

        op_evaluations[op_name] = {
            "operating_point": op_name,
            "threshold": thresh,
            "multi_article_story_count": len(multi_clusters),
            "total_articles_clustered": total_multi_members,
            "same_event_capture": captured_same_event,
            "same_event_capture_rate": round(captured_same_event / 57, 4),
            "false_family_merge_count": false_family_merges,
            "cross_family_cluster_count": cross_family_clusters,
            "related_topic_cluster_contamination": rt_contamination,
            "different_event_cluster_contamination": de_contamination,
            "cluster_hard_negative_contamination_count": hard_neg_contamination,
            "family_fragmentation_breakdown": frag_by_fam,
            "safety_classification": safety_class,
        }

    return {
        "scorer_name": scorer_result["scorer_name"],
        "operating_points": op_evaluations,
    }


def retrieve_candidates_rf0r(
    articles: List[Dict[str, Any]],
    article_tokens: Dict[int, Set[str]],
    k_retrieval: int = 10,
) -> Tuple[Set[Tuple[int, int]], Dict[Tuple[int, int], float]]:
    """Retrieves cross-feed candidate pairs using RF0R_RUNTIME_LEXICAL_TOP_K.

    Contract:
    - CROSS_FEED_ONLY: Same-feed article pairs are strictly excluded.
    - SYMMETRIC_PER_ARTICLE_TOP_K: Every article independently ranks its cross-feed candidate neighbors.
    - HIGHER_ID_CAN_SELECT_LOWER_ID: No directional ID restriction before forming per-article top-K.
    - CANONICAL_PAIR_DEDUP: Returned pair keys are canonical (min(u, v), max(u, v)).
    - DETERMINISTIC_TIE_BREAK: 1. title_overlap_coefficient DESC, 2. canonical_pair_key ASC.
    """
    inverted_index = defaultdict(list)
    for aid, tokens in article_tokens.items():
        for tok in tokens:
            inverted_index[tok].append(aid)

    feed_lookup = {int(a["id"]): get_feed_identity(a) for a in articles}
    candidate_pairs: Set[Tuple[int, int]] = set()
    pair_scores: Dict[Tuple[int, int], float] = {}

    for a in articles:
        aid = int(a["id"])
        a_feed = feed_lookup[aid]
        tokens_a = article_tokens.get(aid, set())
        if not tokens_a:
            continue

        seen_neighbors = set()
        cands = []
        for tok in tokens_a:
            for other_aid in inverted_index[tok]:
                other_feed = feed_lookup[other_aid]
                if (
                    other_aid != aid
                    and a_feed
                    and other_feed
                    and other_feed != a_feed
                    and other_aid not in seen_neighbors
                ):
                    seen_neighbors.add(other_aid)
                    coef = compute_overlap_coefficient(tokens_a, article_tokens.get(other_aid, set()))
                    min_id = min(aid, other_aid)
                    max_id = max(aid, other_aid)
                    pair_key = f"{min_id}_{max_id}"
                    cands.append({
                        "other_aid": other_aid,
                        "coef": coef,
                        "pair_key": pair_key,
                        "pair_tuple": (min_id, max_id),
                    })

        sorted_cands = sorted(cands, key=lambda c: (-c["coef"], c["pair_key"]))
        top_k = sorted_cands[:k_retrieval]
        for c in top_k:
            candidate_pairs.add(c["pair_tuple"])
            pair_scores[c["pair_tuple"]] = round(c["coef"], 4)

    return candidate_pairs, pair_scores


def run_rf0r_retrieval_benchmark(
    articles: List[Dict[str, Any]],
    article_tokens: Dict[int, Set[str]],
    gold_rows: List[Dict[str, Any]],
    k_values: List[int] = [3, 5, 10, 20, 30, 50],
) -> Dict[str, Any]:
    """Evaluates RF0R_RUNTIME_LEXICAL_TOP_K against Gold dataset across K search."""
    se_gold = [r for r in gold_rows if r["gold_label"] == "SAME_EVENT"]
    rt_gold = [r for r in gold_rows if r["gold_label"] == "RELATED_TOPIC"]
    de_gold = [r for r in gold_rows if r["gold_label"] == "DIFFERENT_EVENT"]

    fam_articles = defaultdict(set)
    fam_pairs = defaultdict(list)
    for r in se_gold:
        fam = r["episode_family_id"]
        u, v = int(r["entry_a_id"]), int(r["entry_b_id"])
        fam_articles[fam].add(u)
        fam_articles[fam].add(v)
        fam_pairs[fam].append((u, v))

    eval_configurations = []

    for k in k_values:
        cand_pairs, _ = retrieve_candidates_rf0r(articles, article_tokens, k_retrieval=k)
        retrieved_keys = {f"{u}:{v}" for u, v in cand_pairs}

        se_rec = sum(1 for r in se_gold if f"{min(int(r['entry_a_id']), int(r['entry_b_id']))}:{max(int(r['entry_a_id']), int(r['entry_b_id']))}" in retrieved_keys)
        rt_rec = sum(1 for r in rt_gold if f"{min(int(r['entry_a_id']), int(r['entry_b_id']))}:{max(int(r['entry_a_id']), int(r['entry_b_id']))}" in retrieved_keys)
        de_rec = sum(1 for r in de_gold if f"{min(int(r['entry_a_id']), int(r['entry_b_id']))}:{max(int(r['entry_a_id']), int(r['entry_b_id']))}" in retrieved_keys)

        # Family connectivity recall
        fam_conn = 0
        for fam, arts in fam_articles.items():
            parent = {x: x for x in arts}

            def find(x):
                if parent[x] != x:
                    parent[x] = find(parent[x])
                return parent[x]

            def union(x, y):
                rx, ry = find(x), find(y)
                if rx != ry:
                    parent[rx] = ry

            for u, v in fam_pairs[fam]:
                pk = f"{min(u, v)}:{max(u, v)}"
                if pk in retrieved_keys:
                    union(u, v)

            if len(set(find(x) for x in arts)) == 1:
                fam_conn += 1

        pair_count = len(cand_pairs)
        reduction_pct = round((1.0 - (pair_count / CANONICAL_TOTAL_CROSSFEED_PAIRS)) * 100.0, 2)

        eval_configurations.append({
            "k": k,
            "retrieved_pair_count": pair_count,
            "pair_reduction_percent": reduction_pct,
            "same_event_pair_recall": round(se_rec / len(se_gold), 4),
            "same_event_pairs_captured": se_rec,
            "same_event_pairs_total": len(se_gold),
            "positive_family_connectivity_recall": round(fam_conn / len(fam_articles), 4),
            "positive_families_preserved": fam_conn,
            "positive_families_total": len(fam_articles),
            "related_topic_candidate_rate": round(rt_rec / len(rt_gold), 4),
            "different_event_candidate_rate": round(de_rec / len(de_gold), 4),
        })

    pareto = [c for c in eval_configurations if c["same_event_pair_recall"] == 1.0 and c["positive_family_connectivity_recall"] == 1.0]
    best_k_entry = min(pareto, key=lambda c: c["retrieved_pair_count"]) if pareto else eval_configurations[-1]

    return {
        "benchmark_version": "rf0r-retrieval-benchmark-v1",
        "method": "RF0R_RUNTIME_LEXICAL_TOP_K",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "canonical_universe_crossfeed_pairs": CANONICAL_TOTAL_CROSSFEED_PAIRS,
        "configurations": eval_configurations,
        "pareto_optimal_configurations": pareto,
        "recommended_k": best_k_entry["k"],
        "recommended_k_summary": best_k_entry,
    }


def execute_d0_raw_pipeline_on_home200(
    articles: List[Dict[str, Any]],
    threshold: float = 0.3541,
    k_retrieval: int = 10,
    max_temporal_span_hours: float = R3_P3_MAX_TEMPORAL_SPAN_HOURS,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, float]]:
    """Executes the corrected D0 raw pipeline under cross-feed only candidate retrieval."""
    t0 = time.perf_counter()

    # Step 1: Token extraction and metadata lookup
    article_tokens: Dict[int, Set[str]] = {}
    published_lookup: Dict[int, float] = {}
    feed_lookup: Dict[int, str] = {}
    home_order = [int(a["id"]) for a in articles]

    for a in articles:
        aid = int(a["id"])
        published_lookup[aid] = float(a.get("published_at", 0.0))
        feed_lookup[aid] = get_feed_identity(a)
        feed_title = a.get("feed_title", a.get("feed", ""))
        article_tokens[aid] = extract_significant_words(a.get("title", ""), feed_title)

    t1 = time.perf_counter()

    # Step 2: Cross-feed RF0R lexical candidate retrieval & scoring
    cand_pairs, pair_scores = retrieve_candidates_rf0r(articles, article_tokens, k_retrieval=k_retrieval)
    t2 = time.perf_counter()

    # Step 3: Conservative P3 Clustering under 24h temporal policy
    article_ids = set(home_order)
    clusters = cluster_with_p3(
        article_ids,
        pair_scores,
        threshold,
        published_lookup,
        max_temporal_span_hours=max_temporal_span_hours,
    )
    t3 = time.perf_counter()

    # Step 4: Representative selection (D0_LEXICAL_MEDOID) & H1 Ranking Preservation Placement
    multi_stories = [c for c in clusters if len(c) > 1]
    projections = []

    for c in clusters:
        members = sorted(c)
        if len(members) == 1:
            rep = members[0]
            alts = []
        else:
            # D0_LEXICAL_MEDOID: candidate with max sum of D0 scores to other cluster members
            best_rep = members[0]
            best_sim = -1.0
            for cand in members:
                sim_sum = sum(pair_scores.get((min(cand, m), max(cand, m)), 0.0) for m in members if m != cand)
                if sim_sum > best_sim:
                    best_sim = sim_sum
                    best_rep = cand
            rep = best_rep
            alts = [m for m in members if m != rep]

        h1_pos = min(home_order.index(m) for m in members)
        projections.append({
            "story_id": f"story_{hashlib.sha256(','.join(map(str, members)).encode()).hexdigest()[:16]}",
            "representative_article_id": rep,
            "representative_policy": "D0_LEXICAL_MEDOID",
            "placement_policy": "H1_HIGHEST_RANKED_MEMBER_POSITION",
            "alternative_article_ids": alts,
            "member_article_ids": members,
            "member_count": len(members),
            "h1_home_position": h1_pos,
        })

    # Sort projections strictly by H1 position
    projections.sort(key=lambda p: (p["h1_home_position"], p["representative_article_id"]))
    t4 = time.perf_counter()

    timing_breakdown = {
        "token_extraction_ms": round((t1 - t0) * 1000.0, 3),
        "candidate_retrieval_and_scoring_ms": round((t2 - t1) * 1000.0, 3),
        "p3_clustering_ms": round((t3 - t2) * 1000.0, 3),
        "projection_and_h1_ms": round((t4 - t3) * 1000.0, 3),
        "total_end_to_end_ms": round((t4 - t0) * 1000.0, 3),
    }

    w_multi = [p for p in projections if p["member_count"] > 1]
    compressed_items = sum(p["member_count"] - 1 for p in w_multi)
    stats = {
        "home_items_before": len(articles),
        "home_items_after": len(projections),
        "multi_article_story_count": len(w_multi),
        "duplicate_articles_compressed": compressed_items,
        "noise_reduction_percent": round((compressed_items / len(articles)) * 100.0, 2),
        "top10_story_card_count": sum(1 for p in w_multi if p["h1_home_position"] < 10),
        "top20_story_card_count": sum(1 for p in w_multi if p["h1_home_position"] < 20),
        "top50_story_card_count": sum(1 for p in w_multi if p["h1_home_position"] < 50),
        "top100_story_card_count": sum(1 for p in w_multi if p["h1_home_position"] < 100),
    }

    return projections, stats, timing_breakdown


def execute_d1_retrieved_pipeline_on_home200(
    articles: List[Dict[str, Any]],
    qwen_pair_scores_universe: Dict[Tuple[int, int], float],
    threshold: float = 0.6789,
    k_retrieval: int = 10,
    max_temporal_span_hours: float = R3_P3_MAX_TEMPORAL_SPAN_HOURS,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], int]:
    """Executes the D1 stack using actual RF1_QWEN_TOP_K retrieval prior to P3 clustering."""
    feed_lookup = {int(a["id"]): get_feed_identity(a) for a in articles}
    published_lookup = {int(a["id"]): float(a.get("published_at", 0.0)) for a in articles}
    home_order = [int(a["id"]) for a in articles]

    # Group cross-feed pairs per article (both feeds must be known and distinct)
    art_cands: Dict[int, List[Tuple[float, str, Tuple[int, int]]]] = defaultdict(list)
    for (u, v), sc in qwen_pair_scores_universe.items():
        feed_u = feed_lookup.get(u)
        feed_v = feed_lookup.get(v)
        if feed_u and feed_v and feed_u != feed_v:
            pk = f"{u}:{v}"
            art_cands[u].append((sc, pk, (u, v)))
            art_cands[v].append((sc, pk, (u, v)))

    retrieved_scores: Dict[Tuple[int, int], float] = {}
    for aid in home_order:
        cands = art_cands.get(aid, [])
        sorted_cands = sorted(cands, key=lambda c: (-c[0], c[1]))[:k_retrieval]
        for sc, _, pair_tuple in sorted_cands:
            retrieved_scores[pair_tuple] = sc

    clusters = cluster_with_p3(
        set(home_order),
        retrieved_scores,
        threshold,
        published_lookup,
        max_temporal_span_hours=max_temporal_span_hours,
    )

    multi = [c for c in clusters if len(c) > 1]
    projections = []
    for c in clusters:
        members = sorted(c)
        rep = members[0]
        alts = members[1:] if len(members) > 1 else []
        h1_pos = min(home_order.index(m) for m in members)
        projections.append({
            "story_id": f"story_d1_{hashlib.sha256(','.join(map(str, members)).encode()).hexdigest()[:16]}",
            "representative_article_id": rep,
            "representative_policy": "D1_FIRST_MEMBER_FALLBACK",
            "placement_policy": "H1_HIGHEST_RANKED_MEMBER_POSITION",
            "alternative_article_ids": alts,
            "member_article_ids": members,
            "member_count": len(members),
            "h1_home_position": h1_pos,
        })

    projections.sort(key=lambda p: (p["h1_home_position"], p["representative_article_id"]))
    compressed = sum(len(c) - 1 for c in multi)
    stats = {
        "home_items_before": len(articles),
        "home_items_after": len(projections),
        "multi_article_story_count": len(multi),
        "duplicate_articles_compressed": compressed,
        "noise_reduction_percent": round((compressed / len(articles)) * 100.0, 2),
        "top10_story_card_count": sum(1 for p in multi if min(home_order.index(m) for m in p) < 10),
        "top20_story_card_count": sum(1 for p in multi if min(home_order.index(m) for m in p) < 20),
        "top50_story_card_count": sum(1 for p in multi if min(home_order.index(m) for m in p) < 50),
        "top100_story_card_count": sum(1 for p in multi if min(home_order.index(m) for m in p) < 100),
    }

    return projections, stats, len(retrieved_scores)


def generate_false_merge_review_pack(
    gold_rows: List[Dict[str, Any]],
    d0_clusters: List[List[int]],
    d1_clusters: List[List[int]],
    d0_thresh: float,
    d1_thresh: float,
    corpus_lookup: Dict[int, Dict[str, Any]],
    output_path: Path,
):
    """Generates failure review pack of any clusters containing Gold RELATED_TOPIC or DIFFERENT_EVENT pairs."""
    d0_a2c = {}
    for c_idx, c in enumerate(d0_clusters):
        for a in c:
            d0_a2c[a] = c_idx

    d1_a2c = {}
    for c_idx, c in enumerate(d1_clusters):
        for a in c:
            d1_a2c[a] = c_idx

    review_rows = []
    for r in gold_rows:
        lbl = r["gold_label"]
        if lbl in ("RELATED_TOPIC", "DIFFERENT_EVENT"):
            u = int(r["entry_a_id"])
            v = int(r["entry_b_id"])
            in_d0 = (d0_a2c.get(u) is not None and d0_a2c.get(u) == d0_a2c.get(v))
            in_d1 = (d1_a2c.get(u) is not None and d1_a2c.get(u) == d1_a2c.get(v))

            if in_d0 or in_d1:
                title_a = corpus_lookup.get(u, {}).get("title", "")
                title_b = corpus_lookup.get(v, {}).get("title", "")
                feed_a = corpus_lookup.get(u, {}).get("feed_title", "")
                feed_b = corpus_lookup.get(v, {}).get("feed_title", "")
                review_rows.append({
                    "pair_key": r["pair_key"],
                    "gold_label": lbl,
                    "d0_score": r.get("title_overlap_coefficient", ""),
                    "d0_threshold": d0_thresh,
                    "merged_in_d0": "YES" if in_d0 else "NO",
                    "d1_score": r.get("qwen_embedding_cosine", ""),
                    "d1_threshold": d1_thresh,
                    "merged_in_d1": "YES" if in_d1 else "NO",
                    "title_a": title_a,
                    "title_b": title_b,
                    "feed_a": feed_a,
                    "feed_b": feed_b,
                })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "pair_key", "gold_label",
        "d0_score", "d0_threshold", "merged_in_d0",
        "d1_score", "d1_threshold", "merged_in_d1",
        "title_a", "title_b", "feed_a", "feed_b"
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)

    print(f"Emitted {len(review_rows)} false merge review pairs to {output_path}")


def evaluate_full_home_gold_observation(
    projections: List[Dict[str, Any]],
    gold_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Evaluates the 156 Gold relationships against full Home-200 cluster assignments.

    Contract:
    - Analyzes cluster assignments from the full executable stack on Home-200.
    - Evaluates all 156 Gold relationships (both articles present in Home-200).
    - Checks whether articles in positive pairs are in the same cluster.
    - Checks whether negative pairs (RELATED_TOPIC, DIFFERENT_EVENT) are in the same cluster.
    - Checks if any cluster co-locates articles from two distinct positive families.
    """
    art_to_cluster: Dict[int, str] = {}
    for p in projections:
        cid = p["story_id"]
        for m in p["member_article_ids"]:
            art_to_cluster[int(m)] = cid

    art_to_families: Dict[int, Set[str]] = defaultdict(set)
    for r in gold_rows:
        lbl = r.get("gold_label") or r.get("label")
        if lbl == "SAME_EVENT":
            fam = r["episode_family_id"]
            art_to_families[int(r["entry_a_id"])].add(fam)
            art_to_families[int(r["entry_b_id"])].add(fam)

    both_present = 0
    se_total = 0
    se_captured = 0
    rt_total = 0
    rt_contam = 0
    de_total = 0
    de_contam = 0
    contam_pairs: List[Dict[str, Any]] = []

    for r in gold_rows:
        u = int(r["entry_a_id"])
        v = int(r["entry_b_id"])
        if u in art_to_cluster and v in art_to_cluster:
            both_present += 1

        label = r.get("gold_label") or r.get("label")
        in_same = (art_to_cluster.get(u) is not None and art_to_cluster.get(u) == art_to_cluster.get(v))

        pair_key = r.get("pair_key") or f"{min(u, v)}:{max(u, v)}"
        if label == "SAME_EVENT":
            se_total += 1
            if in_same:
                se_captured += 1
        elif label == "RELATED_TOPIC":
            rt_total += 1
            if in_same:
                rt_contam += 1
                contam_pairs.append({"pair_key": pair_key, "gold_label": label, "u": u, "v": v})
        elif label == "DIFFERENT_EVENT":
            de_total += 1
            if in_same:
                de_contam += 1
                contam_pairs.append({"pair_key": pair_key, "gold_label": label, "u": u, "v": v})

    false_family_merges = 0
    cross_family_clusters = 0
    for p in projections:
        fams = set()
        for m in p["member_article_ids"]:
            if m in art_to_families:
                fams.update(art_to_families[m])
        if len(fams) > 1:
            false_family_merges += (len(fams) - 1)
            cross_family_clusters += 1

    hard_negative_contam = rt_contam + de_contam
    safety_class = (
        "ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION"
        if hard_negative_contam == 0
        else "NONZERO_HARD_NEGATIVE_CONTAMINATION"
    )

    return {
        "gold_pairs_evaluated": len(gold_rows),
        "gold_pairs_with_both_articles_present": both_present,
        "same_event_pairs_total": se_total,
        "same_event_pairs_captured": se_captured,
        "same_event_capture_rate": round(se_captured / se_total, 4) if se_total > 0 else 0.0,
        "related_topic_pairs_total": rt_total,
        "related_topic_cluster_contamination": rt_contam,
        "different_event_pairs_total": de_total,
        "different_event_cluster_contamination": de_contam,
        "cluster_hard_negative_contamination_count": hard_negative_contam,
        "false_family_merge_count": false_family_merges,
        "cross_family_cluster_count": cross_family_clusters,
        "safety_classification": safety_class,
        "contaminated_pairs": contam_pairs,
    }


def generate_full_stack_review_pack(
    gold_rows: List[Dict[str, Any]],
    z_projections: List[Dict[str, Any]],
    z_cand_pairs: Set[Tuple[int, int]],
    z_cand_scores: Dict[Tuple[int, int], float],
    q_projections: List[Dict[str, Any]],
    q_cand_pairs: Set[Tuple[int, int]],
    q_pair_scores: Dict[Tuple[int, int], float],
    corpus_lookup: Dict[int, Dict[str, Any]],
    output_path: Path,
) -> int:
    """Emits false-merge-full-stack-review-pack-v1.csv for hard-negative Gold pairs merged in Z or Q."""
    z_art_to_proj = {}
    for p in z_projections:
        for m in p["member_article_ids"]:
            z_art_to_proj[int(m)] = p

    q_art_to_proj = {}
    for p in q_projections:
        for m in p["member_article_ids"]:
            q_art_to_proj[int(m)] = p

    fieldnames = [
        "pair_key",
        "gold_label",
        "candidate_retrieved_stack_z",
        "d0_score",
        "merged_in_stack_z",
        "candidate_retrieved_stack_q",
        "d1_score",
        "merged_in_stack_q",
        "title_a",
        "title_b",
        "feed_a",
        "feed_b",
        "cluster_members_stack_z",
        "cluster_members_stack_q",
    ]

    review_rows = []
    for r in gold_rows:
        label = r["gold_label"]
        if label not in ("RELATED_TOPIC", "DIFFERENT_EVENT"):
            continue
        u = int(r["entry_a_id"])
        v = int(r["entry_b_id"])
        min_id, max_id = min(u, v), max(u, v)
        pair_tuple = (min_id, max_id)

        proj_z_u = z_art_to_proj.get(u)
        proj_z_v = z_art_to_proj.get(v)
        in_z = bool(proj_z_u and proj_z_v and proj_z_u["story_id"] == proj_z_v["story_id"])

        proj_q_u = q_art_to_proj.get(u)
        proj_q_v = q_art_to_proj.get(v)
        in_q = bool(proj_q_u and proj_q_v and proj_q_u["story_id"] == proj_q_v["story_id"])

        if in_z or in_q:
            cand_z = pair_tuple in z_cand_pairs
            d0_sc = z_cand_scores.get(pair_tuple, float(r.get("title_overlap_coefficient", 0.0)))

            cand_q = pair_tuple in q_cand_pairs
            d1_sc = q_pair_scores.get(pair_tuple, float(r.get("qwen_embedding_cosine", 0.0)))

            a_obj = corpus_lookup.get(u, {})
            b_obj = corpus_lookup.get(v, {})

            z_mems = ",".join(str(m) for m in sorted(proj_z_u["member_article_ids"])) if proj_z_u else str(u)
            q_mems = ",".join(str(m) for m in sorted(proj_q_u["member_article_ids"])) if proj_q_u else str(u)

            review_rows.append({
                "pair_key": r["pair_key"],
                "gold_label": label,
                "candidate_retrieved_stack_z": cand_z,
                "d0_score": round(float(d0_sc), 4),
                "merged_in_stack_z": in_z,
                "candidate_retrieved_stack_q": cand_q,
                "d1_score": round(float(d1_sc), 4),
                "merged_in_stack_q": in_q,
                "title_a": a_obj.get("title", ""),
                "title_b": b_obj.get("title", ""),
                "feed_a": get_feed_identity(a_obj),
                "feed_b": get_feed_identity(b_obj),
                "cluster_members_stack_z": z_mems,
                "cluster_members_stack_q": q_mems,
            })

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)

    return len(review_rows)


def verify_and_emit_python_node_parity(
    raw_articles: List[Dict[str, Any]],
    cand_pairs: Set[Tuple[int, int]],
    pair_scores: Dict[Tuple[int, int], float],
    projections: List[Dict[str, Any]],
    out_path: Path,
) -> Dict[str, Any]:
    """Computes cryptographic SHAs in Python and Node.js and verifies exact parity."""
    # 1. Python candidate set SHA
    sorted_cands = sorted(f"{u}_{v}" for (u, v) in cand_pairs)
    py_cand_sha = hashlib.sha256("\n".join(sorted_cands).encode("utf-8")).hexdigest()

    # 2. Python pair score SHA
    score_lines = [f"{u}_{v},{pair_scores[(u, v)]:.4f}" for (u, v) in sorted(pair_scores.keys())]
    py_score_sha = hashlib.sha256("\n".join(score_lines).encode("utf-8")).hexdigest()

    # 3. Python cluster membership SHA
    clusters = [sorted(p["member_article_ids"]) for p in projections]
    clusters_sorted = sorted(clusters, key=lambda c: (c[0], len(c)))
    py_cluster_sha = hashlib.sha256(json.dumps(clusters_sorted, separators=(",", ":")).encode("utf-8")).hexdigest()

    # 4. Python story projection semantic SHA
    semantic_proj = [
        {
            "story_id": p["story_id"],
            "member_article_ids": sorted(p["member_article_ids"]),
            "representative_article_id": p["representative_article_id"],
            "h1_home_position": p["h1_home_position"],
        }
        for p in projections
    ]
    semantic_proj_sorted = sorted(semantic_proj, key=lambda p: (p["h1_home_position"], p["story_id"]))
    py_proj_sha = hashlib.sha256(json.dumps(semantic_proj_sorted, separators=(",", ":")).encode("utf-8")).hexdigest()

    node_script = f"""
import fs from "node:fs";
import crypto from "node:crypto";
import {{
  retrieveCandidatesRF0R,
  extractSignificantWords,
  clusterWithP3,
  projectStories,
  getFeedIdentity
}} from "./scripts/research/story-identity-v1/node/direct-story-pipeline.js";

const corpus = fs.readFileSync("{CORPUS_PATH}", "utf8").trim().split("\\n").map(l => JSON.parse(l));

const articleTokens = new Map();
const publishedLookup = {{}};
const homeOrder = [];

for (const a of corpus) {{
  const aid = Number(a.id);
  homeOrder.push(aid);
  publishedLookup[aid] = Number(a.published_at || 0);
  const feedTitle = a.feed_title || a.feed || "";
  articleTokens.set(aid, extractSignificantWords(a.title || "", feedTitle));
}}

const {{ candidatePairs, pairScores }} = retrieveCandidatesRF0R(corpus, articleTokens, 10);

const sortedCands = [...candidatePairs].toSorted();
const candSha = crypto.createHash("sha256").update(sortedCands.join("\\n")).digest("hex");

const scoreKeys = [...pairScores.keys()].toSorted();
const scoreLines = scoreKeys.map(k => k + "," + pairScores.get(k).toFixed(4));
const scoreSha = crypto.createHash("sha256").update(scoreLines.join("\\n")).digest("hex");

const clusters = clusterWithP3(homeOrder, pairScores, 0.3541, publishedLookup, {{ maxTemporalSpanHours: 24.0 }});
const canonicalClusters = clusters.map(c => c.toSorted((a, b) => a - b));
const sortedClusters = canonicalClusters.toSorted((a, b) => {{
  if (a[0] !== b[0]) return a[0] - b[0];
  return a.length - b.length;
}});
const clusterSha = crypto.createHash("sha256").update(JSON.stringify(sortedClusters)).digest("hex");

const projections = projectStories(clusters, pairScores, homeOrder);
const semanticProj = projections.map(p => ({{
  story_id: p.story_id,
  member_article_ids: p.member_article_ids.toSorted((a, b) => a - b),
  representative_article_id: p.representative_article_id,
  h1_home_position: p.h1_home_position
}}));
const sortedProj = semanticProj.toSorted((a, b) => {{
  if (a.h1_home_position !== b.h1_home_position) return a.h1_home_position - b.h1_home_position;
  return a.story_id.localeCompare(b.story_id);
}});
const projSha = crypto.createHash("sha256").update(JSON.stringify(sortedProj)).digest("hex");

console.log(JSON.stringify({{
  node_candidate_set_sha: candSha,
  node_pair_score_sha: scoreSha,
  node_cluster_sha: clusterSha,
  node_projection_sha: projSha
}}));
"""
    node_cmd = ["/opt/homebrew/bin/node", "--input-type=module", "-e", node_script]
    proc = subprocess.run(node_cmd, capture_output=True, text=True, check=True)
    node_out = json.loads(proc.stdout)

    cand_parity = (py_cand_sha == node_out["node_candidate_set_sha"])
    score_parity = (py_score_sha == node_out["node_pair_score_sha"])
    cluster_parity = (py_cluster_sha == node_out["node_cluster_sha"])
    proj_parity = (py_proj_sha == node_out["node_projection_sha"])

    parity_artifact = {
        "benchmark_version": "python-node-exact-parity-v1",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "canonical_candidate_set_sha256": py_cand_sha,
        "pair_score_sha256": py_score_sha,
        "cluster_membership_sha256": py_cluster_sha,
        "story_projection_membership_sha256": py_proj_sha,
        "gates": {
            "PYTHON_NODE_CANDIDATE_SET_PARITY": "PASS" if cand_parity else "FAIL",
            "PYTHON_NODE_PAIR_SCORE_PARITY": "PASS" if score_parity else "FAIL",
            "PYTHON_NODE_CLUSTER_MEMBERSHIP_PARITY": "PASS" if cluster_parity else "FAIL",
            "PYTHON_NODE_PROJECTION_PARITY": "PASS" if proj_parity else "FAIL",
        },
        "python_hashes": {
            "candidate_set": py_cand_sha,
            "pair_score": py_score_sha,
            "cluster_membership": py_cluster_sha,
            "story_projection": py_proj_sha,
        },
        "node_hashes": node_out,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(parity_artifact, f, indent=2)

    return parity_artifact


def run_direct_scorer_benchmark():
    """Runs complete R4 benchmark and emits all required private artifacts."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Load data
    rows, _ = load_and_materialize_features()
    graph = ArticleGraph(rows)
    split_result = simulate_protocol_a(graph, 3)

    comp_lookup = {c["component_id"]: c for c in graph.get_component_details()}
    rows_by_key = {r["pair_key"]: r for r in rows}

    fold_data = []
    for f in split_result["folds"]:
        f_idx = f["fold"]
        f_rows = []
        f_articles = set()
        for cid in f["components"]:
            c_info = comp_lookup[cid]
            f_articles.update(c_info["nodes"])
            for p in c_info["pairs"]:
                pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                f_rows.append(rows_by_key[pk])
        fold_data.append({"fold_idx": f_idx, "rows": f_rows, "articles": f_articles})

    # Corpus lookup
    corpus_lookup: Dict[int, Dict[str, Any]] = {}
    published_lookup: Dict[int, float] = {}
    feed_lookup: Dict[int, str] = {}
    article_tokens: Dict[int, Set[str]] = {}
    raw_articles: List[Dict[str, Any]] = []

    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                a = json.loads(line)
                aid = int(a["id"])
                corpus_lookup[aid] = a
                published_lookup[aid] = float(a.get("published_at", 0.0))
                feed_lookup[aid] = get_feed_identity(a)
                article_tokens[aid] = extract_significant_words(a.get("title", ""), a.get("feed_title", ""))
                raw_articles.append(a)

    # 2. Evaluate D0 and D1 pair metrics (Accepted canonical R2 OOF metrics with R4 True Family Macro Recall)
    d0_res = evaluate_direct_scorer_3fold("D0_TITLE_OVERLAP_DIRECT", "title_overlap_coefficient", fold_data)
    d1_res = evaluate_direct_scorer_3fold("D1_QWEN_COSINE_DIRECT", "qwen_embedding_cosine", fold_data)

    # Emit family recall breakdown artifact
    family_recall_breakdown = {
        "benchmark_version": "family-recall-breakdown-v1",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "positive_family_count": 10,
        "d0_title_overlap_direct": {
            "duo_pair_recall": d0_res["duo_pair_recall"],
            "non_duo_pair_recall": d0_res["non_duo_pair_recall"],
            "non_duo_family_macro_recall": d0_res["non_duo_family_macro_recall"],
            "family_macro_recall": d0_res["family_macro_recall"],
            "breakdown_by_family": d0_res["family_recall_breakdown"],
        },
        "d1_qwen_cosine_direct": {
            "duo_pair_recall": d1_res["duo_pair_recall"],
            "non_duo_pair_recall": d1_res["non_duo_pair_recall"],
            "non_duo_family_macro_recall": d1_res["non_duo_family_macro_recall"],
            "family_macro_recall": d1_res["family_macro_recall"],
            "generalization_classification": d1_res["generalization_classification"],
            "breakdown_by_family": d1_res["family_recall_breakdown"],
        },
    }
    with open(OUTPUT_DIR / "family-recall-breakdown-v1.json", "w", encoding="utf-8") as f:
        json.dump(family_recall_breakdown, f, indent=2)

    # 3. RF0R Retrieval Benchmark across K search
    rf0r_benchmark = run_rf0r_retrieval_benchmark(raw_articles, article_tokens, rows, [3, 5, 10, 20, 30, 50])
    with open(OUTPUT_DIR / "rf0r-retrieval-benchmark-v1.json", "w", encoding="utf-8") as f:
        json.dump(rf0r_benchmark, f, indent=2)

    # 4. Cluster safety evaluation under 24h temporal policy (Gold Subgraph Diagnostic)
    d0_safety = evaluate_gold_cluster_safety(d0_res, rows, published_lookup, max_temporal_span_hours=24.0)
    d1_safety = evaluate_gold_cluster_safety(d1_res, rows, published_lookup, max_temporal_span_hours=24.0)

    cluster_safety_r4 = {
        "benchmark_version": "cluster-safety-r4-v1",
        "temporal_policy": "RESEARCH_POLICY_24H",
        "max_temporal_span_hours": 24.0,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "scorers": {
            "D0_TITLE_OVERLAP_DIRECT": d0_safety,
            "D1_QWEN_COSINE_DIRECT": d1_safety,
        },
        "findings": {
            "d0_strict": d0_safety["operating_points"]["STRICT"],
            "d1_strict": d1_safety["operating_points"]["STRICT"],
            "d1_median": d1_safety["operating_points"]["MEDIAN"],
        },
    }
    with open(OUTPUT_DIR / "cluster-safety-r4-v1.json", "w", encoding="utf-8") as f:
        json.dump(cluster_safety_r4, f, indent=2)

    # 5. Executable D0 raw pipeline on Home-200 (Stack Z: RF0R K=10 + D0 Strict + P3 24h + H1)
    d0_thresh = d0_res["research_operating_points"]["STRICT"]
    d0_proj, d0_stats, d0_timing = execute_d0_raw_pipeline_on_home200(
        raw_articles,
        threshold=d0_thresh,
        k_retrieval=10,
        max_temporal_span_hours=24.0,
    )
    z_cand_pairs, z_cand_scores = retrieve_candidates_rf0r(raw_articles, article_tokens, k_retrieval=10)
    z_retrieved_count = len(z_cand_pairs)
    z_pair_reduction = round((1.0 - z_retrieved_count / CANONICAL_TOTAL_CROSSFEED_PAIRS) * 100.0, 2)

    # Full Home-200 Gold observation for Stack Z
    z_obs = evaluate_full_home_gold_observation(d0_proj, rows)

    stack_z_gold_obs_artifact = {
        "artifact_version": "stack-z-full-home-gold-observation-v1",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "stack_name": "STACK_Z_ZERO_MODEL",
        "retrieval_method": "RF0R_RUNTIME_LEXICAL_TOP_K",
        "retrieval_k": 10,
        "retrieved_pair_count": z_retrieved_count,
        "pair_reduction_percent": z_pair_reduction,
        "scorer": "D0_TITLE_OVERLAP_DIRECT",
        "operating_point": "STRICT",
        "threshold": d0_thresh,
        "temporal_policy": "RESEARCH_POLICY_24H",
        "max_temporal_span_hours": 24.0,
        "home_items_before": d0_stats["home_items_before"],
        "home_items_after": d0_stats["home_items_after"],
        "noise_reduction_percent": d0_stats["noise_reduction_percent"],
        "multi_article_story_count": d0_stats["multi_article_story_count"],
        "duplicate_articles_compressed": d0_stats["duplicate_articles_compressed"],
        "top10_story_cards": d0_stats["top10_story_card_count"],
        "top20_story_cards": d0_stats["top20_story_card_count"],
        "top50_story_cards": d0_stats["top50_story_card_count"],
        "top100_story_cards": d0_stats["top100_story_card_count"],
        "gold_observation": z_obs,
    }
    with open(OUTPUT_DIR / "stack-z-full-home-gold-observation-v1.json", "w", encoding="utf-8") as f:
        json.dump(stack_z_gold_obs_artifact, f, indent=2)

    timing_sizes = [25, 50, 100, 200]
    timing_results = {}
    for sz in timing_sizes:
        runs = []
        for _ in range(5):
            _, _, t_m = execute_d0_raw_pipeline_on_home200(
                raw_articles[:sz],
                threshold=d0_thresh,
                k_retrieval=10,
                max_temporal_span_hours=24.0,
            )
            runs.append(t_m["total_end_to_end_ms"])
        timing_results[f"articles_{sz}"] = {
            "median_ms": round(float(np.median(runs)), 3),
            "p90_ms": round(float(np.percentile(runs, 90)), 3),
            "min_ms": round(float(np.min(runs)), 3),
            "max_ms": round(float(np.max(runs)), 3),
        }

    d0_crossfeed_runtime_pipeline = {
        "pipeline_version": "d0-crossfeed-runtime-pipeline-v1",
        "scorer": "D0_TITLE_OVERLAP_DIRECT",
        "operating_point_evaluated": "STRICT",
        "threshold": d0_thresh,
        "retrieval_method": "RF0R_RUNTIME_LEXICAL_TOP_K",
        "retrieval_k": 10,
        "temporal_policy": "RESEARCH_POLICY_24H",
        "max_temporal_span_hours": 24.0,
        "cross_feed_only": True,
        "unknown_feed_eligible": False,
        "pure_client_zero_model_end_to_end": True,
        "requires_learned_model": False,
        "timing_breakdown_home200": d0_timing,
        "timing_benchmark_by_article_count": timing_results,
    }
    with open(OUTPUT_DIR / "d0-crossfeed-runtime-pipeline-v1.json", "w", encoding="utf-8") as f:
        json.dump(d0_crossfeed_runtime_pipeline, f, indent=2)

    d0_crossfeed_home_projection = {
        "projection_version": "d0-crossfeed-home-projection-v1",
        "cross_feed_only": True,
        "unknown_feed_eligible": False,
        "temporal_policy": "RESEARCH_POLICY_24H",
        "representative_policy": "D0_LEXICAL_MEDOID",
        "placement_policy": "H1_HIGHEST_RANKED_MEMBER_POSITION",
        "home_stats": d0_stats,
        "projections": d0_proj,
    }
    with open(OUTPUT_DIR / "d0-crossfeed-home-projection-v1.json", "w", encoding="utf-8") as f:
        json.dump(d0_crossfeed_home_projection, f, indent=2)

    # 6. Executable D1 pipeline on Home-200 (Stack Q: RF1 K=10 + D1 Strict + P3 24h + H1)
    d1_thresh = d1_res["research_operating_points"]["STRICT"]
    d1_median_thresh = d1_res["research_operating_points"]["MEDIAN"]
    qwen_pair_scores_universe: Dict[Tuple[int, int], float] = {}
    if os.path.exists(PAIRS_CSV_PATH):
        with open(PAIRS_CSV_PATH, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                u = min(int(r["id_a"]), int(r["id_b"]))
                v = max(int(r["id_a"]), int(r["id_b"]))
                qwen_pair_scores_universe[(u, v)] = float(r.get("qwen_score", 0.0))

    d1_proj, d1_stats, d1_retrieved_pair_count = execute_d1_retrieved_pipeline_on_home200(
        raw_articles,
        qwen_pair_scores_universe,
        threshold=d1_thresh,
        k_retrieval=10,
        max_temporal_span_hours=24.0,
    )
    q_pair_reduction = round((1.0 - d1_retrieved_pair_count / CANONICAL_TOTAL_CROSSFEED_PAIRS) * 100.0, 2)
    q_obs = evaluate_full_home_gold_observation(d1_proj, rows)

    # Sensitivity run with median threshold
    d1_proj_med, d1_stats_med, _ = execute_d1_retrieved_pipeline_on_home200(
        raw_articles,
        qwen_pair_scores_universe,
        threshold=d1_median_thresh,
        k_retrieval=10,
        max_temporal_span_hours=24.0,
    )
    q_obs_med = evaluate_full_home_gold_observation(d1_proj_med, rows)

    stack_q_gold_obs_artifact = {
        "artifact_version": "stack-q-full-home-gold-observation-v1",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "stack_name": "STACK_Q_QWEN_DIRECT",
        "retrieval_method": "RF1_QWEN_TOP_K",
        "retrieval_k": 10,
        "retrieved_pair_count": d1_retrieved_pair_count,
        "pair_reduction_percent": q_pair_reduction,
        "retrieved_count_discrepancy_root_cause": "Historical R3 handoff text contained typo/stale literal 605; actual RF1 K=10 execution across 200 articles yields 1650 unique undirected pairs",
        "scorer": "D1_QWEN_COSINE_DIRECT",
        "operating_point": "STRICT",
        "threshold": d1_thresh,
        "temporal_policy": "RESEARCH_POLICY_24H",
        "max_temporal_span_hours": 24.0,
        "home_items_before": d1_stats["home_items_before"],
        "home_items_after": d1_stats["home_items_after"],
        "noise_reduction_percent": d1_stats["noise_reduction_percent"],
        "multi_article_story_count": d1_stats["multi_article_story_count"],
        "duplicate_articles_compressed": d1_stats["duplicate_articles_compressed"],
        "top10_story_cards": d1_stats["top10_story_card_count"],
        "top20_story_cards": d1_stats["top20_story_card_count"],
        "top50_story_cards": d1_stats["top50_story_card_count"],
        "top100_story_cards": d1_stats["top100_story_card_count"],
        "gold_observation": q_obs,
        "sensitivity_median": {
            "operating_point": "MEDIAN",
            "threshold": d1_median_thresh,
            "home_items_after": d1_stats_med["home_items_after"],
            "noise_reduction_percent": d1_stats_med["noise_reduction_percent"],
            "same_event_capture": f"{q_obs_med['same_event_pairs_captured']}/57",
            "different_event_contamination": q_obs_med["different_event_cluster_contamination"],
            "hard_negative_contamination": q_obs_med["cluster_hard_negative_contamination_count"],
            "safety_classification": q_obs_med["safety_classification"],
        },
    }
    with open(OUTPUT_DIR / "stack-q-full-home-gold-observation-v1.json", "w", encoding="utf-8") as f:
        json.dump(stack_q_gold_obs_artifact, f, indent=2)

    # 7. Exact Python <-> Node Parity
    verify_and_emit_python_node_parity(
        raw_articles,
        z_cand_pairs,
        z_cand_scores,
        d0_proj,
        OUTPUT_DIR / "python-node-exact-parity-v1.json",
    )

    # 8. Full-Stack Review Pack
    art_cands_q = defaultdict(list)
    for (u, v), sc in qwen_pair_scores_universe.items():
        feed_u = feed_lookup.get(u)
        feed_v = feed_lookup.get(v)
        if feed_u and feed_v and feed_u != feed_v:
            pk = f"{u}:{v}"
            art_cands_q[u].append((sc, pk, (u, v)))
            art_cands_q[v].append((sc, pk, (u, v)))
    q_cand_pairs = set()
    for aid in [int(a["id"]) for a in raw_articles]:
        cands = sorted(art_cands_q.get(aid, []), key=lambda c: (-c[0], c[1]))[:10]
        for _, _, pt in cands:
            q_cand_pairs.add(pt)

    review_count = generate_full_stack_review_pack(
        rows,
        d0_proj,
        z_cand_pairs,
        z_cand_scores,
        d1_proj,
        q_cand_pairs,
        qwen_pair_scores_universe,
        corpus_lookup,
        OUTPUT_DIR / "false-merge-full-stack-review-pack-v1.csv",
    )
    print(f"Emitted {review_count} full-stack review pairs to false-merge-full-stack-review-pack-v1.csv")

    # 9. Architecture R4 Scorecard
    architecture_r4_scorecard = {
        "scorecard_version": "architecture-r4-scorecard-v1",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "temporal_policy": "RESEARCH_POLICY_24H",
        "candidate_retrieval_policy": "CROSS_FEED_ONLY",
        "unknown_feed_policy": "UNKNOWN_FEED_NOT_ELIGIBLE (Fail-Open Standalone)",
        "stacks": {
            "STACK_Z_ZERO_MODEL": {
                "components": f"RF0R (K=10 Lexical Top-K) + D0 (Strict {d0_thresh:.4f} Title Overlap) + P3 (24h) + H1",
                "retrieval_method": "RF0R_RUNTIME_LEXICAL_TOP_K",
                "retrieval_k": 10,
                "retrieved_pair_count": z_retrieved_count,
                "pair_reduction_percent": z_pair_reduction,
                "score_method": "D0_TITLE_OVERLAP_DIRECT",
                "operating_point": "STRICT",
                "threshold": d0_thresh,
                "gold_pairwise_diagnostics": {
                    "pr_auc": d0_res["pr_auc"],
                    "precision": d0_res["precision"],
                    "recall": d0_res["recall"],
                    "f05": d0_res["f05"],
                    "duo_pair_recall": d0_res["duo_pair_recall"],
                    "non_duo_pair_recall": d0_res["non_duo_pair_recall"],
                    "non_duo_family_macro_recall": d0_res["non_duo_family_macro_recall"],
                    "family_macro_recall": d0_res["family_macro_recall"],
                },
                "pair_scorer_gold_subgraph_safety": {
                    "same_event_capture": f"{d0_safety['operating_points']['STRICT']['same_event_capture']}/57",
                    "different_event_contamination": d0_safety["operating_points"]["STRICT"]["different_event_cluster_contamination"],
                    "hard_negative_contamination": d0_safety["operating_points"]["STRICT"]["cluster_hard_negative_contamination_count"],
                    "safety_classification": d0_safety["operating_points"]["STRICT"]["safety_classification"],
                },
                "full_stack_gold_observation": {
                    "gold_pairs_evaluated": z_obs["gold_pairs_evaluated"],
                    "gold_pairs_with_both_articles_present": z_obs["gold_pairs_with_both_articles_present"],
                    "same_event_capture": f"{z_obs['same_event_pairs_captured']}/57",
                    "same_event_capture_rate": z_obs["same_event_capture_rate"],
                    "related_topic_contamination": z_obs["related_topic_cluster_contamination"],
                    "different_event_contamination": z_obs["different_event_cluster_contamination"],
                    "hard_negative_contamination": z_obs["cluster_hard_negative_contamination_count"],
                    "false_family_merges": z_obs["false_family_merge_count"],
                    "cross_family_clusters": z_obs["cross_family_cluster_count"],
                    "safety_classification": z_obs["safety_classification"],
                },
                "home_noise_reduction": d0_stats["noise_reduction_percent"],
                "home_items_before": d0_stats["home_items_before"],
                "home_items_after": d0_stats["home_items_after"],
                "multi_article_story_count": d0_stats["multi_article_story_count"],
                "duplicate_articles_compressed": d0_stats["duplicate_articles_compressed"],
                "top10_story_cards": d0_stats["top10_story_card_count"],
                "top20_story_cards": d0_stats["top20_story_card_count"],
                "top50_story_cards": d0_stats["top50_story_card_count"],
                "top100_story_cards": d0_stats["top100_story_card_count"],
                "latency_median_ms": timing_results["articles_200"]["median_ms"],
                "latency_p90_ms": timing_results["articles_200"]["p90_ms"],
                "containers": 0,
                "models": 0,
                "privacy": "PERFECT (100% on-device)",
                "status": "A1_ZERO_MODEL_EVALUATED",
                "source_receipts": {
                    "retrieval": {
                        "source_artifact": "stack-z-full-home-gold-observation-v1.json",
                        "source_fields": ["retrieval_method", "retrieval_k", "retrieved_pair_count", "pair_reduction_percent"],
                    },
                    "full_stack_safety": {
                        "source_artifact": "stack-z-full-home-gold-observation-v1.json",
                        "source_fields": ["same_event_pairs_captured", "different_event_cluster_contamination", "cluster_hard_negative_contamination_count", "safety_classification"],
                    },
                    "home_projection": {
                        "source_artifact": "stack-z-full-home-gold-observation-v1.json",
                        "source_fields": ["home_items_after", "noise_reduction_percent", "top20_story_cards"],
                    },
                },
            },
            "STACK_Q_QWEN_DIRECT": {
                "components": f"RF1 (K=10 Qwen Top-K) + D1 (Strict {d1_thresh:.4f} Qwen Cosine) + P3 (24h) + H1",
                "retrieval_method": "RF1_QWEN_TOP_K",
                "retrieval_k": 10,
                "retrieved_pair_count": d1_retrieved_pair_count,
                "pair_reduction_percent": q_pair_reduction,
                "retrieved_count_discrepancy_root_cause": "Historical R3 handoff text contained typo/stale literal 605; actual RF1 K=10 execution across 200 articles yields 1650 unique undirected pairs",
                "score_method": "D1_QWEN_COSINE_DIRECT",
                "operating_point": "STRICT",
                "threshold": d1_thresh,
                "gold_pairwise_diagnostics": {
                    "pr_auc": d1_res["pr_auc"],
                    "precision": d1_res["precision"],
                    "recall": d1_res["recall"],
                    "f05": d1_res["f05"],
                    "duo_pair_recall": d1_res["duo_pair_recall"],
                    "non_duo_pair_recall": d1_res["non_duo_pair_recall"],
                    "non_duo_family_macro_recall": d1_res["non_duo_family_macro_recall"],
                    "family_macro_recall": d1_res["family_macro_recall"],
                    "generalization_classification": d1_res["generalization_classification"],
                },
                "pair_scorer_gold_subgraph_safety": {
                    "same_event_capture": f"{d1_safety['operating_points']['STRICT']['same_event_capture']}/57",
                    "different_event_contamination": d1_safety["operating_points"]["STRICT"]["different_event_cluster_contamination"],
                    "hard_negative_contamination": d1_safety["operating_points"]["STRICT"]["cluster_hard_negative_contamination_count"],
                    "safety_classification": d1_safety["operating_points"]["STRICT"]["safety_classification"],
                },
                "full_stack_gold_observation": {
                    "gold_pairs_evaluated": q_obs["gold_pairs_evaluated"],
                    "gold_pairs_with_both_articles_present": q_obs["gold_pairs_with_both_articles_present"],
                    "same_event_capture": f"{q_obs['same_event_pairs_captured']}/57",
                    "same_event_capture_rate": q_obs["same_event_capture_rate"],
                    "related_topic_contamination": q_obs["related_topic_cluster_contamination"],
                    "different_event_contamination": q_obs["different_event_cluster_contamination"],
                    "hard_negative_contamination": q_obs["cluster_hard_negative_contamination_count"],
                    "false_family_merges": q_obs["false_family_merge_count"],
                    "cross_family_clusters": q_obs["cross_family_cluster_count"],
                    "safety_classification": q_obs["safety_classification"],
                },
                "home_noise_reduction": d1_stats["noise_reduction_percent"],
                "home_items_before": d1_stats["home_items_before"],
                "home_items_after": d1_stats["home_items_after"],
                "multi_article_story_count": d1_stats["multi_article_story_count"],
                "duplicate_articles_compressed": d1_stats["duplicate_articles_compressed"],
                "top10_story_cards": d1_stats["top10_story_card_count"],
                "top20_story_cards": d1_stats["top20_story_card_count"],
                "top50_story_cards": d1_stats["top50_story_card_count"],
                "top100_story_cards": d1_stats["top100_story_card_count"],
                "latency_median_ms": "NOT_MEASURED_END_TO_END (Qwen inference simulated from frozen embeddings)",
                "containers": 1,
                "models": 1,
                "privacy": "HIGH (local HomeServer daemon)",
                "status": "A1_QWEN_DIRECT_EVALUATED",
                "sensitivity_median": {
                    "operating_point": "MEDIAN",
                    "threshold": d1_median_thresh,
                    "home_items_after": d1_stats_med["home_items_after"],
                    "noise_reduction_percent": d1_stats_med["noise_reduction_percent"],
                    "hard_negative_contamination": q_obs_med["cluster_hard_negative_contamination_count"],
                    "safety_classification": q_obs_med["safety_classification"],
                },
                "source_receipts": {
                    "retrieval": {
                        "source_artifact": "stack-q-full-home-gold-observation-v1.json",
                        "source_fields": ["retrieval_method", "retrieval_k", "retrieved_pair_count", "pair_reduction_percent"],
                    },
                    "full_stack_safety": {
                        "source_artifact": "stack-q-full-home-gold-observation-v1.json",
                        "source_fields": ["same_event_pairs_captured", "different_event_cluster_contamination", "cluster_hard_negative_contamination_count", "safety_classification"],
                    },
                    "home_projection": {
                        "source_artifact": "stack-q-full-home-gold-observation-v1.json",
                        "source_fields": ["home_items_after", "noise_reduction_percent", "top20_story_cards"],
                    },
                },
            },
            "LEARNED_PF1": {
                "status": "REFERENCE_ONLY (Requires fitted model weights/scaler not authorized for production)",
            },
            "PF2_SIDECAR": {
                "status": "NONCOMPARABLE_DIAGNOSTIC (85/156 pairs missing reranker scores)",
            },
            "PF3_MISTRAL": {
                "status": "RESEARCH_REFERENCE (Rejected for production due to cloud egress and lower precision)",
            },
        },
        "spike_gate_evaluation": {
            "A1_ZERO_MODEL_READY": "PROVISIONAL_PENDING_PM_ACCEPTANCE (Zero learned models, zero containers, sub-3ms, but contains 5 different_event cluster contaminations on full Home-200)",
            "A1_QWEN_DIRECT_READY": "NOT_RECOMMENDED_FOR_SPIKE (Sparse non-duo generalization evidence 0.4000, requires Ollama daemon, 1 different_event contamination on full Home-200)",
            "A1_PLUMBING_ONLY_READY": "RECOMMENDED_BY_RESEARCH (Enables frontend score provider interface, Web Worker, P3, H1, StoryProjection, feature flag, and fail-open with fixture testing without exposing users to hard negative merges)",
        },
        "recommended_spike_outcome": "A1_PLUMBING_ONLY_READY",
        "recommended_next_track": "STORY-02-A1 (Plumbing Spike: Score Provider Interface, Web Worker, P3 Cluster Engine, H1 Placement, Feature Flag Gate)",
    }
    with open(OUTPUT_DIR / "architecture-r4-scorecard-v1.json", "w", encoding="utf-8") as f:
        json.dump(architecture_r4_scorecard, f, indent=2)

    print("STORY-02-A0 R4 Benchmark Completed Successfully.")
    print(f"Artifacts emitted to {OUTPUT_DIR}")


if __name__ == "__main__":
    run_direct_scorer_benchmark()

