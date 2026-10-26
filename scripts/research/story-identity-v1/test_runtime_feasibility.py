#!/usr/bin/env python3
"""Tests for runtime_feasibility.py (STORY-02-A0)."""

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
    analyze_retrieval_feasibility,
    build_architecture_scorecard,
    compare_coherent_stacks,
    reconcile_cache_architecture,
    run_runtime_feasibility_analysis,
)


class TestRuntimeFeasibility(unittest.TestCase):
    """Verifies Home window analysis, retrieval classification, scorecard, and cache logic."""

    def test_home_top_window_analysis(self):
        """Verifies policy behavior on Home-200 and answers why Top-20 had 0 cards in C11."""
        res = analyze_home_top_window()
        self.assertIn("policy_comparison", res)
        pols = res["policy_comparison"]

        # H0 (representative position with R4 medoid) must have 0 cards in Top 20
        h0_stats = pols["H0_REPRESENTATIVE_POSITION"]["window_stats"]
        self.assertEqual(h0_stats["top_10"]["story_card_count"], 0)
        self.assertEqual(h0_stats["top_20"]["story_card_count"], 0)

        # H1 (highest ranked member position) must surface cards in Top 10 and Top 20
        h1_stats = pols["H1_HIGHEST_RANKED_MEMBER_POSITION"]["window_stats"]
        self.assertEqual(h1_stats["top_10"]["story_card_count"], 1)
        self.assertEqual(h1_stats["top_20"]["story_card_count"], 2)
        self.assertEqual(h1_stats["top_50"]["story_card_count"], 6)

        # Primary value location must be classified
        self.assertEqual(res["primary_home_value_location"], "MODERATE_TOP_AND_STRONG_LONG_SCROLL")

    def test_retrieval_feasibility_classes(self):
        """Verifies candidate retrieval methods RF0, RF1, RF2, RF3."""
        ret = analyze_retrieval_feasibility()
        self.assertEqual(ret["full_pair_universe"], 18953)
        self.assertIn("RF0_CLIENT_LEXICAL", ret["classes"])
        self.assertIn("RF1_EXISTING_QWEN_SIDECAR", ret["classes"])
        self.assertIn("RF2_HYBRID_LEXICAL_PLUS_QWEN", ret["classes"])
        self.assertIn("RF3_CURRENT_EXISTING_RANKER", ret["classes"])

        # RF0 must be production feasible today with zero dependencies
        rf0 = ret["classes"]["RF0_CLIENT_LEXICAL"]
        self.assertTrue(rf0["production_feasible_today"])
        self.assertIn("ZERO", rf0["runtime_dependencies"])
        self.assertGreaterEqual(rf0["pair_reduction_percent"], 90.0)

    def test_stack_comparison_pareto(self):
        """Verifies stack comparison across quality, operational complexity, and Pareto frontier."""
        res = compare_coherent_stacks()
        self.assertIn("STACK_A_PURE_CLIENT_LEXICAL", res["stacks"])
        self.assertIn("STACK_B_QWEN_EMBEDDING_CLIENT_STORY", res["stacks"])
        self.assertIn("STACK_C_EXISTING_RANKER_CLIENT_CLUSTERING", res["stacks"])

        # Stack A has 0 models, 0 containers
        st_a = res["stacks"]["STACK_A_PURE_CLIENT_LEXICAL"]
        self.assertEqual(st_a["models_required"], 0)
        self.assertEqual(st_a["containers_required"], 0)
        self.assertEqual(st_a["network_hops"], 0)

        # Pareto frontier must contain Stack A and Stack B
        self.assertTrue(any("STACK_A" in p for p in res["pareto_stacks"]))
        self.assertTrue(any("STACK_B" in p for p in res["pareto_stacks"]))

    def test_cache_reconciliation(self):
        """Verifies cache key rules: read/star mutations must NOT invalidate story projections."""
        cache_data = reconcile_cache_architecture()
        key_design = cache_data["cache_key_design"]

        # Invariant: read and star mutations do NOT trigger invalidation
        non_inval = key_design["non_invalidation_triggers"]
        self.assertTrue(any("READ" in t for t in non_inval))
        self.assertTrue(any("STAR" in t for t in non_inval))

        # Only structural changes trigger invalidation
        inval = key_design["invalidation_triggers"]
        self.assertTrue(any("NEW_ARTICLE" in t for t in inval))

    def test_architecture_scorecard(self):
        """Verifies scorecard evaluation of ARCH-A through ARCH-E."""
        sc = build_architecture_scorecard()
        cards = sc["scorecard"]
        for arch_id in ["ARCH_A_PURE_CLIENT_LEXICAL", "ARCH_B_QWEN_RETRIEVAL_CLIENT_ENGINE", "ARCH_C_EXISTING_RANKER_CLIENT_CLUSTERING"]:
            self.assertIn(arch_id, cards)
            self.assertIn("quality", cards[arch_id])
            self.assertIn("safety", cards[arch_id])
            self.assertIn("latency", cards[arch_id])
            self.assertIn("feasibility_status", cards[arch_id])

        self.assertIn("ARCH_A", sc["selected_architecture"])


if __name__ == "__main__":
    unittest.main()
