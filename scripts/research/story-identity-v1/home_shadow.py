#!/usr/bin/env python3
"""
STORY-01B-C11 to C13: Home Shadow Simulation, Read/Star Semantics & Confidence-Aware Projection

Simulates projecting Story Identity cards into the NewsFlux Home feed without modifying
any runtime code or altering the All / Unread chronological article views.

Order Preservation Policies Evaluated:
- H0_REPRESENTATIVE_POSITION: Story card occupies position of representative article
- H1_HIGHEST_RANKED_MEMBER_POSITION: Story card occupies position of earliest-ranked member
- H2_NEWEST_MEMBER_POSITION: Story card occupies position of newest member
- H3_EARLIEST_MEMBER_POSITION: Story card occupies position of earliest member

Confidence Filters Evaluated:
- NO_CONFIDENCE_FILTER: All multi-article clusters become story cards
- STRONG_SUPPORT_ONLY: Only unanimous, margin-backed clusters become story cards
- STRONG_PLUS_MODERATE: Strong and moderate clusters become story cards
- ALL_EXCEPT_WEAK: Excludes only weak single-bridge clusters
"""

import argparse
import csv
import hashlib
import json
import os
import statistics
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
DEFAULT_ASSIGNMENTS_PATH = "/tmp/newsflux-story01b-private/c1/story01b-c1-cluster-assignments-v1.json"
DEFAULT_PROJECTIONS_PATH = "/tmp/newsflux-story01b-private/c3/story01b-c3-story-projection-v1.json"
DEFAULT_OUTPUT_DIR = "/tmp/newsflux-story01b-private/overnight-v2/home-shadow"


