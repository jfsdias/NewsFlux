"""Server-authorized model catalog, read-only gateway discovery and per-request routing.

Three independent inputs decide what a user may select; none of them alone grants anything:

* the operator model policy (``NEWSFLUX_AI_MODEL_POLICY_JSON``, or the two legacy S5 / Mistral
  variables when it is absent): which gateway aliases are approved for article summaries, under
  which catalog ID, at which declared price, and whether paid use / article transfer is authorized;
* read-only discovery (``NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED=true``) with the Summary API's own,
  route-restricted virtual key: ``GET /v1/models`` (what the key may call) and ``GET /model/info``
  (mode, limits and the unit price the gateway accounts with). Both are LLM API routes, so the
  key's ``allowed_routes=["llm_api_routes"]`` is never widened;
* the global switches and budget (inference, external transfer, paid inference, ledger).

A model is AVAILABLE only when it is approved, discovered, compatible (chat), authorized and
either has a price matched to the gateway or is an identity-pinned local Ollama deployment
with no positive or conflicting gateway API price. Discovered but unapproved aliases
are listed under an opaque ID and can never be selected. A model that disappears from the gateway
becomes NOT_DISCOVERED; nothing is substituted. The browser receives catalog IDs, labels, states
and prices only: never the gateway URL, key, provider parameters or deployment details.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlsplit

import httpx

from services.article_intel_summary.budget import (
    BudgetLedger,
    LedgerOwner,
    UsageLedgerError,
)
from services.article_intel_summary.contracts import validate_catalog
from services.article_intel_summary.litellm_adapter import (
    MODEL_CHOICE_MISTRAL_SMALL,
    MODEL_CHOICE_S5_FREE,
    LiteLLMInferenceAdapter,
    LiteLLMSettings,
    S5MistralFallbackAdapter,
    _nonnegative_decimal,
    _read_bool,
    _read_decimal,
    _read_int,
    _read_private_secret_file,
    _valid_gateway_base_url,
    _valid_model_alias,
    create_configured_inference_adapter,
    load_gateway_settings,
    load_litellm_settings,
    valid_catalog_model_id,
)
from services.article_intel_summary.profiles import DEFAULT_PROFILE, PROFILE_VERSION

CATALOG_SCHEMA_VERSION = "2"
MAX_CATALOG_MODELS = 32
MAX_POLICY_MODELS = 32
MAX_DISCOVERED_ALIASES = 256
DEFAULT_DISCOVERY_TTL_SECONDS = 300
MAX_DISCOVERY_TTL_SECONDS = 3600
DISCOVERY_FAILURE_TTL_SECONDS = 30
DISCOVERY_TIMEOUT_SECONDS = 5.0
MAX_DISCOVERY_RESPONSE_BYTES = 256 * 1024
LEGACY_IDS = (MODEL_CHOICE_S5_FREE, MODEL_CHOICE_MISTRAL_SMALL)
LEGACY_LABELS = {MODEL_CHOICE_S5_FREE: "S5", MODEL_CHOICE_MISTRAL_SMALL: "Mistral Small"}
_PROVIDER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}")
_LABEL_MAX = 64
# Provider IDENTITY (security, never displayed): the LiteLLM provider adapter, plus the upstream
# endpoint host when the deployment exposes one, e.g. "mistral" or "openai@api.example.net".
_IDENTITY_PROVIDER_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
_IDENTITY_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}(?:@[a-z0-9.-]{1,253}(?::[0-9]{1,5})?)?")
# Dialects that only describe an API shape: without a visible api_base the real upstream is unknown.
_GENERIC_DIALECTS = frozenset({
    "openai", "openai_like", "custom_openai", "text-completion-openai", "hosted_vllm", "vllm", "ollama",
    "ollama_chat", "lm_studio", "litellm_proxy", "custom", "llamafile", "xinference", "oobabooga",
})

# unavailable_reason -> status (for entries built without discovery, e.g. in tests)
_REASON_STATUS = {
    "POLICY_INVALID": "DISABLED",
    "INFERENCE_DISABLED": "DISABLED",
    "EXTERNAL_TRANSFER_NOT_AUTHORIZED": "DISABLED",
    "TRANSFER_NOT_AUTHORIZED": "DISABLED",
    "NOT_CONFIGURED": "DISABLED",
    "RUNTIME_UNAVAILABLE": "DISABLED",
    "DISCOVERY_DISABLED": "UNVERIFIED",
    "GATEWAY_UNAVAILABLE": "UNVERIFIED",
    "COMPATIBILITY_UNVERIFIED": "UNVERIFIED",
    "PRICE_NOT_VERIFIED": "UNVERIFIED",
    "PRICE_MISMATCH": "UNVERIFIED",
    "NOT_DISCOVERED": "NOT_DISCOVERED",
    "NOT_COMPATIBLE": "UNSUPPORTED",
    "OPERATOR_APPROVAL_REQUIRED": "OPERATOR_APPROVAL_REQUIRED",
    "PAID_NOT_AUTHORIZED": "PAID_AUTHORIZATION_REQUIRED",
}
_NOT_AUTHORIZED_REASONS = frozenset({"PAID_NOT_AUTHORIZED", "OPERATOR_APPROVAL_REQUIRED"})


class ModelNotAvailable(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# --------------------------------------------------------------------------------------------------
# Operator policy
# --------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PolicyModel:
    model_id: str
    alias: str | None
    label: str
    provider: str
    compatible_for_summary: bool
    input_price: Decimal | None
    output_price: Decimal | None
    paid_authorized: bool
    transfer_authorized: bool
    max_output_tokens: int | None = None
    legacy: bool = False
    provider_identity: str | None = None  # optional expected gateway identity; a mismatch fails closed


_POLICY_KEYS = {
    "id",
    "alias",
    "label",
    "provider",
    "compatible_for_summary",
    "input_usd_per_million",
    "output_usd_per_million",
    "paid_authorized",
    "transfer_authorized",
    "max_output_tokens",
    "provider_identity",
}
_POLICY_REQUIRED = _POLICY_KEYS - {"max_output_tokens", "provider_identity", "input_usd_per_million", "output_usd_per_million"}


def load_model_policy(values: Mapping[str, str]) -> tuple[str, tuple[PolicyModel, ...]]:
    """Return (status, models). status: LEGACY | CONFIGURED | INVALID (fail closed, no models)."""
    raw = values.get("NEWSFLUX_AI_MODEL_POLICY_JSON")
    if raw is None or not raw.strip():
        return "LEGACY", _legacy_policy(values)
    try:
        document = json.loads(raw)
        models = _parse_policy(document)
    except (ValueError, TypeError, InvalidOperation):
        return "INVALID", ()
    return "CONFIGURED", models


def _legacy_policy(values: Mapping[str, str]) -> tuple[PolicyModel, ...]:
    entries = []
    for model_id, prefix, alias_name in (
        (MODEL_CHOICE_S5_FREE, "NEWSFLUX_AI_LITELLM_S5_FREE", "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS"),
        (MODEL_CHOICE_MISTRAL_SMALL, "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL", "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS"),
    ):
        alias = values.get(alias_name)
        entries.append(
            PolicyModel(
                model_id=model_id,
                alias=alias if _valid_model_alias(alias) else None,
                label=LEGACY_LABELS[model_id],
                provider="LiteLLM",
                compatible_for_summary=True,
                input_price=_read_decimal(values.get(f"{prefix}_INPUT_USD_PER_MILLION")),
                output_price=_read_decimal(values.get(f"{prefix}_OUTPUT_USD_PER_MILLION")),
                paid_authorized=True,  # the global NEWSFLUX_AI_ALLOW_PAID_INFERENCE still decides
                transfer_authorized=True,
                legacy=True,
            )
        )
    return tuple(entries)


def _parse_policy(document: object) -> tuple[PolicyModel, ...]:
    if not isinstance(document, dict) or set(document) != {"version", "models"} or document["version"] != 1:
        raise ValueError("policy")
    items = document["models"]
    if not isinstance(items, list) or len(items) > MAX_POLICY_MODELS:
        raise ValueError("policy")
    models: list[PolicyModel] = []
    for item in items:
        if not isinstance(item, dict) or not _POLICY_REQUIRED <= set(item) <= _POLICY_KEYS:
            raise ValueError("policy entry")
        model_id, alias, label, provider = item["id"], item["alias"], item["label"], item["provider"]
        if not valid_catalog_model_id(model_id) or not _valid_model_alias(alias):
            raise ValueError("policy identifiers")
        if not _short_text(label) or not _short_text(provider):
            raise ValueError("policy labels")
        flags = [item["compatible_for_summary"], item["paid_authorized"], item["transfer_authorized"]]
        if not all(isinstance(flag, bool) for flag in flags):
            raise ValueError("policy flags")
        prices = []
        for field in ("input_usd_per_million", "output_usd_per_million"):
            value = item.get(field)
            if value is None:
                prices.append(None)
                continue
            if not isinstance(value, str):
                raise ValueError("policy price")
            price = Decimal(value)
            if not _nonnegative_decimal(price):
                raise ValueError("policy price")
            prices.append(price)
        max_output = item.get("max_output_tokens")
        if max_output is not None and (isinstance(max_output, bool) or not isinstance(max_output, int) or max_output < 1):
            raise ValueError("policy max output")
        identity = item.get("provider_identity")
        if identity is not None and not (isinstance(identity, str) and _IDENTITY_RE.fullmatch(identity)):
            raise ValueError("policy provider identity")
        models.append(
            PolicyModel(
                model_id=model_id,
                alias=alias,
                label=label,
                provider=provider,
                compatible_for_summary=item["compatible_for_summary"],
                input_price=prices[0],
                output_price=prices[1],
                paid_authorized=item["paid_authorized"],
                transfer_authorized=item["transfer_authorized"],
                max_output_tokens=max_output,
                provider_identity=identity,
            )
        )
    if len({m.model_id for m in models}) != len(models) or len({m.alias for m in models}) != len(models):
        raise ValueError("policy duplicates")
    return tuple(models)


def _short_text(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) and len(value) <= _LABEL_MAX and value.isprintable()


# --------------------------------------------------------------------------------------------------
# Read-only discovery
# --------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class GatewayModel:
    alias: str
    mode: str | None = None
    provider: str | None = None
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    input_price: Decimal | None = None  # USD per million tokens, None = not published
    output_price: Decimal | None = None
    price_conflict: bool = False
    provider_identity: str | None = None  # verified, identical for every deployment, else None


@dataclass(frozen=True)
class DiscoverySnapshot:
    status: str  # DISABLED | OK | UNAVAILABLE
    listed: tuple[str, ...] = ()
    info: Mapping[str, GatewayModel] | None = None  # None when /model/info could not be read


DISABLED_SNAPSHOT = DiscoverySnapshot("DISABLED")

Getter = Callable[[str], Any]


def gateway_getter(base_url: str, private_peer: str | None, virtual_key: str, *, client: httpx.Client | None = None) -> Getter:
    """GET-only JSON reader for the gateway, with the Summary API's virtual key."""
    if not _valid_gateway_base_url(base_url):
        raise ValueError("gateway must be a plain HTTPS origin")
    if private_peer not in (None, "npm"):
        raise ValueError("unsupported private peer")
    owned = client or httpx.Client(
        transport=httpx.HTTPTransport(retries=0), follow_redirects=False, timeout=DISCOVERY_TIMEOUT_SECONDS
    )

    def get(path: str) -> Any:
        url = f"{base_url.rstrip('/')}{path}"
        headers = {"Authorization": f"Bearer {virtual_key}", "Accept": "application/json"}
        extensions: dict[str, str] = {}
        if private_peer == "npm":
            host = urlsplit(base_url).hostname or ""
            url = f"https://npm{path}"
            headers["Host"] = host
            extensions["sni_hostname"] = host
        request = owned.build_request("GET", url, headers=headers, extensions=extensions)
        response = owned.send(request, stream=True, follow_redirects=False)
        try:
            if response.status_code != 200:
                raise RuntimeError(f"HTTP_{response.status_code}")
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_DISCOVERY_RESPONSE_BYTES:
                    raise RuntimeError("RESPONSE_TOO_LARGE")
        finally:
            response.close()
        return json.loads(body.decode("utf-8"), parse_constant=_reject_constant)

    return get


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number {value}")


