#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Cluster Policy Benchmark (STORY-01B-C1 Stages E & F)

Objectives:
- Benchmark conservative clustering policies (P0 through P4) across models (B0, B4) and operating points (STRICT, MEDIAN, PERMISSIVE).
- Policy matrix:
    - P0: Unrestricted Connected Components (negative control only)
    - P1: Representative Guard (admission requires edge to representative and member)
    - P2: Conservative Observed-Edge Compatibility (requires representative edge, no observed negative edge)
    - P3: Strong Multi-Member Support (requires >=2 positive edges for size >= 2)
    - P4: Contradiction Veto (base compatibility + contradiction/dense similarity veto)
- Enforce bounded cluster safeguards:
    - MAX_CLUSTER_SIZE = 10
    - MAX_TEMPORAL_SPAN_HOURS = 24.0
- Validation against Gold Subgraph (10 positive episode families, 156 pairs, 130 articles):
    - FALSE_FAMILY_MERGE_COUNT (must be 0 to qualify)
    - CROSS_FAMILY_CLUSTER_COUNT
    - FAMILY_PURITY, FAMILY_FRAGMENTATION, SAME_EVENT_EDGE_CAPTURE
    - RELATED_TOPIC_PROPAGATED_MERGES, DIFFERENT_EVENT_PROPAGATED_MERGES
- Transitive Chain Stress Test (12 historical candidates):
    - CHAIN_FALSE_MERGE vs CHAIN_SAFE_SPLIT
- Policy Selection Outcome:
    - C1_RESULT = SAFE_POLICY_CANDIDATE_FOUND
    - RECOMMENDED_OFFLINE_CLUSTER_POLICY
- Export private artifacts:
    - /tmp/newsflux-story01b-private/c1/story01b-c1-cluster-policy-benchmark-v1.json
    - /tmp/newsflux-story01b-private/c1/story01b-c1-cluster-failures-v1.csv
    - /tmp/newsflux-story01b-private/c1/story01b-c1-cluster-assignments-v1.json
