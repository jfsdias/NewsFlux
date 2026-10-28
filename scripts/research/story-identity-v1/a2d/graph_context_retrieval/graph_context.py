"""Deterministic graph-context research helpers for STORY-02 P4-D2A-R2.

All graph features in this module are retrieval-research-only. They are not
production Story features. The module intentionally has no model/network I/O.
"""
from __future__ import annotations

import builtins
import contextlib
import hashlib
import io
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

Q75 = 0.29742977850168295
Q85 = 0.34703578961316583
Q90 = 0.38240333272116706
Q95 = 0.4336605612812491
SUPPORT_MAX_HOURS = 12.0
DIRECT_MAX_HOURS = 12.0
SEALED_BLIND_NAME = "blind-human-labels-sealed-v1.jsonl"

STRATEGY_CATALOG = {
    "version": "STORY_02_GRAPH_CONTEXT_RETRIEVAL_V1",
    "support_edge": {"qwen_min": Q85, "max_hours": SUPPORT_MAX_HOURS, "cross_feed": True},
    "direct_floor": {"qwen_min": Q75, "max_hours": DIRECT_MAX_HOURS, "cross_feed": True},
    "event": {
        "E0": {"name": "RECIPROCAL_5", "reciprocal_rank_max_lte": 5},
        "E1": {"name": "SHARED_SUPPORT_1", "shared_support_feed_count_gte": 1},
        "E2": {"name": "SHARED_SUPPORT_2", "shared_support_feed_count_gte": 2},
        "E3": {"name": "SHARED_PLUS_RECIPROCAL", "shared_support_feed_count_gte": 1, "reciprocal_rank_max_lte": 10},
        "E4": {"name": "COMMON_TOP10", "common_top10_count_gte": 1},
        "E5": {"name": "SHARED_PLUS_DIRECT_CORROBORATION", "shared_support_feed_count_gte": 1, "direct_corroboration": True},
    },
    "near": {
        "N0": {"name": "HIGH_DIRECT_LOW_CONTEXT", "qwen_min": Q90, "direct_anchor": True, "shared_support_feed_count_eq": 0, "reciprocal_rank_max_gt": 10},
        "N1": {"name": "RECIPROCAL_WITHOUT_SHARED_SUPPORT", "qwen_min": Q85, "shared_support_feed_count_eq": 0, "reciprocal_rank_max_lte": 10},
    },
    "templates": {
        "G40": {"event": 20, "near": 12, "control": 8},
        "G48": {"event": 24, "near": 16, "control": 8},
    },
}


def canonical_json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def strategy_catalog_hash() -> str:
    return hashlib.sha256(canonical_json_bytes(STRATEGY_CATALOG)).hexdigest()


@contextlib.contextmanager
def blind_guard():
    """Reject common local file read paths for the sealed human BLIND artifact."""
    builtin_open = builtins.open
    io_open = io.open
    path_open = Path.open
    path_read_text = Path.read_text
    path_read_bytes = Path.read_bytes

    def check(path):
        if SEALED_BLIND_NAME in str(path):
            raise PermissionError("sealed BLIND human labels are forbidden in R2")

    def guarded_builtin(path, *args, **kwargs):
        check(path)
        return builtin_open(path, *args, **kwargs)

    def guarded_io(path, *args, **kwargs):
        check(path)
        return io_open(path, *args, **kwargs)

    def guarded_path_open(path, *args, **kwargs):
        check(path)
        return path_open(path, *args, **kwargs)

    def guarded_read_text(path, *args, **kwargs):
        check(path)
        return path_read_text(path, *args, **kwargs)

    def guarded_read_bytes(path, *args, **kwargs):
        check(path)
        return path_read_bytes(path, *args, **kwargs)

    with (
        patch.object(builtins, "open", guarded_builtin),
        patch.object(io, "open", guarded_io),
        patch.object(Path, "open", guarded_path_open),
        patch.object(Path, "read_text", guarded_read_text),
        patch.object(Path, "read_bytes", guarded_read_bytes),
    ):
        yield


def _timestamp(value: str) -> float:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return dt.timestamp()


def _pair_endpoints(row):
    return int(row["article_a_id"]), int(row["article_b_id"])


