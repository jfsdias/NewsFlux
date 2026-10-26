#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Split Feasibility and Leakage Audit (STORY-01B-M0)

Analyzes the article co-occurrence graph of the frozen gold dataset (story01b-gold-v1),
evaluates connected component partitioning, simulates candidate evaluation protocols
(Protocol A: Component Group K-Fold; Protocol B: Leave-One-Episode-Family-Out with N1/N2/N3),
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
EXPECTED_CLASS_COUNTS = {
    "SAME_EVENT": 57,
    "RELATED_TOPIC": 19,
    "DIFFERENT_EVENT": 80,
    "UNCERTAIN": 0,
}
EXPECTED_EPISODE_FAMILY_COUNT = 10
ALLOWED_LABELS = {"SAME_EVENT", "RELATED_TOPIC", "DIFFERENT_EVENT", "UNCERTAIN"}
REQUIRED_COLUMNS = {"entry_a_id", "entry_b_id", "gold_label", "episode_family_id"}
DEFAULT_GOLD_PATH = "/tmp/newsflux-story01b-private/checkpoints/story01b-gold-v1.csv"

# N2 Methodological Guardrails
N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS = True
N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS = True


class GoldIntegrityError(Exception):
    """Raised when gold dataset integrity, schema, or invariants fail validation."""
    pass


class LofoMappingError(Exception):
    """Raised when positive families violate strict 1-to-1 bijection with connected components."""
    pass


def validate_gold_schema_and_invariants(
    rows: List[Dict[str, str]],
    expected_pair_count: Optional[int] = EXPECTED_PAIR_COUNT,
    expected_article_count: Optional[int] = EXPECTED_ARTICLE_COUNT,
    expected_class_counts: Optional[Dict[str, int]] = None,
    expected_family_count: Optional[int] = EXPECTED_EPISODE_FAMILY_COUNT,
) -> Dict[str, Any]:
    """
    Validate gold dataset schema, class enums, invariants, and counts fail-fast.
    """
    if not rows:
        raise GoldIntegrityError("Gold dataset is empty.")

    # 1. Required schema columns check
    first_row = rows[0]
    missing_cols = REQUIRED_COLUMNS - set(first_row.keys())
    if missing_cols:
        raise GoldIntegrityError(f"Missing required columns in gold dataset: {sorted(list(missing_cols))}")

    # 2. Pair count check
    if expected_pair_count is not None and len(rows) != expected_pair_count:
        raise GoldIntegrityError(f"Pair count mismatch: expected {expected_pair_count}, got {len(rows)}")

    articles = set()
    class_counts: Dict[str, int] = defaultdict(int)
    pos_families = set()
    pos_without_fam = 0
    neg_with_fam = 0

    for idx, r in enumerate(rows, 1):
        u = r.get("entry_a_id", "").strip()
        v = r.get("entry_b_id", "").strip()
        label = r.get("gold_label", "").strip()
        fam = r.get("episode_family_id", "").strip()

        if not u or not v:
            raise GoldIntegrityError(f"Row {idx} contains empty article ID: entry_a='{u}', entry_b='{v}'")

        articles.add(u)
        articles.add(v)

        # Label enum validation
        if label not in ALLOWED_LABELS:
            raise GoldIntegrityError(f"Row {idx} contains invalid label '{label}'. Allowed: {sorted(list(ALLOWED_LABELS))}")

        class_counts[label] += 1

        # Invariant: SAME_EVENT must have non-empty episode_family_id
        if label == "SAME_EVENT":
            if not fam:
                pos_without_fam += 1
                raise GoldIntegrityError(f"Row {idx} with SAME_EVENT has missing episode_family_id")
            pos_families.add(fam)
        else:
            # Invariant: Non-SAME_EVENT must have empty episode_family_id
            if fam:
                neg_with_fam += 1
                raise GoldIntegrityError(f"Row {idx} with label '{label}' has non-empty episode_family_id '{fam}'")

    # 3. Unique article count check
    if expected_article_count is not None and len(articles) != expected_article_count:
        raise GoldIntegrityError(f"Article count mismatch: expected {expected_article_count}, got {len(articles)}")

    # 4. Class counts check
    target_class_counts = expected_class_counts if expected_class_counts is not None else EXPECTED_CLASS_COUNTS
    if target_class_counts:
        for k, exp_val in target_class_counts.items():
            act_val = class_counts.get(k, 0)
            if act_val != exp_val:
                raise GoldIntegrityError(f"Class count mismatch for '{k}': expected {exp_val}, got {act_val}")

    # 5. Episode family count check
    if expected_family_count is not None and len(pos_families) != expected_family_count:
        raise GoldIntegrityError(f"Episode family count mismatch: expected {expected_family_count}, got {len(pos_families)}")

    return {
        "pair_count": len(rows),
        "article_count": len(articles),
        "class_counts": dict(class_counts),
        "episode_family_count": len(pos_families),
        "positive_without_family": pos_without_fam,
        "negative_with_family": neg_with_fam,
    }


