"""Server-authorized model catalog and per-request routing.

The catalog is derived only from operator configuration. The browser can pick
one of the closed catalog IDs; it cannot submit LiteLLM aliases, prices or
routing hints. A selected model that is not authorized is refused: there is no
silent substitution.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping

from services.article_intel_summary.contracts import validate_catalog
from services.article_intel_summary.inference import DisabledInferenceAdapter
from services.article_intel_summary.litellm_adapter import (
    MODEL_CHOICE_MISTRAL_SMALL,
    MODEL_CHOICE_S5_FREE,
    LiteLLMInferenceAdapter,
    LiteLLMSettings,
    S5MistralFallbackAdapter,
    create_configured_inference_adapter,
    load_litellm_settings,
    _nonnegative_decimal,
    _valid_gateway_base_url,
    _valid_model_alias,
)
from services.article_intel_summary.profiles import DEFAULT_PROFILE, PROFILE_VERSION

CATALOG_ORDER = (MODEL_CHOICE_S5_FREE, MODEL_CHOICE_MISTRAL_SMALL)
_STATIC = {
    MODEL_CHOICE_S5_FREE: {"label": "S5", "provider": "LiteLLM", "paid_by_policy": False},
    MODEL_CHOICE_MISTRAL_SMALL: {"label": "Mistral Small", "provider": "LiteLLM", "paid_by_policy": True},
}


class ModelNotAvailable(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CatalogEntry:
    model_id: str
    available: bool
    unavailable_reason: str | None
    settings: LiteLLMSettings | None

    def to_document(self) -> dict[str, Any]:
        static = _STATIC[self.model_id]
        settings = self.settings
        input_price = settings.input_price_usd_per_million if settings else None
        output_price = settings.output_price_usd_per_million if settings else None
        if input_price is None or output_price is None:
            pricing_status = "not_verified"
        elif input_price == 0 and output_price == 0:
            pricing_status = "operator_declared_zero"
        else:
            pricing_status = "operator_declared_paid"
        notices = ["ARTICLE_SENT_TO_MODEL_PROVIDER"]
        if pricing_status != "not_verified":
            notices.append("PRICE_DECLARED_BY_OPERATOR")
        if static["paid_by_policy"] or pricing_status == "operator_declared_paid":
            notices.append("PAID_INFERENCE")
        return {
            "id": self.model_id,
            "label": static["label"],
            "provider": static["provider"],
            "available": self.available,
            "unavailable_reason": self.unavailable_reason,
            "requires_paid_authorization": bool(static["paid_by_policy"] or pricing_status == "operator_declared_paid"),
            "pricing": {
                "status": pricing_status,
                "input_usd_per_million": _decimal_text(input_price),
                "output_usd_per_million": _decimal_text(output_price),
            },
            "limits": {
                "max_input_tokens": settings.max_input_tokens if settings else None,
                "max_output_tokens": settings.max_output_tokens if settings else None,
                "requests_per_minute": settings.requests_per_minute if settings else None,
                "timeout_seconds": float(settings.timeout_seconds) if settings else None,
            },
            "notices": notices,
        }


class ModelRouter:
    """Maps closed catalog IDs to already-authorized adapters."""

    def __init__(self, entries: Mapping[str, CatalogEntry], adapters: Mapping[str, object], default_model_id: str | None) -> None:
        for model_id, entry in entries.items():
            if entry.available != (model_id in adapters):
                raise ValueError("catalog availability must match configured adapters")
        if default_model_id is not None and default_model_id not in adapters:
            default_model_id = None
        self._entries = dict(entries)
        self._adapters = dict(adapters)
        self.default_model_id = default_model_id

    def catalog_document(self) -> dict[str, Any]:
        document = {
            "schema_version": "1",
            "default_model_id": self.default_model_id,
            "profile_version": PROFILE_VERSION,
            "default_profile": DEFAULT_PROFILE,
            "models": [self._entries[model_id].to_document() for model_id in CATALOG_ORDER if model_id in self._entries],
        }
        return validate_catalog(document)

    def adapter_for(self, model_id: str):
        entry = self._entries.get(model_id)
        if entry is None:
            raise ModelNotAvailable("MODEL_NOT_AVAILABLE")
        if not entry.available:
            raise ModelNotAvailable(
                "MODEL_NOT_AUTHORIZED" if entry.unavailable_reason == "PAID_NOT_AUTHORIZED" else "MODEL_NOT_AVAILABLE"
            )
        return self._adapters[model_id]


def create_model_router(environ: Mapping[str, str] | None = None, *, default_adapter=None) -> tuple[ModelRouter, object]:
    """Return the router and the legacy v1 adapter, sharing one budget ledger owner."""
    values = os.environ if environ is None else environ
    if default_adapter is None:
        default_adapter = create_configured_inference_adapter(values)
    default_choice = values.get("NEWSFLUX_AI_LITELLM_MODEL_CHOICE")

    configured: dict[str, LiteLLMInferenceAdapter] = {}
    if isinstance(default_adapter, S5MistralFallbackAdapter):
        configured[default_adapter.primary.settings.model_choice] = default_adapter.primary
        configured[default_adapter.paid.settings.model_choice] = default_adapter.paid
        base = default_adapter.primary
    elif isinstance(default_adapter, LiteLLMInferenceAdapter):
        configured[default_adapter.settings.model_choice] = default_adapter
        base = default_adapter
    else:
        base = None

    entries: dict[str, CatalogEntry] = {}
    adapters: dict[str, object] = {}
    for model_id in CATALOG_ORDER:
        scoped = dict(values)
        scoped["NEWSFLUX_AI_LITELLM_MODEL_CHOICE"] = model_id
        settings = load_litellm_settings(scoped)
        reason = _unavailable_reason(settings)
        adapter = configured.get(model_id)
        if reason is None and adapter is None:
            if base is None:
                reason = "RUNTIME_UNAVAILABLE"
            else:
                adapter = LiteLLMInferenceAdapter(settings, ledger=base.ledger)
                adapter._owner = base._owner
                adapter._requires_owner = base._requires_owner
        if reason is None and adapter is not None and isinstance(default_adapter, DisabledInferenceAdapter):
            reason = "RUNTIME_UNAVAILABLE"
        if reason is not None:
            adapter = None
        entries[model_id] = CatalogEntry(model_id=model_id, available=adapter is not None, unavailable_reason=reason, settings=settings)
        if adapter is not None:
            adapters[model_id] = adapter
    return ModelRouter(entries, adapters, default_choice), default_adapter


def _unavailable_reason(settings: LiteLLMSettings) -> str | None:
    if settings.is_ready():
        return None
    if not settings.enabled:
        return "INFERENCE_DISABLED"
    if not settings.external_transfer_authorized:
        return "EXTERNAL_TRANSFER_NOT_AUTHORIZED"
    if not _valid_model_alias(settings.model_id) or not _valid_gateway_base_url(settings.gateway_base_url):
        return "NOT_CONFIGURED"
    if not _nonnegative_decimal(settings.input_price_usd_per_million) or not _nonnegative_decimal(settings.output_price_usd_per_million):
        return "PRICE_NOT_VERIFIED"
    paid = (settings.input_price_usd_per_million or Decimal("0")) > 0 or (settings.output_price_usd_per_million or Decimal("0")) > 0
    if (settings.model_choice == MODEL_CHOICE_MISTRAL_SMALL or paid) and not settings.paid_inference_authorized:
        return "PAID_NOT_AUTHORIZED"
    return "NOT_CONFIGURED"


def _decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.normalize(), "f")
