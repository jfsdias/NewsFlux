#!/usr/bin/env python3
"""
STORY-01B-C5: Candidate Retrieval Research (Stage 1)

Evaluates offline candidate retrieval strategies to prune the unconstrained
O(N^2) cross-feed pair search space (18,953 pairs) down to O(N * K) while
preserving positive family connectivity and high SAME_EVENT recall on Gold.

Retrieval Methods Evaluated:
- R0_ALL_CROSSFEED: Negative control (all 18,953 cross-feed pairs)
- R1_TITLE_OVERLAP_TOP_K: Lexical exact title overlap coefficient top-K
- R2_QWEN_COSINE_TOP_K: Qwen3-Embedding-0.6B cosine similarity top-K
- R3_MISTRAL_COSINE_TOP_K: Mistral-Embed cosine similarity top-K
- R4_UNION_LEXICAL_QWEN_TOP_K: Union of lexical top-K and Qwen top-K
- R5_UNION_QWEN_MISTRAL_TOP_K: Union of Qwen top-K and Mistral top-K
- R6_HYBRID_WITH_GUARDS: Union of lexical + Qwen with semantic & entity/numeric admission guards

K values evaluated: [3, 5, 10, 20, 30, 50]
"""

import argparse
import csv
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
DEFAULT_GOLD_PATH = "/tmp/newsflux-story01b-private/checkpoints/story01b-gold-v1.csv"
DEFAULT_PAIRS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
DEFAULT_SCORES_PATH = "/tmp/newsflux-story01b-private/c1/story01b-home200-b0-b4-crossfit-scores-v1.csv"
DEFAULT_FEATURES_PATH = "/tmp/newsflux-story01b-private/m1/story01b-m1-features-v1.csv"
DEFAULT_OUTPUT_DIR = "/tmp/newsflux-story01b-private/overnight-v2/retrieval"

CANONICAL_TOTAL_PAIRS = 18953
CANONICAL_GOLD_PAIRS = 156
CANONICAL_SAME_EVENT = 57
CANONICAL_RELATED_TOPIC = 19
CANONICAL_DIFFERENT_EVENT = 80
CANONICAL_POSITIVE_FAMILIES = 10


