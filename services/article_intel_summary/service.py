from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass

from jsonschema.exceptions import ValidationError

from services.article_intel_auth.auth import AuthorizedEntry
from services.article_intel_summary.content import ContentSnapshotResolver, ResolvedContentSnapshot
from services.article_intel_summary.contracts import validate_summary, validate_summary_v2, validate_summary_v3
from services.article_intel_summary.profiles import PROFILE_VERSION, V2_OUTPUT_FIELDS, SummaryProfile
from services.article_intel_summary.inference import (
    DEFAULT_INFERENCE_TIMEOUT_SECONDS,
    PROMPT_VERSION,
    InferenceAdapter,
    InferenceResult,
    InferenceUnavailable,
    build_model_input,
)


class ModelOutputInvalid(ValueError):
    """A model output failed local schema or paragraph-grounding validation."""


_logger = logging.getLogger(__name__)

MAX_MODEL_OUTPUT_BYTES = 64 * 1024
MAX_MODEL_OUTPUT_DEPTH = 16
MAX_MODEL_OUTPUT_NODES = 4096


@dataclass(frozen=True)
class SummaryOutcome:
    payload: dict[str, object]
    http_status: int


class SummaryService:
    def __init__(
        self,
        adapter: InferenceAdapter,
        *,
        resolver: ContentSnapshotResolver | None = None,
        timeout_seconds: float = DEFAULT_INFERENCE_TIMEOUT_SECONDS,
        router=None,
    ) -> None:
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)) or not 0 < timeout_seconds <= 30:
            raise ValueError("summary inference timeout must be between 0 and 30 seconds")
        self.adapter = adapter
        self.resolver = resolver or ContentSnapshotResolver()
        self.timeout_seconds = float(timeout_seconds)
        self.router = router

    def summarize(self, entry: AuthorizedEntry, *, request_id: str, deadline=None, revalidation_reserve_seconds=0) -> SummaryOutcome:
        snapshot = self.resolver.resolve(entry)
        if not snapshot.is_sufficient:
            payload = self._base_payload(
                snapshot,
                request_id=request_id,
                status="insufficient",
                summary="",
                summary_paragraph_ids=[],
                key_points=[],
                action_points=[],
                limitations=["The authorized Miniflux content is too short, incomplete, or structurally unsuitable for a safe summary."],
                provider_id=None,
                deployment_id=None,
                effective_model_id=None,
                prompt_version=None,
            )
            validate_summary(payload, allowed_paragraph_ids={paragraph.id for paragraph in snapshot.paragraphs})
            return SummaryOutcome(
                payload=payload,
                http_status=422,
            )

        model_input = build_model_input(snapshot)
        if deadline is not None:
            deadline.begin_inference(self.timeout_seconds, reserve_seconds=revalidation_reserve_seconds)
        try:
            from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter, S5MistralFallbackAdapter

            if isinstance(self.adapter, (LiteLLMInferenceAdapter, S5MistralFallbackAdapter)):
                inference = self.adapter.summarize(model_input, timeout_seconds=self.timeout_seconds, deadline=deadline)
            else:
                inference = self.adapter.summarize(model_input, timeout_seconds=self.timeout_seconds)
        except (InferenceUnavailable, TimeoutError):
            return self._unavailable(snapshot, request_id)
        except Exception:
            # Adapter errors may carry credentials or provider payloads. Keep them inside
            # the boundary and return no exception text, article content, or trace details.
            return self._unavailable(snapshot, request_id)
        finally:
            if deadline is not None:
                deadline.end_inference()

        if not isinstance(inference, InferenceResult):
            _invalid_output("MODEL_OUTPUT_VALIDATION_UNKNOWN")
        if not isinstance(inference.output, dict):
            _invalid_output("MODEL_OUTPUT_INVALID_FIELD_TYPE")
        try:
            _ensure_bounded_json(inference.output)
        except ModelOutputInvalid:
            _invalid_output("MODEL_OUTPUT_LENGTH_EXCEEDED")
        provider_id = _safe_metadata(inference.provider_id)
        deployment_id = _safe_metadata(inference.deployment_id, optional=True)
        model_id = _safe_metadata(inference.effective_model_id, optional=True)
        prompt_version = _safe_metadata(inference.prompt_version)
        if provider_id is None or prompt_version is None:
            _invalid_output("MODEL_OUTPUT_VALIDATION_UNKNOWN")

        output = inference.output
        expected_fields = {"summary", "summary_paragraph_ids", "key_points", "action_points"}
        if set(output) != expected_fields:
            _invalid_output("MODEL_OUTPUT_MISSING_FIELD" if expected_fields - set(output) else "MODEL_OUTPUT_EXTRA_FIELD")
        if isinstance(output["summary"], str) and not output["summary"].strip():
            _invalid_output("MODEL_OUTPUT_LENGTH_EXCEEDED")
        payload = self._base_payload(
            snapshot,
            request_id=request_id,
            status="partial",
            summary=output.get("summary"),
            summary_paragraph_ids=output.get("summary_paragraph_ids"),
            key_points=output.get("key_points"),
            action_points=output.get("action_points"),
            limitations=[
                "Miniflux does not establish whether its article content is complete; this summary may omit source material."
            ],
            provider_id=provider_id,
            deployment_id=deployment_id,
            effective_model_id=model_id,
            prompt_version=prompt_version,
        )
        try:
            _ensure_bounded_json(payload)
        except ModelOutputInvalid:
            _invalid_output("MODEL_OUTPUT_LENGTH_EXCEEDED")
        try:
            validate_summary(payload, allowed_paragraph_ids={paragraph.id for paragraph in snapshot.paragraphs})
        except ValidationError as error:
            _invalid_output(_validation_code(error))
        return SummaryOutcome(payload=payload, http_status=200)

    def summarize_v2(
        self,
        entry: AuthorizedEntry,
        *,
        request_id: str,
        model_id: str,
        profile: SummaryProfile,
        deadline=None,
        revalidation_reserve_seconds=0,
    ) -> SummaryOutcome:
        """Summarize with one explicitly selected catalog model; never substitutes another model."""
        from services.article_intel_summary.catalog import ModelNotAvailable

        if self.router is None:
            raise ModelNotAvailable("MODEL_NOT_AVAILABLE")
        # Raises before any content is resolved or sent when the model is not authorized.
        adapter = self.router.adapter_for(model_id)
        snapshot = self.resolver.resolve(entry)
        allowed = {paragraph.id for paragraph in snapshot.paragraphs}
        if not snapshot.is_sufficient:
            payload = self._v2_payload(
                snapshot, request_id=request_id, status="insufficient", model_id=model_id, profile=profile,
                output=None, limitations=["The authorized Miniflux content is too short, incomplete, or structurally unsuitable for a safe summary."],
                provider_id=None, effective_model_id=None, prompt_version=None,
            )
            validate_summary_v2(payload, allowed_paragraph_ids=allowed)
            return SummaryOutcome(payload=payload, http_status=422)

        model_input = build_model_input(snapshot, profile)
        if deadline is not None:
            deadline.begin_inference(self.timeout_seconds, reserve_seconds=revalidation_reserve_seconds)
        try:
            # Exactly one adapter call: the selected model. No secondary model is attempted.
            if hasattr(adapter, "settings"):
                inference = adapter.summarize(model_input, timeout_seconds=self.timeout_seconds, deadline=deadline)
            else:
                inference = adapter.summarize(model_input, timeout_seconds=self.timeout_seconds)
        except Exception:
            payload = self._v2_payload(
                snapshot, request_id=request_id, status="unavailable", model_id=model_id, profile=profile,
                output=None, limitations=["No model result is available; no summary was generated."],
                provider_id=None, effective_model_id=None, prompt_version=None,
            )
            validate_summary_v2(payload, allowed_paragraph_ids=allowed)
            return SummaryOutcome(payload=payload, http_status=503)
        finally:
            if deadline is not None:
                deadline.end_inference()

        if not isinstance(inference, InferenceResult) or not isinstance(inference.output, dict):
            _invalid_output("MODEL_OUTPUT_INVALID_FIELD_TYPE")
        try:
            _ensure_bounded_json(inference.output)
        except ModelOutputInvalid:
            _invalid_output("MODEL_OUTPUT_LENGTH_EXCEEDED")
        output = inference.output
        if set(output) != set(V2_OUTPUT_FIELDS):
            _invalid_output("MODEL_OUTPUT_MISSING_FIELD" if set(V2_OUTPUT_FIELDS) - set(output) else "MODEL_OUTPUT_EXTRA_FIELD")
        provider_id = _safe_metadata(inference.provider_id)
        effective_model_id = _safe_metadata(inference.effective_model_id, optional=True)
        prompt_version = _safe_metadata(inference.prompt_version)
        if provider_id is None or prompt_version is None:
            _invalid_output("MODEL_OUTPUT_VALIDATION_UNKNOWN")
        payload = self._v2_payload(
            snapshot, request_id=request_id, status="partial", model_id=model_id, profile=profile, output=output,
            limitations=["Miniflux does not establish whether its article content is complete; this summary may omit source material."],
            provider_id=provider_id, effective_model_id=effective_model_id, prompt_version=prompt_version,
        )
        try:
            validate_summary_v2(
                payload,
                allowed_paragraph_ids=allowed,
                requested_fields=profile.requested_output_fields,
                summary_max_chars=profile.summary_max_chars,
                max_points=profile.max_points,
            )
        except ValidationError as error:
            _invalid_output(_validation_code(error))
        return SummaryOutcome(payload=payload, http_status=200)

    # ---------------------------------------------------------------------------------------------
    # v3: primary + optional fallback, at most one secondary attempt
    # ---------------------------------------------------------------------------------------------

    PRIMARY_SHARE_WITH_FALLBACK = 0.65
    MIN_FALLBACK_SECONDS = 1.0

    def summarize_v3(
        self,
        entry: AuthorizedEntry,
        *,
        request_id: str,
        primary_model_id: str,
        fallback_model_id: str | None,
        consent_paid: bool,
        consent_cross_provider: bool,
        profile: SummaryProfile,
        deadline=None,
        revalidation_reserve_seconds=0,
        revalidate=None,
    ) -> SummaryOutcome:
        """Primary model, then at most ONE fallback attempt, only after a transient primary failure.

        Never falls back on authentication/authorization, budget, policy, invalid output, stale
        session, cancellation or deadline. The fallback is revalidated against the current catalog
        and the caller's explicit consent (paid / cross-provider) at the moment of the attempt, and
        the session/content is revalidated (``revalidate``) before it. Both attempts use the same
        budget ledger through their adapters; nothing is retried silently.
        """
        import time

        from services.article_intel_summary.catalog import ModelNotAvailable
        from services.article_intel_summary.litellm_adapter import TransientLiteLLMFailure

        if self.router is None:
            raise ModelNotAvailable("MODEL_NOT_AVAILABLE")
        primary = self.router.adapter_for(primary_model_id)  # refuses before any content access
        # Provider identities as verified when the request started; the fallback decision demands
        # the very same identities at the attempt (drift fails closed).
        identities = tuple(
            getattr(self.router.entry_for(model_id), "provider_identity", None) if model_id else None
            for model_id in (primary_model_id, fallback_model_id)
        )
        snapshot = self.resolver.resolve(entry)
        allowed = {paragraph.id for paragraph in snapshot.paragraphs}
        trace = {
            "primary": primary_model_id,
            "fallback": fallback_model_id,
            "effective": None,
            "alias": None,
            "used": False,
            "reason": None,
            "outcome": "NOT_NEEDED",
            "attempts": 0,
            "pricing": None,
        }
        if not snapshot.is_sufficient:
            payload = self._v3_payload(
                snapshot, request_id=request_id, status="insufficient", profile=profile, output=None,
                limitations=["The authorized Miniflux content is too short, incomplete, or structurally unsuitable for a safe summary."],
                provider_id=None, prompt_version=None, trace=trace,
            )
            validate_summary_v3(payload, allowed_paragraph_ids=allowed)
            return SummaryOutcome(payload=payload, http_status=422)

        model_input = build_model_input(snapshot, profile)
        started = time.monotonic()
        primary_timeout = self.timeout_seconds * (self.PRIMARY_SHARE_WITH_FALLBACK if fallback_model_id else 1.0)
        if deadline is not None:
            deadline.begin_inference(self.timeout_seconds, reserve_seconds=revalidation_reserve_seconds)
        inference = None
        try:
            trace["attempts"] = 1
            primary_failure = None
            try:
                inference = self._call(primary, model_input, primary_timeout, deadline)
                trace["effective"] = primary_model_id
            except TransientLiteLLMFailure as failure:
                primary_failure = failure
            except Exception:  # noqa: BLE001 - non-transient primary failure: never eligible
                trace["outcome"] = "NOT_ELIGIBLE" if fallback_model_id else "NOT_CONFIGURED"
            if primary_failure is not None:
                # Outside any exception handler: a stale session/content raised by `revalidate`
                # must abort the request, never be mistaken for a model failure.
                trace["reason"] = f"PRIMARY_{primary_failure.kind}"
                decide = lambda: self._fallback_decision(  # noqa: E731
                    trace, primary_model_id, fallback_model_id, consent_paid, consent_cross_provider, started,
                    deadline, identities,
                )
                fallback = decide()
                if fallback is not None and revalidate is not None:
                    revalidate(snapshot.content_fingerprint)
                    # Model, price, consent and provider identity again, immediately before the attempt.
                    fallback = decide()
                if fallback is not None:
                    remaining = self.timeout_seconds - (time.monotonic() - started)
                    if deadline is not None:
                        remaining = min(remaining, deadline.remaining())
                    trace["attempts"] = 2
                    try:
                        inference = self._call(fallback, model_input, remaining, deadline)
                        trace["effective"], trace["used"], trace["outcome"] = fallback_model_id, True, "USED"
                    except Exception:  # noqa: BLE001 - the fallback result is final, no third attempt
                        trace["outcome"] = "FAILED"
        finally:
            if deadline is not None:
                deadline.end_inference()

        if inference is None:
            payload = self._v3_payload(
                snapshot, request_id=request_id, status="unavailable", profile=profile, output=None,
                limitations=["No model result is available; no summary was generated."],
                provider_id=None, prompt_version=None, trace=trace,
            )
            validate_summary_v3(payload, allowed_paragraph_ids=allowed)
            return SummaryOutcome(payload=payload, http_status=503)

        if not isinstance(inference, InferenceResult) or not isinstance(inference.output, dict):
            _invalid_output("MODEL_OUTPUT_INVALID_FIELD_TYPE")
        try:
            _ensure_bounded_json(inference.output)
        except ModelOutputInvalid:
            _invalid_output("MODEL_OUTPUT_LENGTH_EXCEEDED")
        output = inference.output
        if set(output) != set(V2_OUTPUT_FIELDS):
            _invalid_output("MODEL_OUTPUT_MISSING_FIELD" if set(V2_OUTPUT_FIELDS) - set(output) else "MODEL_OUTPUT_EXTRA_FIELD")
        provider_id = _safe_metadata(inference.provider_id)
        trace["alias"] = _safe_metadata(inference.effective_model_id, optional=True)
        prompt_version = _safe_metadata(inference.prompt_version)
        if provider_id is None or prompt_version is None:
            _invalid_output("MODEL_OUTPUT_VALIDATION_UNKNOWN")
        effective_entry = self.router.entry_for(trace["effective"])
        trace["pricing"] = (
            "paid" if effective_entry is not None and effective_entry.to_document()["requires_paid_authorization"] else "free"
        )
        payload = self._v3_payload(
            snapshot, request_id=request_id, status="partial", profile=profile, output=output,
            limitations=["Miniflux does not establish whether its article content is complete; this summary may omit source material."],
            provider_id=provider_id, prompt_version=prompt_version, trace=trace,
        )
        try:
            validate_summary_v3(
                payload,
                allowed_paragraph_ids=allowed,
                requested_fields=profile.requested_output_fields,
                summary_max_chars=profile.summary_max_chars,
                max_points=profile.max_points,
            )
        except ValidationError as error:
            _invalid_output(_validation_code(error))
        return SummaryOutcome(payload=payload, http_status=200)

    @staticmethod
    def _call(adapter, model_input, timeout_seconds, deadline):
        if hasattr(adapter, "settings"):
            return adapter.summarize(model_input, timeout_seconds=timeout_seconds, deadline=deadline)
        return adapter.summarize(model_input, timeout_seconds=timeout_seconds)

    def _fallback_decision(self, trace, primary_id, fallback_id, consent_paid, consent_cross, started, deadline, identities):
        """Return the fallback adapter, or None with trace['outcome'] explaining why.

        Everything is read from ONE current catalog state at the moment of the attempt. A paid
        fallback always needs the caller's paid consent (SEC-249-01), whatever the primary costs.
        Providers are compared by their gateway-verified identity, never by display label
        (SEC-249-02); an unknown identity, or one that changed since the request started, fails
        closed even with consent.
        """
        import time

        from services.article_intel_summary.catalog import ModelNotAvailable

        if not fallback_id:
            trace["outcome"] = "NOT_CONFIGURED"
            return None
        remaining = self.timeout_seconds - (time.monotonic() - started)
        if deadline is not None:
            try:
                remaining = min(remaining, deadline.remaining())
            except Exception:  # noqa: BLE001 - deadline reached or cancelled
                remaining = 0
        if remaining < self.MIN_FALLBACK_SECONDS:
            trace["outcome"] = "DEADLINE"
            return None
        try:
            # current catalog: approved, discovered, priced, authorized
            primary_entry, fallback_entry, adapter = self.router.fallback_view(primary_id, fallback_id)
        except ModelNotAvailable:
            trace["outcome"] = "NOT_AVAILABLE"
            return None
        if fallback_entry.to_document()["requires_paid_authorization"] and not consent_paid:
            trace["outcome"] = "PAID_NOT_CONSENTED"
            return None
        primary_identity = getattr(primary_entry, "provider_identity", None)
        fallback_identity = getattr(fallback_entry, "provider_identity", None)
        if (
            primary_identity is None
            or fallback_identity is None
            or (primary_identity, fallback_identity) != identities
        ):
            trace["outcome"] = "PROVIDER_UNVERIFIED"
            return None
        if fallback_identity != primary_identity and not consent_cross:
            trace["outcome"] = "CROSS_PROVIDER_NOT_CONSENTED"
            return None
        return adapter

    @staticmethod
    def _v3_payload(snapshot, *, request_id, status, profile, output, limitations, provider_id, prompt_version, trace):
        output = output or {}
        return {
            "schema_version": "3",
            "request_id": request_id,
            "entry_id": snapshot.entry_id,
            "status": status,
            "content_scope": snapshot.content_scope,
            "summary": output.get("summary", ""),
            "summary_paragraph_ids": output.get("summary_paragraph_ids", []),
            "key_points": output.get("key_points", []),
            "facts": output.get("facts", []),
            "implications": output.get("implications", []),
            "action_points": output.get("action_points", []),
            "open_questions": output.get("open_questions", []),
            "limitations": limitations,
            "profile": profile.to_document(),
            "provenance": {
                "content_origin": "ORIGINAL_MINIFLUX",
                "content_fingerprint": snapshot.content_fingerprint,
                "provider_id": provider_id,
                "requested_model_id": trace["primary"],
                "primary_model_id": trace["primary"],
                "fallback_model_id": trace["fallback"],
                "effective_model_id": trace["effective"] if status == "partial" else None,
                "effective_model_alias": trace["alias"] if status == "partial" else None,
                "fallback_used": bool(trace["used"]) and status == "partial",
                "fallback_reason": trace["reason"],
                "fallback_outcome": trace["outcome"],
                "attempts": trace["attempts"],
                "pricing_class": trace["pricing"] if status == "partial" else None,
                "prompt_version": prompt_version,
                "profile_version": PROFILE_VERSION,
            },
        }

    @staticmethod
    def _v2_payload(
        snapshot: ResolvedContentSnapshot,
        *,
        request_id: str,
        status: str,
        model_id: str,
        profile: SummaryProfile,
        output: dict | None,
        limitations: list[str],
        provider_id: str | None,
        effective_model_id: str | None,
        prompt_version: str | None,
    ) -> dict[str, object]:
        output = output or {}
        return {
            "schema_version": "2",
            "request_id": request_id,
            "entry_id": snapshot.entry_id,
            "status": status,
            "content_scope": snapshot.content_scope,
            "summary": output.get("summary", ""),
            "summary_paragraph_ids": output.get("summary_paragraph_ids", []),
            "key_points": output.get("key_points", []),
            "facts": output.get("facts", []),
            "implications": output.get("implications", []),
            "action_points": output.get("action_points", []),
            "open_questions": output.get("open_questions", []),
            "limitations": limitations,
            "profile": profile.to_document(),
            "provenance": {
                # The summary backend only reads its own authorized Miniflux snapshot.
                "content_origin": "ORIGINAL_MINIFLUX",
                "content_fingerprint": snapshot.content_fingerprint,
                "provider_id": provider_id,
                "model_id": model_id,
                "effective_model_id": effective_model_id,
                "prompt_version": prompt_version,
                "profile_version": PROFILE_VERSION,
                "fallback_used": False,
            },
        }

    def _unavailable(self, snapshot: ResolvedContentSnapshot, request_id: str) -> SummaryOutcome:
        payload = self._base_payload(
            snapshot,
            request_id=request_id,
            status="unavailable",
            summary="",
            summary_paragraph_ids=[],
            key_points=[],
            action_points=[],
            limitations=["No model result is available; no summary was generated."],
            provider_id=None,
            deployment_id=None,
            effective_model_id=None,
            prompt_version=PROMPT_VERSION,
        )
        validate_summary(payload, allowed_paragraph_ids={paragraph.id for paragraph in snapshot.paragraphs})
        return SummaryOutcome(payload=payload, http_status=503)

    @staticmethod
    def _base_payload(
        snapshot: ResolvedContentSnapshot,
        *,
        request_id: str,
        status: str,
        summary: object,
        summary_paragraph_ids: object,
        key_points: object,
        action_points: object,
        limitations: list[str],
        provider_id: str | None,
        deployment_id: str | None,
        effective_model_id: str | None,
        prompt_version: str | None,
    ) -> dict[str, object]:
        return {
            "schema_version": "1",
            "request_id": request_id,
            "entry_id": snapshot.entry_id,
            "status": status,
            "content_scope": snapshot.content_scope,
            "summary": summary,
            "summary_paragraph_ids": summary_paragraph_ids,
            "key_points": key_points,
            "action_points": action_points,
            "limitations": limitations,
            "provenance": {
                "content_origin": snapshot.content_origin,
                "content_fingerprint": snapshot.content_fingerprint,
                "provider_id": provider_id,
                "deployment_id": deployment_id,
                "effective_model_id": effective_model_id,
                "prompt_version": prompt_version,
            },
        }



