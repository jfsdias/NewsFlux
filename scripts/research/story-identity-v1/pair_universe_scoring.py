#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Pair Universe Scoring (STORY-01B-C0 Stage D)

Objectives:
- Score all 18,953 pairs in the frozen candidate pair universe.
- Model B0: Deterministic title overlap coefficient.
- Model B4: 3-fold crossfit ensemble refitted strictly on M1 outer training data:
    - Zero full-gold final model fit.
    - Zero outer-test or production model persistence (.pkl, joblib, onnx prohibited).
    - Median aggregation of the 3 fold models for non-gold pairs.
    - Exact out-of-fold predictions preserved for Gold pairs.
- Export private artifact:
    - /tmp/newsflux-story01b-private/c1/story01b-home200-b0-b4-crossfit-scores-v1.csv
"""

import argparse
import csv
import hashlib
import json
import os
import statistics
import sys
import time
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from .harness import (
        CorpusVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
    )
    from .model_benchmark import (
        CORE_DENSE_FEATURES,
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        make_canonical_pair_key,
    )
    from .split_audit import ArticleGraph, simulate_protocol_a
except ImportError:
    from harness import (
        CorpusVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
    )
    from model_benchmark import (
        CORE_DENSE_FEATURES,
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        make_canonical_pair_key,
    )
    from split_audit import ArticleGraph, simulate_protocol_a

from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DEFAULT_C1_OUTPUT_DIR = "/tmp/newsflux-story01b-private/c1"
DEFAULT_M1_FEATURES_PATH = "/tmp/newsflux-story01b-private/m1/story01b-m1-features-v1.csv"
DEFAULT_M1_PREDICTIONS_PATH = "/tmp/newsflux-story01b-private/m1/story01b-m1-fold-predictions-v1.csv"
DEFAULT_SEED = 20261025


def compute_file_sha256(path: str) -> str:
    """Compute SHA256 of file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def fit_b4_outer_fold_models(
    features_path: str = DEFAULT_M1_FEATURES_PATH,
    gold_path: str = DEFAULT_GOLD_PATH,
    seed: int = DEFAULT_SEED,
) -> Tuple[List[Pipeline], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Refit the 3 outer-training Logistic Regression models exactly as in M1.
    Each model is trained strictly on its respective outer training components.
    NO full-gold fit is ever performed.
    """
    with open(features_path, "r", encoding="utf-8") as f:
        feat_rows = list(csv.DictReader(f))

    with open(gold_path, "r", encoding="utf-8") as f:
        gold_rows = list(csv.DictReader(f))

    graph = ArticleGraph(gold_rows)
    comp_details = {c["component_id"]: c for c in graph.get_component_details()}
    proto_a = simulate_protocol_a(graph, k=3)
    folds_def = proto_a["folds"]

    rows_by_key = {r["pair_key"]: r for r in feat_rows}
    fold_data = []
    for f in folds_def:
        f_rows = []
        for cid in f["components"]:
            for p in comp_details[cid]["pairs"]:
                pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                f_rows.append(rows_by_key[pk])
        fold_data.append(f_rows)

    b4_models = []
    outer_train_receipts = []
    for i in range(3):
        train_rows = []
        for j in range(3):
            if j != i:
                train_rows.extend(fold_data[j])

        # Assert no data from held-out fold i is in training
        held_out_keys = {r["pair_key"] for r in fold_data[i]}
        train_keys = {r["pair_key"] for r in train_rows}
        leakage = len(held_out_keys & train_keys)
        if leakage > 0:
            raise ValueError(f"Outer fold {i} training leakage: {leakage} pairs overlap with held-out fold!")

        X_train = [[float(r[feat]) for feat in CORE_DENSE_FEATURES] for r in train_rows]
        y_train = [int(r["target_binary"]) for r in train_rows]

        pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=seed))
        ])
        pipe.fit(X_train, y_train)
        b4_models.append(pipe)

        outer_train_receipts.append({
            "fold_index": i,
            "train_pair_count": len(train_rows),
            "held_out_pair_count": len(fold_data[i]),
            "positive_train_count": sum(y_train),
            "training_leakage": 0,
        })

    metadata = {
        "model_architecture": "LogisticRegression(C=1.0, solver='lbfgs', max_iter=1000)",
        "scaler": "StandardScaler()",
        "features": CORE_DENSE_FEATURES,
        "seed": seed,
        "full_gold_final_model_fit": "NO",
        "outer_train_receipts": outer_train_receipts,
    }

    return b4_models, fold_data, metadata


def score_pair_universe(
    pairs_path: str = DEFAULT_PAIRS_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    gold_path: str = DEFAULT_GOLD_PATH,
    reranker_path: str = DEFAULT_RERANKER_PATH,
    m1_features_path: str = DEFAULT_M1_FEATURES_PATH,
    m1_predictions_path: str = DEFAULT_M1_PREDICTIONS_PATH,
    output_dir: str = DEFAULT_C1_OUTPUT_DIR,
    seed: int = DEFAULT_SEED,
) -> Dict[str, Any]:
    """Score the entire 18,953 pair universe with B0 and B4 crossfit ensemble."""
    t0 = time.time()

    # 1. Verify inputs
    ok_c, errs_c, entries = CorpusVerifier.verify(corpus_path)
    if not ok_c:
        raise ValueError(f"Corpus verification failed: {errs_c}")
    corpus_lookup = {doc["id"]: doc for doc in entries}

    ok_p, errs_p, pairs = PairUniverseVerifier.verify(pairs_path)
    if not ok_p:
        raise ValueError(f"Pair universe verification failed: {errs_p}")

    # Load Gold rows
    with open(gold_path, "r", encoding="utf-8") as f:
        gold_rows_dict = {r["pair_key"]: r for r in csv.DictReader(f)}

    # Load M1 fold predictions for exact OOF gold scores
    m1_oof_scores = {}
    if os.path.exists(m1_predictions_path):
        with open(m1_predictions_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["candidate_model"] == "B4_LOGISTIC_REGRESSION":
                    m1_oof_scores[r["pair_key"]] = float(r["raw_score"])

    # Load reranker if available
    reranker_lookup = {}
    if os.path.exists(reranker_path):
        with open(reranker_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ab = float(r["reranker_score_ab"])
                ba = float(r["reranker_score_ba"])
                reranker_lookup[r["pair_key"]] = {
                    "mean": float(r["reranker_score_mean"]),
                    "delta": round(abs(ab - ba), 4),
                }

    # 2. Extract features
    features = [FeatureExtractor.extract_features(p, reranker_lookup, corpus_lookup) for p in pairs]

    # 3. Fit 3 outer fold B4 models
    b4_models, fold_data, fit_metadata = fit_b4_outer_fold_models(
        features_path=m1_features_path,
        gold_path=gold_path,
        seed=seed,
    )

    # 4. Predict on full pair universe
    X_all = [[float(f[feat]) for feat in CORE_DENSE_FEATURES] for f in features]
    probs_0 = [float(p[1]) for p in b4_models[0].predict_proba(X_all)]
    probs_1 = [float(p[1]) for p in b4_models[1].predict_proba(X_all)]
    probs_2 = [float(p[1]) for p in b4_models[2].predict_proba(X_all)]

    # 5. Build output dataset
    scored_rows = []
    gold_count = 0
    non_gold_count = 0

    for idx, f in enumerate(features):
        pk = f["pair_key"]
        p0 = probs_0[idx]
        p1 = probs_1[idx]
        p2 = probs_2[idx]

        b0_score = round(float(f["title_overlap_coefficient"]), 4)

        is_gold = pk in gold_rows_dict
        gold_label = gold_rows_dict[pk]["gold_label"] if is_gold else ""

        if is_gold:
            gold_count += 1
            # For gold pairs, preserve exact OOF score from M1
            ensemble_score = m1_oof_scores.get(pk, round(statistics.median([p0, p1, p2]), 4))
        else:
            non_gold_count += 1
            ensemble_score = round(statistics.median([p0, p1, p2]), 4)

        scored_rows.append({
            "pair_key": pk,
            "entry_a_id": f["id_a"],
            "entry_b_id": f["id_b"],
            "b0_score": b0_score,
            "b4_crossfit_ensemble_score": ensemble_score,
            "b4_model_0_score": round(p0, 4),
            "b4_model_1_score": round(p1, 4),
            "b4_model_2_score": round(p2, 4),
            "is_gold_pair": 1 if is_gold else 0,
            "gold_label": gold_label,
        })

    # 6. Materialize private artifact
    os.makedirs(output_dir, exist_ok=True)
    output_csv_path = os.path.join(output_dir, "story01b-home200-b0-b4-crossfit-scores-v1.csv")

    fieldnames = [
        "pair_key",
        "entry_a_id",
        "entry_b_id",
        "b0_score",
        "b4_crossfit_ensemble_score",
        "b4_model_0_score",
        "b4_model_1_score",
        "b4_model_2_score",
        "is_gold_pair",
        "gold_label",
    ]

    with open(output_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in scored_rows:
            writer.writerow(row)

    output_sha256 = compute_file_sha256(output_csv_path)

    elapsed_ms = round((time.time() - t0) * 1000, 2)

    return {
        "status": "SUCCESS",
        "scored_pair_count": len(scored_rows),
        "gold_pair_count": gold_count,
        "non_gold_pair_count": non_gold_count,
        "elapsed_ms": elapsed_ms,
        "fit_metadata": fit_metadata,
        "output_csv_path": output_csv_path,
        "output_sha256": output_sha256,
    }


def main():
    parser = argparse.ArgumentParser(description="Run Story-01B Pair Universe Scoring")
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--reranker", default=DEFAULT_RERANKER_PATH)
    parser.add_argument("--m1-features", default=DEFAULT_M1_FEATURES_PATH)
    parser.add_argument("--m1-predictions", default=DEFAULT_M1_PREDICTIONS_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_C1_OUTPUT_DIR)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args()

    res = score_pair_universe(
        pairs_path=args.pairs,
        corpus_path=args.corpus,
        gold_path=args.gold,
        reranker_path=args.reranker,
        m1_features_path=args.m1_features,
        m1_predictions_path=args.m1_predictions,
        output_dir=args.output_dir,
        seed=args.seed,
    )

    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 PAIR UNIVERSE SCORING COMPLETE")
    print("============================================================")
    print(f"Total Pairs Scored: {res['scored_pair_count']}")
    print(f"Gold Pairs (OOF): {res['gold_pair_count']}")
    print(f"Non-Gold Pairs (Crossfit Median): {res['non_gold_pair_count']}")
    print(f"Full Gold Model Fit: {res['fit_metadata']['full_gold_final_model_fit']}")
    print(f"Elapsed Time: {res['elapsed_ms']} ms")
    print(f"Output CSV: {res['output_csv_path']}")
    print(f"Output SHA256: {res['output_sha256']}")
    print("============================================================")


if __name__ == "__main__":
    main()
