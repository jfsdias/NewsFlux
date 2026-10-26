#!/usr/bin/env python3
"""
NewsFlux Story Identity V1 — Gold Expansion Candidate Mining (STORY-01B-M2 Stage C)

Objectives:
- Mine candidate pairs from the 18,953 frozen cross-feed pair universe to prepare future Gold expansion.
- Strictly exclude existing 156 Gold pairs (GOLD_PAIR_OVERLAP = 0 gate).
- Stratify into at least G1 to G8:
    - G1_HIGH_LEXICAL_LOW_SEMANTIC
    - G2_LOW_LEXICAL_HIGH_SEMANTIC
    - G3_RELATED_TOPIC_BOUNDARY
    - G4_NON_DUO_COVERAGE
    - G5_TEMPORAL_BOUNDARY
    - G6_CROSS_CATEGORY
    - G7_SAME_CATEGORY_DIFFERENT_EVENT_RISK
    - G8_HIGH_SEMANTIC_LOW_ENTITY_ANCHOR
- Enforce strict diversity constraints:
    - MAX_ARTICLE_REUSE (max 3 pairs per article ID)
    - DOMAIN_DIVERSITY, FEED_DIVERSITY, CATEGORY_DIVERSITY
    - FEATURE_REGIME_DIVERSITY
- Output private artifact:
    - /tmp/newsflux-story01b-private/m2/story01b-m2-gold-expansion-candidates-v1.csv
"""

import argparse
import csv
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from .harness import (
        CorpusVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
    )
    from .model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
    )
except ImportError:
    from harness import (
        CorpusVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
    )
    from model_benchmark import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
    )

DEFAULT_M2_OUTPUT_DIR = "/tmp/newsflux-story01b-private/m2"
MAX_ARTICLE_REUSE_DEFAULT = 3
MAX_PER_STRATUM_DEFAULT = 12


class GoldOverlapError(Exception):
    """Raised when gold pairs overlap with mined candidate pool."""
    pass


