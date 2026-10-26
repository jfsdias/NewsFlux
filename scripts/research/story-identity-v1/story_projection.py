#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Offline Story Projection Prototype (STORY-01B-C2 & C3 Stages G & H)

Objectives:
- Transform clusters into structured StoryProjection entities.
- Representative selection policies (R0 through R4):
    - R0_EARLIEST: Earliest published article
    - R1_LATEST: Latest published article
    - R2_LEXICAL_MEDOID: Central article by title lexical overlap
    - R3_QWEN_SEMANTIC_MEDOID: Central article by Qwen embedding cosine
    - R4_HYBRID_MEDOID: 0.5 * lexical centrality + 0.5 * semantic centrality
- Alternatives selection policies (A0 through A2):
    - A0_ALL_MEMBERS: All remaining members
    - A1_ONE_PER_SOURCE: At most one alternative per distinct feed
    - A2_DIVERSE_TOP_K: Max 3 diverse alternatives from distinct feeds with distinct angles
- Pure offline API (zero UI, zero Miniflux writes, zero DB).
- Deterministic projection IDs: story_{sha256(canonical_members)[:16]}
- Export private artifacts:
    - /tmp/newsflux-story01b-private/c3/story01b-c3-story-projection-v1.json
    - /tmp/newsflux-story01b-private/c3/story01b-c3-representative-comparison-v1.json
"""

import argparse
import csv
import hashlib
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from .harness import CorpusVerifier
    from .model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
    )
except ImportError:
    from harness import CorpusVerifier
    from model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
    )

DEFAULT_C3_OUTPUT_DIR = "/tmp/newsflux-story01b-private/c3"
DEFAULT_ASSIGNMENTS_PATH = "/tmp/newsflux-story01b-private/c1/story01b-c1-cluster-assignments-v1.json"
DEFAULT_SCORES_PATH = "/tmp/newsflux-story01b-private/c1/story01b-home200-b0-b4-crossfit-scores-v1.csv"


def compute_file_sha256(path: str) -> str:
    """Compute SHA256 of file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class RepresentativeSelector:
    """Deterministic selection of cluster representative article across policies R0 to R4."""

    @staticmethod
    def select(
        policy: str,
        members: List[int],
        published_lookup: Dict[int, float],
        pairwise_lexical: Dict[Tuple[int, int], float],
        pairwise_semantic: Dict[Tuple[int, int], float],
    ) -> int:
        """Select representative article ID from cluster members."""
        if len(members) == 1:
            return members[0]

        sorted_members = sorted(members)

        if policy == "R0_EARLIEST":
            # Earliest published date, tie-break on smaller ID
            return min(sorted_members, key=lambda a: (published_lookup.get(a, 0.0), a))

        elif policy == "R1_LATEST":
            # Latest published date, tie-break on smaller ID
            return max(sorted_members, key=lambda a: (published_lookup.get(a, 0.0), -a))

        elif policy == "R2_LEXICAL_MEDOID":
            # Highest average lexical overlap to other members
            best_art = sorted_members[0]
            best_centrality = -1.0
            for a in sorted_members:
                others = [m for m in sorted_members if m != a]
                ov_scores = [pairwise_lexical.get((min(a, m), max(a, m)), 0.0) for m in others]
                mean_ov = statistics.mean(ov_scores) if ov_scores else 0.0
                if mean_ov > best_centrality:
                    best_centrality = mean_ov
                    best_art = a
                elif abs(mean_ov - best_centrality) < 1e-9:
                    # Tie break: earliest publication
                    if (published_lookup.get(a, 0.0), a) < (published_lookup.get(best_art, 0.0), best_art):
                        best_art = a
            return best_art

        elif policy == "R3_QWEN_SEMANTIC_MEDOID":
            # Highest average Qwen semantic cosine to other members
            best_art = sorted_members[0]
            best_centrality = -1.0
            for a in sorted_members:
                others = [m for m in sorted_members if m != a]
                sem_scores = [pairwise_semantic.get((min(a, m), max(a, m)), 0.0) for m in others]
                mean_sem = statistics.mean(sem_scores) if sem_scores else 0.0
                if mean_sem > best_centrality:
                    best_centrality = mean_sem
                    best_art = a
                elif abs(mean_sem - best_centrality) < 1e-9:
                    if (published_lookup.get(a, 0.0), a) < (published_lookup.get(best_art, 0.0), best_art):
                        best_art = a
            return best_art

        elif policy == "R4_HYBRID_MEDOID":
            # Pre-declared: 0.5 * lexical centrality + 0.5 * semantic centrality
            best_art = sorted_members[0]
            best_score = -1.0
            for a in sorted_members:
                others = [m for m in sorted_members if m != a]
                ov_scores = [pairwise_lexical.get((min(a, m), max(a, m)), 0.0) for m in others]
                sem_scores = [pairwise_semantic.get((min(a, m), max(a, m)), 0.0) for m in others]
                mean_ov = statistics.mean(ov_scores) if ov_scores else 0.0
                mean_sem = statistics.mean(sem_scores) if sem_scores else 0.0
                hybrid = 0.5 * mean_ov + 0.5 * mean_sem
                if hybrid > best_score:
                    best_score = hybrid
                    best_art = a
                elif abs(hybrid - best_score) < 1e-9:
                    if (published_lookup.get(a, 0.0), a) < (published_lookup.get(best_art, 0.0), best_art):
                        best_art = a
            return best_art

        else:
            raise ValueError(f"Unknown representative policy: {policy}")


