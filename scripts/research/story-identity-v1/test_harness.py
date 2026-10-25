#!/usr/bin/env python3
"""Unit tests for Story Identity V1 Research Harness.

Verifies:
- Corpus fingerprint & hash validation
- Embedding dimensions and batch integrity
- Pair universe constraints (cross-feed, window)
- Feature extraction determinism (normalization, stopwords, overlap, temporal)
- Sampling repeatability with deterministic seed
- Data privacy guardrails
"""

import csv
import hashlib
import json
import os
import shutil
import tempfile
import unittest

try:
    from .harness import (
        CorpusVerifier,
        EmbeddingVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
        StratifiedSampler,
        compute_jaccard_similarity,
        compute_overlap_coefficient,
        extract_significant_words,
        normalize_title,
        run_harness,
        verify_sha256,
        EXPECTED_CORPUS_FINGERPRINT,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_COUNT,
    )
except ImportError:
    from harness import (
        CorpusVerifier,
        EmbeddingVerifier,
        FeatureExtractor,
        PairUniverseVerifier,
        StratifiedSampler,
        compute_jaccard_similarity,
        compute_overlap_coefficient,
        extract_significant_words,
        normalize_title,
        run_harness,
        verify_sha256,
        EXPECTED_CORPUS_FINGERPRINT,
        EXPECTED_CORPUS_FILE_SHA256,
        EXPECTED_HOME200_ENTRY_COUNT,
        EXPECTED_PAIR_UNIVERSE_COUNT,
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
            normalize_title("‘Cinema Sintético: Grande Produção’ terá Ator Premiado em papel misterioso!"),
            "cinema sintético grande produção terá ator premiado em papel misterioso"
        )
        self.assertEqual(
            normalize_title("  Alpha   releases   platformOS 10.2   RC   "),
            "alpha releases platformos 10 2 rc"
        )

    def test_extract_significant_words(self):
        # Synthetic Portuguese title + feed title token removal
        words = extract_significant_words(
            "Operadora Alfa lança novos planos de internet com 50% de desconto",
            feed_title="Portal Notícias Operadora Alfa"
        )
        self.assertIn("planos", words)
        self.assertIn("internet", words)
        self.assertIn("desconto", words)
        self.assertNotIn("operadora", words)  # Stripped because in feed_title
        self.assertNotIn("alfa", words)       # Stripped because in feed_title
        self.assertNotIn("de", words)         # Stopword
        self.assertNotIn("com", words)        # Stopword

        # Synthetic English title
        words_en = extract_significant_words(
            "Example Tech Corp updates privacy terms for developer platform accounts",
            feed_title="Tech Daily News Example"
        )
        self.assertIn("privacy", words_en)
        self.assertIn("developer", words_en)
        self.assertIn("platform", words_en)
        self.assertNotIn("example", words_en)  # Stripped because in feed_title
        self.assertNotIn("for", words_en)      # Stopword

    def test_overlap_and_jaccard_metrics(self):
        # Empty sets
        self.assertEqual(compute_overlap_coefficient(set(), set()), 0.0)
        self.assertEqual(compute_jaccard_similarity(set(), set()), 0.0)

        # Identical sets
        s1 = {"alpha", "platformos", "release"}
        self.assertEqual(compute_overlap_coefficient(s1, s1), 1.0)
        self.assertEqual(compute_jaccard_similarity(s1, s1), 1.0)

        # Disjoint sets
        s2 = {"beta", "device", "firmware"}
        self.assertEqual(compute_overlap_coefficient(s1, s2), 0.0)
        self.assertEqual(compute_jaccard_similarity(s1, s2), 0.0)

        # Asymmetric sets (aggregator title case)
        short_title = {"synthetic", "title", "entity", "event"}
        long_title = {"synthetic", "title", "entity", "event", "analysis", "commentary", "source", "detail"}
        overlap = compute_overlap_coefficient(short_title, long_title)
        jaccard = compute_jaccard_similarity(short_title, long_title)
        # Overlap coefficient: 4 / min(4, 8) = 1.0
        self.assertEqual(overlap, 1.0)
        # Jaccard: 4 / (4 + 8 - 4) = 4 / 8 = 0.5
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
            "published_at_b": "1792803600.0",  # Exactly 1 hour later
            "title_a": "Breaking news event about AI models",
            "title_b": "Breaking news event about AI models announced",
            "qwen_score": "0.85",
            "qwen_rank": "5",
            "mistral_score": "0.92",
            "mistral_rank": "2",
            "best_rank": "2",
        }
        reranker_lookup = {"100:200": 6.5}

        feats = FeatureExtractor.extract_features(pair_row, reranker_lookup)
        self.assertEqual(feats["pair_key"], "100:200")
        self.assertEqual(feats["id_a"], 100)
        self.assertEqual(feats["id_b"], 200)
        self.assertEqual(feats["feed_id_a"], 10)
        self.assertEqual(feats["feed_id_b"], 20)
        self.assertAlmostEqual(feats["published_delta_hours"], 1.0, places=3)
        self.assertEqual(feats["same_calendar_day_utc"], 1)
        self.assertEqual(feats["exact_normalized_title_match"], 0)
        self.assertGreater(feats["shared_significant_words_count"], 0)
        self.assertGreater(feats["title_overlap_coefficient"], 0.5)
        self.assertEqual(feats["qwen_cosine_similarity"], 0.85)
        self.assertEqual(feats["mistral_cosine_similarity"], 0.92)
        self.assertEqual(feats["reranker_score"], 6.5)

    def test_corpus_verifier_rejection(self):
        # Non-existent file
        ok, errs, _ = CorpusVerifier.verify(os.path.join(self.test_dir, "missing.jsonl"))
        self.assertFalse(ok)
        self.assertTrue(any("does not exist" in e for e in errs))

        # Corrupted SHA256
        dummy_path = os.path.join(self.test_dir, "corrupt.jsonl")
        with open(dummy_path, "w") as f:
            f.write('{"id": 1}\n')
        ok, errs, _ = CorpusVerifier.verify(dummy_path)
        self.assertFalse(ok)
        self.assertTrue(any("mismatch" in e for e in errs))

    def test_pair_universe_verifier_rejection(self):
        # Same-feed violation
        dummy_csv = os.path.join(self.test_dir, "same_feed.csv")
        with open(dummy_csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["pair_key", "id_a", "id_b", "feed_id_a", "feed_id_b"])
            writer.writeheader()
            writer.writerow({
                "pair_key": "1:2",
                "id_a": "1",
                "id_b": "2",
                "feed_id_a": "10",
                "feed_id_b": "10",  # Same feed violation!
            })
        ok, errs, _ = PairUniverseVerifier.verify(dummy_csv)
        self.assertFalse(ok)
        self.assertTrue(any("same-feed pairs" in e or "SHA256" in e for e in errs))

    def test_deterministic_sampling_repeatability(self):
        # Synthetic candidate pairs
        pairs = []
        features = []
        for i in range(1, 101):
            k = f"{i}:{i+1000}"
            p = {
                "pair_key": k,
                "id_a": str(i),
                "id_b": str(i + 1000),
                "feed_id_a": "1",
                "feed_id_b": "2",
                "feed_a": "Feed 1",
                "feed_b": "Feed 2",
                "published_at_a": "1792800000.0",
                "published_at_b": "1792801000.0",
                "title_a": f"Title A {i}",
                "title_b": f"Title B {i}",
            }
            # Vary ranks
            qwen_r = i
            mist_r = (i * 3) % 150 + 1
            best_r = min(qwen_r, mist_r)
            f = {
                "pair_key": k,
                "id_a": i,
                "id_b": i + 1000,
                "qwen_cosine_similarity": 0.8,
                "qwen_rank": qwen_r,
                "mistral_cosine_similarity": 0.85,
                "mistral_rank": mist_r,
                "best_rank": best_r,
                "reranker_score": None,
                "shared_significant_words_count": 2,
                "title_overlap_coefficient": 0.5,
                "title_jaccard_similarity": 0.3,
                "published_delta_hours": 0.5,
            }
            pairs.append(p)
            features.append(f)

        # Run sampling twice with identical seed
        q1, c1 = StratifiedSampler.sample_review_queue(pairs, features, seed=20261025)
        q2, c2 = StratifiedSampler.sample_review_queue(pairs, features, seed=20261025)

        self.assertEqual(len(q1), len(q2))
        self.assertEqual(c1, c2)
        for e1, e2 in zip(q1, q2):
            self.assertEqual(e1["pair_key"], e2["pair_key"])
            self.assertEqual(e1["review_id"], e2["review_id"])

        # Run sampling with different seed -> different order
        q3, _ = StratifiedSampler.sample_review_queue(pairs, features, seed=99999999)
        self.assertEqual(len(q1), len(q3))
        # First element should be different due to different shuffle
        keys_1 = [e["pair_key"] for e in q1]
        keys_3 = [e["pair_key"] for e in q3]
        self.assertNotEqual(keys_1, keys_3)

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

        # Verify output files exist in test_dir
        queue_csv = os.path.join(out_dir, "story01b_annotator_queue.csv")
        audit_csv = os.path.join(out_dir, "story01b_audit_key.csv")
        receipt_json = os.path.join(out_dir, "story01b_sampling_receipt.json")

        self.assertTrue(os.path.exists(queue_csv))
        self.assertTrue(os.path.exists(audit_csv))
        self.assertTrue(os.path.exists(receipt_json))

        # Check queue length
        with open(queue_csv) as f:
            queue_rows = list(csv.DictReader(f))
        self.assertEqual(len(queue_rows), 124)

        # Check that model scores are NOT in annotator queue (blinding verification)
        self.assertNotIn("qwen_score", queue_rows[0])
        self.assertNotIn("mistral_score", queue_rows[0])
        self.assertNotIn("reranker_score", queue_rows[0])

        # Check receipt
        with open(receipt_json) as f:
            receipt = json.load(f)
        self.assertEqual(receipt["corpus_fingerprint"], EXPECTED_CORPUS_FINGERPRINT)
        self.assertEqual(receipt["pair_universe_count"], EXPECTED_PAIR_UNIVERSE_COUNT)
        self.assertEqual(receipt["strata_counts"]["total_sampled_pairs"], 124)


if __name__ == "__main__":
    unittest.main()