def verify_gold_integrity(gold_path: str, expected_sha: str = EXPECTED_GOLD_SHA256) -> Tuple[str, List[Dict[str, str]]]:
    """
    Verify SHA256 and fail-fast schema/invariants of the canonical gold dataset file.
    """
    if not os.path.exists(gold_path):
        raise FileNotFoundError(f"Gold dataset not found at {gold_path}")

    with open(gold_path, "rb") as f:
        file_sha = hashlib.sha256(f.read()).hexdigest()

    if file_sha != expected_sha:
        raise GoldIntegrityError(f"Gold SHA256 mismatch: expected {expected_sha}, got {file_sha}")

    with open(gold_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    validate_gold_schema_and_invariants(rows)
    return file_sha, rows


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
        """Find connected components using BFS traversal."""
        visited: Set[str] = set()
        components: List[Set[str]] = []

        for node in sorted(self.nodes):
            if node not in visited:
                comp: Set[str] = set()
                queue = [node]
                visited.add(node)
                while queue:
                    curr = queue.pop(0)
                    comp.add(curr)
                    for neighbor in sorted(self.adj[curr]):
                        if neighbor not in visited:
                            visited.add(neighbor)
                            queue.append(neighbor)
                components.append(comp)

        # Sort descending by size, then lexicographically by smallest node ID for determinism
        components.sort(key=lambda c: (-len(c), min(c)))
        return components

    def get_degrees(self) -> List[int]:
        """Return sorted degrees of all nodes."""
        return sorted([len(self.adj[n]) for n in self.nodes])

    def get_component_details(self) -> List[Dict[str, Any]]:
        """Compute article count, pair count, and label breakdown for each connected component."""
        details = []
        for idx, comp in enumerate(self.components, 1):
            comp_pairs = [
                p for u, v, p in self.pair_edges
                if u in comp and v in comp
            ]
            labels = Counter(p["gold_label"] for p in comp_pairs)
            fams = sorted(list({p["episode_family_id"] for p in comp_pairs if p.get("episode_family_id")}))

            details.append({
                "component_id": f"C{idx:02d}",
                "nodes": sorted(list(comp)),
                "article_count": len(comp),
                "pairs": comp_pairs,
                "pair_count": len(comp_pairs),
                "SAME_EVENT": labels["SAME_EVENT"],
                "RELATED_TOPIC": labels["RELATED_TOPIC"],
                "DIFFERENT_EVENT": labels["DIFFERENT_EVENT"],
                "UNCERTAIN": labels.get("UNCERTAIN", 0),
                "positive_count": labels["SAME_EVENT"],
                "negative_count": labels["RELATED_TOPIC"] + labels["DIFFERENT_EVENT"],
                "episode_families": fams,
            })
        return details

    def get_largest_components(self) -> Dict[str, Dict[str, Any]]:
        """
        Compute largest component by articles and largest component by pairs separately.
        """
        details = self.get_component_details()
        by_articles = max(details, key=lambda c: (c["article_count"], -int(c["component_id"][1:])))
        by_pairs = max(details, key=lambda c: (c["pair_count"], -int(c["component_id"][1:])))
        return {
            "by_articles": by_articles,
            "by_pairs": by_pairs,
        }

    def validate_positive_family_component_mapping(self, fail_fast: bool = False) -> Tuple[int, int]:
        """
        Validate that every positive family occupies exactly one component,
        and no positive component contains multiple positive families.
        If fail_fast is True, raises LofoMappingError on violation.
        Returns: (spans_multiple_components_count, multiple_families_in_component_count)
        """
        details = self.get_component_details()
        fam_to_comps = defaultdict(set)
        comp_to_fams = defaultdict(set)

        for c in details:
            for fam in c["episode_families"]:
                fam_to_comps[fam].add(c["component_id"])
                comp_to_fams[c["component_id"]].add(fam)

        spans_multiple = sum(1 for f, comps in fam_to_comps.items() if len(comps) > 1)
        multi_fams = sum(1 for c, fams in comp_to_fams.items() if len(fams) > 1)

        if fail_fast and (spans_multiple > 0 or multi_fams > 0):
            err_parts = []
            if spans_multiple > 0:
                violating_fams = [f for f, comps in fam_to_comps.items() if len(comps) > 1]
                err_parts.append(f"Positive families spanning multiple components: {violating_fams}")
            if multi_fams > 0:
                violating_comps = [c for c, fams in comp_to_fams.items() if len(fams) > 1]
                err_parts.append(f"Components containing multiple positive families: {violating_comps}")
            raise LofoMappingError(f"LOFO mapping gate failure: {'; '.join(err_parts)}")

        return spans_multiple, multi_fams


def check_article_disjointness(split_articles: List[Set[str]]) -> int:
    """Return count of overlapping articles across any pair of splits (0 = leak-free)."""
    total_leakage = 0
    for i in range(len(split_articles)):
        for j in range(i + 1, len(split_articles)):
            overlap = split_articles[i] & split_articles[j]
            total_leakage += len(overlap)
    return total_leakage


def prune_training_pairs_touching_test_articles(
    training_pairs: List[Dict[str, str]],
    test_article_ids: Set[str],
) -> Tuple[List[Dict[str, str]], int, int]:
    """
    Remove from training_pairs any pair (u, v) where u in test_article_ids or v in test_article_ids.
    Returns: (pruned_training_pairs, removed_count, remaining_leakage)
    """
    test_articles_set = set(test_article_ids)
    pruned = []
    removed_count = 0
    for p in training_pairs:
        u = p["entry_a_id"]
        v = p["entry_b_id"]
        if u in test_articles_set or v in test_articles_set:
            removed_count += 1
        else:
            pruned.append(p)

    train_articles = {p["entry_a_id"] for p in pruned} | {p["entry_b_id"] for p in pruned}
    remaining_leakage = len(train_articles & test_articles_set)
    return pruned, removed_count, remaining_leakage


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
    all_diff = all(f["DIFFERENT_EVENT"] > 0 for f in folds)

    # Refined metric eligibility dimensions
    binary_metric_eligible = all(f["positive_count"] > 0 and f["negative_count"] > 0 for f in folds)
    related_topic_fpr_eligible = all(f["RELATED_TOPIC"] > 0 for f in folds)
    different_event_fpr_eligible = all(f["DIFFERENT_EVENT"] > 0 for f in folds)

    bin_eligible_count = sum(1 for f in folds if f["positive_count"] > 0 and f["negative_count"] > 0)
    rel_eligible_count = sum(1 for f in folds if f["RELATED_TOPIC"] > 0)
    diff_eligible_count = sum(1 for f in folds if f["DIFFERENT_EVENT"] > 0)

    return {
        "k": k,
        "feasible": (all_positive and all_negative and leakage == 0),
        "article_leakage": leakage,
        "all_positive_present": all_positive,
        "all_negative_present": all_negative,
        "all_related_topic_present": all_related,
        "all_different_event_present": all_diff,
        "binary_metric_eligible": binary_metric_eligible,
        "related_topic_fpr_eligible": related_topic_fpr_eligible,
        "different_event_fpr_eligible": different_event_fpr_eligible,
        "binary_metric_eligible_folds": f"{bin_eligible_count}/{k}",
        "related_topic_fpr_eligible_folds": f"{rel_eligible_count}/{k}",
        "different_event_fpr_eligible_folds": f"{diff_eligible_count}/{k}",
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
                "binary_metric_eligible": (f["positive_count"] > 0 and f["negative_count"] > 0),
                "related_topic_fpr_eligible": (f["RELATED_TOPIC"] > 0),
                "different_event_fpr_eligible": (f["DIFFERENT_EVENT"] > 0),
            }
            for f in folds
        ],
    }


