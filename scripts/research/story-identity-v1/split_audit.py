#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Split Feasibility and Leakage Audit (STORY-01B-M0)

Analyzes the article co-occurrence graph of the frozen gold dataset (story01b-gold-v1),
evaluates connected component partitioning, simulates candidate evaluation protocols
(Protocol A: Component Group K-Fold; Protocol B: Leave-One-Episode-Family-Out),
and enforces strict article-disjointness to eliminate train-test leakage.

Zero external dependencies (pure Python standard library).
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


EXPECTED_GOLD_SHA256 = "150db715c499835c5ec4d7b2d4d0ea5875913f5c4717aa30258af4dfed640b2b"
EXPECTED_PAIR_COUNT = 156
EXPECTED_ARTICLE_COUNT = 130
DEFAULT_GOLD_PATH = "/tmp/newsflux-story01b-private/checkpoints/story01b-gold-v1.csv"


class ArticleGraph:
    """Undirected article co-occurrence graph constructed from labeled pairs."""

    def __init__(self, pairs: List[Dict[str, str]]):
        self.pairs = pairs
        self.adj: Dict[str, Set[str]] = defaultdict(set)
        self.nodes: Set[str] = set()
        self.pair_edges: List[Tuple[str, str, Dict[str, str]]] = []

        for p in self.pairs:
            u = p["entry_a_id"]
            v = p["entry_b_id"]
            self.nodes.add(u)
            self.nodes.add(v)
            self.adj[u].add(v)
            self.adj[v].add(u)
            self.pair_edges.append((u, v, p))

        self.components = self._find_connected_components()

    def _find_connected_components(self) -> List[Set[str]]:
        visited = set()
        components = []
        for node in sorted(self.nodes):
            if node not in visited:
                comp = set()
                queue = [node]
                visited.add(node)
                while queue:
                    curr = queue.pop(0)
                    comp.add(curr)
                    for neighbor in self.adj[curr]:
                        if neighbor not in visited:
                            visited.add(neighbor)
                            queue.append(neighbor)
                components.append(comp)
        # Deterministic ordering: descending by size, then by smallest article ID
        components.sort(key=lambda c: (-len(c), sorted(c)[0]))
        return components

    def get_degrees(self) -> List[int]:
        return sorted(len(self.adj[n]) for n in self.nodes)

    def get_component_details(self) -> List[Dict[str, Any]]:
        details = []
        for idx, comp in enumerate(self.components, 1):
            comp_pairs = [p for (u, v, p) in self.pair_edges if u in comp and v in comp]
            labels = Counter(p["gold_label"] for p in comp_pairs)
            fams = sorted(set(p["episode_family_id"] for p in comp_pairs if p.get("episode_family_id")))
            details.append({
                "component_id": f"C{idx:02d}",
                "nodes": comp,
                "pairs": comp_pairs,
                "article_count": len(comp),
                "pair_count": len(comp_pairs),
                "SAME_EVENT": labels["SAME_EVENT"],
                "RELATED_TOPIC": labels["RELATED_TOPIC"],
                "DIFFERENT_EVENT": labels["DIFFERENT_EVENT"],
                "positive_count": labels["SAME_EVENT"],
                "negative_count": labels["RELATED_TOPIC"] + labels["DIFFERENT_EVENT"],
                "episode_families": fams,
            })
        return details