class GatewayDiscovery:
    def __init__(self, getter: Getter, *, ttl_seconds: float = DEFAULT_DISCOVERY_TTL_SECONDS, clock=time.monotonic) -> None:
        self._get = getter
        self._ttl = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._cached: DiscoverySnapshot | None = None
        self._expires_at = 0.0

    @classmethod
    def from_environment(cls, values: Mapping[str, str], *, getter: Getter | None = None) -> GatewayDiscovery | None:
        if not _read_bool(values, "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED"):
            return None
        ttl = _read_int(values.get("NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS"))
        ttl = DEFAULT_DISCOVERY_TTL_SECONDS if ttl is None else min(ttl, MAX_DISCOVERY_TTL_SECONDS)
        if getter is None:
            base_url = values.get("NEWSFLUX_AI_LITELLM_BASE_URL")
            if not _valid_gateway_base_url(base_url):
                return None
            key = _read_private_secret_file(values.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"))
            if key is None:
                return None
            try:
                getter = gateway_getter(base_url, values.get("NEWSFLUX_AI_LITELLM_PRIVATE_DOCKER_PEER") or None, key)
            except ValueError:
                return None
        return cls(getter, ttl_seconds=ttl)

    def fresh_snapshot(self) -> DiscoverySnapshot:
        """Bypass the TTL before a local-only dispatch; never trust prior catalog metadata."""
        with self._lock:
            return self._fetch()

    def snapshot(self) -> DiscoverySnapshot:
        with self._lock:
            now = self._clock()
            if self._cached is not None and now < self._expires_at:
                return self._cached
            snapshot = self._fetch()
            ttl = self._ttl if snapshot.status == "OK" else min(self._ttl, DISCOVERY_FAILURE_TTL_SECONDS)
            self._cached, self._expires_at = snapshot, now + ttl
            return snapshot

    def _fetch(self) -> DiscoverySnapshot:
        try:
            listed = _parse_listing(self._get("/v1/models"))
        except Exception:  # noqa: BLE001 - classified, detail-free
            return DiscoverySnapshot("UNAVAILABLE")
        try:
            info = _parse_model_info(self._get("/model/info"))
        except Exception:  # noqa: BLE001
            info = None
        return DiscoverySnapshot("OK", listed, info)


def _parse_listing(document: object) -> tuple[str, ...]:
    if not isinstance(document, dict) or not isinstance(document.get("data"), list):
        raise ValueError("listing")
    rows = document["data"]
    if len(rows) > MAX_DISCOVERED_ALIASES * 8:
        raise ValueError("listing too large")
    aliases: list[str] = []
    for item in rows:
        # LiteLLM can expose unrelated aliases with shapes that NewsFlux cannot safely
        # address. Never let one such row hide *other* valid, operator-approved models.
        # Skipped names are never discoverable, approved or dispatched.
        if not isinstance(item, dict) or not _valid_model_alias(item.get("id")):
            continue
        if item["id"] not in aliases:
            aliases.append(item["id"])
        if len(aliases) > MAX_DISCOVERED_ALIASES:
            raise ValueError("listing too large")
    if rows and not aliases:
        raise ValueError("listing has no valid aliases")
    return tuple(aliases)


def _parse_model_info(document: object) -> dict[str, GatewayModel]:
    if not isinstance(document, dict) or not isinstance(document.get("data"), list):
        raise ValueError("model info")
    rows = document["data"]
    if len(rows) > MAX_DISCOVERED_ALIASES * 8:
        raise ValueError("model info too large")
    grouped: dict[str, list[dict]] = {}
    identities: dict[str, list[str | None]] = {}
    for item in rows:
        # Never reuse metadata from an invalid/unaddressable model entry; retaining
        # only valid aliases preserves conservative price and provider aggregation.
        if not isinstance(item, dict) or not _valid_model_alias(item.get("model_name")):
            continue
        info = item.get("model_info")
        grouped.setdefault(item["model_name"], []).append(info if isinstance(info, dict) else {})
        identities.setdefault(item["model_name"], []).append(_deployment_identity(item))
    if rows and not grouped:
        raise ValueError("model info has no valid aliases")
    return {
        alias: _aggregate(alias, infos, identities[alias])
        for alias, infos in list(grouped.items())[:MAX_DISCOVERED_ALIASES]
    }


def _deployment_identity(item: dict) -> str | None:
    """The verified provider identity of ONE deployment, or None when it cannot be proven.

    Built only from what the gateway's own inventory states: ``model_info.litellm_provider`` (the
    LiteLLM provider adapter), which must agree with the ``litellm_params.model`` prefix when there is
    one, plus the ``litellm_params.api_base`` host when the deployment exposes it. A generic API
    dialect (OpenAI-compatible, vLLM, Ollama, ...) without a visible endpoint proves nothing.
    """
    info = item.get("model_info")
    params = item.get("litellm_params")
    params = params if isinstance(params, dict) else {}
    provider = info.get("litellm_provider") if isinstance(info, dict) else None
    if not isinstance(provider, str) or not _IDENTITY_PROVIDER_RE.fullmatch(provider.lower()):
        return None
    provider = provider.lower()
    model = params.get("model")
    if model is not None and (not isinstance(model, str) or ("/" in model and model.split("/", 1)[0].lower() != provider)):
        return None
    api_base = params.get("api_base")
    if api_base is None:
        return None if provider in _GENERIC_DIALECTS else provider
    if not isinstance(api_base, str):
        return None
    try:
        parts = urlsplit(api_base.strip())
        host, port = (parts.hostname or "").lower(), parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password:
        return None
    identity = f"{provider}@{host}" + (f":{port}" if port else "")
    return identity if _IDENTITY_RE.fullmatch(identity) else None


def _aggregate(alias: str, infos: list[dict], identities: list[str | None] | None = None) -> GatewayModel:
    """Combine every deployment of one alias conservatively."""
    distinct = set(identities or [None])
    provider_identity = distinct.pop() if len(distinct) == 1 else None  # mixed deployments: unknown
    modes = {info.get("mode") if isinstance(info.get("mode"), str) else None for info in infos}
    mode = modes.pop() if len(modes) == 1 else ("mixed" if None not in modes else None)
    providers = {info.get("litellm_provider") for info in infos}
    provider = providers.pop() if len(providers) == 1 else None
    if not (isinstance(provider, str) and _PROVIDER_RE.fullmatch(provider)):
        provider = None
    prices: list[Decimal | None] = []
    conflict = False
    for field in ("input_cost_per_token", "output_cost_per_token"):
        values = {_per_million(info.get(field)) for info in infos}
        if len(values) > 1:
            # An unknown price mixed with a published price is also a conflict.
            # Never let a mixed deployment alias look like a wholly unpriced local model.
            conflict = True
            prices.append(None)
        else:
            prices.append(values.pop())
    return GatewayModel(
        alias=alias,
        mode=mode,
        provider=provider,
        max_input_tokens=_min_positive(info.get("max_input_tokens") for info in infos),
        max_output_tokens=_min_positive(info.get("max_output_tokens") for info in infos),
        input_price=prices[0],
        output_price=prices[1],
        price_conflict=conflict,
        provider_identity=provider_identity,
    )


def _per_million(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return (Decimal(str(value)) * Decimal(1_000_000)).normalize()


def _min_positive(values) -> int | None:
    numbers = [v for v in values if isinstance(v, int) and not isinstance(v, bool) and v > 0]
    return min(numbers) if numbers else None


# --------------------------------------------------------------------------------------------------
# Catalog entries
# --------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CatalogEntry:
    model_id: str
    available: bool
    unavailable_reason: str | None
    settings: LiteLLMSettings | None
    label: str | None = None
    provider: str | None = None
    status: str | None = None
    checks: Mapping[str, bool | None] | None = None
    pricing: Mapping[str, Any] | None = None
    paid: bool | None = None
    gateway_max_input_tokens: int | None = None
    gateway_max_output_tokens: int | None = None
    # Security identity for fallback decisions (SEC-249-02). Internal: never in to_document().
    # `provider` above is a display label only.
    provider_identity: str | None = None

    def to_document(self) -> dict[str, Any]:
        settings = self.settings
        if self.pricing is not None:
            pricing = dict(self.pricing)
        else:
            pricing = _declared_pricing(
                settings.input_price_usd_per_million if settings else None,
                settings.output_price_usd_per_million if settings else None,
            )
        paid = self.paid
        if paid is None:
            paid = self.model_id == MODEL_CHOICE_MISTRAL_SMALL or pricing["status"].endswith("_paid")
        notices = [
            "ARTICLE_SENT_TO_LOCAL_MODEL" if settings and settings.local_processing_authorized
            else "ARTICLE_SENT_TO_MODEL_PROVIDER"
        ]
        if pricing["status"].startswith("operator_declared"):
            notices.append("PRICE_DECLARED_BY_OPERATOR")
        if pricing["status"].startswith("verified"):
            notices.append("PRICE_VERIFIED_BY_GATEWAY")
        if paid:
            notices.append("PAID_INFERENCE")
        checks = {
            "discovered": None,
            "compatible": None,
            "operator_approved": True,
            "pricing_verified": False,
            "paid_authorized": bool(settings and settings.paid_inference_authorized),
            "transfer_authorized": bool(settings and settings.external_transfer_authorized),
        }
        if self.checks is not None:
            checks.update(self.checks)
        status = "AVAILABLE" if self.available else (self.status or _REASON_STATUS.get(self.unavailable_reason or "", "DISABLED"))
        max_input = _min_known(settings.max_input_tokens if settings else None, self.gateway_max_input_tokens)
        max_output = _min_known(settings.max_output_tokens if settings else None, self.gateway_max_output_tokens)
        return {
            "id": self.model_id,
            "label": (self.label or LEGACY_LABELS.get(self.model_id) or self.model_id)[:_LABEL_MAX],
            "provider": (self.provider or "LiteLLM")[:_LABEL_MAX],
            "status": status,
            "available": self.available,
            "unavailable_reason": None if self.available else (self.unavailable_reason or "NOT_CONFIGURED"),
            "requires_paid_authorization": bool(paid),
            "checks": checks,
            "pricing": pricing,
            "limits": {
                "max_input_tokens": max_input,
                "max_output_tokens": max_output,
                "requests_per_minute": settings.requests_per_minute if settings else None,
                "timeout_seconds": float(settings.timeout_seconds) if settings and math.isfinite(settings.timeout_seconds) else None,
            },
            "notices": notices,
        }


def _min_known(*values: int | None) -> int | None:
    known = [v for v in values if isinstance(v, int) and not isinstance(v, bool) and v > 0]
    return min(known) if known else None


def _declared_pricing(input_price: Decimal | None, output_price: Decimal | None) -> dict[str, Any]:
    if input_price is None or output_price is None:
        status = "not_verified"
    elif input_price == 0 and output_price == 0:
        status = "operator_declared_zero"
    else:
        status = "operator_declared_paid"
    return {"status": status, "input_usd_per_million": _decimal_text(input_price), "output_usd_per_million": _decimal_text(output_price)}


def _gateway_pricing(entry: PolicyModel | None, gateway: GatewayModel | None) -> tuple[dict[str, Any], bool]:
    """Return (pricing document, verified)."""
    declared_in = entry.input_price if entry else None
    declared_out = entry.output_price if entry else None
    published = gateway is not None and gateway.input_price is not None and gateway.output_price is not None
    if gateway is not None and gateway.price_conflict:
        return {"status": "mismatch", "input_usd_per_million": _decimal_text(declared_in), "output_usd_per_million": _decimal_text(declared_out)}, False
    declared = declared_in is not None and declared_out is not None
    if declared and published:
        if declared_in == gateway.input_price and declared_out == gateway.output_price:
            zero = declared_in == 0 and declared_out == 0
            return {
                "status": "verified_zero" if zero else "verified_paid",
                "input_usd_per_million": _decimal_text(declared_in),
                "output_usd_per_million": _decimal_text(declared_out),
            }, True
        return {"status": "mismatch", "input_usd_per_million": _decimal_text(declared_in), "output_usd_per_million": _decimal_text(declared_out)}, False
    if declared:
        return _declared_pricing(declared_in, declared_out), False
    if published:
        return {
            "status": "gateway_published_only",
            "input_usd_per_million": _decimal_text(gateway.input_price),
            "output_usd_per_million": _decimal_text(gateway.output_price),
        }, False
    return {"status": "not_verified", "input_usd_per_million": None, "output_usd_per_million": None}, False


# The only no-price exception is the separately approved Ollama service inside the
# gateway's Docker network. A proxy, remote Ollama, omitted endpoint, or another
# identity remains subject to explicit price verification.
_LOCAL_OLLAMA_IDENTITY = "ollama@ollama:11434"


def _is_unpriced_local_ollama(item: PolicyModel, model: GatewayModel | None, discovered: bool | None) -> bool:
    return bool(
        discovered is True
        and not item.legacy
        and item.model_id not in LEGACY_IDS
        and item.provider_identity == _LOCAL_OLLAMA_IDENTITY
        and item.input_price is None
        and item.output_price is None
        and model is not None
        and model.provider == "ollama"
        and model.provider_identity == _LOCAL_OLLAMA_IDENTITY
        and model.mode == "chat"
        and not model.price_conflict
        and model.input_price in (None, Decimal("0"))
        and model.output_price in (None, Decimal("0"))
    )


def discovered_model_id(alias: str) -> str:
    return "gw-" + hashlib.sha256(alias.encode("utf-8")).hexdigest()[:12]


# --------------------------------------------------------------------------------------------------
# Router
# --------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _State:
    entries: Mapping[str, CatalogEntry]
    adapters: Mapping[str, object]
    default_model_id: str | None
    discovery_status: str
    policy_status: str


class ModelRouter:
    """Maps catalog IDs to already-authorized adapters, revalidated against the current catalog."""

    def __init__(
        self,
        entries: Mapping[str, CatalogEntry],
        adapters: Mapping[str, object],
        default_model_id: str | None,
        *,
        refresh: Callable[[], _State] | None = None,
        ledger_owner: LedgerOwner | None = None,
    ) -> None:
        for model_id, entry in entries.items():
            if entry.available != (model_id in adapters):
                raise ValueError("catalog availability must match configured adapters")
        if default_model_id is not None and default_model_id not in adapters:
            default_model_id = None
        self._static = _State(dict(entries), dict(adapters), default_model_id, "DISABLED", "LEGACY")
        self._refresh = refresh
        self.ledger_owner = ledger_owner

    @property
    def default_model_id(self) -> str | None:
        return self._state().default_model_id

    def _state(self) -> _State:
        return self._refresh() if self._refresh is not None else self._static

    def catalog_document(self) -> dict[str, Any]:
        state = self._state()
        document = {
            "schema_version": CATALOG_SCHEMA_VERSION,
            "default_model_id": state.default_model_id,
            "profile_version": PROFILE_VERSION,
            "default_profile": DEFAULT_PROFILE,
            "discovery": {"status": state.discovery_status},
            "policy": {"status": state.policy_status},
            "models": [entry.to_document() for entry in list(state.entries.values())[:MAX_CATALOG_MODELS]],
        }
        return validate_catalog(document)

    def entry_for(self, model_id: str) -> CatalogEntry | None:
        return self._state().entries.get(model_id)

    def adapter_for(self, model_id: str):
        state = self._state()
        entry = state.entries.get(model_id)
        if entry is None:
            raise ModelNotAvailable("MODEL_NOT_AVAILABLE")
        if not entry.available:
            raise ModelNotAvailable(
                "MODEL_NOT_AUTHORIZED" if entry.unavailable_reason in _NOT_AUTHORIZED_REASONS else "MODEL_NOT_AVAILABLE"
            )
        return state.adapters[model_id]

    def fallback_view(self, primary_id: str, fallback_id: str):
        """(primary entry, fallback entry, fallback adapter) from ONE current catalog state."""
        state = self._state()
        fallback = state.entries.get(fallback_id)
        if fallback is None or not fallback.available:
            raise ModelNotAvailable("MODEL_NOT_AVAILABLE")
        return state.entries.get(primary_id), fallback, state.adapters[fallback_id]


def create_model_router(
    environ: Mapping[str, str] | None = None,
    *,
    default_adapter=None,
    discovery_getter: Getter | None = None,
) -> tuple[ModelRouter, object]:
    """Return the router and the legacy v1 adapter, sharing one budget ledger owner."""
    # Snapshot: the catalog is rebuilt lazily and must keep the configuration it was started with.
    values = dict(os.environ if environ is None else environ)
    if default_adapter is None:
        default_adapter = create_configured_inference_adapter(values)

    if isinstance(default_adapter, S5MistralFallbackAdapter):
        base_adapter = default_adapter.primary
    elif isinstance(default_adapter, LiteLLMInferenceAdapter):
        base_adapter = default_adapter
    else:
        base_adapter = None

    policy_status, policy = load_model_policy(values)
    discovery = GatewayDiscovery.from_environment(values, getter=discovery_getter)
    gateway = load_gateway_settings(
        values,
        read_key=_read_bool(values, "NEWSFLUX_AI_INFERENCE_ENABLED") and (
            _read_bool(values, "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER")
            or _read_bool(values, "NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING")
        ),
    )

    ledger = base_adapter.ledger if base_adapter is not None else None
    owner = base_adapter._owner if base_adapter is not None else None
    own_owner = None
    # Do not take ledger ownership or reserve any local-only capacity unless a currently
    # discovered, explicitly approved Ollama endpoint passes the complete no-price gate.
    local_candidate = False
    if gateway.enabled and gateway.local_processing_authorized and discovery is not None:
        candidate_snapshot = discovery.snapshot()
        if candidate_snapshot.status == "OK":
            local_candidate = any(
                _is_unpriced_local_ollama(
                    item, (candidate_snapshot.info or {}).get(item.alias), item.alias in candidate_snapshot.listed
                ) for item in policy if item.alias is not None
            )
    if ledger is None and gateway.enabled and (
        gateway.external_transfer_authorized or local_candidate
    ) and gateway.usage_database_path:
        try:
            ledger = BudgetLedger(gateway.usage_database_path)
            own_owner = LedgerOwner(gateway.usage_database_path)
            own_owner.__enter__()
            own_owner.recover_orphans(ledger)
            owner = own_owner
        except (UsageLedgerError, TypeError, OSError):
            if own_owner is not None:
                own_owner.__exit__()
            ledger, owner, own_owner = None, None, None

    configured: dict[str, LiteLLMInferenceAdapter] = {}
    if isinstance(default_adapter, S5MistralFallbackAdapter):
        configured[default_adapter.primary.settings.model_choice] = default_adapter.primary
        configured[default_adapter.paid.settings.model_choice] = default_adapter.paid
    elif base_adapter is not None:
        configured[base_adapter.settings.model_choice] = base_adapter
    cache: dict[str, LiteLLMInferenceAdapter] = {}
    requested_default = values.get("NEWSFLUX_AI_DEFAULT_MODEL_ID") or values.get("NEWSFLUX_AI_LITELLM_MODEL_CHOICE")

    def adapter_for_settings(model_id: str, settings: LiteLLMSettings, item: PolicyModel):
        existing = configured.get(model_id) or cache.get(model_id)
        if existing is not None and existing.settings == settings:
            return existing
        if ledger is None or owner is None:
            return None
        pre_dispatch_check = None
        if settings.local_processing_authorized:
            if discovery is None:
                return None

            def pre_dispatch_check() -> bool:
                fresh = discovery.fresh_snapshot()
                return bool(
                    fresh.status == "OK"
                    and item.alias in fresh.listed
                    and _is_unpriced_local_ollama(item, (fresh.info or {}).get(item.alias), True)
                )

        adapter = LiteLLMInferenceAdapter(settings, ledger=ledger, pre_dispatch_check=pre_dispatch_check)
        adapter._owner = owner
        adapter._requires_owner = True
        cache[model_id] = adapter
        return adapter

    def build() -> _State:
        snapshot = discovery.snapshot() if discovery is not None else DISABLED_SNAPSHOT
        entries: dict[str, CatalogEntry] = {}
        adapters: dict[str, object] = {}
        approved_aliases = set()
        for item in policy:
            entry, adapter = _evaluate(item, policy_status, snapshot, gateway, values, adapter_for_settings)
            entries[item.model_id] = entry
            if item.alias:
                approved_aliases.add(item.alias)
            if adapter is not None:
                adapters[item.model_id] = adapter
        if snapshot.status == "OK":
            for alias in snapshot.listed:
                if len(entries) >= MAX_CATALOG_MODELS:
                    break
                if alias in approved_aliases:
                    continue
                model_id = discovered_model_id(alias)
                entries[model_id] = _discovered_entry(model_id, alias, snapshot, gateway)
        default = requested_default if requested_default in adapters else None
        return _State(entries, adapters, default, snapshot.status, policy_status)

    router = ModelRouter({}, {}, None, refresh=build, ledger_owner=own_owner)
    return router, default_adapter


def _evaluate(item: PolicyModel, policy_status: str, snapshot: DiscoverySnapshot, gateway: LiteLLMSettings, values, adapter_for_settings):
    gateway_model = (snapshot.info or {}).get(item.alias) if item.alias else None
    discovered = None if snapshot.status != "OK" else (item.alias in snapshot.listed)
    local_unpriced = _is_unpriced_local_ollama(item, gateway_model, discovered)
    settings = _settings_for(item, gateway, values, local_unpriced=local_unpriced)
    transfer_authorized = item.transfer_authorized and (
        gateway.external_transfer_authorized or (gateway.local_processing_authorized and local_unpriced)
    )
    if snapshot.status == "OK" and discovered and snapshot.info is not None and gateway_model is not None and gateway_model.mode is not None:
        compatible: bool | None = item.compatible_for_summary and gateway_model.mode == "chat"
    elif not item.compatible_for_summary:
        compatible = False
    else:
        compatible = None
    pricing, pricing_verified = _gateway_pricing(item, gateway_model if discovered else None)
    if snapshot.status != "OK":
        pricing, pricing_verified = _declared_pricing(item.input_price, item.output_price), False
    elif local_unpriced:
        # Public catalog prices remain unknown (not falsely verified as 0).
        # Only per-API-call currency accounting in the private token ledger is zero.
        pricing = {"status": "local_unpriced", "input_usd_per_million": None, "output_usd_per_million": None}
    paid = (
        item.model_id == MODEL_CHOICE_MISTRAL_SMALL
        or any(p is not None and p > 0 for p in (item.input_price, item.output_price))
        or (gateway_model is not None and any(p is not None and p > 0 for p in (gateway_model.input_price, gateway_model.output_price)))
    )
    checks = {
        "discovered": discovered,
        "compatible": compatible,
        "operator_approved": policy_status != "INVALID",
        "pricing_verified": pricing_verified,
        "paid_authorized": bool(settings.paid_inference_authorized),
        "transfer_authorized": bool(transfer_authorized),
    }

    if policy_status == "INVALID":
        reason = "POLICY_INVALID"
    elif not gateway.enabled:
        reason = "INFERENCE_DISABLED"
    elif not transfer_authorized:
        reason = "EXTERNAL_TRANSFER_NOT_AUTHORIZED"
    elif not item.transfer_authorized:
        reason = "TRANSFER_NOT_AUTHORIZED"
    elif item.alias is None:
        reason = "NOT_CONFIGURED"
    elif snapshot.status == "DISABLED":
        reason = "DISCOVERY_DISABLED"
    elif snapshot.status != "OK":
        reason = "GATEWAY_UNAVAILABLE"
    elif not discovered:
        reason = "NOT_DISCOVERED"
    elif compatible is False:
        reason = "NOT_COMPATIBLE"
    elif compatible is None:
        reason = "COMPATIBILITY_UNVERIFIED"
    elif pricing["status"] == "mismatch":
        reason = "PRICE_MISMATCH"
    elif not pricing_verified and not local_unpriced:
        reason = "PRICE_NOT_VERIFIED"
    elif paid and not settings.paid_inference_authorized:
        reason = "PAID_NOT_AUTHORIZED"
    elif not settings.is_ready():
        reason = "NOT_CONFIGURED"
    else:
        reason = None
    identity = gateway_model.provider_identity if (discovered and gateway_model is not None) else None
    if item.provider_identity is not None and identity != item.provider_identity:
        identity = None  # policy and gateway disagree: unverified, fail closed for fallback
    adapter = adapter_for_settings(item.model_id, settings, item) if reason is None else None
    if reason is None and adapter is None:
        reason = "RUNTIME_UNAVAILABLE"
    status = "AVAILABLE" if reason is None else ("DISABLED" if reason == "POLICY_INVALID" else _REASON_STATUS[reason])
    entry = CatalogEntry(
        model_id=item.model_id,
        available=reason is None,
        unavailable_reason=reason,
        settings=settings,
        label=item.label,
        provider=item.provider,
        status=status,
        checks=checks,
        pricing=pricing,
        paid=paid,
        gateway_max_input_tokens=gateway_model.max_input_tokens if gateway_model and discovered else None,
        gateway_max_output_tokens=gateway_model.max_output_tokens if gateway_model and discovered else None,
        provider_identity=identity,
    )
    return entry, adapter


def _settings_for(
    item: PolicyModel, gateway: LiteLLMSettings, values: Mapping[str, str], *, local_unpriced: bool = False
) -> LiteLLMSettings:
    if item.legacy:
        # Exact legacy semantics (alias variables, S5 limits, paid rule) for the two legacy IDs.
        scoped = dict(values)
        scoped["NEWSFLUX_AI_LITELLM_MODEL_CHOICE"] = item.model_id
        return load_litellm_settings(scoped)
    max_output = _min_known(gateway.max_output_tokens, item.max_output_tokens)
    if item.model_id == MODEL_CHOICE_S5_FREE:
        max_output = _min_known(max_output, _read_int(values.get("NEWSFLUX_AI_S5_MAX_OUTPUT_TOKENS")), 2048)
    return replace(
        gateway,
        model_choice=item.model_id,
        model_id=item.alias,
        s5_free_model_alias=item.alias if item.model_id == MODEL_CHOICE_S5_FREE else None,
        mistral_small_model_alias=item.alias if item.model_id == MODEL_CHOICE_MISTRAL_SMALL else None,
        # A pinned, local-only Ollama deployment has no metered provider API fee.
        # This is private ledger accounting, not a published gateway price.
        input_price_usd_per_million=Decimal("0") if local_unpriced else item.input_price,
        output_price_usd_per_million=Decimal("0") if local_unpriced else item.output_price,
        paid_inference_authorized=gateway.paid_inference_authorized and item.paid_authorized,
        external_transfer_authorized=gateway.external_transfer_authorized and item.transfer_authorized,
        local_processing_authorized=gateway.local_processing_authorized and local_unpriced and item.transfer_authorized,
        max_output_tokens=max_output,
        operator_approved=True,
    )


def _discovered_entry(model_id: str, alias: str, snapshot: DiscoverySnapshot, gateway: LiteLLMSettings) -> CatalogEntry:
    gateway_model = (snapshot.info or {}).get(alias)
    mode = gateway_model.mode if gateway_model else None
    incompatible = mode is not None and mode != "chat"
    pricing, _ = _gateway_pricing(None, gateway_model)
    paid = gateway_model is not None and any(p is not None and p > 0 for p in (gateway_model.input_price, gateway_model.output_price))
    return CatalogEntry(
        model_id=model_id,
        available=False,
        unavailable_reason="NOT_COMPATIBLE" if incompatible else "OPERATOR_APPROVAL_REQUIRED",
        settings=None,
        label=alias[:_LABEL_MAX],
        provider=(gateway_model.provider if gateway_model and gateway_model.provider else "LiteLLM"),
        status="UNSUPPORTED" if incompatible else "OPERATOR_APPROVAL_REQUIRED",
        checks={
            "discovered": True,
            "compatible": (False if incompatible else (True if mode == "chat" else None)),
            "operator_approved": False,
            "pricing_verified": False,
            "paid_authorized": False,
            "transfer_authorized": False,
        },
        pricing=pricing,
        paid=paid,
        gateway_max_input_tokens=gateway_model.max_input_tokens if gateway_model else None,
        gateway_max_output_tokens=gateway_model.max_output_tokens if gateway_model else None,
    )


def _decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.normalize(), "f")
