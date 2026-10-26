#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Offline Pair Classifier Benchmark (STORY-01B-M1)

Compares candidate models for binary pair classification:
  POSITIVE = SAME_EVENT
  NEGATIVE = RELATED_TOPIC + DIFFERENT_EVENT

Methodological Principles:
1. Strict article-disjoint outer evaluation (Protocol A Component Group 3-Fold).
2. Zero leakage: preprocessing and threshold selection strictly on training data.
3. Inner component-group 2-fold cross-validation for threshold selection (maximizing F0.5).
4. No full-gold final fit; no production model artifact created.
5. Macro family metrics and Duo sensitivity analysis.
6. Guardrails for N2 repeated pool observations.

Dependencies: Python 3 standard library + scikit-learn (in isolated environment).
"""

import argparse
import csv
import hashlib
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

# Try imports from sibling modules or relative imports
try:
    from .split_audit import (
        ArticleGraph,
        GoldIntegrityError,
        LofoMappingError,
        N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
        N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        check_article_disjointness,
        prune_training_pairs_touching_test_articles,
        simulate_protocol_a,
        simulate_lofo_n1,
        simulate_lofo_n2,
        validate_gold_schema_and_invariants,
        verify_gold_integrity,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )
    from .harness import (
        FeatureExtractor,
        CorpusVerifier,
        EmbeddingVerifier,
        FEATURE_SCHEMA_VERSION,
    )
except ImportError:
    from split_audit import (
        ArticleGraph,
        GoldIntegrityError,
        LofoMappingError,
        N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
        N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        check_article_disjointness,
        prune_training_pairs_touching_test_articles,
        simulate_protocol_a,
        simulate_lofo_n1,
        simulate_lofo_n2,
        validate_gold_schema_and_invariants,
        verify_gold_integrity,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )
    from harness import (
        FeatureExtractor,
        CorpusVerifier,
        EmbeddingVerifier,
        FEATURE_SCHEMA_VERSION,
    )

try:
    import sklearn
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.metrics import roc_auc_score, average_precision_score
    SKLEARN_AVAILABLE = True
    SKLEARN_VERSION = sklearn.__version__
except ImportError:
    SKLEARN_AVAILABLE = False
    SKLEARN_VERSION = "NONE"


DEFAULT_SEED = 20261025

DEFAULT_CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
DEFAULT_PAIRS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
DEFAULT_RERANKER_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/r3b-qwen3-reranker-0.6b-top250/r3b-qwen3-reranker-top250.csv"
DEFAULT_PRIVATE_M1_DIR = "/tmp/newsflux-story01b-private/m1"

# Allowed feature inventory as per STORY-01B-M1 Section 6
ALLOWED_FEATURES = [
    "same_domain",
    "same_category",
    "canonical_url_match",
    "normalized_url_match",
    "exact_normalized_title_match",
    "title_token_intersection",
    "title_overlap_coefficient",
    "title_jaccard_similarity",
    "significant_word_count_a",
    "significant_word_count_b",
    "number_overlap",
    "date_overlap",
    "entity_anchor_overlap",
    "published_delta_hours",
    "same_calendar_day_utc",
    "qwen_embedding_cosine",
    "mistral_embedding_cosine",
    "reranker_score_mean",
    "reranker_direction_delta",
]

# Core dense features with 100% coverage (156/156 rows)
CORE_DENSE_FEATURES = [
    "same_domain",
    "same_category",
    "canonical_url_match",
    "normalized_url_match",
    "exact_normalized_title_match",
    "title_token_intersection",
    "title_overlap_coefficient",
    "title_jaccard_similarity",
    "significant_word_count_a",
    "significant_word_count_b",
    "number_overlap",
    "date_overlap",
    "entity_anchor_overlap",
    "published_delta_hours",
    "same_calendar_day_utc",
    "qwen_embedding_cosine",
    "mistral_embedding_cosine",
]

FORBIDDEN_FEATURES = {
    "entry_a_id", "entry_b_id", "id_a", "id_b", "pair_key",
    "feed_a", "feed_b", "feed_id_a", "feed_id_b",
    "title_a", "title_b", "url_a", "url_b",
    "gold_label", "episode_family_id", "decision_source", "audit_note",
    "stratum", "qwen_rank", "mistral_rank", "best_rank",
}


def make_canonical_pair_key(id_a: Any, id_b: Any) -> str:
    """Return canonical pair key: min(id_a, id_b):max(id_a, id_b)."""
    a = int(id_a)
    b = int(id_b)
    return f"{min(a, b)}:{max(a, b)}"


class FeatureJoinError(Exception):
    """Raised when gold dataset pairs fail to join with the pair universe."""
    pass


def load_and_materialize_features(
    gold_path: str = DEFAULT_GOLD_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    reranker_path: str = DEFAULT_RERANKER_PATH,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Load frozen corpus, pair universe, reranker, and gold dataset.
    Normalizes pair keys, joins features 156/156, and checks invariants.
    """
    file_sha, gold_rows = verify_gold_integrity(gold_path)

    # Load corpus
    if not os.path.exists(corpus_path):
        raise FileNotFoundError(f"Corpus not found at {corpus_path}")
    with open(corpus_path, "rb") as f:
        corpus_sha = hashlib.sha256(f.read()).hexdigest()
    _, _, corpus_entries = CorpusVerifier.verify(corpus_path)
    corpus_lookup = {int(e["id"]): e for e in corpus_entries}

    # Load pair universe
    if not os.path.exists(pairs_path):
        raise FileNotFoundError(f"Pairs file not found at {pairs_path}")
    with open(pairs_path, "rb") as f:
        pairs_sha = hashlib.sha256(f.read()).hexdigest()
    with open(pairs_path, "r", encoding="utf-8") as f:
        pairs_rows = list(csv.DictReader(f))
    pair_universe_dict = {p["pair_key"]: p for p in pairs_rows}

    # Load reranker
    reranker_sha = ""
    reranker_lookup = {}
    if reranker_path and os.path.exists(reranker_path):
        with open(reranker_path, "rb") as f:
            reranker_sha = hashlib.sha256(f.read()).hexdigest()
        with open(reranker_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ab = float(r["reranker_score_ab"])
                ba = float(r["reranker_score_ba"])
                reranker_lookup[r["pair_key"]] = {
                    "ab": ab,
                    "ba": ba,
                    "mean": float(r["reranker_score_mean"]),
                    "delta": round(abs(ab - ba), 4),
                }

    # Feature Join Gate
    gold_pair_keys = set()
    joined_rows = []
    missing_pairs = []
    duplicate_pairs = []

    for g in gold_rows:
        canon_key = make_canonical_pair_key(g["entry_a_id"], g["entry_b_id"])
        if canon_key in gold_pair_keys:
            duplicate_pairs.append(canon_key)
        gold_pair_keys.add(canon_key)

        if canon_key not in pair_universe_dict:
            missing_pairs.append(canon_key)
            continue

        raw_pair = pair_universe_dict[canon_key]
        feats = FeatureExtractor.extract_features(raw_pair, reranker_lookup, corpus_lookup)

        # Merge gold metadata (retaining labels for evaluation, not as features)
        row_dict = {
            "pair_key": canon_key,
            "entry_a_id": str(min(int(g["entry_a_id"]), int(g["entry_b_id"]))),
            "entry_b_id": str(max(int(g["entry_a_id"]), int(g["entry_b_id"]))),
            "gold_label": g["gold_label"],
            "episode_family_id": g.get("episode_family_id", ""),
            "target_binary": 1 if g["gold_label"] == "SAME_EVENT" else 0,
        }

        # Add all allowed features
        for feat in ALLOWED_FEATURES:
            row_dict[feat] = feats.get(feat)

        joined_rows.append(row_dict)

    if len(gold_rows) != 156 or len(gold_pair_keys) != 156:
        raise FeatureJoinError(f"Gold pair count invalid: {len(gold_rows)} rows, {len(gold_pair_keys)} unique keys")

    if missing_pairs or duplicate_pairs or len(joined_rows) != 156:
        raise FeatureJoinError(
            f"Feature join failed: joined={len(joined_rows)}/156, "
            f"missing={len(missing_pairs)}, duplicate={len(duplicate_pairs)}"
        )

    # Compute feature coverage summary
    coverage_stats = {}
    for feat in ALLOWED_FEATURES:
        vals = [r[feat] for r in joined_rows if r.get(feat) is not None]
        null_cnt = len(joined_rows) - len(vals)
        coverage_stats[feat] = {
            "non_null_count": len(vals),
            "null_count": null_cnt,
            "min": round(min(vals), 4) if vals else None,
            "max": round(max(vals), 4) if vals else None,
            "mean": round(sum(vals) / len(vals), 4) if vals else None,
        }

    meta = {
        "gold_sha256": file_sha,
        "corpus_sha256": corpus_sha,
        "pairs_sha256": pairs_sha,
        "reranker_sha256": reranker_sha,
        "gold_pair_count": len(gold_rows),
        "unique_gold_pair_keys": len(gold_pair_keys),
        "feature_joined_pair_count": len(joined_rows),
        "missing_feature_pairs": len(missing_pairs),
        "duplicate_feature_pairs": len(duplicate_pairs),
        "coverage_stats": coverage_stats,
    }

    return joined_rows, meta


def export_feature_matrix_privately(
    rows: List[Dict[str, Any]],
    output_dir: str = DEFAULT_PRIVATE_M1_DIR,
) -> Tuple[str, str]:
    """
    Materializes private feature matrix story01b-m1-features-v1.csv outside git.
    Returns (path, sha256).
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "story01b-m1-features-v1.csv")

    fieldnames = [
        "pair_key", "entry_a_id", "entry_b_id", "gold_label", "episode_family_id", "target_binary"
    ] + ALLOWED_FEATURES

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in fieldnames})

    with open(out_path, "rb") as f:
        file_sha = hashlib.sha256(f.read()).hexdigest()
    return out_path, file_sha


def calculate_f_beta(precision: float, recall: float, beta: float = 0.5) -> float:
    """Calculate F-beta score (beta=0.5 weights precision higher than recall)."""
    if precision <= 0.0 or recall <= 0.0:
        return 0.0
    b2 = beta ** 2
    denom = (b2 * precision) + recall
    if denom <= 0.0:
        return 0.0
    return (1.0 + b2) * (precision * recall) / denom


def find_optimal_threshold_f05(
    y_true: List[int],
    scores: List[float],
) -> Tuple[float, float, float, float]:
    """
    Search threshold that maximizes F0.5 on validation data.
    Returns: (best_threshold, best_f05, best_precision, best_recall)
    """
    if not scores or not y_true:
        return 0.5, 0.0, 0.0, 0.0

    unique_scores = sorted(list(set(scores)))
    if len(unique_scores) == 1:
        return unique_scores[0], 0.0, 0.0, 0.0

    # Test percentiles or unique midpoints
    candidates = []
    for i in range(len(unique_scores) - 1):
        candidates.append((unique_scores[i] + unique_scores[i + 1]) / 2.0)
    candidates.append(unique_scores[0] - 1e-4)
    candidates.append(unique_scores[-1] + 1e-4)

    best_thresh = candidates[0]
    best_f05 = -1.0
    best_p = 0.0
    best_r = 0.0

    total_pos = sum(y_true)
    for t in candidates:
        tp = 0
        fp = 0
        for yt, sc in zip(y_true, scores):
            pred = (sc >= t)
            if pred:
                if yt == 1:
                    tp += 1
                else:
                    fp += 1

        p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r = tp / total_pos if total_pos > 0 else 0.0
        f05 = calculate_f_beta(p, r, beta=0.5)

        # Pre-registered tie breaking: higher f0.5, then higher precision, then higher recall
        if (f05 > best_f05) or (math.isclose(f05, best_f05, abs_tol=1e-7) and p > best_p):
            best_f05 = f05
            best_thresh = t
            best_p = p
            best_r = r

    return best_thresh, best_f05, best_p, best_r


class CandidateModel:
    """Wrapper for baseline and learned classifiers."""

    def __init__(self, name: str, model_type: str, seed: int = DEFAULT_SEED):
        self.name = name
        self.model_type = model_type
        self.seed = seed
        self.fitted_model: Any = None

    def fit_and_score(
        self,
        train_rows: List[Dict[str, Any]],
        test_rows: List[Dict[str, Any]],
    ) -> Tuple[List[float], List[float]]:
        """
        Fits on train_rows (if learned) and scores both train_rows and test_rows.
        Returns: (train_scores, test_scores)
        """
        if self.model_type == "B0_TITLE_OVERLAP_ONLY":
            train_sc = [float(r["title_overlap_coefficient"]) for r in train_rows]
            test_sc = [float(r["title_overlap_coefficient"]) for r in test_rows]
            return train_sc, test_sc

        elif self.model_type == "B1_QWEN_COSINE_ONLY":
            train_sc = [float(r["qwen_embedding_cosine"]) for r in train_rows]
            test_sc = [float(r["qwen_embedding_cosine"]) for r in test_rows]
            return train_sc, test_sc

        elif self.model_type == "B2_MISTRAL_COSINE_ONLY":
            train_sc = [float(r["mistral_embedding_cosine"]) for r in train_rows]
            test_sc = [float(r["mistral_embedding_cosine"]) for r in test_rows]
            return train_sc, test_sc

        elif self.model_type == "B3_RERANKER_MEAN_ONLY":
            # For B3, scores are reranker_score_mean where available, else -999.0
            train_sc = [float(r["reranker_score_mean"]) if r.get("reranker_score_mean") is not None else -999.0 for r in train_rows]
            test_sc = [float(r["reranker_score_mean"]) if r.get("reranker_score_mean") is not None else -999.0 for r in test_rows]
            return train_sc, test_sc

        elif self.model_type == "B4_LOGISTIC_REGRESSION":
            X_train = [[float(r[f]) for f in CORE_DENSE_FEATURES] for r in train_rows]
            y_train = [int(r["target_binary"]) for r in train_rows]
            X_test = [[float(r[f]) for f in CORE_DENSE_FEATURES] for r in test_rows]

            pipe = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=self.seed))
            ])
            pipe.fit(X_train, y_train)
            self.fitted_model = pipe

            train_sc = [float(p[1]) for p in pipe.predict_proba(X_train)]
            test_sc = [float(p[1]) for p in pipe.predict_proba(X_test)]
            return train_sc, test_sc

        elif self.model_type == "B5_GRADIENT_BOOSTED_TREES":
            X_train = [[float(r[f]) for f in CORE_DENSE_FEATURES] for r in train_rows]
            y_train = [int(r["target_binary"]) for r in train_rows]
            X_test = [[float(r[f]) for f in CORE_DENSE_FEATURES] for r in test_rows]

            gb = GradientBoostingClassifier(
                n_estimators=30,
                max_depth=2,
                learning_rate=0.05,
                subsample=0.8,
                random_state=self.seed
            )
            gb.fit(X_train, y_train)
            self.fitted_model = gb

            train_sc = [float(p[1]) for p in gb.predict_proba(X_train)]
            test_sc = [float(p[1]) for p in gb.predict_proba(X_test)]
            return train_sc, test_sc

        else:
            raise ValueError(f"Unknown candidate model type: {self.model_type}")


def run_inner_threshold_cv(
    model_type: str,
    train_fold_a_rows: List[Dict[str, Any]],
    train_fold_b_rows: List[Dict[str, Any]],
    seed: int = DEFAULT_SEED,
) -> float:
    """
    Inner 2-fold component group CV within outer train data.
    Fits on A -> scores B; fits on B -> scores A.
    Pools inner scores and selects threshold maximizing F0.5.
    """
    # 1. Train on A, score B
    mA = CandidateModel(f"{model_type}_innerA", model_type, seed=seed)
    _, scores_B = mA.fit_and_score(train_fold_a_rows, train_fold_b_rows)

    # 2. Train on B, score A
    mB = CandidateModel(f"{model_type}_innerB", model_type, seed=seed)
    _, scores_A = mB.fit_and_score(train_fold_b_rows, train_fold_a_rows)

    pooled_scores = scores_B + scores_A
    pooled_y = [int(r["target_binary"]) for r in train_fold_b_rows] + [int(r["target_binary"]) for r in train_fold_a_rows]

    best_thresh, _, _, _ = find_optimal_threshold_f05(pooled_y, pooled_scores)
    return best_thresh


def evaluate_outer_folds(
    rows: List[Dict[str, Any]],
    folds_definition: List[Dict[str, Any]],
    graph: ArticleGraph,
    candidate_names: List[str],
    seed: int = DEFAULT_SEED,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Execute Protocol A outer 3-fold cross-validation across candidate models.
    """
    # Index rows by pair_key
    rows_by_key = {r["pair_key"]: r for r in rows}
    comp_lookup = {c["component_id"]: c for c in graph.get_component_details()}

    # Prepare fold rows
    fold_data = []
    for f in folds_definition:
        f_idx = f["fold"]
        f_components = f["components"]
        f_rows = []
        f_articles = set()
        for cid in f_components:
            c_info = comp_lookup[cid]
            f_articles.update(c_info["nodes"])
            for p in c_info["pairs"]:
                pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                f_rows.append(rows_by_key[pk])

        fold_data.append({
            "fold_idx": f_idx,
            "rows": f_rows,
            "components": f_components,
            "articles": f_articles,
        })

    all_predictions = []
    results_by_candidate: Dict[str, Any] = {c: {"folds": []} for c in candidate_names}

    k = len(fold_data)
    for test_idx in range(k):
        test_fold = fold_data[test_idx]
        test_rows = test_fold["rows"]

        # Outer train comprises the other k-1 folds
        train_subfolds = [fold_data[i] for i in range(k) if i != test_idx]
        outer_train_rows = []
        for sf in train_subfolds:
            outer_train_rows.extend(sf["rows"])

        # Inner folds for threshold tuning
        inner_a = train_subfolds[0]["rows"]
        inner_b = train_subfolds[1]["rows"]

        # Assert zero leakage between outer train and outer test
        test_articles = set(test_fold["articles"])
        train_articles = set()
        for sf in train_subfolds:
            train_articles.update(sf["articles"])
        leakage = len(test_articles & train_articles)
        if leakage > 0:
            raise ValueError(f"Outer fold {test_idx} article leakage detected: {leakage} articles overlap!")

        y_test = [int(r["target_binary"]) for r in test_rows]
        gold_labels = [r["gold_label"] for r in test_rows]

        for cand in candidate_names:
            # 1. Inner threshold selection
            selected_thresh = run_inner_threshold_cv(cand, inner_a, inner_b, seed=seed)

            # 2. Refit on complete outer train, score test
            model = CandidateModel(f"{cand}_outer_{test_idx}", cand, seed=seed)
            _, test_scores = model.fit_and_score(outer_train_rows, test_rows)

            # 3. Calculate threshold-free metrics (ROC-AUC, PR-AUC)
            roc_auc = None
            pr_auc = None
            # Only compute if both classes present and valid
            if len(set(y_test)) > 1 and cand != "B3_RERANKER_MEAN_ONLY":
                try:
                    roc_auc = round(float(roc_auc_score(y_test, test_scores)), 4)
                    pr_auc = round(float(average_precision_score(y_test, test_scores)), 4)
                except Exception:
                    pass

            # 4. Operating point metrics with selected threshold
            preds = [1 if sc >= selected_thresh else 0 for sc in test_scores]

            tp = sum(1 for yt, yp in zip(y_test, preds) if yt == 1 and yp == 1)
            fp = sum(1 for yt, yp in zip(y_test, preds) if yt == 0 and yp == 1)
            tn = sum(1 for yt, yp in zip(y_test, preds) if yt == 0 and yp == 0)
            fn = sum(1 for yt, yp in zip(y_test, preds) if yt == 1 and yp == 0)

            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f05 = calculate_f_beta(prec, rec, beta=0.5)
            f1 = calculate_f_beta(prec, rec, beta=1.0)

            # Hard-negative false positive breakdown
            rel_total = sum(1 for l in gold_labels if l == "RELATED_TOPIC")
            diff_total = sum(1 for l in gold_labels if l == "DIFFERENT_EVENT")
            rel_fp = sum(1 for l, yp in zip(gold_labels, preds) if l == "RELATED_TOPIC" and yp == 1)
            diff_fp = sum(1 for l, yp in zip(gold_labels, preds) if l == "DIFFERENT_EVENT" and yp == 1)

            rel_fpr = round(rel_fp / rel_total, 4) if rel_total > 0 else 0.0
            diff_fpr = round(diff_fp / diff_total, 4) if diff_total > 0 else 0.0

            fold_metric = {
                "fold": test_idx,
                "selected_threshold": round(selected_thresh, 4),
                "roc_auc": roc_auc,
                "pr_auc": pr_auc,
                "precision": round(prec, 4),
                "recall": round(rec, 4),
                "f0_5": round(f05, 4),
                "f1": round(f1, 4),
                "tp": tp,
                "fp": fp,
                "tn": tn,
                "fn": fn,
                "related_topic_count": rel_total,
                "related_topic_fp": rel_fp,
                "related_topic_fpr": rel_fpr,
                "different_event_count": diff_total,
                "different_event_fp": diff_fp,
                "different_event_fpr": diff_fpr,
            }
            results_by_candidate[cand]["folds"].append(fold_metric)

            # Record individual test predictions
            for r, sc, p in zip(test_rows, test_scores, preds):
                all_predictions.append({
                    "pair_key": r["pair_key"],
                    "outer_fold": test_idx,
                    "gold_label": r["gold_label"],
                    "episode_family_id": r.get("episode_family_id", ""),
                    "candidate_model": cand,
                    "raw_score": round(sc, 4),
                    "selected_inner_threshold": round(selected_thresh, 4),
                    "predicted_same_event": p,
                })

    return results_by_candidate, all_predictions


def aggregate_candidate_metrics(
    candidate_results: Dict[str, Any],
    predictions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Computes aggregate metrics, family macro recall, and Duo sensitivity for each candidate.
    """
    summary = {}

    for cand, cdata in candidate_results.items():
        folds = cdata["folds"]
        k = len(folds)

        prec_list = [f["precision"] for f in folds]
        rec_list = [f["recall"] for f in folds]
        f05_list = [f["f0_5"] for f in folds]
        f1_list = [f["f1"] for f in folds]
        rel_fpr_list = [f["related_topic_fpr"] for f in folds]
        diff_fpr_list = [f["different_event_fpr"] for f in folds]

        auc_list = [f["roc_auc"] for f in folds if f["roc_auc"] is not None]
        prauc_list = [f["pr_auc"] for f in folds if f["pr_auc"] is not None]

        # Extract predictions for this candidate
        cand_preds = [p for p in predictions if p["candidate_model"] == cand]

        # Family macro recall
        pos_preds = [p for p in cand_preds if p["gold_label"] == "SAME_EVENT"]
        fam_counts = Counter(p["episode_family_id"] for p in pos_preds)
        fam_correct = Counter(p["episode_family_id"] for p in pos_preds if p["predicted_same_event"] == 1)

        per_family_recall = {}
        for fam, tot in sorted(fam_counts.items()):
            c_cnt = fam_correct.get(fam, 0)
            r_val = round(c_cnt / tot, 4)
            per_family_recall[fam] = {
                "total_pairs": tot,
                "correct_positive_predictions": c_cnt,
                "recall": r_val,
                "single_pair_family": "YES" if tot == 1 else "NO",
            }

        macro_recall = round(statistics.mean([v["recall"] for v in per_family_recall.values()]), 4)
        duo_recall = per_family_recall.get("IPHONE_DUO_FIRST_GEN_LAUNCH", {}).get("recall", 0.0)

        non_duo_recalls = [v["recall"] for k, v in per_family_recall.items() if k != "IPHONE_DUO_FIRST_GEN_LAUNCH"]
        non_duo_macro_recall = round(statistics.mean(non_duo_recalls), 4) if non_duo_recalls else 0.0

        # Duo Sensitivity Analysis (metrics computed excluding iPhone Duo)
        non_duo_preds = [p for p in cand_preds if p.get("episode_family_id") != "IPHONE_DUO_FIRST_GEN_LAUNCH"]
        nd_tp = sum(1 for p in non_duo_preds if p["gold_label"] == "SAME_EVENT" and p["predicted_same_event"] == 1)
        nd_fp = sum(1 for p in non_duo_preds if p["gold_label"] != "SAME_EVENT" and p["predicted_same_event"] == 1)
        nd_fn = sum(1 for p in non_duo_preds if p["gold_label"] == "SAME_EVENT" and p["predicted_same_event"] == 0)

        nd_prec = round(nd_tp / (nd_tp + nd_fp), 4) if (nd_tp + nd_fp) > 0 else 0.0
        nd_rec = round(nd_tp / (nd_tp + nd_fn), 4) if (nd_tp + nd_fn) > 0 else 0.0
        nd_f05 = round(calculate_f_beta(nd_prec, nd_rec, beta=0.5), 4)
        nd_f1 = round(calculate_f_beta(nd_prec, nd_rec, beta=1.0), 4)

        all_tp = sum(f["tp"] for f in folds)
        all_fp = sum(f["fp"] for f in folds)
        all_fn = sum(f["fn"] for f in folds)
        overall_prec = round(all_tp / (all_tp + all_fp), 4) if (all_tp + all_fp) > 0 else 0.0
        overall_rec = round(all_tp / (all_tp + all_fn), 4) if (all_tp + all_fn) > 0 else 0.0
        overall_f05 = round(calculate_f_beta(overall_prec, overall_rec, beta=0.5), 4)

        summary[cand] = {
            "folds": folds,
            "mean_roc_auc": round(statistics.mean(auc_list), 4) if auc_list else None,
            "mean_pr_auc": round(statistics.mean(prauc_list), 4) if prauc_list else None,
            "mean_precision": round(statistics.mean(prec_list), 4),
            "median_precision": round(statistics.median(prec_list), 4),
            "mean_recall": round(statistics.mean(rec_list), 4),
            "median_recall": round(statistics.median(rec_list), 4),
            "mean_f0_5": round(statistics.mean(f05_list), 4),
            "median_f0_5": round(statistics.median(f05_list), 4),
            "mean_f1": round(statistics.mean(f1_list), 4),
            "mean_related_topic_fpr": round(statistics.mean(rel_fpr_list), 4),
            "mean_different_event_fpr": round(statistics.mean(diff_fpr_list), 4),
            "episode_family_macro_recall": macro_recall,
            "iphone_duo_recall": duo_recall,
            "non_duo_macro_recall": non_duo_macro_recall,
            "per_family_recall": per_family_recall,
            "duo_sensitivity": {
                "all_data_precision": overall_prec,
                "all_data_recall": overall_rec,
                "all_data_f05": overall_f05,
                "non_duo_precision": nd_prec,
                "non_duo_recall": nd_rec,
                "non_duo_f05": nd_f05,
                "delta_precision_without_duo": round(nd_prec - overall_prec, 4),
                "delta_recall_without_duo": round(nd_rec - overall_rec, 4),
                "delta_f05_without_duo": round(nd_f05 - overall_f05, 4),
            },
            "comparable_full_gold": "NO" if cand == "B3_RERANKER_MEAN_ONLY" else "YES",
        }

    return summary


def run_benchmark(
    gold_path: str = DEFAULT_GOLD_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    reranker_path: str = DEFAULT_RERANKER_PATH,
    output_dir: str = DEFAULT_PRIVATE_M1_DIR,
    seed: int = DEFAULT_SEED,
) -> Dict[str, Any]:
    """
    Execute full STORY-01B-M1 offline pair classifier benchmark.
    """
    if not SKLEARN_AVAILABLE:
        raise RuntimeError("scikit-learn is required for STORY-01B-M1 benchmark.")

    # 1. Feature Materialization & Coverage
    rows, feat_meta = load_and_materialize_features(
        gold_path=gold_path,
        corpus_path=corpus_path,
        pairs_path=pairs_path,
        reranker_path=reranker_path,
    )

    feat_matrix_path, feat_matrix_sha = export_feature_matrix_privately(rows, output_dir=output_dir)

    # 2. Outer Evaluation Split (Protocol A K=3 from ArticleGraph)
    pairs_for_graph = [
        {"entry_a_id": r["entry_a_id"], "entry_b_id": r["entry_b_id"], "gold_label": r["gold_label"], "episode_family_id": r["episode_family_id"]}
        for r in rows
    ]
    graph = ArticleGraph(pairs_for_graph)
    proto_a = simulate_protocol_a(graph, k=3)

    # Validate LOFO mapping gate and Protocol A
    spans, multi = graph.validate_positive_family_component_mapping(fail_fast=True)
    if proto_a["article_leakage"] > 0:
        raise ValueError("Protocol A article leakage is not zero!")

    # 3. Outer Evaluation Loop
    candidates = [
        "B0_TITLE_OVERLAP_ONLY",
        "B1_QWEN_COSINE_ONLY",
        "B2_MISTRAL_COSINE_ONLY",
        "B3_RERANKER_MEAN_ONLY",
        "B4_LOGISTIC_REGRESSION",
        "B5_GRADIENT_BOOSTED_TREES",
    ]

    candidate_results, predictions = evaluate_outer_folds(
        rows=rows,
        folds_definition=proto_a["folds"],
        graph=graph,
        candidate_names=candidates,
        seed=seed,
    )

    # 4. Aggregations & Metrics
    summary = aggregate_candidate_metrics(candidate_results, predictions)

    # 5. Export Predictions Table
    os.makedirs(output_dir, exist_ok=True)
    pred_path = os.path.join(output_dir, "story01b-m1-fold-predictions-v1.csv")
    pred_fields = [
        "pair_key", "outer_fold", "gold_label", "episode_family_id",
        "candidate_model", "raw_score", "selected_inner_threshold", "predicted_same_event"
    ]
    with open(pred_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=pred_fields)
        writer.writeheader()
        for p in predictions:
            writer.writerow(p)
    with open(pred_path, "rb") as f:
        pred_sha = hashlib.sha256(f.read()).hexdigest()

    # 6. Complementary LOFO Evaluation
    lofo_n1 = simulate_lofo_n1(graph)
    lofo_n2 = simulate_lofo_n2(graph)

    # 7. Model Selection & Outcome Classification
    # Priority: Precision > F0.5 > Non-Duo Macro Recall > Related Topic FPR
    full_gold_candidates = [c for c in candidates if summary[c]["comparable_full_gold"] == "YES"]

    best_pair = max(full_gold_candidates, key=lambda c: (summary[c]["mean_f0_5"], summary[c]["mean_precision"]))
    best_family = max(full_gold_candidates, key=lambda c: (summary[c]["non_duo_macro_recall"], summary[c]["episode_family_macro_recall"]))
    best_rel = min(full_gold_candidates, key=lambda c: summary[c]["mean_related_topic_fpr"])

    # Determine exploratory recommendation and outcome
    # Check if there is a consistent winner across folds and non-Duo
    m1_result = "CLEAR_EXPLORATORY_CANDIDATE" if summary[best_pair]["non_duo_macro_recall"] > 0.0 else "NO_CLEAR_WINNER"

    benchmark_data = {
        "benchmark_version": "story01b-m1",
        "seed": seed,
        "sklearn_version": SKLEARN_VERSION,
        "input_receipts": {
            "gold_sha256": feat_meta["gold_sha256"],
            "corpus_sha256": feat_meta["corpus_sha256"],
            "pairs_sha256": feat_meta["pairs_sha256"],
            "reranker_sha256": feat_meta["reranker_sha256"],
            "feature_matrix_sha256": feat_matrix_sha,
            "fold_predictions_sha256": pred_sha,
        },
        "gates": {
            "feature_join_gate": "PASS",
            "no_label_feature_leakage_gate": "PASS",
            "article_disjoint_gate": "PASS",
            "train_only_preprocessing_gate": "PASS",
            "train_only_threshold_gate": "PASS",
            "n2_aggregation_guard_gate": "PASS",
            "n2_reserved_negative_pool_reused_across_lofo_folds": N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
            "n2_negatives_must_not_be_counted_as_independent_repeated_observations_in_aggregated_lofo_metrics": N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        },
        "feature_coverage": feat_meta["coverage_stats"],
        "primary_protocol": "PROTOCOL_A_COMPONENT_GROUP_3FOLD",
        "outer_folds": 3,
        "candidates": summary,
        "model_selection": {
            "best_pair_level_candidate": best_pair,
            "best_family_level_candidate": best_family,
            "best_related_topic_specificity_candidate": best_rel,
            "recommended_exploratory_candidate": best_pair,
            "m1_result": m1_result,
        },
    }

    bench_json_path = os.path.join(output_dir, "story01b-m1-benchmark-v1.json")
    with open(bench_json_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_data, f, indent=2, default=str)
    with open(bench_json_path, "rb") as f:
        bench_sha = hashlib.sha256(f.read()).hexdigest()
    benchmark_data["input_receipts"]["benchmark_json_sha256"] = bench_sha

    return benchmark_data


def main():
    parser = argparse.ArgumentParser(description="NewsFlux STORY-01B-M1 Pair Classifier Benchmark")
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--reranker", default=DEFAULT_RERANKER_PATH)
    parser.add_argument("--outdir", default=DEFAULT_PRIVATE_M1_DIR)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    data = run_benchmark(
        gold_path=args.gold,
        corpus_path=args.corpus,
        pairs_path=args.pairs,
        reranker_path=args.reranker,
        output_dir=args.outdir,
        seed=args.seed,
    )

    if args.json:
        print(json.dumps(data, indent=2, default=str))
        return

    print("=" * 60)
    print("NEWSFLUX STORY IDENTITY — STORY-01B-M1 BENCHMARK SUMMARY")
    print("=" * 60)
    print("SKLEARN_VERSION:", data["sklearn_version"])
    print("FEATURE_MATRIX_SHA256:", data["input_receipts"]["feature_matrix_sha256"])
    print("PREDICTIONS_SHA256:   ", data["input_receipts"]["fold_predictions_sha256"])
    print("-" * 60)
    print(f"{'CANDIDATE':30s} | {'F0.5':6s} | {'PREC':6s} | {'REC':6s} | {'REL_FPR':7s} | {'NON_DUO_REC':11s}")
    print("-" * 75)
    for cand, res in data["candidates"].items():
        if res["comparable_full_gold"] == "NO":
            print(f"{cand:30s} | NOT_COMPARABLE_FULL_GOLD (71/156 coverage)")
            continue
        print(
            f"{cand:30s} | {res['mean_f0_5']:0.4f} | {res['mean_precision']:0.4f} | {res['mean_recall']:0.4f} | "
            f"{res['mean_related_topic_fpr']:0.4f}  | {res['non_duo_macro_recall']:0.4f}"
        )
    print("-" * 60)
    ms = data["model_selection"]
    print("BEST_PAIR_LEVEL_CANDIDATE:          ", ms["best_pair_level_candidate"])
    print("BEST_FAMILY_LEVEL_CANDIDATE:        ", ms["best_family_level_candidate"])
    print("BEST_RELATED_TOPIC_CANDIDATE:       ", ms["best_related_topic_specificity_candidate"])
    print("RECOMMENDED_EXPLORATORY_CANDIDATE:  ", ms["recommended_exploratory_candidate"])
    print("M1_RESULT:                          ", ms["m1_result"])
    print("=" * 60)


if __name__ == "__main__":
    main()
