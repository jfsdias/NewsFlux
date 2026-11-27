#!/usr/bin/env python3
"""Unit tests for Story Identity V1 Research Harness (R2).

Verifies:
- Corpus fingerprint & hash validation
- All-vector dimension validation (Qwen & Mistral 1024-dim across all vectors)
- Semantic cosine recomputation and parity gate against stored pair scores
- Numeric token separation (significant words exclude pure numbers)
- Dedicated date token extraction and deterministic entity anchor proxy
- Pair universe constraints (cross-feed, window)
- Transitive chain candidate detection (A-B strong, B-C strong, A-C weak)
- 10-strata construction and empirical deduplication
- Blinding verification (annotator queue contains no model names, scores, or strata)
- Same-seed byte-identical queue and audit key reproducibility
- Private output path guardrail (rejection of untracked repo directories)
"""

import csv
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

try:
    from .harness import (
        CorpusVerifier,
        EmbeddingParityVerifier,
        EmbeddingVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
        StratifiedSampler,
        TransitiveChainDetector,
        compute_jaccard_similarity,
        compute_overlap_coefficient,
        extract_date_tokens,
        extract_entity_anchors,
        extract_numeric_tokens,
        extract_significant_words,
        normalize_title,
        run_harness,
        validate_output_path,
        verify_sha256,
        CORPUS_FINGERPRINT_DERIVATION,
        EXPECTED_CORPUS_FINGERPRINT,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_COUNT,
        FEATURE_SCHEMA_VERSION,
    )
except ImportError:
    from harness import (
        CorpusVerifier,
        EmbeddingParityVerifier,
        EmbeddingVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
        StratifiedSampler,
        TransitiveChainDetector,
        compute_jaccard_similarity,
        compute_overlap_coefficient,
        extract_date_tokens,
        extract_entity_anchors,
        extract_numeric_tokens,
        extract_significant_words,
        normalize_title,
        run_harness,
        validate_output_path,
        verify_sha256,
        CORPUS_FINGERPRINT_DERIVATION,
        EXPECTED_CORPUS_FINGERPRINT,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_COUNT,
        FEATURE_SCHEMA_VERSION,
    )


