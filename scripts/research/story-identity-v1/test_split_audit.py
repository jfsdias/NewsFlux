#!/usr/bin/env python3
"""
Unit tests for split_audit.py (STORY-01B-M0)

Verifies:
- CONNECTED_COMPONENT_CONSTRUCTION
- ARTICLE_DISJOINT_ASSERTION
- FOLD_ARTICLE_LEAKAGE_DETECTION
- EPISODE_FAMILY_HOLDOUT
- NEGATIVE_PAIR_PRUNING
- DETERMINISTIC_SPLIT_GENERATION
"""

import os
import unittest
try:
    from .split_audit import (
        ArticleGraph,
        check_article_disjointness,
        simulate_protocol_a,
        simulate_protocol_b,
        run_split_audit,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )
except ImportError:
    from split_audit import (
        ArticleGraph,
        check_article_disjointness,
        simulate_protocol_a,
        simulate_protocol_b,
        run_split_audit,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )


class TestSplitAudit(unittest.TestCase):

    def setUp(self):
        # Synthetic fixture for deterministic testing
        self.synthetic_pairs = [
            # Component 1 (Family F1, articles A1, A2, A3)
            {"entry_a_id": "A1", "entry_b_id": "A2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_1"},
            {"entry_a_id": "A2", "entry_b_id": "A3", "gold_label": "RELATED_TOPIC", "episode_family_id": ""},
            # Component 2 (Family F2, articles B1, B2)
            {"entry_a_id": "B1", "entry_b_id": "B2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_2"},
            # Component 3 (Pure negative, articles C1, C2, C3)
            {"entry_a_id": "C1", "entry_b_id": "C2", "gold_label": "DIFFERENT_EVENT", "episode_family_id": ""},
            {"entry_a_id": "C2", "entry_b_id": "C3", "gold_label": "RELATED_TOPIC", "episode_family_id": ""},
            # Component 4 (Pure negative, articles D1, D2)
            {"entry_a_id": "D1", "entry_b_id": "D2", "gold_label": "DIFFERENT_EVENT", "episode_family_id": ""},
        ]
        self.synth_graph = ArticleGraph(self.synthetic_pairs)

    def test_connected_component_construction(self):
        """Test that undirected connected components are correctly constructed."""
        comps = self.synth_graph.components
        self.assertEqual(len(comps), 4)

        # Verify sizes
        sizes = sorted([len(c) for c in comps], reverse=True)
        self.assertEqual(sizes, [3, 3, 2, 2])

        # Verify exact membership
        comp_sets = [frozenset(c) for c in comps]
        self.assertIn(frozenset(["A1", "A2", "A3"]), comp_sets)
        self.assertIn(frozenset(["B1", "B2"]), comp_sets)
        self.assertIn(frozenset(["C1", "C2", "C3"]), comp_sets)
        self.assertIn(frozenset(["D1", "D2"]), comp_sets)

    def test_article_disjoint_assertion(self):
        """Test that disjoint article sets yield 0 leakage."""
        split_articles = [
            {"A1", "A2", "A3"},
            {"B1", "B2"},
            {"C1", "C2", "C3", "D1", "D2"},
        ]
        leakage = check_article_disjointness(split_articles)
        self.assertEqual(leakage, 0)

    def test_fold_article_leakage_detection(self):
        """Test that overlapping article IDs are detected as leakage."""
        leaky_splits = [
            {"A1", "A2", "A3"},
            {"B1", "B2", "A3"},  # A3 leaks into second fold
            {"C1", "C2"},
        ]
        leakage = check_article_disjointness(leaky_splits)
        self.assertEqual(leakage, 1)

    def test_episode_family_holdout(self):
        """Test that holding out an episode family isolates all its positive pairs and articles."""
        lofo_results = simulate_protocol_b(self.synth_graph)
        self.assertEqual(len(lofo_results), 2)  # Two families: FAM_1, FAM_2

        fam1_lofo = next(r for r in lofo_results if r["held_out_family"] == "FAM_1")
        self.assertEqual(fam1_lofo["test_positive_pairs"], 1)
        self.assertEqual(fam1_lofo["test_negative_pairs"], 1)  # A2-A3 pair
        self.assertEqual(fam1_lofo["train_positive_pairs"], 1)  # B1-B2 pair
        self.assertEqual(fam1_lofo["train_negative_pairs"], 3)  # C1-C2, C2-C3, D1-D2
        self.assertEqual(fam1_lofo["article_leakage"], 0)

    def test_negative_pair_pruning_and_disjointness(self):
        """Test that Protocol A partitions preserve strict article disjointness across all folds."""
        proto_a = simulate_protocol_a(self.synth_graph, k=2)
        self.assertTrue(proto_a["feasible"])
        self.assertEqual(proto_a["article_leakage"], 0)
        self.assertTrue(proto_a["all_positive"])
        self.assertTrue(proto_a["all_negative"])

    def test_deterministic_split_generation(self):
        """Test that split generation produces identical folds across repeated runs."""
        run1 = simulate_protocol_a(self.synth_graph, k=2)
        run2 = simulate_protocol_a(self.synth_graph, k=2)

        self.assertEqual(run1["article_leakage"], run2["article_leakage"])
        self.assertEqual(run1["folds"], run2["folds"])

    def test_gold_dataset_audit_if_available(self):
        """Integration test on the actual frozen gold dataset if present."""
        if not os.path.exists(DEFAULT_GOLD_PATH):
            self.skipTest(f"Gold dataset not found at {DEFAULT_GOLD_PATH}")

        results = run_split_audit(DEFAULT_GOLD_PATH)

        self.assertEqual(results["gold_sha256"], EXPECTED_GOLD_SHA256)
        self.assertEqual(results["pair_count"], 156)
        self.assertEqual(results["unique_article_count"], 130)
        self.assertEqual(results["connected_component_count"], 26)
        self.assertEqual(results["episode_family_count"], 10)

        # Assert zero leakage in Protocol A
        self.assertEqual(results["protocol_a_k2"]["article_leakage"], 0)
        self.assertEqual(results["protocol_a_k3"]["article_leakage"], 0)
        self.assertEqual(results["protocol_a_k4"]["article_leakage"], 0)
        self.assertEqual(results["protocol_a_k5"]["article_leakage"], 0)

        # Assert zero leakage across all 10 LOFO folds in Protocol B
        for lofo in results["lofo_results"]:
            self.assertEqual(lofo["article_leakage"], 0)


if __name__ == "__main__":
    unittest.main()
