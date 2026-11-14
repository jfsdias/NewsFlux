"""Read-only S5 enablement preflight. No inference, no article, no write.

Run inside the Summary API container (it reuses that container's own env and key file):

    python -m services.article_intel_summary.s5_preflight [--attestation-stdin]

It simulates the exact policy the enablement override would apply (inference on, external transfer on,
model choice s5-free, paid inference and fallback off) and requires POSITIVE evidence for every gate.
Missing, unreadable or unverifiable evidence never passes.

Gates (PASS | FAIL | NOT_VERIFIED):

  local       KEY_FILE_GATE, POLICY_READY_GATE, CONFIGURED_PRICE_ZERO_GATE, BUDGET_GATE,
              PAID_MODEL_BLOCKED_GATE
  catalog     CATALOG_ACCESS_GATE  the key can list models and the S5 alias is listed (/v1/models).
              This proves catalog access only. It is never evidence of scope, budget or validity.
  key         KEY_VALIDITY_GATE    active, not blocked, not expired
              KEY_SCOPE_GATE       the key's model list is exactly {S5 alias}: an empty list means
                                   "all models" in LiteLLM and fails, as do wildcards and extra models
              KEY_BUDGET_GATE      0 < max_budget <= NEWSFLUX_AI_MONTHLY_BUDGET_USD, a budget window,
                                   and spend below max_budget
              KEY_RATE_LIMIT_GATE  positive tpm_limit and rpm_limit at the gateway
  pricing     PRICING_GATE         every S5 deployment publishes explicit zero input/output cost at the
                                   gateway AND the operator confirmed the provider's real cost is zero.
                                   Unpublished prices (NOT_PUBLISHED) are not zero-cost evidence.
  logging     LOGGING_GATE         LiteLLM success callbacks within NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS

Key evidence, in order:
  1. SELF_INTROSPECTION  GET /key/info with the key itself. A least-privilege key whose allowed_routes
                         exclude management/info routes gets HTTP 403 here; that is expected and is not
                         proof the key is invalid for inference.
  2. ADMIN_ATTESTATION   a document produced separately by the operator with a read-only admin
                         credential on the host (deploy/release-governance/s5_key_audit.py), passed on
                         stdin. It is bound to this key by a domain-separated fingerprint, must be fresh
                         and must come from a live read. The admin credential never enters this container.
  When the gateway answers /key/info itself, that live answer wins over any document.

Output: gate names and non-secret classifications only. Never the key, its LiteLLM token hash, the
gateway URL or a full fingerprint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, TextIO
from urllib.parse import urlsplit

from services.article_intel_summary.litellm_adapter import (
    MODEL_CHOICE_S5_FREE,
    LiteLLMSettings,
    load_litellm_settings,
)

ENABLE_POLICY = {
    "NEWSFLUX_AI_INFERENCE_ENABLED": "true",
    "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "true",
    "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": MODEL_CHOICE_S5_FREE,
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
    "NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK": "false",
}
MAX_RESPONSE_BYTES = 256 * 1024
MAX_ATTESTATION_BYTES = 64 * 1024
ATTESTATION_SCHEMA = "newsflux-s5-key-attestation-v1"
ATTESTATION_EVIDENCE_KIND = "LIVE_LITELLM_ADMIN_READ"
ATTESTATION_MAX_AGE = timedelta(hours=24)
FINGERPRINT_DOMAIN = b"newsflux-s5-key-attestation-v1\x00"
WILDCARD_SCOPES = frozenset({"*", "all-proxy-models", "all-team-models"})

PASS, FAIL, NOT_VERIFIED = "PASS", "FAIL", "NOT_VERIFIED"

Getter = Callable[[str], Any]


class GatewayHTTPError(RuntimeError):
    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP_{status}")
        self.status = status


def key_fingerprint(virtual_key: str) -> str:
    """Domain-separated digest of LiteLLM's token hash (sha256 of the key).

    LiteLLM looks keys up by sha256(key) and may accept that hash where a key is expected, so the hash
    itself is credential-equivalent and is never written anywhere. This fingerprint is a one-way
    digest of it, useless as a credential, and the same value on both sides of the attestation.
    """
    token_hash = hashlib.sha256(virtual_key.encode("utf-8")).hexdigest()
    return hashlib.sha256(FINGERPRINT_DOMAIN + token_hash.encode("ascii")).hexdigest()


def simulated_environment(environ: Mapping[str, str]) -> dict[str, str]:
    values = dict(environ)
    values.update(ENABLE_POLICY)
    return values


def _gateway_getter(settings: LiteLLMSettings) -> Getter:
    import httpx  # imported here so the evaluation logic is importable without the HTTP stack

    client = httpx.Client(transport=httpx.HTTPTransport(retries=0), follow_redirects=False, timeout=10)

    def get(path: str) -> Any:
        url = f"{settings.gateway_base_url}{path}"
        headers = {"Authorization": f"Bearer {settings.virtual_key}", "Accept": "application/json"}
        extensions: dict[str, str] = {}
        if settings.private_docker_peer == "npm":
            host = urlsplit(settings.gateway_base_url).hostname or ""
            url = f"https://npm{path}"
            headers["Host"] = host
            extensions["sni_hostname"] = host
        request = client.build_request("GET", url, headers=headers, extensions=extensions)
        response = client.send(request, stream=True, follow_redirects=False)
        try:
            if response.status_code != 200:
                raise GatewayHTTPError(response.status_code)
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("RESPONSE_TOO_LARGE")
        finally:
            response.close()
        return json.loads(body.decode("utf-8"))

    return get


def _access_class(error: BaseException) -> str:
    if isinstance(error, GatewayHTTPError):
        return f"HTTP_{error.status}"
    return "ERROR"


def _number(value: Any) -> float | None:
    # bool is an int subclass; a JSON string is not a number. Both are rejected.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def evaluate_validity(info: Mapping[str, Any], now: datetime) -> str:
    if "status" not in info and "expires" not in info and "blocked" not in info:
        return NOT_VERIFIED
    if "status" in info and info["status"] != "active":
        return FAIL
    if info.get("blocked") is True:
        return FAIL
    expires = info.get("expires")
    if expires is not None:
        parsed = _parse_time(expires)
        if parsed is None or parsed <= now:
            return FAIL
    return PASS


def evaluate_scope(info: Mapping[str, Any], alias: str) -> str:
    if "models" not in info:
        return NOT_VERIFIED
    models = info["models"]
    if not isinstance(models, list) or not models:
        return FAIL  # LiteLLM treats an empty/absent model list as "all models"
    for item in models:
        if not isinstance(item, str) or item in WILDCARD_SCOPES or "*" in item:
            return FAIL
    return PASS if set(models) == {alias} else FAIL


def evaluate_budget(info: Mapping[str, Any], settings: LiteLLMSettings) -> str:
    if "max_budget" not in info:
        return NOT_VERIFIED
    max_budget = _number(info.get("max_budget"))
    spend = _number(info.get("spend"))
    duration = info.get("budget_duration")
    app_budget = settings.monthly_budget_usd
    if max_budget is None or max_budget <= 0:
        return FAIL
    if app_budget is None or Decimal(str(max_budget)) > app_budget:
        return FAIL
    if not isinstance(duration, str) or not duration.strip():
        return FAIL
    if spend is None or spend >= max_budget:
        return FAIL
    return PASS


def evaluate_rate_limits(info: Mapping[str, Any]) -> str:
    if "tpm_limit" not in info and "rpm_limit" not in info:
        return NOT_VERIFIED
    for name in ("tpm_limit", "rpm_limit"):
        value = info.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return FAIL
    return PASS


def classify_prices(entries: list[Mapping[str, Any]]) -> str:
    """ZERO only when every deployment publishes explicit zero input and output cost."""
    if not entries:
        return "NOT_PUBLISHED"
    published_all = True
    for entry in entries:
        for field in ("input_cost_per_token", "output_cost_per_token"):
            value = entry.get(field)
            if value is None:
                published_all = False
                continue
            number = _number(value)
            if number is None or number != 0:
                return "NONZERO"
    return "ZERO" if published_all else "NOT_PUBLISHED"


def validate_attestation(document: Any, virtual_key: str, alias: str, now: datetime) -> tuple[str, dict[str, Any] | None]:
    if not isinstance(document, dict) or not isinstance(document.get("key"), dict):
        return "REJECTED_MALFORMED", None
    if document.get("schema") != ATTESTATION_SCHEMA:
        return "REJECTED_SCHEMA", None
    if document.get("evidence_kind") != ATTESTATION_EVIDENCE_KIND:
        return "REJECTED_NOT_LIVE", None
    if document.get("key_fingerprint") != key_fingerprint(virtual_key):
        return "REJECTED_KEY_MISMATCH", None
    if document.get("alias") != alias:
        return "REJECTED_ALIAS_MISMATCH", None
    captured = _parse_time(document.get("captured_at"))
    if captured is None:
        return "REJECTED_MALFORMED", None
    if captured > now + timedelta(minutes=5):
        return "REJECTED_FUTURE", None
    if now - captured > ATTESTATION_MAX_AGE:
        return "REJECTED_STALE", None
    return "ACCEPTED", document


def run(
    environ: Mapping[str, str],
    get: Getter | None = None,
    *,
    attestation: Any = None,
    now: datetime | None = None,
) -> dict[str, str]:
    now = now or datetime.now(timezone.utc)
    gates: dict[str, str] = {}
    simulated = simulated_environment(environ)
    settings = load_litellm_settings(simulated)
    gates["KEY_FILE_GATE"] = PASS if settings.virtual_key else FAIL
    gates["POLICY_READY_GATE"] = PASS if settings.is_ready() else FAIL
    zero = (settings.input_price_usd_per_million == Decimal(0)) and (settings.output_price_usd_per_million == Decimal(0))
    gates["CONFIGURED_PRICE_ZERO_GATE"] = PASS if zero else FAIL
    budget_ok = (
        settings.monthly_budget_usd is not None
        and settings.monthly_budget_usd > 0
        and bool(settings.max_input_tokens)
        and bool(settings.max_output_tokens)
        and settings.max_output_tokens <= 2048
        and bool(settings.requests_per_minute)
        and bool(settings.tokens_per_minute)
    )
    gates["BUDGET_GATE"] = PASS if budget_ok else FAIL
    paid = load_litellm_settings({**simulated, "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "mistral-small"})
    gates["PAID_MODEL_BLOCKED_GATE"] = PASS if not paid.is_ready() else FAIL
    if not settings.virtual_key or not settings.is_ready():
        gates["GATEWAY_GATES"] = "NOT_RUN"
        return gates
    get = get or _gateway_getter(settings)
    alias = settings.model_id
    gates["KEY_FINGERPRINT_PREFIX"] = key_fingerprint(settings.virtual_key)[:12]

    # 1. Catalog access only.
    try:
        models = {item.get("id") for item in get("/v1/models").get("data", []) if isinstance(item, dict)}
        gates["CATALOG_ACCESS_GATE"] = PASS if alias in models else FAIL
    except Exception as error:  # noqa: BLE001 - detail-free classification only
        gates["CATALOG_ACCESS"] = _access_class(error)
        gates["CATALOG_ACCESS_GATE"] = FAIL

    # 2. Key evidence: live self-introspection first, then a bound operator attestation.
    accepted: dict[str, Any] | None = None
    if attestation is not None:
        status, accepted = validate_attestation(attestation, settings.virtual_key, alias, now)
        gates["ATTESTATION"] = status
    else:
        gates["ATTESTATION"] = "NONE"

    info: Mapping[str, Any] | None = None
    try:
        payload = get("/key/info")
        candidate = payload.get("info") if isinstance(payload, dict) else None
        if isinstance(candidate, dict):
            info = candidate
            gates["KEY_INFO_ACCESS"] = "OK"
            gates["KEY_EVIDENCE_SOURCE"] = "SELF_INTROSPECTION"
        else:
            gates["KEY_INFO_ACCESS"] = "MALFORMED"
    except Exception as error:  # noqa: BLE001
        gates["KEY_INFO_ACCESS"] = _access_class(error)
    if info is None and accepted is not None:
        info = accepted["key"]
        gates["KEY_EVIDENCE_SOURCE"] = "ADMIN_ATTESTATION"
    if info is None:
        gates["KEY_EVIDENCE_SOURCE"] = "NONE"
        for name in ("KEY_VALIDITY_GATE", "KEY_SCOPE_GATE", "KEY_BUDGET_GATE", "KEY_RATE_LIMIT_GATE"):
            gates[name] = NOT_VERIFIED
    else:
        gates["KEY_VALIDITY_GATE"] = evaluate_validity(info, now)
        gates["KEY_SCOPE_GATE"] = evaluate_scope(info, alias)
        gates["KEY_BUDGET_GATE"] = evaluate_budget(info, settings)
        gates["KEY_RATE_LIMIT_GATE"] = evaluate_rate_limits(info)
        routes = info.get("allowed_routes")
        gates["KEY_ROUTES"] = "RESTRICTED" if isinstance(routes, list) and routes else "UNRESTRICTED"

    # 3. Pricing: explicit zero at the gateway AND the operator's confirmation of real provider cost.
    gateway_price = "NOT_PUBLISHED"
    try:
        entries = [
            (item.get("model_info") or {})
            for item in get("/model/info").get("data", [])
            if isinstance(item, dict) and item.get("model_name") == alias
        ]
        gateway_price = classify_prices(entries)
        gates["MODEL_INFO_ACCESS"] = "OK"
    except Exception as error:  # noqa: BLE001
        gates["MODEL_INFO_ACCESS"] = _access_class(error)
    if gateway_price == "NOT_PUBLISHED" and accepted is not None and isinstance(accepted.get("pricing"), list):
        attested = [entry for entry in accepted["pricing"] if isinstance(entry, dict)]
        if len(attested) == len(accepted["pricing"]):
            gateway_price = classify_prices(attested)
    gates["GATEWAY_PRICE"] = gateway_price
    operator = (accepted or {}).get("operator")
    provider_confirmed = isinstance(operator, dict) and operator.get("provider_cost_zero_confirmed") is True
    gates["PROVIDER_COST_CONFIRMATION"] = "OPERATOR_CONFIRMED" if provider_confirmed else "MISSING"
    if gateway_price == "NONZERO":
        gates["PRICING_GATE"] = FAIL
    elif gateway_price == "ZERO" and provider_confirmed:
        gates["PRICING_GATE"] = PASS
    else:
        gates["PRICING_GATE"] = NOT_VERIFIED

    # 4. Logging.
    try:
        readiness = get("/health/readiness")
        callbacks = sorted(str(item) for item in readiness.get("success_callbacks") or [])
        allowed_callbacks = {
            item.strip() for item in environ.get("NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS", "").split(",") if item.strip()
        }
        gates["LITELLM_CALLBACKS"] = ",".join(callbacks) or "NONE"
        gates["LOGGING_GATE"] = PASS if set(callbacks) <= allowed_callbacks else FAIL
    except Exception:  # noqa: BLE001
        gates["LOGGING_GATE"] = NOT_VERIFIED
    return gates


REQUIRED_GATES = (
    "KEY_FILE_GATE",
    "POLICY_READY_GATE",
    "CONFIGURED_PRICE_ZERO_GATE",
    "BUDGET_GATE",
    "PAID_MODEL_BLOCKED_GATE",
    "CATALOG_ACCESS_GATE",
    "KEY_VALIDITY_GATE",
    "KEY_SCOPE_GATE",
    "KEY_BUDGET_GATE",
    "KEY_RATE_LIMIT_GATE",
    "PRICING_GATE",
    "LOGGING_GATE",
)


def overall(gates: Mapping[str, str]) -> bool:
    return all(gates.get(name) == PASS for name in REQUIRED_GATES)


def _read_attestation(stdin: TextIO) -> Any:
    raw = stdin.read(MAX_ATTESTATION_BYTES + 1)
    if len(raw) > MAX_ATTESTATION_BYTES:
        raise ValueError("too large")
    return json.loads(raw)


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    get: Getter | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    now: datetime | None = None,
) -> int:
    parser = argparse.ArgumentParser(description="Read-only S5 enablement preflight.")
    parser.add_argument("--attestation-stdin", action="store_true", help="read the operator key attestation from stdin")
    args = parser.parse_args(argv)
    out = stdout or sys.stdout
    document: Any = None
    malformed = False
    if args.attestation_stdin:
        try:
            document = _read_attestation(stdin or sys.stdin)
        except (ValueError, UnicodeDecodeError):
            malformed = True
    gates = run(environ if environ is not None else os.environ, get, attestation=document, now=now)
    if malformed:
        gates["ATTESTATION"] = "REJECTED_MALFORMED"
    for name, value in gates.items():
        print(f"{name}={value}", file=out)
    ok = overall(gates) and not malformed
    print(f"S5_PREFLIGHT={'PASS' if ok else 'BLOCKED'}", file=out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
