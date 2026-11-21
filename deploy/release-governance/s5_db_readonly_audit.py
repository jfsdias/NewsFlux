#!/usr/bin/env python3
"""S5-R1: read-only LiteLLM DB/config diagnostic of the NewsFlux S5 key and route (operator only).

Uses access that already exists on the OMV host; creates no credential:
  * the Summary container (UID 10001) derives the domain-separated key fingerprint, the configured S5
    alias and the app caps from its own environment (the virtual key never leaves that container);
  * the LiteLLM container reads its own DATABASE_URL with its installed psycopg, inside a transaction
    verified as READ ONLY (SHOW transaction_read_only = on), with SELECT statements only; it also reads
    the YAML config named on its own command line and LiteLLM's bundled local price map (no network).

Output: classification enums and counts only. Never the key, LiteLLM's token hash (a credential
equivalent), the fingerprint, aliases, deployment names, URLs, DSN, raw rows or provider settings.

THIS IS NOT AN OFFICIAL ATTESTATION. The S5 preflight accepts only `LIVE_LITELLM_ADMIN_READ`
(deploy/release-governance/s5_key_audit.py). A direct DB read is a different evidence kind
(`DIAGNOSTIC_DB_CONFIG_READONLY`) and leaves `S5_PREFLIGHT` unchanged; see docs/ops/S5_R1_READONLY_AUDIT.md.

    sudo python3 deploy/release-governance/s5_db_readonly_audit.py --litellm-container <name>

Python standard library only on the host. The probe runs inside the LiteLLM container with its own
Python, psycopg and PyYAML, already installed in the image.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

FINGERPRINT_DOMAIN = b"newsflux-s5-key-attestation-v1\x00"
APPROVED_ROUTES = frozenset({"llm_api_routes"})
WILDCARD_MODELS = frozenset({"all-proxy-models", "all-team-models", "*"})
PROVIDER_FAMILIES = {
    "openrouter": "OPENROUTER", "groq": "GROQ", "gemini": "GEMINI", "vertex_ai": "VERTEX_AI",
    "mistral": "MISTRAL", "openai": "OPENAI", "azure": "AZURE", "anthropic": "ANTHROPIC",
    "together_ai": "TOGETHER_AI", "cerebras": "CEREBRAS", "ollama": "OLLAMA", "ollama_chat": "OLLAMA",
    "huggingface": "HUGGINGFACE", "nvidia_nim": "NVIDIA_NIM", "cohere": "COHERE", "cohere_chat": "COHERE",
    "deepseek": "DEEPSEEK", "bedrock": "BEDROCK", "xai": "XAI", "fireworks_ai": "FIREWORKS_AI",
    "sambanova": "SAMBANOVA", "github": "GITHUB_MODELS", "cloudflare": "CLOUDFLARE",
}
CALLBACK_FAMILIES = {
    "langfuse", "langsmith", "datadog", "prometheus", "sentry", "s3", "gcs_bucket", "otel",
    "opentelemetry", "lunary", "helicone", "posthog", "arize", "braintrust", "mlflow", "slack",
    "email", "dynamodb", "athina", "logfire", "wandb", "langtrace", "openmeter", "lago",
    "argilla", "galileo", "supabase", "greenscale", "humanloop", "opik", "generic_api",
}
CALLBACK_KEYS = ("success_callback", "failure_callback", "callbacks", "service_callback")
FALLBACK_LISTS = {
    "fallbacks": "FALLBACK_ALIAS_RULE",
    "context_window_fallbacks": "FALLBACK_CONTEXT_WINDOW",
    "content_policy_fallbacks": "FALLBACK_CONTENT_POLICY",
}
MAX_DEPLOYMENT_ROWS = 200  # read bound; a count above it is reported as truncated, never as complete
# Approved local identities only: the compose service name and loopback. A port (e.g. 11434) never
# proves locality; any other host, IP or name is CUSTOM_ENDPOINT.
LOCAL_HOSTS = frozenset({"ollama", "localhost", "127.0.0.1", "::1"})
SAFE_NAME = re.compile(r"^[A-Z0-9_]+$")
SAFE_VALUE = re.compile(r"^(?:[A-Z0-9_]+(?:,[A-Z0-9_]+)*|\d+)$")
FLAGS_THAT_MUST_BE_OFF = ("NEWSFLUX_AI_INFERENCE_ENABLED", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER")
KEY_COLUMNS = (
    "token", "models", "allowed_routes", "blocked", "expires", "rpm_limit", "tpm_limit", "max_budget",
    "budget_duration", "spend", "aliases", "router_settings", "team_id", "budget_id", "access_group_ids",
    "policies", "object_permission_id",
)
# Present in every LiteLLM version with virtual keys; without them nothing can be classified.
REQUIRED_KEY_COLUMNS = ("token", "models", "blocked", "expires", "rpm_limit", "tpm_limit", "max_budget",
                        "budget_duration", "spend")
# Absent in older versions: when the column does not exist, that mechanism cannot widen the key.
OPTIONAL_INDIRECTION_COLUMNS = ("aliases", "router_settings", "team_id", "budget_id", "access_group_ids",
                                "policies", "object_permission_id")

Query = Callable[[str, tuple], list]


class ProbeError(Exception):
    """Detail-free code, safe to print."""


def fingerprint_token_hash(token_hash: str) -> str:
    # Identical to s5_key_audit.key_fingerprint / s5_preflight.key_fingerprint, from the token hash.
    return hashlib.sha256(FINGERPRINT_DOMAIN + token_hash.encode("ascii")).hexdigest()


# --------------------------------------------------------------------------------------------------
# Pure classifiers (run inside the LiteLLM container; also unit-tested on synthetic data).
# --------------------------------------------------------------------------------------------------
def _json_value(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", "replace")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 and number == value else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def classify_scope(models: Any, alias: str) -> str:
    """The contract is exactly ["<S5 alias>"]: one entry, that exact string. No coercion."""
    if models is None or (isinstance(models, list) and not models):
        return "UNRESTRICTED_ALL_MODELS"  # LiteLLM: empty/absent model list = every model
    if not isinstance(models, list):
        return "INVALID_TYPE"
    if any(not isinstance(item, str) for item in models):
        return "INVALID_ENTRY"
    if any(item in WILDCARD_MODELS or "*" in item for item in models):
        return "WILDCARD"
    if models == [alias]:
        return "EXACT_ALIAS"
    if len(set(models)) != len(models):
        return "DUPLICATE_ENTRIES"
    return "EXTRA_MODELS" if alias in models else "OTHER_MODEL"


def classify_key(row: Mapping[str, Any], alias: str, caps: Mapping[str, Any], now: datetime,
                 budget_row: Mapping[str, Any] | None) -> dict[str, str]:
    facts: dict[str, str] = {}
    models = row.get("models")
    facts["KEY_MODELS_COUNT"] = str(len(models) if isinstance(models, list) else 0)
    facts["KEY_SCOPE_DETAIL"] = classify_scope(models, alias)
    facts["KEY_SCOPE"] = "PASS" if facts["KEY_SCOPE_DETAIL"] == "EXACT_ALIAS" else "FAIL"

    expires = row.get("expires")
    valid = row.get("blocked") is not True
    if expires is not None:
        parsed = _time(expires)
        valid = valid and parsed is not None and parsed > now
    facts["KEY_VALIDITY"] = "PASS" if valid else "FAIL"

    if "allowed_routes" not in row:
        facts["KEY_ROUTES"] = "NOT_VERIFIED"
    else:
        routes = row.get("allowed_routes")
        facts["KEY_ROUTES"] = "PASS" if routes == sorted(APPROVED_ROUTES) else "FAIL"  # exactly, no duplicates

    limits = {name: row.get(name) for name in ("rpm_limit", "tpm_limit", "max_budget", "budget_duration")}
    source = "KEY"
    if row.get("budget_id") and budget_row:
        for name in limits:
            if limits[name] in (None, "") and budget_row.get(name) not in (None, ""):
                limits[name] = budget_row.get(name)
                source = "BUDGET_TABLE"
    facts["KEY_LIMIT_SOURCE"] = source

    rpm, tpm = _positive_int(limits["rpm_limit"]), _positive_int(limits["tpm_limit"])
    for name, value, cap in (("KEY_RPM_WITHIN_APP", rpm, _positive_int(caps.get("rpm"))),
                             ("KEY_TPM_WITHIN_APP", tpm, _positive_int(caps.get("tpm")))):
        if cap is None:
            facts[name] = "APP_CAP_MISSING"
        elif value is None:
            facts[name] = "NOT_APPLICABLE"
        else:
            facts[name] = "YES" if value <= cap else "NO"
    # Positive key limits that are also within the NewsFlux caps; a missing app cap never passes.
    within = facts["KEY_RPM_WITHIN_APP"] == "YES" and facts["KEY_TPM_WITHIN_APP"] == "YES"
    facts["KEY_RATE_LIMITS"] = "PASS" if rpm and tpm and within else "FAIL"

    max_budget, app_budget = _number(limits["max_budget"]), _number(caps.get("budget"))
    spend = _number(row.get("spend"))
    if spend is not None and (spend != spend or spend < 0):  # NaN or negative: not a usable spend
        spend = None
    facts["KEY_SPEND"] = "KNOWN" if spend is not None else "UNKNOWN"
    duration = limits["budget_duration"]
    budget_ok = (max_budget is not None and max_budget > 0 and app_budget is not None and max_budget <= app_budget
                 and isinstance(duration, str) and bool(duration.strip()))
    if not budget_ok or (spend is not None and spend >= max_budget):
        facts["KEY_BUDGET"] = "FAIL"
    elif spend is None:
        facts["KEY_BUDGET"] = "NOT_VERIFIED"  # unknown spend is never read as zero
    else:
        facts["KEY_BUDGET"] = "PASS"

    indirection = []
    for column, label in (("aliases", "ALIASES"), ("router_settings", "ROUTER_SETTINGS")):
        value = _json_value(row.get(column))
        if value is None or value == {} or value == "":
            continue
        # A non-empty mapping is a real remap/router override; any other non-empty shape cannot be
        # interpreted and is never read as "no indirection".
        indirection.append(label if isinstance(value, dict) else f"{label}_UNRECOGNIZED")
    if row.get("team_id"):
        indirection.append("TEAM")
    if row.get("access_group_ids"):
        indirection.append("ACCESS_GROUPS")
    if row.get("policies"):
        indirection.append("POLICIES")
    if row.get("object_permission_id"):
        indirection.append("OBJECT_PERMISSION")
    facts["KEY_INDIRECTION"] = ",".join(indirection) or "NONE"

    core = [facts[name] for name in ("KEY_VALIDITY", "KEY_SCOPE", "KEY_ROUTES", "KEY_RATE_LIMITS", "KEY_BUDGET")]
    if "FAIL" in core or "ALIASES" in indirection or "ROUTER_SETTINGS" in indirection:  # exact labels
        facts["KEY_POLICY_GATE"] = "FAIL"
    elif indirection or "NOT_VERIFIED" in core:
        facts["KEY_POLICY_GATE"] = "NOT_VERIFIED"  # team/access-group/policy inheritance not evaluated
    else:
        facts["KEY_POLICY_GATE"] = "PASS"
    return facts


def _provider_family(params: Mapping[str, Any]) -> str:
    provider = params.get("custom_llm_provider")
    model = params.get("model")
    if not isinstance(provider, str) or not provider:
        provider = model.split("/", 1)[0] if isinstance(model, str) and "/" in model else ""
    return PROVIDER_FAMILIES.get(provider.strip().lower(), "OTHER")


def _endpoint_class(params: Mapping[str, Any], family: str) -> str:
    base = params.get("api_base")
    if base in (None, ""):
        return "PROVIDER_DEFAULT"
    if isinstance(base, str) and not base.startswith("os.environ/"):
        try:
            parts = urlsplit(base)
            host, port = (parts.hostname or "").lower(), parts.port
        except ValueError:
            return "CUSTOM_ENDPOINT"
        if family == "OLLAMA" and host in LOCAL_HOSTS and port in (None, 11434):
            return "LOCAL_OLLAMA"
    return "CUSTOM_ENDPOINT"


def _one_or_mixed(values: Iterable[str], empty: str) -> str:
    unique = sorted(set(values))
    if not unique:
        return empty
    return unique[0] if len(unique) == 1 else "MIXED"


def _price_of(info: Any) -> str:
    info = _json_value(info) if info is not None else {}
    if not isinstance(info, dict):
        return "NOT_PUBLISHED"
    values = [info.get("input_cost_per_token"), info.get("output_cost_per_token")]
    if any(v is not None and _number(v) not in (0.0,) for v in values):
        return "NONZERO"
    return "ZERO" if all(v is not None for v in values) else "NOT_PUBLISHED"


def classify_route(deployments: list[dict[str, Any]], key_facts: Mapping[str, str],
                   cost_map: Mapping[str, Any]) -> dict[str, str]:
    facts: dict[str, str] = {}
    db = [d for d in deployments if d["source"] == "DB"]
    yaml_rows = [d for d in deployments if d["source"] == "YAML"]
    facts["DEPLOYMENTS_DB"] = str(len(db))
    facts["DEPLOYMENTS_YAML"] = str(len(yaml_rows))
    facts["DEPLOYMENT_SOURCE"] = ("DB_AND_YAML" if db and yaml_rows else "DB" if db else "YAML" if yaml_rows else "NONE")
    families, endpoints, configured, published = [], [], [], []
    blocked = 0
    for item in deployments:
        params = _json_value(item.get("litellm_params"))
        params = params if isinstance(params, dict) else {}
        family = _provider_family(params)
        families.append(family)
        endpoints.append(_endpoint_class(params, family))
        configured.append(_price_of(item.get("model_info")))
        listed = cost_map.get(params.get("model")) if isinstance(params.get("model"), str) else None
        published.append("NOT_LISTED" if not isinstance(listed, dict) else _price_of(listed).replace("NOT_PUBLISHED", "NOT_LISTED"))
        blocked += 1 if item.get("blocked") is True else 0
    facts["PROVIDER_FAMILY"] = _one_or_mixed(families, "NONE")
    facts["ENDPOINT_CLASS"] = _one_or_mixed(endpoints, "NONE")
    facts["DEPLOYMENT_BLOCKED"] = "NONE" if not blocked else ("ALL" if blocked == len(deployments) else "SOME")

    indirection = key_facts.get("KEY_INDIRECTION", "").split(",")
    if (not deployments or facts["DEPLOYMENT_BLOCKED"] == "ALL" or facts["PROVIDER_FAMILY"] == "MIXED"
            or "ALIASES" in indirection):
        facts["MODEL_ROUTE_GATE"] = "FAIL"
    elif (facts["PROVIDER_FAMILY"] == "OTHER" or facts["ENDPOINT_CLASS"] in ("CUSTOM_ENDPOINT", "MIXED")
          or facts["DEPLOYMENT_BLOCKED"] == "SOME" or "ALIASES_UNRECOGNIZED" in indirection):
        facts["MODEL_ROUTE_GATE"] = "NOT_VERIFIED"
    else:
        facts["MODEL_ROUTE_GATE"] = "PASS"

    if "NONZERO" in configured:
        facts["CONFIGURED_PRICE"] = "NONZERO"
    elif configured and all(value == "ZERO" for value in configured):
        facts["CONFIGURED_PRICE"] = "ZERO"
    else:
        facts["CONFIGURED_PRICE"] = "NOT_PUBLISHED"
    if "NONZERO" in published:
        facts["PUBLISHED_PRICE_MAP"] = "NONZERO"
    else:
        facts["PUBLISHED_PRICE_MAP"] = _one_or_mixed(published, "NOT_LISTED")
    if "NONZERO" in (facts["CONFIGURED_PRICE"], facts["PUBLISHED_PRICE_MAP"]):
        facts["PRICING_GATE"] = "FAIL"
    elif facts["CONFIGURED_PRICE"] == "ZERO":
        # A zero in LiteLLM only means zero recorded spend; real provider cost needs the terms.
        facts["PRICING_GATE"] = "NOT_VERIFIED_PROVIDER_TERMS"
    else:
        facts["PRICING_GATE"] = "NOT_VERIFIED"
    return facts


def classify_general_settings_fallbacks(blocks: Iterable[Any]) -> dict[str, str]:
    """general_settings is a persisted LiteLLM config section, but the tested proxy version consumes
    fallbacks only from router_settings / litellm_settings. A fallback key found here is reported,
    never claimed to be effective, and never allows PASS; an unknown shape is NOT_VERIFIED."""
    present = unparseable = False
    for block in blocks:
        block = _json_value(block)
        if block is None or block == {}:
            continue
        if not isinstance(block, dict):
            unparseable = True
            continue
        for key in (*FALLBACK_LISTS, "default_fallbacks"):
            value = block.get(key)
            if value is None or value == [] or value == "":
                continue
            present = True
    if present:
        return {"FALLBACK_GENERAL_SETTINGS": "PRESENT_UNVERIFIED_SEMANTICS"}
    return {"FALLBACK_GENERAL_SETTINGS": "UNRECOGNIZED" if unparseable else "NONE"}


def classify_fallbacks(settings: Iterable[Any], alias: str) -> dict[str, str]:
    found = {name: "NONE" for name in (*FALLBACK_LISTS.values(), "FALLBACK_DEFAULT_RULE")}
    unparseable = False
    for block in settings:
        block = _json_value(block)
        if block in (None, {}):
            continue
        if not isinstance(block, dict):
            unparseable = True
            continue
        for key, field in FALLBACK_LISTS.items():
            if key not in block or block[key] in (None, []):
                continue
            rules = _json_value(block[key])
            if not isinstance(rules, list) or not all(isinstance(rule, dict) for rule in rules):
                unparseable = True
                continue
            for rule in rules:
                if alias in rule:
                    found[field] = "PRESENT"
                if "*" in rule:
                    found["FALLBACK_DEFAULT_RULE"] = "PRESENT"
        default = _json_value(block.get("default_fallbacks"))
        if default not in (None, [], ""):
            found["FALLBACK_DEFAULT_RULE"] = "PRESENT" if isinstance(default, list) else found["FALLBACK_DEFAULT_RULE"]
            unparseable = unparseable or not isinstance(default, list)
    facts = dict(found)
    if "PRESENT" in found.values():
        facts["FALLBACK_GATE"] = "FAIL"
    elif unparseable:
        facts["FALLBACK_GATE"] = "NOT_VERIFIED"
    else:
        facts["FALLBACK_GATE"] = "PASS"
    return facts


def classify_callbacks(settings: Iterable[Any], allowed: Iterable[str]) -> dict[str, str]:
    """Only empty values mean "no callback". Any shape that is not a callback name (or list of names)
    is UNRECOGNIZED: never read as absence. Known names outside the allowlist FAIL."""
    names: set[str] = set()
    unrecognized = False
    for block in settings:
        block = _json_value(block)
        if block is None or block == {}:
            continue
        if not isinstance(block, dict):
            unrecognized = True
            continue
        for key in CALLBACK_KEYS:
            value = block.get(key)
            if value is None or value == "" or value == []:
                continue
            if isinstance(value, str):
                value = [value]
            if not isinstance(value, list):
                unrecognized = True
                continue
            for item in value:
                if isinstance(item, str) and item.strip():
                    names.add(item.strip().lower())
                else:
                    unrecognized = True
    allowed_set = {item.strip().lower() for item in allowed if item.strip()}
    labels = {name.upper() if name in CALLBACK_FAMILIES else "OTHER" for name in names}
    if unrecognized:
        labels.add("UNRECOGNIZED")
    if names - allowed_set:
        gate = "FAIL"
    elif unrecognized:
        gate = "NOT_VERIFIED"
    else:
        gate = "PASS"
    return {"CALLBACKS_CONFIGURED": ",".join(sorted(labels)) or "NONE", "CALLBACK_GATE": gate}


def collect(query: Query, *, fingerprint: str, alias: str, caps: Mapping[str, Any], allowed_callbacks: Iterable[str],
            now: datetime, yaml_config: Any, cost_map: Mapping[str, Any], yaml_status: str = "LOADED") -> dict[str, str]:
    rows = query("SHOW transaction_read_only", ())
    first = rows[0] if rows else None
    value = next(iter(first.values())) if isinstance(first, dict) else (first[0] if first else None)
    if str(value).lower() != "on":
        raise ProbeError("DB_NOT_READ_ONLY")
    facts: dict[str, str] = {"DB_READ_ONLY": "VERIFIED"}
    # The YAML is a required evidence source for routes, fallbacks and callbacks. Anything other than a
    # readable mapping with the expected section shapes keeps those gates from PASS.
    if yaml_status != "LOADED":
        yaml_class = yaml_status if yaml_status in ("NOT_FOUND", "UNREADABLE") else "UNREADABLE"
    elif not isinstance(yaml_config, dict):
        yaml_class = "INVALID_ROOT"
    elif (not isinstance(yaml_config.get("model_list", []), (list, type(None)))
          or not all(isinstance(entry, dict) for entry in yaml_config.get("model_list") or [])
          or any(not isinstance(yaml_config.get(name, {}), (dict, type(None)))
                 for name in ("router_settings", "litellm_settings", "general_settings"))):
        yaml_class = "INVALID_STRUCTURE"
    else:
        yaml_class = "LOADED"
    facts["YAML_CONFIG"] = yaml_class
    yaml_config = yaml_config if yaml_class == "LOADED" else {}

    existing = {row.get("column_name") for row in query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s", ("LiteLLM_VerificationToken",))}
    if not set(REQUIRED_KEY_COLUMNS) <= existing:
        raise ProbeError("DB_SCHEMA_UNSUPPORTED")
    present = [name for name in KEY_COLUMNS if name in existing]  # identifiers from a fixed allowlist only
    facts["KEY_SCHEMA"] = "FULL" if len(present) == len(KEY_COLUMNS) else "PARTIAL_OPTIONAL"
    columns = ", ".join(f'"{name}"' for name in present)
    # Exact, complete lookup inside Postgres: sha256(domain || token) = fingerprint over every row,
    # with no scan limit. LIMIT 2 only distinguishes one match from several.
    matches = query(
        f'SELECT {columns} FROM "LiteLLM_VerificationToken" '
        "WHERE encode(sha256(decode(%s, 'hex') || convert_to(\"token\", 'UTF8')), 'hex') = %s LIMIT 2",
        (FINGERPRINT_DOMAIN.hex(), fingerprint))
    matches = [row for row in matches if isinstance(row.get("token"), str)
               and fingerprint_token_hash(row["token"]) == fingerprint]  # re-check in process
    facts["KEY_LOOKUP"] = "EXACT_FINGERPRINT"
    facts["KEY_MATCH"] = "ONE" if len(matches) == 1 else ("NONE" if not matches else "MULTIPLE")
    key_row = matches[0] if len(matches) == 1 else None
    if key_row is None:
        facts.update({"KEY_POLICY_GATE": "FAIL", "KEY_INDIRECTION": "NOT_EVALUATED"})
        key_facts: dict[str, str] = {}
    else:
        budget_row = None
        if key_row.get("budget_id"):
            budgets = query('SELECT "rpm_limit", "tpm_limit", "max_budget", "budget_duration" '
                            'FROM "LiteLLM_BudgetTable" WHERE "budget_id" = %s LIMIT 1', (key_row["budget_id"],))
            budget_row = budgets[0] if budgets else None
        key_facts = classify_key(key_row, alias, caps, now, budget_row)
        facts.update(key_facts)

    total = query('SELECT count(*) AS "count" FROM "LiteLLM_ProxyModelTable" WHERE "model_name" = %s', (alias,))
    total = int((total[0] or {}).get("count", -1)) if total and isinstance(total[0], dict) else -1
    db_models = query('SELECT "model_name", "litellm_params", "model_info", "blocked" FROM "LiteLLM_ProxyModelTable" '
                      f'WHERE "model_name" = %s LIMIT {MAX_DEPLOYMENT_ROWS}', (alias,))
    truncated = total < 0 or total > len(db_models)
    deployments = [dict(row, source="DB") for row in db_models]
    for entry in yaml_config.get("model_list") or []:
        if isinstance(entry, dict) and entry.get("model_name") == alias:
            deployments.append({"litellm_params": entry.get("litellm_params"), "model_info": entry.get("model_info"),
                                "blocked": False, "source": "YAML"})
    facts.update(classify_route(deployments, key_facts, cost_map))
    if truncated:
        # Not every deployment was read: neither the route nor the price can be called complete.
        facts["DEPLOYMENTS_DB"] = "NOT_VERIFIED_TRUNCATED"
        for gate in ("MODEL_ROUTE_GATE", "PRICING_GATE"):
            if facts[gate] != "FAIL":
                facts[gate] = "NOT_VERIFIED"

    config_rows = query('SELECT "param_name", "param_value" FROM "LiteLLM_Config" '
                        "WHERE \"param_name\" IN ('router_settings', 'litellm_settings', 'general_settings')", ())
    db_config = {row.get("param_name"): _json_value(row.get("param_value")) for row in config_rows}
    router_blocks = [db_config.get("router_settings"), db_config.get("litellm_settings"),
                     yaml_config.get("router_settings"), yaml_config.get("litellm_settings")]
    if key_row is not None:
        router_blocks.append(key_row.get("router_settings"))
    facts.update(classify_fallbacks(router_blocks, alias))
    facts.update(classify_general_settings_fallbacks([db_config.get("general_settings"),
                                                       yaml_config.get("general_settings")]))
    if facts["FALLBACK_GENERAL_SETTINGS"] != "NONE" and facts["FALLBACK_GATE"] == "PASS":
        facts["FALLBACK_GATE"] = "NOT_VERIFIED"
    facts.update(classify_callbacks([db_config.get("litellm_settings"), yaml_config.get("litellm_settings")],
                                    allowed_callbacks))
    if yaml_class != "LOADED":
        for gate in ("MODEL_ROUTE_GATE", "FALLBACK_GATE", "CALLBACK_GATE"):
            if facts[gate] == "PASS":
                facts[gate] = "NOT_VERIFIED"  # one of the required sources could not be inspected
        if facts["DEPLOYMENT_SOURCE"] == "NONE" and "ALIASES" not in facts.get("KEY_INDIRECTION", "").split(","):
            # "No deployment" is only proven when every source was read; the S5 deployment may live
            # in the YAML that could not be inspected.
            facts["MODEL_ROUTE_GATE"] = "NOT_VERIFIED"
    facts.update({
        "PROVIDER_PRIVACY_GATE": "NOT_VERIFIED_OPERATOR_TERMS_REQUIRED",
        "OFFICIAL_ATTESTATION": "HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE",
        "EVIDENCE_KIND": "DIAGNOSTIC_DB_CONFIG_READONLY",
        "S5_PREFLIGHT_EFFECT": "NONE",
    })
    return facts


def render(facts: Mapping[str, Any], *, container_identity: str) -> list[str]:
    lines = []
    for name in sorted(facts):
        value = facts[name]
        if not isinstance(name, str) or not SAFE_NAME.match(name) or not isinstance(value, str) or not SAFE_VALUE.match(value):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")
        lines.append(f"S5R1_{name}={value}")
    # What the tool can honestly state: it issued no write (read-only transaction, SELECT only, -B), and
    # the containers' identity (ID, image, start time, restarts, state) is unchanged. That is not a
    # complete filesystem-integrity proof of the containers or the host.
    lines.append("S5R1_DELIBERATE_DB_CONFIG_WRITES=NONE")
    lines.append(f"S5R1_CONTAINER_IDENTITY={container_identity}")
    lines.append("S5R1_FILESYSTEM_INTEGRITY=NOT_PROVEN")
    return lines


# --------------------------------------------------------------------------------------------------
# Container side (executed inside the LiteLLM container through the host bootstrap).
# --------------------------------------------------------------------------------------------------
def _psycopg_query_factory() -> Any:
    import psycopg  # installed in the LiteLLM image
    from psycopg.rows import dict_row

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ProbeError("DB_UNAVAILABLE")
    connection = psycopg.connect(url, row_factory=dict_row, connect_timeout=5)
    connection.read_only = True  # every transaction starts as BEGIN READ ONLY; verified again with SHOW

    class Runner:
        started = False

        def __call__(self, sql: str, params: tuple) -> list:
            if not Runner.started:  # transaction-local 5 s statement timeout, set with a SELECT
                connection.execute("SELECT set_config('statement_timeout', '5000', true)")
                Runner.started = True
            return list(connection.execute(sql, params).fetchall())

        def close(self) -> None:
            try:
                connection.rollback()
            finally:
                connection.close()

    return Runner()


def _container_yaml(cmdline_path: str = "/proc/1/cmdline", environ: Mapping[str, str] | None = None) -> tuple[str, Any]:
    """(status, document). LOADED means "parsed"; the root and section shapes are judged by collect()."""
    environ = os.environ if environ is None else environ
    try:
        with open(cmdline_path, "rb") as handle:
            argv = [part.decode("utf-8", "replace") for part in handle.read().split(b"\0") if part]
    except OSError:
        argv = []
    path = None
    for index, part in enumerate(argv):
        if part == "--config" and index + 1 < len(argv):
            path = argv[index + 1]
        elif part.startswith("--config="):
            path = part.split("=", 1)[1]
    path = path or environ.get("CONFIG_FILE_PATH") or environ.get("WORKER_CONFIG")
    if not path:
        return "NOT_FOUND", {}
    try:
        import yaml  # installed in the LiteLLM image

        with open(path, encoding="utf-8") as handle:
            return "LOADED", yaml.safe_load(handle)
    except Exception:  # noqa: BLE001 - missing, unreadable or unparseable: classified, detail-free
        return "UNREADABLE", {}


def _container_cost_map() -> dict:
    import importlib.util

    spec = importlib.util.find_spec("litellm")  # locate without importing (importing may fetch remotely)
    if spec is None or not spec.submodule_search_locations:
        return {}
    for directory in spec.submodule_search_locations:
        path = os.path.join(directory, "model_prices_and_context_window_backup.json")
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            continue
    return {}


def probe_main(payload: Mapping[str, Any], *, query_factory: Callable[[], Any] = _psycopg_query_factory,
               yaml_loader: Callable[[], Any] = _container_yaml, cost_map_loader: Callable[[], Any] = _container_cost_map,
               now: datetime | None = None) -> int:
    def emit(document: Mapping[str, str]) -> None:
        print(json.dumps(dict(document), sort_keys=True))

    fingerprint, alias = payload.get("fingerprint"), payload.get("alias")
    if not (isinstance(fingerprint, str) and re.fullmatch(r"[0-9a-f]{64}", fingerprint)
            and isinstance(alias, str) and alias):
        emit({"PROBE": "INPUT_INVALID"})
        return 2
    try:
        query = query_factory()
    except Exception:  # noqa: BLE001 - never echo DSN or driver detail
        emit({"PROBE": "DB_UNAVAILABLE"})
        return 2
    try:
        loaded = yaml_loader()
        status, config = loaded if isinstance(loaded, tuple) else ("LOADED", loaded)
        facts = collect(query, fingerprint=fingerprint, alias=alias, caps=payload.get("caps") or {},
                        allowed_callbacks=payload.get("allowed_callbacks") or [], now=now or datetime.now(timezone.utc),
                        yaml_config=config, cost_map=cost_map_loader() or {}, yaml_status=status)
        render(facts, container_identity="UNCHANGED")  # refuse to emit anything that is not an enum or a count
    except ProbeError as error:
        emit({"PROBE": str(error)})
        return 2
    except Exception:  # noqa: BLE001
        emit({"PROBE": "DB_READ_FAILED"})
        return 2
    finally:
        close = getattr(query, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # noqa: BLE001
                pass
    emit(facts)
    return 0


# --------------------------------------------------------------------------------------------------
# Host side (root on the OMV host).
# --------------------------------------------------------------------------------------------------
SUMMARY_SNIPPET = r"""
import json, os
from services.article_intel_summary.litellm_adapter import load_litellm_settings
from services.article_intel_summary.s5_preflight import key_fingerprint, simulated_environment
s = load_litellm_settings(simulated_environment(os.environ))
budget = s.monthly_budget_usd
print(json.dumps({
    "fingerprint": key_fingerprint(s.virtual_key) if s.virtual_key else None,
    "alias": s.model_id,
    "caps": {"rpm": s.requests_per_minute, "tpm": s.tokens_per_minute, "budget": float(budget) if budget is not None else None},
    "allowed_callbacks": [i.strip() for i in os.environ.get("NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS", "").split(",") if i.strip()],
}))
"""
PROBE_BOOTSTRAP = (
    "import json,sys;payload=json.loads(sys.stdin.readline());source=sys.stdin.read();"
    "g={'__name__':'s5_probe'};exec(compile(source,'s5_db_readonly_audit.py','exec'),g);"
    "sys.exit(g['probe_main'](payload))"
)
SNAPSHOT_FORMAT = "{{.Id}} {{.Image}} {{.State.StartedAt}} {{.RestartCount}} {{.State.Status}}"


def _docker(argv: list[str], stdin: str | None = None) -> str:
    result = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        raise ProbeError("DOCKER_" + (argv[1].upper() if len(argv) > 1 else "CALL") + "_FAILED")
    return result.stdout


def main(argv: list[str] | None = None, *, run: Callable[..., str] = _docker, euid: int | None = None) -> int:
    parser = argparse.ArgumentParser(description="S5-R1 read-only LiteLLM DB/config diagnostic (operator only).")
    parser.add_argument("--litellm-container")
    parser.add_argument("--project", default=os.environ.get("NEWSFLUX_PROJECT", "newsflux"))
    parser.add_argument("--summary-service", default=os.environ.get("NEWSFLUX_SUMMARY_SERVICE", "summary-api"))
    args = parser.parse_args(argv)
    if (os.geteuid() if euid is None else euid) != 0:
        print("S5R1_AUDIT=HOLD_NOT_ROOT")
        return 2
    try:
        summary = run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={args.project}",
                       "--filter", f"label=com.docker.compose.service={args.summary_service}"]).split()
        if len(summary) != 1:
            raise ProbeError("SUMMARY_CONTAINER_NOT_UNIQUE")
        summary_id = summary[0]
        if args.litellm_container:
            litellm = [args.litellm_container]
        else:  # by image, not by name: a "litellm_db" Postgres container must not match
            litellm = []
            for line in run(["docker", "ps", "--format", "{{.ID}} {{.Image}}"]).splitlines():
                parts = line.split()
                image = parts[1].lower() if len(parts) == 2 else ""
                repository = image.split("@", 1)[0].rsplit(":", 1)[0]
                if repository.rsplit("/", 1)[-1] == "litellm":
                    litellm.append(parts[0])
        if len(litellm) != 1:
            raise ProbeError("LITELLM_CONTAINER_NOT_UNIQUE")
        litellm_id = litellm[0]
        environment = run(["docker", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", summary_id])
        values = dict(line.split("=", 1) for line in environment.splitlines() if "=" in line)
        if any(values.get(name, "").strip().lower() == "true" for name in FLAGS_THAT_MUST_BE_OFF):
            raise ProbeError("AI_FLAGS_NOT_OFF")
        before = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
        # -B: no bytecode is written inside the containers.
        summary_info = json.loads(run(["docker", "exec", "-u", "10001", summary_id, "python", "-B", "-c", SUMMARY_SNIPPET]))
        if not isinstance(summary_info, dict) or not isinstance(summary_info.get("fingerprint"), str):
            raise ProbeError("SUMMARY_KEY_UNAVAILABLE")
        with open(os.path.abspath(__file__), encoding="utf-8") as handle:
            source = handle.read()
        stdin = json.dumps(summary_info) + "\n" + source  # alias + fingerprint on stdin only, never argv
        raw = run(["docker", "exec", "-i", litellm_id, "python3", "-B", "-c", PROBE_BOOTSTRAP], stdin=stdin)
        after = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
        facts = json.loads(raw.strip().splitlines()[-1]) if raw.strip() else {}
        if not isinstance(facts, dict):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")
        if "PROBE" in facts:
            code = facts["PROBE"] if isinstance(facts["PROBE"], str) and SAFE_NAME.match(facts["PROBE"]) else "UNSAFE"
            raise ProbeError("PROBE_" + code)
        lines = render(facts, container_identity="UNCHANGED" if before == after else "CHANGED")
    except ProbeError as error:
        print(f"S5R1_AUDIT=HOLD_{error}")
        return 2
    except (ValueError, OSError, subprocess.SubprocessError):
        print("S5R1_AUDIT=HOLD_UNVERIFIED")
        return 2
    for line in lines:
        print(line)
    if before != after:
        print("S5R1_AUDIT=HOLD_CONTAINER_STATE_CHANGED")
        return 3
    print("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY")
    print("NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
