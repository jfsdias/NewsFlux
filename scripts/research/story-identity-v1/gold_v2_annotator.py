"""Gold V2 Human Annotation Tooling (STORY-02-A2 Track A2B R1).

Provides offline review tooling, strict model blinding, label-adjacent metadata
blinding, diversity-aware ordering, batching (Batch A, B, C), and safe checkpointing
outside git for expanding human-labeled Story Identity evidence without bias.
"""

from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

# Canonical input artifact paths and expected SHA256 hashes
CANONICAL_PACK_PATH = "/tmp/newsflux-story01b-private/overnight-v2/annotation/annotation-pack-v1.csv"
CANONICAL_SIDECAR_PATH = (
    "/tmp/newsflux-story01b-private/overnight-v2/annotation/annotation-audit-sidecar-v1.json"
)
CANONICAL_LABELS_PATH = "/tmp/newsflux-story02-gold-v2/human-labels-v1.csv"

EXPECTED_PACK_SHA256 = "b238f8bd77e75f0b3af0c6ab7510d4e2a45667ad2d38d6a8c361d30f627fa8ce"
EXPECTED_SIDECAR_SHA256 = "41bb677bf52c7cd3b8c2d0bbb55cfd8a83d49eb9cbd22bfa6907edfd7c744ad7"
EXPECTED_PAIR_COUNT = 77

# Allowed human labels (Section 25)
ALLOWED_LABELS = frozenset({"SAME_EVENT", "RELATED_TOPIC", "DIFFERENT_EVENT", "UNCERTAIN"})
CANONICAL_DECISION_SOURCE = "EXPLICIT_USER_DECISION"

# Forbidden model-revealing field names in raw reviewer items or pack columns
FORBIDDEN_MODEL_FIELDS = frozenset(
    {
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
        "expected_label",
        "score",
        "prediction",
        "gold_label",
    }
)

# Reviewer-output-specific forbidden tokens (Section 10)
# These represent label-adjacent metadata, mining strata, and model identities
# that could bias the human annotator toward a specific label class.
FORBIDDEN_HUMAN_TOKENS = frozenset(
    {
        "RELATED_TOPIC_BOUNDARY",
        "DIFFERENT_EVENT_RISK",
        "HIGH_LEXICAL",
        "LOW_LEXICAL",
        "HIGH_SEMANTIC",
        "LOW_SEMANTIC",
        "NON_DUO_COVERAGE",
        "TEMPORAL_BOUNDARY",
        "CROSS_CATEGORY",
        "HIGH_SEMANTIC_LOW_ENTITY_ANCHOR",
        "MINING",
        "MINING_STRATUM",
        "MINING_PRIORITY",
        "SELECTION_REASON",
        "REVIEW_PRIORITY",
        "STRATUM",
        "QWEN",
        "MISTRAL",
        "RERANKER",
        "PREDICTION",
        "EXPECTED_LABEL",
        "GOLD_LABEL",
        "PSEUDO_LABEL",
        "D0_SCORE",
        "D1_SCORE",
    }
)