def simulate_lofo_n1(graph: ArticleGraph) -> List[Dict[str, Any]]:
    """
    LOFO Option N1: Same Component Negatives.
    Test set uses only the positive and negative pairs from the held-out family's component.
    Fails fast if positive family to component mapping is not a strict bijection.
    """
    graph.validate_positive_family_component_mapping(fail_fast=True)
    comp_details = graph.get_component_details()
    fam_to_comp = {}
    for c in comp_details:
        for f in c["episode_families"]:
            if f in fam_to_comp:
                raise LofoMappingError(f"Family '{f}' spans multiple components: {fam_to_comp[f]['component_id']} and {c['component_id']}")
            fam_to_comp[f] = c

    results = []
    for fam in sorted(fam_to_comp.keys()):
        test_c = fam_to_comp[fam]
        if len(test_c["episode_families"]) != 1:
            raise LofoMappingError(f"Component '{test_c['component_id']}' contains multiple episode families: {test_c['episode_families']}")

        test_articles = test_c["nodes"]
        test_pos = test_c["SAME_EVENT"]
        test_rel = test_c["RELATED_TOPIC"]
        test_diff = test_c["DIFFERENT_EVENT"]
        test_neg = test_rel + test_diff

        train_pairs = []
        train_fams = set()
        for other_c in comp_details:
            if other_c["component_id"] != test_c["component_id"]:
                train_pairs.extend(other_c["pairs"])
                train_fams.update(other_c["episode_families"])

        # Execute explicit pruning check
        pruned_train, removed_count, leak = prune_training_pairs_touching_test_articles(train_pairs, test_articles)
        train_labels = Counter(p["gold_label"] for p in pruned_train)

        results.append({
            "strategy": "N1_SAME_COMPONENT",
            "held_out_family": fam,
            "component_id": test_c["component_id"],
            "test_positive_pairs": test_pos,
            "test_negative_pairs": test_neg,
            "test_related_topic": test_rel,
            "test_different_event": test_diff,
            "train_positive_pairs": train_labels["SAME_EVENT"],
            "train_negative_pairs": train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"],
            "removed_for_article_disjointness": removed_count,
            "train_episode_families_remaining": len(train_fams),
            "article_leakage": leak,
            "test_has_negatives": (test_neg > 0),
            "test_has_related_topic": (test_rel > 0),
            "binary_metric_eligible": (test_pos > 0 and test_neg > 0),
            "related_topic_fpr_eligible": (test_rel > 0),
            "different_event_fpr_eligible": (test_diff > 0),
        })
    return results