class TestStoryIdentityHarness(unittest.TestCase):
    """Test suite for Story Identity V1 harness."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_story_identity_")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_normalize_title(self):
        self.assertEqual(normalize_title(""), "")
        self.assertEqual(
            normalize_title("‘Synthetic Title: High Production’ will feature Award-Winning Actor!"),
            "synthetic title high production will feature award winning actor"
        )
        self.assertEqual(
            normalize_title("  Alpha   releases   platformOS 10.2   RC   "),
            "alpha releases platformos 10 2 rc"
        )

    def test_extract_significant_words_numeric_separation(self):
        # Verify pure numbers are excluded from significant words
        words = extract_significant_words(
            "Service Provider launches new internet tier with 50 percent discount in 2026",
            feed_title="Daily News Service Provider"
        )
        self.assertIn("launches", words)
        self.assertIn("tier", words)
        self.assertIn("internet", words)
        self.assertIn("discount", words)
        self.assertIn("percent", words)
        self.assertNotIn("50", words)    # Pure number excluded
        self.assertNotIn("2026", words)  # Pure number excluded
        self.assertNotIn("service", words)  # Stripped because in feed_title
        self.assertNotIn("provider", words) # Stripped because in feed_title
        self.assertNotIn("with", words)     # Stopword
        self.assertNotIn("in", words)       # Stopword

        # Verify dedicated numeric tokens
        nums = extract_numeric_tokens("New model has 1024 dims and 50 batches with 2026 release")
        self.assertEqual(nums, {"1024", "50", "2026"})

        # Verify dedicated date tokens
        dates = extract_date_tokens("Event scheduled for 2026-10-25 or 12/31/2026")
        self.assertIn("2026", dates)
        self.assertIn("10-25", dates)
        self.assertIn("12/31/2026", dates)

    def test_extract_entity_anchors_proxy(self):
        anchors = extract_entity_anchors(
            "Alpha Corp and Beta Global enter partnership in London",
            feed_title="Tech Feed"
        )
        self.assertIn("alpha", anchors)
        self.assertIn("corp", anchors)
        self.assertIn("beta", anchors)
        self.assertIn("global", anchors)
        self.assertIn("london", anchors)

    def test_overlap_and_jaccard_metrics(self):
        self.assertEqual(compute_overlap_coefficient(set(), set()), 0.0)
        self.assertEqual(compute_jaccard_similarity(set(), set()), 0.0)

        s1 = {"alpha", "platformos", "release"}
        self.assertEqual(compute_overlap_coefficient(s1, s1), 1.0)
        self.assertEqual(compute_jaccard_similarity(s1, s1), 1.0)

        s2 = {"beta", "device", "firmware"}
        self.assertEqual(compute_overlap_coefficient(s1, s2), 0.0)
        self.assertEqual(compute_jaccard_similarity(s1, s2), 0.0)

        # Asymmetric sets (short aggregator headline vs full headline)
        short_title = {"synthetic", "title", "entity", "event"}
        long_title = {"synthetic", "title", "entity", "event", "analysis", "commentary", "source", "detail"}
        overlap = compute_overlap_coefficient(short_title, long_title)
        jaccard = compute_jaccard_similarity(short_title, long_title)
        self.assertEqual(overlap, 1.0)
        self.assertEqual(jaccard, 0.5)

    def test_feature_extractor(self):
        pair_row = {
            "pair_key": "100:200",
            "id_a": "100",
            "id_b": "200",
            "feed_id_a": "10",
            "feed_id_b": "20",
            "feed_a": "Feed A",
            "feed_b": "Feed B",
            "published_at_a": "1792800000.0",
            "published_at_b": "1792803600.0",  # Exactly 1 hour later (60 min)
            "title_a": "Breaking news 2026 event about AI models announced in 50 states",
            "title_b": "Breaking news 2026 event about AI models announced in 50 states today",
            "qwen_score": "0.85",
            "qwen_rank": "5",
            "mistral_score": "0.92",
            "mistral_rank": "2",
            "best_rank": "2",
        }
        reranker_lookup = {
            "100:200": {
                "ab": 7.25,
                "ba": 6.75,
                "mean": 7.0,
                "delta": 0.5,
            }
        }
        corpus_lookup = {
            100: {"url": "https://example.com/story-100", "category_id": 1},
            200: {"url": "https://example.com/story-200", "category_id": 1},
        }

        feats = FeatureExtractor.extract_features(pair_row, reranker_lookup, corpus_lookup)
        self.assertEqual(feats["schema_version"], FEATURE_SCHEMA_VERSION)
        self.assertEqual(feats["pair_key"], "100:200")
        self.assertEqual(feats["id_a"], 100)
        self.assertEqual(feats["id_b"], 200)
        self.assertEqual(feats["feed_id_a"], 10)
        self.assertEqual(feats["feed_id_b"], 20)
        self.assertEqual(feats["cross_feed"], 1)
        self.assertEqual(feats["same_domain"], 1)
        self.assertEqual(feats["same_category"], 1)
        self.assertEqual(feats["canonical_url_match"], 0)
        self.assertEqual(feats["normalized_url_match"], 0)
        self.assertAlmostEqual(feats["published_delta_minutes"], 60.0, places=2)
        self.assertAlmostEqual(feats["published_delta_hours"], 1.0, places=3)
        self.assertEqual(feats["same_calendar_day_utc"], 1)
        self.assertEqual(feats["exact_normalized_title_match"], 0)
        self.assertGreater(feats["title_token_intersection"], 0)
        self.assertGreater(feats["title_overlap_coefficient"], 0.7)
        self.assertEqual(feats["number_overlap"], 1.0)  # Both have {"2026", "50"}
        self.assertEqual(feats["date_overlap"], 1.0)    # Both have {"2026"}
        self.assertEqual(feats["qwen_embedding_cosine"], 0.85)
        self.assertEqual(feats["mistral_embedding_cosine"], 0.92)
        self.assertEqual(feats["reranker_score_ab"], 7.25)
        self.assertEqual(feats["reranker_score_ba"], 6.75)
        self.assertEqual(feats["reranker_score_mean"], 7.0)
        self.assertEqual(feats["reranker_direction_delta"], 0.5)

    def test_corpus_verifier_rejection(self):
        ok, errs, _ = CorpusVerifier.verify(os.path.join(self.test_dir, "missing.jsonl"))
        self.assertFalse(ok)
        self.assertTrue(any("does not exist" in e for e in errs))

        dummy_path = os.path.join(self.test_dir, "corrupt.jsonl")
        with open(dummy_path, "w") as f:
            f.write('{"id": 1}\n')
        ok, errs, _ = CorpusVerifier.verify(dummy_path)
        self.assertFalse(ok)
        self.assertTrue(any("mismatch" in e for e in errs))

    def test_all_vector_dimension_validation(self):
        # Qwen with vector dimension mismatch on index 1
        qwen_file = os.path.join(self.test_dir, "qwen_corrupt.json")
        with open(qwen_file, "w") as f:
            json.dump({
                "corpus_fingerprint": EXPECTED_CORPUS_FINGERPRINT,
                "ids": list(range(200)),
                "embeddings": [[0.1] * 1024, [0.1] * 512] + [[0.1] * 1024] * 198
            }, f)
        ok, errs, _, _ = EmbeddingVerifier.verify_qwen(qwen_file)
        self.assertFalse(ok)
        self.assertTrue(any("dimension" in e for e in errs))

        # Mistral with wrong batch size
        mistral_file = os.path.join(self.test_dir, "mistral-batch-000-049.json")
        with open(mistral_file, "w") as f:
            json.dump({
                "corpus_fingerprint": EXPECTED_CORPUS_FINGERPRINT,
                "embeddings": [[0.1] * 1024] * 40 # 40 instead of 50
            }, f)
        ok, errs, _ = EmbeddingVerifier.verify_mistral(self.test_dir)
        self.assertFalse(ok)
        self.assertTrue(any("expected 50" in e or "Expected 4 Mistral batch files" in e for e in errs))

    def test_embedding_parity_verifier(self):
        # Synthetic unit vectors
        v1 = [1.0, 0.0]
        v2 = [0.0, 1.0]
        v3 = [0.70710678, 0.70710678]

        corpus_ids = [10, 20, 30]
        qwen_vectors = [v1, v2, v3]
        mistral_vectors = [v1, v2, v3]

        pairs = [
            {"pair_key": "10:20", "id_a": "10", "id_b": "20", "qwen_score": "0.0", "mistral_score": "0.0"},
            {"pair_key": "10:30", "id_a": "10", "id_b": "30", "qwen_score": "0.70710678", "mistral_score": "0.70710678"},
        ]

        ok, errs, stats = EmbeddingParityVerifier.verify(
            qwen_vectors=qwen_vectors,
            mistral_vectors=mistral_vectors,
            corpus_ids=corpus_ids,
            pairs=pairs,
            tolerance=1e-4
        )
        self.assertTrue(ok)
        self.assertEqual(len(errs), 0)
        self.assertLess(stats["max_qwen_delta"], 1e-4)
        self.assertLess(stats["max_mistral_delta"], 1e-4)

        # Deliberate failure test
        pairs_fail = [
            {"pair_key": "10:20", "id_a": "10", "id_b": "20", "qwen_score": "0.999", "mistral_score": "0.0"}
        ]
        ok_fail, errs_fail, _ = EmbeddingParityVerifier.verify(
            qwen_vectors=qwen_vectors,
            mistral_vectors=mistral_vectors,
            corpus_ids=corpus_ids,
            pairs=pairs_fail,
            tolerance=1e-4
        )
        self.assertFalse(ok_fail)
        self.assertTrue(any("Qwen parity failure" in e for e in errs_fail))

    def test_transitive_chain_detector(self):
        # Graph: 1-2 strong (rank 10), 2-3 strong (rank 20), 1-3 weak (rank 300)
        pairs = [
            {"pair_key": "1:2", "id_a": "1", "id_b": "2", "best_rank": "10"},
            {"pair_key": "2:3", "id_a": "2", "id_b": "3", "best_rank": "20"},
            {"pair_key": "1:3", "id_a": "1", "id_b": "3", "best_rank": "300"},
            # Disconnected pair 4-5
            {"pair_key": "4:5", "id_a": "4", "id_b": "5", "best_rank": "5"},
        ]
        candidates = TransitiveChainDetector.detect(pairs, strong_threshold=50, weak_threshold=150)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["weak_pair_key"], "1:3")
        self.assertEqual(candidates[0]["rank_ac"], 300)

    def test_private_output_path_rejection(self):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))

        # Test 1: path outside repository -> PASS
        ok_ext, err_ext = validate_output_path("/tmp/newsflux-test-private", repo_root=repo_root)
        self.assertTrue(ok_ext)
        self.assertIsNone(err_ext)

        # Test 2: path inside repository under src/ -> REJECTED
        inside_untracked = os.path.join(repo_root, "src/private_output")
        ok_in, err_in = validate_output_path(inside_untracked, repo_root=repo_root)
        self.assertFalse(ok_in)
        self.assertIn("NOT git-ignored", err_in)

    def test_byte_identical_queue_emission(self):
        # Generate synthetic pair and feature sets
        pairs = []
        features = []
        for i in range(1, 151):
            k = f"{i}:{i+1000}"
            p = {
                "pair_key": k,
                "id_a": str(i),
                "id_b": str(i + 1000),
                "feed_id_a": "1",
                "feed_id_b": "2",
                "feed_a": f"Feed {i}",
                "feed_b": f"Feed {i+1000}",
                "published_at_a": "1792800000.0",
                "published_at_b": "1792801000.0",
                "title_a": f"Synthetic Event Title A {i}",
                "title_b": f"Synthetic Event Title B {i}",
            }
            f = {
                "schema_version": FEATURE_SCHEMA_VERSION,
                "pair_key": k,
                "id_a": i,
                "id_b": i + 1000,
                "qwen_embedding_cosine": 0.8,
                "qwen_rank": i,
                "mistral_embedding_cosine": 0.85,
                "mistral_rank": (i * 3) % 150 + 1,
                "best_rank": min(i, (i * 3) % 150 + 1),
                "reranker_score_ab": None,
                "reranker_score_ba": None,
                "reranker_score_mean": None,
                "reranker_direction_delta": None,
                "title_token_intersection": 2,
                "title_overlap_coefficient": 0.5,
                "title_jaccard_similarity": 0.3,
                "number_overlap": 0.0,
                "date_overlap": 0.0,
                "entity_anchor_overlap": 0.0,
                "published_delta_minutes": 16.67,
                "published_delta_hours": 0.28,
                "same_calendar_day_utc": 1,
                "canonical_url_match": 0,
                "normalized_url_match": 0,
                "exact_normalized_title_match": 0,
                "same_domain": 0,
                "same_category": 0,
            }
            pairs.append(p)
            features.append(f)

        q1, c1 = StratifiedSampler.sample_review_queue(pairs, features, seed=20261025)
        q2, c2 = StratifiedSampler.sample_review_queue(pairs, features, seed=20261025)

        self.assertEqual(len(q1), len(q2))
        self.assertEqual(c1, c2)
        for e1, e2 in zip(q1, q2):
            self.assertEqual(e1["pair_key"], e2["pair_key"])
            self.assertEqual(e1["review_id"], e2["review_id"])

    def test_live_corpus_and_artifacts(self):
        """Validates real frozen artifacts if present on the runner filesystem."""
        corpus_path = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"
        qwen_path = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/qwen-embeddings.json"
        mistral_dir = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1"
        pairs_path = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
        reranker_path = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/r3a-bakeoff-v1/r3b-qwen3-reranker-0.6b-top250/r3b-qwen3-reranker-top250.csv"

        if not os.path.exists(corpus_path):
            self.skipTest(f"Frozen corpus not present at {corpus_path}")

        out_dir = os.path.join(self.test_dir, "test_output")
        rc = run_harness(
            corpus_path=corpus_path,
            qwen_path=qwen_path,
            mistral_dir=mistral_dir,
            pairs_path=pairs_path,
            reranker_path=reranker_path,
            output_dir=out_dir,
            seed=20261025,
            verify_only=False,
        )
        self.assertEqual(rc, 0)

        queue_csv = os.path.join(out_dir, "story01b_annotator_queue.csv")
        audit_csv = os.path.join(out_dir, "story01b_audit_key.csv")
        receipt_json = os.path.join(out_dir, "story01b_sampling_receipt.json")

        self.assertTrue(os.path.exists(queue_csv))
        self.assertTrue(os.path.exists(audit_csv))
        self.assertTrue(os.path.exists(receipt_json))

        # Check empirical queue length is exactly 141
        with open(queue_csv) as f:
            queue_rows = list(csv.DictReader(f))
        self.assertEqual(len(queue_rows), 141)

        # Check annotator blinding (no model scores, no ranks, no strata)
        self.assertNotIn("qwen_score", queue_rows[0])
        self.assertNotIn("mistral_score", queue_rows[0])
        self.assertNotIn("reranker_score_mean", queue_rows[0])
        self.assertNotIn("primary_stratum", queue_rows[0])
        self.assertNotIn("sampling_strata", queue_rows[0])

        # Check receipt
        with open(receipt_json) as f:
            receipt = json.load(f)
        self.assertEqual(receipt["corpus_fingerprint"], EXPECTED_CORPUS_FINGERPRINT)
        self.assertEqual(receipt["corpus_fingerprint_derivation"], CORPUS_FINGERPRINT_DERIVATION)
        self.assertEqual(receipt["corpus_sha256"], EXPECTED_CORPUS_FILE_SHA256)
        self.assertEqual(receipt["pair_universe_count"], EXPECTED_PAIR_UNIVERSE_COUNT)
        self.assertEqual(receipt["queue_size"], 141)
        self.assertEqual(receipt["strata_counts"]["total_sampled_pairs"], 141)
        self.assertEqual(receipt["transitive_chain_candidate_count"], 12)
        self.assertEqual(receipt["vector_provenance"]["qwen_cosine_derived_from_vector"], "PASS")
        self.assertEqual(receipt["vector_provenance"]["mistral_cosine_derived_from_vector"], "PASS")
        self.assertEqual(receipt["vector_provenance"]["pair_score_parity_gate"], "PASS")


if __name__ == "__main__":
    unittest.main()