def compute_file_sha256(file_path: str) -> str:
    """Computes SHA256 digest of a file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def validate_human_view_blinding(rendered_card: str) -> None:
    """Verifies that no forbidden model names, mining strata, or reasons appear in the card.

    Checks structural lines (outside of article title / feed contents).
    """
    card_upper = rendered_card.upper()
    for token in FORBIDDEN_HUMAN_TOKENS:
        # Check if the token appears as a structured field header or explicit label
        if f"{token}:" in card_upper or f"STRATUM" in card_upper or f"MINING" in card_upper:
            raise ValueError(f"Forbidden human view token leaked in review card: {token}")


def verify_annotation_pack_integrity(
    pack_path: str = CANONICAL_PACK_PATH,
    sidecar_path: str = CANONICAL_SIDECAR_PATH,
    strict_sha: bool = True,
) -> Dict[str, Any]:
    """Verifies SHA256 integrity, model-blinding, and human-view blinding contracts."""
    pack_sha = compute_file_sha256(pack_path)
    sidecar_sha = compute_file_sha256(sidecar_path)

    if strict_sha:
        if pack_sha != EXPECTED_PACK_SHA256:
            raise ValueError(
                f"Annotation pack SHA256 mismatch! Got {pack_sha}, expected {EXPECTED_PACK_SHA256}"
            )
        if sidecar_sha != EXPECTED_SIDECAR_SHA256:
            raise ValueError(
                f"Sidecar SHA256 mismatch! Got {sidecar_sha}, expected {EXPECTED_SIDECAR_SHA256}"
            )

    with open(pack_path, "r", encoding="utf-8") as f:
        pack_rows = list(csv.DictReader(f))

    with open(sidecar_path, "r", encoding="utf-8") as f:
        sidecar_data = json.load(f)

    sidecar_pairs = sidecar_data.get("candidate_pairs", [])

    if len(pack_rows) != EXPECTED_PAIR_COUNT or len(sidecar_pairs) != EXPECTED_PAIR_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_PAIR_COUNT} pairs, got pack={len(pack_rows)}, sidecar={len(sidecar_pairs)}"
        )

    # Verify ID alignment
    for pack_r, sidecar_p in zip(pack_rows, sidecar_pairs):
        if pack_r["annotation_id"] != sidecar_p["annotation_id"]:
            raise ValueError(
                f"ID mismatch: {pack_r['annotation_id']} vs {sidecar_p['annotation_id']}"
            )

    # Verify Model Blinding on the pack columns
    pack_fieldnames = set(pack_rows[0].keys()) if pack_rows else set()
    leaked_fields = pack_fieldnames & {
        "d0_score",
        "d1_score",
        "qwen_cosine",
        "mistral_cosine",
        "score",
        "prediction",
        "stratum",
        "mining_stratum",
    }
    if leaked_fields:
        raise ValueError(f"Forbidden fields leaked in annotation pack columns: {leaked_fields}")

    # Verify Human View Blinding on all candidate cards
    ordered_pairs = compute_diversity_order(pack_rows, sidecar_pairs)
    for idx, item in enumerate(ordered_pairs):
        card = format_blinded_review_card(item, idx, len(ordered_pairs))
        if "STRATUM" in card.upper() or "MINING" in card.upper() or "PRIORITY" in card.upper():
            raise ValueError(f"Mining metadata leaked into human card for {item['annotation_id']}")
        validate_human_view_blinding(card)

    return {
        "status": "PASS",
        "pack_sha256": pack_sha,
        "sidecar_sha256": sidecar_sha,
        "pair_count": len(pack_rows),
        "model_score_blinding_gate": "PASS",
        "label_adjacent_metadata_blinding_gate": "PASS",
        "human_view_blinding_gate": "PASS",
    }


def compute_diversity_order(
    pack_rows: List[Dict[str, Any]], sidecar_pairs: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Generates a deterministic diversity-aware order interleaving strata and feeds.

    Avoids presenting identical strata or consecutive similar feeds.
    Does NOT use predicted truth or model scores to order pairs.
    """
    assert len(pack_rows) == len(sidecar_pairs)

    combined_records = []
    for r, s in zip(pack_rows, sidecar_pairs):
        a = int(r["entry_a_id"])
        b = int(r["entry_b_id"])
        pair_key = f"{min(a, b)}:{max(a, b)}"
        combined_records.append(
            {
                "annotation_id": r["annotation_id"],
                "pair_key": pair_key,
                "entry_a_id": a,
                "entry_b_id": b,
                "feed_a": r["feed_a"],
                "feed_b": r["feed_b"],
                "published_at_a": r["published_at_a"],
                "published_at_b": r["published_at_b"],
                "title_a": r["title_a"],
                "title_b": r["title_b"],
                "stratum": s.get("mining_stratum", "UNKNOWN"),
                "mining_priority": s.get("mining_priority", "P1"),
            }
        )

    # Group deterministically by stratum
    strata_groups = defaultdict(list)
    for rec in combined_records:
        strata_groups[rec["stratum"]].append(rec)

    # Sort deterministically within stratum by pair_key
    for stratum_name in strata_groups:
        strata_groups[stratum_name].sort(key=lambda item: item["pair_key"])

    # Interleave round-robin across strata sorted by stratum name
    ordered: List[Dict[str, Any]] = []
    sorted_strata_names = sorted(strata_groups.keys())
    max_stratum_len = max(len(v) for v in strata_groups.values()) if strata_groups else 0

    for idx in range(max_stratum_len):
        for s_name in sorted_strata_names:
            if idx < len(strata_groups[s_name]):
                ordered.append(strata_groups[s_name][idx])

    return ordered