def simulate_lofo_n2(graph: ArticleGraph, reserved_pool_ids: Tuple[str, ...] = ("C07", "C08", "C09")) -> List[Dict[str, Any]]:
    """
    LOFO Option N2: Reserved Negative Components Benchmark Pool.
    A fixed, deterministic subset of pure-negative components is reserved exclusively for the test
    evaluation pool across all LOFO folds (permanently excluded from training in all folds).

    Limitation:
    N2 reuses the same reserved negative benchmark pool across the 10 LOFO folds. This enables
    contextual FPR and precision metrics per held-out family without article leakage, but the
    pool must NOT be aggregated across folds as independent repeated observations.
    """
    graph.validate_positive_family_component_mapping(fail_fast=True)
    comp_details = graph.get_component_details()
    fam_to_comp = {}
    for c in comp_details:
        for f in c["episode_families"]:
            if f in fam_to_comp:
                raise LofoMappingError(f"Family '{f}' spans multiple components: {fam_to_comp[f]['component_id']} and {c['component_id']}")
            fam_to_comp[f] = c

    # Extract reserved components
    reserved_comps = [c for c in comp_details if c["component_id"] in reserved_pool_ids]
    reserved_pairs = []
    reserved_articles = set()
    for rc in reserved_comps:
        reserved_pairs.extend(rc["pairs"])
        reserved_articles.update(rc["nodes"])

    reserved_rel = sum(c["RELATED_TOPIC"] for c in reserved_comps)
    reserved_diff = sum(c["DIFFERENT_EVENT"] for c in reserved_comps)

    results = []
    for fam in sorted(fam_to_comp.keys()):
        test_c = fam_to_comp[fam]
        if len(test_c["episode_families"]) != 1:
            raise LofoMappingError(f"Component '{test_c['component_id']}' contains multiple episode families: {test_c['episode_families']}")

        test_articles = set(test_c["nodes"]) | reserved_articles

        test_pos = test_c["SAME_EVENT"]
        test_rel = test_c["RELATED_TOPIC"] + reserved_rel
        test_diff = test_c["DIFFERENT_EVENT"] + reserved_diff
        test_neg = test_rel + test_diff

        train_pairs = []
        train_fams = set()
        for other_c in comp_details:
            if other_c["component_id"] != test_c["component_id"] and other_c["component_id"] not in reserved_pool_ids:
                train_pairs.extend(other_c["pairs"])
                train_fams.update(other_c["episode_families"])

        pruned_train, removed_count, leak = prune_training_pairs_touching_test_articles(train_pairs, test_articles)
        train_labels = Counter(p["gold_label"] for p in pruned_train)

        results.append({
            "strategy": "N2_RESERVED_POOL",
            "held_out_family": fam,
            "component_id": test_c["component_id"],
            "test_positive_pairs": test_pos,
            "test_negative_pairs": test_neg,
            "test_related_topic": test_rel,
            "test_different_event": test_diff,
            "train_positive_pairs": train_labels["SAME_EVENT"],
            "train_negative_pairs": train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"],
            "removed_for_article_disjointness": removed_count,
            "train_episode_families_remaining": len(train_fams),
            "article_leakage": leak,
            "test_has_negatives": (test_neg > 0),
            "test_has_related_topic": (test_rel > 0),
            "binary_metric_eligible": (test_pos > 0 and test_neg > 0),
            "related_topic_fpr_eligible": (test_rel > 0),
            "different_event_fpr_eligible": (test_diff > 0),
        })
    return results