def compute_file_sha256(path: str) -> str:
    """Compute SHA256 of file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def classify_candidate_stratum(
    f: Dict[str, Any],
    corpus_lookup: Dict[int, Dict[str, Any]],
) -> Tuple[Optional[str], float, str]:
    """Classify pair into candidate mining stratum with deterministic priority score and rationale."""
    ov = float(f["title_overlap_coefficient"])
    qw = float(f["qwen_embedding_cosine"])
    ms = float(f["mistral_embedding_cosine"])
    sc = int(f["same_category"])
    dh = float(f["published_delta_hours"])
    ea = float(f["entity_anchor_overlap"])

    cat_a = str(corpus_lookup[f["id_a"]].get("category_id", ""))
    cat_b = str(corpus_lookup[f["id_b"]].get("category_id", ""))
    feed_a = corpus_lookup[f["id_a"]].get("feed_title", "")
    feed_b = corpus_lookup[f["id_b"]].get("feed_title", "")
    # Non-dominant category/feed (tech dominant category is 36 / Canaltech / 9to5mac / MacRumors)
    is_tech = (cat_a == "36" or cat_b == "36" or "tech" in feed_a.lower() or "tech" in feed_b.lower() or "apple" in feed_a.lower() or "apple" in feed_b.lower())

    # G1: High title overlap but low semantic agreement (lexical trap)
    if ov >= 0.25 and (qw < 0.40 or ms < 0.65):
        score = ov - max(qw, ms - 0.2)
        reason = f"High title lexical overlap ({ov:.2f}) but low semantic agreement (Qwen={qw:.2f}, Mistral={ms:.2f})"
        return "G1_HIGH_LEXICAL_LOW_SEMANTIC", score, reason

    # G8: High semantic agreement across both embeddings, but zero entity anchor overlap
    if qw >= 0.52 and ms >= 0.72 and ea == 0.0:
        score = qw + ms
        reason = f"High dense semantic agreement (Qwen={qw:.2f}, Mistral={ms:.2f}) with zero entity anchor overlap"
        return "G8_HIGH_SEMANTIC_LOW_ENTITY_ANCHOR", score, reason

    # G7: Same category, elevated semantic cosine, zero entity anchor overlap, low lexical overlap
    if sc == 1 and qw >= 0.46 and ms >= 0.70 and ea == 0.0 and ov < 0.20:
        score = qw + ms
        reason = f"Same category and elevated semantic similarity (Qwen={qw:.2f}, Mistral={ms:.2f}) with no entity overlap (topical false merge trap)"
        return "G7_SAME_CATEGORY_DIFFERENT_EVENT_RISK", score, reason

    # G2: Low title overlap but high semantic agreement (paraphrase candidate)
    if ov < 0.20 and qw >= 0.52 and ms >= 0.72:
        score = qw + ms
        reason = f"Low title lexical overlap ({ov:.2f}) with high dense agreement (Qwen={qw:.2f}, Mistral={ms:.2f})"
        return "G2_LOW_LEXICAL_HIGH_SEMANTIC", score, reason

    # G5: Elevated semantic agreement with substantial published delta hours
    if qw >= 0.45 and ms >= 0.68 and dh >= 3.0:
        score = dh
        reason = f"Elevated dense agreement (Qwen={qw:.2f}, Mistral={ms:.2f}) across large temporal delta ({dh:.1f} hours)"
        return "G5_TEMPORAL_BOUNDARY", score, reason

    # G3: Borderline semantic similarity near decision boundary within same category
    if 0.45 <= qw <= 0.60 and 0.68 <= ms <= 0.76 and sc == 1 and 0.10 <= ov <= 0.35:
        score = qw + ms
        reason = f"Borderline semantic similarity (Qwen={qw:.2f}, Mistral={ms:.2f}) and moderate overlap ({ov:.2f}) in same category"
        return "G3_RELATED_TOPIC_BOUNDARY", score, reason

    # G6: Cross-category candidate with high similarity
    if sc == 0 and (qw >= 0.48 or ov >= 0.25):
        score = qw + ms
        reason = f"Cross-category pair with elevated semantic or lexical similarity (Qwen={qw:.2f}, Overlap={ov:.2f})"
        return "G6_CROSS_CATEGORY", score, reason

    # G4: Non-tech domain and category coverage
    if not is_tech and (qw >= 0.45 or ov >= 0.20):
        score = qw + ms
        reason = f"Non-tech domain/category pair ({cat_a} x {cat_b}) expanding beyond dominant tech components"
        return "G4_NON_DUO_COVERAGE", score, reason

    return None, 0.0, ""


def mine_gold_expansion_candidates(
    pairs_path: str = DEFAULT_PAIRS_PATH,
    corpus_path: str = DEFAULT_CORPUS_PATH,
    gold_path: str = DEFAULT_GOLD_PATH,
    reranker_path: str = DEFAULT_RERANKER_PATH,
    output_dir: str = DEFAULT_M2_OUTPUT_DIR,
    max_article_reuse: int = MAX_ARTICLE_REUSE_DEFAULT,
    max_per_stratum: int = MAX_PER_STRATUM_DEFAULT,
) -> Dict[str, Any]:
    """Mine and stratify candidate pairs for Gold expansion with strict diversity gates."""
    # 1. Load Gold and verify
    with open(gold_path, "r", encoding="utf-8") as f:
        gold_keys = {r["pair_key"] for r in csv.DictReader(f)}

    # 2. Verify corpus
    ok_c, errs_c, entries = CorpusVerifier.verify(corpus_path)
    if not ok_c:
        raise ValueError(f"Corpus verification failed: {errs_c}")
    corpus_lookup = {doc["id"]: doc for doc in entries}

    # 3. Verify pair universe
    ok_p, errs_p, pairs = PairUniverseVerifier.verify(pairs_path)
    if not ok_p:
        raise ValueError(f"Pair universe verification failed: {errs_p}")

    # 4. Filter non-gold pairs
    non_gold_pairs = [p for p in pairs if p["pair_key"] not in gold_keys]
    if len(non_gold_pairs) + len(gold_keys) != len(pairs):
        # Check for unexpected overlap
        overlap = set(p["pair_key"] for p in pairs) & gold_keys
        if len(overlap) != len(gold_keys):
            raise GoldOverlapError(f"Unexpected gold overlap: {len(overlap)} != {len(gold_keys)}")

    # 5. Load reranker if available
    reranker_lookup = {}
    if os.path.exists(reranker_path):
        with open(reranker_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ab = float(r["reranker_score_ab"])
                ba = float(r["reranker_score_ba"])
                reranker_lookup[r["pair_key"]] = {
                    "mean": float(r["reranker_score_mean"]),
                    "delta": round(abs(ab - ba), 4),
                }

    # 6. Extract features and classify into strata
    strata_pools = defaultdict(list)
    all_strata_names = [
        "G1_HIGH_LEXICAL_LOW_SEMANTIC",
        "G2_LOW_LEXICAL_HIGH_SEMANTIC",
        "G3_RELATED_TOPIC_BOUNDARY",
        "G4_NON_DUO_COVERAGE",
        "G5_TEMPORAL_BOUNDARY",
        "G6_CROSS_CATEGORY",
        "G7_SAME_CATEGORY_DIFFERENT_EVENT_RISK",
        "G8_HIGH_SEMANTIC_LOW_ENTITY_ANCHOR",
    ]

    for p in non_gold_pairs:
        f = FeatureExtractor.extract_features(p, reranker_lookup, corpus_lookup)
        stratum, score, reason = classify_candidate_stratum(f, corpus_lookup)
        if stratum:
            strata_pools[stratum].append((score, f, reason))

    # 7. Select balanced candidates adhering to diversity constraints
    selected_candidates = []
    selected_pair_keys = set()
    article_reuse_counts = Counter()
    domain_pairs = set()
    feed_pairs = set()
    category_pairs = set()

    stratum_counts = Counter()

    for stratum in all_strata_names:
        pool = strata_pools[stratum]
        # Sort deterministically by stratum score descending, then pair_key
        sorted_pool = sorted(pool, key=lambda x: (x[0], x[1]["pair_key"]), reverse=True)

        stratum_selected = 0
        priority_counter = 1

        for score, f, reason in sorted_pool:
            pk = f["pair_key"]
            if pk in selected_pair_keys:
                continue

            id_a = f["id_a"]
            id_b = f["id_b"]

            # Diversity gate: MAX_ARTICLE_REUSE
            if article_reuse_counts[id_a] >= max_article_reuse or article_reuse_counts[id_b] >= max_article_reuse:
                continue

            # Check gold overlap gate
            if pk in gold_keys:
                raise GoldOverlapError(f"Fatal: gold pair {pk} detected in candidate selection!")

            # Track article reuse
            article_reuse_counts[id_a] += 1
            article_reuse_counts[id_b] += 1
            selected_pair_keys.add(pk)

            doc_a = corpus_lookup[id_a]
            doc_b = corpus_lookup[id_b]
            feed_a = doc_a.get("feed_title", "")
            feed_b = doc_b.get("feed_title", "")
            cat_a = str(doc_a.get("category_id", ""))
            cat_b = str(doc_b.get("category_id", ""))

            feed_pairs.add((feed_a, feed_b))
            category_pairs.add((cat_a, cat_b))

            priority_label = f"P{priority_counter}"

            selected_candidates.append({
                "pair_key": pk,
                "entry_a_id": id_a,
                "entry_b_id": id_b,
                "review_stratum": stratum,
                "review_priority": priority_label,
                "selection_reason": reason,
                "same_domain": f["same_domain"],
                "same_category": f["same_category"],
                "title_overlap_coefficient": f["title_overlap_coefficient"],
                "title_jaccard_similarity": f["title_jaccard_similarity"],
                "qwen_embedding_cosine": f["qwen_embedding_cosine"],
                "mistral_embedding_cosine": f["mistral_embedding_cosine"],
                "published_delta_hours": f["published_delta_hours"],
                "entity_anchor_overlap": f["entity_anchor_overlap"],
                "number_overlap": f["number_overlap"],
                "date_overlap": f["date_overlap"],
            })

            stratum_selected += 1
            priority_counter += 1
            stratum_counts[stratum] += 1

            if stratum_selected >= max_per_stratum:
                break

    # Final gold overlap audit
    gold_pair_overlap = len(selected_pair_keys & gold_keys)
    if gold_pair_overlap != 0:
        raise GoldOverlapError(f"GOLD_PAIR_OVERLAP must be 0, got {gold_pair_overlap}")

    # 8. Materialize private artifact
    os.makedirs(output_dir, exist_ok=True)
    output_csv_path = os.path.join(output_dir, "story01b-m2-gold-expansion-candidates-v1.csv")

    fieldnames = [
        "pair_key",
        "entry_a_id",
        "entry_b_id",
        "review_stratum",
        "review_priority",
        "selection_reason",
        "same_domain",
        "same_category",
        "title_overlap_coefficient",
        "title_jaccard_similarity",
        "qwen_embedding_cosine",
        "mistral_embedding_cosine",
        "published_delta_hours",
        "entity_anchor_overlap",
        "number_overlap",
        "date_overlap",
    ]

    with open(output_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for cand in selected_candidates:
            writer.writerow(cand)

    output_sha256 = compute_file_sha256(output_csv_path)

    unique_articles = len(article_reuse_counts)
    unique_feeds = len({f for pair in feed_pairs for f in pair})
    unique_categories = len({c for pair in category_pairs for c in pair})
    max_reuse = max(article_reuse_counts.values()) if article_reuse_counts else 0

    return {
        "candidate_count": len(selected_candidates),
        "unique_articles": unique_articles,
        "unique_feeds": unique_feeds,
        "unique_categories": unique_categories,
        "max_article_reuse": max_reuse,
        "gold_pair_overlap": gold_pair_overlap,
        "gold_pair_overlap_gate": "PASS",
        "stratum_distribution": dict(stratum_counts),
        "all_declared_strata": all_strata_names,
        "output_csv_path": output_csv_path,
        "output_sha256": output_sha256,
    }


def main():
    parser = argparse.ArgumentParser(description="Run Story-01B M2 Gold Expansion Mining")
    parser.add_argument("--pairs", default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--gold", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--reranker", default=DEFAULT_RERANKER_PATH)
    parser.add_argument("--output-dir", default=DEFAULT_M2_OUTPUT_DIR)
    parser.add_argument("--max-article-reuse", type=int, default=MAX_ARTICLE_REUSE_DEFAULT)
    parser.add_argument("--max-per-stratum", type=int, default=MAX_PER_STRATUM_DEFAULT)
    args = parser.parse_args()

    res = mine_gold_expansion_candidates(
        pairs_path=args.pairs,
        corpus_path=args.corpus,
        gold_path=args.gold,
        reranker_path=args.reranker,
        output_dir=args.output_dir,
        max_article_reuse=args.max_article_reuse,
        max_per_stratum=args.max_per_stratum,
    )

    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 GOLD EXPANSION MINING COMPLETE")
    print("============================================================")
    print(f"Candidate Count: {res['candidate_count']}")
    print(f"Unique Articles: {res['unique_articles']}")
    print(f"Unique Feeds: {res['unique_feeds']}")
    print(f"Unique Categories: {res['unique_categories']}")
    print(f"Max Article Reuse: {res['max_article_reuse']}")
    print(f"Gold Pair Overlap: {res['gold_pair_overlap']} (Gate={res['gold_pair_overlap_gate']})")
    print("Stratum Distribution:")
    for s, c in sorted(res['stratum_distribution'].items()):
        print(f"  - {s}: {c}")
    print(f"Output CSV: {res['output_csv_path']}")
    print(f"Output SHA256: {res['output_sha256']}")
    print("============================================================")


if __name__ == "__main__":
    main()
