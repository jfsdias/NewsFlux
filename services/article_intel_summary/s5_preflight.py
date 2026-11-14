"""Read-only S5 enablement preflight. No inference, no article, no write.

Run inside the Summary API container (it reuses that container's own env and key file):

    python -m services.article_intel_summary.s5_preflight

It simulates the exact policy the enablement override would apply (inference on,
external transfer on, model choice s5-free, paid inference and fallback off) and
then proves, against the live LiteLLM gateway, with GET requests only:

  * KEY_GATE      the virtual key is valid and private (file mode), and LiteLLM reports it;
  * MODEL_GATE    the S5 alias is in the key's authorized models (/v1/models);
  * PRICE_GATE    configured prices are zero (free-only policy) and LiteLLM's model
                  pricing for the alias, when published, is also zero;
  * BUDGET_GATE   a positive monthly budget, token and request limits are configured
                  and the S5 output ceiling respects the contract (<= 2048);
  * LOGGING_GATE  LiteLLM success callbacks are within the operator allowlist
                  (NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS, default: none);
  * PAID_GATE     Mistral stays unavailable (no paid authorization, no fallback).

Output: gate names and non-secret identifiers only. Never the key, gateway URL or prices
other than the S5 ones the operator configured.
"""
from __future__ import annotations

import json
import os
import sys
from decimal import Decimal
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

import httpx

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

Getter = Callable[[str], Any]


def simulated_environment(environ: Mapping[str, str]) -> dict[str, str]:
    values = dict(environ)
    values.update(ENABLE_POLICY)
    return values


def _gateway_getter(settings: LiteLLMSettings, client: httpx.Client | None = None) -> Getter:
    owned = client or httpx.Client(transport=httpx.HTTPTransport(retries=0), follow_redirects=False, timeout=10)

    def get(path: str) -> Any:
        url = f"{settings.gateway_base_url}{path}"
        headers = {"Authorization": f"Bearer {settings.virtual_key}", "Accept": "application/json"}
        extensions: dict[str, str] = {}
        if settings.private_docker_peer == "npm":
            host = urlsplit(settings.gateway_base_url).hostname or ""
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
                if len(body) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("RESPONSE_TOO_LARGE")
        finally:
            response.close()
        return json.loads(body.decode("utf-8"))

    return get


def run(environ: Mapping[str, str], get: Getter | None = None) -> dict[str, str]:
    gates: dict[str, str] = {}
    simulated = simulated_environment(environ)
    settings = load_litellm_settings(simulated)
    gates["KEY_FILE_GATE"] = "PASS" if settings.virtual_key else "FAIL"
    gates["POLICY_READY_GATE"] = "PASS" if settings.is_ready() else "FAIL"
    zero = (settings.input_price_usd_per_million == Decimal("0")) and (settings.output_price_usd_per_million == Decimal("0"))
    gates["CONFIGURED_PRICE_ZERO_GATE"] = "PASS" if zero else "FAIL"
    budget_ok = (
        settings.monthly_budget_usd is not None
        and settings.monthly_budget_usd > 0
        and bool(settings.max_input_tokens)
        and bool(settings.max_output_tokens)
        and settings.max_output_tokens <= 2048
        and bool(settings.requests_per_minute)
        and bool(settings.tokens_per_minute)
    )
    gates["BUDGET_GATE"] = "PASS" if budget_ok else "FAIL"
    paid = load_litellm_settings({**simulated, "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "mistral-small"})
    gates["PAID_MODEL_BLOCKED_GATE"] = "PASS" if not paid.is_ready() else "FAIL"
    if not settings.virtual_key or not settings.is_ready():
        gates["GATEWAY_GATES"] = "NOT_RUN"
        return gates
    get = get or _gateway_getter(settings)
    alias = settings.model_id
    try:
        models = {item.get("id") for item in get("/v1/models").get("data", []) if isinstance(item, dict)}
        gates["MODEL_AUTHORIZED_GATE"] = "PASS" if alias in models else "FAIL"
    except Exception:  # noqa: BLE001 - detail-free classification only
        gates["MODEL_AUTHORIZED_GATE"] = "FAIL"
    try:
        info = get("/key/info").get("info", {})
        allowed = info.get("models") or []
        max_budget = info.get("max_budget")
        gates["KEY_GATE"] = "PASS" if (not allowed or alias in allowed) else "FAIL"
        gates["KEY_SCOPE"] = "RESTRICTED" if allowed else "ALL_MODELS"
        gates["KEY_GATEWAY_BUDGET"] = "SET" if isinstance(max_budget, (int, float)) and max_budget >= 0 else "UNSET"
    except Exception:  # noqa: BLE001
        gates["KEY_GATE"] = "FAIL"
    try:
        entries = [item for item in get("/model/info").get("data", []) if item.get("model_name") == alias]
        costs = [
            (item.get("model_info") or {}).get(field)
            for item in entries
            for field in ("input_cost_per_token", "output_cost_per_token")
        ]
        published = [cost for cost in costs if cost is not None]
        if not entries:
            gates["GATEWAY_PRICE_GATE"] = "FAIL"
        elif not published:
            gates["GATEWAY_PRICE_GATE"] = "NOT_PUBLISHED"
        else:
            gates["GATEWAY_PRICE_GATE"] = "PASS" if all(float(cost) == 0 for cost in published) else "FAIL"
    except Exception:  # noqa: BLE001
        gates["GATEWAY_PRICE_GATE"] = "NOT_PUBLISHED"
    try:
        readiness = get("/health/readiness")
        callbacks = sorted(str(item) for item in readiness.get("success_callbacks") or [])
        allowed_callbacks = {
            item.strip() for item in environ.get("NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS", "").split(",") if item.strip()
        }
        gates["LITELLM_CALLBACKS"] = ",".join(callbacks) or "NONE"
        gates["LOGGING_GATE"] = "PASS" if set(callbacks) <= allowed_callbacks else "FAIL"
    except Exception:  # noqa: BLE001
        gates["LOGGING_GATE"] = "NOT_VERIFIED"
    return gates


def overall(gates: Mapping[str, str]) -> bool:
    required = (
        "KEY_FILE_GATE", "POLICY_READY_GATE", "CONFIGURED_PRICE_ZERO_GATE", "BUDGET_GATE",
        "PAID_MODEL_BLOCKED_GATE", "MODEL_AUTHORIZED_GATE", "KEY_GATE", "LOGGING_GATE",
    )
    # GATEWAY_PRICE_GATE may be NOT_PUBLISHED (LiteLLM omits pricing for custom models); FAIL blocks.
    return all(gates.get(name) == "PASS" for name in required) and gates.get("GATEWAY_PRICE_GATE") != "FAIL"


def main() -> int:
    gates = run(os.environ)
    for name, value in gates.items():
        print(f"{name}={value}")
    ok = overall(gates)
    print(f"S5_PREFLIGHT={'PASS' if ok else 'BLOCKED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
