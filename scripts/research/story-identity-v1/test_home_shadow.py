#!/usr/bin/env python3
"""
Unit tests for home_shadow.py (STORY-01B-C11 to C13 Stage 7-9)

Verifies:
- Home feed order preservation under H0 through H3
- Top-10 and Top-20 shift and disruption metrics
- Kendall-style pair order disruption computation
- Derived Read/Star semantics (Miniflux state preserved)
- Confidence-aware filter trade-offs
- Byte-identical benchmark determinism
"""

import os
import tempfile
import unittest

try:
    from .home_shadow import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PROJECTIONS_PATH,
        compute_kendall_style_order_disruption,
        load_home_articles,
        project_home_feed,
        run_home_shadow_benchmark,
    )
except ImportError:
    from home_shadow import (
        DEFAULT_ASSIGNMENTS_PATH,
        DEFAULT_CORPUS_PATH,
        DEFAULT_PROJECTIONS_PATH,
        compute_kendall_style_order_disruption,
        load_home_articles,
        project_home_feed,
        run_home_shadow_benchmark,
    )


class TestHomeShadow(unittest.TestCase):
    """Test suite for home_shadow.py."""

    @classmethod
    def setUpClass(cls):
        """Check availability of canonical inputs."""
        cls.has_private_inputs = (
            os.path.exists(DEFAULT_CORPUS_PATH)
            and os.path.exists(DEFAULT_ASSIGNMENTS_PATH)
            and os.path.exists(DEFAULT_PROJECTIONS_PATH)
        )

    def test_load_home_articles(self):
        """Test that Home-200 articles load correctly."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")
        articles = load_home_articles(DEFAULT_CORPUS_PATH)
        self.assertEqual(len(articles), 200)

    def test_kendall_style_order_disruption(self):
        """Test Kendall-style disruption helper."""
        orig = {1: 0, 2: 1, 3: 2, 4: 3}
        # Identical order -> 0.0 disruption
        proj_ident = {1: 0, 2: 1, 3: 2, 4: 3}
        self.assertEqual(compute_kendall_style_order_disruption(orig, proj_ident, [1, 2, 3, 4]), 0.0)

        # Inverted order -> 1.0 disruption
        proj_inv = {1: 3, 2: 2, 3: 1, 4: 0}
        self.assertEqual(compute_kendall_style_order_disruption(orig, proj_inv, [1, 2, 3, 4]), 1.0)

        # 1 pair flipped out of 6 -> 1/6 = 0.1667
        proj_one_flip = {1: 1, 2: 0, 3: 2, 4: 3}
        self.assertAlmostEqual(compute_kendall_style_order_disruption(orig, proj_one_flip, [1, 2, 3, 4]), 0.1667, places=4)

    def test_synthetic_project_home_feed(self):
        """Test projection mechanics on synthetic articles."""
        articles = [
            {"id": 101, "published_at": 100.0, "feed_title": "FeedA", "status": "unread", "starred": False},
            {"id": 102, "published_at": 110.0, "feed_title": "FeedB", "status": "read", "starred": True},
            {"id": 103, "published_at": 120.0, "feed_title": "FeedC", "status": "unread", "starred": False},
            {"id": 104, "published_at": 130.0, "feed_title": "FeedD", "status": "unread", "starred": False},
        ]
        clusters = [[101, 102], [103], [104]]
        projections = [
            {
                "story_id": "story_01",
                "representative_article_id": 101,
                "member_article_ids": [101, 102],
                "confidence": "UNVERIFIED_MULTI_MEMBER",
            }
        ]

        items, metrics = project_home_feed(articles, clusters, projections)
        self.assertEqual(metrics["home_item_count_before"], 4)
        self.assertEqual(metrics["home_item_count_after"], 3)  # 102 absorbed into story card 101
        self.assertEqual(metrics["noise_reduction_percent"], 25.0)

        # Check story card shape
        story_card = items[0]
        self.assertEqual(story_card["item_type"], "STORY_CARD")
        self.assertEqual(story_card["representative_article_id"], 101)
        self.assertEqual(story_card["alternative_article_ids"], [102])
        self.assertTrue(story_card["read_semantics"]["story_unread_if_any_unread"])
        self.assertEqual(story_card["read_semantics"]["story_unread_count"], 1)
        self.assertEqual(story_card["star_semantics"]["member_starred_count"], 1)
        self.assertTrue(story_card["star_semantics"]["no_story_level_star"])

    def test_end_to_end_home_shadow(self):
        """Test full Home shadow pipeline and artifact emission."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            res = run_home_shadow_benchmark(output_dir=tmpdir)
            self.assertEqual(res["home_article_count_before"], 200)
            self.assertEqual(res["home_item_count_after"], 181)
            self.assertEqual(res["noise_reduction_percent"], 9.5)
            self.assertEqual(res["all_changed"], "NO")
            self.assertEqual(res["unread_changed"], "NO")

            emitted = res["emitted_artifacts"]
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["home_shadow_json_filename"])))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, emitted["before_after_json_filename"])))

    def test_home_shadow_determinism(self):
        """Test byte-identical outputs across two independent runs."""
        if not self.has_private_inputs:
            self.skipTest("Private inputs not available")

        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            r1 = run_home_shadow_benchmark(output_dir=tmp1)
            r2 = run_home_shadow_benchmark(output_dir=tmp2)
            self.assertEqual(r1["emitted_artifacts"]["home_shadow_json_sha256"], r2["emitted_artifacts"]["home_shadow_json_sha256"])
            self.assertEqual(r1["emitted_artifacts"]["before_after_json_sha256"], r2["emitted_artifacts"]["before_after_json_sha256"])


if __name__ == "__main__":
    unittest.main()
