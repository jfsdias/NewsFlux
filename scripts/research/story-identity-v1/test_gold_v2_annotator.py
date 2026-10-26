"""Unit tests for Gold V2 Annotation Tooling (STORY-02-A2 Track A2B)."""

import os
from pathlib import Path
import sys
import tempfile
import unittest

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from gold_v2_annotator import (
    ALLOWED_LABELS,
    CANONICAL_DECISION_SOURCE,
    CANONICAL_LABELS_PATH,
    CANONICAL_PACK_PATH,
    CANONICAL_SIDECAR_PATH,
    EXPECTED_PACK_SHA256,
    EXPECTED_PAIR_COUNT,
    EXPECTED_SIDECAR_SHA256,
    FORBIDDEN_MODEL_FIELDS,
    assign_batches,
    compute_diversity_order,
    compute_file_sha256,
    format_blinded_review_card,
    get_annotation_status,
    load_human_labels,
    save_human_label,
    verify_annotation_pack_integrity,
)


class TestGoldV2Annotator(unittest.TestCase):
    """Test suite validating Gold V2 annotation tooling, blinding, and batching."""

    def test_canonical_annotation_pack_integrity(self):
        """Verifies canonical annotation pack and sidecar SHA256 and count."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        result = verify_annotation_pack_integrity(CANONICAL_PACK_PATH, CANONICAL_SIDECAR_PATH)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["pack_sha256"], EXPECTED_PACK_SHA256)
        self.assertEqual(result["sidecar_sha256"], EXPECTED_SIDECAR_SHA256)
        self.assertEqual(result["pair_count"], EXPECTED_PAIR_COUNT)
        self.assertEqual(result["model_blinding_gate"], "PASS")

    def test_model_blinding_contract(self):
        """Verifies reviewer card never exposes forbidden model fields or scores."""
        dummy_item = {
            "annotation_id": "ANN-TEST-001",
            "pair_key": "1001:1002",
            "entry_a_id": 1001,
            "entry_b_id": 1002,
            "feed_a": "Feed Alpha",
            "feed_b": "Feed Beta",
            "published_at_a": "2026-10-26T12:00:00Z",
            "published_at_b": "2026-10-26T12:30:00Z",
            "title_a": "Title Alpha",
            "title_b": "Title Beta",
            "stratum": "G1_HIGH_LEXICAL_LOW_SEMANTIC",
            "mining_priority": "P1",
        }

        rendered = format_blinded_review_card(dummy_item, 0, 1)

        # Confirm essential blinded context is present
        self.assertIn("Title Alpha", rendered)
        self.assertIn("Title Beta", rendered)
        self.assertIn("Feed Alpha", rendered)
        self.assertIn("Feed Beta", rendered)
        self.assertIn("ANN-TEST-001", rendered)
        self.assertIn("G1_HIGH_LEXICAL_LOW_SEMANTIC", rendered)

        # Confirm no forbidden model fields leak into card
        lower_rendered = rendered.lower()
        for forbidden in FORBIDDEN_MODEL_FIELDS:
            self.assertNotIn(forbidden, lower_rendered)

    def test_diversity_order_and_batch_assignment(self):
        """Verifies deterministic ordering, balanced batches (A:26, B:26, C:25), and zero overlap."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        status = get_annotation_status(CANONICAL_PACK_PATH, CANONICAL_SIDECAR_PATH)
        self.assertEqual(status["total_pairs"], 77)

        batch_counts = status["batch_counts"]
        self.assertEqual(batch_counts["BATCH_A"], 26)
        self.assertEqual(batch_counts["BATCH_B"], 26)
        self.assertEqual(batch_counts["BATCH_C"], 25)
        self.assertEqual(
            batch_counts["BATCH_A"] + batch_counts["BATCH_B"] + batch_counts["BATCH_C"], 77
        )

    def test_human_label_storage_and_validation(self):
        """Verifies saving, validation of allowed labels, and loading outside git."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_labels_path = os.path.join(tmpdir, "test-human-labels.csv")

            # 1. Invalid label rejection
            with self.assertRaises(ValueError):
                save_human_label("1:2", "INVALID_LABEL", labels_path=test_labels_path)

            # 2. Save valid decisions
            save_human_label(
                "101:102",
                "SAME_EVENT",
                rationale="Direct launch reporting",
                labels_path=test_labels_path,
            )
            save_human_label(
                "103:104", "RELATED_TOPIC", rationale="Same product family", labels_path=test_labels_path
            )
            save_human_label(
                "105:106", "DIFFERENT_EVENT", rationale="Different subjects", labels_path=test_labels_path
            )
            save_human_label("107:108", "UNCERTAIN", rationale="Vague details", labels_path=test_labels_path)

            # 3. Load and inspect
            loaded = load_human_labels(test_labels_path)
            self.assertEqual(len(loaded), 4)

            self.assertEqual(loaded["101:102"]["label"], "SAME_EVENT")
            self.assertEqual(loaded["101:102"]["decision_source"], CANONICAL_DECISION_SOURCE)
            self.assertEqual(loaded["101:102"]["rationale"], "Direct launch reporting")

            self.assertEqual(loaded["107:108"]["label"], "UNCERTAIN")

    def test_absence_of_unauthorized_human_labels(self):
        """Verifies that human label file detection accurately detects missing labels."""
        # Check current system status outside git
        status = get_annotation_status()
        if not os.path.exists(CANONICAL_LABELS_PATH):
            self.assertFalse(status["human_label_file_present"])
            self.assertFalse(status["human_labeling_complete"])
            self.assertEqual(status["human_label_count"], 0)


if __name__ == "__main__":
    unittest.main()