def _feed_map(rows):
    result = {}
    for row in rows:
        for side in ("a", "b"):
            article = int(row[f"article_{side}_id"])
            feed = row[f"feed_{side}_id"]
            if article in result and result[article] != feed:
                raise ValueError(f"inconsistent feed for article {article}")
            result[article] = feed
    return result


def _time_map(rows):
    result = {}
    for row in rows:
        for side in ("a", "b"):
            article = int(row[f"article_{side}_id"])
            value = str(row[f"published_at_{side}"])
            if article in result and result[article] != value:
                raise ValueError(f"inconsistent timestamp for article {article}")
            result[article] = value
    return result


def graph_eligible(row, excluded_articles: set[int]) -> bool:
    a, b = _pair_endpoints(row)
    return (
        a not in excluded_articles
        and b not in excluded_articles
        and row["feed_a_id"] != row["feed_b_id"]
        and 0 <= float(row["temporal_delta_hours"]) <= 24
    )


def direct_floor(row) -> bool:
    return (
        float(row["qwen_score"]) >= Q75
        and float(row["temporal_delta_hours"]) <= DIRECT_MAX_HOURS
        and row["feed_a_id"] != row["feed_b_id"]
    )


def support_edge(row) -> bool:
    return (
        float(row["qwen_score"]) >= Q85
        and float(row["temporal_delta_hours"]) <= SUPPORT_MAX_HOURS
        and row["feed_a_id"] != row["feed_b_id"]
    )


def _neighbor_maps(rows):
    incident = defaultdict(list)
    for row in rows:
        a, b = _pair_endpoints(row)
        incident[a].append((b, row))
        incident[b].append((a, row))
    ranked = {}
    rank = {}
    for article, items in incident.items():
        ordered = sorted(items, key=lambda item: (-float(item[1]["qwen_score"]), float(item[1]["temporal_delta_hours"]), str(item[1]["pair_key"])))
        ranked[article] = [neighbor for neighbor, _ in ordered]
        rank[article] = {neighbor: idx + 1 for idx, (neighbor, _) in enumerate(ordered)}
    return ranked, rank


def _support_adjacency(rows):
    adj = defaultdict(set)
    for row in rows:
        if support_edge(row):
            a, b = _pair_endpoints(row)
            adj[a].add(b)
            adj[b].add(a)
    return adj


def materialize_graph_context(rows, excluded_articles: set[int]):
    """Derive deterministic graph context from the frozen pair universe.

    Excluded articles are removed from candidate endpoints *and* support nodes.
    Output includes all remaining graph edges (<=24h); strategies apply their own
    direct floor afterwards.
    """
    filtered = [dict(row) for row in rows if graph_eligible(row, excluded_articles)]
    filtered.sort(key=lambda r: str(r["pair_key"]))
    feeds = _feed_map(filtered)
    times = _time_map(filtered)
    ranked, ranks = _neighbor_maps(filtered)
    support = _support_adjacency(filtered)

    output = []
    for row in filtered:
        a, b = _pair_endpoints(row)
        feed_a, feed_b = feeds[a], feeds[b]
        supporters = {
            c
            for c in support.get(a, set()) & support.get(b, set())
            if c not in (a, b) and feeds.get(c) not in (feed_a, feed_b)
        }
        supporter_feeds = {feeds[c] for c in supporters}

        def common_top(k):
            left = set(ranked.get(a, [])[:k])
            right = set(ranked.get(b, [])[:k])
            return {
                c for c in left & right
                if c not in (a, b) and feeds.get(c) not in (feed_a, feed_b)
            }

        enriched = dict(row)
        enriched.update(
            rank_a_to_b=ranks[a][b],
            rank_b_to_a=ranks[b][a],
            reciprocal_rank_max=max(ranks[a][b], ranks[b][a]),
            shared_support_article_count=len(supporters),
            shared_support_feed_count=len(supporter_feeds),
            common_top5_count=len(common_top(5)),
            common_top10_count=len(common_top(10)),
            support_degree_a=len(support.get(a, set())),
            support_degree_b=len(support.get(b, set())),
            min_support_degree=min(len(support.get(a, set())), len(support.get(b, set()))),
        )
        if supporters:
            timestamps = [_timestamp(times[x]) for x in {a, b, *supporters}]
            enriched["support_burst_span_hours"] = (max(timestamps) - min(timestamps)) / 3600.0
        else:
            enriched["support_burst_span_hours"] = None
        output.append(enriched)
    return output


