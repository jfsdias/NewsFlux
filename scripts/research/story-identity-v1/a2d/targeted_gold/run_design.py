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
    assert_distinct_private_freeze_path,
    build_freeze_v2_artifacts,
    graph_component_stats,
    pack_stats,
    run_canonical_audit,
    verify_freeze_artifacts,
    write_private_artifacts,
    V1_PRIVATE_ROOT,
    V2_PRIVATE_ROOT,
    BLIND_QUOTAS,
    DEV_QUOTAS,
    SUPERSEDED_V1_FREEZE_SHA,
    verify_sha,
)
from joint_search import candidate_inventory, prepare_search_candidates, search_joint_packs
from component_search import search_components, validate_witness


DEFAULT_PRIVATE = V2_PRIVATE_ROOT
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
        "graph_component_stats": graph_component_stats(rows),
        "chain_group_count": len(groups),
        "max_single_feed_share": round(stats["max_feed_endpoint_share"], 4),
        "max_source_pair_share": round(stats["max_source_pair_share"], 4),
        "category_dominance_warning": stats["category_dominance_warning"],
    }


def canonical_search(args: argparse.Namespace) -> dict:
    r1 = run_canonical_audit(
        Path(__file__).resolve().parents[5],
        gold_path=args.gold,
        human_label_hash_path=args.human_label_hash_only,
        home_path=args.home,
        pair_path=args.pairs,
        include_candidates=True,
    )
    blind_pool, dev_pool = prepare_search_candidates(
        r1.pop("candidate_universe"), gold_pair_keys=r1["gold_pair_keys"],
        gold_article_ids=r1["gold_article_ids"],
    )
    inventory = candidate_inventory(blind_pool, BLIND_QUOTAS)
    if inventory["raw_bucket_capacity_gate"] != "PASS":
        return {"r1": r1, "inventory": inventory, "search": {
            "status": "COMPONENT_SEARCH_PROVEN_INFEASIBLE" if args.method == "component" else "PROVEN_INFEASIBLE",
            "reason": "RAW_BUCKET_CAPACITY",
            "search_complete": True,
            "node_limit": args.component_node_limit if args.method == "component" else args.search_limit,
            "certificate": {"nodes_explored": 0, "nodes_pruned": 0},
            "blind": [], "dev": [], "chain_groups": [], "feasible_witness_found": False,
        }}
    if args.method == "component":
        search = search_components(
            blind_pool, dev_pool, blind_quotas=BLIND_QUOTAS, dev_quotas=DEV_QUOTAS,
            gold_pair_keys=r1["gold_pair_keys"], gold_article_ids=r1["gold_article_ids"],
            node_limit=args.component_node_limit, restarts=args.restarts,
            variants=args.variants, solver_seconds=args.solver_seconds,
            max_candidate_attempts=args.max_candidate_attempts,
        )
        search.update({"method": "COMPONENT_FIRST", "global_optimality_required": False,
                       "global_optimality_proven": False})
    else:
        search = search_joint_packs(
            blind_pool, dev_pool, blind_quotas=BLIND_QUOTAS, dev_quotas=DEV_QUOTAS,
            gold_pair_keys=r1["gold_pair_keys"], gold_article_ids=r1["gold_article_ids"],
            node_limit=args.search_limit,
        )
    return {"r1": r1, "inventory": inventory, "search": search}


