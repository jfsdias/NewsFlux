#!/usr/bin/env python3
"""
Unit tests for split_audit.py (STORY-01B-M0)

Comprehensive coverage:
- GOLD_HASH_FAIL_FAST
- GOLD_PAIR_COUNT_FAIL_FAST
- GOLD_SCHEMA_FAIL_FAST
- GOLD_LABEL_ENUM_FAIL_FAST
- EPISODE_FAMILY_INVARIANT
- LARGEST_COMPONENT_BY_ARTICLES
- LARGEST_COMPONENT_BY_PAIRS
- POSITIVE_FAMILY_COMPONENT_MAPPING
- NEGATIVE_PAIR_PRUNING_REAL
- N1_NEGATIVE_STRATEGY
- N2_NEGATIVE_STRATEGY
- N3_NEGATIVE_STRATEGY
- ZERO_ARTICLE_LEAKAGE_FOR_ALL_STRATEGIES
- DETERMINISTIC_NEGATIVE_ASSIGNMENT
- CONNECTED_COMPONENT_CONSTRUCTION
- ARTICLE_DISJOINT_ASSERTION
- FOLD_ARTICLE_LEAKAGE_DETECTION
- EPISODE_FAMILY_HOLDOUT
- DETERMINISTIC_SPLIT_GENERATION
- GOLD_DATASET_INTEGRATION
"""

import os
import unittest
from typing import Dict, List

try:
    from .split_audit import (
        ArticleGraph,
        GoldIntegrityError,
        check_article_disjointness,
        prune_training_pairs_touching_test_articles,
        simulate_protocol_a,
        simulate_lofo_n1,
        simulate_lofo_n2,
        simulate_lofo_n3,
        validate_gold_schema_and_invariants,
        verify_gold_integrity,
        run_split_audit,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )
except ImportError:
    from split_audit import (
        ArticleGraph,
        GoldIntegrityError,
        check_article_disjointness,
        prune_training_pairs_touching_test_articles,
        simulate_protocol_a,
        simulate_lofo_n1,
        simulate_lofo_n2,
        simulate_lofo_n3,
        validate_gold_schema_and_invariants,
        verify_gold_integrity,
        run_split_audit,
        DEFAULT_GOLD_PATH,
        EXPECTED_GOLD_SHA256,
    )


class TestSplitAuditFailFast(unittest.TestCase):
    """Negative tests for fail-fast gold schema, hash, and invariant validation."""

    def test_gold_hash_fail_fast(self):
        """Test that invalid SHA256 raises GoldIntegrityError immediately."""
        with self.assertRaises(GoldIntegrityError) as ctx:
            verify_gold_integrity(DEFAULT_GOLD_PATH, expected_sha="deadbeef" * 8)
        self.assertIn("Gold SHA256 mismatch", str(ctx.exception))

    def test_gold_pair_count_fail_fast(self):
        """Test that mismatched pair count raises GoldIntegrityError."""
        fake_rows = [{"entry_a_id": "1", "entry_b_id": "2", "gold_label": "SAME_EVENT", "episode_family_id": "FAM_1"}]
        with self.assertRaises(GoldIntegrityError) as ctx:
            validate_gold_schema_and_invariants(fake_rows, expected_pair_count=156)
        self.assertIn("Pair count mismatch", str(ctx.exception))

    def test_gold_schema_missing_column_fail_fast(self):
        """Test that missing required columns raise GoldIntegrityError."""
        bad_rows = [{"entry_a_id": "1", "entry_b_id": "2"}]  # missing gold_label, episode_family_id
        with self.assertRaises(GoldIntegrityError) as ctx:
            validate_gold_schema_and_invariants(bad_rows, expected_pair_count=1, expected_article_count=2)
        self.assertIn("Missing required columns", str(ctx.exception))

    def test_gold_label_enum_fail_fast(self):
        """Test that label outside allowed enum raises GoldIntegrityError."""
        bad_rows = [{"entry_a_id": "1", "entry_b_id": "2", "gold_label": "INVALID_LABEL", "episode_family_id": ""}]
        with self.assertRaises(GoldIntegrityError) as ctx:
            validate_gold_schema_and_invariants(bad_rows, expected_pair_count=1, expected_article_count=2)
        self.assertIn("contains invalid label", str(ctx.exception))

    def test_episode_family_positive_missing_invariant(self):
        """Test that SAME_EVENT missing episode_family_id raises GoldIntegrityError."""
        bad_rows = [{"entry_a_id": "1", "entry_b_id": "2", "gold_label": "SAME_EVENT", "episode_family_id": ""}]
        with self.assertRaises(GoldIntegrityError) as ctx:
            validate_gold_schema_and_invariants(bad_rows, expected_pair_count=1, expected_article_count=2)
        self.assertIn("SAME_EVENT has missing episode_family_id", str(ctx.exception))

    def test_episode_family_negative_with_family_invariant(self):
        """Test that non-SAME_EVENT with non-empty episode_family_id raises GoldIntegrityError."""
        bad_rows = [{"entry_a_id": "1", "entry_b_id": "2", "gold_label": "RELATED_TOPIC", "episode_family_id": "ILLEGAL_FAM"}]
        with self.assertRaises(GoldIntegrityError) as ctx:
            validate_gold_schema_and_invariants(bad_rows, expected_pair_count=1, expected_article_count=2)
        self.assertIn("has non-empty episode_family_id", str(ctx.exception))


