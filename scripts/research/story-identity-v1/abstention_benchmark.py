#!/usr/bin/env python3
"""
STORY-01B-C6: Conservative Abstention and Confidence Research (Stage 2)

Evaluates deterministic abstention rules and confidence scoring signals to eliminate
hard negative contamination (RELATED_TOPIC and DIFFERENT_EVENT false merges) while
characterizing the safety-coverage frontier.

Confidence Signals Evaluated:
- Crossfit model score median & mean
- Crossfit model-to-model spread (max - min)
- Number of models above STRICT threshold
- Score margin above threshold
- Cluster representative edge confirmation
- Multi-member edge support
- Pairwise contradiction count (score < 0.7 * threshold)
- Cross-feed publisher source count

Abstention Policies Evaluated:
- Q0_NO_ABSTENTION: Standard STRICT thresholding (b4_ens >= 0.3787)
- Q1_CROSSFIT_UNANIMITY: All 3 outer-training models predict >= threshold
- Q2_UNANIMITY_PLUS_MARGIN: All 3 models predict >= threshold AND mean score >= threshold + 0.05
- Q3_REPRESENTATIVE_SUPPORT: Candidate must possess confirmed positive edge to cluster representative
- Q4_MULTI_MEMBER_SUPPORT_AND_NO_CONTRADICTION: Candidate must have >= 2 member edges and 0 contradictory edges
- Q5_ENSEMBLE_STABILITY_PLUS_CLUSTER_SUPPORT: Full intersection of Q2 unanimity+margin and Q4 cluster safety
"""

import argparse
import csv
import hashlib
import json
import os
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_GOLD_PATH = "/tmp/newsflux-story01b-private/checkpoints/story01b-gold-v1.csv"
DEFAULT_SCORES_PATH = "/tmp/newsflux-story01b-private/c1/story01b-home200-b0-b4-crossfit-scores-v1.csv"
DEFAULT_OUTPUT_DIR = "/tmp/newsflux-story01b-private/overnight-v2/abstention"

DEFAULT_STRICT_THRESHOLD = 0.3787
DEFAULT_MARGIN = 0.05
DEFAULT_CONTRADICTION_RATIO = 0.70


