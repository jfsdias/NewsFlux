from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

CONTRACTS_DIR = Path(__file__).with_name("contracts")


@lru_cache(maxsize=1)
def _load_schema(name: str) -> dict[str, Any]:
    document = json.loads((CONTRACTS_DIR / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(document)
    return document


def validate_request(document: object) -> dict[str, Any]:
    schema = _load_schema("summary-request.schema.json")
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)
    return document


def validate_summary(document: object, *, allowed_paragraph_ids: set[str]) -> dict[str, Any]:
    schema = _load_schema("summary-response.schema.json")
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)
    if not isinstance(document, dict):
        raise ValidationError("summary response must be an object")
    status = document["status"]
    content_scope = document["content_scope"]
    summary = document["summary"]
    summary_ids = document["summary_paragraph_ids"]
    if status == "complete" and content_scope != "full":
        raise ValidationError("complete summary requires a verified full-content scope")
    if status in {"insufficient", "unavailable"}:
        if summary or summary_ids or document["key_points"] or document["action_points"]:
            raise ValidationError("insufficient or unavailable summaries cannot contain generated content")
    elif not summary or not summary_ids:
        raise ValidationError("generated summaries require supported paragraph references")

    references = list(summary_ids)
    for item in document["key_points"] + document["action_points"]:
        references.extend(item["paragraph_ids"])
    if not set(references).issubset(allowed_paragraph_ids):
        raise ValidationError("summary references a paragraph outside the request snapshot")
    return document


def validate_error(document: object) -> dict[str, Any]:
    schema = _load_schema("summary-error.schema.json")
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)
    return document
