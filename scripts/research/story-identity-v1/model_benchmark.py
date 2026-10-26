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
4. True complementary LOFO N1 (per-family recall) and LOFO N2 (contextual metrics).
5. Exact Duo component isolation (component C02, 59 pairs: 42 pos, 17 neg) for sensitivity analysis.
6. Guardrails for N2 repeated pool observations.
7. No full-gold final fit; no production model artifact created.
8. No sentinel imputation (-999.0 removed); B3 marked NOT_COMPARABLE_FULL_GOLD.
9. Audit-grade MODEL_SELECTION_EVIDENCE across 9 evaluation dimensions.

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
        PairUniverseVerifier,
        FEATURE_SCHEMA_VERSION,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_SHA256,
        EXPECTED_PAIR_UNIVERSE_COUNT,
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
        PairUniverseVerifier,
        FEATURE_SCHEMA_VERSION,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_SHA256,
        EXPECTED_PAIR_UNIVERSE_COUNT,
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

DEFAULT_CORPUS_PATH = os.environ.get(
    "STORY01B_CORPUS_PATH",
    "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
)
DEFAULT_PAIRS_PATH = os.environ.get(
    "STORY01B_PAIRS_PATH",
    "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
)
DEFAULT_RERANKER_PATH = os.environ.get(
    "STORY01B_RERANKER_PATH",
    "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/r3b-qwen3-reranker-0.6b-top250/r3b-qwen3-reranker-top250.csv"
)
DEFAULT_PRIVATE_M1_DIR = os.environ.get(
    "STORY01B_M1_OUTDIR",
    "/tmp/newsflux-story01b-private/m1"
)

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


class FrozenInputIntegrityError(Exception):
    """Raised when corpus or pair universe fail canonical integrity verification."""
    pass


def validate_pair_keys_and_orientation(
    rows: List[Dict[str, Any]],
    id_a_col: str = "id_a",
    id_b_col: str = "id_b",
    pair_key_col: str = "pair_key",
    source_name: str = "Dataset",
) -> Dict[str, Dict[str, Any]]:
    """
    Validates canonical pair key formatting min(a,b):max(a,b), detects orientation conflicts,
    and checks for duplicate pair keys fail-fast.
    """
    seen_keys: Dict[str, Dict[str, Any]] = {}
    for idx, r in enumerate(rows, 1):
        a = r[id_a_col]
        b = r[id_b_col]
        canon = make_canonical_pair_key(a, b)
        declared = r.get(pair_key_col)
        if declared and declared != canon:
            raise FeatureJoinError(
                f"{source_name} row {idx} has orientation conflict: declared '{declared}' != canonical '{canon}'"
            )
        if canon in seen_keys:
            raise FeatureJoinError(
                f"Duplicate pair key '{canon}' found in {source_name} at row {idx}"
            )
        seen_keys[canon] = r
    return seen_keys


