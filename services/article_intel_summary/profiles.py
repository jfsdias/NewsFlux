"""Versioned, server-owned summary profiles.

The browser selects only closed identifiers. This module translates a validated
selection into fixed instruction fragments; no client text ever reaches the
model instructions.
"""

from __future__ import annotations

from dataclasses import dataclass

PROFILE_VERSION = "summary-profile-v1"

LENGTHS = ("brief", "standard", "detailed")
FOCUSES = (
    "factual_synthesis",
    "key_points",
    "facts_figures",
    "context_implications",
    "actions_next_steps",
    "limitations_open_questions",
)
SECTIONS = ("summary", "key_points", "facts", "implications", "actions", "limitations")
LANGUAGES = ("pt-BR", "original")

# Output fields produced by the model for each section. "summary" maps to the
# two summary fields and is mandatory.
SECTION_OUTPUT_FIELDS = {
    "key_points": "key_points",
    "facts": "facts",
    "implications": "implications",
    "actions": "action_points",
    "limitations": "open_questions",
}
V2_OUTPUT_FIELDS = ("summary", "summary_paragraph_ids", *SECTION_OUTPUT_FIELDS.values())

DEFAULT_PROFILE = {
    "version": PROFILE_VERSION,
    "length": "standard",
    "focus": ["factual_synthesis", "key_points", "limitations_open_questions"],
    "sections": ["summary", "key_points", "limitations"],
    "language": "pt-BR",
}

_LENGTH_RULES = {
    "brief": ("Write a brief summary of at most 600 characters.", 600, 3),
    "standard": ("Write a summary of at most 1500 characters.", 1500, 5),
    "detailed": ("Write a detailed summary of at most 3000 characters.", 3000, 6),
}
_FOCUS_TEXT = {
    "factual_synthesis": "Prioritize a factual synthesis of what happened.",
    "key_points": "Prioritize the most important pieces of information.",
    "facts_figures": "Prioritize objective facts and numbers that the article states explicitly.",
    "context_implications": "Explain context and implications only where the article itself supports them.",
    "actions_next_steps": "Report actions and next steps only when the article mentions them.",
    "limitations_open_questions": "Note what the article does not allow the reader to conclude.",
}
_SECTION_TEXT = {
    "key_points": "key_points: the main points of the article.",
    "facts": "facts: objective facts and numbers stated in the article; never compute or estimate numbers.",
    "implications": "implications: consequences or context explicitly supported by the article.",
    "action_points": "action_points: actions or next steps mentioned in the article.",
    "open_questions": "open_questions: questions the article leaves open or limits on what it supports.",
}
_LANGUAGE_TEXT = {
    "pt-BR": "Write every generated text in Brazilian Portuguese (pt-BR).",
    "original": (
        "Write every generated text in the article's own language when it is identifiable with confidence; "
        "otherwise write in Brazilian Portuguese (pt-BR)."
    ),
}


class ProfileInvalid(ValueError):
    """A summary profile is outside the versioned server contract."""


@dataclass(frozen=True)
class SummaryProfile:
    length: str
    focus: tuple[str, ...]
    sections: tuple[str, ...]
    language: str
    version: str = PROFILE_VERSION

    @property
    def summary_max_chars(self) -> int:
        return _LENGTH_RULES[self.length][1]

    @property
    def max_points(self) -> int:
        return _LENGTH_RULES[self.length][2]

    @property
    def requested_output_fields(self) -> tuple[str, ...]:
        return tuple(SECTION_OUTPUT_FIELDS[section] for section in self.sections if section != "summary")

    def to_document(self) -> dict[str, object]:
        return {
            "version": self.version,
            "length": self.length,
            "focus": list(self.focus),
            "sections": list(self.sections),
            "language": self.language,
        }


def parse_profile(document: object) -> SummaryProfile:
    if not isinstance(document, dict) or set(document) != {"version", "length", "focus", "sections", "language"}:
        raise ProfileInvalid("profile shape")
    if document["version"] != PROFILE_VERSION:
        raise ProfileInvalid("profile version")
    length = document["length"]
    language = document["language"]
    focus = document["focus"]
    sections = document["sections"]
    if length not in LENGTHS or language not in LANGUAGES:
        raise ProfileInvalid("profile option")
    if not isinstance(focus, list) or not 1 <= len(focus) <= len(FOCUSES) or len(set(focus)) != len(focus):
        raise ProfileInvalid("profile focus")
    if not isinstance(sections, list) or not 1 <= len(sections) <= len(SECTIONS) or len(set(sections)) != len(sections):
        raise ProfileInvalid("profile sections")
    if any(item not in FOCUSES for item in focus) or any(item not in SECTIONS for item in sections):
        raise ProfileInvalid("profile option")
    if "summary" not in sections:
        raise ProfileInvalid("summary section is mandatory")
    # Canonical order keeps fingerprints and prompts deterministic.
    return SummaryProfile(
        length=length,
        focus=tuple(item for item in FOCUSES if item in focus),
        sections=tuple(item for item in SECTIONS if item in sections),
        language=language,
    )


def profile_instructions(profile: SummaryProfile) -> str:
    if not isinstance(profile, SummaryProfile):
        raise ProfileInvalid("profile type")
    # Re-validate so a hand-built dataclass cannot inject unknown identifiers.
    parse_profile(profile.to_document())
    requested = profile.requested_output_fields
    parts = [
        _LENGTH_RULES[profile.length][0],
        *(_FOCUS_TEXT[item] for item in profile.focus),
        _LANGUAGE_TEXT[profile.language],
        (
            "Return one JSON object with exactly these fields: "
            + ", ".join(V2_OUTPUT_FIELDS)
            + ". summary is a non-empty string and summary_paragraph_ids lists 1 to 32 unique supplied paragraph IDs."
        ),
        (
            "Every other field is an array of objects with exactly text (1 to 1000 characters) and "
            f"paragraph_ids (1 to 8 unique supplied IDs); use at most {profile.max_points} objects per field."
        ),
    ]
    if requested:
        parts.append("Fill only these requested fields: " + " ".join(_SECTION_TEXT[field] for field in requested))
    not_requested = [field for field in V2_OUTPUT_FIELDS[2:] if field not in requested]
    if not_requested:
        parts.append("Return an empty array for: " + ", ".join(not_requested) + ".")
    parts.append(
        "If the article does not support a requested field, return an empty array for it. "
        "Never invent actions, numbers, implications, or facts that are not in the supplied paragraphs."
    )
    return " ".join(parts)