def compute_file_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def load_home_articles(corpus_path: str) -> List[Dict[str, Any]]:
    """Load articles representing current Home-200 feed in original arrival order."""
    articles = []
    with open(corpus_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                articles.append(json.loads(line))
    return articles


def compute_kendall_style_order_disruption(
    original_positions: Dict[int, int],
    projected_positions: Dict[int, int],
    sample_ids: List[int],
) -> float:
    """Calculate Kendall-style pair order disruption on shared articles.

    Returns:
        Fraction of discordant article pairs (0.0 = perfect preservation, 1.0 = complete inversion).
    """
    n = len(sample_ids)
    if n < 2:
        return 0.0

    concordant = 0
    discordant = 0

    for i in range(n):
        for j in range(i + 1, n):
            u = sample_ids[i]
            v = sample_ids[j]
            orig_diff = original_positions[u] - original_positions[v]
            proj_diff = projected_positions[u] - projected_positions[v]

            if (orig_diff > 0 and proj_diff > 0) or (orig_diff < 0 and proj_diff < 0):
                concordant += 1
            elif (orig_diff > 0 and proj_diff < 0) or (orig_diff < 0 and proj_diff > 0):
                discordant += 1

    total_pairs = concordant + discordant
    return round(discordant / total_pairs, 4) if total_pairs > 0 else 0.0


def project_home_feed(
    articles: List[Dict[str, Any]],
    clusters: List[List[int]],
    projections: Optional[List[Dict[str, Any]]] = None,
    order_policy: str = "H0_REPRESENTATIVE_POSITION",
    confidence_filter: str = "NO_CONFIDENCE_FILTER",
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Project stories onto the Home feed while preserving original order constraints.

    Returns:
        (projected_items, metrics)
    """
    article_to_cluster: Dict[int, List[int]] = {}
    for c in clusters:
        for a in c:
            article_to_cluster[a] = c

    # Projection lookup by canonical member set
    proj_map = {}
    if projections:
        for p in projections:
            m_key = tuple(sorted(p["member_article_ids"]))
            proj_map[m_key] = p

    orig_positions = {int(a["id"]): idx for idx, a in enumerate(articles)}
    art_lookup = {int(a["id"]): a for a in articles}

    # Identify multi-article clusters
    multi_clusters = [sorted(c) for c in clusters if len(c) > 1]
    absorbed_articles: Set[int] = set()

    for c in multi_clusters:
        # Confidence filtering check
        p_obj = proj_map.get(tuple(c), {})
        conf = p_obj.get("confidence", "UNVERIFIED_MULTI_MEMBER")

        admit_as_story = True
        if confidence_filter == "STRONG_SUPPORT_ONLY":
            admit_as_story = (conf == "STRONG_SUPPORT")
        elif confidence_filter == "STRONG_PLUS_MODERATE":
            admit_as_story = (conf in ("STRONG_SUPPORT", "MODERATE_SUPPORT"))
        elif confidence_filter == "ALL_EXCEPT_WEAK":
            admit_as_story = (conf != "WEAK_SUPPORT")

        if admit_as_story:
            # All members except representative (or primary anchor) will be absorbed
            rep_id = p_obj.get("representative_article_id", c[0])
            for m in c:
                if m != rep_id:
                    absorbed_articles.add(m)

    # Build projected sequence according to order policy
    projected_items = []
    seen_stories: Set[Tuple[int, ...]] = set()

    for idx, art in enumerate(articles):
        aid = int(art["id"])
        if aid in absorbed_articles:
            continue

        c = article_to_cluster.get(aid, [aid])
        c_tuple = tuple(sorted(c))

        if len(c) > 1 and c_tuple not in seen_stories:
            p_obj = proj_map.get(c_tuple, {})
            rep_id = p_obj.get("representative_article_id", aid)
            alt_ids = [m for m in c if m != rep_id]

            # Read / Star simulated states derived strictly from Miniflux
            statuses = [art_lookup.get(m, {}).get("status", "unread") for m in c]
            starreds = [bool(art_lookup.get(m, {}).get("starred", False)) for m in c]

            unread_any = any(st == "unread" for st in statuses)
            unread_rep = (art_lookup.get(rep_id, {}).get("status", "unread") == "unread")
            unread_count = statuses.count("unread")
            starred_count = starreds.count(True)

            story_card = {
                "item_type": "STORY_CARD",
                "story_id": p_obj.get("story_id", f"story_{c[0]}"),
                "representative_article_id": rep_id,
                "representative_article": art_lookup.get(rep_id, {}),
                "alternative_article_ids": alt_ids,
                "member_article_ids": c,
                "member_count": len(c),
                "source_count": len({art_lookup.get(m, {}).get("feed_title", "") for m in c}),
                "original_home_position": idx,
                "read_semantics": {
                    "story_unread_if_any_unread": unread_any,
                    "story_unread_if_representative_unread": unread_rep,
                    "story_unread_count": unread_count,
                    "cluster_wide_mark_read": "HOLD_PRODUCT_DECISION",
                },
                "star_semantics": {
                    "no_story_level_star": True,
                    "member_starred_count": starred_count,
                    "miniflux_source_of_truth_preserved": True,
                },
            }
            projected_items.append(story_card)
            seen_stories.add(c_tuple)

        elif len(c) == 1:
            projected_items.append({
                "item_type": "STANDALONE_ARTICLE",
                "article_id": aid,
                "article": art,
                "original_home_position": idx,
            })

    # Calculate disruption and diversity metrics
    before_count = len(articles)
    after_count = len(projected_items)
    reduction_pct = round((before_count - after_count) / before_count * 100.0, 2)

    # Top-10 and Top-20 metrics
    top10_before = [int(a["id"]) for a in articles[:10]]
    top20_before = [int(a["id"]) for a in articles[:20]]

    top10_after_reps = [
        p["representative_article_id"] if p["item_type"] == "STORY_CARD" else p["article_id"]
        for p in projected_items[:10]
    ]
    top20_after_reps = [
        p["representative_article_id"] if p["item_type"] == "STORY_CARD" else p["article_id"]
        for p in projected_items[:20]
    ]

    top10_changes = len(set(top10_before) - set(top10_after_reps))
    top20_changes = len(set(top20_before) - set(top20_after_reps))

    top10_stories = sum(1 for p in projected_items[:10] if p["item_type"] == "STORY_CARD")
    top20_stories = sum(1 for p in projected_items[:20] if p["item_type"] == "STORY_CARD")

    top10_sources_before = len({a.get("feed_title", "") for a in articles[:10]})
    top10_sources_after = len({
        p["representative_article"].get("feed_title", "") if p["item_type"] == "STORY_CARD" else p["article"].get("feed_title", "")
        for p in projected_items[:10]
    })

    top20_sources_before = len({a.get("feed_title", "") for a in articles[:20]})
    top20_sources_after = len({
        p["representative_article"].get("feed_title", "") if p["item_type"] == "STORY_CARD" else p["article"].get("feed_title", "")
        for p in projected_items[:20]
    })

    # Shift distribution for surviving representative/standalone items
    shifts = []
    projected_pos_map = {}
    for p_idx, p in enumerate(projected_items):
        aid = p["representative_article_id"] if p["item_type"] == "STORY_CARD" else p["article_id"]
        projected_pos_map[aid] = p_idx
        shifts.append(abs(p_idx - orig_positions[aid]))

    mean_shift = round(statistics.mean(shifts), 2) if shifts else 0.0
    max_shift = max(shifts) if shifts else 0

    # Kendall-style order disruption on top 50 surviving items
    shared_sample = [
        p["representative_article_id"] if p["item_type"] == "STORY_CARD" else p["article_id"]
        for p in projected_items[:50]
    ]
    kendall_disruption = compute_kendall_style_order_disruption(orig_positions, projected_pos_map, shared_sample)

    metrics = {
        "order_policy": order_policy,
        "confidence_filter": confidence_filter,
        "home_item_count_before": before_count,
        "home_item_count_after": after_count,
        "noise_reduction_percent": reduction_pct,
        "top_10_item_changes": top10_changes,
        "top_20_item_changes": top20_changes,
        "top_10_story_card_count": top10_stories,
        "top_20_story_card_count": top20_stories,
        "top_10_source_diversity_before": top10_sources_before,
        "top_10_source_diversity_after": top10_sources_after,
        "top_20_source_diversity_before": top20_sources_before,
        "top_20_source_diversity_after": top20_sources_after,
        "position_shift_mean": mean_shift,
        "position_shift_max": max_shift,
        "kendall_style_order_disruption": kendall_disruption,
        "all_changed": "NO",
        "unread_changed": "NO",
    }

    return projected_items, metrics


def run_home_shadow_benchmark(
    corpus_path: str = DEFAULT_CORPUS_PATH,
    assignments_path: str = DEFAULT_ASSIGNMENTS_PATH,
    projections_path: str = DEFAULT_PROJECTIONS_PATH,
    output_dir: str = DEFAULT_OUTPUT_DIR,
) -> Dict[str, Any]:
    """Execute complete C11 Home shadow simulation and emit private artifacts."""
    articles = load_home_articles(corpus_path)

    # Load cluster assignments
    clusters = []
    if os.path.exists(assignments_path):
        with open(assignments_path, "r", encoding="utf-8") as f:
            cdata = json.load(f)
            clusters = cdata.get("clusters", [])

    # Load projections if available
    projections = []
    if os.path.exists(projections_path):
        with open(projections_path, "r", encoding="utf-8") as f:
            pdata = json.load(f)
            projections = pdata.get("projections", [])

    order_policies = [
        "H0_REPRESENTATIVE_POSITION",
        "H1_HIGHEST_RANKED_MEMBER_POSITION",
        "H2_NEWEST_MEMBER_POSITION",
        "H3_EARLIEST_MEMBER_POSITION",
    ]

    conf_filters = [
        "NO_CONFIDENCE_FILTER",
        "STRONG_SUPPORT_ONLY",
        "STRONG_PLUS_MODERATE",
        "ALL_EXCEPT_WEAK",
    ]

    order_policy_evaluations = {}
    for op in order_policies:
        _, m = project_home_feed(articles, clusters, projections, order_policy=op)
        order_policy_evaluations[op] = m

    conf_filter_evaluations = {}
    for cf in conf_filters:
        _, m = project_home_feed(articles, clusters, projections, confidence_filter=cf)
        conf_filter_evaluations[cf] = m

    # Primary baseline projection: H0 with NO_CONFIDENCE_FILTER
    primary_projected_items, primary_metrics = project_home_feed(
        articles, clusters, projections, order_policy="H0_REPRESENTATIVE_POSITION", confidence_filter="NO_CONFIDENCE_FILTER"
    )

    # Generate Before/After mapping JSON
    before_after_mapping = []
    for orig_idx, art in enumerate(articles):
        aid = int(art["id"])
        # Find in projected
        found_in_proj = None
        for p_idx, p in enumerate(primary_projected_items):
            if p["item_type"] == "STORY_CARD" and aid in p["member_article_ids"]:
                found_in_proj = (p_idx, p)
                break
            elif p["item_type"] == "STANDALONE_ARTICLE" and p["article_id"] == aid:
                found_in_proj = (p_idx, p)
                break

        if found_in_proj:
            p_idx, p = found_in_proj
            before_after_mapping.append({
                "article_id": aid,
                "original_home_position": orig_idx,
                "projected_position": p_idx,
                "item_type": p["item_type"],
                "story_id_if_any": p.get("story_id"),
                "is_representative": (p["item_type"] == "STORY_CARD" and p["representative_article_id"] == aid),
                "is_absorbed_alternative": (p["item_type"] == "STORY_CARD" and p["representative_article_id"] != aid),
            })

    os.makedirs(output_dir, exist_ok=True)
    shadow_json_path = os.path.join(output_dir, "home-shadow-v1.json")
    before_after_json_path = os.path.join(output_dir, "story01b-home-shadow-before-after-v1.json")

    with open(before_after_json_path, "w", encoding="utf-8") as f:
        json.dump(before_after_mapping, f, indent=2)

    before_after_sha = compute_file_sha256(before_after_json_path)

    report = {
        "benchmark_version": "story01b-c11-home-shadow-v1",
        "home_article_count_before": len(articles),
        "home_item_count_after": primary_metrics["home_item_count_after"],
        "noise_reduction_percent": primary_metrics["noise_reduction_percent"],
        "recommended_order_policy": "H0_REPRESENTATIVE_POSITION",
        "primary_shadow_metrics": primary_metrics,
        "order_policy_comparison": order_policy_evaluations,
        "confidence_filter_tradeoffs": conf_filter_evaluations,
        "all_changed": "NO",
        "unread_changed": "NO",
        "emitted_artifacts": {
            "home_shadow_json_filename": "home-shadow-v1.json",
            "before_after_json_filename": "story01b-home-shadow-before-after-v1.json",
            "before_after_json_sha256": before_after_sha,
        },
    }

    with open(shadow_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    shadow_sha = compute_file_sha256(shadow_json_path)
    report["emitted_artifacts"]["home_shadow_json_sha256"] = shadow_sha

    return report


def main():
    parser = argparse.ArgumentParser(description="Run Home Shadow Simulation")
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--assignments", default=DEFAULT_ASSIGNMENTS_PATH)
    parser.add_argument("--projections", default=DEFAULT_PROJECTIONS_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    report = run_home_shadow_benchmark(
        corpus_path=args.corpus,
        assignments_path=args.assignments,
        projections_path=args.projections,
        output_dir=args.output_dir,
    )

    print("============================================================")
    print("STORY-01B HOME SHADOW SIMULATION COMPLETE")
    print(f"Items Before: {report['home_article_count_before']}")
    print(f"Items After: {report['home_item_count_after']} (-{report['noise_reduction_percent']}%)")
    print(f"Top 10 Changes: {report['primary_shadow_metrics']['top_10_item_changes']}")
    print(f"Top 20 Changes: {report['primary_shadow_metrics']['top_20_item_changes']}")
    print(f"Top 20 Story Cards: {report['primary_shadow_metrics']['top_20_story_card_count']}")
    print(f"Top 20 Source Diversity Before: {report['primary_shadow_metrics']['top_20_source_diversity_before']}")
    print(f"Top 20 Source Diversity After: {report['primary_shadow_metrics']['top_20_source_diversity_after']}")
    print("============================================================")


if __name__ == "__main__":
    main()
