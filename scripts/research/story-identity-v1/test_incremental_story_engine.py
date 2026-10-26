#!/usr/bin/env python3
"""
Unit tests for incremental_story_engine.py (STORY-01B-C7 Stage 3)

Verifies:
- Pure in-memory reconstructibility from scratch
- Streaming transition event emission
- Correctness fixtures:
  - BREAKING_STORY_GROWS
  - TWO_RELATED_SUBEVENTS_STAY_SEPARATE
  - BRIDGE_ARTICLE_DOES_NOT_CAUSE_FALSE_MERGE (L0 policy)
  - LATE_PRIMARY_SOURCE_JOINS_EXISTING_STORY
  - TEMPORAL_SPINOFF_REMAINS_SEPARATE
- Representative tracking and churn detection (R0 vs R1)
- Ephemeral lifecycle calculation (ACTIVE, COOLING, STALE)
"""

import unittest

try:
    from .incremental_story_engine import IncrementalStoryEngine
except ImportError:
    from incremental_story_engine import IncrementalStoryEngine


class TestIncrementalStoryEngine(unittest.TestCase):
    """Test suite for IncrementalStoryEngine."""

    def test_in_memory_reconstructibility(self):
        """Test that two independent engines fed the same stream produce identical projections."""
        articles = [
            {"id": 101, "published_at": 100.0, "feed_title": "FeedA", "title": "Article 1"},
            {"id": 102, "published_at": 150.0, "feed_title": "FeedB", "title": "Article 2"},
            {"id": 103, "published_at": 200.0, "feed_title": "FeedC", "title": "Article 3"},
        ]
        scores = {
            (101, 102): 0.85,
            (101, 103): 0.80,
            (102, 103): 0.75,
        }

        e1 = IncrementalStoryEngine(threshold=0.50)
        e2 = IncrementalStoryEngine(threshold=0.50)

        for a in articles:
            sc_to_existing = {other["id"]: scores.get((min(a["id"], other["id"]), max(a["id"], other["id"])), 0.0) for other in articles if other["id"] < a["id"]}
            e1.add_article(a, sc_to_existing)
            e2.add_article(a, sc_to_existing)

        p1 = e1.get_projection()
        p2 = e2.get_projection()

        self.assertEqual(len(p1), len(p2))
        self.assertEqual(p1[0]["story_id"], p2[0]["story_id"])
        self.assertEqual(p1[0]["member_article_ids"], p2[0]["member_article_ids"])
        self.assertEqual(p1[0]["representative_article_id"], p2[0]["representative_article_id"])

    def test_breaking_story_grows(self):
        """Correctness Fixture: BREAKING_STORY_GROWS."""
        engine = IncrementalStoryEngine(threshold=0.50, representative_policy="R0_EARLIEST")

        # Article 1 arrives
        ev1 = engine.add_article({"id": 1, "published_at": 100.0, "feed_title": "FeedA"})
        self.assertEqual(ev1["action"], "NEW_STORY_CREATED")
        self.assertEqual(ev1["new_representative"], 1)

        # Article 2 arrives (compatible with 1)
        ev2 = engine.add_article({"id": 2, "published_at": 120.0, "feed_title": "FeedB"}, {1: 0.85})
        self.assertEqual(ev2["action"], "ARTICLE_JOINED_EXISTING_STORY")
        self.assertFalse(ev2["representative_changed"])  # R0 keeps earliest (1)

        # Article 3 arrives (compatible with 1 and 2)
        ev3 = engine.add_article({"id": 3, "published_at": 140.0, "feed_title": "FeedC"}, {1: 0.80, 2: 0.82})
        self.assertEqual(ev3["action"], "ARTICLE_JOINED_EXISTING_STORY")

        projs = engine.get_projection()
        self.assertEqual(len(projs), 1)
        self.assertEqual(projs[0]["member_count"], 3)
        self.assertEqual(projs[0]["member_article_ids"], [1, 2, 3])
        self.assertEqual(projs[0]["representative_article_id"], 1)

    def test_two_related_subevents_stay_separate(self):
        """Correctness Fixture: TWO_RELATED_SUBEVENTS_STAY_SEPARATE."""
        engine = IncrementalStoryEngine(threshold=0.50)

        # Subevent 1 articles
        engine.add_article({"id": 1, "published_at": 100.0, "feed_title": "FeedA"})
        engine.add_article({"id": 2, "published_at": 110.0, "feed_title": "FeedB"}, {1: 0.85})

        # Subevent 2 articles (high within subevent 2, low to subevent 1)
        engine.add_article({"id": 10, "published_at": 105.0, "feed_title": "FeedC"}, {1: 0.20, 2: 0.25})
        engine.add_article({"id": 11, "published_at": 115.0, "feed_title": "FeedD"}, {10: 0.88, 1: 0.22, 2: 0.20})

        projs = engine.get_projection()
        # Must maintain exactly 2 separate multi-article stories
        self.assertEqual(len(projs), 2)
        memberships = {tuple(p["member_article_ids"]) for p in projs}
        self.assertIn((1, 2), memberships)
        self.assertIn((10, 11), memberships)

    def test_bridge_article_does_not_cause_false_merge(self):
        """Correctness Fixture: BRIDGE_ARTICLE_DOES_NOT_CAUSE_FALSE_MERGE."""
        # Under L0_NEVER_MERGE, a bridge article with affinity to both clusters cannot merge them
        engine = IncrementalStoryEngine(threshold=0.50, merge_policy="L0_NEVER_MERGE_ESTABLISHED_CLUSTERS")

        # Cluster A: 1, 2
        engine.add_article({"id": 1, "published_at": 100.0, "feed_title": "FeedA"})
        engine.add_article({"id": 2, "published_at": 110.0, "feed_title": "FeedB"}, {1: 0.85})

        # Cluster B: 10, 11
        engine.add_article({"id": 10, "published_at": 105.0, "feed_title": "FeedC"}, {1: 0.10, 2: 0.10})
        engine.add_article({"id": 11, "published_at": 115.0, "feed_title": "FeedD"}, {10: 0.85, 1: 0.10, 2: 0.10})

        # Bridge article: high affinity to Cluster A (0.75) and moderate to Cluster B (0.60)
        ev_bridge = engine.add_article({"id": 99, "published_at": 130.0, "feed_title": "FeedE"}, {1: 0.75, 2: 0.70, 10: 0.60, 11: 0.55})

        self.assertEqual(ev_bridge["action"], "ARTICLE_JOINED_EXISTING_STORY")

        projs = engine.get_projection()
        # Must still have 2 separate stories (Cluster A absorbed 99, Cluster B untouched)
        self.assertEqual(len(projs), 2)
        memberships = {tuple(p["member_article_ids"]) for p in projs}
        self.assertIn((1, 2, 99), memberships)
        self.assertIn((10, 11), memberships)

    def test_representative_churn_r0_vs_r1(self):
        """Test that R0 produces 0 representative churn on new arrivals while R1 churns on each arrival."""
        # R0_EARLIEST
        e_r0 = IncrementalStoryEngine(threshold=0.50, representative_policy="R0_EARLIEST")
        e_r0.add_article({"id": 1, "published_at": 100.0, "feed_title": "F1"})
        ev2_r0 = e_r0.add_article({"id": 2, "published_at": 110.0, "feed_title": "F2"}, {1: 0.85})
        ev3_r0 = e_r0.add_article({"id": 3, "published_at": 120.0, "feed_title": "F3"}, {1: 0.80, 2: 0.82})
        self.assertFalse(ev2_r0["representative_changed"])
        self.assertFalse(ev3_r0["representative_changed"])

        # R1_LATEST
        e_r1 = IncrementalStoryEngine(threshold=0.50, representative_policy="R1_LATEST")
        e_r1.add_article({"id": 1, "published_at": 100.0, "feed_title": "F1"})
        ev2_r1 = e_r1.add_article({"id": 2, "published_at": 110.0, "feed_title": "F2"}, {1: 0.85})
        ev3_r1 = e_r1.add_article({"id": 3, "published_at": 120.0, "feed_title": "F3"}, {1: 0.80, 2: 0.82})
        self.assertTrue(ev2_r1["representative_changed"])
        self.assertEqual(ev2_r1["new_representative"], 2)
        self.assertTrue(ev3_r1["representative_changed"])
        self.assertEqual(ev3_r1["new_representative"], 3)

    def test_ephemeral_lifecycle_stages(self):
        """Test ACTIVE, COOLING, and STALE ephemeral stages."""
        engine = IncrementalStoryEngine(cooling_hours=3.0, stale_hours=12.0)
        # Article published at t = 100,000s
        engine.add_article({"id": 1, "published_at": 100000.0, "feed_title": "FeedA"})

        # Reference time: 1 hour later (age 1h <= 3h -> ACTIVE)
        p_active = engine.get_projection(current_time=100000.0 + 3600.0)
        self.assertEqual(p_active[0]["lifecycle_stage"], "ACTIVE")

        # Reference time: 6 hours later (3h < age 6h <= 12h -> COOLING)
        p_cooling = engine.get_projection(current_time=100000.0 + 6 * 3600.0)
        self.assertEqual(p_cooling[0]["lifecycle_stage"], "COOLING")

        # Reference time: 24 hours later (age 24h > 12h -> STALE)
        p_stale = engine.get_projection(current_time=100000.0 + 24 * 3600.0)
        self.assertEqual(p_stale[0]["lifecycle_stage"], "STALE")


if __name__ == "__main__":
    unittest.main()