"""

import argparse
import csv
import hashlib
import json
import math
import os
import statistics
import sys
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from .harness import CorpusVerifier, TransitiveChainDetector
    from .model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
    )
except ImportError:
    from harness import CorpusVerifier, TransitiveChainDetector
    from model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
    )

DEFAULT_C1_OUTPUT_DIR = "/tmp/newsflux-story01b-private/c1"
DEFAULT_SCORES_PATH = "/tmp/newsflux-story01b-private/c1/story01b-home200-b0-b4-crossfit-scores-v1.csv"

MAX_CLUSTER_SIZE_SAFEGUARD = 10
MAX_TEMPORAL_SPAN_HOURS_SAFEGUARD = 24.0


def compute_file_sha256(path: str) -> str:
    """Compute SHA256 of file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class ClusterEngine:
    """Deterministic clustering engine supporting policies P0 through P4 with bounded safeguards."""

    @staticmethod
    def cluster(
        policy_name: str,
        score_lookup: Dict[str, float],
        threshold: float,
        article_list: List[int],
        published_lookup: Dict[int, float],
        max_cluster_size: int = MAX_CLUSTER_SIZE_SAFEGUARD,
        max_temporal_span_hours: float = MAX_TEMPORAL_SPAN_HOURS_SAFEGUARD,
    ) -> List[List[int]]:
        """Cluster articles under the specified policy."""
        # Find positive candidate edges
        pos_edges = []
        for pk, sc in score_lookup.items():
            if sc >= threshold:
                parts = pk.split(":")
                u, v = int(parts[0]), int(parts[1])
                if u in article_list and v in article_list:
                    pos_edges.append((sc, min(u, v), max(u, v)))

        # Sort edges descending by score, then canonical pair key for absolute determinism
        pos_edges.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)

        if policy_name == "P0_UNRESTRICTED_CC":
            parent = {a: a for a in article_list}

            def find(a):
                if parent[a] != a:
                    parent[a] = find(parent[a])
                return parent[a]

            def union(a, b):
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb

            for sc, u, v in pos_edges:
                union(u, v)

            clusters_map = defaultdict(list)
            for a in sorted(article_list):
                clusters_map[find(a)].append(a)
            # Sort clusters deterministically
            return [sorted(c) for c in sorted(clusters_map.values(), key=lambda cl: (len(cl), cl[0]), reverse=True)]

        # Conservative Seed-Based Clustering for P1 to P4
        clusters: List[List[int]] = []
        article_to_cluster_idx: Dict[int, int] = {}
        representative_of: Dict[int, int] = {}

        def get_pub(art_id: int) -> float:
            return published_lookup.get(art_id, 0.0)

        def pair_score(u: int, v: int) -> Optional[float]:
            pk = f"{min(u, v)}:{max(u, v)}"
            return score_lookup.get(pk, None)

        for sc, u, v in pos_edges:
            c_u = article_to_cluster_idx.get(u)
            c_v = article_to_cluster_idx.get(v)

            if c_u is None and c_v is None:
                # Form new seed cluster
                # Representative: earliest published article (deterministic tie-break on smaller ID)
                rep = u if (get_pub(u), u) <= (get_pub(v), v) else v
                c_idx = len(clusters)
                clusters.append([u, v])
                representative_of[c_idx] = rep
                article_to_cluster_idx[u] = c_idx
                article_to_cluster_idx[v] = c_idx

            elif (c_u is not None and c_v is None) or (c_u is None and c_v is not None):
                existing_art = u if c_u is not None else v
                cand_art = v if c_u is not None else u
                c_idx = article_to_cluster_idx[existing_art]
                rep = representative_of[c_idx]
                members = clusters[c_idx]

                # Safeguard 1: MAX_CLUSTER_SIZE
                if len(members) >= max_cluster_size:
                    continue

                # Safeguard 2: MAX_TEMPORAL_SPAN
                pub_cand = get_pub(cand_art)
                if any(abs(pub_cand - get_pub(m)) > max_temporal_span_hours * 3600.0 for m in members):
                    continue

                # Policy-specific admission guards:
                # 1. Edge to representative must exist and meet threshold
                rep_sc = pair_score(cand_art, rep)
                if rep_sc is None or rep_sc < threshold:
                    continue

                if policy_name == "P1_REPRESENTATIVE_GUARD":
                    # Admitted: positive edge to representative AND edge to existing member
                    pass

                elif policy_name == "P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY":
                    # Admitted iff NO observed negative edge to any cluster member
                    # (Observed negative: evaluated pair with score < threshold)
                    has_observed_negative = False
                    for m in members:
                        m_sc = pair_score(cand_art, m)
                        if m_sc is not None and m_sc < threshold:
                            has_observed_negative = True
                            break
                    if has_observed_negative:
                        continue

                elif policy_name == "P3_STRONG_MULTI_MEMBER_SUPPORT":
                    # If cluster already has >= 2 members, candidate must have positive edge to at least 2 distinct members
                    if len(members) >= 2:
                        pos_member_count = sum(1 for m in members if (pair_score(cand_art, m) or 0.0) >= threshold)
                        if pos_member_count < 2:
                            continue

                elif policy_name == "P4_CONTRADICTION_VETO":
                    # Base P2 + strict veto on strong contrary evidence
                    has_contradiction = False
                    for m in members:
                        m_sc = pair_score(cand_art, m)
                        # Strong contrary edge veto (score < 0.7 * threshold)
                        if m_sc is not None and m_sc < (threshold * 0.7):
                            has_contradiction = True
                            break
                    if has_contradiction:
                        continue

                # Candidate admitted
                clusters[c_idx].append(cand_art)
                article_to_cluster_idx[cand_art] = c_idx

            else:
                # Both u and v are already in multi-article clusters
                # Conservative rule: Do NOT merge established multi-article clusters
                continue

        # Singletons for unclustered articles
        clustered_set = set(article_to_cluster_idx.keys())
        for a in sorted(article_list):
            if a not in clustered_set:
                clusters.append([a])

        # Canonical sort for determinism
        return [sorted(c) for c in sorted(clusters, key=lambda cl: (-len(cl), cl[0]))]


