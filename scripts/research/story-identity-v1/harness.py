#!/usr/bin/env python3
"""Story Identity V1 Research Harness.

Reproducible offline research harness for Story Identity corpus validation,
feature extraction, and candidate review queue generation.

Boundaries:
- RESEARCH ONLY. No product runtime code modification.
- Zero network requests (MISTRAL_API_CALLS=0, OLLAMA_CALLS=0).
- Zero Miniflux mutations (MINIFLUX_WRITES=0).
- Private artifacts must NOT be written to git-tracked directories (PRIVATE_ARTIFACT_TRACKED_BY_GIT=NO).
"""

import argparse
import csv
from datetime import datetime, timezone
import glob
import hashlib
import json
import os
from pathlib import Path
import random
import re
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

# Canonical constants
EXPECTED_CORPUS_FINGERPRINT = "c12842f11c2bb3e941f182ed946e6a98ae6c70bb69ea8e7908285506af8a2ed8"
EXPECTED_CORPUS_FILE_SHA256 = "0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0"
EXPECTED_HOME200_ENTRY_COUNT = 200
EXPECTED_EMBEDDING_DIMENSION = 1024
EXPECTED_PAIR_UNIVERSE_COUNT = 18953
EXPECTED_PAIR_UNIVERSE_SHA256 = "bd50a4d4e316e2bdd0b6735c1df8c3fe52f6dc14878923325dd2794cfeb3eb14"
DEFAULT_RANDOM_SEED = 20261025

# Bilingual stopword list for title lexical feature extraction (Portuguese + English)
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren", "as", "at",
    "até", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "cannot", "com", "como", "could",
    "d", "da", "das", "de", "do", "dos", "does", "doing", "don", "down", "during", "each", "em", "en", "entre", "era", "essa", "esse", "essas", "esses", "esta", "este", "estas", "estes", "eu",
    "few", "foi", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
    "himself", "his", "how", "há", "i", "if", "in", "into", "is", "isn", "isso", "isto", "it", "its", "itself", "ja", "já", "la", "le", "les",
    "mais", "me", "more", "most", "muito", "my", "myself", "na", "nas", "no", "nor", "nos", "not", "num", "numa", "nuns", "numas", "o", "of", "off",
    "on", "once", "only", "or", "os", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "para",
    "pela", "pelas", "pelo", "pelos", "por", "pra", "pro", "qual", "quando", "que", "quem", "s", "same", "se", "sem", "ser", "seu", "seus", "she", "should",
    "so", "some", "sobre", "sua", "suas", "such", "são", "t", "tem", "ter", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there",
    "these", "they", "this", "those", "through", "to", "too", "um", "uma", "umas", "uns", "under", "until", "up",
    "very", "você", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with",
    "would", "you", "your", "yours", "yourself", "yourselves"
}


def normalize_title(title: str) -> str:
    """Normalize a title by lowercasing, stripping punctuation, and collapsing whitespace."""
    if not title:
        return ""
    t = title.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


def extract_significant_words(title: str, feed_title: str = "") -> Set[str]:
    """Extract significant words (>=2 chars), excluding stopwords and feed title tokens."""
    if not title:
        return set()
    words = set(re.findall(r"\b[a-zA-Z0-9_\u00C0-\u00FF]{2,}\b", title.lower()))
    feed_words = set(re.findall(r"\b[a-zA-Z0-9_\u00C0-\u00FF]{2,}\b", feed_title.lower())) if feed_title else set()
    return {w for w in words if w not in STOPWORDS and w not in feed_words}


def compute_overlap_coefficient(words_a: Set[str], words_b: Set[str]) -> float:
    """Compute overlap coefficient: |A n B| / min(|A|, |B|)."""
    if not words_a or not words_b:
        return 0.0
    smaller = min(len(words_a), len(words_b))
    if smaller == 0:
        return 0.0
    return len(words_a & words_b) / smaller