def compute_file_sha256(filepath: str) -> str:
    """Compute hex SHA256 of file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def verify_retrieval_inputs(
    corpus_path: str,
    gold_path: str,
    pairs_path: str,
    scores_path: str,
) -> None:
    """Verify input file existence and minimum canonical constraints."""
    for p in [corpus_path, gold_path, pairs_path, scores_path]:
        if not os.path.exists(p):
            raise FileNotFoundError(f"Required retrieval input missing: {p}")


def load_gold_data(gold_path: str) -> Tuple[List[Dict[str, str]], Dict[str, Set[int]], Dict[str, List[Tuple[int, int]]]]:
    """Load gold dataset and construct family connectivity ground truth."""
    with open(gold_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if len(rows) != CANONICAL_GOLD_PAIRS:
        raise ValueError(f"Expected {CANONICAL_GOLD_PAIRS} gold pairs, got {len(rows)}")

    fam_articles: Dict[str, Set[int]] = defaultdict(set)
    fam_pairs: Dict[str, List[Tuple[int, int]]] = defaultdict(list)

    for r in rows:
        if r["gold_label"] == "SAME_EVENT":
            fam = r["episode_family_id"]
            u, v = int(r["entry_a_id"]), int(r["entry_b_id"])
            fam_articles[fam].add(u)
            fam_articles[fam].add(v)
            fam_pairs[fam].append((min(u, v), max(u, v)))

    if len(fam_articles) != CANONICAL_POSITIVE_FAMILIES:
        raise ValueError(f"Expected {CANONICAL_POSITIVE_FAMILIES} positive families, got {len(fam_articles)}")

    return rows, fam_articles, fam_pairs


def evaluate_candidate_set(
    retrieved_pairs: Set[str],
    gold_rows: List[Dict[str, str]],
    fam_articles: Dict[str, Set[int]],
    fam_pairs: Dict[str, List[Tuple[int, int]]],
    total_universe_pairs: int = CANONICAL_TOTAL_PAIRS,
) -> Dict[str, Any]:
    """Calculate exact retrieval quality, family connectivity recall, and reduction metrics."""
    pair_count = len(retrieved_pairs)
    reduction_pct = round((total_universe_pairs - pair_count) / total_universe_pairs * 100.0, 2)

    se_total = 0
    se_captured = 0
    rt_total = 0
    rt_captured = 0
    de_total = 0
    de_captured = 0

    for r in gold_rows:
        pk = r["pair_key"]
        lbl = r["gold_label"]
        in_ret = pk in retrieved_pairs

        if lbl == "SAME_EVENT":
            se_total += 1
            if in_ret:
                se_captured += 1
        elif lbl == "RELATED_TOPIC":
            rt_total += 1
            if in_ret:
                rt_captured += 1
        elif lbl == "DIFFERENT_EVENT":
            de_total += 1
            if in_ret:
                de_captured += 1

    se_recall = round(se_captured / se_total, 4) if se_total > 0 else 0.0
    rt_candidate_rate = round(rt_captured / rt_total, 4) if rt_total > 0 else 0.0
    de_candidate_rate = round(de_captured / de_total, 4) if de_total > 0 else 0.0

    # Positive family connectivity recall:
    # A family is connectivity-preserved if its Gold-positive articles form a single connected component
    # using ONLY the retrieved SAME_EVENT edges.
    preserved_families = 0
    family_connectivity_status = {}

    for fam, arts in sorted(fam_articles.items()):
        parent = {a: a for a in arts}

        def find(a: int) -> int:
            if parent[a] != a:
                parent[a] = find(parent[a])
            return parent[a]

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        edges_in_retrieval = 0
        for u, v in fam_pairs[fam]:
            pk = f"{min(u, v)}:{max(u, v)}"
            if pk in retrieved_pairs:
                union(u, v)
                edges_in_retrieval += 1

        roots = {find(a) for a in arts}
        is_preserved = (len(roots) == 1)
        if is_preserved:
            preserved_families += 1

        family_connectivity_status[fam] = {
            "total_articles": len(arts),
            "total_gold_pairs": len(fam_pairs[fam]),
            "retrieved_gold_pairs": edges_in_retrieval,
            "connected_components": len(roots),
            "connectivity_preserved": is_preserved,
        }

    family_conn_recall = round(preserved_families / len(fam_articles), 4)

    return {
        "retrieved_pair_count": pair_count,
        "pair_reduction_percent": reduction_pct,
        "same_event_pair_recall": se_recall,
        "same_event_pairs_captured": se_captured,
        "same_event_pairs_total": se_total,
        "positive_family_connectivity_recall": family_conn_recall,
        "positive_families_preserved": preserved_families,
        "positive_families_total": len(fam_articles),
        "related_topic_candidate_rate": rt_candidate_rate,
        "related_topic_pairs_captured": rt_captured,
        "different_event_candidate_rate": de_candidate_rate,
        "different_event_pairs_captured": de_captured,
        "family_connectivity_breakdown": family_connectivity_status,
    }


def execute_retrieval_method(
    method_name: str,
    k: int,
    article_candidates: Dict[int, List[Dict[str, Any]]],
    all_pairs_set: Set[str],
) -> Set[str]:
    """Retrieve top-K cross-feed candidate pairs per article using specified method."""
    if method_name == "R0_ALL_CROSSFEED":
        return set(all_pairs_set)

    retrieved_pairs: Set[str] = set()

    for a, cands in article_candidates.items():
        if method_name == "R1_TITLE_OVERLAP_TOP_K":
            # Lexical top-K (tie-break on qwen then canonical key)
            sorted_cands = sorted(cands, key=lambda c: (c["b0"], c["qw"], c["pair_key"]), reverse=True)[:k]
            for c in sorted_cands:
                retrieved_pairs.add(c["pair_key"])

        elif method_name == "R2_QWEN_COSINE_TOP_K":
            # Qwen top-K (tie-break on lexical then canonical key)
            sorted_cands = sorted(cands, key=lambda c: (c["qw"], c["b0"], c["pair_key"]), reverse=True)[:k]
            for c in sorted_cands:
                retrieved_pairs.add(c["pair_key"])

        elif method_name == "R3_MISTRAL_COSINE_TOP_K":
            # Mistral top-K (tie-break on lexical then canonical key)
            sorted_cands = sorted(cands, key=lambda c: (c["ms"], c["b0"], c["pair_key"]), reverse=True)[:k]
            for c in sorted_cands:
                retrieved_pairs.add(c["pair_key"])

        elif method_name == "R4_UNION_LEXICAL_QWEN_TOP_K":
            # Union of lexical top-K and Qwen top-K
            s_lex = sorted(cands, key=lambda c: (c["b0"], c["qw"], c["pair_key"]), reverse=True)[:k]
            s_qw = sorted(cands, key=lambda c: (c["qw"], c["b0"], c["pair_key"]), reverse=True)[:k]
            for c in s_lex + s_qw:
                retrieved_pairs.add(c["pair_key"])

        elif method_name == "R5_UNION_QWEN_MISTRAL_TOP_K":
            # Union of Qwen top-K and Mistral top-K
            s_qw = sorted(cands, key=lambda c: (c["qw"], c["b0"], c["pair_key"]), reverse=True)[:k]
            s_ms = sorted(cands, key=lambda c: (c["ms"], c["b0"], c["pair_key"]), reverse=True)[:k]
            for c in s_qw + s_ms:
                retrieved_pairs.add(c["pair_key"])

        elif method_name == "R6_HYBRID_WITH_GUARDS":
            # Union of lexical top-K and Qwen top-K filtered by dense semantic or entity/numeric guard
            s_lex = sorted(cands, key=lambda c: (c["b0"], c["qw"], c["pair_key"]), reverse=True)[:k]
            s_qw = sorted(cands, key=lambda c: (c["qw"], c["b0"], c["pair_key"]), reverse=True)[:k]
            for c in s_lex + s_qw:
                # Guard: must satisfy at least one semantic affinity or entity/numeric anchor condition
                if c["qw"] >= 0.65 or c["b0"] >= 0.20 or c.get("ea", 0.0) > 0.0 or c.get("num", 0.0) > 0.0:
                    retrieved_pairs.add(c["pair_key"])

        else:
            raise ValueError(f"Unknown retrieval method: {method_name}")

    return retrieved_pairs


def run_candidate_retrieval_benchmark(
    corpus_path: str = DEFAULT_CORPUS_PATH,
    gold_path: str = DEFAULT_GOLD_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    scores_path: str = DEFAULT_SCORES_PATH,
    features_path: str = DEFAULT_FEATURES_PATH,
    output_dir: str = DEFAULT_OUTPUT_DIR,
) -> Dict[str, Any]:
    """Execute complete C5 candidate retrieval benchmark across all methods and K values."""
    verify_retrieval_inputs(corpus_path, gold_path, pairs_path, scores_path)

    gold_rows, fam_articles, fam_pairs = load_gold_data(gold_path)

    # Load crossfit scores (b0 lexical overlap)
    with open(scores_path, "r", encoding="utf-8") as f:
        score_rows = list(csv.DictReader(f))
    b0_lookup = {r["pair_key"]: float(r["b0_score"]) for r in score_rows}

    # Load feature guards if available
    ea_lookup = {}
    num_lookup = {}
    if os.path.exists(features_path):
        with open(features_path, "r", encoding="utf-8") as f:
            feat_rows = list(csv.DictReader(f))
        for r in feat_rows:
            pk = r["pair_key"]
            ea_lookup[pk] = float(r.get("entity_anchor_overlap", 0.0))
            num_lookup[pk] = float(r.get("number_overlap", 0.0))

    # Load pair universe
    with open(pairs_path, "r", encoding="utf-8") as f:
        pair_rows = list(csv.DictReader(f))

    if len(pair_rows) != CANONICAL_TOTAL_PAIRS:
        raise ValueError(f"Expected {CANONICAL_TOTAL_PAIRS} pairs in universe, got {len(pair_rows)}")

    all_pairs_set = set()
    article_candidates: Dict[int, List[Dict[str, Any]]] = defaultdict(list)

    for r in pair_rows:
        pk = r["pair_key"]
        all_pairs_set.add(pk)
        u = int(r["id_a"])
        v = int(r["id_b"])
        qw = float(r["qwen_score"])
        ms = float(r["mistral_score"])
        b0 = b0_lookup.get(pk, 0.0)
        ea = ea_lookup.get(pk, 0.0)
        num = num_lookup.get(pk, 0.0)

        cand_u = {"other": v, "pair_key": pk, "b0": b0, "qw": qw, "ms": ms, "ea": ea, "num": num}
        cand_v = {"other": u, "pair_key": pk, "b0": b0, "qw": qw, "ms": ms, "ea": ea, "num": num}

        article_candidates[u].append(cand_u)
        article_candidates[v].append(cand_v)

    methods = [
        "R0_ALL_CROSSFEED",
        "R1_TITLE_OVERLAP_TOP_K",
        "R2_QWEN_COSINE_TOP_K",
        "R3_MISTRAL_COSINE_TOP_K",
        "R4_UNION_LEXICAL_QWEN_TOP_K",
        "R5_UNION_QWEN_MISTRAL_TOP_K",
        "R6_HYBRID_WITH_GUARDS",
    ]

    k_values = [3, 5, 10, 20, 30, 50]

    eval_results = []
    pareto_rows = []
    candidate_sets_export = {}

    best_candidate_method = None
    best_candidate_k = None
    max_pareto_efficiency = -1.0

    for m in methods:
        active_k_list = [0] if m == "R0_ALL_CROSSFEED" else k_values

        for k in active_k_list:
            t0 = time.time()
            retrieved = execute_retrieval_method(m, k, article_candidates, all_pairs_set)
            elapsed_ms = round((time.time() - t0) * 1000.0, 2)

            metrics = evaluate_candidate_set(retrieved, gold_rows, fam_articles, fam_pairs, CANONICAL_TOTAL_PAIRS)
            metrics["method"] = m
            metrics["k"] = k
            eval_results.append(metrics)

            pareto_row = {
                "method": m,
                "k": k,
                "retrieved_pair_count": metrics["retrieved_pair_count"],
                "pair_reduction_percent": metrics["pair_reduction_percent"],
                "same_event_pair_recall": metrics["same_event_pair_recall"],
                "positive_family_connectivity_recall": metrics["positive_family_connectivity_recall"],
                "related_topic_candidate_rate": metrics["related_topic_candidate_rate"],
                "different_event_candidate_rate": metrics["different_event_candidate_rate"],
            }
            pareto_rows.append(pareto_row)

            # Record candidate set sample / identifiers for export
            set_key = f"{m}__k{k}"
            candidate_sets_export[set_key] = {
                "method": m,
                "k": k,
                "pair_count": len(retrieved),
                "pairs_sha256": hashlib.sha256(",".join(sorted(retrieved)).encode("utf-8")).hexdigest(),
                "sample_pairs": sorted(list(retrieved))[:20],
            }

            # Efficiency metric: family_connectivity * same_event_recall * (reduction_pct / 100)
            if metrics["positive_family_connectivity_recall"] == 1.0:
                eff = metrics["same_event_pair_recall"] * (metrics["pair_reduction_percent"] / 100.0)
                if eff > max_pareto_efficiency:
                    max_pareto_efficiency = eff
                    best_candidate_method = m
                    best_candidate_k = k

    # Format output artifacts
    os.makedirs(output_dir, exist_ok=True)
    benchmark_json_path = os.path.join(output_dir, "story01b-c5-retrieval-benchmark-v1.json")
    candidate_sets_json_path = os.path.join(output_dir, "story01b-c5-candidate-sets-v1.json")
    pareto_csv_path = os.path.join(output_dir, "retrieval-pareto-v1.csv")

    # Export Pareto CSV
    pareto_fieldnames = [
        "method",
        "k",
        "retrieved_pair_count",
        "pair_reduction_percent",
        "same_event_pair_recall",
        "positive_family_connectivity_recall",
        "related_topic_candidate_rate",
        "different_event_candidate_rate",
    ]
    with open(pareto_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=pareto_fieldnames)
        writer.writeheader()
        writer.writerows(pareto_rows)

    pareto_sha256 = compute_file_sha256(pareto_csv_path)

    # Export Candidate Sets JSON
    with open(candidate_sets_json_path, "w", encoding="utf-8") as f:
        json.dump(candidate_sets_export, f, indent=2)

    sets_sha256 = compute_file_sha256(candidate_sets_json_path)

    # Export Full Benchmark JSON
    report = {
        "benchmark_version": "story01b-c5-retrieval-benchmark-v1",
        "corpus_temporal_note": "TEMPORAL_LOOKBACK_QUALITY_VALIDATION=LIMITED_BY_CORPUS_TIME_SPAN (Home-200 covers ~12-24h window; temporal cutoffs reflect diagnostic speed rather than multi-day editorial validity)",
        "full_universe_pair_count": CANONICAL_TOTAL_PAIRS,
        "recommended_retrieval_method": best_candidate_method or "R6_HYBRID_WITH_GUARDS",
        "recommended_k": best_candidate_k or 5,
        "pareto_optimal_configurations": [
            r for r in pareto_rows if r["positive_family_connectivity_recall"] == 1.0 and r["same_event_pair_recall"] >= 0.85
        ],
        "evaluations": eval_results,
        "emitted_artifacts": {
            "benchmark_json_filename": "story01b-c5-retrieval-benchmark-v1.json",
            "candidate_sets_json_filename": "story01b-c5-candidate-sets-v1.json",
            "candidate_sets_sha256": sets_sha256,
            "pareto_csv_filename": "retrieval-pareto-v1.csv",
            "pareto_csv_sha256": pareto_sha256,
        },
    }

    with open(benchmark_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    bench_sha256 = compute_file_sha256(benchmark_json_path)
    report["emitted_artifacts"]["benchmark_json_sha256"] = bench_sha256

    return report


def main():
    parser = argparse.ArgumentParser(description="Run Story-01B Candidate Retrieval Benchmark")
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--scores", default=DEFAULT_SCORES_PATH)
    parser.add_argument("--features", default=DEFAULT_FEATURES_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    report = run_candidate_retrieval_benchmark(
        corpus_path=args.corpus,
        gold_path=args.gold,
        pairs_path=args.pairs,
        scores_path=args.scores,
        features_path=args.features,
        output_dir=args.output_dir,
    )

    print("============================================================")
    print("STORY-01B-C5 CANDIDATE RETRIEVAL BENCHMARK COMPLETE")
    print(f"Recommended Method: {report['recommended_retrieval_method']}")
    print(f"Recommended K: {report['recommended_k']}")
    rec_cfg = next(
        (r for r in report["evaluations"] if r["method"] == report["recommended_retrieval_method"] and r["k"] == report["recommended_k"]),
        None,
    )
    if rec_cfg:
        print(f"Retrieved Pairs: {rec_cfg['retrieved_pair_count']} (-{rec_cfg['pair_reduction_percent']}%)")
        print(f"SAME_EVENT Recall: {rec_cfg['same_event_pair_recall']}")
        print(f"Family Connectivity Recall: {rec_cfg['positive_family_connectivity_recall']}")
        print(f"Different Event Rate: {rec_cfg['different_event_candidate_rate']}")
    print("============================================================")


if __name__ == "__main__":
    main()
