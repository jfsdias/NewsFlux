from __future__ import annotations

import re
import unittest
from pathlib import Path

from provenance import SourceProvenanceError, validate_source_provenance


BASE = "654b9d30ee0f43b05edab07f5ed8c9ac188625c0"
CANDIDATE = "a" * 40


class SourceProvenanceTests(unittest.TestCase):
    def test_reverse_proxy_reference_is_pinned_to_an_immutable_digest(self) -> None:
        source = Path(__file__).with_name("run.py").read_text(encoding="utf-8")
        match = re.search(r'^PROXY_IMAGE = "([^"]+)"$', source, re.MULTILINE)

        self.assertIsNotNone(match)
        self.assertRegex(
            match.group(1),
            r"^nginx:1\.27-alpine@sha256:[0-9a-f]{64}$",
        )

    def test_pull_request_uses_exact_base_and_merge_candidate(self) -> None:
        result = validate_source_provenance(
            event_name="pull_request",
            expected_base_sha=BASE,
            candidate_sha=CANDIDATE,
            live_main_sha=BASE,
            checkout_sha=CANDIDATE,
            candidate_is_based_on_base=True,
        )

        self.assertEqual(result, {"base_sha": BASE, "candidate_sha": CANDIDATE})

    def test_rejects_main_that_moved_after_pull_request_event(self) -> None:
        with self.assertRaisesRegex(SourceProvenanceError, "base branch moved"):
            validate_source_provenance(
                event_name="pull_request",
                expected_base_sha=BASE,
                candidate_sha=CANDIDATE,
                live_main_sha="b" * 40,
                checkout_sha=CANDIDATE,
                candidate_is_based_on_base=True,
            )

    def test_rejects_checkout_that_is_not_merge_candidate(self) -> None:
        with self.assertRaisesRegex(SourceProvenanceError, "checkout does not match"):
            validate_source_provenance(
                event_name="pull_request",
                expected_base_sha=BASE,
                candidate_sha=CANDIDATE,
                live_main_sha=BASE,
                checkout_sha="c" * 40,
                candidate_is_based_on_base=True,
            )

    def test_rejects_candidate_without_expected_base_ancestry(self) -> None:
        with self.assertRaisesRegex(SourceProvenanceError, "not based on expected base"):
            validate_source_provenance(
                event_name="pull_request",
                expected_base_sha=BASE,
                candidate_sha=CANDIDATE,
                live_main_sha=BASE,
                checkout_sha=CANDIDATE,
                candidate_is_based_on_base=False,
            )

    def test_dispatch_requires_immutable_run_sha_to_remain_live_main(self) -> None:
        validate_source_provenance(
            event_name="workflow_dispatch",
            expected_base_sha=BASE,
            candidate_sha=BASE,
            live_main_sha=BASE,
            checkout_sha=BASE,
            candidate_is_based_on_base=True,
        )

        with self.assertRaisesRegex(SourceProvenanceError, "dispatch SHA is not current main"):
            validate_source_provenance(
                event_name="workflow_dispatch",
                expected_base_sha=BASE,
                candidate_sha=CANDIDATE,
                live_main_sha=BASE,
                checkout_sha=CANDIDATE,
                candidate_is_based_on_base=True,
            )

    def test_rejects_unknown_event_or_malformed_shas(self) -> None:
        with self.assertRaisesRegex(SourceProvenanceError, "unsupported event"):
            validate_source_provenance(
                event_name="push",
                expected_base_sha=BASE,
                candidate_sha=BASE,
                live_main_sha=BASE,
                checkout_sha=BASE,
                candidate_is_based_on_base=True,
            )

        with self.assertRaisesRegex(SourceProvenanceError, "invalid SHA"):
            validate_source_provenance(
                event_name="pull_request",
                expected_base_sha="main",
                candidate_sha=CANDIDATE,
                live_main_sha=BASE,
                checkout_sha=CANDIDATE,
                candidate_is_based_on_base=True,
            )


if __name__ == "__main__":
    unittest.main()