def _direct_corroboration(row) -> bool:
    return any(float(row.get(key, 0)) > 0 for key in ("lexical_overlap", "entity_anchor_overlap", "number_overlap", "date_overlap"))


def matches_strategy(row, strategy: str) -> bool:
    """Apply one predeclared strategy; global direct floor applies to E and N."""
    if strategy not in STRATEGY_CATALOG["event"] and strategy not in STRATEGY_CATALOG["near"]:
        raise KeyError(strategy)
    if not direct_floor(row):
        return False
    reciprocal = int(row["reciprocal_rank_max"])
    shared = int(row["shared_support_feed_count"])
    common10 = int(row["common_top10_count"])
    if strategy == "E0":
        return reciprocal <= 5
    if strategy == "E1":
        return shared >= 1
    if strategy == "E2":
        return shared >= 2
    if strategy == "E3":
        return shared >= 1 and reciprocal <= 10
    if strategy == "E4":
        return common10 >= 1
    if strategy == "E5":
        return shared >= 1 and _direct_corroboration(row)
    if strategy == "N0":
        return float(row["qwen_score"]) >= Q90 and _direct_corroboration(row) and shared == 0 and reciprocal > 10
    if strategy == "N1":
        return float(row["qwen_score"]) >= Q85 and shared == 0 and reciprocal <= 10
    raise AssertionError(strategy)


def same_event_families(gold_rows):
    adj = defaultdict(set)
    vertices = set()
    for row in gold_rows:
        if row["human_decision"] != "SAME_EVENT":
            continue
        if "pair_key" in row:
            a, b = (int(x) for x in str(row["pair_key"]).split(":"))
        else:
            a, b = _pair_endpoints(row)
        vertices.update((a, b))
        adj[a].add(b)
        adj[b].add(a)
    unseen = set(vertices)
    components = []
    while unseen:
        start = min(unseen)
        unseen.remove(start)
        stack = [start]
        comp = {start}
        while stack:
            current = stack.pop()
            for nxt in sorted(adj[current] & unseen):
                unseen.remove(nxt)
                comp.add(nxt)
                stack.append(nxt)
        components.append(comp)
    return components


def article_disjoint_max(rows, time_limit=30):
    if not rows:
        return 0
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    rows = sorted(rows, key=lambda r: str(r["pair_key"]))
    articles = sorted({x for row in rows for x in _pair_endpoints(row)})
    idx = {article: i for i, article in enumerate(articles)}
    rr, cc = [], []
    for j, row in enumerate(rows):
        for article in _pair_endpoints(row):
            rr.append(idx[article]); cc.append(j)
    matrix = coo_matrix((np.ones(len(rr)), (np.asarray(rr, dtype="int32"), np.asarray(cc, dtype="int32"))), shape=(len(articles), len(rows))).tocsc()
    result = milp(
        -np.ones(len(rows)), integrality=np.ones(len(rows)), bounds=Bounds(0, 1),
        constraints=LinearConstraint(matrix, 0, 1), options={"time_limit": time_limit, "presolve": True},
    )
    if result.status == 0 and result.fun is not None:
        return int(round(-float(result.fun)))
    return None


def classify_lanes(rows, event_strategy, near_strategy):
    """Event -> near -> control priority, preventing quota overlap."""
    classified = []
    for row in rows:
        lane = None
        if matches_strategy(row, event_strategy):
            lane = "event"
        elif matches_strategy(row, near_strategy):
            lane = "near"
        elif float(row["qwen_score"]) >= Q75 and float(row["temporal_delta_hours"]) <= 24 and row["feed_a_id"] != row["feed_b_id"]:
            lane = "control"
        if lane:
            item = dict(row)
            item["selection_lane"] = lane
            classified.append(item)
    return classified


def _validate_witness(chosen, quotas):
    counts = Counter(row["selection_lane"] for row in chosen)
    if dict(counts) != {k: v for k, v in quotas.items() if v}:
        return False
    articles = [x for row in chosen for x in _pair_endpoints(row)]
    if len(articles) != len(set(articles)):
        return False
    total = sum(quotas.values())
    feed_counts = Counter(str(row[f"feed_{side}_id"]) for row in chosen for side in ("a", "b"))
    source_counts = Counter(tuple(sorted((str(row["feed_a_id"]), str(row["feed_b_id"])))) for row in chosen)
    cat_counts = Counter(str(row[f"category_{side}"]) for row in chosen for side in ("a", "b"))
    if feed_counts and max(feed_counts.values()) / (2 * total) > 0.20 + 1e-12:
        return False
    if source_counts and max(source_counts.values()) / total > 0.10 + 1e-12:
        return False
    if cat_counts and max(cat_counts.values()) / (2 * total) > 0.50 + 1e-12:
        return False
    if any(row["feed_a_id"] == row["feed_b_id"] or not (0 <= float(row["temporal_delta_hours"]) <= 24) for row in chosen):
        return False
    return True