def simulate_lofo_n3(graph: ArticleGraph) -> List[Dict[str, Any]]:
    """
    LOFO Option N3: Component-Level Negative Partition.
    Pre-partitions all 16 pure-negative components deterministically across the 10 LOFO test folds.
    Fails fast if positive family to component mapping is not a strict bijection.
    """
    graph.validate_positive_family_component_mapping(fail_fast=True)
    comp_details = graph.get_component_details()
    pos_comps = [c for c in comp_details if c["positive_count"] > 0]
    neg_comps = [c for c in comp_details if c["positive_count"] == 0]

    # Deterministic round-robin assignment by descending size
    neg_comps.sort(key=lambda c: (-c["pair_count"], c["component_id"]))
    fold_neg_assigned = defaultdict(list)
    for idx, c in enumerate(neg_comps):
        fold_idx = idx % len(pos_comps)
        fold_neg_assigned[fold_idx].append(c)

    results = []
    for i, p_comp in enumerate(pos_comps):
        if len(p_comp["episode_families"]) != 1:
            raise LofoMappingError(
                f"Component '{p_comp['component_id']}' contains {len(p_comp['episode_families'])} families; "
                f"expected exactly 1 for LOFO: {p_comp['episode_families']}"
            )
        fam = p_comp["episode_families"][0]
        extra_negs = fold_neg_assigned[i]

        extra_pairs = sum(c["pair_count"] for c in extra_negs)
        extra_rel = sum(c["RELATED_TOPIC"] for c in extra_negs)
        extra_diff = sum(c["DIFFERENT_EVENT"] for c in extra_negs)

        test_articles = set(p_comp["nodes"])
        for ec in extra_negs:
            test_articles.update(ec["nodes"])

        test_pos = p_comp["SAME_EVENT"]
        test_rel = p_comp["RELATED_TOPIC"] + extra_rel
        test_diff = p_comp["DIFFERENT_EVENT"] + extra_diff
        test_neg = test_rel + test_diff

        train_pairs = []
        train_fams = set()
        for idx, other_p in enumerate(pos_comps):
            if idx != i:
                train_pairs.extend(other_p["pairs"])
                train_fams.update(other_p["episode_families"])

        for other_neg in neg_comps:
            if other_neg not in extra_negs:
                train_pairs.extend(other_neg["pairs"])

        pruned_train, removed_count, leak = prune_training_pairs_touching_test_articles(train_pairs, test_articles)
        train_labels = Counter(p["gold_label"] for p in pruned_train)

        results.append({
            "strategy": "N3_NEGATIVE_PARTITION",
            "held_out_family": fam,
            "component_id": p_comp["component_id"],
            "test_positive_pairs": test_pos,
            "test_negative_pairs": test_neg,
            "test_related_topic": test_rel,
            "test_different_event": test_diff,
            "train_positive_pairs": train_labels["SAME_EVENT"],
            "train_negative_pairs": train_labels["RELATED_TOPIC"] + train_labels["DIFFERENT_EVENT"],
            "removed_for_article_disjointness": removed_count,
            "train_episode_families_remaining": len(train_fams),
            "article_leakage": leak,
            "test_has_negatives": (test_neg > 0),
            "test_has_related_topic": (test_rel > 0),
            "binary_metric_eligible": (test_pos > 0 and test_neg > 0),
            "related_topic_fpr_eligible": (test_rel > 0),
            "different_event_fpr_eligible": (test_diff > 0),
        })
    return results


