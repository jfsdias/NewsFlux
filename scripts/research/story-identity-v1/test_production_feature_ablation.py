#!/usr/bin/env python3
"""Tests for production_feature_ablation.py (STORY-02-A0)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from production_feature_ablation import (
    FEATURE_SOURCE_INVENTORY,
    PF0_LEXICAL_FEATURES,
    PF1_QWEN_FEATURES,
    PF2_SIDECAR_FEATURES,
    PF3_RESEARCH_FEATURES,
    reconcile_abstention_semantics,
    run_production_feature_ablation,
)


class TestProductionFeatureAblation(unittest.TestCase):
    """Verifies feature source audit and ablation protocol invariants."""

    def test_feature_source_inventory_schema(self):
        """Verifies all cataloged features have required architectural properties."""
        self.assertGreaterEqual(len(FEATURE_SOURCE_INVENTORY), 10)
        required_keys = {
            "feature_name",
            "current_source",
            "available_in_browser",
            "available_from_miniflux",
            "available_in_existing_sidecar",
            "requires_embedding_model",
            "requires_reranker",
            "requires_new_network_call",
            "computational_cost",
            "privacy_impact",
            "production_feasible_today",
        }
        for item in FEATURE_SOURCE_INVENTORY:
            self.assertTrue(required_keys.issubset(item.keys()), f"Missing keys in {item['feature_name']}")
            self.assertIsInstance(item["available_in_browser"], bool)
            self.assertIsInstance(item["production_feasible_today"], bool)

    def test_feature_subset_progression(self):
        """Verifies subset containment: PF0 ⊂ PF1 ⊂ PF2/PF3."""
        self.assertEqual(len(PF0_LEXICAL_FEATURES), 15)
        self.assertEqual(len(PF1_QWEN_FEATURES), 16)
        self.assertEqual(len(PF2_SIDECAR_FEATURES), 17)
        self.assertEqual(len(PF3_RESEARCH_FEATURES), 17)

        self.assertTrue(set(PF0_LEXICAL_FEATURES).issubset(set(PF1_QWEN_FEATURES)))
        self.assertTrue(set(PF1_QWEN_FEATURES).issubset(set(PF2_SIDECAR_FEATURES)))
        self.assertTrue(set(PF1_QWEN_FEATURES).issubset(set(PF3_RESEARCH_FEATURES)))

        # PF0 must contain zero embedding models
        for f in PF0_LEXICAL_FEATURES:
            self.assertNotIn("embedding", f)
            self.assertNotIn("reranker", f)

    def test_abstention_reconciliation_denominators(self):
        """Verifies explicit denominators for Q1 and Q3 abstention."""
        gold_dummy = [
            {"gold_label": "SAME_EVENT"} for _ in range(57)
        ] + [
            {"gold_label": "DIFFERENT_EVENT"} for _ in range(80)
        ] + [
            {"gold_label": "RELATED_TOPIC"} for _ in range(19)
        ]
        abstention_path = "/tmp/newsflux-story01b-private/overnight-v2/abstention/abstention-frontier-v1.json"
        rec = reconcile_abstention_semantics(gold_dummy, abstention_path)

        self.assertEqual(rec["gold_positive_total"], 57)
        self.assertEqual(rec["base_model_true_positives"], 38)
        self.assertEqual(rec["q1_metrics"]["retained_base_true_positives"], 38)
        self.assertAlmostEqual(rec["q1_metrics"]["retained_base_tp_ratio"], 1.0)
        self.assertAlmostEqual(rec["q1_metrics"]["gold_positive_capture"], 38 / 57)
        self.assertIn("QUALIFIED", rec["q1_metrics"]["zero_loss_statement_validity"])

    def test_ablation_execution_and_invariants(self):
        """Verifies that full ablation runs without mutating production code or fitting full gold artifacts."""
        ablation, matrix = run_production_feature_ablation()

        self.assertIn("models", ablation)
        self.assertIn("PF0_LEXICAL_ONLY", ablation["models"])
        self.assertIn("PF1_LEXICAL_PLUS_QWEN", ablation["models"])
        self.assertIn("PF2_LEXICAL_PLUS_SIDECAR", ablation["models"])
        self.assertIn("PF3_FULL_RESEARCH_B4", ablation["models"])

        # Quality metrics must be valid numbers
        for name, m in ablation["models"].items():
            self.assertGreaterEqual(m["pr_auc"], 0.80, f"PR-AUC too low for {name}")
            self.assertGreaterEqual(m["f05"], 0.80, f"F0.5 too low for {name}")
            self.assertGreaterEqual(m["precision"], 0.80, f"Precision too low for {name}")
            self.assertGreaterEqual(m["recall"], 0.70, f"Recall too low for {name}")

        # Mistral finding
        self.assertTrue(ablation["critical_mistral_finding"]["b4_requires_mistral_for_inference"])
        self.assertFalse(ablation["critical_mistral_finding"]["current_runtime_mistral_available"])


if __name__ == "__main__":
    unittest.main()