def _invalid_output(code: str) -> None:
    # Only fixed classifications are logged; never log the exception, value, or path.
    _logger.warning(code)
    raise ModelOutputInvalid(code) from None


def _validation_code(error: ValidationError) -> str:
    path = tuple(error.absolute_path)
    root = path[0] if path else None
    if error.validator == "uniqueItems":
        return "MODEL_OUTPUT_DUPLICATE_REFERENCE"
    if not path and error.validator not in {"type", "required", "additionalProperties"}:
        return "MODEL_OUTPUT_INVALID_PARAGRAPH_REFERENCE"
    if root == "key_points" and error.validator == "maxItems" and len(path) == 1:
        return "MODEL_OUTPUT_TOO_MANY_KEY_POINTS"
    if root in {"key_points", "action_points"}:
        return "MODEL_OUTPUT_INVALID_POINT_STRUCTURE"
    if error.validator in {"maxLength", "minLength", "maxItems", "minItems"}:
        return "MODEL_OUTPUT_LENGTH_EXCEEDED"
    if error.validator == "pattern" and root == "summary_paragraph_ids":
        return "MODEL_OUTPUT_INVALID_PARAGRAPH_REFERENCE"
    if error.validator == "type":
        return "MODEL_OUTPUT_INVALID_FIELD_TYPE"
    return "MODEL_OUTPUT_VALIDATION_UNKNOWN"