class AlternativesSelector:
    """Deterministic selection of alternative sources/coverage articles across policies A0 to A2."""

    @staticmethod
    def select(
        policy: str,
        members: List[int],
        representative_id: int,
        corpus_lookup: Dict[int, Dict[str, Any]],
        pairwise_lexical: Dict[Tuple[int, int], float],
        max_k: int = 3,
    ) -> List[int]:
        """Select alternative article IDs from non-representative cluster members."""
        candidates = [m for m in sorted(members) if m != representative_id]
        if not candidates:
            return []

        rep_feed = corpus_lookup[representative_id].get("feed_title", "")

        if policy == "A0_ALL_MEMBERS":
            return candidates

        elif policy == "A1_ONE_PER_SOURCE":
            # Select at most 1 article per feed (excluding representative's feed if possible)
            selected = []
            seen_feeds = {rep_feed}
            for c in candidates:
                feed = corpus_lookup[c].get("feed_title", "")
                if feed not in seen_feeds:
                    selected.append(c)
                    seen_feeds.add(feed)
            # If no other feed, include other articles
            if not selected:
                selected = candidates[:max_k]
            return selected

        elif policy == "A2_DIVERSE_TOP_K":
            # Max K alternatives, prioritizing distinct feeds and distinct title angle
            # Priority: distinct feeds first, sorted by lowest title overlap to representative
            distinct_feed_cands = []
            same_feed_cands = []

            for c in candidates:
                feed = corpus_lookup[c].get("feed_title", "")
                ov_to_rep = pairwise_lexical.get((min(c, representative_id), max(c, representative_id)), 0.0)
                if feed != rep_feed:
                    distinct_feed_cands.append((ov_to_rep, c, feed))
                else:
                    same_feed_cands.append((ov_to_rep, c, feed))

            # Pick from distinct feeds first, taking at most one per feed
            selected = []
            seen_feeds = set()
            # Sort distinct feed candidates by lowest title overlap (distinct angle)
            distinct_feed_cands.sort(key=lambda x: (x[0], x[1]))
            for ov, c, feed in distinct_feed_cands:
                if feed not in seen_feeds:
                    selected.append(c)
                    seen_feeds.add(feed)
                if len(selected) >= max_k:
                    break

            # If still space under max_k, add from remaining candidates
            if len(selected) < max_k:
                remaining = [c for c in candidates if c not in selected]
                for c in remaining:
                    selected.append(c)
                    if len(selected) >= max_k:
                        break

            return sorted(selected)

        else:
            raise ValueError(f"Unknown alternatives policy: {policy}")