class TestSplitAuditGraphAndProtocols(unittest.TestCase):
    """Unit tests for graph construction, pruning, and split protocols."""

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

        sizes = sorted([len(c) for c in comps], reverse=True)
        self.assertEqual(sizes, [3, 3, 2, 2])

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

    def test_negative_pair_pruning_real(self):
        """
        Test explicit negative pair pruning on a fixture where a negative pair originally
        in train touches an article in test. Proves REMOVED > 0 and LEAKAGE == 0.
        """
        test_articles = {"A1", "A2"}
        # Training pairs contain:
        # P1: (B1, B2) -> safe
        # P2: (B2, A1) -> leaks via A1
        # P3: (C1, C2) -> safe
        train_pairs = [
            {"entry_a_id": "B1", "entry_b_id": "B2", "gold_label": "SAME_EVENT"},
            {"entry_a_id": "B2", "entry_b_id": "A1", "gold_label": "RELATED_TOPIC"},
            {"entry_a_id": "C1", "entry_b_id": "C2", "gold_label": "DIFFERENT_EVENT"},
        ]

        pruned, removed_count, remaining_leakage = prune_training_pairs_touching_test_articles(
            train_pairs, test_articles
        )

        self.assertEqual(removed_count, 1)
        self.assertGreater(removed_count, 0)
        self.assertEqual(remaining_leakage, 0)
        self.assertEqual(len(pruned), 2)
        pruned_edges = [(p["entry_a_id"], p["entry_b_id"]) for p in pruned]
        self.assertNotIn(("B2", "A1"), pruned_edges)

    def test_deterministic_split_generation(self):
        """Test that split generation produces identical folds across repeated runs."""
        run1 = simulate_protocol_a(self.synth_graph, k=2)
        run2 = simulate_protocol_a(self.synth_graph, k=2)

        self.assertEqual(run1["article_leakage"], run2["article_leakage"])
        self.assertEqual(run1["folds"], run2["folds"])