def _safe_metadata(value: object, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 128
        or not value.isascii()
        or any(ord(char) < 0x21 or ord(char) > 0x7E for char in value)
    ):
        return None
    return value


def _ensure_bounded_json(value: object) -> None:
    """Reject outputs that cannot be safely represented within the response budget."""
    size = 0
    nodes = 0
    active_containers: set[int] = set()

    def add(amount: int) -> None:
        nonlocal size
        size += amount
        if size > MAX_MODEL_OUTPUT_BYTES:
            raise ModelOutputInvalid("structured model output exceeds the response budget") from None

    def visit(item: object, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_MODEL_OUTPUT_NODES or depth > MAX_MODEL_OUTPUT_DEPTH:
            raise ModelOutputInvalid("structured model output exceeds structural limits") from None

        if item is None:
            add(4)
        elif type(item) is bool:
            add(4 if item else 5)
        elif type(item) is int:
            try:
                add(len(str(item)))
            except ValueError:
                raise ModelOutputInvalid("structured model output contains an invalid integer") from None
        elif type(item) is float:
            if not math.isfinite(item):
                raise ModelOutputInvalid("structured model output contains a non-finite number") from None
            add(len(repr(item)))
        elif type(item) is str:
            if len(item) > MAX_MODEL_OUTPUT_BYTES:
                raise ModelOutputInvalid("structured model output exceeds the response budget") from None
            try:
                encoded = json.dumps(item, ensure_ascii=False, allow_nan=False).encode("utf-8")
            except (TypeError, ValueError, UnicodeEncodeError):
                raise ModelOutputInvalid("structured model output contains invalid text") from None
            add(len(encoded))
        elif type(item) is list:
            identity = id(item)
            if identity in active_containers:
                raise ModelOutputInvalid("structured model output contains a cycle") from None
            if len(item) > MAX_MODEL_OUTPUT_NODES:
                raise ModelOutputInvalid("structured model output exceeds structural limits") from None
            active_containers.add(identity)
            add(2 + max(0, len(item) - 1))
            for child in item:
                visit(child, depth + 1)
            active_containers.remove(identity)
        elif type(item) is dict:
            identity = id(item)
            if identity in active_containers:
                raise ModelOutputInvalid("structured model output contains a cycle") from None
            if len(item) > MAX_MODEL_OUTPUT_NODES:
                raise ModelOutputInvalid("structured model output exceeds structural limits") from None
            active_containers.add(identity)
            add(2 + max(0, len(item) - 1) + len(item))
            for key, child in item.items():
                if type(key) is not str:
                    raise ModelOutputInvalid("structured model output contains a non-text key") from None
                visit(key, depth + 1)
                visit(child, depth + 1)
            active_containers.remove(identity)
        else:
            raise ModelOutputInvalid("structured model output contains a non-JSON value") from None

    visit(value, 0)