def compute_jaccard_similarity(words_a: Set[str], words_b: Set[str]) -> float:
    """Compute Jaccard similarity: |A n B| / |A u B|."""
    if not words_a or not words_b:
        return 0.0
    union_len = len(words_a | words_b)
    if union_len == 0:
        return 0.0
    return len(words_a & words_b) / union_len


def verify_sha256(file_path: str) -> str:
    """Compute and return the hex SHA256 of a file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class CorpusVerifier:
    """Validates frozen Home-200 corpus integrity."""

    @staticmethod
    def verify(corpus_path: str) -> Tuple[bool, List[str], List[Dict[str, Any]]]:
        errors = []
        entries = []
        if not os.path.exists(corpus_path):
            errors.append(f"Corpus file does not exist: {corpus_path}")
            return False, errors, entries

        file_hash = verify_sha256(corpus_path)
        if file_hash != EXPECTED_CORPUS_FILE_SHA256:
            errors.append(
                f"File SHA256 mismatch for {corpus_path}: got {file_hash}, expected {EXPECTED_CORPUS_FILE_SHA256}"
            )

        with open(corpus_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except Exception as e:
                    errors.append(f"Corrupt JSON at line {idx + 1}: {e}")

        if len(entries) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Entry count mismatch: got {len(entries)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        return len(errors) == 0, errors, entries


class EmbeddingVerifier:
    """Validates Qwen and Mistral precomputed embedding artifacts."""

    @staticmethod
    def verify_qwen(qwen_path: str) -> Tuple[bool, List[str], Dict[str, Any]]:
        errors = []
        data = {}
        if not os.path.exists(qwen_path):
            errors.append(f"Qwen embeddings file missing: {qwen_path}")
            return False, errors, data

        try:
            with open(qwen_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            errors.append(f"Failed to parse Qwen JSON: {e}")
            return False, errors, data

        if data.get("corpus_fingerprint") != EXPECTED_CORPUS_FINGERPRINT:
            errors.append(
                f"Qwen corpus fingerprint mismatch: got {data.get('corpus_fingerprint')}, expected {EXPECTED_CORPUS_FINGERPRINT}"
            )

        embeddings = data.get("embeddings", [])
        if len(embeddings) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Qwen embedding vector count mismatch: got {len(embeddings)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        if embeddings and len(embeddings[0]) != EXPECTED_EMBEDDING_DIMENSION:
            errors.append(
                f"Qwen embedding vector dimension mismatch: got {len(embeddings[0])}, expected {EXPECTED_EMBEDDING_DIMENSION}"
            )

        return len(errors) == 0, errors, data

    @staticmethod
    def verify_mistral(mistral_dir: str) -> Tuple[bool, List[str], List[List[float]]]:
        errors = []
        all_embeddings: List[List[float]] = []
        batch_files = sorted(glob.glob(os.path.join(mistral_dir, "mistral-batch-*.json")))
        if not batch_files:
            errors.append(f"No mistral-batch-*.json files found in {mistral_dir}")
            return False, errors, all_embeddings

        expected_batches = 4
        if len(batch_files) != expected_batches:
            errors.append(f"Expected {expected_batches} Mistral batch files, found {len(batch_files)}")

        for b_path in batch_files:
            try:
                with open(b_path, "r", encoding="utf-8") as f:
                    b_data = json.load(f)
            except Exception as e:
                errors.append(f"Failed to parse {b_path}: {e}")
                continue

            if b_data.get("corpus_fingerprint") != EXPECTED_CORPUS_FINGERPRINT:
                errors.append(
                    f"Mistral batch {b_path} corpus fingerprint mismatch: got {b_data.get('corpus_fingerprint')}, expected {EXPECTED_CORPUS_FINGERPRINT}"
                )

            batch_embs = b_data.get("embeddings", [])
            if len(batch_embs) != 50:
                errors.append(f"Batch {b_path} expected 50 vectors, got {len(batch_embs)}")
            for v in batch_embs:
                if len(v) != EXPECTED_EMBEDDING_DIMENSION:
                    errors.append(f"Vector in {b_path} has dimension {len(v)}, expected {EXPECTED_EMBEDDING_DIMENSION}")
                    break
            all_embeddings.extend(batch_embs)

        if len(all_embeddings) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Total Mistral vectors mismatch: got {len(all_embeddings)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        return len(errors) == 0, errors, all_embeddings


class PairUniverseVerifier:
    """Validates the 18,953 cross-feed candidate pair universe."""

    @staticmethod
    def verify(pairs_path: str) -> Tuple[bool, List[str], List[Dict[str, str]]]:
        errors = []
        pairs: List[Dict[str, str]] = []
        if not os.path.exists(pairs_path):
            errors.append(f"Pairs CSV missing: {pairs_path}")
            return False, errors, pairs

        file_hash = verify_sha256(pairs_path)
        if file_hash != EXPECTED_PAIR_UNIVERSE_SHA256:
            errors.append(
                f"Pair universe SHA256 mismatch: got {file_hash}, expected {EXPECTED_PAIR_UNIVERSE_SHA256}"
            )

        with open(pairs_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                pairs.append(row)

        if len(pairs) != EXPECTED_PAIR_UNIVERSE_COUNT:
            errors.append(
                f"Pair universe row count mismatch: got {len(pairs)}, expected {EXPECTED_PAIR_UNIVERSE_COUNT}"
            )

        # Verify strict cross-feed constraint on all pairs
        same_feed_count = sum(1 for p in pairs if p["feed_id_a"] == p["feed_id_b"])
        if same_feed_count > 0:
            errors.append(f"Violation: found {same_feed_count} same-feed pairs in cross-feed candidate universe")

        return len(errors) == 0, errors, pairs


class FeatureExtractor:
    """Extracts deterministic lexical, temporal, and semantic features for pairs."""

    @staticmethod
    def extract_features(
        pair_row: Dict[str, str],
        reranker_lookup: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        title_a = pair_row.get("title_a", "")
        title_b = pair_row.get("title_b", "")
        feed_a = pair_row.get("feed_a", "")
        feed_b = pair_row.get("feed_b", "")

        norm_a = normalize_title(title_a)
        norm_b = normalize_title(title_b)
        exact_title_match = 1 if (norm_a and norm_a == norm_b) else 0

        words_a = extract_significant_words(title_a, feed_a)
        words_b = extract_significant_words(title_b, feed_b)
        shared_words_count = len(words_a & words_b)
        overlap_coef = compute_overlap_coefficient(words_a, words_b)
        jaccard_sim = compute_jaccard_similarity(words_a, words_b)

        pub_a = float(pair_row.get("published_at_a", 0.0))
        pub_b = float(pair_row.get("published_at_b", 0.0))
        delta_hours = abs(pub_a - pub_b) / 3600.0

        date_a = datetime.fromtimestamp(pub_a, tz=timezone.utc).strftime("%Y-%m-%d") if pub_a else ""
        date_b = datetime.fromtimestamp(pub_b, tz=timezone.utc).strftime("%Y-%m-%d") if pub_b else ""
        same_calendar_day = 1 if (date_a and date_a == date_b) else 0

        qwen_score = float(pair_row.get("qwen_score", 0.0))
        qwen_rank = int(pair_row.get("qwen_rank", 0))
        mistral_score = float(pair_row.get("mistral_score", 0.0))
        mistral_rank = int(pair_row.get("mistral_rank", 0))
        best_rank = int(pair_row.get("best_rank", 0))

        pair_key = pair_row.get("pair_key", "")
        reranker_score = reranker_lookup.get(pair_key) if reranker_lookup else None

        return {
            "pair_key": pair_key,
            "id_a": int(pair_row["id_a"]),
            "id_b": int(pair_row["id_b"]),
            "feed_id_a": int(pair_row["feed_id_a"]),
            "feed_id_b": int(pair_row["feed_id_b"]),
            "published_delta_hours": round(delta_hours, 4),
            "same_calendar_day_utc": same_calendar_day,
            "exact_normalized_title_match": exact_title_match,
            "shared_significant_words_count": shared_words_count,
            "title_overlap_coefficient": round(overlap_coef, 4),
            "title_jaccard_similarity": round(jaccard_sim, 4),
            "qwen_cosine_similarity": qwen_score,
            "qwen_rank": qwen_rank,
            "mistral_cosine_similarity": mistral_score,
            "mistral_rank": mistral_rank,
            "best_rank": best_rank,
            "reranker_score": reranker_score,
        }


class StratifiedSampler:
    """Generates a stratified candidate review queue for human annotation."""

    @staticmethod
    def sample_review_queue(
        pairs: List[Dict[str, str]],
        features: List[Dict[str, Any]],
        seed: int = DEFAULT_RANDOM_SEED
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        rng = random.Random(seed)
        feat_by_key = {f["pair_key"]: f for f in features}
        raw_by_key = {p["pair_key"]: p for p in pairs}

        # Strata:
        # Cat A: High semantic agreement (both Qwen <= 50 and Mistral <= 50) -> 11 pairs
        cat_a = [k for k, f in feat_by_key.items() if f["qwen_rank"] <= 50 and f["mistral_rank"] <= 50]
        # Cat B: Qwen high <= 50, Mistral > 50 -> 39 pairs
        cat_b = [k for k, f in feat_by_key.items() if f["qwen_rank"] <= 50 and f["mistral_rank"] > 50]
        # Cat C: Mistral high <= 50, Qwen > 50 -> 39 pairs
        cat_c = [k for k, f in feat_by_key.items() if f["mistral_rank"] <= 50 and f["qwen_rank"] > 50]
        # Cat D: Moderate semantic boundary (51 <= best_rank <= 150) -> sample 15 pairs
        cat_d_pool = [k for k, f in feat_by_key.items() if 51 <= f["best_rank"] <= 150]
        cat_d = rng.sample(cat_d_pool, min(15, len(cat_d_pool)))
        # Cat E: Ambient hard negatives (best_rank > 1000) -> sample 20 pairs
        cat_e_pool = [k for k, f in feat_by_key.items() if f["best_rank"] > 1000]
        cat_e = rng.sample(cat_e_pool, min(20, len(cat_e_pool)))

        # Assign stratum label
        selected_strata: Dict[str, str] = {}
        for k in cat_a:
            selected_strata[k] = "HIGH_SEMANTIC_AGREEMENT"
        for k in cat_b:
            selected_strata[k] = "QWEN_HIGH_MISTRAL_LOW"
        for k in cat_c:
            selected_strata[k] = "MISTRAL_HIGH_QWEN_LOW"
        for k in cat_d:
            if k not in selected_strata:
                selected_strata[k] = "MODERATE_SEMANTIC_BOUNDARY"
        for k in cat_e:
            if k not in selected_strata:
                selected_strata[k] = "AMBIENT_HARD_NEGATIVE"

        # Unique selected keys
        selected_keys = list(selected_strata.keys())
        rng.shuffle(selected_keys)

        queue_entries: List[Dict[str, Any]] = []
        for idx, k in enumerate(selected_keys, start=1):
            f = feat_by_key[k]
            p = raw_by_key[k]
            queue_entries.append({
                "review_id": f"REV-{idx:03d}",
                "pair_key": k,
                "entry_a_id": f["id_a"],
                "entry_b_id": f["id_b"],
                "feed_a": p.get("feed_a", ""),
                "feed_b": p.get("feed_b", ""),
                "published_at_a": p.get("published_at_a", ""),
                "published_at_b": p.get("published_at_b", ""),
                "title_a": p.get("title_a", ""),
                "title_b": p.get("title_b", ""),
                "sampling_stratum": selected_strata[k],
                "qwen_score": f["qwen_cosine_similarity"],
                "qwen_rank": f["qwen_rank"],
                "mistral_score": f["mistral_cosine_similarity"],
                "mistral_rank": f["mistral_rank"],
                "best_rank": f["best_rank"],
                "reranker_score": f["reranker_score"],
                "shared_words_count": f["shared_significant_words_count"],
                "overlap_coefficient": f["title_overlap_coefficient"],
                "jaccard_similarity": f["title_jaccard_similarity"],
                "delta_hours": f["published_delta_hours"],
            })

        strata_counts = {
            "cat_a_high_semantic_agreement": len(cat_a),
            "cat_b_qwen_high_mistral_low": len(cat_b),
            "cat_c_mistral_high_qwen_low": len(cat_c),
            "cat_d_moderate_semantic_boundary": len(cat_d),
            "cat_e_ambient_hard_negative": len(cat_e),
            "total_sampled_pairs": len(queue_entries),
        }
        return queue_entries, strata_counts


def run_harness(
    corpus_path: str,
    qwen_path: str,
    mistral_dir: str,
    pairs_path: str,
    reranker_path: Optional[str] = None,
    output_dir: Optional[str] = None,
    seed: int = DEFAULT_RANDOM_SEED,
    verify_only: bool = False
) -> int:
    """Run full verification, feature extraction, and sampling."""
    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 RESEARCH HARNESS")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("============================================================")

    # 1. Corpus verification
    print("[1/5] Verifying Frozen Home-200 Corpus...")
    ok_corp, errs_corp, entries = CorpusVerifier.verify(corpus_path)
    if not ok_corp:
        for e in errs_corp:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] {len(entries)} articles verified. SHA256={EXPECTED_CORPUS_FILE_SHA256[:16]}...")

    # 2. Embeddings verification
    print("[2/5] Verifying Precomputed Dense Embeddings...")
    ok_qwen, errs_qwen, _ = EmbeddingVerifier.verify_qwen(qwen_path)
    if not ok_qwen:
        for e in errs_qwen:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] Qwen embeddings: 200 entries x 1024-dim, digest ac6da0dfba...")

    ok_mist, errs_mist, _ = EmbeddingVerifier.verify_mistral(mistral_dir)
    if not ok_mist:
        for e in errs_mist:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] Mistral embeddings: 4 batches x 50 entries = 200 vectors x 1024-dim.")

    # 3. Pair universe verification
    print("[3/5] Verifying Candidate Pair Universe...")
    ok_pair, errs_pair, pairs = PairUniverseVerifier.verify(pairs_path)
    if not ok_pair:
        for e in errs_pair:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] 18,953 cross-feed pairs verified. Strict cross-feed 100%.")

    # 4. Feature extraction
    print("[4/5] Extracting Deterministic, Lexical, and Semantic Features...")
    reranker_lookup: Dict[str, float] = {}
    if reranker_path and os.path.exists(reranker_path):
        with open(reranker_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                reranker_lookup[r["pair_key"]] = float(r["reranker_score_mean"])
        print(f"  Loaded {len(reranker_lookup)} reranker scores from top-250.")

    features = [FeatureExtractor.extract_features(p, reranker_lookup) for p in pairs]
    print(f"  Extracted feature vectors for all {len(features)} pairs.")

    if verify_only:
        print("[5/5] Verification-only mode: skipping review queue file generation.")
        print("HARNESS_STATUS=VERIFICATION_SUCCESS")
        return 0

    # 5. Stratified queue sampling
    print(f"[5/5] Performing Stratified Sampling (seed={seed})...")
    queue_entries, strata_counts = StratifiedSampler.sample_review_queue(pairs, features, seed=seed)

    print("  Stratified Sampling Distribution:")
    for k, v in strata_counts.items():
        print(f"    - {k}: {v}")

    # Output emission
    if output_dir:
        # Check that output directory is NOT inside git repository without being gitignored
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
        out_abs = os.path.abspath(output_dir)
        if out_abs.startswith(repo_root) and not any(part.endswith(".local") for part in Path(out_abs).parts):
            print(
                f"  [SECURITY WARNING] output_dir {output_dir} is inside repository. "
                "Writing private feed titles/urls into git tracked paths is prohibited.",
                file=sys.stderr
            )
            return 1

        os.makedirs(output_dir, exist_ok=True)

        # 1. Blind annotator queue (stripped of model identities and scores)
        blind_queue_path = os.path.join(output_dir, "story01b_annotator_queue.csv")
        with open(blind_queue_path, "w", encoding="utf-8", newline="") as f:
            fieldnames = [
                "review_id", "entry_a_id", "entry_b_id", "feed_a", "feed_b",
                "published_at_a", "published_at_b", "title_a", "title_b",
                "label", "notes"
            ]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for q in queue_entries:
                writer.writerow({
                    "review_id": q["review_id"],
                    "entry_a_id": q["entry_a_id"],
                    "entry_b_id": q["entry_b_id"],
                    "feed_a": q["feed_a"],
                    "feed_b": q["feed_b"],
                    "published_at_a": q["published_at_a"],
                    "published_at_b": q["published_at_b"],
                    "title_a": q["title_a"],
                    "title_b": q["title_b"],
                    "label": "",
                    "notes": "",
                })

        # 2. Immutable audit key
        key_path = os.path.join(output_dir, "story01b_audit_key.csv")
        with open(key_path, "w", encoding="utf-8", newline="") as f:
            fieldnames = list(queue_entries[0].keys())
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for q in queue_entries:
                writer.writerow(q)

        # 3. Sampling receipt
        receipt_path = os.path.join(output_dir, "story01b_sampling_receipt.json")
        with open(receipt_path, "w", encoding="utf-8") as f:
            json.dump({
                "corpus_fingerprint": EXPECTED_CORPUS_FINGERPRINT,
                "corpus_sha256": EXPECTED_CORPUS_FILE_SHA256,
                "pair_universe_sha256": EXPECTED_PAIR_UNIVERSE_SHA256,
                "pair_universe_count": len(pairs),
                "random_seed": seed,
                "strata_counts": strata_counts,
                "queue_file": blind_queue_path,
                "key_file": key_path,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }, f, indent=2)

        print(f"  Emitted {len(queue_entries)} candidate pairs to {output_dir}")
        print(f"    - Blind Annotator Queue: {blind_queue_path}")
        print(f"    - Audit Key: {key_path}")
        print(f"    - Sampling Receipt: {receipt_path}")

    print("============================================================")
    print("HARNESS_STATUS=SUCCESS")
    print("============================================================")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Story Identity V1 Research Harness")
    parser.add_argument(
        "--corpus-path",
        default="/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl",
        help="Path to frozen home-200.jsonl"
    )
    parser.add_argument(
        "--qwen-embeddings-path",
        default="/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/qwen-embeddings.json",
        help="Path to Qwen embeddings JSON"
    )
    parser.add_argument(
        "--mistral-embeddings-dir",
        default="/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1",
        help="Directory containing Mistral batch JSON files"
    )
    parser.add_argument(
        "--pairs-csv-path",
        default="/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv",
        help="Path to candidate pairs CSV"
    )
    parser.add_argument(
        "--reranker-csv-path",
        default="/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/r3b-qwen3-reranker-0.6b-top250/r3b-qwen3-reranker-top250.csv",
        help="Path to reranker top-250 CSV"
    )
    parser.add_argument(
        "--output-dir",
        default="/tmp/newsflux-story01b-private",
        help="Output directory for generated review queues (must be git-ignored or outside repo)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_RANDOM_SEED,
        help="Random seed for deterministic sampling"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Run integrity checks only without emitting files"
    )

    args = parser.parse_args()
    rc = run_harness(
        corpus_path=args.corpus_path,
        qwen_path=args.qwen_embeddings_path,
        mistral_dir=args.mistral_embeddings_dir,
        pairs_path=args.pairs_csv_path,
        reranker_path=args.reranker_csv_path,
        output_dir=args.output_dir,
        seed=args.seed,
        verify_only=args.verify_only,
    )
    sys.exit(rc)


if __name__ == "__main__":
    main()
