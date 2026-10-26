#!/usr/bin/env python3
"""Run the aggregate A2D2 feasibility audit; private pack writing is opt-in."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from sampler import (
    assert_private_output_path,
    build_freeze_artifacts,
    pack_stats,
    run_canonical_audit,
    verify_freeze_artifacts,
    write_private_artifacts,
)


DEFAULT_PRIVATE = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/story02-a2d2")
DEFAULT_GOLD = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/story02-gold-v2/story-identity-gold-v2.csv")
DEFAULT_HUMAN_LABEL_HASH_ONLY = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/story02-gold-v2/human-labels-v1.csv")
DEFAULT_HOME = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl")
DEFAULT_PAIRS = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv")


def aggregate_pack(rows: list[dict], groups: list[dict]) -> dict:
    stats = pack_stats(rows)
    return {
        "pair_count": stats["pair_count"],
        "unique_articles": stats["article_count"],
        "unique_feeds": stats["unique_feed_count"],
        "unique_source_pairs": stats["unique_source_pair_count"],
        "primary_strata": stats["primary_bucket_counts"],
        "temporal_bands": stats["temporal_band_counts"],
        "multi_pair_component_count": stats["multi_pair_component_count"],
        "chain_group_count": len(groups),
        "max_single_feed_share": round(stats["max_feed_endpoint_share"], 4),
        "max_source_pair_share": round(stats["max_source_pair_share"], 4),
        "category_dominance_warning": stats["category_dominance_warning"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--human-label-hash-only", type=Path, default=DEFAULT_HUMAN_LABEL_HASH_ONLY)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--pairs", type=Path, default=DEFAULT_PAIRS)
    parser.add_argument("--freeze", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_PRIVATE)
    args = parser.parse_args()

    result = run_canonical_audit(
        Path(__file__).resolve().parents[5],
        gold_path=args.gold,
        human_label_hash_path=args.human_label_hash_only,
        home_path=args.home,
        pair_path=args.pairs,
    )
    dev = aggregate_pack(result["dev"], [])
    blind = aggregate_pack(result["blind"], result["chain_groups"])
    dev_articles = {value for row in result["dev"] for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    blind_articles = {value for row in result["blind"] for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    dev_keys = {row["pair_key"] for row in result["dev"]}
    blind_keys = {row["pair_key"] for row in result["blind"]}
    output = {
        "input_sha_gates": {"gold": "PASS", "human_label_hash_only": "PASS_CONTENT_NOT_PARSED", "home200": "PASS", "pair_universe": "PASS"},
        "eligible_non_gold_pairs": result["eligible_non_gold_pair_count"],
        "eligible_pairs_within_24h": result["eligible_within_p3_24h_count"],
        "eligible_pairs_excluded_over_24h": result["excluded_over_24h_count"],
        "gold_v2_unique_articles": result["gold_article_count"],
        "unseen_gold_articles": result["unseen_gold_article_count"],
        "unseen_gold_only_pair_pool": result["unseen_blind_candidate_count"],
        "feature_thresholds_unlabeled_quantiles": result["thresholds"],
        "dev": dev,
        "blind": blind,
        "dev_target_feasible": result["dev_target_feasible"],
        "blind_target_feasible": result["blind_target_feasible"],
        "dev_minimum_feasible": result["dev_min_feasible"],
        "blind_minimum_feasible": result["blind_min_feasible"],
        "dev_blind_pair_overlap": len(dev_keys & blind_keys),
        "dev_blind_article_overlap": len(dev_articles & blind_articles),
        "blind_gold_article_overlap": len(blind_articles & result["gold_article_ids"]),
        "chain_group_target_feasible": result["transitive_group_target_feasible"],
        "source_diversity_feasible": result["source_diversity_feasible"],
        "dev_spillovers": result["dev_spillovers"],
        "pack_freeze_feasible": result["feasible"],
        "freeze_reason": result["reason"],
    }
    print(json.dumps(output, sort_keys=True, indent=2))

    if args.freeze:
        if not result["feasible"]:
            raise SystemExit("PACK_FREEZE=NO; private outputs not written")
        assert_private_output_path(args.output, Path(__file__).resolve().parents[5])
        artifacts = build_freeze_artifacts(result, input_shas=result["inputs"])
        hashes = write_private_artifacts(args.output, Path(__file__).resolve().parents[5], artifacts)
        if not verify_freeze_artifacts(args.output):
            raise SystemExit("FREEZE_VERIFIER=FAIL")
        print(json.dumps({"private_artifact_hashes": hashes, "freeze_verifier": "PASS"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