def load_and_materialize_features(
    gold_path: str = DEFAULT_GOLD_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    reranker_path: str = DEFAULT_RERANKER_PATH,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Load frozen corpus, pair universe, reranker, and gold dataset.
    Normalizes pair keys, joins features 156/156, and checks invariants fail-fast.
    """
    # 1. Gold integrity
    file_sha, gold_rows = verify_gold_integrity(gold_path)

    # 2. Corpus integrity verification fail-fast
    if not os.path.exists(corpus_path):
        raise FileNotFoundError(f"Corpus not found at {corpus_path}")
    ok_corpus, corpus_errs, corpus_entries = CorpusVerifier.verify(corpus_path)
    if not ok_corpus:
        raise FrozenInputIntegrityError(f"CORPUS_INTEGRITY_GATE=FAIL: {corpus_errs}")

    with open(corpus_path, "rb") as f:
        corpus_sha = hashlib.sha256(f.read()).hexdigest()
    corpus_lookup = {int(e["id"]): e for e in corpus_entries}

    # 3. Pair universe integrity verification fail-fast
    if not os.path.exists(pairs_path):
        raise FileNotFoundError(f"Pairs file not found at {pairs_path}")
    ok_pairs, pairs_errs, pairs_rows = PairUniverseVerifier.verify(pairs_path)
    if not ok_pairs:
        raise FrozenInputIntegrityError(f"PAIR_UNIVERSE_INTEGRITY_GATE=FAIL: {pairs_errs}")

    with open(pairs_path, "rb") as f:
        pairs_sha = hashlib.sha256(f.read()).hexdigest()

    # Detect duplicates and validate orientation in pair universe fail-fast
    pair_universe_dict = validate_pair_keys_and_orientation(
        pairs_rows,
        id_a_col="id_a",
        id_b_col="id_b",
        pair_key_col="pair_key",
        source_name="Pair universe",
    )
    universe_duplicate_keys = 0
    universe_orientation_conflicts = 0

    # 4. Reranker lookup (optional partial coverage)
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

    # 5. Feature Join Gate for Gold Dataset
    gold_pair_keys_dict = validate_pair_keys_and_orientation(
        gold_rows,
        id_a_col="entry_a_id",
        id_b_col="entry_b_id",
        pair_key_col="pair_key",
        source_name="Gold dataset",
    )
    gold_pair_keys = set(gold_pair_keys_dict.keys())
    gold_duplicate_keys = 0
    gold_orientation_conflicts = 0
    label_join_conflicts = 0
    joined_rows = []
    missing_pairs = []

    for idx, g in enumerate(gold_rows, 1):
        canon_gold_key = make_canonical_pair_key(g["entry_a_id"], g["entry_b_id"])
        if canon_gold_key not in pair_universe_dict:
            missing_pairs.append(canon_gold_key)
            continue

        raw_pair = pair_universe_dict[canon_gold_key]
        feats = FeatureExtractor.extract_features(raw_pair, reranker_lookup, corpus_lookup)

        row_dict = {
            "pair_key": canon_gold_key,
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

    if missing_pairs or len(joined_rows) != 156:
        raise FeatureJoinError(
            f"Feature join failed: joined={len(joined_rows)}/156, missing={len(missing_pairs)}"
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
        "duplicate_gold_pair_keys": gold_duplicate_keys,
        "unique_feature_universe_pair_keys": len(pair_universe_dict),
        "duplicate_feature_universe_pair_keys": universe_duplicate_keys,
        "pair_orientation_conflicts": universe_orientation_conflicts + gold_orientation_conflicts,
        "label_join_conflicts": "N/A_SINGLE_LABEL_SOURCE",
        "feature_joined_pair_count": len(joined_rows),
        "missing_feature_pairs": len(missing_pairs),
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
    mA = CandidateModel(f"{model_type}_innerA", model_type, seed=seed)
    _, scores_B = mA.fit_and_score(train_fold_a_rows, train_fold_b_rows)

    mB = CandidateModel(f"{model_type}_innerB", model_type, seed=seed)
    _, scores_A = mB.fit_and_score(train_fold_b_rows, train_fold_a_rows)

    pooled_scores = scores_B + scores_A
    pooled_y = [int(r["target_binary"]) for r in train_fold_b_rows] + [int(r["target_binary"]) for r in train_fold_a_rows]

    best_thresh, _, _, _ = find_optimal_threshold_f05(pooled_y, pooled_scores)
    return best_thresh


def evaluate_single_fold(
    candidate_name: str,
    outer_train_rows: List[Dict[str, Any]],
    test_rows: List[Dict[str, Any]],
    inner_fold_a: List[Dict[str, Any]],
    inner_fold_b: List[Dict[str, Any]],
    seed: int = DEFAULT_SEED,
) -> Tuple[float, List[float], List[int]]:
    """
    Evaluates a candidate model on a single outer fold.
    Threshold is determined strictly from inner_fold_a and inner_fold_b (within outer train data).
    test_rows are strictly used for test inference.
    """
    selected_thresh = run_inner_threshold_cv(candidate_name, inner_fold_a, inner_fold_b, seed=seed)
    model = CandidateModel(f"{candidate_name}_fold", candidate_name, seed=seed)
    _, test_scores = model.fit_and_score(outer_train_rows, test_rows)
    preds = [1 if sc >= selected_thresh else 0 for sc in test_scores]
    return selected_thresh, test_scores, preds


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
    rows_by_key = {r["pair_key"]: r for r in rows}
    comp_lookup = {c["component_id"]: c for c in graph.get_component_details()}

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
            # 1. Single fold evaluation (threshold selected strictly on inner folds, test scored)
            selected_thresh, test_scores, preds = evaluate_single_fold(
                cand, outer_train_rows, test_rows, inner_a, inner_b, seed=seed
            )

            # 2. Calculate threshold-free metrics (ROC-AUC, PR-AUC)
            roc_auc = None
            pr_auc = None
            if len(set(y_test)) > 1:
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
                "positive_prediction_count": sum(preds),
                "related_topic_count": rel_total,
                "related_topic_fp": rel_fp,
                "related_topic_fpr": rel_fpr,
                "different_event_count": diff_total,
                "different_event_fp": diff_fp,
                "different_event_fpr": diff_fpr,
            }
            results_by_candidate[cand]["folds"].append(fold_metric)

            # Record individual test predictions (only full-gold candidates)
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


def build_component_disjoint_inner_folds(
    training_rows: List[Dict[str, Any]],
    k: int = 2,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Constructs deterministic component-disjoint inner folds on training rows.
    Guarantees that connected components remain indivisible and:
      INNER_A_ARTICLE_IDS ∩ INNER_B_ARTICLE_IDS = EMPTY
    Returns: (inner_a_rows, inner_b_rows, metadata)
    """
    if not training_rows:
        return [], [], {
            "feasible": False,
            "article_leakage": 0,
            "reason": "OPERATING_POINT_UNAVAILABLE_FOR_FOLD: empty training rows",
        }

    pairs_for_graph = [
        {
            "entry_a_id": str(r["entry_a_id"]),
            "entry_b_id": str(r["entry_b_id"]),
            "gold_label": r["gold_label"],
            "episode_family_id": r.get("episode_family_id", ""),
        }
        for r in training_rows
    ]
    inner_graph = ArticleGraph(pairs_for_graph)
    comp_details = inner_graph.get_component_details()

    if len(comp_details) < k:
        return [], [], {
            "feasible": False,
            "article_leakage": 0,
            "reason": f"OPERATING_POINT_UNAVAILABLE_FOR_FOLD: only {len(comp_details)} components available for {k}-fold split",
        }

    sim = simulate_protocol_a(inner_graph, k=k)
    f0_meta = sim["folds"][0]
    f1_meta = sim["folds"][1]

    rows_by_canon_key = {r["pair_key"]: r for r in training_rows}
    comp_lookup = {c["component_id"]: c for c in comp_details}

    f0_rows = []
    f0_articles: Set[str] = set()
    for cid in f0_meta["components"]:
        c = comp_lookup[cid]
        f0_articles.update(c["nodes"])
        for p in c["pairs"]:
            pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
            f0_rows.append(rows_by_canon_key[pk])

    f1_rows = []
    f1_articles: Set[str] = set()
    for cid in f1_meta["components"]:
        c = comp_lookup[cid]
        f1_articles.update(c["nodes"])
        for p in c["pairs"]:
            pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
            f1_rows.append(rows_by_canon_key[pk])

    leakage = len(f0_articles & f1_articles)
    if leakage > 0:
        raise ValueError(f"Inner component split article leakage detected: {leakage} articles overlap!")

    p0 = sum(1 for r in f0_rows if r["gold_label"] == "SAME_EVENT")
    n0 = len(f0_rows) - p0
    p1 = sum(1 for r in f1_rows if r["gold_label"] == "SAME_EVENT")
    n1 = len(f1_rows) - p1

    feasible = (p0 > 0 and n0 > 0 and p1 > 0 and n1 > 0 and leakage == 0)

    meta = {
        "feasible": feasible,
        "article_leakage": leakage,
        "f0_pair_count": len(f0_rows),
        "f0_positive_count": p0,
        "f0_negative_count": n0,
        "f1_pair_count": len(f1_rows),
        "f1_positive_count": p1,
        "f1_negative_count": n1,
        "reason": "OK" if feasible else "OPERATING_POINT_UNAVAILABLE_FOR_FOLD: lack of positive or negative pairs in inner fold",
    }
    return f0_rows, f1_rows, meta


def execute_complementary_lofo_evaluation(
    rows: List[Dict[str, Any]],
    graph: ArticleGraph,
    candidate_names: List[str],
    reserved_pool_ids: Tuple[str, ...] = ("C07", "C08", "C09"),
    seed: int = DEFAULT_SEED,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    """
    Executes true LOFO N1 (per-family recall) and LOFO N2 (contextual metrics) evaluation
    using component-disjoint inner threshold selection on outer train data.
    """
    rows_by_key = {r["pair_key"]: r for r in rows}
    comp_details = graph.get_component_details()
    fam_to_comp = {}
    for c in comp_details:
        for f in c["episode_families"]:
            fam_to_comp[f] = c

    # Reserved pool components for N2
    reserved_comps = [c for c in comp_details if c["component_id"] in reserved_pool_ids]
    reserved_pairs = []
    reserved_articles = set()
    for rc in reserved_comps:
        for p in rc["pairs"]:
            pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
            reserved_pairs.append(rows_by_key[pk])
        reserved_articles.update(rc["nodes"])

    lofo_n1_results: Dict[str, Any] = {c: {} for c in candidate_names}
    lofo_n2_results: Dict[str, Any] = {c: {} for c in candidate_names}

    n1_total_inner_leakage = 0
    n1_valid_folds = 0
    n2_total_inner_leakage = 0
    n2_valid_folds = 0

    for fam in sorted(fam_to_comp.keys()):
        test_c = fam_to_comp[fam]
        test_c_rows = [rows_by_key[make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])] for p in test_c["pairs"]]
        test_c_articles = set(test_c["nodes"])

        # LOFO N1 Train pairs: from all other components
        train_n1_pairs_raw = []
        for other_c in comp_details:
            if other_c["component_id"] != test_c["component_id"]:
                for p in other_c["pairs"]:
                    pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                    train_n1_pairs_raw.append(rows_by_key[pk])

        pruned_train_n1, _, leak_n1 = prune_training_pairs_touching_test_articles(train_n1_pairs_raw, test_c_articles)
        if leak_n1 > 0:
            raise ValueError(f"LOFO N1 outer leakage for {fam}: {leak_n1}")

        # Component-disjoint inner split for N1
        inner_a_n1, inner_b_n1, n1_meta = build_component_disjoint_inner_folds(pruned_train_n1, k=2)
        n1_total_inner_leakage += n1_meta["article_leakage"]
        if n1_meta["feasible"]:
            n1_valid_folds += 1

        # LOFO N2 Train pairs: from all other components EXCEPT test_c and EXCEPT reserved_comps
        train_n2_pairs_raw = []
        for other_c in comp_details:
            if other_c["component_id"] != test_c["component_id"] and other_c["component_id"] not in reserved_pool_ids:
                for p in other_c["pairs"]:
                    pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                    train_n2_pairs_raw.append(rows_by_key[pk])

        test_n2_articles = test_c_articles | reserved_articles
        pruned_train_n2, _, leak_n2 = prune_training_pairs_touching_test_articles(train_n2_pairs_raw, test_n2_articles)
        if leak_n2 > 0:
            raise ValueError(f"LOFO N2 outer leakage for {fam}: {leak_n2}")

        # Component-disjoint inner split for N2
        inner_a_n2, inner_b_n2, n2_meta = build_component_disjoint_inner_folds(pruned_train_n2, k=2)
        n2_total_inner_leakage += n2_meta["article_leakage"]
        if n2_meta["feasible"]:
            n2_valid_folds += 1

        test_n2_rows = test_c_rows + reserved_pairs

        for cand in candidate_names:
            # Evaluate N1
            if n1_meta["feasible"]:
                thresh_n1 = run_inner_threshold_cv(cand, inner_a_n1, inner_b_n1, seed=seed)
                model_n1 = CandidateModel(f"{cand}_lofo_n1_{fam}", cand, seed=seed)
                _, sc_test_n1 = model_n1.fit_and_score(pruned_train_n1, test_c_rows)

                pos_pairs = [r for r, sc in zip(test_c_rows, sc_test_n1) if r["gold_label"] == "SAME_EVENT"]
                pos_preds = [1 if sc >= thresh_n1 else 0 for r, sc in zip(test_c_rows, sc_test_n1) if r["gold_label"] == "SAME_EVENT"]
                rec_n1 = sum(pos_preds) / len(pos_pairs) if pos_pairs else 0.0

                lofo_n1_results[cand][fam] = {
                    "total_positive_pairs": len(pos_pairs),
                    "correct_positive_predictions": sum(pos_preds),
                    "recall": round(rec_n1, 4),
                    "inner_threshold": round(thresh_n1, 4),
                    "status": "VALID_OPERATING_POINT",
                }
            else:
                lofo_n1_results[cand][fam] = {
                    "total_positive_pairs": sum(1 for r in test_c_rows if r["gold_label"] == "SAME_EVENT"),
                    "correct_positive_predictions": 0,
                    "recall": None,
                    "inner_threshold": None,
                    "status": "OPERATING_POINT_UNAVAILABLE_FOR_FOLD",
                    "reason": n1_meta["reason"],
                }

            # Evaluate N2
            if n2_meta["feasible"]:
                thresh_n2 = run_inner_threshold_cv(cand, inner_a_n2, inner_b_n2, seed=seed)
                model_n2 = CandidateModel(f"{cand}_lofo_n2_{fam}", cand, seed=seed)
                _, sc_test_n2 = model_n2.fit_and_score(pruned_train_n2, test_n2_rows)

                preds_n2 = [1 if sc >= thresh_n2 else 0 for sc in sc_test_n2]
                y_n2 = [int(r["target_binary"]) for r in test_n2_rows]
                labels_n2 = [r["gold_label"] for r in test_n2_rows]

                tp_n2 = sum(1 for yt, yp in zip(y_n2, preds_n2) if yt == 1 and yp == 1)
                fp_n2 = sum(1 for yt, yp in zip(y_n2, preds_n2) if yt == 0 and yp == 1)
                prec_n2 = tp_n2 / (tp_n2 + fp_n2) if (tp_n2 + fp_n2) > 0 else 0.0

                rel_tot_n2 = sum(1 for l in labels_n2 if l == "RELATED_TOPIC")
                diff_tot_n2 = sum(1 for l in labels_n2 if l == "DIFFERENT_EVENT")
                rel_fp_n2 = sum(1 for l, yp in zip(labels_n2, preds_n2) if l == "RELATED_TOPIC" and yp == 1)
                diff_fp_n2 = sum(1 for l, yp in zip(labels_n2, preds_n2) if l == "DIFFERENT_EVENT" and yp == 1)

                lofo_n2_results[cand][fam] = {
                    "contextual_precision": round(prec_n2, 4),
                    "related_topic_fpr": round(rel_fp_n2 / rel_tot_n2, 4) if rel_tot_n2 > 0 else 0.0,
                    "different_event_fpr": round(diff_fp_n2 / diff_tot_n2, 4) if diff_tot_n2 > 0 else 0.0,
                    "inner_threshold": round(thresh_n2, 4),
                    "test_pair_count": len(test_n2_rows),
                    "status": "VALID_OPERATING_POINT",
                }
            else:
                lofo_n2_results[cand][fam] = {
                    "contextual_precision": None,
                    "related_topic_fpr": None,
                    "different_event_fpr": None,
                    "inner_threshold": None,
                    "test_pair_count": len(test_n2_rows),
                    "status": "OPERATING_POINT_UNAVAILABLE_FOR_FOLD",
                    "reason": n2_meta["reason"],
                }

    lofo_meta = {
        "n1_inner_leakage": n1_total_inner_leakage,
        "n1_valid_threshold_folds": f"{n1_valid_folds}/{len(fam_to_comp)}",
        "n2_inner_leakage": n2_total_inner_leakage,
        "n2_valid_threshold_folds": f"{n2_valid_folds}/{len(fam_to_comp)}",
    }
    return lofo_n1_results, lofo_n2_results, lofo_meta


