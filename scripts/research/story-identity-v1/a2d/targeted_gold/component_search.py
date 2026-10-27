"""Bounded component-first witness search and an independent hard-gate validator."""

from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from itertools import combinations
from typing import Any

from joint_search import SearchRules
from sampler import BLIND_QUOTAS, DEV_QUOTAS, SEED, canonical_pair_key


def _hash(value: str, seed: int = SEED) -> str:
    return hashlib.sha256(f"{seed}:COMPONENT:{value}".encode()).hexdigest()


def _ids(row: dict[str, Any]) -> frozenset[int]:
    return frozenset((int(row["article_a_id"]), int(row["article_b_id"])))


def _source_pair(row: dict[str, Any]) -> tuple[str, str]:
    return tuple(sorted((str(row["feed_a_id"]), str(row["feed_b_id"]))))


def _motif(rows: list[dict], kind: str, chain_keys: tuple[str, ...] = ()) -> dict:
    articles = frozenset(article for row in rows for article in _ids(row))
    categories = {}
    for row in rows:
        for side in ("a", "b"):
            article = int(row[f"article_{side}_id"])
            category = str(row.get(f"category_{side}", ""))
            if article in categories and categories[article] != category:
                raise ValueError("INCONSISTENT_ARTICLE_CATEGORY")
            categories[article] = category
    keys = tuple(sorted(row["pair_key"] for row in rows))
    return {
        "kind": kind, "rows": tuple(rows), "pair_keys": keys, "article_ids": articles,
        "bucket_counts": dict(Counter(row["primary_bucket"] for row in rows)),
        "feed_counts": dict(Counter(str(v) for row in rows for v in (row["feed_a_id"], row["feed_b_id"]))),
        "source_pair_counts": dict(Counter(_source_pair(row) for row in rows)),
        "category_counts": dict(Counter(categories.values())), "chain_keys": chain_keys,
    }


def generate_motifs(
    rows: list[dict], quotas: dict[str, int], *, seed: int = SEED, variants: int = 4,
    max_pairs: int = 8, max_articles: int = 8, rank_ceiling: int = 1250,
) -> tuple[list[dict], dict]:
    """Generate bounded connected expansions from every eligible two-edge chain."""
    ordered = sorted(rows, key=lambda row: _hash(row["pair_key"], seed))
    singleton = [_motif([row], "SINGLETON") for row in ordered if quotas.get(row["primary_bucket"], 0)]
    incident: dict[int, list[dict]] = defaultdict(list)
    for row in ordered:
        if int(row.get("best_rank", 0)) <= rank_ceiling:
            for article in _ids(row):
                incident[article].append(row)
    seeds = {}
    for edges in incident.values():
        for first, second in combinations(edges, 2):
            if len(_ids(first) | _ids(second)) != 3:
                continue
            keys = tuple(sorted((first["pair_key"], second["pair_key"])))
            seeds[keys] = (first, second)
    buckets = list(quotas)
    capacities = Counter(row["primary_bucket"] for row in ordered)
    bucket_order = sorted(buckets, key=lambda b: (capacities[b] / max(quotas[b], 1), b))
    unique = {}
    max_per_seed = 0
    for keys, seed_rows in sorted(seeds.items(), key=lambda item: _hash(":".join(item[0]), seed)):
        produced = set()
        for variant in range(variants):
            selected = list(seed_rows)
            for _ in range(max_pairs - 1):
                counts = Counter(row["primary_bucket"] for row in selected)
                if all(counts[b] <= quotas.get(b, 0) for b in counts):
                    item = _motif(selected, "CHAIN_COMPONENT", keys)
                    unique.setdefault(item["pair_keys"], item)
                    produced.add(item["pair_keys"])
                articles = frozenset(article for row in selected for article in _ids(row))
                used = {row["pair_key"] for row in selected}
                options = [row for row in ordered if row["pair_key"] not in used
                           and _ids(row) & articles and len(articles | _ids(row)) <= max_articles
                           and counts[row["primary_bucket"]] < quotas.get(row["primary_bucket"], 0)]
                if not options or len(selected) >= max_pairs:
                    break
                rotated = bucket_order[variant % len(bucket_order):] + bucket_order[:variant % len(bucket_order)]
                rank = {bucket: index for index, bucket in enumerate(rotated)}
                selected.append(min(options, key=lambda row: (
                    rank[row["primary_bucket"]], _hash(f"{keys}:{variant}:{row['pair_key']}", seed),
                )))
        max_per_seed = max(max_per_seed, len(produced))
    # Remove only exact resource-equivalent motifs: this cannot discard a better source-cap fit.
    kept = {}
    dominated = 0
    for item in sorted(unique.values(), key=lambda m: _hash(":".join(m["pair_keys"]), seed)):
        signature = (item["article_ids"], tuple(sorted(item["bucket_counts"].items())),
                     tuple(sorted(item["feed_counts"].items())), tuple(sorted(item["source_pair_counts"].items())))
        if signature in kept:
            dominated += 1
        else:
            kept[signature] = item
    chains = list(kept.values())
    motifs = singleton + chains
    inventory = {
        "singleton_motif_count": len(singleton), "chain_seed_count": len(seeds),
        "chain_component_motif_count": len(chains),
        "motif_bucket_vector_count": len({tuple(sorted(item["bucket_counts"].items())) for item in motifs}),
        "max_motifs_per_chain_seed": max_per_seed, "dominated_motifs_removed": dominated,
        "variants_per_chain_seed": variants,
    }
    return motifs, inventory


