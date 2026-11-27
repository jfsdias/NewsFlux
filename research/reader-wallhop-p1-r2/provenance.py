from __future__ import annotations

import re


_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


class SourceProvenanceError(ValueError):
    """Raised when the source checkout does not match its immutable trigger."""


def validate_source_provenance(
    *,
    event_name: str,
    expected_base_sha: str,
    candidate_sha: str,
    live_main_sha: str,
    checkout_sha: str,
    candidate_is_based_on_base: bool,
) -> dict[str, str]:
    shas = {
        "base": expected_base_sha,
        "candidate": candidate_sha,
        "live main": live_main_sha,
        "checkout": checkout_sha,
    }
    if any(not isinstance(value, str) or not _SHA_PATTERN.fullmatch(value) for value in shas.values()):
        raise SourceProvenanceError("invalid SHA in source provenance")

    if event_name not in {"pull_request", "workflow_dispatch"}:
        raise SourceProvenanceError("unsupported event for exact source validation")

    if checkout_sha != candidate_sha:
        raise SourceProvenanceError("source checkout does not match immutable candidate SHA")

    if event_name == "pull_request":
        if live_main_sha != expected_base_sha:
            raise SourceProvenanceError("live main changed; pull request base branch moved")
        if not candidate_is_based_on_base:
            raise SourceProvenanceError("candidate is not based on expected base SHA")
    else:
        if live_main_sha != expected_base_sha:
            raise SourceProvenanceError("dispatched base is no longer current main")
        if not candidate_is_based_on_base:
            raise SourceProvenanceError("candidate is not based on expected base SHA")

    return {"base_sha": expected_base_sha, "candidate_sha": candidate_sha}