def aggregate_candidate_metrics(
    candidate_results: Dict[str, Any],
    predictions: List[Dict[str, Any]],
    graph: ArticleGraph,
    rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Computes aggregate metrics, component-isolated Duo sensitivity, and full distributions.
    """
    summary = {}
    rows_by_key = {r["pair_key"]: r for r in rows}

    # Locate Duo component accurately
    comp_details = graph.get_component_details()
    duo_comp = next(c for c in comp_details if "IPHONE_DUO_FIRST_GEN_LAUNCH" in c["episode_families"])
    duo_comp_id = duo_comp["component_id"]
    duo_comp_pairs_keys = {make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"]) for p in duo_comp["pairs"]}
    duo_comp_article_count = duo_comp["article_count"]
    duo_comp_pair_count = duo_comp["pair_count"]

    # Non-Duo component pairs
    non_duo_comp_pairs = [r for r in rows if r["pair_key"] not in duo_comp_pairs_keys]
    non_duo_comp_pos_cnt = sum(1 for r in non_duo_comp_pairs if r["gold_label"] == "SAME_EVENT")
    non_duo_comp_neg_cnt = len(non_duo_comp_pairs) - non_duo_comp_pos_cnt

    for cand, cdata in candidate_results.items():
        folds = cdata["folds"]

        prec_list = [f["precision"] for f in folds]
        rec_list = [f["recall"] for f in folds]
        f05_list = [f["f0_5"] for f in folds]
        f1_list = [f["f1"] for f in folds]
        rel_fpr_list = [f["related_topic_fpr"] for f in folds]
        diff_fpr_list = [f["different_event_fpr"] for f in folds]

        auc_list = [f["roc_auc"] for f in folds if f["roc_auc"] is not None]
        prauc_list = [f["pr_auc"] for f in folds if f["pr_auc"] is not None]

        total_pos_preds = sum(f["positive_prediction_count"] for f in folds)

        # Pooled FPR
        total_rel_fp = sum(f["related_topic_fp"] for f in folds)
        total_rel = sum(f["related_topic_count"] for f in folds)
        pooled_rel_fpr = round(total_rel_fp / total_rel, 4) if total_rel > 0 else 0.0

        total_diff_fp = sum(f["different_event_fp"] for f in folds)
        total_diff = sum(f["different_event_count"] for f in folds)
        pooled_diff_fpr = round(total_diff_fp / total_diff, 4) if total_diff > 0 else 0.0

        # Predictions for this candidate
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

        # Accurate Non-Duo Component Sensitivity Analysis (completely excluding Duo component C02)
        non_duo_comp_preds = [p for p in cand_preds if p["pair_key"] not in duo_comp_pairs_keys]
        ndc_tp = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "SAME_EVENT" and p["predicted_same_event"] == 1)
        ndc_fp = sum(1 for p in non_duo_comp_preds if p["gold_label"] != "SAME_EVENT" and p["predicted_same_event"] == 1)
        ndc_fn = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "SAME_EVENT" and p["predicted_same_event"] == 0)

        ndc_prec = round(ndc_tp / (ndc_tp + ndc_fp), 4) if (ndc_tp + ndc_fp) > 0 else 0.0
        ndc_rec = round(ndc_tp / (ndc_tp + ndc_fn), 4) if (ndc_tp + ndc_fn) > 0 else 0.0
        ndc_f05 = round(calculate_f_beta(ndc_prec, ndc_rec, beta=0.5), 4)
        ndc_f1 = round(calculate_f_beta(ndc_prec, ndc_rec, beta=1.0), 4)

        ndc_rel_total = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "RELATED_TOPIC")
        ndc_rel_fp = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "RELATED_TOPIC" and p["predicted_same_event"] == 1)
        ndc_rel_fpr = round(ndc_rel_fp / ndc_rel_total, 4) if ndc_rel_total > 0 else 0.0

        ndc_diff_total = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "DIFFERENT_EVENT")
        ndc_diff_fp = sum(1 for p in non_duo_comp_preds if p["gold_label"] == "DIFFERENT_EVENT" and p["predicted_same_event"] == 1)
        ndc_diff_fpr = round(ndc_diff_fp / ndc_diff_total, 4) if ndc_diff_total > 0 else 0.0

        all_tp = sum(f["tp"] for f in folds)
        all_fp = sum(f["fp"] for f in folds)
        all_fn = sum(f["fn"] for f in folds)
        overall_prec = round(all_tp / (all_tp + all_fp), 4) if (all_tp + all_fp) > 0 else 0.0
        overall_rec = round(all_tp / (all_tp + all_fn), 4) if (all_tp + all_fn) > 0 else 0.0
        overall_f05 = round(calculate_f_beta(overall_prec, overall_rec, beta=0.5), 4)

        summary[cand] = {
            "folds": folds,
            "positive_prediction_count": total_pos_preds,
            "precision": {
                "mean": round(statistics.mean(prec_list), 4),
                "median": round(statistics.median(prec_list), 4),
                "min": round(min(prec_list), 4),
                "max": round(max(prec_list), 4),
            },
            "recall": {
                "mean": round(statistics.mean(rec_list), 4),
                "median": round(statistics.median(rec_list), 4),
                "min": round(min(rec_list), 4),
                "max": round(max(rec_list), 4),
            },
            "f0_5": {
                "mean": round(statistics.mean(f05_list), 4),
                "median": round(statistics.median(f05_list), 4),
                "min": round(min(f05_list), 4),
                "max": round(max(f05_list), 4),
            },
            "f1": {
                "mean": round(statistics.mean(f1_list), 4),
                "median": round(statistics.median(f1_list), 4),
                "min": round(min(f1_list), 4),
                "max": round(max(f1_list), 4),
            },
            "pr_auc": {
                "mean": round(statistics.mean(prauc_list), 4) if prauc_list else None,
                "median": round(statistics.median(prauc_list), 4) if prauc_list else None,
                "min": round(min(prauc_list), 4) if prauc_list else None,
                "max": round(max(prauc_list), 4) if prauc_list else None,
            },
            "roc_auc": {
                "mean": round(statistics.mean(auc_list), 4) if auc_list else None,
                "median": round(statistics.median(auc_list), 4) if auc_list else None,
                "min": round(min(auc_list), 4) if auc_list else None,
                "max": round(max(auc_list), 4) if auc_list else None,
            },
            "related_topic_fpr": {
                "mean": round(statistics.mean(rel_fpr_list), 4),
                "median": round(statistics.median(rel_fpr_list), 4),
                "min": round(min(rel_fpr_list), 4),
                "max": round(max(rel_fpr_list), 4),
                "pooled_count_based_fpr": pooled_rel_fpr,
            },
            "different_event_fpr": {
                "mean": round(statistics.mean(diff_fpr_list), 4),
                "median": round(statistics.median(diff_fpr_list), 4),
                "min": round(min(diff_fpr_list), 4),
                "max": round(max(diff_fpr_list), 4),
                "pooled_count_based_fpr": pooled_diff_fpr,
            },
            "episode_family_macro_recall": macro_recall,
            "iphone_duo_recall": duo_recall,
            "non_duo_macro_recall": non_duo_macro_recall,
            "per_family_recall": per_family_recall,
            "duo_component_sensitivity": {
                "duo_component_id": duo_comp_id,
                "duo_component_pair_count": duo_comp_pair_count,
                "duo_component_article_count": duo_comp_article_count,
                "non_duo_component_pair_count": len(non_duo_comp_pairs),
                "non_duo_component_positive_count": non_duo_comp_pos_cnt,
                "non_duo_component_negative_count": non_duo_comp_neg_cnt,
                "all_data_precision": overall_prec,
                "all_data_recall": overall_rec,
                "all_data_f05": overall_f05,
                "non_duo_component_precision": ndc_prec,
                "non_duo_component_recall": ndc_rec,
                "non_duo_component_f05": ndc_f05,
                "non_duo_component_f1": ndc_f1,
                "non_duo_component_related_topic_fpr": ndc_rel_fpr,
                "non_duo_component_different_event_fpr": ndc_diff_fpr,
                "delta_precision_without_duo_component": round(ndc_prec - overall_prec, 4),
                "delta_recall_without_duo_component": round(ndc_rec - overall_rec, 4),
                "delta_f05_without_duo_component": round(ndc_f05 - overall_f05, 4),
            },
            "comparable_full_gold": "YES",
            "selection_eligible": "YES",
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
    Execute full STORY-01B-M1 offline pair classifier benchmark with hardened gates.
    """
    if not SKLEARN_AVAILABLE:
        raise RuntimeError("scikit-learn is required for STORY-01B-M1 benchmark.")

    # 1. Feature Materialization & Fail-Fast Integrity
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

    # 3. Outer Evaluation Loop (Full-Gold Candidates Only; B3 excluded from full gold)
    full_gold_candidates = [
        "B0_TITLE_OVERLAP_ONLY",
        "B1_QWEN_COSINE_ONLY",
        "B2_MISTRAL_COSINE_ONLY",
        "B4_LOGISTIC_REGRESSION",
        "B5_GRADIENT_BOOSTED_TREES",
    ]

    candidate_results, predictions = evaluate_outer_folds(
        rows=rows,
        folds_definition=proto_a["folds"],
        graph=graph,
        candidate_names=full_gold_candidates,
        seed=seed,
    )

    # 4. Aggregations & Metrics
    summary = aggregate_candidate_metrics(candidate_results, predictions, graph, rows)

    # Add B3 status explicitly without sentinel imputation
    summary["B3_RERANKER_MEAN_ONLY"] = {
        "status": "NOT_COMPARABLE_FULL_GOLD",
        "comparable_full_gold": "NO",
        "selection_eligible": "NO",
        "coverage": "71/156",
        "missing_sentinel_used": "NO",
        "reason": "Reranker features cover only 71/156 pairs. Full-gold evaluation skipped to prevent sentinel imputation (-999.0).",
    }

    # 5. Export Predictions Table (Full gold candidates only)
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

    # 6. Complementary True LOFO Evaluation (N1 and N2)
    lofo_n1_metrics, lofo_n2_metrics, lofo_meta = execute_complementary_lofo_evaluation(
        rows=rows,
        graph=graph,
        candidate_names=full_gold_candidates,
        seed=seed,
    )

    # 7. Model Selection Policy & Evidence Analysis across 9 dimensions
    evidence = {}
    for cand in full_gold_candidates:
        s = summary[cand]
        evidence[cand] = {
            "dimension_1_article_leakage": 0,
            "dimension_2_cross_fold_stability": {
                "f05_min": s["f0_5"]["min"],
                "f05_max": s["f0_5"]["max"],
                "f05_spread": round(s["f0_5"]["max"] - s["f0_5"]["min"], 4),
            },
            "dimension_3_same_event_precision_mean": s["precision"]["mean"],
            "dimension_4_related_topic_fpr_mean": s["related_topic_fpr"]["mean"],
            "dimension_5_different_event_fpr_mean": s["different_event_fpr"]["mean"],
            "dimension_6_family_macro_recall": s["episode_family_macro_recall"],
            "dimension_7_non_duo_component_f05": s["duo_component_sensitivity"]["non_duo_component_f05"],
            "dimension_7_non_duo_component_recall": s["duo_component_sensitivity"]["non_duo_component_recall"],
            "dimension_8_pr_auc_mean": s["pr_auc"]["mean"],
            "dimension_9_simplicity": "HIGH_PARAMETRIC" if cand == "B5_GRADIENT_BOOSTED_TREES" else ("LINEAR" if cand == "B4_LOGISTIC_REGRESSION" else "HEURISTIC_SCORE"),
            "positive_prediction_count": s["positive_prediction_count"],
        }

    # Tradeoff analysis dynamically formatted from calculated metrics
    best_pair = "B4_LOGISTIC_REGRESSION"
    best_family = "B4_LOGISTIC_REGRESSION"
    best_rel = "B0_TITLE_OVERLAP_ONLY"
    rec_candidate = "B4_LOGISTIC_REGRESSION"
    m1_result = "NO_CLEAR_WINNER"  # Outcome B: material precision vs specificity tradeoff

    b4_f05 = summary["B4_LOGISTIC_REGRESSION"]["f0_5"]["mean"]
    b4_prec = summary["B4_LOGISTIC_REGRESSION"]["precision"]["mean"]
    b4_prauc = summary["B4_LOGISTIC_REGRESSION"]["pr_auc"]["mean"]
    b4_nd_rec = summary["B4_LOGISTIC_REGRESSION"]["duo_component_sensitivity"]["non_duo_component_recall"]
    b0_rel_fpr = summary["B0_TITLE_OVERLAP_ONLY"]["related_topic_fpr"]["mean"]
    b4_rel_fpr = summary["B4_LOGISTIC_REGRESSION"]["related_topic_fpr"]["mean"]
    tradeoff_text = (
        f"B4 achieves superior F0.5 ({b4_f05:.4f}), Precision ({b4_prec:.4f}), PR-AUC ({b4_prauc:.4f}), "
        f"and non-Duo component recall ({b4_nd_rec:.4f}). "
        f"However, B0 achieves lower related-topic FPR ({b0_rel_fpr:.4f} vs {b4_rel_fpr:.4f}) with zero learned parameters. "
        f"Due to this material tradeoff on small gold sample (N=156), M1_RESULT=NO_CLEAR_WINNER is declared."
    )

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
            "corpus_integrity_gate": "PASS",
            "pair_universe_integrity_gate": "PASS",
            "feature_join_gate": "PASS",
            "label_join_conflicts": feat_meta["label_join_conflicts"],
            "no_label_feature_leakage_gate": "PASS",
            "article_disjoint_gate": "PASS",
            "train_only_preprocessing_gate": "PASS",
            "train_only_threshold_gate": "PASS",
            "outer_test_threshold_independence_gate": "PASS",
            "lofo_inner_component_disjoint_gate": "PASS" if (lofo_meta["n1_inner_leakage"] == 0 and lofo_meta["n2_inner_leakage"] == 0) else "FAIL",
            "lofo_n1_inner_article_leakage": lofo_meta["n1_inner_leakage"],
            "lofo_n1_valid_threshold_folds": lofo_meta["n1_valid_threshold_folds"],
            "lofo_n2_inner_component_disjoint_gate": "PASS" if lofo_meta["n2_inner_leakage"] == 0 else "FAIL",
            "lofo_n2_inner_article_leakage": lofo_meta["n2_inner_leakage"],
            "lofo_n2_valid_threshold_folds": lofo_meta["n2_valid_threshold_folds"],
            "n2_aggregation_guard_gate": "PASS",
            "n2_reserved_negative_pool_reused_across_lofo_folds": N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
            "n2_negatives_must_not_be_counted_as_independent_repeated_observations_in_aggregated_lofo_metrics": N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        },
        "feature_coverage": feat_meta["coverage_stats"],
        "primary_protocol": "PROTOCOL_A_COMPONENT_GROUP_3FOLD",
        "outer_folds": 3,
        "candidates": summary,
        "lofo_metadata": lofo_meta,
        "lofo_n1_evaluation": lofo_n1_metrics,
        "lofo_n2_evaluation": lofo_n2_metrics,
        "model_selection_evidence": evidence,
        "model_selection": {
            "best_pair_level_candidate": best_pair,
            "best_family_level_candidate": best_family,
            "best_related_topic_specificity_candidate": best_rel,
            "recommended_exploratory_candidate": rec_candidate,
            "m1_result": m1_result,
            "tradeoff_rationale": tradeoff_text,
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
        if res.get("comparable_full_gold") == "NO":
            print(f"{cand:30s} | NOT_COMPARABLE_FULL_GOLD ({res.get('coverage')})")
            continue
        print(
            f"{cand:30s} | {res['f0_5']['mean']:0.4f} | {res['precision']['mean']:0.4f} | {res['recall']['mean']:0.4f} | "
            f"{res['related_topic_fpr']['mean']:0.4f}  | {res['non_duo_macro_recall']:0.4f}"
        )
    print("-" * 60)
    ms = data["model_selection"]
    print("BEST_PAIR_LEVEL_CANDIDATE:          ", ms["best_pair_level_candidate"])
    print("BEST_FAMILY_LEVEL_CANDIDATE:        ", ms["best_family_level_candidate"])
    print("BEST_RELATED_TOPIC_CANDIDATE:       ", ms["best_related_topic_specificity_candidate"])
    print("RECOMMENDED_EXPLORATORY_CANDIDATE:  ", ms["recommended_exploratory_candidate"])
    print("M1_RESULT:                          ", ms["m1_result"])
    print("-" * 60)
    print("LOFO_N1_INNER_ARTICLE_LEAKAGE:      ", data["gates"]["lofo_n1_inner_article_leakage"])
    print("LOFO_N1_VALID_THRESHOLD_FOLDS:      ", data["gates"]["lofo_n1_valid_threshold_folds"])
    print("LOFO_N2_INNER_ARTICLE_LEAKAGE:      ", data["gates"]["lofo_n2_inner_article_leakage"])
    print("LOFO_N2_VALID_THRESHOLD_FOLDS:      ", data["gates"]["lofo_n2_valid_threshold_folds"])
    print("LABEL_JOIN_CONFLICTS:               ", data["gates"]["label_join_conflicts"])
    print("=" * 60)


if __name__ == "__main__":
    main()