def dev_forward_capacity(dev: list[dict], blocked: set[int] | frozenset[int], quotas: dict[str, int]) -> dict:
    counts, articles = Counter(), defaultdict(set)
    for row in dev:
        if _ids(row) & blocked:
            continue
        bucket = row["primary_bucket"]
        if bucket in quotas:
            counts[bucket] += 1
            articles[bucket].update(_ids(row))
    return {
        "feasible": all(counts[b] >= quota and (quota == 0 or len(articles[b]) >= 2) for b, quota in quotas.items()),
        "pair_counts": dict(counts), "unique_article_counts": {b: len(articles[b]) for b in quotas},
    }


def validate_witness(
    blind: list[dict], dev: list[dict], *, blind_quotas: dict[str, int] = BLIND_QUOTAS,
    dev_quotas: dict[str, int] = DEV_QUOTAS, rules: SearchRules = SearchRules(),
    gold_pair_keys: set[str] | None = None, gold_article_ids: set[int] | None = None,
) -> dict:
    """Recompute graph, quotas, isolation and diversity without motif/search metadata."""
    gold_pairs = {canonical_pair_key(*key.split(":")) for key in (gold_pair_keys or set())}
    gold_articles = set(gold_article_ids or set())
    if Counter(row["primary_bucket"] for row in blind) != Counter(blind_quotas):
        raise ValueError("BLIND_QUOTA_GATE=FAIL")
    if Counter(row["primary_bucket"] for row in dev) != Counter(dev_quotas):
        raise ValueError("DEV_QUOTA_GATE=FAIL")
    keys, vertices = [], []
    for rows in (blind, dev):
        pair_keys = [canonical_pair_key(row["article_a_id"], row["article_b_id"]) for row in rows]
        if any(key != row["pair_key"] for key, row in zip(pair_keys, rows)) or len(set(pair_keys)) != len(pair_keys):
            raise ValueError("PAIR_IDENTITY_GATE=FAIL")
        keys.append(set(pair_keys)); vertices.append(set(article for row in rows for article in _ids(row)))
    if keys[0] & keys[1] or keys[0] & gold_pairs or keys[1] & gold_pairs:
        raise ValueError("PAIR_DISJOINT_GATE=FAIL")
    if vertices[0] & vertices[1] or vertices[0] & gold_articles:
        raise ValueError("ARTICLE_DISJOINT_GATE=FAIL")

    def diversity(rows):
        if not rows:
            return {"max_feed_share": 0.0, "max_source_pair_share": 0.0, "max_category_share": 0.0}
        feed = Counter(str(v) for row in rows for v in (row["feed_a_id"], row["feed_b_id"]))
        source = Counter(_source_pair(row) for row in rows)
        categories = {}
        for row in rows:
            for side in ("a", "b"):
                article, category = int(row[f"article_{side}_id"]), str(row.get(f"category_{side}", ""))
                if article in categories and categories[article] != category:
                    raise ValueError("CATEGORY_CONSISTENCY_GATE=FAIL")
                categories[article] = category
        shares = {"max_feed_share": max(feed.values()) / (2 * len(rows)),
                  "max_source_pair_share": max(source.values()) / len(rows),
                  "max_category_share": max(Counter(categories.values()).values()) / len(categories)}
        if shares["max_feed_share"] > rules.max_feed_share or shares["max_source_pair_share"] > rules.max_source_pair_share:
            raise ValueError("SOURCE_DIVERSITY_GATE=FAIL")
        if shares["max_category_share"] > rules.max_category_share:
            raise ValueError("CATEGORY_DIVERSITY_GATE=FAIL")
        return shares

    blind_diversity, dev_diversity = diversity(blind), diversity(dev)
    adjacency = defaultdict(set)
    by_key = {row["pair_key"]: row for row in blind}
    for row in blind:
        a, b = tuple(_ids(row)); adjacency[a].add(b); adjacency[b].add(a)
    components, visited = [], set()
    for start in sorted(adjacency):
        if start in visited:
            continue
        pending, component = [start], set()
        while pending:
            article = pending.pop()
            if article in visited:
                continue
            visited.add(article); component.add(article); pending.extend(adjacency[article] - visited)
        edges = {key for key, row in by_key.items() if _ids(row) <= component}
        components.append((component, edges))
    if any(len(edges) > rules.max_component_pairs or len(articles) > rules.max_component_articles for articles, edges in components):
        raise ValueError("COMPONENT_SIZE_GATE=FAIL")
    independent = sum(len(edges) == 1 for _, edges in components)
    multi = sum(len(edges) > 1 for _, edges in components)
    if len(components) < rules.min_components or independent < rules.min_independent_pairs or multi < rules.min_multi_pair_components:
        raise ValueError("COMPONENT_DIVERSITY_GATE=FAIL")
    groups = []
    for articles, edges in components:
        candidates = [by_key[key] for key in edges if int(by_key[key].get("best_rank", 0)) <= rules.chain_rank_ceiling]
        chains = []
        for first, second in combinations(candidates, 2):
            group_articles = _ids(first) | _ids(second)
            if len(group_articles) == 3 and _ids(first) & _ids(second):
                pair_keys = tuple(sorted((first["pair_key"], second["pair_key"])))
                chains.append((_hash(":".join(pair_keys)), pair_keys, sorted(group_articles)))
        if chains:
            _, pair_keys, group_articles = min(chains)
            groups.append({"article_ids": group_articles, "pair_keys": list(pair_keys), "structure_type": "CHAIN"})
    if len(groups) < rules.min_chain_groups:
        raise ValueError("CHAIN_GROUP_GATE=FAIL")
    groups.sort(key=lambda group: _hash(":".join(group["pair_keys"])))
    return {"chain_groups": groups[:rules.min_chain_groups], "chain_group_bridging_count": 0,
            "connected_component_count": len(components), "independent_pair_count": independent,
            "multi_pair_component_count": multi,
            "max_component_pair_count": max((len(e) for _, e in components), default=0),
            "max_component_article_count": max((len(a) for a, _ in components), default=0),
            "blind_diversity": blind_diversity, "dev_diversity": dev_diversity}


