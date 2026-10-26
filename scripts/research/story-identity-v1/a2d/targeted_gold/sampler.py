"""Label-blind design and private pack generation for STORY-02-A2D2.

This module never reads Gold labels.  Its input reader intentionally extracts
only the pair key and article IDs from the immutable Gold CSV.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SEED = 20261026
DESIGN_VERSION = "STORY_02_A2D2_TARGETED_GOLD_V1"
EXPECTED_GOLD_SHA = "3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4"
EXPECTED_HUMAN_LABEL_SHA = "7cff732171abf4f7e410c8a0f14425652ec49d8d52a11ba4268fd9262e96c88c"
EXPECTED_HOME_SHA = "0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0"
EXPECTED_PAIR_SHA = "bd50a4d4e316e2bdd0b6735c1df8c3fe52f6dc14878923325dd2794cfeb3eb14"
EXPECTED_GOLD_PAIR_COUNT = 233
EXPECTED_GOLD_ARTICLE_COUNT = 153
EXPECTED_HOME_ARTICLE_COUNT = 200
EXPECTED_PAIR_UNIVERSE_COUNT = 18953
EXPECTED_NON_GOLD_PAIR_COUNT = 18720

HUMAN_REVIEW_COLUMNS = (
    "annotation_id",
    "pair_key",
    "feed_a",
    "feed_b",
    "title_a",
    "title_b",
    "published_at_a",
    "published_at_b",
    "label_options",
    "human_decision",
)
MINING_STRATA = (
    "S1_HIGH_SEMANTIC_MODERATE_LEXICAL",
    "S2_SEMANTIC_LEXICAL_BOUNDARY",
    "S3_HIGH_SEMANTIC_LOW_LEXICAL",
    "S4_SAME_ENTITY_DIFFERENT_EVENT_RISK",
    "S5_LEXICAL_ALIAS_RISK",
    "S6_PRODUCT_TOPIC_COLLISION_RISK",
    "S7_TEMPORAL_AMBIGUITY",
    "S8_A_B_C_DISAGREEMENT",
    "S9_POSITIVE_SEEKING_HIGH_CORROBORATION",
    "S10_DIVERSITY_CONTROL",
)
PRIMARY_BUCKETS = (
    "POSITIVE_SEEKING",
    "HARD_NEGATIVE_SEEKING",
    "BOUNDARY_DISAGREEMENT",
    "DIVERSITY_CONTROL",
)
CHALLENGE_STATES = (
    "SELECTED",
    "FROZEN",
    "ANNOTATED_SEALED",
    "OPENED_FOR_FINAL_EVALUATION",
    "RETIRED_AS_BLIND",
)
DEV_QUOTAS = {
    "POSITIVE_SEEKING": 28,
    "HARD_NEGATIVE_SEEKING": 28,
    "BOUNDARY_DISAGREEMENT": 16,
    "DIVERSITY_CONTROL": 8,
}
BLIND_QUOTAS = {
    "POSITIVE_SEEKING": 16,
    "HARD_NEGATIVE_SEEKING": 16,
    "BOUNDARY_DISAGREEMENT": 8,
    "DIVERSITY_CONTROL": 8,
}


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sha(path: str | Path, expected: str, gate: str) -> bool:
    if sha256_file(path) != expected:
        raise ValueError(f"{gate}=FAIL")
    return True


def verify_frozen_inputs(gold_path: str | Path, home_path: str | Path, pair_path: str | Path) -> bool:
    verify_sha(gold_path, EXPECTED_GOLD_SHA, "GOLD_V2_SHA_GATE")
    verify_sha(home_path, EXPECTED_HOME_SHA, "HOME200_SHA_GATE")
    verify_sha(pair_path, EXPECTED_PAIR_SHA, "PAIR_UNIVERSE_SHA_GATE")
    return True


def canonical_pair_key(article_a: int | str, article_b: int | str) -> str:
    a, b = int(article_a), int(article_b)
    if a == b:
        raise ValueError("SELF_PAIR")
    return f"{min(a, b)}:{max(a, b)}"


def filter_gold_pairs(rows: Iterable[dict[str, Any]], gold_pair_keys: set[str]) -> list[dict[str, Any]]:
    normalized_gold_keys = {
        canonical_pair_key(*key.split(":")) if ":" in key else key
        for key in gold_pair_keys
    }
    retained = []
    seen: set[str] = set()
    for row in rows:
        key = canonical_pair_key(row["article_a_id"], row["article_b_id"])
        if key not in normalized_gold_keys and key not in seen:
            retained.append({**row, "pair_key": key})
            seen.add(key)
    return retained


def compute_feature_thresholds(rows: Iterable[dict[str, Any]]) -> dict[str, float]:
    materialized = list(rows)
    if not materialized:
        raise ValueError("EMPTY_CANDIDATE_UNIVERSE")

    def quantile(key: str, fraction: float) -> float:
        values = sorted(float(row.get(key, 0.0)) for row in materialized)
        position = (len(values) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(values) - 1)
        weight = position - lower
        return values[lower] * (1 - weight) + values[upper] * weight

    return {
        "qwen_q50": quantile("qwen_score", 0.50),
        "qwen_q75": quantile("qwen_score", 0.75),
        "qwen_q90": quantile("qwen_score", 0.90),
        "lexical_q50": quantile("lexical_overlap", 0.50),
        "lexical_q75": quantile("lexical_overlap", 0.75),
        "lexical_q90": quantile("lexical_overlap", 0.90),
    }


def classify_candidate(row: dict[str, Any], thresholds: dict[str, float]) -> dict[str, Any]:
    qwen = float(row.get("qwen_score", 0.0))
    lexical = float(row.get("lexical_overlap", 0.0))
    entity = float(row.get("entity_anchor_overlap", 0.0))
    number = float(row.get("number_overlap", 0.0))
    date = float(row.get("date_overlap", 0.0))
    hours = float(row.get("temporal_delta_hours", 0.0))
    q50, q75, q90 = (thresholds[key] for key in ("qwen_q50", "qwen_q75", "qwen_q90"))
    prediction_values = [bool(row.get(f"candidate_{name.lower()}", False)) for name in "ABC"]
    disagreement = len(set(prediction_values)) > 1
    corroborated = lexical >= 0.05 or number > 0 or date > 0 or entity >= 0.25
    high_semantic = qwen >= q90

    strata: list[str] = []
    if high_semantic and lexical >= 0.05:
        strata.append("S1_HIGH_SEMANTIC_MODERATE_LEXICAL")
    if q75 <= qwen < q90 and lexical >= 0.05:
        strata.append("S2_SEMANTIC_LEXICAL_BOUNDARY")
    if high_semantic and lexical < 0.05:
        strata.append("S3_HIGH_SEMANTIC_LOW_LEXICAL")
    if entity > 0 and (number == 0 or date == 0):
        strata.append("S4_SAME_ENTITY_DIFFERENT_EVENT_RISK")
    if lexical >= 0.05 and qwen < q50:
        strata.append("S5_LEXICAL_ALIAS_RISK")
    if qwen >= q75 and entity > 0 and (number == 0 or date == 0):
        strata.append("S6_PRODUCT_TOPIC_COLLISION_RISK")
    if (qwen >= q75 or lexical >= 0.05) and hours > 4:
        strata.append("S7_TEMPORAL_AMBIGUITY")
    if disagreement:
        strata.append("S8_A_B_C_DISAGREEMENT")
    if qwen >= q75 and corroborated and hours <= 8:
        strata.append("S9_POSITIVE_SEEKING_HIGH_CORROBORATION")
    if not strata:
        strata.append("S10_DIVERSITY_CONTROL")

    if qwen >= q75 and (corroborated or (high_semantic and hours <= 8)):
        primary = "POSITIVE_SEEKING"
    elif (
        (qwen >= q75 and not corroborated)
        or (lexical >= 0.05 and qwen < q50)
        or (entity > 0 and qwen >= q50 and number == 0 and date == 0)
        or ((qwen >= q75 or lexical >= 0.05) and hours > 8)
    ):
        primary = "HARD_NEGATIVE_SEEKING"
    elif disagreement or q50 <= qwen < q90 or (lexical >= 0.05 and qwen < q75):
        primary = "BOUNDARY_DISAGREEMENT"
    else:
        primary = "DIVERSITY_CONTROL"

    return {"primary_bucket": primary, "mining_strata": strata}


def add_feature_buckets(rows: list[dict[str, Any]], thresholds: dict[str, float]) -> None:
    for row in rows:
        qwen = float(row.get("qwen_score", 0.0))
        lexical = float(row.get("lexical_overlap", 0.0))
        hours = float(row.get("temporal_delta_hours", 0.0))
        row["qwen_bucket"] = "HIGH_Q90" if qwen >= thresholds["qwen_q90"] else (
            "UPPER_Q75" if qwen >= thresholds["qwen_q75"] else (
                "MID_Q50" if qwen >= thresholds["qwen_q50"] else "LOWER_HALF"
            )
        )
        row["lexical_bucket"] = "POSITIVE" if lexical >= 0.05 else "ZERO_OR_TRACE"
        row["temporal_bucket"] = (
            "0_1H" if hours <= 1 else "1_4H" if hours <= 4 else
            "4_8H" if hours <= 8 else "8_24H" if hours <= 24 else "OVER_24H"
        )


def _stable_order(rows: Iterable[dict[str, Any]], seed: int, dataset: str) -> list[dict[str, Any]]:
    salt = f"{seed}:{dataset}:".encode()
    return sorted(rows, key=lambda row: hashlib.sha256(salt + row["pair_key"].encode()).digest())


def _source_pair(row: dict[str, Any]) -> str:
    feeds = sorted((str(row["feed_a_id"]), str(row["feed_b_id"])))
    return f"{feeds[0]}:{feeds[1]}"


def _within_caps(
    row: dict[str, Any], selected: list[dict[str, Any]],
    feed_share: float, source_pair_share: float, target_size: int,
) -> bool:
    proposed = selected + [row]
    feeds = Counter(str(feed) for item in proposed for feed in (item["feed_a_id"], item["feed_b_id"]))
    pairs = Counter(_source_pair(item) for item in proposed)
    max_feed_appearances = int(2 * target_size * feed_share)
    max_source_pairs = int(target_size * source_pair_share)
    return (
        max(feeds.values(), default=0) <= max_feed_appearances
        and max(pairs.values(), default=0) <= max_source_pairs
    )


def select_chain_groups(
    rows: Iterable[dict[str, Any]], rank_ceiling: int = 1250,
    required_groups: int = 6, seed: int = SEED,
) -> list[dict[str, Any]]:
    candidates = [row for row in rows if int(row.get("best_rank", 0)) <= rank_ceiling]
    by_vertex: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in candidates:
        a, b = int(row["article_a_id"]), int(row["article_b_id"])
        by_vertex[a].append(row)
        by_vertex[b].append(row)
    edges = {row["pair_key"]: row for row in candidates}
    vertices = sorted(by_vertex)
    paths: list[tuple[tuple[int, int, int], tuple[int, str, tuple[str, str]]]] = []
    for center in vertices:
        neighbors = sorted({
            int(row["article_b_id"]) if int(row["article_a_id"]) == center else int(row["article_a_id"])
            for row in by_vertex[center]
        })
        for index, first in enumerate(neighbors):
            for last in neighbors[index + 1:]:
                first_edge = canonical_pair_key(first, center)
                last_edge = canonical_pair_key(center, last)
                keys = (first_edge, last_edge)
                rank_total = sum(int(edges[key].get("best_rank", 0)) for key in keys)
                salt = hashlib.sha256(f"{seed}:{':'.join(keys)}".encode()).hexdigest()
                paths.append(((first, center, last), (rank_total, salt, keys)))
    paths.sort(key=lambda item: item[1][:2])
    selected_vertices: set[int] = set()
    selected_keys: set[str] = set()
    groups = []
    for article_ids, (_, _, pair_keys) in paths:
        if selected_vertices.intersection(article_ids) or selected_keys.intersection(pair_keys):
            continue
        groups.append({"article_ids": list(article_ids), "pair_keys": list(pair_keys), "structure_type": "CHAIN"})
        selected_vertices.update(article_ids)
        selected_keys.update(pair_keys)
        if len(groups) >= required_groups:
            break
    return groups


def validate_dataset_isolation(
    dev: list[dict[str, Any]], blind: list[dict[str, Any]],
    gold_article_ids: set[int], gold_pair_keys: set[str],
) -> bool:
    dev_keys = {canonical_pair_key(row["article_a_id"], row["article_b_id"]) for row in dev}
    blind_keys = {canonical_pair_key(row["article_a_id"], row["article_b_id"]) for row in blind}
    if dev_keys & blind_keys:
        raise ValueError("PAIR_DISJOINT")
    normalized_gold_keys = {
        canonical_pair_key(*key.split(":")) if ":" in key else key
        for key in gold_pair_keys
    }
    if dev_keys & normalized_gold_keys or blind_keys & normalized_gold_keys:
        raise ValueError("GOLD_PAIR_OVERLAP")
    dev_articles = {int(value) for row in dev for value in (row["article_a_id"], row["article_b_id"])}
    blind_articles = {int(value) for row in blind for value in (row["article_a_id"], row["article_b_id"])}
    if dev_articles & blind_articles:
        raise ValueError("ARTICLE_DISJOINT")
    if blind_articles & gold_article_ids:
        raise ValueError("BLIND_GOLD_ARTICLE_OVERLAP")
    return True


def _pick_bucket(
    candidates: list[dict[str, Any]], bucket: str, count: int, selected: list[dict[str, Any]],
    *, seed: int, dataset: str, feed_share_cap: float | None,
    source_pair_share_cap: float | None, target_size: int,
) -> list[dict[str, Any]]:
    if count <= 0:
        return []
    result = []
    for row in _stable_order((item for item in candidates if item.get("primary_bucket") == bucket), seed, dataset):
        if row["pair_key"] in {item["pair_key"] for item in selected + result}:
            continue
        if feed_share_cap is not None and not _within_caps(
            row, selected + result, feed_share_cap, source_pair_share_cap or 1.0, target_size
        ):
            continue
        result.append(row)
        if len(result) >= count:
            break
    return result


def select_joint_packs(
    rows: Iterable[dict[str, Any]], *, gold_pair_keys: set[str], gold_article_ids: set[int],
    seed: int = SEED, dev_target: int = 80, blind_target: int = 48,
    dev_min: int = 60, blind_min: int = 32,
    dev_quotas: dict[str, int] | None = None, blind_quotas: dict[str, int] | None = None,
    chain_group_target: int = 6, enforce_source_diversity: bool = False,
) -> dict[str, Any]:
    eligible_non_gold = filter_gold_pairs(rows, gold_pair_keys)
    materialized = [row for row in eligible_non_gold if float(row.get("temporal_delta_hours", 0.0)) <= 24.0]
    thresholds = compute_feature_thresholds(materialized)
    candidates = []
    for row in materialized:
        classified = classify_candidate(row, thresholds)
        if row.get("primary_bucket") in PRIMARY_BUCKETS:
            classified["primary_bucket"] = row["primary_bucket"]
        candidates.append({**row, **classified})
    add_feature_buckets(candidates, thresholds)
    dev_quotas = dev_quotas or DEV_QUOTAS
    blind_quotas = blind_quotas or BLIND_QUOTAS
    blind_pool = [row for row in candidates if not ({int(row["article_a_id"]), int(row["article_b_id"])} & gold_article_ids)]
    feed_cap = 0.20 if enforce_source_diversity else None
    pair_cap = 0.10 if enforce_source_diversity else None

    chain_groups = select_chain_groups(blind_pool, required_groups=chain_group_target, seed=seed) if chain_group_target else []
    by_key = {row["pair_key"]: row for row in candidates}
    blind = [by_key[key] for group in chain_groups for key in group["pair_keys"]]
    blind_bucket_counts = Counter(row["primary_bucket"] for row in blind)
    if any(blind_bucket_counts[bucket] > blind_quotas.get(bucket, 0) for bucket in PRIMARY_BUCKETS):
        return {
            "dev": [], "blind": blind, "chain_groups": chain_groups,
            "feasible": False, "reason": "CHAIN_QUOTA_CONFLICT", "thresholds": thresholds,
            "dev_spillovers": {}, "dev_target_feasible": False,
            "eligible_non_gold_pair_count": len(eligible_non_gold),
            "eligible_within_p3_24h_count": len(materialized),
            "excluded_over_24h_count": len(eligible_non_gold) - len(materialized),
            "blind_target_feasible": len(blind) >= blind_target,
            "dev_min_feasible": False, "blind_min_feasible": len(blind) >= blind_min,
            "transitive_group_target_feasible": len(chain_groups) >= chain_group_target,
        }

    for bucket in PRIMARY_BUCKETS:
        remaining = blind_quotas.get(bucket, 0) - blind_bucket_counts[bucket]
        picked = _pick_bucket(blind_pool, bucket, remaining, blind, seed=seed, dataset="BLIND",
                              feed_share_cap=feed_cap, source_pair_share_cap=pair_cap,
                              target_size=blind_target)
        blind.extend(picked)

    blind_articles = {int(value) for row in blind for value in (row["article_a_id"], row["article_b_id"])}
    dev_pool = [row for row in candidates if not ({int(row["article_a_id"]), int(row["article_b_id"])} & blind_articles)]
    dev: list[dict[str, Any]] = []
    for bucket in PRIMARY_BUCKETS:
        dev.extend(_pick_bucket(dev_pool, bucket, dev_quotas.get(bucket, 0), dev,
                                 seed=seed, dataset="DEV", feed_share_cap=feed_cap,
                                 source_pair_share_cap=pair_cap, target_size=dev_target))
    dev_spillovers: Counter[str] = Counter()
    if len(dev) < dev_target:
        selected_counts = Counter(row["primary_bucket"] for row in dev)
        unmet_positive = max(0, dev_quotas.get("POSITIVE_SEEKING", 0) - selected_counts["POSITIVE_SEEKING"])
        unmet_hard_negative = max(0, dev_quotas.get("HARD_NEGATIVE_SEEKING", 0) - selected_counts["HARD_NEGATIVE_SEEKING"])
        spill_count = min(dev_target - len(dev), unmet_positive + unmet_hard_negative)
        for origin, deficit in (("POSITIVE_SEEKING", unmet_positive), ("HARD_NEGATIVE_SEEKING", unmet_hard_negative)):
            remaining = min(deficit, spill_count - sum(dev_spillovers.values()))
            for fallback in ("BOUNDARY_DISAGREEMENT", "DIVERSITY_CONTROL"):
                if remaining <= 0:
                    break
                picked = _pick_bucket(dev_pool, fallback, remaining, dev,
                                      seed=seed, dataset=f"DEV_SPILLOVER_{origin}_{fallback}",
                                      feed_share_cap=feed_cap, source_pair_share_cap=pair_cap,
                                      target_size=dev_target)
                dev.extend(picked)
                dev_spillovers[f"{origin}->{fallback}"] += len(picked)
                remaining -= len(picked)

    isolation_ok = True
    try:
        validate_dataset_isolation(dev, blind, gold_article_ids, gold_pair_keys)
        validate_chain_group_isolation(chain_groups, dev, blind)
        if enforce_source_diversity:
            validate_source_diversity(dev)
            validate_source_diversity(blind)
    except ValueError:
        isolation_ok = False
    feasible = (
        len(dev) >= dev_min and len(blind) >= blind_min
        and len(chain_groups) >= chain_group_target and isolation_ok
        and (not enforce_source_diversity or (
            _diversity_ok(dev, 0.20, 0.10) and _diversity_ok(blind, 0.20, 0.10)
        ))
    )
    return {"dev": dev, "blind": blind, "chain_groups": chain_groups,
            "feasible": feasible, "reason": "PASS" if feasible else "MINIMUM_OR_ISOLATION_GATE",
            "thresholds": thresholds, "dev_spillovers": dict(dev_spillovers),
            "eligible_non_gold_pair_count": len(eligible_non_gold),
            "eligible_within_p3_24h_count": len(materialized),
            "excluded_over_24h_count": len(eligible_non_gold) - len(materialized),
            "dev_target_feasible": len(dev) >= dev_target,
            "blind_target_feasible": len(blind) >= blind_target,
            "dev_min_feasible": len(dev) >= dev_min,
            "blind_min_feasible": len(blind) >= blind_min,
            "transitive_group_target_feasible": len(chain_groups) >= chain_group_target}


def _diversity_ok(rows: list[dict[str, Any]], feed_share: float, pair_share: float) -> bool:
    if not rows:
        return False
    feeds = Counter(str(feed) for row in rows for feed in (row["feed_a_id"], row["feed_b_id"]))
    pairs = Counter(_source_pair(row) for row in rows)
    return max(feeds.values(), default=0) / (2 * len(rows)) <= feed_share and max(pairs.values(), default=0) / len(rows) <= pair_share


def validate_source_diversity(
    rows: list[dict[str, Any]], *, max_single_feed_share: float = 0.20,
    max_source_pair_share: float = 0.10,
) -> bool:
    if not _diversity_ok(rows, max_single_feed_share, max_source_pair_share):
        raise ValueError("SOURCE_DIVERSITY_GATE=FAIL")
    return True


def validate_chain_group_isolation(
    groups: list[dict[str, Any]], dev: list[dict[str, Any]], blind: list[dict[str, Any]],
) -> bool:
    dev_keys = {row["pair_key"] for row in dev}
    blind_keys = {row["pair_key"] for row in blind}
    for group in groups:
        if not set(group["pair_keys"]).issubset(blind_keys):
            raise ValueError("CHAIN_GROUP_NOT_BLIND")
        if set(group["pair_keys"]) & dev_keys:
            raise ValueError("CHAIN_GROUP_CROSS_DATASET_OVERLAP")
    return True


def build_review_pack(rows: list[dict[str, Any]], *, seed: int = SEED, dataset_salt: str = "review") -> list[dict[str, str]]:
    ordered = _stable_order(rows, seed, dataset_salt)
    rng = random.Random(f"{seed}:{dataset_salt}:human-order")
    rng.shuffle(ordered)
    labels = "SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN"
    return [{
        "annotation_id": f"ANN-{index:03d}",
        "pair_key": canonical_pair_key(row["article_a_id"], row["article_b_id"]),
        "feed_a": str(row.get("feed_a", "")),
        "feed_b": str(row.get("feed_b", "")),
        "title_a": str(row.get("title_a", "")),
        "title_b": str(row.get("title_b", "")),
        "published_at_a": str(row.get("published_at_a", "")),
        "published_at_b": str(row.get("published_at_b", "")),
        "label_options": labels,
        "human_decision": "",
    } for index, row in enumerate(ordered, start=1)]


def serialize_csv(rows: list[dict[str, Any]], columns: Iterable[str] | None = None) -> bytes:
    fieldnames = list(columns or (rows[0].keys() if rows else ()))
    from io import StringIO

    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def assert_private_output_path(output_path: str | Path, repo_root: str | Path) -> bool:
    path = Path(output_path).resolve()
    repo = Path(repo_root).resolve()
    if path == repo or path.is_relative_to(repo):
        raise ValueError("PRIVATE_DATA_GIT_GATE")
    return True


def validate_reviewer_blinding(review_pack: list[dict[str, Any]]) -> bool:
    allowed = set(HUMAN_REVIEW_COLUMNS)
    for row in review_pack:
        if set(row) != allowed:
            raise ValueError("HUMAN_VIEW_MINING_METADATA_BLINDING")
        if any(row.get(key) for key in ("model_score", "qwen_score", "sampling_stratum", "predicted_label", "dataset")):
            raise ValueError("HUMAN_VIEW_MODEL_SCORE_BLINDING")
    return True


def assert_challenge_consumable(state: str) -> bool:
    if state != "OPENED_FOR_FINAL_EVALUATION":
        raise ValueError("TARGETED_GOLD_NO_TUNING_EVAL_REUSE")
    return True


def next_challenge_state(state: str, event: str) -> str:
    transitions = {
        ("SELECTED", "freeze"): "FROZEN",
        ("FROZEN", "seal_annotations"): "ANNOTATED_SEALED",
        ("ANNOTATED_SEALED", "authorize_final_evaluation"): "OPENED_FOR_FINAL_EVALUATION",
        ("OPENED_FOR_FINAL_EVALUATION", "retire"): "RETIRED_AS_BLIND",
    }
    try:
        return transitions[(state, event)]
    except KeyError as error:
        raise ValueError("BLIND_STATE_TRANSITION_INVALID") from error


def load_gold_exclusions(
    path: str | Path, *, expected_pair_count: int | None = None,
    expected_article_count: int | None = None,
) -> tuple[set[str], set[int]]:
    """Read only pair_key and article IDs; do not parse label columns."""
    with Path(path).open(newline="", encoding="utf-8-sig") as source:
        reader = csv.reader(source)
        header = next(reader)
        key_index = header.index("pair_key")
        a_index = header.index("entry_a_id")
        b_index = header.index("entry_b_id")
        pair_keys, article_ids = set(), set()
        for values in reader:
            a, b = int(values[a_index]), int(values[b_index])
            pair_keys.add(canonical_pair_key(a, b))
            article_ids.update((a, b))
    if expected_pair_count is not None and len(pair_keys) != expected_pair_count:
        raise ValueError("GOLD_V2_PAIR_COUNT_GATE=FAIL")
    if expected_article_count is not None and len(article_ids) != expected_article_count:
        raise ValueError("GOLD_V2_ARTICLE_COUNT_GATE=FAIL")
    return pair_keys, article_ids


def load_home_corpus(path: str | Path, *, expected_article_count: int | None = None) -> dict[int, dict[str, Any]]:
    result = {}
    with Path(path).open(encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            result[int(row["id"])] = row
    if expected_article_count is not None and len(result) != expected_article_count:
        raise ValueError("HOME200_ARTICLE_COUNT_GATE=FAIL")
    return result


def build_candidate_universe(
    pair_path: str | Path, corpus: dict[int, dict[str, Any]], gold_pair_keys: set[str],
    *, expected_pair_count: int | None = None,
) -> list[dict[str, Any]]:
    import sys

    research_dir = Path(__file__).resolve().parents[2]
    if str(research_dir) not in sys.path:
        sys.path.insert(0, str(research_dir))
    from harness import FeatureExtractor

    result = []
    source_row_count = 0
    seen_keys: set[str] = set()
    with Path(pair_path).open(newline="", encoding="utf-8-sig") as source:
        for raw in csv.DictReader(source):
            source_row_count += 1
            key = canonical_pair_key(raw["id_a"], raw["id_b"])
            if key in gold_pair_keys or key in seen_keys:
                continue
            seen_keys.add(key)
            a, b = int(raw["id_a"]), int(raw["id_b"])
            item_a, item_b = corpus.get(a, {}), corpus.get(b, {})
            feature_input = {
                **raw,
                "pair_key": key,
                "title_a": raw.get("title_a", ""),
                "title_b": raw.get("title_b", ""),
                "feed_a": raw.get("feed_a", ""),
                "feed_b": raw.get("feed_b", ""),
                "published_at_a": raw.get("published_at_a", "0"),
                "published_at_b": raw.get("published_at_b", "0"),
            }
            features = FeatureExtractor.extract_features(feature_input, corpus_lookup=corpus)
            row = {
                "pair_key": key,
                "article_a_id": a,
                "article_b_id": b,
                "feed_a_id": int(raw["feed_id_a"]),
                "feed_b_id": int(raw["feed_id_b"]),
                "feed_a": raw.get("feed_a", ""),
                "feed_b": raw.get("feed_b", ""),
                "title_a": raw.get("title_a", ""),
                "title_b": raw.get("title_b", ""),
                "published_at_a": _utc_timestamp(raw.get("published_at_a", "")),
                "published_at_b": _utc_timestamp(raw.get("published_at_b", "")),
                "category_a": str(item_a.get("category_id", "")),
                "category_b": str(item_b.get("category_id", "")),
                "qwen_score": float(raw.get("qwen_score", 0.0)),
                "lexical_overlap": float(features["title_overlap_coefficient"]),
                "temporal_delta_hours": float(features["published_delta_hours"]),
                "entity_anchor_overlap": float(features["entity_anchor_overlap"]),
                "number_overlap": float(features["number_overlap"]),
                "date_overlap": float(features["date_overlap"]),
                "best_rank": int(raw.get("best_rank", 0)),
            }
            result.append(row)
    if expected_pair_count is not None and source_row_count != expected_pair_count:
        raise ValueError("PAIR_UNIVERSE_ROW_COUNT_GATE=FAIL")
    return result


def _utc_timestamp(value: str) -> str:
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        return str(value)


def add_frozen_model_predictions(rows: list[dict[str, Any]]) -> None:
    """Mining descriptors only; never interpreted as expected labels."""
    from a2d.a2d_scorer_benchmark import score_family_a, score_family_b, score_family_c

    params_a = {"semantic_threshold": 0.625, "lexical_threshold": 0.35}
    params_b = {"semantic_threshold": 0.75, "max_delta_hours": 8.0}
    params_c = {"semantic_threshold": 0.70}
    for row in rows:
        scorer_row = {
            "qwen_embedding_cosine": row["qwen_score"],
            "title_overlap_coefficient": row["lexical_overlap"],
            "published_delta_hours": row["temporal_delta_hours"],
            "entity_anchor_overlap": row["entity_anchor_overlap"],
            "number_overlap": row["number_overlap"],
            "date_overlap": row["date_overlap"],
        }
        row["candidate_a"] = score_family_a(scorer_row, params_a)
        row["candidate_b"] = score_family_b(scorer_row, params_b)
        row["candidate_c"] = score_family_c(scorer_row, params_c)


def pack_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    feeds = {str(value) for row in rows for value in (row["feed_a_id"], row["feed_b_id"])}
    source_pairs = {_source_pair(row) for row in rows}
    article_categories: dict[int, str] = {}
    for row in rows:
        article_categories[int(row["article_a_id"])] = str(row.get("category_a", ""))
        article_categories[int(row["article_b_id"])] = str(row.get("category_b", ""))
    category_counts = Counter(article_categories.values())
    temporal_counts = Counter(row.get("temporal_bucket", "UNCLASSIFIED") for row in rows)
    components = _multi_pair_component_count(rows)
    return {
        "pair_count": len(rows),
        "article_count": len({int(value) for row in rows for value in (row["article_a_id"], row["article_b_id"])}),
        "unique_feed_count": len(feeds),
        "unique_source_pair_count": len(source_pairs),
        "primary_bucket_counts": dict(Counter(row["primary_bucket"] for row in rows)),
        "category_article_counts": dict(category_counts),
        "category_dominance_warning": bool(category_counts and max(category_counts.values()) / max(len(article_categories), 1) > 0.50),
        "temporal_band_counts": dict(temporal_counts),
        "multi_pair_component_count": components,
        "max_feed_endpoint_share": max(Counter(str(value) for row in rows for value in (row["feed_a_id"], row["feed_b_id"])).values(), default=0) / max(2 * len(rows), 1),
        "max_source_pair_share": max(Counter(_source_pair(row) for row in rows).values(), default=0) / max(len(rows), 1),
    }


def _multi_pair_component_count(rows: list[dict[str, Any]]) -> int:
    adjacency: dict[int, set[int]] = defaultdict(set)
    for row in rows:
        a, b = int(row["article_a_id"]), int(row["article_b_id"])
        adjacency[a].add(b)
        adjacency[b].add(a)
    visited: set[int] = set()
    count = 0
    for start in adjacency:
        if start in visited:
            continue
        stack, vertices = [start], set()
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            vertices.add(node)
            stack.extend(adjacency[node] - visited)
        edge_count = sum(len(adjacency[node]) for node in vertices) // 2
        if edge_count > 1:
            count += 1
    return count


def private_audit_sidecar(rows: list[dict[str, Any]], dataset: str, groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    group_by_key = {key: index + 1 for index, group in enumerate(groups) for key in group["pair_keys"]}
    sidecar = []
    for row in sorted(rows, key=lambda item: item["pair_key"]):
        sidecar.append({
            "pair_key": row["pair_key"],
            "dataset": dataset,
            "sampling_stratum": row["primary_bucket"],
            "mining_strata": row["mining_strata"],
            "qwen_bucket": row.get("qwen_bucket", ""),
            "lexical_bucket": row.get("lexical_bucket", ""),
            "temporal_bucket": row.get("temporal_bucket", ""),
            "A_prediction": bool(row.get("candidate_a", False)),
            "B_prediction": bool(row.get("candidate_b", False)),
            "C_prediction": bool(row.get("candidate_c", False)),
            "source_pair": _source_pair(row),
            "selection_reason": row["primary_bucket"],
            "component_group": group_by_key.get(row["pair_key"], ""),
        })
    return sidecar


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def build_dataset_artifacts(
    rows: list[dict[str, Any]], *, dataset: str, seed: int,
    input_shas: dict[str, str], groups: list[dict[str, Any]],
) -> dict[str, bytes]:
    review_rows = build_review_pack(rows, seed=seed, dataset_salt=dataset)
    validate_reviewer_blinding(review_rows)
    sidecar_rows = private_audit_sidecar(rows, dataset, groups)
    rows = sorted(rows, key=lambda row: row["pair_key"])
    stats = pack_stats(rows)
    manifest = {
        "design_version": DESIGN_VERSION,
        "dataset": dataset,
        "seed": seed,
        "input_shas": dict(sorted(input_shas.items())),
        "pair_count": len(rows),
        "article_count": stats["article_count"],
        "pair_keys": sorted(row["pair_key"] for row in rows),
        "primary_bucket_counts": stats["primary_bucket_counts"],
        "temporal_band_counts": stats["temporal_band_counts"],
        "multi_pair_component_count": stats["multi_pair_component_count"],
        "chain_group_count": len(groups),
        "new_human_labels": 0,
        "human_label_file_present": False,
    }
    return {
        "pack": serialize_csv(review_rows, HUMAN_REVIEW_COLUMNS),
        "sidecar": _json_bytes(sidecar_rows),
        "manifest": _json_bytes(manifest),
    }


def build_freeze_artifacts(
    result: dict[str, Any], *, input_shas: dict[str, str], seed: int = SEED,
) -> dict[str, bytes]:
    if not result.get("feasible"):
        raise ValueError("PACK_FREEZE=NO")
    dev, blind = result["dev"], result["blind"]
    groups = result["chain_groups"]
    validate_dataset_isolation(dev, blind, result["gold_article_ids"], result["gold_pair_keys"])
    dev_artifacts = build_dataset_artifacts(dev, dataset="DEV_AUGMENT", seed=seed,
                                            input_shas=input_shas, groups=[])
    blind_artifacts = build_dataset_artifacts(blind, dataset="BLIND_CHALLENGE", seed=seed,
                                              input_shas=input_shas, groups=groups)
    counts = {"dev": pack_stats(dev), "blind": pack_stats(blind)}
    freeze = freeze_manifest(input_shas, dev_artifacts, blind_artifacts, counts)
    freeze["dev_blind_pair_overlap"] = len(
        {row["pair_key"] for row in dev} & {row["pair_key"] for row in blind}
    )
    dev_articles = {value for row in dev for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    blind_articles = {value for row in blind for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    freeze["dev_blind_article_overlap"] = len(dev_articles & blind_articles)
    freeze["blind_gold_v2_article_overlap"] = len(blind_articles & result["gold_article_ids"])
    return {
        "dev/annotation-pack-v1.csv": dev_artifacts["pack"],
        "dev/audit-sidecar-v1.json": dev_artifacts["sidecar"],
        "dev/selection-manifest-v1.json": dev_artifacts["manifest"],
        "blind/annotation-pack-v1.csv": blind_artifacts["pack"],
        "blind/audit-sidecar-v1.json": blind_artifacts["sidecar"],
        "blind/selection-manifest-v1.json": blind_artifacts["manifest"],
        "freeze-manifest-v1.json": _json_bytes(freeze),
    }


def write_private_artifacts(
    output_root: str | Path, repo_root: str | Path, artifacts: dict[str, bytes],
) -> dict[str, str]:
    root = Path(output_root).resolve()
    assert_private_output_path(root, repo_root)
    root.mkdir(parents=True, exist_ok=True)
    if any("human-label" in path.name.lower() for path in root.rglob("*")):
        raise ValueError("HUMAN_LABEL_FILE_PRESENT; refusing to modify annotation workspace")
    for relative, content in artifacts.items():
        path = root / relative
        if path.exists() and relative != "freeze-manifest-v1.json" and path.read_bytes() != content:
            raise ValueError("PRIVATE_OUTPUT_EXISTS_MISMATCH; refusing to overwrite a frozen artifact")
    freeze_path = root / "freeze-manifest-v1.json"
    if freeze_path.exists():
        existing_freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
        freeze_fields = {
            "dev/annotation-pack-v1.csv": "dev_pack_sha256",
            "dev/audit-sidecar-v1.json": "dev_sidecar_sha256",
            "dev/selection-manifest-v1.json": "dev_manifest_sha256",
            "blind/annotation-pack-v1.csv": "blind_pack_sha256",
            "blind/audit-sidecar-v1.json": "blind_sidecar_sha256",
            "blind/selection-manifest-v1.json": "blind_manifest_sha256",
        }
        for relative, field in freeze_fields.items():
            expected = hashlib.sha256(artifacts[relative]).hexdigest()
            if existing_freeze.get(field) != expected:
                raise ValueError("PRIVATE_FREEZE_EXISTS_MISMATCH; refusing to replace frozen state")
    hashes = {}
    for relative, content in artifacts.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(content)
        hashes[relative] = sha256_file(path)
    if not verify_freeze_artifacts(root):
        raise ValueError("FREEZE_VERIFIER=FAIL")
    return hashes


def verify_freeze_artifacts(root: str | Path) -> bool:
    base = Path(root)
    freeze_path = base / "freeze-manifest-v1.json"
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    pairs = (
        ("dev/annotation-pack-v1.csv", "dev_pack_sha256"),
        ("dev/audit-sidecar-v1.json", "dev_sidecar_sha256"),
        ("dev/selection-manifest-v1.json", "dev_manifest_sha256"),
        ("blind/annotation-pack-v1.csv", "blind_pack_sha256"),
        ("blind/audit-sidecar-v1.json", "blind_sidecar_sha256"),
        ("blind/selection-manifest-v1.json", "blind_manifest_sha256"),
    )
    for relative, field in pairs:
        if sha256_file(base / relative) != freeze[field]:
            raise ValueError("FREEZE_SHA_GATE=FAIL")
    for relative in ("dev/annotation-pack-v1.csv", "blind/annotation-pack-v1.csv"):
        with (base / relative).open(newline="", encoding="utf-8") as source:
            reader = csv.DictReader(source)
            if tuple(reader.fieldnames or ()) != HUMAN_REVIEW_COLUMNS:
                raise ValueError("HUMAN_VIEW_MINING_METADATA_BLINDING=FAIL")
            if any(row.get("human_decision", "") for row in reader):
                raise ValueError("NEW_HUMAN_LABELS=FAIL")
    for relative in ("dev/audit-sidecar-v1.json", "blind/audit-sidecar-v1.json"):
        sidecar = json.loads((base / relative).read_text(encoding="utf-8"))
        forbidden = {"human_decision", "gold_label", "expected_label", "predicted_label"}
        if any(forbidden & set(row) for row in sidecar):
            raise ValueError("SIDECAR_LABEL_LEAKAGE=FAIL")
    if any("human-label" in path.name.lower() for path in base.rglob("*")):
        raise ValueError("HUMAN_LABEL_FILE_PRESENT=FAIL")
    if any(freeze[key] != 0 for key in (
        "dev_blind_pair_overlap", "dev_blind_article_overlap", "blind_gold_v2_article_overlap"
    )):
        raise ValueError("FREEZE_ISOLATION_GATE=FAIL")
    if freeze.get("blind_state") != "FROZEN":
        raise ValueError("BLIND_STATE_GATE=FAIL")
    return True


def freeze_manifest(input_shas: dict[str, str], dev: dict[str, bytes], blind: dict[str, bytes], counts: dict[str, Any]) -> dict[str, Any]:
    return {
        "design_version": DESIGN_VERSION,
        "main_sha": "b82a52938d6dddbb34afab6e598b5cbabc40dda6",
        "upstream_sha": "f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b",
        "input_shas": input_shas,
        "seed": SEED,
        "dev_pair_count": counts["dev"]["pair_count"],
        "dev_article_count": counts["dev"]["article_count"],
        "dev_pack_sha256": hashlib.sha256(dev["pack"]).hexdigest(),
        "dev_sidecar_sha256": hashlib.sha256(dev["sidecar"]).hexdigest(),
        "dev_manifest_sha256": hashlib.sha256(dev["manifest"]).hexdigest(),
        "blind_pair_count": counts["blind"]["pair_count"],
        "blind_article_count": counts["blind"]["article_count"],
        "blind_pack_sha256": hashlib.sha256(blind["pack"]).hexdigest(),
        "blind_sidecar_sha256": hashlib.sha256(blind["sidecar"]).hexdigest(),
        "blind_manifest_sha256": hashlib.sha256(blind["manifest"]).hexdigest(),
        "dev_blind_pair_overlap": 0,
        "dev_blind_article_overlap": 0,
        "blind_gold_v2_article_overlap": 0,
        "blind_state": "FROZEN",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def run_canonical_audit(
    repo_root: str | Path, *, gold_path: str | Path, home_path: str | Path,
    pair_path: str | Path, human_label_hash_path: str | Path,
) -> dict[str, Any]:
    repo = Path(repo_root).resolve()
    verify_frozen_inputs(gold_path, home_path, pair_path)
    # Hash only for provenance; the human-label artifact is never parsed or materialized.
    verify_sha(human_label_hash_path, EXPECTED_HUMAN_LABEL_SHA, "HUMAN_LABEL_SHA_GATE")
    gold_pairs, gold_articles = load_gold_exclusions(
        gold_path, expected_pair_count=EXPECTED_GOLD_PAIR_COUNT,
        expected_article_count=EXPECTED_GOLD_ARTICLE_COUNT,
    )
    corpus = load_home_corpus(home_path, expected_article_count=EXPECTED_HOME_ARTICLE_COUNT)
    candidates = build_candidate_universe(
        pair_path, corpus, gold_pairs, expected_pair_count=EXPECTED_PAIR_UNIVERSE_COUNT,
    )
    if len(candidates) != EXPECTED_NON_GOLD_PAIR_COUNT:
        raise ValueError("ELIGIBLE_NON_GOLD_PAIR_COUNT_GATE=FAIL")
    add_frozen_model_predictions(candidates)
    result = select_joint_packs(
        candidates,
        gold_pair_keys=gold_pairs,
        gold_article_ids=gold_articles,
        seed=SEED,
        dev_target=80,
        blind_target=48,
        dev_min=60,
        blind_min=32,
        dev_quotas=DEV_QUOTAS,
        blind_quotas=BLIND_QUOTAS,
        chain_group_target=6,
        enforce_source_diversity=True,
    )
    result["eligible_non_gold_pair_count"] = len(candidates)
    result["eligible_within_p3_24h_count"] = result.get("eligible_within_p3_24h_count", 0)
    result["gold_article_count"] = len(gold_articles)
    result["unseen_gold_article_count"] = len(set(corpus) - gold_articles)
    result["unseen_blind_candidate_count"] = sum(
        1 for row in candidates
        if int(row["article_a_id"]) not in gold_articles and int(row["article_b_id"]) not in gold_articles
    )
    result["blind_gold_article_disjoint_feasible"] = (
        len(result["blind"]) >= 32
        and not ({int(value) for row in result["blind"] for value in (row["article_a_id"], row["article_b_id"])} & gold_articles)
    )
    result["source_diversity_feasible"] = (
        _diversity_ok(result["blind"], 0.20, 0.10) and _diversity_ok(result["dev"], 0.20, 0.10)
        if result["blind"] and result["dev"] else False
    )
    result["inputs"] = {"gold": sha256_file(gold_path), "home": sha256_file(home_path), "pairs": sha256_file(pair_path)}
    result["human_label_hash"] = sha256_file(human_label_hash_path)
    result["gold_pair_keys"] = gold_pairs
    result["gold_article_ids"] = gold_articles
    result["repo_root"] = str(repo)
    return result