def build_story_projections(
    clusters: List[List[int]],
    corpus_lookup: Dict[int, Dict[str, Any]],
    pairwise_lexical: Dict[Tuple[int, int], float],
    pairwise_semantic: Dict[Tuple[int, int], float],
    cluster_policy: str = "P1_REPRESENTATIVE_GUARD",
    rep_policy: str = "R4_HYBRID_MEDOID",
    alt_policy: str = "A2_DIVERSE_TOP_K",
) -> List[Dict[str, Any]]:
    """Construct deterministic StoryProjection objects from clusters."""
    projections = []

    # Sort clusters deterministically
    sorted_clusters = sorted([sorted(c) for c in clusters], key=lambda cl: (-len(cl), cl[0]))

    for c in sorted_clusters:
        member_ids = sorted(c)
        canonical_str = ",".join(str(m) for m in member_ids)
        story_id = f"story_{hashlib.sha256(canonical_str.encode('utf-8')).hexdigest()[:16]}"

        rep_id = RepresentativeSelector.select(
            policy=rep_policy,
            members=member_ids,
            published_lookup={m: float(corpus_lookup[m].get("published_at", 0.0)) for m in member_ids},
            pairwise_lexical=pairwise_lexical,
            pairwise_semantic=pairwise_semantic,
        )

        alt_ids = AlternativesSelector.select(
            policy=alt_policy,
            members=member_ids,
            representative_id=rep_id,
            corpus_lookup=corpus_lookup,
            pairwise_lexical=pairwise_lexical,
            max_k=3,
        )

        pub_times = [float(corpus_lookup[m].get("published_at", 0.0)) for m in member_ids]
        feeds = {corpus_lookup[m].get("feed_title", "") for m in member_ids}

        confidence = "HIGH" if len(member_ids) > 1 else "STANDALONE"

        projections.append({
            "story_id": story_id,
            "representative_article_id": rep_id,
            "alternative_article_ids": alt_ids,
            "member_article_ids": member_ids,
            "first_published_at": min(pub_times) if pub_times else 0.0,
            "last_published_at": max(pub_times) if pub_times else 0.0,
            "source_count": len(feeds),
            "member_count": len(member_ids),
            "confidence": confidence,
            "cluster_policy": cluster_policy,
            "representative_policy": rep_policy,
            "alternative_policy": alt_policy,
        })

    return projections


def compare_representative_policies(
    clusters: List[List[int]],
    corpus_lookup: Dict[int, Dict[str, Any]],
    pairwise_lexical: Dict[Tuple[int, int], float],
    pairwise_semantic: Dict[Tuple[int, int], float],
) -> Dict[str, Any]:
    """Compare R0 through R4 across deterministic criteria on multi-article clusters."""
    multi_clusters = [sorted(c) for c in clusters if len(c) > 1]
    policies = ["R0_EARLIEST", "R1_LATEST", "R2_LEXICAL_MEDOID", "R3_QWEN_SEMANTIC_MEDOID", "R4_HYBRID_MEDOID"]

    results = {}
    pub_lookup = {doc["id"]: float(doc.get("published_at", 0.0)) for doc in corpus_lookup.values()}

    for pol in policies:
        reps = []
        centrality_lex_list = []
        centrality_sem_list = []

        for c in multi_clusters:
            rep = RepresentativeSelector.select(
                policy=pol,
                members=c,
                published_lookup=pub_lookup,
                pairwise_lexical=pairwise_lexical,
                pairwise_semantic=pairwise_semantic,
            )
            reps.append(rep)
            others = [m for m in c if m != rep]
            lex_scores = [pairwise_lexical.get((min(rep, m), max(rep, m)), 0.0) for m in others]
            sem_scores = [pairwise_semantic.get((min(rep, m), max(rep, m)), 0.0) for m in others]
            centrality_lex_list.append(statistics.mean(lex_scores) if lex_scores else 0.0)
            centrality_sem_list.append(statistics.mean(sem_scores) if sem_scores else 0.0)

        results[pol] = {
            "policy": pol,
            "evaluated_clusters": len(multi_clusters),
            "mean_lexical_centrality": round(statistics.mean(centrality_lex_list), 4) if centrality_lex_list else 0.0,
            "mean_semantic_centrality": round(statistics.mean(centrality_sem_list), 4) if centrality_sem_list else 0.0,
            "determinism": "DETERMINISTIC",
        }

    return results