def search_components(
    blind_candidates: list[dict], dev_candidates: list[dict], *,
    blind_quotas: dict[str, int] = BLIND_QUOTAS, dev_quotas: dict[str, int] = DEV_QUOTAS,
    rules: SearchRules = SearchRules(), gold_pair_keys: set[str] | None = None,
    gold_article_ids: set[int] | None = None, seed: int = SEED, node_limit: int = 1000,
    restarts: int = 3, variants: int = 4, solver_seconds: float = 20.0,
    max_candidate_attempts: int = 4,
) -> dict:
    """Solve over a bounded motif library; only a separately validated witness is returned."""
    import numpy as np
    import scipy
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    if node_limit < 1 or restarts < 1 or variants < 1 or solver_seconds <= 0 or max_candidate_attempts < 1:
        raise ValueError("INVALID_COMPONENT_SEARCH_LIMIT")
    excluded_pairs = {canonical_pair_key(*key.split(":")) for key in (gold_pair_keys or set())}
    excluded_articles = set(gold_article_ids or set())
    blind_pool = [r for r in blind_candidates if r["pair_key"] not in excluded_pairs and not (_ids(r) & excluded_articles)]
    dev_pool = [r for r in dev_candidates if r["pair_key"] not in excluded_pairs]
    motifs, inventory = generate_motifs(
        blind_pool, blind_quotas, seed=seed, variants=variants,
        max_pairs=rules.max_component_pairs, max_articles=rules.max_component_articles,
        rank_ceiling=rules.chain_rank_ceiling,
    )
    size = len(motifs)
    certificate = {name: 0 for name in (
        "nodes_explored", "nodes_pruned", "prune_bucket_capacity", "prune_component_requirement",
        "prune_article_overlap", "prune_source_cap", "prune_category_cap", "prune_dev_capacity", "prune_other",
    )}
    certificate.update({"solver_iterations": 0, "solver_internal_prunes": "NOT_EXPOSED",
                        "solver_outcomes": [], "dev_search_incomplete": 0})
    if not size:
        return {"status": "COMPONENT_SEARCH_LIMIT_REACHED", "feasible_witness_found": False,
                "search_complete": False, "certificate": certificate, "inventory": inventory,
                "blind": [], "dev": [], "chain_groups": [], "restarts": restarts,
                "witness_restart_index": None, "solver": "scipy.optimize.milp", "solver_version": scipy.__version__}

    bucket_rows = {b: {} for b in blind_quotas}
    article_rows, feed_rows, source_rows, category_rows = defaultdict(dict), defaultdict(dict), defaultdict(dict), defaultdict(dict)
    singleton_row, chain_row = {}, {}
    for index, motif in enumerate(motifs):
        for bucket, count in motif["bucket_counts"].items():
            bucket_rows[bucket][index] = count
        for article in motif["article_ids"]:
            article_rows[article][index] = 1
        for feed, count in motif["feed_counts"].items():
            feed_rows[feed][index] = count
        for pair, count in motif["source_pair_counts"].items():
            source_rows[pair][index] = count
        for category, count in motif["category_counts"].items():
            category_rows[category][index] = count
        (singleton_row if motif["kind"] == "SINGLETON" else chain_row)[index] = 1

    base = []
    for bucket, quota in blind_quotas.items(): base.append((bucket_rows[bucket], quota, quota))
    base.append((singleton_row, rules.min_independent_pairs, np.inf))
    base.append((chain_row, max(rules.min_chain_groups, rules.min_multi_pair_components), np.inf))
    base.append(({index: 1 for index in range(size)}, rules.min_components, np.inf))
    for row in article_rows.values(): base.append((row, -np.inf, 1))
    for row in feed_rows.values(): base.append((row, -np.inf, int(2 * sum(blind_quotas.values()) * rules.max_feed_share)))
    for row in source_rows.values(): base.append((row, -np.inf, int(sum(blind_quotas.values()) * rules.max_source_pair_share)))
    for category, row in category_rows.items():
        coefficients = {i: row.get(i, 0) - rules.max_category_share * len(motifs[i]["article_ids"]) for i in range(size)}
        base.append(({i: v for i, v in coefficients.items() if v}, -np.inf, 0))

    def matrix_constraints(cuts):
        rows, columns, values, lower, upper = [], [], [], [], []
        for row_index, (coefficients, lo, hi) in enumerate(base + cuts):
            lower.append(lo); upper.append(hi)
            for column, value in coefficients.items():
                rows.append(row_index); columns.append(column); values.append(value)
        matrix = coo_matrix((np.asarray(values, dtype=float), (np.asarray(rows, dtype=np.int32), np.asarray(columns, dtype=np.int32))), shape=(len(lower), size)).tocsc()
        return LinearConstraint(matrix, np.asarray(lower), np.asarray(upper))

    def dev_witness(blocked, restart):
        target = sum(dev_quotas.values())
        buckets = {bucket: [row for row in dev_pool if row["primary_bucket"] == bucket and not (_ids(row) & blocked)] for bucket in dev_quotas}
        buckets = {bucket: sorted(rows, key=lambda row: _hash(f"DEV:{restart}:{row['pair_key']}", seed))
                   for bucket, rows in buckets.items()}
        dev_nodes = 0

        def recurse(selected, starts, counts, feeds, pairs):
            nonlocal dev_nodes
            if dev_nodes >= node_limit:
                return None
            dev_nodes += 1
            deficits = {b: n - counts[b] for b, n in dev_quotas.items() if counts[b] < n}
            if not deficits:
                categories = {}
                for row in selected:
                    for side in ("a", "b"):
                        article, category = int(row[f"article_{side}_id"]), str(row.get(f"category_{side}", ""))
                        if article in categories and categories[article] != category:
                            return None
                        categories[article] = category
                if not categories or max(Counter(categories.values()).values()) / len(categories) <= rules.max_category_share:
                    return selected
                return None
            if any(len(buckets[b]) - starts[b] < deficit for b, deficit in deficits.items()):
                return None
            bucket = min(deficits, key=lambda b: ((len(buckets[b]) - starts[b]) / deficits[b], b))
            for index in range(starts[bucket], len(buckets[bucket])):
                if dev_nodes >= node_limit:
                    break
                row = buckets[bucket][index]
                additions = Counter(str(v) for v in (row["feed_a_id"], row["feed_b_id"]))
                pair = _source_pair(row)
                if any(feeds[f] + n > int(2 * target * rules.max_feed_share) for f, n in additions.items()) or pairs[pair] + 1 > int(target * rules.max_source_pair_share):
                    continue
                next_counts, next_feeds, next_pairs = counts.copy(), feeds.copy(), pairs.copy()
                next_counts[bucket] += 1; next_feeds.update(additions); next_pairs[pair] += 1
                result = recurse(selected + [row], {**starts, bucket: index + 1}, next_counts, next_feeds, next_pairs)
                if result is not None:
                    return result
            return None

        return recurse([], {bucket: 0 for bucket in dev_quotas}, Counter(), Counter(), Counter())

    def scarcity_order(chosen):
        remaining, blocked, counts, ordered = set(chosen), set(), Counter(), []
        while remaining:
            deficits = {bucket: quota - counts[bucket] for bucket, quota in blind_quotas.items()
                        if counts[bucket] < quota}
            usable = [motif for motif in motifs if not (motif["article_ids"] & blocked)
                      and all(count <= deficits.get(bucket, 0) for bucket, count in motif["bucket_counts"].items())]
            availability = Counter()
            for motif in usable:
                availability.update(motif["bucket_counts"])
            scarce = min(deficits, key=lambda bucket: (availability[bucket] / deficits[bucket], bucket)) if deficits else None
            index = min(remaining, key=lambda i: (
                -motifs[i]["bucket_counts"].get(scarce, 0), _hash(":".join(motifs[i]["pair_keys"]), seed),
            ))
            ordered.append(index); remaining.remove(index)
            blocked.update(motifs[index]["article_ids"]); counts.update(motifs[index]["bucket_counts"])
        return ordered

    cuts = []
    contribution = Counter()
    for motif in motifs:
        contribution.update(motif["bucket_counts"])
    for restart in range(restarts):
        objective = np.array([
            -sum(count * blind_quotas[bucket] / max(contribution[bucket], 1)
                 for bucket, count in motif["bucket_counts"].items()) / len(motif["rows"])
            + 0.000001 * int(_hash(f"{restart}:{':'.join(motif['pair_keys'])}", seed)[:12], 16) / 2**48
            for motif in motifs
        ])
        for _ in range(max_candidate_attempts):
            certificate["solver_iterations"] += 1
            solved = milp(objective, integrality=np.ones(size), bounds=Bounds(np.zeros(size), np.ones(size)),
                          constraints=matrix_constraints(cuts),
                          options={"node_limit": node_limit, "time_limit": solver_seconds, "presolve": True})
            certificate["solver_outcomes"].append({0: "OPTIMAL", 1: "LIMIT", 2: "LIBRARY_INFEASIBLE",
                                                   3: "UNBOUNDED", 4: "SOLVER_ERROR"}.get(getattr(solved, "status", None), "UNKNOWN"))
            certificate["nodes_explored"] += int(getattr(solved, "mip_node_count", 0) or 0)
            if solved.x is None:
                break
            chosen = [i for i, value in enumerate(solved.x) if value > 0.5]
            blocked, prefix = set(), []
            for index in scarcity_order(chosen):
                prefix.append(index); blocked.update(motifs[index]["article_ids"])
                if not dev_forward_capacity(dev_pool, blocked, dev_quotas)["feasible"]:
                    certificate["prune_dev_capacity"] += 1
                    cuts.append(({i: 1 for i in prefix}, -np.inf, len(prefix) - 1))
                    break
            else:
                blind = [row for index in chosen for row in motifs[index]["rows"]]
                dev = dev_witness(blocked, restart)
                if dev is not None:
                    try:
                        verified = validate_witness(blind, dev, blind_quotas=blind_quotas, dev_quotas=dev_quotas,
                                                    rules=rules, gold_pair_keys=excluded_pairs, gold_article_ids=excluded_articles)
                    except ValueError:
                        certificate["prune_other"] += 1
                    else:
                        certificate["nodes_pruned"] = sum(certificate[k] for k in certificate if k.startswith("prune_"))
                        return {"status": "FEASIBLE_WITNESS_FOUND", "feasible_witness_found": True,
                                "search_complete": False, "certificate": certificate, "inventory": inventory,
                                "blind": blind, "dev": dev, "chain_groups": verified["chain_groups"],
                                "validation": verified, "restarts": restarts, "witness_restart_index": restart,
                                "solver": "scipy.optimize.milp", "solver_version": scipy.__version__,
                                "node_limit": node_limit, "solver_seconds": solver_seconds}
                else:
                    certificate["dev_search_incomplete"] += 1
                certificate["prune_other"] += 1
                cuts.append(({i: 1 for i in chosen}, -np.inf, len(chosen) - 1))
    certificate["nodes_pruned"] = sum(certificate[k] for k in certificate if k.startswith("prune_"))
    return {"status": "COMPONENT_SEARCH_LIMIT_REACHED", "feasible_witness_found": False,
            "search_complete": False, "certificate": certificate, "inventory": inventory,
            "blind": [], "dev": [], "chain_groups": [], "restarts": restarts,
            "witness_restart_index": None, "solver": "scipy.optimize.milp", "solver_version": scipy.__version__,
            "node_limit": node_limit, "solver_seconds": solver_seconds}