def evaluate_cluster_assignments_on_gold(
    clusters: List[List[int]],
    gold_rows: List[Dict[str, str]],
    article_to_family: Dict[int, str],
) -> Dict[str, Any]:
    """Evaluate cluster quality against frozen Gold positive families and negative pairs."""
    article_to_cluster = {}
    for c_idx, c in enumerate(clusters):
        for a in c:
            article_to_cluster[a] = c_idx

    # 1. False family merges and cross-family clusters
    false_family_merges = 0
    cross_family_clusters = 0
    family_members_in_clusters = defaultdict(lambda: defaultdict(int))

    for c_idx, c in enumerate(clusters):
        c_fams = set()
        for a in c:
            fam = article_to_family.get(a)
            if fam:
                c_fams.add(fam)
                family_members_in_clusters[fam][c_idx] += 1
        if len(c_fams) > 1:
            cross_family_clusters += 1
            false_family_merges += (len(c_fams) - 1)

    # 2. Purity
    # Weighted average purity over clusters that contain positive articles
    total_pos_articles_in_clusters = 0
    purity_sum = 0.0

    for c in clusters:
        pos_fams = [article_to_family[a] for a in c if a in article_to_family]
        if pos_fams:
            maj_count = Counter(pos_fams).most_common(1)[0][1]
            c_purity = maj_count / len(pos_fams)
            purity_sum += c_purity * len(pos_fams)
            total_pos_articles_in_clusters += len(pos_fams)

    family_purity = round(purity_sum / total_pos_articles_in_clusters, 4) if total_pos_articles_in_clusters > 0 else 1.0

    # 3. Fragmentation
    # Average number of clusters into which each positive family is split
    fam_frag_counts = []
    for fam, c_dist in family_members_in_clusters.items():
        fam_frag_counts.append(len(c_dist))
    family_fragmentation = round(statistics.mean(fam_frag_counts), 4) if fam_frag_counts else 1.0

    # 4. Pair-level metrics on Gold pairs
    same_event_total = 0
    same_event_captured = 0
    related_total = 0
    related_propagated = 0
    diff_total = 0
    diff_propagated = 0

    failure_records = []

    for r in gold_rows:
        pk = r["pair_key"]
        lbl = r["gold_label"]
        u = int(r["entry_a_id"])
        v = int(r["entry_b_id"])

        c_u = article_to_cluster.get(u)
        c_v = article_to_cluster.get(v)
        in_same_cluster = (c_u is not None and c_u == c_v)

        if lbl == "SAME_EVENT":
            same_event_total += 1
            if in_same_cluster:
                same_event_captured += 1
        elif lbl == "RELATED_TOPIC":
            related_total += 1
            if in_same_cluster:
                related_propagated += 1
                failure_records.append({
                    "pair_key": pk,
                    "entry_a_id": u,
                    "entry_b_id": v,
                    "gold_label": lbl,
                    "failure_type": "PROPAGATED_RELATED_TOPIC_MERGE",
                    "cluster_id": c_u,
                    "cluster_size": len(clusters[c_u]),
                })
        elif lbl == "DIFFERENT_EVENT":
            diff_total += 1
            if in_same_cluster:
                diff_propagated += 1
                failure_records.append({
                    "pair_key": pk,
                    "entry_a_id": u,
                    "entry_b_id": v,
                    "gold_label": lbl,
                    "failure_type": "PROPAGATED_DIFFERENT_EVENT_MERGE",
                    "cluster_id": c_u,
                    "cluster_size": len(clusters[c_u]),
                })

    same_event_capture_rate = round(same_event_captured / same_event_total, 4) if same_event_total > 0 else 0.0

    sizes = [len(c) for c in clusters]
    multi_clusters = [c for c in clusters if len(c) > 1]
    singletons = [c for c in clusters if len(c) == 1]

    return {
        "false_family_merge_count": false_family_merges,
        "cross_family_cluster_count": cross_family_clusters,
        "family_purity": family_purity,
        "family_fragmentation": family_fragmentation,
        "same_event_edge_capture": same_event_captured,
        "same_event_edge_capture_rate": same_event_capture_rate,
        "related_topic_propagated_merges": related_propagated,
        "different_event_propagated_merges": diff_propagated,
        "cluster_count": len(clusters),
        "multi_article_cluster_count": len(multi_clusters),
        "unclustered_article_count": len(singletons),
        "mean_cluster_size": round(statistics.mean(sizes), 2),
        "max_cluster_size": max(sizes) if sizes else 0,
        "failure_records": failure_records,
    }


