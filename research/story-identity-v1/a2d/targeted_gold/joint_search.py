"""Deterministic, bounded joint search over label-blind candidate metadata."""

from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from typing import Any

from sampler import (
    PRIMARY_BUCKETS, SEED, _graph_components, _source_pair, _stable_order,
    add_feature_buckets, canonical_pair_key, classify_candidate, compute_feature_thresholds,
    filter_gold_pairs, graph_component_stats,
)


@dataclass(frozen=True)
class SearchRules:
    min_components: int = 8
    min_independent_pairs: int = 8
    min_multi_pair_components: int = 6
    min_chain_groups: int = 6
    max_component_pairs: int = 8
    max_component_articles: int = 8
    max_feed_share: float = 0.20
    max_source_pair_share: float = 0.10
    max_category_share: float = 0.50
    chain_rank_ceiling: int = 1250


def _articles(row: dict[str, Any]) -> set[int]:
    return {int(row["article_a_id"]), int(row["article_b_id"])}


def prepare_search_candidates(
    candidates: list[dict[str, Any]], *, gold_pair_keys: set[str], gold_article_ids: set[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    materialized = [
        row for row in filter_gold_pairs(candidates, gold_pair_keys)
        if float(row.get("temporal_delta_hours", 0.0)) <= 24.0
    ]
    thresholds = compute_feature_thresholds(materialized)
    classified = []
    for row in materialized:
        descriptors = classify_candidate(row, thresholds)
        if row.get("primary_bucket") in PRIMARY_BUCKETS:
            descriptors["primary_bucket"] = row["primary_bucket"]
        classified.append({**row, **descriptors})
    add_feature_buckets(classified, thresholds)
    blind = [row for row in classified if not (_articles(row) & gold_article_ids)]
    return blind, classified


def candidate_inventory(
    blind: list[dict[str, Any]], quotas: dict[str, int], *, chain_rank_ceiling: int = 1250,
) -> dict[str, Any]:
    buckets = {}
    for bucket, quota in quotas.items():
        rows = [row for row in blind if row["primary_bucket"] == bucket]
        buckets[bucket] = {
            "pair_count": len(rows),
            "unique_article_count": len({article for row in rows for article in _articles(row)}),
            "unique_feed_count": len({str(value) for row in rows for value in (row["feed_a_id"], row["feed_b_id"])}),
            "unique_source_pair_count": len({_source_pair(row) for row in rows}),
            "quota": quota,
        }
    incident: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in blind:
        if int(row.get("best_rank", 0)) <= chain_rank_ceiling:
            for article in _articles(row):
                incident[article].append(row)
    histogram = Counter()
    for edges in incident.values():
        for first, second in combinations(edges, 2):
            if len(_articles(first) | _articles(second)) == 3:
                histogram[" + ".join(sorted((first["primary_bucket"], second["primary_bucket"])))] += 1
    return {
        "blind_pool_pair_count": len(blind),
        "bucket_capacity": buckets,
        "chain_candidate_count": sum(histogram.values()),
        "chain_bucket_composition_histogram": dict(sorted(histogram.items())),
        "independent_edge_candidate_count": len(blind),
        "independent_edge_bucket_counts": dict(Counter(row["primary_bucket"] for row in blind)),
        "independent_edge_definition": "EACH_EDGE_CAN_BE_A_SINGLETON_BEFORE_OTHER_SELECTIONS",
        "raw_bucket_capacity_gate": "PASS" if all(item["pair_count"] >= item["quota"] for item in buckets.values()) else "FAIL",
    }


def _chain_groups(rows: list[dict[str, Any]], rules: SearchRules, seed: int) -> tuple[list[dict], int]:
    """Choose at most one qualifying chain from each final connected component."""
    components = _graph_components(rows)
    group_candidates = []
    total_paths = 0
    for component in components:
        eligible = [
            row for row in rows
            if row["pair_key"] in component["pair_keys"]
            and int(row.get("best_rank", 0)) <= rules.chain_rank_ceiling
        ]
        incident: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in eligible:
            for article in _articles(row):
                incident[article].append(row)
        paths = []
        for edges in incident.values():
            for first, second in combinations(edges, 2):
                vertices = _articles(first) | _articles(second)
                if len(vertices) != 3:
                    continue
                pair_keys = sorted((first["pair_key"], second["pair_key"]))
                digest = hashlib.sha256(f"{seed}:CHAIN:{':'.join(pair_keys)}".encode()).hexdigest()
                paths.append((digest, pair_keys, sorted(vertices)))
        total_paths += len(paths)
        if paths:
            _, pair_keys, vertices = min(paths)
            group_candidates.append({"article_ids": vertices, "pair_keys": pair_keys, "structure_type": "CHAIN"})
    group_candidates.sort(key=lambda group: hashlib.sha256(
        f"{seed}:GROUP:{':'.join(group['pair_keys'])}".encode()
    ).digest())
    return group_candidates[:rules.min_chain_groups], total_paths


def _category_ok(rows: list[dict[str, Any]], maximum: float) -> bool:
    article_categories: dict[int, str] = {}
    for row in rows:
        for side in ("a", "b"):
            article_categories[int(row[f"article_{side}_id"])] = str(row.get(f"category_{side}", ""))
    counts = Counter(article_categories.values())
    return not counts or max(counts.values()) / len(article_categories) <= maximum


def search_joint_packs(
    blind_candidates: list[dict[str, Any]], dev_candidates: list[dict[str, Any]], *,
    blind_quotas: dict[str, int], dev_quotas: dict[str, int],
    rules: SearchRules = SearchRules(), seed: int = SEED, node_limit: int = 10000,
    gold_pair_keys: set[str] | None = None, gold_article_ids: set[int] | None = None,
) -> dict[str, Any]:
    """Enumerate combinations jointly; a bound is never reported as infeasibility."""
    if node_limit < 1:
        raise ValueError("SEARCH_NODE_LIMIT_MUST_BE_POSITIVE")
    excluded_pairs = {canonical_pair_key(*key.split(":")) for key in (gold_pair_keys or set())}
    excluded_articles = {int(value) for value in (gold_article_ids or set())}

    def eligible(rows, *, blind):
        seen = set()
        retained = []
        for row in rows:
            key = canonical_pair_key(row["article_a_id"], row["article_b_id"])
            if key != row["pair_key"]:
                raise ValueError("NONCANONICAL_PAIR_KEY")
            if key in seen or key in excluded_pairs or (blind and _articles(row) & excluded_articles):
                continue
            seen.add(key)
            retained.append(row)
        return retained

    blind_candidates = eligible(blind_candidates, blind=True)
    dev_candidates = eligible(dev_candidates, blind=False)
    blind_buckets = {
        bucket: _stable_order((row for row in blind_candidates if row["primary_bucket"] == bucket), seed, "JOINT_BLIND")
        for bucket in blind_quotas
    }
    dev_buckets = {
        bucket: _stable_order((row for row in dev_candidates if row["primary_bucket"] == bucket), seed, "JOINT_DEV")
        for bucket in dev_quotas
    }
    certificate = {key: 0 for key in (
        "nodes_explored", "prune_bucket_capacity", "prune_component_limit",
        "prune_chain_bridge", "prune_source_cap", "prune_dev_infeasible", "prune_other",
        "max_blind_pairs", "max_dev_pairs", "blind_complete_candidates", "feasible_witnesses",
    )}
    limited = False
    best = None
    best_score = None

    def visit() -> bool:
        nonlocal limited
        if certificate["nodes_explored"] >= node_limit:
            limited = True
            return False
        certificate["nodes_explored"] += 1
        return True

    def options_for(buckets, starts, deficits):
        available = {bucket: len(buckets[bucket]) - starts[bucket] for bucket in deficits}
        for bucket, deficit in deficits.items():
            if available[bucket] < deficit:
                certificate["prune_bucket_capacity"] += 1
                return None
        return min(deficits, key=lambda bucket: (available[bucket] / deficits[bucket], bucket))

    def source_state(selected):
        return (
            Counter(str(v) for item in selected for v in (item["feed_a_id"], item["feed_b_id"])),
            Counter(_source_pair(item) for item in selected),
        )

    def source_fits(row, feeds, pairs, target):
        additions = Counter(str(value) for value in (row["feed_a_id"], row["feed_b_id"]))
        return (
            all(feeds[feed] + count <= int(2 * target * rules.max_feed_share) for feed, count in additions.items())
            and pairs[_source_pair(row)] + 1 <= int(target * rules.max_source_pair_share)
        )

    def component_state(selected):
        components = _graph_components(selected)
        return {article: component for component in components for article in component["article_ids"]}

    def component_fits(row, lookup):
        a, b = tuple(_articles(row))
        first, second = lookup.get(a), lookup.get(b)
        if first is not None and first is second:
            pairs = len(first["pair_keys"]) + 1
            articles = len(first["article_ids"])
        else:
            parts = [part for part in (first, second) if part is not None]
            pairs = 1 + sum(len(part["pair_keys"]) for part in parts)
            articles = len({a, b}.union(*(part["article_ids"] for part in parts)))
        return pairs <= rules.max_component_pairs and articles <= rules.max_component_articles

    def record_solution(blind, dev, groups):
        nonlocal best, best_score
        certificate["feasible_witnesses"] += 1
        rows = blind + dev
        feeds = {str(value) for row in rows for value in (row["feed_a_id"], row["feed_b_id"])}
        articles = {article for row in rows for article in _articles(row)}
        keys = "|".join(sorted("B:" + row["pair_key"] for row in blind) + sorted("D:" + row["pair_key"] for row in dev))
        tie = int.from_bytes(hashlib.sha256(f"{seed}:SOLUTION:{keys}".encode()).digest(), "big")
        score = (len(feeds), len(articles), -tie)
        if best_score is None or score > best_score:
            best_score = score
            best = {"blind": list(blind), "dev": list(dev), "chain_groups": groups}

    def dev_search(blind, groups):
        blocked = {article for row in blind for article in _articles(row)}
        eligible = {
            bucket: [row for row in rows if not (_articles(row) & blocked)]
            for bucket, rows in dev_buckets.items()
        }
        target = sum(dev_quotas.values())
        found = False

        def recurse(selected, starts, counts):
            nonlocal found
            if not visit():
                return
            certificate["max_dev_pairs"] = max(certificate["max_dev_pairs"], len(selected))
            deficits = {bucket: count - counts[bucket] for bucket, count in dev_quotas.items() if count > counts[bucket]}
            if not deficits:
                if not _category_ok(selected, rules.max_category_share):
                    certificate["prune_other"] += 1
                    return
                found = True
                record_solution(blind, selected, groups)
                return
            bucket = options_for(eligible, starts, deficits)
            if bucket is None:
                return
            feeds, pairs = source_state(selected)
            for index in range(starts[bucket], len(eligible[bucket])):
                if limited:
                    return
                row = eligible[bucket][index]
                if not source_fits(row, feeds, pairs, target):
                    certificate["prune_source_cap"] += 1
                    continue
                next_starts = {**starts, bucket: index + 1}
                next_counts = counts.copy()
                next_counts[bucket] += 1
                recurse(selected + [row], next_starts, next_counts)

        recurse([], {bucket: 0 for bucket in dev_quotas}, Counter())
        if not found and not limited:
            certificate["prune_dev_infeasible"] += 1

    blind_target = sum(blind_quotas.values())

    def blind_search(selected, starts, counts):
        if not visit():
            return
        certificate["max_blind_pairs"] = max(certificate["max_blind_pairs"], len(selected))
        deficits = {bucket: count - counts[bucket] for bucket, count in blind_quotas.items() if count > counts[bucket]}
        stats = graph_component_stats(selected)
        remaining = sum(deficits.values())
        if (
            stats["connected_component_count"] + remaining < rules.min_components
            or stats["independent_pair_count"] + remaining < rules.min_independent_pairs
            or stats["multi_pair_component_count"] + remaining < rules.min_multi_pair_components
        ):
            certificate["prune_other"] += 1
            return
        if not deficits:
            certificate["blind_complete_candidates"] += 1
            if (
                stats["connected_component_count"] < rules.min_components
                or stats["independent_pair_count"] < rules.min_independent_pairs
                or stats["multi_pair_component_count"] < rules.min_multi_pair_components
                or not _category_ok(selected, rules.max_category_share)
            ):
                certificate["prune_other"] += 1
                return
            groups, total_paths = _chain_groups(selected, rules, seed)
            if len(groups) < rules.min_chain_groups:
                certificate["prune_chain_bridge" if total_paths >= rules.min_chain_groups else "prune_other"] += 1
                return
            dev_search(selected, groups)
            return
        bucket = options_for(blind_buckets, starts, deficits)
        if bucket is None:
            return
        selected_articles = {article for row in selected for article in _articles(row)}
        selected_feeds = {str(v) for row in selected for v in (row["feed_a_id"], row["feed_b_id"])}
        unseen_available = {
            article
            for name in deficits
            for row in blind_buckets[name][starts[name]:]
            for article in _articles(row)
            if article not in selected_articles
        }
        if stats["independent_pair_count"] + min(remaining, len(unseen_available) // 2) < rules.min_independent_pairs:
            certificate["prune_other"] += 1
            return
        feeds, pairs = source_state(selected)
        components = component_state(selected)
        choices = list(range(starts[bucket], len(blind_buckets[bucket])))
        choices.sort(key=lambda index: (
            -len({str(blind_buckets[bucket][index]["feed_a_id"]), str(blind_buckets[bucket][index]["feed_b_id"])} - selected_feeds),
            -len(_articles(blind_buckets[bucket][index]) - selected_articles), index,
        ))
        for index in choices:
            if limited:
                return
            row = blind_buckets[bucket][index]
            if not source_fits(row, feeds, pairs, blind_target):
                certificate["prune_source_cap"] += 1
                continue
            if not component_fits(row, components):
                certificate["prune_component_limit"] += 1
                continue
            next_starts = {**starts, bucket: index + 1}
            next_counts = counts.copy()
            next_counts[bucket] += 1
            blind_search(selected + [row], next_starts, next_counts)

    blind_search([], {bucket: 0 for bucket in blind_quotas}, Counter())
    certificate["nodes_pruned"] = sum(value for key, value in certificate.items() if key.startswith("prune_"))
    complete = not limited
    status = "SEARCH_LIMIT_REACHED" if limited else "FEASIBLE" if best else "PROVEN_INFEASIBLE"
    return {
        "status": status, "search_complete": complete, "certificate": certificate,
        "node_limit": node_limit, "objective": best_score[:2] if best_score else None,
        "objective_optimality": "PROVEN" if complete and best else "NOT_PROVEN",
        "blind": best["blind"] if best else [], "dev": best["dev"] if best else [],
        "chain_groups": best["chain_groups"] if best else [],
        "feasible_witness_found": best is not None,
    }
