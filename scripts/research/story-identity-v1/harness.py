#!/usr/bin/env python3
"""Story Identity V1 Research Harness.

Reproducible offline research harness for Story Identity corpus validation,
feature extraction, semantic vector parity verification, and candidate review queue generation.

Boundaries:
- RESEARCH ONLY. No product runtime code modification.
- Zero network requests (MISTRAL_API_CALLS=0, OLLAMA_CALLS=0).
- Zero Miniflux mutations (MINIFLUX_WRITES=0).
- Private artifacts must NOT be written to git-tracked directories (PRIVATE_ARTIFACT_TRACKED_BY_GIT=NO).
"""

import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
import glob
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

# Canonical constants
FEATURE_SCHEMA_VERSION = "story01b-pair-v1"
EXPECTED_CORPUS_FINGERPRINT = "c12842f11c2bb3e941f182ed946e6a98ae6c70bb69ea8e7908285506af8a2ed8"
CORPUS_FINGERPRINT_DERIVATION = "HISTORICAL_ARTIFACT_DECLARATION"
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
    """Extract significant words (>=2 chars), excluding pure numeric tokens, stopwords and feed title tokens."""
    if not title:
        return set()
    tokens = re.findall(r"\b[a-zA-Z0-9_\u00C0-\u00FF]{2,}\b", title.lower())
    feed_words = set(re.findall(r"\b[a-zA-Z0-9_\u00C0-\u00FF]{2,}\b", feed_title.lower())) if feed_title else set()
    return {w for w in tokens if not w.isdigit() and w not in STOPWORDS and w not in feed_words}


def extract_numeric_tokens(title: str) -> Set[str]:
    """Extract dedicated numeric tokens from a title."""
    if not title:
        return set()
    return set(re.findall(r"\b\d+\b", title))


def extract_date_tokens(title: str) -> Set[str]:
    """Extract dedicated date-like tokens (e.g. 2026, 10/25, 23-10) from a title."""
    if not title:
        return set()
    return set(re.findall(r"\b(?:\d{4}|\d{1,2}/\d{1,2}(?:/\d{2,4})?|\d{1,2}-\d{1,2}(?:-\d{2,4})?)\b", title))


def extract_entity_anchors(title: str, feed_title: str = "") -> Set[str]:
    """Deterministic proxy for proper entity anchors using capitalized word tokens.

    Documented as ENTITY_STRATUM=DETERMINISTIC_PROXY (not true NER).
    """
    if not title:
        return set()
    words = re.findall(r"\b[A-Z\u00C0-\u00DC][a-zA-Z0-9_\u00C0-\u00FF]{2,}\b", title)
    feed_words = set(re.findall(r"\b[A-Za-z0-9_\u00C0-\u00FF]+\b", feed_title)) if feed_title else set()
    return {w.lower() for w in words if w not in feed_words and w.lower() not in STOPWORDS}


def compute_overlap_coefficient(set_a: Set[str], set_b: Set[str]) -> float:
    """Compute overlap coefficient: |A n B| / min(|A|, |B|)."""
    if not set_a or not set_b:
        return 0.0
    smaller = min(len(set_a), len(set_b))
    if smaller == 0:
        return 0.0
    return len(set_a & set_b) / smaller


def compute_jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """Compute Jaccard similarity: |A n B| / |A u B|."""
    if not set_a or not set_b:
        return 0.0
    union_len = len(set_a | set_b)
    if union_len == 0:
        return 0.0
    return len(set_a & set_b) / union_len