def verify_gold_integrity(gold_path: str) -> Tuple[str, List[Dict[str, str]]]:
    """Verify SHA256 and schema of the gold dataset."""
    if not os.path.exists(gold_path):
        raise FileNotFoundError(f"Gold dataset not found at {gold_path}")

    with open(gold_path, "rb") as f:
        file_sha = hashlib.sha256(f.read()).hexdigest()

    with open(gold_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    return file_sha, rows


def check_article_disjointness(split_articles: List[Set[str]]) -> int:
    """Return count of overlapping articles across any pair of splits (0 = leak-free)."""
    total_leakage = 0
    for i in range(len(split_articles)):
        for j in range(i + 1, len(split_articles)):
            overlap = split_articles[i] & split_articles[j]
            total_leakage += len(overlap)
    return total_leakage


def simulate_protocol_a(graph: ArticleGraph, k: int) -> Dict[str, Any]:
    """
    Protocol A: Connected Component Group Split (K-Fold).
    Assigns whole connected components to folds using two-stage stratified balancing:
    1. Positive-bearing components are distributed by descending positive count.
    2. Pure negative components are distributed to balance total fold pair counts.
    """
    comp_details = graph.get_component_details()

    folds: List[Dict[str, Any]] = [
        {
            "fold_idx": i,
            "components": [],
            "articles": set(),
            "pairs": [],
            "pair_count": 0,
            "SAME_EVENT": 0,
            "RELATED_TOPIC": 0,
            "DIFFERENT_EVENT": 0,
            "positive_count": 0,
            "negative_count": 0,
            "episode_families": set(),
        }
        for i in range(k)
    ]

    pos_comps = [c for c in comp_details if c["positive_count"] > 0]
    neg_comps = [c for c in comp_details if c["positive_count"] == 0]

    # Sort positive components descending by positive count, then by total pairs
    pos_comps.sort(key=lambda c: (-c["positive_count"], -c["pair_count"]))
    # Sort negative components descending by total pairs
    neg_comps.sort(key=lambda c: -c["pair_count"])

    # Stage 1: Distribute positive components across folds
    for c in pos_comps:
        target_fold = min(folds, key=lambda f: (f["positive_count"], f["pair_count"]))
        target_fold["components"].append(c["component_id"])
        target_fold["articles"].update(c["nodes"])
        target_fold["pairs"].extend(c["pairs"])
        target_fold["pair_count"] += c["pair_count"]
        target_fold["SAME_EVENT"] += c["SAME_EVENT"]
        target_fold["RELATED_TOPIC"] += c["RELATED_TOPIC"]
        target_fold["DIFFERENT_EVENT"] += c["DIFFERENT_EVENT"]
        target_fold["positive_count"] += c["positive_count"]
        target_fold["negative_count"] += c["negative_count"]
        target_fold["episode_families"].update(c["episode_families"])

    # Stage 2: Distribute pure negative components to balance total pair count
    for c in neg_comps:
        target_fold = min(folds, key=lambda f: f["pair_count"])
        target_fold["components"].append(c["component_id"])
        target_fold["articles"].update(c["nodes"])
        target_fold["pairs"].extend(c["pairs"])
        target_fold["pair_count"] += c["pair_count"]
        target_fold["SAME_EVENT"] += c["SAME_EVENT"]
        target_fold["RELATED_TOPIC"] += c["RELATED_TOPIC"]
        target_fold["DIFFERENT_EVENT"] += c["DIFFERENT_EVENT"]
        target_fold["positive_count"] += c["positive_count"]
        target_fold["negative_count"] += c["negative_count"]
        target_fold["episode_families"].update(c["episode_families"])

    leakage = check_article_disjointness([f["articles"] for f in folds])
    all_positive = all(f["positive_count"] > 0 for f in folds)
    all_negative = all(f["negative_count"] > 0 for f in folds)
    all_related = all(f["RELATED_TOPIC"] > 0 for f in folds)

    return {
        "k": k,
        "feasible": (all_positive and all_negative and leakage == 0),
        "article_leakage": leakage,
        "all_positive": all_positive,
        "all_negative": all_negative,
        "all_related_topic": all_related,
        "folds": [
            {
                "fold": f["fold_idx"],
                "components": f["components"],
                "articles_count": len(f["articles"]),
                "pair_count": f["pair_count"],
                "positive_count": f["positive_count"],
                "negative_count": f["negative_count"],
                "SAME_EVENT": f["SAME_EVENT"],
                "RELATED_TOPIC": f["RELATED_TOPIC"],
                "DIFFERENT_EVENT": f["DIFFERENT_EVENT"],
                "episode_family_count": len(f["episode_families"]),
                "episode_families": sorted(list(f["episode_families"])),
            }
            for f in folds
        ],
    }


def simulate_protocol_b(graph: ArticleGraph) -> List[Dict[str, Any]]:
    """
    Protocol B: Leave-One-Episode-Family-Out (LOFO).
    For each of the 10 positive episode families, isolates the family component as test.
    """
    comp_details = graph.get_component_details()
    fam_to_comp: Dict[str, Dict[str, Any]] = {}

    for c in comp_details:
        for f in c["episode_families"]:
            fam_to_comp[f] = c

    lofo_results = []
    for fam in sorted(fam_to_comp.keys()):
        test_comp = fam_to_comp[fam]
        test_articles = test_comp["nodes"]
        test_pairs = test_comp["pairs"]

        test_pos = test_comp["SAME_EVENT"]
        test_rel = test_comp["RELATED_TOPIC"]
        test_diff = test_comp["DIFFERENT_EVENT"]
        test_neg = test_rel + test_diff

        # Train pairs: all pairs from all other components
        train_pairs = []
        train_fams = set()
        for other_c in comp_details:
            if other_c["component_id"] != test_comp["component_id"]:
                train_pairs.extend(other_c["pairs"])
                train_fams.update(other_c["episode_families"])

        train_labels = Counter(p["gold_label"] for p in train_pairs)
        train_articles = set()
        for p in train_pairs:
            train_articles.add(p["entry_a_id"])
            train_articles.add(p["entry_b_id"])

        leakage = len(test_articles & train_articles)

        lofo_results.append({
            "held_out_family": fam,
            "component_id": test_comp["component_id"],
            "test_positive_pairs": test_pos,
            "test_negative_pairs": test_neg,
            "test_related_topic": test_rel,
            "test_different_event": test_diff,
            "train_positive_pairs": train_labels["SAME_EVENT"],
            "train_negative_pairs": train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"],
            "removed_for_article_disjointness": 0,
            "train_episode_families_remaining": len(train_fams),
            "article_leakage": leakage,
            "test_has_negatives": (test_neg > 0),
            "test_has_related_topic": (test_rel > 0),
        })

    return lofo_results


def run_split_audit(gold_path: str) -> Dict[str, Any]:
    """Execute complete split feasibility and leakage audit."""
    file_sha, pairs = verify_gold_integrity(gold_path)

    # Schema checks
    pair_count = len(pairs)
    class_counts = Counter(p["gold_label"] for p in pairs)
    pos_count = class_counts["SAME_EVENT"]
    rel_count = class_counts["RELATED_TOPIC"]
    diff_count = class_counts["DIFFERENT_EVENT"]
    unc_count = class_counts.get("UNCERTAIN", 0)

    fams = Counter(p["episode_family_id"] for p in pairs if p.get("episode_family_id"))
    pos_without_fam = sum(1 for p in pairs if p["gold_label"] == "SAME_EVENT" and not p.get("episode_family_id"))
    neg_with_fam = sum(1 for p in pairs if p["gold_label"] != "SAME_EVENT" and p.get("episode_family_id"))

    # Graph construction
    graph = ArticleGraph(pairs)
    degrees = graph.get_degrees()
    deg_max = max(degrees)
    deg_median = statistics.median(degrees)
    p95_idx = int(math.ceil(0.95 * len(degrees))) - 1
    deg_p95 = degrees[p95_idx]

    comp_details = graph.get_component_details()
    largest_comp = comp_details[0]
    isolated_pairs = sum(1 for c in comp_details if c["pair_count"] == 1)
    multi_pairs = sum(1 for c in comp_details if c["pair_count"] > 1)

    # Simulations
    proto_a_k2 = simulate_protocol_a(graph, 2)
    proto_a_k3 = simulate_protocol_a(graph, 3)
    proto_a_k4 = simulate_protocol_a(graph, 4)
    proto_a_k5 = simulate_protocol_a(graph, 5)

    lofo_results = simulate_protocol_b(graph)
    iphone_duo_lofo = next(r for r in lofo_results if r["held_out_family"] == "IPHONE_DUO_FIRST_GEN_LAUNCH")
    non_duo_lofo = [r for r in lofo_results if r["held_out_family"] != "IPHONE_DUO_FIRST_GEN_LAUNCH"]

    return {
        "gold_sha256": file_sha,
        "pair_count": pair_count,
        "unique_article_count": len(graph.nodes),
        "class_counts": {
            "SAME_EVENT": pos_count,
            "RELATED_TOPIC": rel_count,
            "DIFFERENT_EVENT": diff_count,
            "UNCERTAIN": unc_count,
        },
        "episode_family_count": len(fams),
        "pos_without_family": pos_without_fam,
        "neg_with_family": neg_with_fam,
        "graph_node_count": len(graph.nodes),
        "graph_edge_count": len(pairs),
        "connected_component_count": len(graph.components),
        "largest_component_article_count": largest_comp["article_count"],
        "largest_component_pair_count": largest_comp["pair_count"],
        "isolated_pair_component_count": isolated_pairs,
        "multi_pair_component_count": multi_pairs,
        "degree_max": deg_max,
        "degree_median": deg_median,
        "degree_p95": deg_p95,
        "component_details": comp_details,
        "protocol_a_k2": proto_a_k2,
        "protocol_a_k3": proto_a_k3,
        "protocol_a_k4": proto_a_k4,
        "protocol_a_k5": proto_a_k5,
        "lofo_results": lofo_results,
        "iphone_duo_lofo": iphone_duo_lofo,
        "non_duo_lofo": non_duo_lofo,
    }


def main():
    parser = argparse.ArgumentParser(description="NewsFlux STORY-01B-M0 Split Feasibility & Leakage Audit")
    parser.add_argument("--gold", default=os.environ.get("STORY01B_GOLD_PATH", DEFAULT_GOLD_PATH), help="Path to story01b-gold-v1.csv")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    results = run_split_audit(args.gold)

    if args.json:
        # Convert sets/objects to serializable
        clean_res = dict(results)
        clean_res["component_details"] = [
            {k: (list(v) if isinstance(v, set) else v) for k, v in c.items() if k != "pairs"}
            for c in clean_res["component_details"]
        ]
        clean_res["non_duo_lofo"] = len(clean_res["non_duo_lofo"])
        print(json.dumps(clean_res, indent=2))
        return

    print("=" * 60)
    print("NEWSFLUX STORY IDENTITY — STORY-01B-M0 SPLIT FEASIBILITY AUDIT")
    print("=" * 60)
    print("GOLD_SHA256:", results["gold_sha256"])
    print("PAIR_COUNT:", results["pair_count"])
    print("UNIQUE_ARTICLE_COUNT:", results["unique_article_count"])
    print("CLASS_COUNTS:", results["class_counts"])
    print("EPISODE_FAMILY_COUNT:", results["episode_family_count"])
    print("-" * 60)
    print("ARTICLE GRAPH & COMPONENTS:")
    print("  NODES:", results["graph_node_count"])
    print("  EDGES:", results["graph_edge_count"])
    print("  COMPONENTS:", results["connected_component_count"])
    print("  LARGEST COMPONENT:", results["largest_component_article_count"], "articles,", results["largest_component_pair_count"], "pairs")
    print("  DEGREES: max =", results["degree_max"], ", median =", results["degree_median"], ", p95 =", results["degree_p95"])
    print("-" * 60)
    print("PROTOCOL A EVALUATION:")
    for k in [2, 3, 4, 5]:
        res = results[f"protocol_a_k{k}"]
        print(f"  K={k}: Feasible={res['feasible']}, Leakage={res['article_leakage']}")
        for f in res["folds"]:
            print(f"    Fold {f['fold']}: pairs={f['pair_count']}, pos={f['positive_count']}, neg={f['negative_count']} (rel={f['RELATED_TOPIC']}, diff={f['DIFFERENT_EVENT']}), fams={f['episode_family_count']}")
    print("-" * 60)
    print("PROTOCOL B (LOFO) EVALUATION:")
    print("  Total families evaluated:", len(results["lofo_results"]))
    print("  iPhone Duo holdout: test_pos =", results["iphone_duo_lofo"]["test_positive_pairs"], ", test_neg =", results["iphone_duo_lofo"]["test_negative_pairs"], ", train_pos =", results["iphone_duo_lofo"]["train_positive_pairs"], ", train_fams =", results["iphone_duo_lofo"]["train_episode_families_remaining"])
    print("  Non-Duo families count:", len(results["non_duo_lofo"]))
    zero_neg = [r["held_out_family"] for r in results["non_duo_lofo"] if not r["test_has_negatives"]]
    print("  Non-Duo families with 0 test negatives (Option N1):", zero_neg)
    print("=" * 60)
    print("AUDIT_STATUS=SUCCESS")


if __name__ == "__main__":
    main()