def pack_feasible(rows, event_strategy, near_strategy, quotas, time_limit=30):
    """Exact feasibility for one event/near/control template; witness stays memory-only."""
    classified = classify_lanes(rows, event_strategy, near_strategy)
    raw = Counter(row["selection_lane"] for row in classified)
    if any(raw.get(lane, 0) < count for lane, count in quotas.items()):
        return {"status": "INFEASIBLE_RAW", "raw": dict(raw), "counts": None}

    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    classified.sort(key=lambda r: (r["selection_lane"], str(r["pair_key"])))
    total = sum(quotas.values())
    constraints = []

    for lane, target in quotas.items():
        constraints.append(({j: 1.0 for j, row in enumerate(classified) if row["selection_lane"] == lane}, float(target), float(target)))

    groups = defaultdict(dict)
    for j, row in enumerate(classified):
        for side in ("a", "b"):
            article = ("article", str(row[f"article_{side}_id"]))
            groups[article][j] = 1.0
            feed = ("feed", str(row[f"feed_{side}_id"]))
            groups[feed][j] = groups[feed].get(j, 0.0) + 1.0
            category = ("category", str(row[f"category_{side}"]))
            groups[category][j] = groups[category].get(j, 0.0) + 1.0
        source = ("source", tuple(sorted((str(row["feed_a_id"]), str(row["feed_b_id"])))))
        groups[source][j] = 1.0
    for (kind, _), coeff in groups.items():
        if kind == "article": cap = 1.0
        elif kind == "feed": cap = math.floor(2 * total * 0.20 + 1e-12)
        elif kind == "source": cap = math.floor(total * 0.10 + 1e-12)
        elif kind == "category": cap = math.floor(2 * total * 0.50 + 1e-12)
        else: raise AssertionError(kind)
        constraints.append((coeff, 0.0, float(cap)))

    rr=[]; cc=[]; vv=[]; lo=[]; hi=[]
    for i,(coeff,lower,upper) in enumerate(constraints):
        lo.append(lower); hi.append(upper)
        for j,value in coeff.items():
            rr.append(i); cc.append(j); vv.append(value)
    mat = coo_matrix((np.asarray(vv,dtype=float),(np.asarray(rr,dtype="int32"),np.asarray(cc,dtype="int32"))),shape=(len(constraints),len(classified))).tocsc()
    objective = np.arange(1, len(classified)+1, dtype=float) * 1e-12
    result = milp(objective, integrality=np.ones(len(classified)), bounds=Bounds(0,1), constraints=LinearConstraint(mat,np.asarray(lo),np.asarray(hi)), options={"time_limit":time_limit,"presolve":True})
    if result.status == 2:
        return {"status":"INFEASIBLE","raw":dict(raw),"counts":None}
    if result.x is None or result.status != 0:
        return {"status":"UNKNOWN_BOUNDED_SEARCH","raw":dict(raw),"counts":None,"solver_status":int(result.status)}
    chosen=[classified[j] for j,x in enumerate(result.x) if x>.5]
    if not _validate_witness(chosen, quotas):
        raise ValueError("invalid feasibility witness")
    return {"status":"FEASIBLE","raw":dict(raw),"counts":dict(Counter(r["selection_lane"] for r in chosen))}


def nondominated(configs):
    """Return the multi-objective frontier, retaining infeasible configs as a weaker objective."""
    def dominates(a, b):
        av=(a["same"],a["families"],-a["different"],a["related"],int(bool(a["feasible"])))
        bv=(b["same"],b["families"],-b["different"],b["related"],int(bool(b["feasible"])))
        return all(x>=y for x,y in zip(av,bv)) and any(x>y for x,y in zip(av,bv))
    return [item for item in configs if not any(dominates(other,item) for other in configs if other is not item)]