def verify_sha256(file_path: str) -> str:
    """Compute and return the hex SHA256 of a file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def validate_output_path(output_dir: str, repo_root: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Validates that output_dir does not write private artifacts into git-tracked repository paths.

    Policy: PRIVATE_OUTPUT_INSIDE_REPO=REJECTED unless verified by git check-ignore.
    """
    if not output_dir:
        return False, "Output directory not specified"
    out_abs = os.path.abspath(output_dir)
    if repo_root is None:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))

    # Completely outside repo -> PASS
    if not (out_abs == repo_root or out_abs.startswith(repo_root + os.sep)):
        return True, None

    # Inside repo -> verify git check-ignore
    try:
        res = subprocess.run(
            ["git", "check-ignore", "-q", out_abs],
            cwd=repo_root,
            capture_output=True
        )
        if res.returncode == 0:
            return True, None
        return False, (
            f"Output directory {out_abs} is inside repository and NOT git-ignored. "
            "Writing private feed titles/urls into git tracked paths is prohibited. "
            "Use an external directory (e.g. /tmp/newsflux-story01b-private/) or a git-ignored directory."
        )
    except Exception as e:
        return False, f"Failed to verify git-ignore status for {out_abs}: {e}"


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
    def verify_qwen(qwen_path: str) -> Tuple[bool, List[str], List[List[float]], List[int]]:
        errors = []
        embeddings: List[List[float]] = []
        ids: List[int] = []
        if not os.path.exists(qwen_path):
            errors.append(f"Qwen embeddings file missing: {qwen_path}")
            return False, errors, embeddings, ids

        try:
            with open(qwen_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            errors.append(f"Failed to parse Qwen JSON: {e}")
            return False, errors, embeddings, ids

        if data.get("corpus_fingerprint") != EXPECTED_CORPUS_FINGERPRINT:
            errors.append(
                f"Qwen corpus fingerprint mismatch: got {data.get('corpus_fingerprint')}, expected {EXPECTED_CORPUS_FINGERPRINT}"
            )

        embeddings = data.get("embeddings", [])
        if len(embeddings) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Qwen embedding vector count mismatch: got {len(embeddings)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        # Validate dimension for ALL 200 vectors
        for idx, v in enumerate(embeddings):
            if len(v) != EXPECTED_EMBEDDING_DIMENSION:
                errors.append(
                    f"Qwen vector at index {idx} has dimension {len(v)}, expected {EXPECTED_EMBEDDING_DIMENSION}"
                )
                break

        ids = [int(i) for i in data.get("ids", [])]
        if len(ids) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Qwen IDs count mismatch: got {len(ids)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        return len(errors) == 0, errors, embeddings, ids

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
            for idx, v in enumerate(batch_embs):
                if len(v) != EXPECTED_EMBEDDING_DIMENSION:
                    errors.append(f"Vector at index {idx} in {b_path} has dimension {len(v)}, expected {EXPECTED_EMBEDDING_DIMENSION}")
                    break
            all_embeddings.extend(batch_embs)

        if len(all_embeddings) != EXPECTED_HOME200_ENTRY_COUNT:
            errors.append(
                f"Total Mistral vectors mismatch: got {len(all_embeddings)}, expected {EXPECTED_HOME200_ENTRY_COUNT}"
            )

        return len(errors) == 0, errors, all_embeddings


class EmbeddingParityVerifier:
    """Verifies that pair scores in all-crossfeed-168h-pairs.csv are mathematically derived from raw vectors."""

    @staticmethod
    def _normalize_vectors(raw_vectors: List[List[float]]) -> List[List[float]]:
        normed = []
        for v in raw_vectors:
            norm = math.sqrt(sum(x * x for x in v))
            if norm > 0:
                normed.append([x / norm for x in v])
            else:
                normed.append(v)
        return normed

    @staticmethod
    def _dot(v1: List[float], v2: List[float]) -> float:
        return sum(x * y for x, y in zip(v1, v2))

    @classmethod
    def verify(
        cls,
        qwen_vectors: List[List[float]],
        mistral_vectors: List[List[float]],
        corpus_ids: List[int],
        pairs: List[Dict[str, str]],
        tolerance: float = 1e-4
    ) -> Tuple[bool, List[str], Dict[str, float]]:
        errors = []
        stats = {
            "max_qwen_delta": 0.0,
            "max_mistral_delta": 0.0,
            "verified_pairs": 0,
        }

        if len(qwen_vectors) != len(corpus_ids) or len(mistral_vectors) != len(corpus_ids):
            errors.append("Embedding vector counts do not match corpus ID count")
            return False, errors, stats

        id_to_idx = {cid: idx for idx, cid in enumerate(corpus_ids)}
        qwen_normed = cls._normalize_vectors(qwen_vectors)
        mistral_normed = cls._normalize_vectors(mistral_vectors)

        max_q_err = 0.0
        max_m_err = 0.0

        for row in pairs:
            id_a = int(row["id_a"])
            id_b = int(row["id_b"])
            if id_a not in id_to_idx or id_b not in id_to_idx:
                errors.append(f"Pair {row['pair_key']} references unknown ID ({id_a} or {id_b})")
                continue

            idx_a = id_to_idx[id_a]
            idx_b = id_to_idx[id_b]

            q_cos = cls._dot(qwen_normed[idx_a], qwen_normed[idx_b])
            m_cos = cls._dot(mistral_normed[idx_a], mistral_normed[idx_b])

            q_stored = float(row["qwen_score"])
            m_stored = float(row["mistral_score"])

            err_q = abs(q_cos - q_stored)
            err_m = abs(m_cos - m_stored)

            if err_q > max_q_err:
                max_q_err = err_q
            if err_m > max_m_err:
                max_m_err = err_m

            if err_q > tolerance:
                errors.append(
                    f"Qwen parity failure for pair {row['pair_key']}: derived {q_cos:.8f} vs stored {q_stored:.8f} (delta {err_q:.8f} > {tolerance})"
                )
                break
            if err_m > tolerance:
                errors.append(
                    f"Mistral parity failure for pair {row['pair_key']}: derived {m_cos:.8f} vs stored {m_stored:.8f} (delta {err_m:.8f} > {tolerance})"
                )
                break

        stats["max_qwen_delta"] = max_q_err
        stats["max_mistral_delta"] = max_m_err
        stats["verified_pairs"] = len(pairs)

        return len(errors) == 0, errors, stats


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


class TransitiveChainDetector:
    """Detects candidate triples where A-B and B-C are strong, but A-C is materially weaker."""

    @staticmethod
    def detect(pairs: List[Dict[str, str]], strong_threshold: int = 50, weak_threshold: int = 150) -> List[Dict[str, Any]]:
        strong = defaultdict(set)
        pair_dict = {p["pair_key"]: p for p in pairs}
        for p in pairs:
            if int(p["best_rank"]) <= strong_threshold:
                strong[int(p["id_a"])].add(int(p["id_b"]))
                strong[int(p["id_b"])].add(int(p["id_a"]))

        transitive_candidates = []
        seen_triples = set()
        for b in sorted(strong.keys()):
            n_list = sorted(strong[b])
            for i in range(len(n_list)):
                for j in range(i + 1, len(n_list)):
                    a = n_list[i]
                    c = n_list[j]
                    pair_ac_key = f"{min(a, c)}:{max(a, c)}"
                    pair_ac = pair_dict.get(pair_ac_key)
                    if pair_ac:
                        rank_ac = int(pair_ac["best_rank"])
                        if rank_ac > weak_threshold:
                            triple_key = tuple(sorted([a, b, c]))
                            if triple_key not in seen_triples:
                                seen_triples.add(triple_key)
                                transitive_candidates.append({
                                    "triple": (a, b, c),
                                    "weak_pair_key": pair_ac_key,
                                    "rank_ac": rank_ac,
                                    "rank_ab": int(pair_dict.get(f"{min(a, b)}:{max(a, b)}", {}).get("best_rank", 9999)),
                                    "rank_bc": int(pair_dict.get(f"{min(b, c)}:{max(b, c)}", {}).get("best_rank", 9999)),
                                })
        return transitive_candidates


class FeatureExtractor:
    """Extracts deterministic lexical, temporal, and semantic features for pairs."""

    @staticmethod
    def extract_features(
        pair_row: Dict[str, str],
        reranker_lookup: Optional[Dict[str, Dict[str, float]]] = None,
        corpus_lookup: Optional[Dict[int, Dict[str, Any]]] = None
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

        nums_a = extract_numeric_tokens(title_a)
        nums_b = extract_numeric_tokens(title_b)
        number_overlap = compute_overlap_coefficient(nums_a, nums_b)

        dates_a = extract_date_tokens(title_a)
        dates_b = extract_date_tokens(title_b)
        date_overlap = compute_overlap_coefficient(dates_a, dates_b)

        anchors_a = extract_entity_anchors(title_a, feed_a)
        anchors_b = extract_entity_anchors(title_b, feed_b)
        entity_anchor_overlap = compute_overlap_coefficient(anchors_a, anchors_b)

        pub_a = float(pair_row.get("published_at_a", 0.0))
        pub_b = float(pair_row.get("published_at_b", 0.0))
        delta_minutes = abs(pub_a - pub_b) / 60.0
        delta_hours = delta_minutes / 60.0

        date_a = datetime.fromtimestamp(pub_a, tz=timezone.utc).strftime("%Y-%m-%d") if pub_a else ""
        date_b = datetime.fromtimestamp(pub_b, tz=timezone.utc).strftime("%Y-%m-%d") if pub_b else ""
        same_calendar_day = 1 if (date_a and date_a == date_b) else 0

        meta_a = corpus_lookup.get(int(pair_row["id_a"]), {}) if corpus_lookup else {}
        meta_b = corpus_lookup.get(int(pair_row["id_b"]), {}) if corpus_lookup else {}
        url_a = meta_a.get("url", "")
        url_b = meta_b.get("url", "")
        canonical_url_match = 1 if (url_a and url_a == url_b) else 0
        norm_url_a = url_a.rstrip("/").split("?")[0].lower() if url_a else ""
        norm_url_b = url_b.rstrip("/").split("?")[0].lower() if url_b else ""
        normalized_url_match = 1 if (norm_url_a and norm_url_a == norm_url_b) else 0

        dom_a = urlparse(url_a).netloc.lower() if url_a else ""
        dom_b = urlparse(url_b).netloc.lower() if url_b else ""
        same_domain = 1 if (dom_a and dom_a == dom_b) else 0

        cat_a = meta_a.get("category_id")
        cat_b = meta_b.get("category_id")
        same_category = 1 if (cat_a is not None and cat_b is not None and cat_a == cat_b) else 0

        qwen_score = float(pair_row.get("qwen_score", 0.0))
        qwen_rank = int(pair_row.get("qwen_rank", 0))
        mistral_score = float(pair_row.get("mistral_score", 0.0))
        mistral_rank = int(pair_row.get("mistral_rank", 0))
        best_rank = int(pair_row.get("best_rank", 0))

        pair_key = pair_row.get("pair_key", "")
        r_info = reranker_lookup.get(pair_key, {}) if reranker_lookup else {}

        return {
            "schema_version": FEATURE_SCHEMA_VERSION,
            "pair_key": pair_key,
            "id_a": int(pair_row["id_a"]),
            "id_b": int(pair_row["id_b"]),
            "feed_id_a": int(pair_row["feed_id_a"]),
            "feed_id_b": int(pair_row["feed_id_b"]),
            "cross_feed": 1,
            "same_domain": same_domain,
            "same_category": same_category,
            "canonical_url_match": canonical_url_match,
            "normalized_url_match": normalized_url_match,
            "exact_normalized_title_match": exact_title_match,
            "title_token_intersection": shared_words_count,
            "title_overlap_coefficient": round(overlap_coef, 4),
            "title_jaccard_similarity": round(jaccard_sim, 4),
            "significant_word_count_a": len(words_a),
            "significant_word_count_b": len(words_b),
            "number_overlap": round(number_overlap, 4),
            "date_overlap": round(date_overlap, 4),
            "entity_anchor_overlap": round(entity_anchor_overlap, 4),
            "published_delta_minutes": round(delta_minutes, 2),
            "published_delta_hours": round(delta_hours, 4),
            "same_calendar_day_utc": same_calendar_day,
            "qwen_embedding_cosine": qwen_score,
            "qwen_rank": qwen_rank,
            "mistral_embedding_cosine": mistral_score,
            "mistral_rank": mistral_rank,
            "best_rank": best_rank,
            "reranker_score_ab": r_info.get("ab"),
            "reranker_score_ba": r_info.get("ba"),
            "reranker_score_mean": r_info.get("mean"),
            "reranker_direction_delta": r_info.get("delta"),
        }


class StratifiedSampler:
    """Generates an information-rich stratified candidate review queue for human annotation."""

    @staticmethod
    def sample_review_queue(
        pairs: List[Dict[str, str]],
        features: List[Dict[str, Any]],
        transitive_candidates: Optional[List[Dict[str, Any]]] = None,
        seed: int = DEFAULT_RANDOM_SEED
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        rng = random.Random(seed)
        feat_by_key = {f["pair_key"]: f for f in features}
        raw_by_key = {p["pair_key"]: p for p in pairs}
        pair_keys_order = [p["pair_key"] for p in pairs]

        # 10 Information-Rich Strata:
        # A. High semantic agreement (both Qwen <= 50 and Mistral <= 50) -> 11 pairs
        stratum_a = [k for k in pair_keys_order if feat_by_key[k]["qwen_rank"] <= 50 and feat_by_key[k]["mistral_rank"] <= 50]

        # B. Qwen high <= 50, Mistral > 50 -> 39 pairs
        stratum_b = [k for k in pair_keys_order if feat_by_key[k]["qwen_rank"] <= 50 and feat_by_key[k]["mistral_rank"] > 50]

        # C. Mistral high <= 50, Qwen > 50 -> 39 pairs
        stratum_c = [k for k in pair_keys_order if feat_by_key[k]["mistral_rank"] <= 50 and feat_by_key[k]["qwen_rank"] > 50]

        # D. Lexical high, semantic low (overlap >= 0.3, best_rank > 150) -> sample min(10, pool) -> 9 pairs
        pool_d = [k for k in pair_keys_order if feat_by_key[k]["title_overlap_coefficient"] >= 0.3 and feat_by_key[k]["best_rank"] > 150]
        stratum_d = rng.sample(pool_d, min(10, len(pool_d)))

        # E. Semantic high, lexical low (best_rank <= 50, overlap <= 0.2, words <= 1) -> sample min(10, pool) -> 10 pairs
        pool_e = [k for k in pair_keys_order if feat_by_key[k]["best_rank"] <= 50 and feat_by_key[k]["title_overlap_coefficient"] <= 0.2 and feat_by_key[k]["title_token_intersection"] <= 1]
        stratum_e = rng.sample(pool_e, min(10, len(pool_e)))

        # F. Temporal hard negative (semantically/lexically plausible, delta_hours >= 4.0) -> sample min(10, pool) -> 10 pairs
        pool_f = [k for k in pair_keys_order if (feat_by_key[k]["best_rank"] <= 150 or feat_by_key[k]["title_overlap_coefficient"] >= 0.3) and feat_by_key[k]["published_delta_hours"] >= 4.0]
        stratum_f = rng.sample(pool_f, min(10, len(pool_f)))

        # G. Entity proxy hard negative (capitalized anchor token overlap >= 1, best_rank > 250) -> sample min(10, pool) -> 10 pairs
        pool_g = [k for k in pair_keys_order if feat_by_key[k]["entity_anchor_overlap"] > 0 and feat_by_key[k]["best_rank"] > 250]
        stratum_g = rng.sample(pool_g, min(10, len(pool_g)))

        # H. Obvious negative control (best_rank > 1000, shared_words == 0) -> sample min(15, pool) -> 15 pairs
        pool_h = [k for k in pair_keys_order if feat_by_key[k]["best_rank"] > 1000 and feat_by_key[k]["title_token_intersection"] == 0]
        stratum_h = rng.sample(pool_h, min(15, len(pool_h)))

        # I. Duplicate or near-duplicate title (exact match or overlap >= 0.8) -> all available -> 1 pair
        stratum_i = [k for k in pair_keys_order if feat_by_key[k]["exact_normalized_title_match"] == 1 or feat_by_key[k]["title_overlap_coefficient"] >= 0.8]

        # J. Transitive chain candidate weak bridges -> 12 pairs
        if transitive_candidates is not None:
            stratum_j = sorted(list({tc["weak_pair_key"] for tc in transitive_candidates if tc["weak_pair_key"] in feat_by_key}))
        else:
            stratum_j = []

        # Multi-strata assignment tracking
        selected_pairs: Dict[str, List[str]] = defaultdict(list)
        for k in stratum_a: selected_pairs[k].append("A_HIGH_SEMANTIC_AGREEMENT")
        for k in stratum_b: selected_pairs[k].append("B_QWEN_HIGH_MISTRAL_LOW")
        for k in stratum_c: selected_pairs[k].append("C_MISTRAL_HIGH_QWEN_LOW")
        for k in stratum_d: selected_pairs[k].append("D_LEXICAL_HIGH_SEMANTIC_LOW")
        for k in stratum_e: selected_pairs[k].append("E_SEMANTIC_HIGH_LEXICAL_LOW")
        for k in stratum_f: selected_pairs[k].append("F_TEMPORAL_HARD_NEGATIVE")
        for k in stratum_g: selected_pairs[k].append("G_ENTITY_PROXY_HARD_NEGATIVE")
        for k in stratum_h: selected_pairs[k].append("H_OBVIOUS_NEGATIVE_CONTROL")
        for k in stratum_i: selected_pairs[k].append("I_DUPLICATE_TITLE_CROSS_FEED")
        for k in stratum_j: selected_pairs[k].append("J_POTENTIAL_TRANSITIVE_CHAIN")

        # Deterministic canonical sort before shuffle for byte-identical queue reproducibility
        unique_keys = sorted(selected_pairs.keys())
        rng.shuffle(unique_keys)

        queue_entries: List[Dict[str, Any]] = []
        for idx, k in enumerate(unique_keys, start=1):
            f = feat_by_key[k]
            p = raw_by_key[k]
            all_strata = selected_pairs[k]
            primary_stratum = all_strata[0]

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
                "primary_stratum": primary_stratum,
                "sampling_strata": ",".join(all_strata),
                "schema_version": f["schema_version"],
                "qwen_score": f["qwen_embedding_cosine"],
                "qwen_rank": f["qwen_rank"],
                "mistral_score": f["mistral_embedding_cosine"],
                "mistral_rank": f["mistral_rank"],
                "best_rank": f["best_rank"],
                "reranker_score_ab": f["reranker_score_ab"],
                "reranker_score_ba": f["reranker_score_ba"],
                "reranker_score_mean": f["reranker_score_mean"],
                "reranker_direction_delta": f["reranker_direction_delta"],
                "shared_words_count": f["title_token_intersection"],
                "overlap_coefficient": f["title_overlap_coefficient"],
                "jaccard_similarity": f["title_jaccard_similarity"],
                "number_overlap": f["number_overlap"],
                "date_overlap": f["date_overlap"],
                "entity_anchor_overlap": f["entity_anchor_overlap"],
                "delta_minutes": f["published_delta_minutes"],
                "delta_hours": f["published_delta_hours"],
                "same_calendar_day_utc": f["same_calendar_day_utc"],
                "canonical_url_match": f["canonical_url_match"],
                "normalized_url_match": f["normalized_url_match"],
                "exact_normalized_title_match": f["exact_normalized_title_match"],
                "same_domain": f["same_domain"],
                "same_category": f["same_category"],
            })

        strata_counts = {
            "cat_a_high_semantic_agreement": len(stratum_a),
            "cat_b_qwen_high_mistral_low": len(stratum_b),
            "cat_c_mistral_high_qwen_low": len(stratum_c),
            "cat_d_lexical_high_semantic_low": len(stratum_d),
            "cat_e_semantic_high_lexical_low": len(stratum_e),
            "cat_f_temporal_hard_negative": len(stratum_f),
            "cat_g_entity_proxy_hard_negative": len(stratum_g),
            "cat_h_obvious_negative_control": len(stratum_h),
            "cat_i_duplicate_title_cross_feed": len(stratum_i),
            "cat_j_potential_transitive_chain": len(stratum_j),
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
    """Run full verification, semantic vector parity, feature extraction, and sampling."""
    print("============================================================")
    print("NEWSFLUX STORY IDENTITY V1 RESEARCH HARNESS (R2)")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("============================================================")

    # 1. Corpus verification
    print("[1/6] Verifying Frozen Home-200 Corpus...")
    ok_corp, errs_corp, entries = CorpusVerifier.verify(corpus_path)
    if not ok_corp:
        for e in errs_corp:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    corpus_lookup = {item["id"]: item for item in entries}
    corpus_ids = [item["id"] for item in entries]
    print(f"  [PASS] {len(entries)} articles verified. SHA256={EXPECTED_CORPUS_FILE_SHA256[:16]}...")
    print(f"  [PASS] Declared fingerprint: {EXPECTED_CORPUS_FINGERPRINT[:16]}... ({CORPUS_FINGERPRINT_DERIVATION})")

    # 2. Embeddings verification
    print("[2/6] Verifying Precomputed Dense Embeddings...")
    ok_qwen, errs_qwen, qwen_vectors, qwen_ids = EmbeddingVerifier.verify_qwen(qwen_path)
    if not ok_qwen:
        for e in errs_qwen:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    if qwen_ids != corpus_ids:
        print("  [FAIL] Qwen IDs do not align with corpus IDs in identical order", file=sys.stderr)
        return 1
    print(f"  [PASS] Qwen: {len(qwen_vectors)} vectors x 1024-dim, all dimensions validated 100%.")

    ok_mist, errs_mist, mistral_vectors = EmbeddingVerifier.verify_mistral(mistral_dir)
    if not ok_mist:
        for e in errs_mist:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] Mistral: {len(mistral_vectors)} vectors x 1024-dim, all dimensions validated 100%.")

    # 3. Pair universe verification
    print("[3/6] Verifying Candidate Pair Universe...")
    ok_pair, errs_pair, pairs = PairUniverseVerifier.verify(pairs_path)
    if not ok_pair:
        for e in errs_pair:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] {len(pairs)} cross-feed pairs verified. Strict cross-feed 100%.")

    # 4. Semantic vector parity verification
    print("[4/6] Verifying Semantic Vector Parity Against Pair Universe...")
    ok_parity, errs_parity, parity_stats = EmbeddingParityVerifier.verify(
        qwen_vectors=qwen_vectors,
        mistral_vectors=mistral_vectors,
        corpus_ids=corpus_ids,
        pairs=pairs,
        tolerance=1e-4
    )
    if not ok_parity:
        for e in errs_parity:
            print(f"  [FAIL] {e}", file=sys.stderr)
        return 1
    print(f"  [PASS] QWEN_COSINE_DERIVED_FROM_VECTOR=PASS (max delta {parity_stats['max_qwen_delta']:.10f})")
    print(f"  [PASS] MISTRAL_COSINE_DERIVED_FROM_VECTOR=PASS (max delta {parity_stats['max_mistral_delta']:.10f})")
    print("  [PASS] PAIR_SCORE_PARITY_GATE=PASS (18,953 pairs verified)")

    # 5. Transitive chain detection
    print("[5/6] Detecting Transitive Chain Candidates...")
    transitive_candidates = TransitiveChainDetector.detect(pairs)
    print(f"  [PASS] TRANSITIVE_CHAIN_CANDIDATE_COUNT={len(transitive_candidates)}")

    # 6. Feature extraction & Sampling
    print(f"[6/6] Extracting Features ({FEATURE_SCHEMA_VERSION}) and Sampling...")
    reranker_lookup: Dict[str, Dict[str, float]] = {}
    if reranker_path and os.path.exists(reranker_path):
        with open(reranker_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ab = float(r["reranker_score_ab"])
                ba = float(r["reranker_score_ba"])
                reranker_lookup[r["pair_key"]] = {
                    "ab": ab,
                    "ba": ba,
                    "mean": float(r["reranker_score_mean"]),
                    "delta": round(abs(ab - ba), 4),
                }
        print(f"  Loaded {len(reranker_lookup)} reranker directional pairs from top-250.")

    features = [FeatureExtractor.extract_features(p, reranker_lookup, corpus_lookup) for p in pairs]
    print(f"  Extracted feature vectors for all {len(features)} pairs.")

    if verify_only:
        print("Verification-only mode: skipping review queue file generation.")
        print("HARNESS_STATUS=VERIFICATION_SUCCESS")
        return 0

    queue_entries, strata_counts = StratifiedSampler.sample_review_queue(
        pairs=pairs,
        features=features,
        transitive_candidates=transitive_candidates,
        seed=seed
    )

    print("  Stratified Sampling Distribution:")
    for k, v in strata_counts.items():
        print(f"    - {k}: {v}")
    print(f"  PROPOSED_LABEL_QUEUE_SIZE={len(queue_entries)}")

    # Output emission with strict path guard
    if output_dir:
        valid_path, path_err = validate_output_path(output_dir)
        if not valid_path:
            print(f"  [SECURITY REJECTION] {path_err}", file=sys.stderr)
            return 1

        os.makedirs(output_dir, exist_ok=True)

        # 1. Blind annotator queue (stripped of model identities, scores, and strata)
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
                "corpus_fingerprint_derivation": CORPUS_FINGERPRINT_DERIVATION,
                "corpus_sha256": EXPECTED_CORPUS_FILE_SHA256,
                "pair_universe_sha256": EXPECTED_PAIR_UNIVERSE_SHA256,
                "pair_universe_count": len(pairs),
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "random_seed": seed,
                "strata_counts": strata_counts,
                "transitive_chain_candidate_count": len(transitive_candidates),
                "queue_size": len(queue_entries),
                "vector_provenance": {
                    "qwen_vector_count": len(qwen_vectors),
                    "qwen_all_vector_dimensions": EXPECTED_EMBEDDING_DIMENSION,
                    "mistral_vector_count": len(mistral_vectors),
                    "mistral_all_vector_dimensions": EXPECTED_EMBEDDING_DIMENSION,
                    "qwen_cosine_derived_from_vector": "PASS",
                    "mistral_cosine_derived_from_vector": "PASS",
                    "pair_score_parity_gate": "PASS",
                    "max_qwen_delta": parity_stats["max_qwen_delta"],
                    "max_mistral_delta": parity_stats["max_mistral_delta"],
                },
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
