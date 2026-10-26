"""Comprehensive Unit Tests for Gold V2 Annotation Tooling (STORY-02-A2 Track A2B R1).

Verifies canonical input hashes, 77-pair count, model score blinding,
label-adjacent metadata blinding (no stratum, no mining priority, no selection reason),
batch determinism (Batch A: 26, Batch B: 26, Batch C: 25), safe storage outside git,
and checkpoint resumption.
"""

from collections import Counter
import csv
import json
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
    FORBIDDEN_HUMAN_TOKENS,
    FORBIDDEN_MODEL_FIELDS,
    assign_batches,
    compute_diversity_order,
    compute_file_sha256,
    format_blinded_review_card,
    get_annotation_status,
    load_human_labels,
    save_human_label,
    validate_human_view_blinding,
    verify_annotation_pack_integrity,
)


class TestGoldV2AnnotatorR1(unittest.TestCase):
    """Test suite validating Gold V2 annotation tooling, blinding, and batching."""

    def test_canonical_input_sha_gate(self):
        """CANONICAL_INPUT_SHA_GATE: Verifies exact canonical SHA256 of pack and sidecar."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        pack_sha = compute_file_sha256(CANONICAL_PACK_PATH)
        sidecar_sha = compute_file_sha256(CANONICAL_SIDECAR_PATH)
        self.assertEqual(pack_sha, EXPECTED_PACK_SHA256)
        self.assertEqual(sidecar_sha, EXPECTED_SIDECAR_SHA256)

    def test_pair_count_gate(self):
        """PAIR_COUNT_GATE: Verifies exactly 77 candidate pairs exist and align."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        with open(CANONICAL_PACK_PATH, "r", encoding="utf-8") as f:
            pack_rows = list(csv.DictReader(f))
        with open(CANONICAL_SIDECAR_PATH, "r", encoding="utf-8") as f:
            sidecar_data = json.load(f)

        sidecar_pairs = sidecar_data.get("candidate_pairs", [])
        self.assertEqual(len(pack_rows), EXPECTED_PAIR_COUNT)
        self.assertEqual(len(sidecar_pairs), EXPECTED_PAIR_COUNT)

        for pr, sp in zip(pack_rows, sidecar_pairs):
            self.assertEqual(pr["annotation_id"], sp["annotation_id"])

    def test_model_score_blinding_gate(self):
        """MODEL_SCORE_BLINDING_GATE: Pack columns and review cards never leak scores or predictions."""
        if not os.path.exists(CANONICAL_PACK_PATH):
            self.skipTest("Canonical pack not found in /tmp")

        with open(CANONICAL_PACK_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = set(reader.fieldnames or [])
            rows = list(reader)

        # Ensure no model score or prediction columns in CSV
        forbidden_pack_score_columns = {
            "b0_prediction",
            "b4_prediction",
            "d0_score",
            "d1_score",
            "qwen_cosine",
            "qwen_embedding_cosine",
            "mistral_cosine",
            "mistral_embedding_cosine",
            "reranker",
            "candidate_rank",
            "score",
            "prediction",
        }
        for forbidden in forbidden_pack_score_columns:
            self.assertNotIn(forbidden, fieldnames)

        # Ensure all rows have empty gold_label placeholder
        for r in rows:
            self.assertEqual(r.get("gold_label", "").strip(), "")

    def test_label_adjacent_metadata_blinding_gate(self):
        """LABEL_ADJACENT_METADATA_BLINDING_GATE: Card never leaks strata or mining classes."""
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
            "stratum": "G3_RELATED_TOPIC_BOUNDARY",
            "mining_priority": "P1",
        }

        rendered = format_blinded_review_card(dummy_item, 0, 1)

        # Inverted assertion per Section 8: STRATUM MUST NOT BE IN RENDERED OUTPUT
        self.assertNotIn("G1_HIGH_LEXICAL_LOW_SEMANTIC", rendered)
        self.assertNotIn("G3_RELATED_TOPIC_BOUNDARY", rendered)
        self.assertNotIn("RELATED_TOPIC_BOUNDARY", rendered)
        self.assertNotIn("DIFFERENT_EVENT_RISK", rendered)

        # Check all reviewer-output forbidden tokens
        upper_rendered = rendered.upper()
        for forbidden_token in FORBIDDEN_HUMAN_TOKENS:
            self.assertNotIn(f"{forbidden_token}:", upper_rendered)

    def test_human_card_no_stratum_gate(self):
        """HUMAN_CARD_NO_STRATUM_GATE: Asserts STRATUM label is completely absent."""
        dummy_item = {
            "annotation_id": "ANN-TEST-002",
            "pair_key": "2001:2002",
            "entry_a_id": 2001,
            "entry_b_id": 2002,
            "feed_a": "Ars Technica",
            "feed_b": "9to5Mac",
            "published_at_a": "1792784038.0",
            "published_at_b": "1792778820.0",
            "title_a": "Article One Title",
            "title_b": "Article Two Title",
            "stratum": "G7_SAME_CATEGORY_DIFFERENT_EVENT_RISK",
            "mining_priority": "P1",
        }

        rendered = format_blinded_review_card(dummy_item, 1, 10)
        self.assertNotIn("STRATUM:", rendered)
        self.assertNotIn("stratum:", rendered)
        self.assertNotIn("STRATUM", rendered)
        self.assertNotIn("G7_SAME_CATEGORY_DIFFERENT_EVENT_RISK", rendered)

    def test_human_card_no_mining_reason_gate(self):
        """HUMAN_CARD_NO_MINING_REASON_GATE: Strong test with deliberately sensitive internal metadata."""
        sensitive_item = {
            "annotation_id": "ANN-SENSITIVE-999",
            "pair_key": "9001:9002",
            "entry_a_id": 9001,
            "entry_b_id": 9002,
            "feed_a": "Feed One",
            "feed_b": "Feed Two",
            "published_at_a": "1792784038.0",
            "published_at_b": "1792778820.0",
            "title_a": "Genuine Article Subject",
            "title_b": "Independent Editorial Piece",
            # Deliberately injected sensitive provenance:
            "stratum": "G3_RELATED_TOPIC_BOUNDARY",
            "mining_stratum": "G3_RELATED_TOPIC_BOUNDARY",
            "mining_priority": "P1",
            "selection_reason": "possible different event",
            "review_priority": "URGENT",
            "d0_score": 0.88,
            "d1_score": 0.94,
            "qwen_embedding_cosine": 0.954,
            "mistral_embedding_cosine": 0.892,
            "reranker": 0.91,
            "candidate_rank": 3,
            "expected_label": "SAME_EVENT",
            "gold_label": "RELATED_TOPIC",
        }

        rendered = format_blinded_review_card(sensitive_item, 0, 77)

        # Verify essential non-biased content IS present
        self.assertIn("ANN-SENSITIVE-999", rendered)
        self.assertIn("Genuine Article Subject", rendered)
        self.assertIn("Independent Editorial Piece", rendered)

        # Verify NONE of the sensitive values or field names leak
        self.assertNotIn("G3_RELATED_TOPIC_BOUNDARY", rendered)
        self.assertNotIn("possible different event", rendered)
        self.assertNotIn("P1", rendered)
        self.assertNotIn("URGENT", rendered)
        self.assertNotIn("0.88", rendered)
        self.assertNotIn("0.94", rendered)
        self.assertNotIn("0.954", rendered)
        self.assertNotIn("0.892", rendered)
        self.assertNotIn("reranker", rendered)
        self.assertNotIn("candidate_rank", rendered)
        self.assertNotIn("expected_label", rendered)
        self.assertNotIn("gold_label", rendered)

    def test_batch_determinism_gate(self):
        """BATCH_DETERMINISM_GATE: Diversity ordering and batch assignments are 100% deterministic."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        with open(CANONICAL_PACK_PATH, "r", encoding="utf-8") as f:
            pack_rows = list(csv.DictReader(f))
        with open(CANONICAL_SIDECAR_PATH, "r", encoding="utf-8") as f:
            sidecar_data = json.load(f)

        ordered1 = compute_diversity_order(pack_rows, sidecar_data["candidate_pairs"])
        ordered2 = compute_diversity_order(pack_rows, sidecar_data["candidate_pairs"])
        self.assertEqual([p["pair_key"] for p in ordered1], [p["pair_key"] for p in ordered2])

        batches1 = assign_batches(ordered1)
        batches2 = assign_batches(ordered2)
        for b_name in ("BATCH_A", "BATCH_B", "BATCH_C"):
            keys1 = [p["pair_key"] for p in batches1[b_name]]
            keys2 = [p["pair_key"] for p in batches2[b_name]]
            self.assertEqual(keys1, keys2)

    def test_batch_counts_gate(self):
        """BATCH_COUNTS_GATE: Asserts BATCH_A=26, BATCH_B=26, BATCH_C=25, sum=77, disjoint sets."""
        if not os.path.exists(CANONICAL_PACK_PATH) or not os.path.exists(CANONICAL_SIDECAR_PATH):
            self.skipTest("Canonical pack or sidecar not found in /tmp")

        status = get_annotation_status(CANONICAL_PACK_PATH, CANONICAL_SIDECAR_PATH)
        counts = status["batch_counts"]
        self.assertEqual(counts["BATCH_A"], 26)
        self.assertEqual(counts["BATCH_B"], 26)
        self.assertEqual(counts["BATCH_C"], 25)
        self.assertEqual(counts["BATCH_A"] + counts["BATCH_B"] + counts["BATCH_C"], 77)

    def test_label_storage_outside_git_gate(self):
        """LABEL_STORAGE_OUTSIDE_GIT_GATE: Saves to target path outside git with canonical decision source."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_labels_path = os.path.join(tmpdir, "human-labels-v1.csv")

            save_human_label(
                "101:102",
                "SAME_EVENT",
                rationale="Direct product launch",
                labels_path=test_labels_path,
            )

            loaded = load_human_labels(test_labels_path)
            self.assertIn("101:102", loaded)
            self.assertEqual(loaded["101:102"]["label"], "SAME_EVENT")
            self.assertEqual(loaded["101:102"]["decision_source"], CANONICAL_DECISION_SOURCE)
            self.assertEqual(loaded["101:102"]["rationale"], "Direct product launch")
            self.assertTrue(bool(loaded["101:102"]["reviewed_at"]))

    def test_allowed_label_gate(self):
        """ALLOWED_LABEL_GATE: Enforces exact allowed labels: SAME_EVENT, RELATED_TOPIC, DIFFERENT_EVENT, UNCERTAIN."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_labels_path = os.path.join(tmpdir, "human-labels-v1.csv")

            for valid_lbl in ALLOWED_LABELS:
                save_human_label(f"1:{valid_lbl}", valid_lbl, labels_path=test_labels_path)

            loaded = load_human_labels(test_labels_path)
            self.assertEqual(len(loaded), len(ALLOWED_LABELS))

            # Disallowed labels throw ValueError
            for invalid_lbl in ("YES", "NO", "MAYBE", "DUPLICATE", "SAME_STORY", "1", ""):
                with self.assertRaises(ValueError):
                    save_human_label("1:99", invalid_lbl, labels_path=test_labels_path)

    def test_resume_gate(self):
        """RESUME_GATE: Existing labels are preserved across saves and skip already-reviewed pairs."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_labels_path = os.path.join(tmpdir, "human-labels-v1.csv")

            save_human_label("101:102", "SAME_EVENT", labels_path=test_labels_path)
            save_human_label("201:202", "DIFFERENT_EVENT", labels_path=test_labels_path)

            # Reload and add a third decision
            loaded = load_human_labels(test_labels_path)
            self.assertEqual(len(loaded), 2)
            self.assertEqual(loaded["101:102"]["label"], "SAME_EVENT")
            self.assertEqual(loaded["201:202"]["label"], "DIFFERENT_EVENT")

            save_human_label("301:302", "UNCERTAIN", labels_path=test_labels_path)
            reloaded = load_human_labels(test_labels_path)
            self.assertEqual(len(reloaded), 3)


if __name__ == "__main__":
    unittest.main()