def freeze_result(run: dict) -> dict:
    search, r1 = run["search"], run["r1"]
    component_witness = search.get("method") == "COMPONENT_FIRST" and search["status"] == "FEASIBLE_WITNESS_FOUND"
    exhaustive_witness = search["status"] == "FEASIBLE" and search["search_complete"]
    if not (component_witness or exhaustive_witness):
        raise ValueError("PACK_FREEZE_V2=NO")
    if component_witness:
        validate_witness(search["blind"], search["dev"], gold_pair_keys=r1["gold_pair_keys"],
                         gold_article_ids=r1["gold_article_ids"])
    return {
        "feasible": True, "exact_quotas_feasible": True,
        "dev": search["dev"], "blind": search["blind"],
        "chain_groups": search["chain_groups"], "gold_article_ids": r1["gold_article_ids"],
        "gold_pair_keys": r1["gold_pair_keys"], "search": search,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--human-label-hash-only", type=Path, default=DEFAULT_HUMAN_LABEL_HASH_ONLY)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--pairs", type=Path, default=DEFAULT_PAIRS)
    parser.add_argument("--search-limit", type=int, default=500000)
    parser.add_argument("--method", choices=("component", "edge"), default="component")
    parser.add_argument("--component-node-limit", type=int, default=1000)
    parser.add_argument("--restarts", type=int, default=3)
    parser.add_argument("--variants", type=int, default=4)
    parser.add_argument("--solver-seconds", type=float, default=20.0)
    parser.add_argument("--max-candidate-attempts", type=int, default=4)
    parser.add_argument("--freeze", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_PRIVATE)
    args = parser.parse_args()

    run = canonical_search(args)
    result, r1 = run["search"], run["r1"]
    dev_rows, blind_rows = result["dev"], result["blind"]
    dev_articles = {value for row in dev_rows for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    blind_articles = {value for row in blind_rows for value in (int(row["article_a_id"]), int(row["article_b_id"]))}
    dev_keys = {row["pair_key"] for row in dev_rows}
    blind_keys = {row["pair_key"] for row in blind_rows}
    witness = result["feasible_witness_found"]
    output = {
        "input_sha_gates": {"gold": "PASS", "human_label_hash_only": "PASS_CONTENT_NOT_PARSED", "home200": "PASS", "pair_universe": "PASS"},
        "inventory": run["inventory"],
        "search_algorithm": "COMPONENT_FIRST_FEASIBLE_WITNESS" if args.method == "component" else "DETERMINISTIC_JOINT_BRANCH_AND_BOUND",
        "search_status": result["status"],
        "search_complete": result["search_complete"],
        "search_node_limit": result.get("node_limit", args.component_node_limit),
        "search_certificate": result["certificate"],
        "motif_inventory": result.get("inventory"),
        "solver": result.get("solver"),
        "solver_version": result.get("solver_version"),
        "restart_count": result.get("restarts"),
        "witness_restart_index": result.get("witness_restart_index"),
        "global_optimality_required": False if args.method == "component" else True,
        "global_optimality_proven": result.get("global_optimality_proven", False),
        "independent_witness_validator": "PASS" if witness and args.method == "component" else "NOT_RUN",
        "chain_group_bridging_count": result.get("validation", {}).get("chain_group_bridging_count"),
        "feasible_witness_found": result["feasible_witness_found"],
        "objective_optimality": result.get("objective_optimality", "NOT_APPLICABLE"),
        "dev": aggregate_pack(dev_rows, []) if dev_rows else None,
        "blind": aggregate_pack(blind_rows, result["chain_groups"]) if blind_rows else None,
        "dev_blind_pair_overlap": len(dev_keys & blind_keys) if witness else None,
        "dev_blind_article_overlap": len(dev_articles & blind_articles) if witness else None,
        "dev_gold_pair_overlap": len(dev_keys & r1["gold_pair_keys"]) if witness else None,
        "blind_gold_pair_overlap": len(blind_keys & r1["gold_pair_keys"]) if witness else None,
        "blind_gold_article_overlap": len(blind_articles & r1["gold_article_ids"]) if witness else None,
        "pack_freeze_feasible": result["status"] == "FEASIBLE_WITNESS_FOUND" or (
            result["status"] == "FEASIBLE" and result["search_complete"]
        ),
    }
    print(json.dumps(output, sort_keys=True, indent=2))

    if args.freeze:
        if not output["pack_freeze_feasible"]:
            raise SystemExit("PACK_FREEZE_V2=NO; private outputs not written")
        if args.output.resolve() != V2_PRIVATE_ROOT.resolve():
            raise SystemExit("V2_OUTPUT_PATH_GATE=FAIL")
        assert_private_output_path(args.output, Path(__file__).resolve().parents[5])
        assert_distinct_private_freeze_path(args.output, V1_PRIVATE_ROOT)
        verify_sha(V1_PRIVATE_ROOT / "freeze-manifest-v1.json", SUPERSEDED_V1_FREEZE_SHA, "V1_FREEZE_SHA_GATE")
        repeat = canonical_search(args)
        first_result, second_result = freeze_result(run), freeze_result(repeat)
        for dataset in ("dev", "blind"):
            if {row["pair_key"] for row in first_result[dataset]} != {row["pair_key"] for row in second_result[dataset]}:
                raise SystemExit("REAL_V2_SELECTION_IDENTITY_GATE=FAIL")
        first_inputs = {**r1["inputs"], "human_label_hash_only": r1["human_label_hash"]}
        repeat_inputs = {
            **repeat["r1"]["inputs"], "human_label_hash_only": repeat["r1"]["human_label_hash"],
        }
        artifacts = build_freeze_v2_artifacts(first_result, input_shas=first_inputs)
        repeated = build_freeze_v2_artifacts(second_result, input_shas=repeat_inputs)
        if artifacts != repeated:
            raise SystemExit("REAL_V2_ARTIFACT_IDENTITY_GATE=FAIL")
        hashes = write_private_artifacts(args.output, Path(__file__).resolve().parents[5], artifacts)
        if not verify_freeze_artifacts(args.output, freeze_manifest_name="freeze-manifest-v2.json"):
            raise SystemExit("FREEZE_VERIFIER=FAIL")
        verify_sha(V1_PRIVATE_ROOT / "freeze-manifest-v1.json", SUPERSEDED_V1_FREEZE_SHA, "V1_FREEZE_SHA_GATE")
        print(json.dumps({"private_artifact_hashes": hashes, "freeze_verifier": "PASS"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