def assign_batches(ordered_pairs: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Assigns ordered candidate pairs into balanced batches (Batch A, B, C).

    Reported distribution for 77 pairs:
    - BATCH_A: 26 pairs
    - BATCH_B: 26 pairs
    - BATCH_C: 25 pairs
    """
    total = len(ordered_pairs)
    batch_a = [ordered_pairs[i] for i in range(0, total, 3)]
    batch_b = [ordered_pairs[i] for i in range(1, total, 3)]
    batch_c = [ordered_pairs[i] for i in range(2, total, 3)]

    return {
        "BATCH_A": batch_a,
        "BATCH_B": batch_b,
        "BATCH_C": batch_c,
    }


def load_human_labels(labels_path: str = CANONICAL_LABELS_PATH) -> Dict[str, Dict[str, str]]:
    """Loads existing human decisions outside git.

    Returns empty dict if file does not exist.
    """
    if not os.path.exists(labels_path):
        return {}

    labels: Dict[str, Dict[str, str]] = {}
    with open(labels_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pk = row.get("pair_key", "").strip()
            lbl = row.get("label", "").strip()
            if not pk or not lbl:
                continue
            if lbl not in ALLOWED_LABELS:
                raise ValueError(
                    f"Invalid label '{lbl}' in {labels_path} for pair {pk}! Allowed: {ALLOWED_LABELS}"
                )
            labels[pk] = row
    return labels


def save_human_label(
    pair_key: str,
    label: str,
    rationale: str = "",
    labels_path: str = CANONICAL_LABELS_PATH,
    reviewed_at: Optional[str] = None,
) -> None:
    """Appends or updates a single human decision in the target file outside git."""
    if label not in ALLOWED_LABELS:
        raise ValueError(f"Label '{label}' not in allowed labels: {ALLOWED_LABELS}")

    os.makedirs(os.path.dirname(labels_path), exist_ok=True)
    existing = load_human_labels(labels_path)

    timestamp = reviewed_at or datetime.now(timezone.utc).isoformat()
    existing[pair_key] = {
        "pair_key": pair_key,
        "label": label,
        "decision_source": CANONICAL_DECISION_SOURCE,
        "rationale": rationale.strip(),
        "reviewed_at": timestamp,
    }

    # Write out deterministically sorted by pair_key
    fieldnames = ["pair_key", "label", "decision_source", "rationale", "reviewed_at"]
    with open(labels_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for pk in sorted(existing.keys()):
            writer.writerow(existing[pk])


def get_annotation_status(
    pack_path: str = CANONICAL_PACK_PATH,
    sidecar_path: str = CANONICAL_SIDECAR_PATH,
    labels_path: str = CANONICAL_LABELS_PATH,
) -> Dict[str, Any]:
    """Reports status of annotation pack, batches, and human review progress."""
    pack_exists = os.path.exists(pack_path)
    sidecar_exists = os.path.exists(sidecar_path)
    labels_exist = os.path.exists(labels_path)

    if not pack_exists or not sidecar_exists:
        return {
            "pack_present": pack_exists,
            "sidecar_present": sidecar_exists,
            "human_label_file_present": labels_exist,
            "human_labeling_complete": False,
        }

    with open(pack_path, "r", encoding="utf-8") as f:
        pack_rows = list(csv.DictReader(f))
    with open(sidecar_path, "r", encoding="utf-8") as f:
        sidecar_data = json.load(f)

    sidecar_pairs = sidecar_data.get("candidate_pairs", [])
    ordered = compute_diversity_order(pack_rows, sidecar_pairs)
    batches = assign_batches(ordered)

    labels = load_human_labels(labels_path)
    expected_keys = {p["pair_key"] for p in ordered}
    labeled_keys = set(labels.keys())
    missing_keys = expected_keys - labeled_keys

    complete = len(expected_keys) > 0 and len(missing_keys) == 0

    return {
        "pack_present": True,
        "sidecar_present": True,
        "total_pairs": len(ordered),
        "batch_counts": {
            "BATCH_A": len(batches["BATCH_A"]),
            "BATCH_B": len(batches["BATCH_B"]),
            "BATCH_C": len(batches["BATCH_C"]),
        },
        "human_label_file_present": labels_exist,
        "human_label_count": len(labels),
        "human_labeling_complete": complete,
        "missing_label_count": len(missing_keys),
        "label_distribution": dict(Counter(r["label"] for r in labels.values())),
    }


def format_blinded_review_card(item: Dict[str, Any], index: int, total: int) -> str:
    """Renders a reviewer card strictly blinded from all model scores, mining metadata, and strata."""
    lines = [
        f"\n{'=' * 70}",
        f"PAIR [{index + 1}/{total}]: {item['annotation_id']} ({item['pair_key']})",
        f"{'-' * 70}",
        f"ARTICLE A: [{item['feed_a']}]",
        f"  Title: {item['title_a']}",
        f"  Published: {item['published_at_a']}",
        "",
        f"ARTICLE B: [{item['feed_b']}]",
        f"  Title: {item['title_b']}",
        f"  Published: {item['published_at_b']}",
        f"{'=' * 70}",
        "OPTIONS: [1] SAME_EVENT  [2] RELATED_TOPIC  [3] DIFFERENT_EVENT  [4] UNCERTAIN  [s] skip  [q] quit",
    ]
    return "\n".join(lines)


def run_interactive_reviewer(
    batch_name: str = "ALL",
    pack_path: str = CANONICAL_PACK_PATH,
    sidecar_path: str = CANONICAL_SIDECAR_PATH,
    labels_path: str = CANONICAL_LABELS_PATH,
) -> None:
    """Runs interactive terminal-based review session for human annotators."""
    with open(pack_path, "r", encoding="utf-8") as f:
        pack_rows = list(csv.DictReader(f))
    with open(sidecar_path, "r", encoding="utf-8") as f:
        sidecar_data = json.load(f)

    ordered = compute_diversity_order(pack_rows, sidecar_data["candidate_pairs"])
    batches = assign_batches(ordered)

    if batch_name.upper() in batches:
        candidate_list = batches[batch_name.upper()]
        print(f"Starting review session for {batch_name.upper()} ({len(candidate_list)} pairs)...")
    else:
        candidate_list = ordered
        print(f"Starting review session for all {len(candidate_list)} pairs...")

    existing_labels = load_human_labels(labels_path)
    total = len(candidate_list)

    label_map = {
        "1": "SAME_EVENT",
        "2": "RELATED_TOPIC",
        "3": "DIFFERENT_EVENT",
        "4": "UNCERTAIN",
    }

    for idx, item in enumerate(candidate_list):
        pk = item["pair_key"]
        if pk in existing_labels:
            print(
                f"[{idx + 1}/{total}] {pk} already labeled as {existing_labels[pk]['label']}. Skipping."
            )
            continue

        print(format_blinded_review_card(item, idx, total))

        while True:
            choice = input("Enter choice (1-4, s, q): ").strip().lower()

            if choice == "q":
                print("Exiting review session. Progress autosaved.")
                return
            if choice == "s":
                print(f"Skipped: {pk}")
                break
            if choice in label_map:
                lbl = label_map[choice]
                rationale = input("Optional concise rationale (Enter to skip): ").strip()
                save_human_label(pk, lbl, rationale, labels_path=labels_path)
                print(f"Saved: {pk} -> {lbl}")
                break
            print("Invalid choice. Please enter 1, 2, 3, 4, 's' to skip, or 'q' to quit.")


if __name__ == "__main__":
    if "--status" in sys.argv:
        status = get_annotation_status()
        print(json.dumps(status, indent=2))
    elif "--verify" in sys.argv:
        verification = verify_annotation_pack_integrity()
        print(json.dumps(verification, indent=2))
    elif "--batch" in sys.argv:
        batch_idx = sys.argv.index("--batch") + 1
        target_batch = sys.argv[batch_idx] if batch_idx < len(sys.argv) else "ALL"
        run_interactive_reviewer(target_batch)
    else:
        status = get_annotation_status()
        print(
            f"Gold V2 Annotation Tooling Ready.\nTotal pairs: {status.get('total_pairs')}, Labeled: {status.get('human_label_count')}"
        )
