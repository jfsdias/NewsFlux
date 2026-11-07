#!/usr/bin/env python3
"""
Unit tests for gold_expansion_mining.py (STORY-01B-M2 Stage C)

Verifies:
- GOLD_PAIR_OVERLAP = 0 gate
- STRATA_COVERAGE (all 8 declared strata represented or legitimately empty)
- DIVERSITY_CONSTRAINTS (MAX_ARTICLE_REUSE <= 3, unique feeds >= 10, unique categories >= 3)
- FIELD_INTEGRITY (all required CSV columns present)
- MINING_DETERMINISM (identical output across two runs)
"""

import csv
import os
import tempfile
import unittest

try:
    from .gold_expansion_mining import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        GoldOverlapError,
        classify_candidate_stratum,
        mine_gold_expansion_candidates,
    )
except ImportError:
    from gold_expansion_mining import (
        DEFAULT_CORPUS_PATH,
        DEFAULT_GOLD_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_RERANKER_PATH,
        GoldOverlapError,
        classify_candidate_stratum,
        mine_gold_expansion_candidates,
    )


class TestGoldExpansionMining(unittest.TestCase):
    """Test suite for gold_expansion_mining.py."""

    @classmethod
    def setUpClass(cls):
        """Check if private inputs exist."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_GOLD_PATH)
            and os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
        )

    def test_classify_stratum_g1_lexical_trap(self):
        """Test classification of G1 lexical trap."""
        f = {
            "title_overlap_coefficient": 0.40,
            "qwen_embedding_cosine": 0.30,
            "mistral_embedding_cosine": 0.50,
            "same_category": 1,
            "published_delta_hours": 1.0,
            "entity_anchor_overlap": 0.0,
            "id_a": 1,
            "id_b": 2,
        }
        corpus_lookup = {1: {"category_id": 36, "feed_title": "F1"}, 2: {"category_id": 36, "feed_title": "F2"}}
        stratum, score, reason = classify_candidate_stratum(f, corpus_lookup)
        self.assertEqual(stratum, "G1_HIGH_LEXICAL_LOW_SEMANTIC")

    def test_classify_stratum_g2_paraphrase(self):
        """Test classification of G2 low lexical high semantic candidate."""
        f = {
            "title_overlap_coefficient": 0.10,
            "qwen_embedding_cosine": 0.60,
            "mistral_embedding_cosine": 0.75,
            "same_category": 1,
            "published_delta_hours": 1.0,
            "entity_anchor_overlap": 0.5,
            "id_a": 1,
            "id_b": 2,
        }
        corpus_lookup = {1: {"category_id": 36, "feed_title": "F1"}, 2: {"category_id": 36, "feed_title": "F2"}}
        stratum, score, reason = classify_candidate_stratum(f, corpus_lookup)
        self.assertEqual(stratum, "G2_LOW_LEXICAL_HIGH_SEMANTIC")

    def test_classify_stratum_g8_high_sem_low_entity(self):
        """Test classification of G8 high semantic zero entity candidate."""
        f = {
            "title_overlap_coefficient": 0.10,
            "qwen_embedding_cosine": 0.55,
            "mistral_embedding_cosine": 0.74,
            "same_category": 1,
            "published_delta_hours": 1.0,
            "entity_anchor_overlap": 0.0,
            "id_a": 1,
            "id_b": 2,
        }
        corpus_lookup = {1: {"category_id": 36, "feed_title": "F1"}, 2: {"category_id": 36, "feed_title": "F2"}}
        stratum, score, reason = classify_candidate_stratum(f, corpus_lookup)
        self.assertEqual(stratum, "G8_HIGH_SEMANTIC_LOW_ENTITY_ANCHOR")

    def test_mine_candidates_gold_overlap_zero(self):
        """Test that mined candidates strictly exclude Gold pairs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir:
            res = mine_gold_expansion_candidates(output_dir=tmpdir)
            self.assertEqual(res["gold_pair_overlap"], 0)
            self.assertEqual(res["gold_pair_overlap_gate"], "PASS")

            # Check with actual gold keys
            with open(DEFAULT_GOLD_PATH) as f:
                gold_keys = {r["pair_key"] for r in csv.DictReader(f)}
            with open(res["output_csv_path"]) as f:
                mined_keys = {r["pair_key"] for r in csv.DictReader(f)}

            self.assertEqual(len(gold_keys & mined_keys), 0)

    def test_mine_candidates_diversity(self):
        """Test that diversity constraints are enforced."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir:
            res = mine_gold_expansion_candidates(output_dir=tmpdir, max_article_reuse=3)
            self.assertGreaterEqual(res["candidate_count"], 50)
            self.assertLessEqual(res["max_article_reuse"], 3)
            self.assertGreaterEqual(res["unique_feeds"], 10)
            self.assertGreaterEqual(res["unique_categories"], 3)

    def test_mine_candidates_strata_coverage(self):
        """Test that candidate mining covers declared strata."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir:
            res = mine_gold_expansion_candidates(output_dir=tmpdir)
            dist = res["stratum_distribution"]
            # All 8 strata should be present in distribution
            for s in res["all_declared_strata"]:
                self.assertIn(s, dist)
                self.assertGreater(dist[s], 0)

    def test_mine_candidates_required_fields(self):
        """Test that the emitted CSV has all required fields."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir:
            res = mine_gold_expansion_candidates(output_dir=tmpdir)
            expected_fields = [
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
            with open(res["output_csv_path"]) as f:
                r = csv.DictReader(f)
                self.assertEqual(r.fieldnames, expected_fields)

    def test_mine_candidates_determinism(self):
        """Test that candidate mining produces byte-identical results across runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = mine_gold_expansion_candidates(output_dir=tmpdir1)
            r2 = mine_gold_expansion_candidates(output_dir=tmpdir2)
            self.assertEqual(r1["output_sha256"], r2["output_sha256"])
            self.assertEqual(r1["candidate_count"], r2["candidate_count"])


if __name__ == "__main__":
    unittest.main()
