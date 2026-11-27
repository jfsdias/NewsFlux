#!/usr/bin/env python3
"""Tests for runtime_feasibility.py (STORY-02-A0 R1)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from runtime_feasibility import (
    analyze_home_top_window,
    audit_canonical_runtime_facts,
    build_architecture_scorecard,
    compare_coherent_stacks,
    compute_presentation_metadata,
    compute_story_identity_cache_key,
    evaluate_placement_policies,
    reconcile_cache_architecture,
    reconcile_retrieval_feasibility,
)


class TestRuntimeFeasibility(unittest.TestCase):
    """Verifies Home window analysis, data-backed scorecard, placement policies, cache keys, and runtime facts."""

    def test_data_backed_scorecard(self):
        """Verifies changing an input ablation metric changes stack comparison and architecture scorecard."""
        dummy_ablation = {
            "models": {
                "PF0_LEXICAL_ONLY": {"pr_auc": 0.5555, "f05": 0.4444, "precision": 0.5000},
                "PF1_LEXICAL_PLUS_QWEN": {"pr_auc": 0.9888, "f05": 0.9555, "precision": 0.9666},
                "PF2_LEXICAL_PLUS_SIDECAR": {"imputed_zero_evaluation": {"pr_auc": 0.7777, "f05": 0.6666, "precision": 0.7000}},
                "PF3_LEXICAL_QWEN_MISTRAL_REFERENCE": {"pr_auc": 0.8888, "f05": 0.8222, "precision": 0.8500},
            }
        }
        stacks = compare_coherent_stacks(ablation_report=dummy_ablation)
        self.assertEqual(stacks["stacks"]["STACK_A_PURE_CLIENT_LEXICAL"]["gold_pr_auc"], 0.5555)
        self.assertEqual(stacks["stacks"]["STACK_B_QWEN_EMBEDDING_CLIENT_STORY"]["gold_pr_auc"], 0.9888)

        card = build_architecture_scorecard(stacks)
        self.assertIn("0.5555", card["scorecard"]["ARCH_A_PURE_CLIENT_LEXICAL"]["quality"])
        self.assertIn("0.9888", card["scorecard"]["ARCH_B_QWEN_RETRIEVAL_CLIENT_ENGINE"]["quality"])

    def test_h1_vs_h2_difference_synthetic_fixture(self):
        """Creates synthetic fixture where highest-ranked member != newest member; proves H1 != H2."""
        # Story with two articles:
        # Article 10: older published_at (100.0), but pinned at home_order index 0
        # Article 20: newer published_at (200.0), but at home_order index 5
        home_order = [10, 11, 12, 13, 14, 20]
        articles = {
            10: {"id": 10, "published_at": 100.0},
            20: {"id": 20, "published_at": 200.0},
        }
        multi_stories = [
            {
                "story_id": "test_story_1",
                "representative_article_id": 10,
                "member_article_ids": [10, 20],
                "member_count": 2,
            }
        ]

        _, positions = evaluate_placement_policies(multi_stories, home_order, articles)

        pos_h1 = positions["H1_HIGHEST_RANKED_MEMBER_POSITION"][0]
        pos_h2 = positions["H2_NEWEST_MEMBER_POSITION"][0]

        # H1 takes min home_order index: index 0 (Article 10)
        self.assertEqual(pos_h1, 0)
        # H2 takes max published_at: Article 20, which is at index 5
        self.assertEqual(pos_h2, 5)
        self.assertNotEqual(pos_h1, pos_h2)

    def test_home_200_placement_policies(self):
        """Verifies policy behavior on Home-200 and documents H1/H2 match on this specific corpus."""
        res = analyze_home_top_window()
        pols = res["policy_comparison"]

        # H0 (representative position with R4 medoid) must have 0 cards in Top 20
        h0_stats = pols["H0_REPRESENTATIVE_POSITION"]["window_stats"]
        self.assertEqual(h0_stats["top_10"]["story_card_count"], 0)
        self.assertEqual(h0_stats["top_20"]["story_card_count"], 0)

        # H1 (highest ranked member position) surfaces cards in Top 10 and Top 20
        h1_stats = pols["H1_HIGHEST_RANKED_MEMBER_POSITION"]["window_stats"]
        self.assertEqual(h1_stats["top_10"]["story_card_count"], 1)
        self.assertEqual(h1_stats["top_20"]["story_card_count"], 2)
        self.assertEqual(h1_stats["top_30"]["story_card_count"], 4)
        self.assertEqual(h1_stats["top_50"]["story_card_count"], 6)

        # H1 and H2 match on this reverse-chronological corpus
        self.assertTrue(res["h1_h2_match_on_home200"])
        self.assertEqual(res["h1_h2_match_classification"], "MATCH_ON_THIS_CORPUS")

    def test_cache_key_title_fingerprint_sensitivity(self):
        """Verifies modifying article title changes the identity cache key (TITLE_CHANGED)."""
        articles_v1 = [
            {"id": 1, "title": "Apple announces iPhone 17 with Duo Camera", "published_at": 1000},
            {"id": 2, "title": "Google updates Pixel 9 series", "published_at": 2000},
        ]
        articles_v2 = [
            {"id": 1, "title": "Apple reveals iPhone 17 with new Duo System", "published_at": 1000},
            {"id": 2, "title": "Google updates Pixel 9 series", "published_at": 2000},
        ]

        key1 = compute_story_identity_cache_key(articles_v1, session_revision=1)
        key2 = compute_story_identity_cache_key(articles_v2, session_revision=1)

        # Same IDs and published timestamps, but different title MUST yield different cache key
        self.assertNotEqual(key1, key2)

    def test_read_star_presentation_separation(self):
        """Verifies read and star mutations update presentation counters without invalidating identity key."""
        articles_unread = [
            {"id": 1, "title": "Test Title", "published_at": 1000, "status": "unread", "starred": False},
        ]
        articles_read_starred = [
            {"id": 1, "title": "Test Title", "published_at": 1000, "status": "read", "starred": True},
        ]

        key_unread = compute_story_identity_cache_key(articles_unread, session_revision=1)
        key_read_starred = compute_story_identity_cache_key(articles_read_starred, session_revision=1)

        # Identity key MUST remain completely identical
        self.assertEqual(key_unread, key_read_starred)

        # But presentation counters must reflect the change
        stories = [{"story_id": "s1", "member_article_ids": [1]}]
        pres_unread = compute_presentation_metadata(stories, {1: articles_unread[0]})
        pres_read_starred = compute_presentation_metadata(stories, {1: articles_read_starred[0]})

        self.assertEqual(pres_unread[0]["unread_member_count"], 1)
        self.assertEqual(pres_unread[0]["starred_member_count"], 0)
        self.assertEqual(pres_read_starred[0]["unread_member_count"], 0)
        self.assertEqual(pres_read_starred[0]["starred_member_count"], 1)

    def test_retrieval_feasibility_data_backed(self):
        """Verifies candidate retrieval loader extracts real metrics from C5 benchmark artifact."""
        ret = reconcile_retrieval_feasibility()
        self.assertEqual(ret["full_pair_universe"], 18953)
        self.assertIn("RF0_CLIENT_LEXICAL", ret["classes"])
        self.assertIn("RF1_EXISTING_QWEN_SIDECAR", ret["classes"])
        self.assertIn("RF2_HYBRID_LEXICAL_PLUS_QWEN", ret["classes"])
        self.assertIn("RF3_CURRENT_EXISTING_RANKER", ret["classes"])

        rf0 = ret["classes"]["RF0_CLIENT_LEXICAL"]
        self.assertEqual(rf0["same_event_pair_recall"], 1.0)
        self.assertGreaterEqual(rf0["pair_reduction_percent"], 80.0)

    def test_canonical_runtime_facts(self):
        """Verifies live main facts: routes, default port 8787, feature flag, compose service."""
        facts = audit_canonical_runtime_facts()
        self.assertEqual(facts["caddy_route"], "/api/story-candidates/*")
        self.assertEqual(facts["default_upstream"], "story-ranker:8787")
        self.assertEqual(facts["server_default_port"], 8787)
        self.assertIn("VITE_STORY_CANDIDATE_RANKING", facts["frontend_feature_flag"])
        self.assertIn("reactflux", facts["repo_docker_compose"])
        self.assertEqual(facts["deployment_status"]["sidecar_code_present"], "YES (services/story_ranker/)")
        self.assertEqual(facts["deployment_status"]["sidecar_production_deployed"], "NOT_VERIFIED_IN_A0 (repo compose does not run sidecar)")


if __name__ == "__main__":
    unittest.main()