class TestGoldIntegration(unittest.TestCase):
    """Integration tests on the actual frozen gold dataset."""

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(DEFAULT_GOLD_PATH):
            raise unittest.SkipTest(f"Gold dataset not found at {DEFAULT_GOLD_PATH}")
        cls.results = run_split_audit(DEFAULT_GOLD_PATH)
        file_sha, pairs = verify_gold_integrity(DEFAULT_GOLD_PATH)
        cls.graph = ArticleGraph(pairs)

    def test_canonical_integrity_and_schema(self):
        self.assertEqual(self.results["gold_sha256"], EXPECTED_GOLD_SHA256)
        self.assertEqual(self.results["pair_count"], 156)
        self.assertEqual(self.results["unique_article_count"], 130)
        self.assertEqual(self.results["connected_component_count"], 26)

    def test_largest_component_metrics_distinctness(self):
        """
        Verify that largest component by articles (C01, 29 arts, 44 pairs)
        and largest component by pairs (C02, 27 arts, 59 pairs) are distinct.
        """
        self.assertEqual(self.results["largest_component_by_articles_id"], "C01")
        self.assertEqual(self.results["largest_component_article_count"], 29)
        self.assertEqual(self.results["largest_component_by_articles_pair_count"], 44)

        self.assertEqual(self.results["largest_component_by_pairs_id"], "C02")
        self.assertEqual(self.results["largest_component_pair_count"], 59)
        self.assertEqual(self.results["largest_component_by_pairs_article_count"], 27)

        self.assertNotEqual(
            self.results["largest_component_by_articles_id"],
            self.results["largest_component_by_pairs_id"],
        )

    def test_positive_family_component_mapping_invariant(self):
        """Verify that each positive family occupies exactly one component and vice versa."""
        self.assertEqual(self.results["positive_family_spans_multiple_components"], 0)
        self.assertEqual(self.results["positive_component_with_multiple_families"], 0)

    def test_protocol_a_leak_free_and_metric_eligibility(self):
        """Verify Protocol A K=2..5 leak-free assertion and metric eligibility."""
        p_a_k3 = self.results["protocol_a_k3"]
        self.assertTrue(p_a_k3["feasible"])
        self.assertTrue(p_a_k3["metric_eligible"])
        self.assertEqual(p_a_k3["article_leakage"], 0)
        self.assertTrue(p_a_k3["all_positive_present"])
        self.assertTrue(p_a_k3["all_negative_present"])
        self.assertTrue(p_a_k3["all_related_topic_present"])
        self.assertTrue(p_a_k3["all_different_event_present"])

    def test_negative_strategies_n1_n2_n3_leak_free(self):
        """Verify that all three negative strategies guarantee zero leakage."""
        for r in self.results["lofo_n1"]:
            self.assertEqual(r["article_leakage"], 0)
        for r in self.results["lofo_n2"]:
            self.assertEqual(r["article_leakage"], 0)
        for r in self.results["lofo_n3"]:
            self.assertEqual(r["article_leakage"], 0)

    def test_n1_has_zero_negative_folds_limitation(self):
        """Verify that Option N1 results in 2 folds with 0 negatives (C16, C17)."""
        zero_neg_n1 = [r["held_out_family"] for r in self.results["lofo_n1"] if not r["test_has_negatives"]]
        self.assertEqual(len(zero_neg_n1), 2)
        self.assertIn("ARKANE_LYON_CLOSURE_BLADE", zero_neg_n1)
        self.assertIn("VIVO_STREAMING_COMBOS_DISCOUNT", zero_neg_n1)

    def test_n2_and_n3_resolve_zero_negative_folds(self):
        """Verify that Options N2 and N3 provide negatives for 100% of the 10 LOFO folds."""
        zero_neg_n2 = [r["held_out_family"] for r in self.results["lofo_n2"] if not r["test_has_negatives"]]
        zero_neg_n3 = [r["held_out_family"] for r in self.results["lofo_n3"] if not r["test_has_negatives"]]
        self.assertEqual(len(zero_neg_n2), 0)
        self.assertEqual(len(zero_neg_n3), 0)

    def test_deterministic_negative_assignment(self):
        """Verify that repeated negative strategy runs produce bitwise identical results."""
        run1 = simulate_lofo_n3(self.graph)
        run2 = simulate_lofo_n3(self.graph)
        self.assertEqual(run1, run2)


if __name__ == "__main__":
    unittest.main()