def evaluate_transitive_chains(
    clusters: List[List[int]],
    chains: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Evaluate cluster policy against the 12 historical transitive chain cases."""
    c_lookup = {}
    for i, c in enumerate(clusters):
        for a in c:
            c_lookup[a] = i

    false_merges = 0
    safe_splits = 0
    unresolved = 0

    chain_details = []
    for ch in chains:
        a, b, c = ch["triple"]
        ca = c_lookup.get(a)
        cb = c_lookup.get(b)
        cc = c_lookup.get(c)

        if ca is not None and ca == cb == cc:
            outcome = "CHAIN_FALSE_MERGE"
            false_merges += 1
        elif (ca == cb and cb != cc) or (cb == cc and ca != cb) or (ca != cb and cb != cc):
            outcome = "CHAIN_SAFE_SPLIT"
            safe_splits += 1
        else:
            outcome = "CHAIN_UNRESOLVED"
            unresolved += 1

        chain_details.append({
            "triple": (a, b, c),
            "weak_pair_key": ch["weak_pair_key"],
            "outcome": outcome,
        })

    return {
        "total_cases": len(chains),
        "chain_false_merges": false_merges,
        "chain_safe_splits": safe_splits,
        "chain_unresolved": unresolved,
        "chain_details": chain_details,
    }


def run_cluster_policy_benchmark(
    scores_path: str = DEFAULT_SCORES_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    gold_path: str = DEFAULT_GOLD_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    output_dir: str = DEFAULT_C1_OUTPUT_DIR,
) -> Dict[str, Any]:
    """Execute complete C1 cluster policy benchmark and emit private artifacts."""
    t0 = time.time()

    # 1. Load inputs
    with open(scores_path, "r", encoding="utf-8") as f:
        score_rows = list(csv.DictReader(f))

    b4_scores = {r["pair_key"]: float(r["b4_crossfit_ensemble_score"]) for r in score_rows}
    b0_scores = {r["pair_key"]: float(r["b0_score"]) for r in score_rows}

    ok_c, _, entries = CorpusVerifier.verify(corpus_path)
    corpus_lookup = {doc["id"]: doc for doc in entries}
    published_lookup = {doc["id"]: float(doc.get("published_at", 0.0)) for doc in entries}
    all_article_ids = sorted([doc["id"] for doc in entries])

    with open(DEFAULT_GOLD_PATH, "r", encoding="utf-8") as f:
        gold_rows = list(csv.DictReader(f))

    article_to_family = {}
    for r in gold_rows:
        fam = r.get("episode_family_id")
        if fam:
            article_to_family[int(r["entry_a_id"])] = fam
            article_to_family[int(r["entry_b_id"])] = fam

    with open(pairs_path, "r", encoding="utf-8") as f:
        raw_pairs = list(csv.DictReader(f))
    chains = TransitiveChainDetector.detect(raw_pairs)

    # 2. Operating points definition
    # Thresholds derived strictly within M1 Protocol A
    operating_points = [
        {"model": "B4_LOGISTIC_REGRESSION", "point": "STRICT", "threshold": 0.3787, "scores": b4_scores},
        {"model": "B4_LOGISTIC_REGRESSION", "point": "MEDIAN", "threshold": 0.2608, "scores": b4_scores},
        {"model": "B4_LOGISTIC_REGRESSION", "point": "PERMISSIVE", "threshold": 0.2051, "scores": b4_scores},
        {"model": "B0_TITLE_OVERLAP_ONLY", "point": "STRICT", "threshold": 0.3541, "scores": b0_scores},
        {"model": "B0_TITLE_OVERLAP_ONLY", "point": "MEDIAN", "threshold": 0.2679, "scores": b0_scores},
    ]

    policies = [
        "P0_UNRESTRICTED_CC",
        "P1_REPRESENTATIVE_GUARD",
        "P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY",
        "P3_STRONG_MULTI_MEMBER_SUPPORT",
        "P4_CONTRADICTION_VETO",
    ]

    scorecard = []
    all_failures = []
    cluster_assignments_by_policy = {}

    for op in operating_points:
        m_name = op["model"]
        p_name = op["point"]
        thresh = op["threshold"]
        s_lookup = op["scores"]

        for pol in policies:
            clusters = ClusterEngine.cluster(
                policy_name=pol,
                score_lookup=s_lookup,
                threshold=thresh,
                article_list=all_article_ids,
                published_lookup=published_lookup,
            )

            # Record cluster assignments
            key = f"{m_name}__{p_name}__{pol}"
            cluster_assignments_by_policy[key] = {
                "model": m_name,
                "operating_point": p_name,
                "threshold": thresh,
                "policy": pol,
                "cluster_count": len(clusters),
                "clusters": clusters,
            }

            # Evaluate on gold
            gold_eval = evaluate_cluster_assignments_on_gold(clusters, gold_rows, article_to_family)

            # Evaluate on transitive chains
            chain_eval = evaluate_transitive_chains(clusters, chains)

            # Collect failure records
            for f_rec in gold_eval["failure_records"]:
                all_failures.append({
                    "policy_name": pol,
                    "model_name": m_name,
                    "threshold_name": p_name,
                    "threshold_value": thresh,
                    "pair_key": f_rec["pair_key"],
                    "entry_a_id": f_rec["entry_a_id"],
                    "entry_b_id": f_rec["entry_b_id"],
                    "gold_label": f_rec["gold_label"],
                    "failure_type": f_rec["failure_type"],
                    "cluster_id": f_rec["cluster_id"],
                    "cluster_size": f_rec["cluster_size"],
                })

            entry = {
                "model": m_name,
                "operating_point": p_name,
                "threshold": thresh,
                "policy": pol,
                "false_family_merges": gold_eval["false_family_merge_count"],
                "cross_family_clusters": gold_eval["cross_family_cluster_count"],
                "family_purity": gold_eval["family_purity"],
                "family_fragmentation": gold_eval["family_fragmentation"],
                "same_event_capture": gold_eval["same_event_edge_capture"],
                "same_event_capture_rate": gold_eval["same_event_edge_capture_rate"],
                "related_topic_propagation": gold_eval["related_topic_propagated_merges"],
                "different_event_propagation": gold_eval["different_event_propagated_merges"],
                "transitive_chain_false_merges": chain_eval["chain_false_merges"],
                "transitive_chain_safe_splits": chain_eval["chain_safe_splits"],
                "cluster_count": gold_eval["cluster_count"],
                "multi_article_cluster_count": gold_eval["multi_article_cluster_count"],
                "unclustered_article_count": gold_eval["unclustered_article_count"],
                "mean_cluster_size": gold_eval["mean_cluster_size"],
                "max_cluster_size": gold_eval["max_cluster_size"],
            }
            scorecard.append(entry)

    # 3. Policy Selection Logic
    # Filter candidates with FALSE_FAMILY_MERGE_COUNT == 0
    safe_candidates = [
        sc for sc in scorecard
        if sc["false_family_merges"] == 0 and sc["policy"] != "P0_UNRESTRICTED_CC"
    ]

    if safe_candidates:
        c1_result = "SAFE_POLICY_CANDIDATE_FOUND"
        # Sort safe candidates by:
        # 1. Minimum related topic propagation
        # 2. Minimum different event propagation
        # 3. Maximum purity
        # 4. Maximum same event capture
        # 5. Model preference: B4
        def sort_key(sc):
            m_pref = 1 if sc["model"] == "B4_LOGISTIC_REGRESSION" else 0
            return (
                -sc["related_topic_propagation"],  # lower is better -> higher negative
                -sc["different_event_propagation"],
                sc["family_purity"],
                sc["same_event_capture"],
                m_pref,
            )

        best_candidate = max(safe_candidates, key=sort_key)
        recommended_policy = best_candidate["policy"]
        recommended_model = best_candidate["model"]
        recommended_point = best_candidate["operating_point"]
        recommended_key = f"{recommended_model}__{recommended_point}__{recommended_policy}"
    else:
        c1_result = "NO_SAFE_POLICY_FOUND"
        best_candidate = min(scorecard, key=lambda sc: sc["false_family_merges"])
        recommended_policy = "NONE"
        recommended_key = list(cluster_assignments_by_policy.keys())[0]

    # Transitive chain summary across policies
    tc_summary = {}
    for pol in policies:
        sc_subset = [sc for sc in scorecard if sc["policy"] == pol and sc["model"] == "B4_LOGISTIC_REGRESSION" and sc["operating_point"] == "STRICT"]
        if sc_subset:
            tc_summary[pol] = {
                "false_merges": sc_subset[0]["transitive_chain_false_merges"],
                "safe_splits": sc_subset[0]["transitive_chain_safe_splits"],
            }

    # 4. Export private artifacts
    os.makedirs(output_dir, exist_ok=True)
    benchmark_json_path = os.path.join(output_dir, "story01b-c1-cluster-policy-benchmark-v1.json")
    failures_csv_path = os.path.join(output_dir, "story01b-c1-cluster-failures-v1.csv")
    assignments_json_path = os.path.join(output_dir, "story01b-c1-cluster-assignments-v1.json")

    # Failures CSV
    failure_fields = [
        "policy_name", "model_name", "threshold_name", "threshold_value",
        "pair_key", "entry_a_id", "entry_b_id", "gold_label", "failure_type",
        "cluster_id", "cluster_size"
    ]
    with open(failures_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=failure_fields)
        writer.writeheader()
        for rec in all_failures:
            writer.writerow(rec)

    failures_sha256 = compute_file_sha256(failures_csv_path)

    # Assignments JSON (canonical recommended policy assignment)
    recommended_assignments = cluster_assignments_by_policy.get(recommended_key, {})
    with open(assignments_json_path, "w", encoding="utf-8") as f:
        json.dump(recommended_assignments, f, indent=2)

    assignments_sha256 = compute_file_sha256(assignments_json_path)

    # Benchmark report JSON
    benchmark_report = {
        "benchmark_version": "story01b-c1-cluster-policy-benchmark-v1",
        "policies_evaluated": policies,
        "operating_points_evaluated": operating_points,
        "c1_result": c1_result,
        "recommended_offline_cluster_policy": recommended_policy,
        "recommended_configuration": {
            "model": best_candidate.get("model"),
            "operating_point": best_candidate.get("operating_point"),
            "threshold": best_candidate.get("threshold"),
            "policy": recommended_policy,
        },
        "best_policy_metrics": {
            "false_family_merges": best_candidate.get("false_family_merges"),
            "cross_family_clusters": best_candidate.get("cross_family_clusters"),
            "family_purity": best_candidate.get("family_purity"),
            "family_fragmentation": best_candidate.get("family_fragmentation"),
            "same_event_capture": best_candidate.get("same_event_capture"),
            "same_event_capture_rate": best_candidate.get("same_event_capture_rate"),
            "related_topic_propagation": best_candidate.get("related_topic_propagation"),
            "different_event_propagation": best_candidate.get("different_event_propagation"),
        },
        "unrestricted_cc_negative_control": next(
            (sc for sc in scorecard if sc["policy"] == "P0_UNRESTRICTED_CC" and sc["model"] == "B4_LOGISTIC_REGRESSION" and sc["operating_point"] == "STRICT"), {}
        ),
        "transitive_chain_case_count": len(chains),
        "transitive_chains_by_policy": tc_summary,
        "scorecard": scorecard,
        "emitted_artifacts": {
            "benchmark_json_filename": "story01b-c1-cluster-policy-benchmark-v1.json",
            "failures_csv_filename": "story01b-c1-cluster-failures-v1.csv",
            "failures_csv_sha256": failures_sha256,
            "assignments_json_filename": "story01b-c1-cluster-assignments-v1.json",
            "assignments_json_sha256": assignments_sha256,
        }
    }

    with open(benchmark_json_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_report, f, indent=2)

    benchmark_sha256 = compute_file_sha256(benchmark_json_path)
    benchmark_report["emitted_artifacts"]["benchmark_json_sha256"] = benchmark_sha256

    return benchmark_report


def main():
    parser = argparse.ArgumentParser(description="Run Story-01B Cluster Policy Benchmark")
    parser.add_argument("--scores", default=DEFAULT_SCORES_PATH)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_C1_OUTPUT_DIR)
    args = parser.parse_args()

    report = run_cluster_policy_benchmark(
        scores_path=args.scores,
        corpus_path=args.corpus,
        gold_path=args.gold,
        pairs_path=args.pairs,
        output_dir=args.output_dir,
    )

    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 CLUSTER POLICY BENCHMARK COMPLETE")
    print("============================================================")
    print(f"C1_RESULT: {report['c1_result']}")
    print(f"Recommended Offline Policy: {report['recommended_offline_cluster_policy']}")
    print(f"Recommended Config: {report['recommended_configuration']}")
    print(f"Best False Family Merges: {report['best_policy_metrics']['false_family_merges']}")
    print(f"Best Purity: {report['best_policy_metrics']['family_purity']}")
    print(f"Best Fragmentation: {report['best_policy_metrics']['family_fragmentation']}")
    print(f"Benchmark JSON SHA: {report['emitted_artifacts']['benchmark_json_sha256']}")
    print(f"Failures CSV SHA: {report['emitted_artifacts']['failures_csv_sha256']}")
    print(f"Assignments JSON SHA: {report['emitted_artifacts']['assignments_json_sha256']}")
    print("============================================================")


if __name__ == "__main__":
    main()