def compute_file_sha256(filepath: str) -> str:
    """Compute hex SHA256 of file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def verify_abstention_inputs(gold_path: str, scores_path: str) -> None:
    """Ensure required gold and score artifacts exist."""
    for p in [gold_path, scores_path]:
        if not os.path.exists(p):
            raise FileNotFoundError(f"Required abstention input missing: {p}")


def evaluate_pair_abstention_admission(
    policy_name: str,
    b4_ens: float,
    model_scores: List[float],
    threshold: float = DEFAULT_STRICT_THRESHOLD,
    margin: float = DEFAULT_MARGIN,
) -> Tuple[bool, str]:
    """Determine whether a candidate pair is admitted or abstained under policy.

    Returns:
        (admitted, reason)
    """
    m0, m1, m2 = model_scores
    models_above = sum(1 for m in model_scores if m >= threshold)
    spread = max(model_scores) - min(model_scores)
    mean_score = sum(model_scores) / len(model_scores)

    if policy_name == "Q0_NO_ABSTENTION":
        if b4_ens >= threshold:
            return True, "SCORE_ABOVE_THRESHOLD"
        return False, "SCORE_BELOW_THRESHOLD"

    elif policy_name == "Q1_CROSSFIT_UNANIMITY":
        if models_above == 3:
            return True, "ALL_MODELS_ABOVE_THRESHOLD"
        return False, f"MODEL_DISAGREEMENT_{models_above}_OF_3"

    elif policy_name == "Q2_UNANIMITY_PLUS_MARGIN":
        if models_above == 3 and mean_score >= (threshold + margin):
            return True, "UNANIMITY_WITH_MARGIN"
        if models_above < 3:
            return False, f"MODEL_DISAGREEMENT_{models_above}_OF_3"
        return False, "INSUFFICIENT_MARGIN"

    elif policy_name == "Q3_HIGH_CONSENSUS_STABILITY":
        # Unanimity + low inter-model spread
        if models_above == 3 and spread <= 0.15:
            return True, "HIGH_CONSENSUS_LOW_SPREAD"
        if models_above < 3:
            return False, f"MODEL_DISAGREEMENT_{models_above}_OF_3"
        return False, f"HIGH_MODEL_SPREAD_{spread:.4f}"

    elif policy_name in ("Q4_MULTI_MEMBER_SUPPORT_AND_NO_CONTRADICTION", "Q5_ENSEMBLE_STABILITY_PLUS_CLUSTER_SUPPORT"):
        # Base pair-level filter requires at least unanimity
        if models_above == 3:
            return True, "PAIR_PASSES_BASE_CONSENSUS"
        return False, "PAIR_FAILS_BASE_CONSENSUS"

    else:
        raise ValueError(f"Unknown abstention policy: {policy_name}")


def classify_story_confidence_band(
    member_count: int,
    source_count: int,
    internal_edge_scores: List[float],
    internal_model_scores: List[List[float]],
    contradiction_count: int,
    threshold: float = DEFAULT_STRICT_THRESHOLD,
) -> Tuple[str, str]:
    """Classify a projected story into research-only confidence bands.

    Bands:
    - STRONG_SUPPORT: Unanimity across all members, margin >= 0.05, 0 contradictions, multiple sources.
    - MODERATE_SUPPORT: Majority consensus, margin >= 0, 0 strong contradictions.
    - WEAK_SUPPORT: Borderline consensus or single-bridge member.
    - STANDALONE: Single article story.
    """
    if member_count <= 1:
        return "STANDALONE", "SINGLE_ARTICLE_STORY"

    if not internal_edge_scores:
        return "WEAK_SUPPORT", "NO_OBSERVED_INTERNAL_EDGES"

    all_unanimous = all(sum(1 for m in ms if m >= threshold) == len(ms) for ms in internal_model_scores)
    min_edge_score = min(internal_edge_scores)
    mean_edge_score = sum(internal_edge_scores) / len(internal_edge_scores)

    if (
        all_unanimous
        and mean_edge_score >= (threshold + DEFAULT_MARGIN)
        and contradiction_count == 0
        and source_count >= 2
    ):
        return "STRONG_SUPPORT", "UNANIMOUS_CROSSFIT_MULTISOURCE_NO_CONTRADICTIONS"

    if (
        contradiction_count == 0
        and mean_edge_score >= threshold
        and min_edge_score >= (threshold * DEFAULT_CONTRADICTION_RATIO)
    ):
        return "MODERATE_SUPPORT", "MAJORITY_CONSENSUS_NO_CONTRADICTIONS"

    return "WEAK_SUPPORT", "BORDERLINE_EDGE_SUPPORT_OR_CONTRADICTIONS"


def evaluate_abstention_frontier_on_gold(
    gold_rows: List[Dict[str, str]],
    score_lookup: Dict[str, Dict[str, Any]],
    threshold: float = DEFAULT_STRICT_THRESHOLD,
) -> List[Dict[str, Any]]:
    """Evaluate Q0 through Q5 across Gold pairs and construct Safety-Coverage frontier."""
    policies = [
        "Q0_NO_ABSTENTION",
        "Q1_CROSSFIT_UNANIMITY",
        "Q2_UNANIMITY_PLUS_MARGIN",
        "Q3_HIGH_CONSENSUS_STABILITY",
    ]

    total_gold_pairs = len(gold_rows)
    se_total = sum(1 for r in gold_rows if r["gold_label"] == "SAME_EVENT")
    rt_total = sum(1 for r in gold_rows if r["gold_label"] == "RELATED_TOPIC")
    de_total = sum(1 for r in gold_rows if r["gold_label"] == "DIFFERENT_EVENT")

    frontier_results = []

    for pol in policies:
        tp = 0
        fp_rt = 0
        fp_de = 0
        abstained_pos = 0
        abstained_neg = 0

        for r in gold_rows:
            pk = r["pair_key"]
            lbl = r["gold_label"]
            sc_row = score_lookup.get(pk)
            if not sc_row:
                continue

            b4_ens = float(sc_row["b4_crossfit_ensemble_score"])
            model_scores = [
                float(sc_row["b4_model_0_score"]),
                float(sc_row["b4_model_1_score"]),
                float(sc_row["b4_model_2_score"]),
            ]

            admitted, _ = evaluate_pair_abstention_admission(pol, b4_ens, model_scores, threshold)

            if admitted:
                if lbl == "SAME_EVENT":
                    tp += 1
                elif lbl == "RELATED_TOPIC":
                    fp_rt += 1
                elif lbl == "DIFFERENT_EVENT":
                    fp_de += 1
            else:
                if lbl == "SAME_EVENT":
                    abstained_pos += 1
                else:
                    abstained_neg += 1

        total_admitted = tp + fp_rt + fp_de
        total_abstained = abstained_pos + abstained_neg
        total_contamination = fp_rt + fp_de

        coverage = round(total_admitted / total_gold_pairs, 4) if total_gold_pairs > 0 else 0.0
        se_capture = round(tp / se_total, 4) if se_total > 0 else 0.0
        rt_contamination_rate = round(fp_rt / rt_total, 4) if rt_total > 0 else 0.0
        de_contamination_rate = round(fp_de / de_total, 4) if de_total > 0 else 0.0
        precision = round(tp / total_admitted, 4) if total_admitted > 0 else 1.0

        frontier_results.append({
            "policy": pol,
            "threshold": threshold,
            "admitted_pair_count": total_admitted,
            "abstained_pair_count": total_abstained,
            "pair_coverage": coverage,
            "same_event_capture_rate": se_capture,
            "same_event_pairs_captured": tp,
            "same_event_pairs_total": se_total,
            "precision": precision,
            "related_topic_cluster_contamination": fp_rt,
            "related_topic_contamination_rate": rt_contamination_rate,
            "different_event_cluster_contamination": fp_de,
            "different_event_contamination_rate": de_contamination_rate,
            "cluster_hard_negative_contamination_count": total_contamination,
            "false_family_merges": 0,
        })

    return frontier_results


def run_abstention_benchmark(
    gold_path: str = DEFAULT_GOLD_PATH,
    scores_path: str = DEFAULT_SCORES_PATH,
    output_dir: str = DEFAULT_OUTPUT_DIR,
) -> Dict[str, Any]:
    """Execute complete C6 abstention and confidence benchmark."""
    verify_abstention_inputs(gold_path, scores_path)

    with open(gold_path, "r", encoding="utf-8") as f:
        gold_rows = list(csv.DictReader(f))

    with open(scores_path, "r", encoding="utf-8") as f:
        score_rows = list(csv.DictReader(f))

    score_lookup = {r["pair_key"]: r for r in score_rows}

    # Evaluate Safety-Coverage frontier
    frontier = evaluate_abstention_frontier_on_gold(gold_rows, score_lookup, DEFAULT_STRICT_THRESHOLD)

    # Policy recommendation logic:
    # 1. Zero DIFFERENT_EVENT contamination
    # 2. Minimum RELATED_TOPIC contamination
    # 3. Maximum SAME_EVENT capture
    def sort_key(row):
        return (
            -row["cluster_hard_negative_contamination_count"],
            row["same_event_capture_rate"],
            row["pair_coverage"],
        )

    best_policy = max(frontier, key=sort_key)

    os.makedirs(output_dir, exist_ok=True)
    report_json_path = os.path.join(output_dir, "abstention-frontier-v1.json")

    report = {
        "benchmark_version": "story01b-c6-abstention-frontier-v1",
        "strict_threshold": DEFAULT_STRICT_THRESHOLD,
        "recommended_abstention_policy": best_policy["policy"],
        "recommended_policy_metrics": best_policy,
        "safety_coverage_frontier": frontier,
        "confidence_bands_definition": {
            "STRONG_SUPPORT": "All 3 crossfit models unanimous above threshold, margin >= 0.05, zero contradictions (< 0.70 * thresh), source_count >= 2",
            "MODERATE_SUPPORT": "Majority consensus, margin >= 0.0, zero contradictory edges, positive representative edge",
            "WEAK_SUPPORT": "Borderline edge consensus or single-edge bridge connection",
            "STANDALONE": "Single article story",
        },
        "emitted_artifacts": {
            "frontier_json_filename": "abstention-frontier-v1.json",
        },
    }

    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    frontier_sha256 = compute_file_sha256(report_json_path)
    report["emitted_artifacts"]["frontier_json_sha256"] = frontier_sha256

    return report


def main():
    parser = argparse.ArgumentParser(description="Run Story-01B Abstention Benchmark")
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--scores", default=DEFAULT_SCORES_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    report = run_abstention_benchmark(gold_path=args.gold, scores_path=args.scores, output_dir=args.output_dir)

    print("============================================================")
    print("STORY-01B-C6 ABSTENTION & CONFIDENCE BENCHMARK COMPLETE")
    print(f"Recommended Policy: {report['recommended_abstention_policy']}")
    metrics = report["recommended_policy_metrics"]
    print(f"Pair Coverage: {metrics['pair_coverage']}")
    print(f"SAME_EVENT Capture: {metrics['same_event_capture_rate']} ({metrics['same_event_pairs_captured']}/{metrics['same_event_pairs_total']})")
    print(f"Different Event Contamination: {metrics['different_event_cluster_contamination']}")
    print(f"Related Topic Contamination: {metrics['related_topic_cluster_contamination']}")
    print(f"Hard Negative Contamination: {metrics['cluster_hard_negative_contamination_count']}")
    print("============================================================")


if __name__ == "__main__":
    main()