def run_story_projection_pipeline(
    assignments_path: str = DEFAULT_ASSIGNMENTS_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    pairs_path: str = DEFAULT_PAIRS_PATH,
    scores_path: str = DEFAULT_SCORES_PATH,
    output_dir: str = DEFAULT_C3_OUTPUT_DIR,
    rep_policy: str = "R4_HYBRID_MEDOID",
    alt_policy: str = "A2_DIVERSE_TOP_K",
) -> Dict[str, Any]:
    """Execute complete StoryProjection pipeline and emit private artifacts."""
    # 1. Load cluster assignments
    with open(assignments_path, "r", encoding="utf-8") as f:
        assign_data = json.load(f)

    clusters = assign_data.get("clusters", [])
    cluster_policy = assign_data.get("policy", "P1_REPRESENTATIVE_GUARD")

    # 2. Load corpus
    ok_c, _, entries = CorpusVerifier.verify(corpus_path)
    corpus_lookup = {doc["id"]: doc for doc in entries}

    # 3. Load pairwise scores for lexical and semantic lookups
    pairwise_lexical = {}
    with open(scores_path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pk = r["pair_key"]
            u, v = int(r["entry_a_id"]), int(r["entry_b_id"])
            pairwise_lexical[(min(u, v), max(u, v))] = float(r["b0_score"])

    # Load raw pairs for Qwen semantic cosine lookup
    pairwise_semantic = {}
    with open(pairs_path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            u, v = int(r["id_a"]), int(r["id_b"])
            pairwise_semantic[(min(u, v), max(u, v))] = float(r.get("qwen_score", 0.0))

    # 4. Compare representative policies
    rep_comparison = compare_representative_policies(
        clusters=clusters,
        corpus_lookup=corpus_lookup,
        pairwise_lexical=pairwise_lexical,
        pairwise_semantic=pairwise_semantic,
    )

    # 5. Build canonical StoryProjections
    projections = build_story_projections(
        clusters=clusters,
        corpus_lookup=corpus_lookup,
        pairwise_lexical=pairwise_lexical,
        pairwise_semantic=pairwise_semantic,
        cluster_policy=cluster_policy,
        rep_policy=rep_policy,
        alt_policy=alt_policy,
    )

    # 6. Materialize private artifacts
    os.makedirs(output_dir, exist_ok=True)
    projection_json_path = os.path.join(output_dir, "story01b-c3-story-projection-v1.json")
    rep_comparison_path = os.path.join(output_dir, "story01b-c3-representative-comparison-v1.json")

    with open(rep_comparison_path, "w", encoding="utf-8") as f:
        json.dump(rep_comparison, f, indent=2)

    rep_comparison_sha256 = compute_file_sha256(rep_comparison_path)

    # Multi-article vs standalone
    multi_stories = [p for p in projections if p["member_count"] > 1]
    standalone_stories = [p for p in projections if p["member_count"] == 1]
    articles_absorbed = sum(p["member_count"] for p in multi_stories)

    receipt = {
        "projection_version": "story01b-c3-story-projection-v1",
        "cluster_policy": cluster_policy,
        "representative_policy": rep_policy,
        "alternative_policy": alt_policy,
        "total_story_projections": len(projections),
        "multi_article_story_count": len(multi_stories),
        "standalone_article_count": len(standalone_stories),
        "total_articles_represented": sum(p["member_count"] for p in projections),
        "articles_absorbed_into_multi_stories": articles_absorbed,
        "home_item_count_before": 200,
        "home_item_count_after": len(projections),
        "home_noise_reduction_pct": round((200 - len(projections)) / 200.0 * 100.0, 2),
        "emitted_artifacts": {
            "projection_json_filename": "story01b-c3-story-projection-v1.json",
            "representative_comparison_filename": "story01b-c3-representative-comparison-v1.json",
            "representative_comparison_sha256": rep_comparison_sha256,
        },
        "projections": projections,
    }

    with open(projection_json_path, "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2)

    projection_sha256 = compute_file_sha256(projection_json_path)
    receipt["emitted_artifacts"]["projection_sha256"] = projection_sha256

    return receipt


def main():
    parser = argparse.ArgumentParser(description="Run Story Projection Prototype")
    parser.add_argument("--assignments", default=DEFAULT_ASSIGNMENTS_PATH)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--scores", default=DEFAULT_SCORES_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_C3_OUTPUT_DIR)
    parser.add_argument("--rep-policy", default="R4_HYBRID_MEDOID")
    parser.add_argument("--alt-policy", default="A2_DIVERSE_TOP_K")
    args = parser.parse_args()

    res = run_story_projection_pipeline(
        assignments_path=args.assignments,
        corpus_path=args.corpus,
        pairs_path=args.pairs,
        scores_path=args.scores,
        output_dir=args.output_dir,
        rep_policy=args.rep_policy,
        alt_policy=args.alt_policy,
    )

    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 STORY PROJECTION COMPLETE")
    print("============================================================")
    print(f"Total Story Projections: {res['total_story_projections']}")
    print(f"Multi-Article Stories: {res['multi_article_story_count']}")
    print(f"Standalone Stories: {res['standalone_article_count']}")
    print(f"Home Items Before: {res['home_item_count_before']}")
    print(f"Home Items After: {res['home_item_count_after']}")
    print(f"Noise Reduction: {res['home_noise_reduction_pct']}%")
    print(f"Projection SHA256: {res['emitted_artifacts']['projection_sha256']}")
    print(f"Rep Comparison SHA256: {res['emitted_artifacts']['representative_comparison_sha256']}")
    print("============================================================")


if __name__ == "__main__":
    main()
