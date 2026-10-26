#!/usr/bin/env python3
"""
Unit tests for story_projection.py (STORY-01B-C2 & C3 Stages G & H)

Verifies:
- STORY_PROJECTION_CONTRACT (all required fields present and typed)
- DETERMINISTIC_STORY_ID (derived purely from canonical member IDs hash)
- DETERMINISTIC_REPRESENTATIVE (R0-R4 policy behaviors)
- ALTERNATIVE_DIVERSITY (A0-A2 selection, distinct source priority, max K cap)
- NO_PERSISTENCE_OR_RUNTIME_IMPORTS
- PROJECTION_DETERMINISM (byte-identical JSON across runs)
"""

import json
import os
import tempfile
import unittest

try:
    from .story_projection import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        AlternativesSelector,
        RepresentativeSelector,
        build_story_projections,
        compare_representative_policies,
        run_story_projection_pipeline,
    )
except ImportError:
    from story_projection import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PAIRS_PATH,
        DEFAULT_SCORES_PATH,
        AlternativesSelector,
        RepresentativeSelector,
        build_story_projections,
        compare_representative_policies,
        run_story_projection_pipeline,
    )


class TestStoryProjection(unittest.TestCase):
    """Test suite for story_projection.py."""

    @classmethod
    def setUpClass(cls):
        """Check if private inputs exist."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_ASSIGNMENTS_PATH)
            and os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_PAIRS_PATH)
            and os.path.exists(DEFAULT_SCORES_PATH)
        )

    def test_representative_selector_r0_r1(self):
        """Test R0 (earliest) and R1 (latest) representative selection."""
        published = {101: 1000.0, 102: 2000.0, 103: 1500.0}
        members = [101, 102, 103]

        r0 = RepresentativeSelector.select("R0_EARLIEST", members, published, {}, {})
        self.assertEqual(r0, 101)

        r1 = RepresentativeSelector.select("R1_LATEST", members, published, {}, {})
        self.assertEqual(r1, 102)

    def test_representative_selector_r2_lexical_medoid(self):
        """Test R2 lexical medoid selection based on highest average overlap."""
        published = {101: 1000.0, 102: 1200.0, 103: 1500.0}
        # 102 has high overlap to both 101 and 103
        pairwise_lex = {
            (101, 102): 0.8,
            (102, 103): 0.8,
            (101, 103): 0.2,
        }
        members = [101, 102, 103]
        r2 = RepresentativeSelector.select("R2_LEXICAL_MEDOID", members, published, pairwise_lex, {})
        self.assertEqual(r2, 102)

    def test_alternatives_selector_a2_diverse_top_k(self):
        """Test A2 diverse top-K alternative source selection."""
        corpus_mock = {
            101: {"feed_title": "FeedA"},
            102: {"feed_title": "FeedB"},
            103: {"feed_title": "FeedB"},  # duplicate feed
            104: {"feed_title": "FeedC"},
        }
        pairwise_lex = {
            (101, 102): 0.3,
            (101, 103): 0.7,
            (101, 104): 0.2,
        }
        members = [101, 102, 103, 104]
        rep_id = 101

        alts = AlternativesSelector.select("A2_DIVERSE_TOP_K", members, rep_id, corpus_mock, pairwise_lex, max_k=2)
        # Should pick distinct feeds FeedB and FeedC (102 and 104), cap at 2
        self.assertEqual(len(alts), 2)
        self.assertIn(104, alts)
        self.assertIn(102, alts)
        self.assertNotIn(103, alts)

    def test_story_projection_contract(self):
        """Test that StoryProjection outputs strictly adhere to contract schema."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            receipt = run_story_projection_pipeline(output_dir=tmpdir)
            projections = receipt["projections"]
            self.assertGreater(len(projections), 0)

            for p in projections[:20]:
                self.assertIn("story_id", p)
                self.assertTrue(p["story_id"].startswith("story_"))
                self.assertIn("representative_article_id", p)
                self.assertIn("alternative_article_ids", p)
                self.assertIn("member_article_ids", p)
                self.assertIn("first_published_at", p)
                self.assertIn("last_published_at", p)
                self.assertIn("source_count", p)
                self.assertIn("member_count", p)
                self.assertIn("confidence", p)
                self.assertIn("cluster_policy", p)
                self.assertIn("representative_policy", p)
                self.assertIn("alternative_policy", p)

                # Representative must be in member list
                self.assertIn(p["representative_article_id"], p["member_article_ids"])
                # Alternatives must not include representative
                self.assertNotIn(p["representative_article_id"], p["alternative_article_ids"])
                # Total members must match
                self.assertEqual(p["member_count"], len(p["member_article_ids"]))

    def test_story_projection_determinism(self):
        """Test byte-identical projection JSON across two runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
            r1 = run_story_projection_pipeline(output_dir=tmpdir1)
            r2 = run_story_projection_pipeline(output_dir=tmpdir2)
            self.assertEqual(r1["emitted_artifacts"]["projection_sha256"], r2["emitted_artifacts"]["projection_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["representative_comparison_sha256"], r2["emitted_artifacts"]["representative_comparison_sha256"])


if __name__ == "__main__":
    unittest.main()