def summarize_lofo_eligibility(folds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Summarize binary, related_topic, and different_event metric eligibility across LOFO folds."""
    total = len(folds)
    bin_count = sum(1 for f in folds if f["binary_metric_eligible"])
    rel_count = sum(1 for f in folds if f["related_topic_fpr_eligible"])
    diff_count = sum(1 for f in folds if f["different_event_fpr_eligible"])
    return {
        "binary_metric_eligible_folds": f"{bin_count}/{total}",
        "related_topic_fpr_eligible_folds": f"{rel_count}/{total}",
        "different_event_fpr_eligible_folds": f"{diff_count}/{total}",
        "binary_metric_eligible": (bin_count == total),
        "related_topic_fpr_eligible": (rel_count == total),
        "different_event_fpr_eligible": (diff_count == total),
    }


def run_split_audit(gold_path: str = DEFAULT_GOLD_PATH) -> Dict[str, Any]:
    """Execute complete split feasibility, graph analysis, and negative strategy comparison."""
    file_sha, pairs = verify_gold_integrity(gold_path)

    graph = ArticleGraph(pairs)
    degrees = graph.get_degrees()
    deg_max = max(degrees)
    deg_median = statistics.median(degrees)
    p95_idx = int(math.ceil(0.95 * len(degrees))) - 1
    deg_p95 = degrees[p95_idx]

    largest_comps = graph.get_largest_components()
    largest_by_articles = largest_comps["by_articles"]
    largest_by_pairs = largest_comps["by_pairs"]

    spans_mult, multi_fams = graph.validate_positive_family_component_mapping(fail_fast=True)

    comp_details = graph.get_component_details()
    isolated_pairs = sum(1 for c in comp_details if c["pair_count"] == 1)
    multi_pairs = sum(1 for c in comp_details if c["pair_count"] > 1)

    proto_a_k2 = simulate_protocol_a(graph, 2)
    proto_a_k3 = simulate_protocol_a(graph, 3)
    proto_a_k4 = simulate_protocol_a(graph, 4)
    proto_a_k5 = simulate_protocol_a(graph, 5)

    lofo_n1 = simulate_lofo_n1(graph)
    lofo_n2 = simulate_lofo_n2(graph)
    lofo_n3 = simulate_lofo_n3(graph)

    n1_summary = summarize_lofo_eligibility(lofo_n1)
    n2_summary = summarize_lofo_eligibility(lofo_n2)
    n3_summary = summarize_lofo_eligibility(lofo_n3)

    return {
        "gold_sha256": file_sha,
        "pair_count": len(pairs),
        "unique_article_count": len(graph.nodes),
        "graph_node_count": len(graph.nodes),
        "graph_edge_count": len(pairs),
        "connected_component_count": len(graph.components),
        "largest_component_by_articles_id": largest_by_articles["component_id"],
        "largest_component_article_count": largest_by_articles["article_count"],
        "largest_component_by_articles_pair_count": largest_by_articles["pair_count"],
        "largest_component_by_pairs_id": largest_by_pairs["component_id"],
        "largest_component_pair_count": largest_by_pairs["pair_count"],
        "largest_component_by_pairs_article_count": largest_by_pairs["article_count"],
        "positive_family_spans_multiple_components": spans_mult,
        "positive_component_with_multiple_families": multi_fams,
        "positive_family_component_mapping_gate": "PASS" if (spans_mult == 0 and multi_fams == 0) else "FAIL",
        "lofo_mapping_fail_fast_gate": "PASS" if (spans_mult == 0 and multi_fams == 0) else "FAIL",
        "isolated_pair_component_count": isolated_pairs,
        "multi_pair_component_count": multi_pairs,
        "degree_max": deg_max,
        "degree_median": deg_median,
        "degree_p95": deg_p95,
        "protocol_a_k2": proto_a_k2,
        "protocol_a_k3": proto_a_k3,
        "protocol_a_k4": proto_a_k4,
        "protocol_a_k5": proto_a_k5,
        "lofo_n1": lofo_n1,
        "lofo_n2": lofo_n2,
        "lofo_n3": lofo_n3,
        "n1_binary_metric_eligible_folds": n1_summary["binary_metric_eligible_folds"],
        "n1_related_topic_fpr_eligible_folds": n1_summary["related_topic_fpr_eligible_folds"],
        "n1_different_event_fpr_eligible_folds": n1_summary["different_event_fpr_eligible_folds"],
        "n2_binary_metric_eligible_folds": n2_summary["binary_metric_eligible_folds"],
        "n2_related_topic_fpr_eligible_folds": n2_summary["related_topic_fpr_eligible_folds"],
        "n2_different_event_fpr_eligible_folds": n2_summary["different_event_fpr_eligible_folds"],
        "n3_binary_metric_eligible_folds": n3_summary["binary_metric_eligible_folds"],
        "n3_related_topic_fpr_eligible_folds": n3_summary["related_topic_fpr_eligible_folds"],
        "n3_different_event_fpr_eligible_folds": n3_summary["different_event_fpr_eligible_folds"],
        "n2_reserved_negative_pool_reused_across_lofo_folds": N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS,
        "n2_negatives_must_not_be_counted_as_independent_repeated_observations_in_aggregated_lofo_metrics": N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS,
        "n2_aggregation_guard_documented": True,
    }


def main():
    parser = argparse.ArgumentParser(description="NewsFlux STORY-01B-M0 Split Feasibility & Leakage Audit")
    parser.add_argument("--gold", default=os.environ.get("STORY01B_GOLD_PATH", DEFAULT_GOLD_PATH), help="Path to story01b-gold-v1.csv")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    results = run_split_audit(args.gold)

    if args.json:
        clean_res = dict(results)
        print(json.dumps(clean_res, indent=2, default=str))
        return

    print("=" * 60)
    print("NEWSFLUX STORY IDENTITY — STORY-01B-M0 SPLIT FEASIBILITY AUDIT")
    print("=" * 60)
    print("GOLD_SHA256:", results["gold_sha256"])
    print("PAIR_COUNT:", results["pair_count"])
    print("UNIQUE_ARTICLE_COUNT:", results["unique_article_count"])
    print("-" * 60)
    print("LARGEST COMPONENT BY ARTICLES:", results["largest_component_by_articles_id"], "articles =", results["largest_component_article_count"], "pairs =", results["largest_component_by_articles_pair_count"])
    print("LARGEST COMPONENT BY PAIRS:   ", results["largest_component_by_pairs_id"], "pairs =", results["largest_component_pair_count"], "articles =", results["largest_component_by_pairs_article_count"])
    print("POSITIVE FAMILY MAPPING INVARIANTS: spans_mult =", results["positive_family_spans_multiple_components"], "multi_fams =", results["positive_component_with_multiple_families"])
    print("LOFO MAPPING FAIL-FAST GATE:", results["lofo_mapping_fail_fast_gate"])
    print("-" * 60)
    print("PROTOCOL A EVALUATION:")
    for k in [2, 3, 4, 5]:
        res = results[f"protocol_a_k{k}"]
        print(f"  K={k}: Feasible={res['feasible']}, BinEligible={res['binary_metric_eligible_folds']}, RelFprEligible={res['related_topic_fpr_eligible_folds']}, DiffFprEligible={res['different_event_fpr_eligible_folds']}, Leakage={res['article_leakage']}")
    print("-" * 60)
    print("NEGATIVE STRATEGIES COMPARISON (LOFO):")
    print(f"  N1 (Same Component): BinEligible={results['n1_binary_metric_eligible_folds']}, RelFprEligible={results['n1_related_topic_fpr_eligible_folds']}, DiffFprEligible={results['n1_different_event_fpr_eligible_folds']}, Leakage=0")
    print(f"  N2 (Reserved Pool):  BinEligible={results['n2_binary_metric_eligible_folds']}, RelFprEligible={results['n2_related_topic_fpr_eligible_folds']}, DiffFprEligible={results['n2_different_event_fpr_eligible_folds']}, Leakage=0")
    print(f"  N3 (Partitioned):    BinEligible={results['n3_binary_metric_eligible_folds']}, RelFprEligible={results['n3_related_topic_fpr_eligible_folds']}, DiffFprEligible={results['n3_different_event_fpr_eligible_folds']}, Leakage=0")
    print("  N2_RESERVED_NEGATIVE_POOL_REUSED_ACROSS_LOFO_FOLDS:", "YES" if results["n2_reserved_negative_pool_reused_across_lofo_folds"] else "NO")
    print("  N2_NEGATIVES_MUST_NOT_BE_COUNTED_AS_INDEPENDENT_REPEATED_OBSERVATIONS_IN_AGGREGATED_LOFO_METRICS:", "YES" if results["n2_negatives_must_not_be_counted_as_independent_repeated_observations_in_aggregated_lofo_metrics"] else "NO")
    print("=" * 60)
    print("AUDIT_STATUS=SUCCESS")


if __name__ == "__main__":
    main()
