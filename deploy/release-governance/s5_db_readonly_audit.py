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
import stat
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

# ---- S5-R3 read-only increment ------------------------------------------------------------------
# Versions whose schema and semantics were rehearsed in the disposable lab. Anything else is reported
# and keeps KEY_POLICY_GATE_R3 from PASS until it has been rehearsed. 1.110.0 (the production image,
# ghcr.io/berriai/litellm-database@sha256:eb7a0adf…143a, config sha256:95017a67…f5ab) was admitted in
# S5-R3 after both lab harnesses passed on that exact image and the user_api_key_auth.py diff was reviewed.
# Admission is diagnostic only: it never approves a production configuration.
LAB_REHEARSED_VERSIONS = frozenset({"1.109.1", "1.110.0"})
# Every column of LiteLLM_VerificationToken in the rehearsed version (1.109.1). An extra column is an
# unknown mechanism; a missing one is a different schema. Neither is ever presumed safe.
R3_KNOWN_KEY_COLUMNS = (
    "token", "key_name", "key_alias", "soft_budget_cooldown", "spend", "expires", "models", "aliases", "config",
    "user_id", "team_id", "permissions", "max_parallel_requests", "metadata", "blocked", "tpm_limit", "rpm_limit",
    "max_budget", "budget_duration", "budget_reset_at", "allowed_cache_controls", "model_spend", "model_max_budget",
    "budget_id", "organization_id", "created_at", "created_by", "updated_at", "updated_by", "allowed_routes",
    "object_permission_id", "auto_rotate", "key_rotation_at", "last_rotation_at", "rotation_count",
    "rotation_interval", "project_id", "router_settings", "policies", "access_group_ids", "last_active", "agent_id",
    "budget_limits", "budget_fallbacks", "key_type", "settings_updated_at", "tpd_limit", "total_spend",
)
# Extra columns read by R3, from a fixed allowlist. `key_name` (a key fragment) and `metadata` (free
# form) are never selected; an unknown column is counted from information_schema, never read.
R3_EXTRA_KEY_COLUMNS = ("key_alias", "budget_reset_at", "user_id", "organization_id", "project_id", "agent_id",
                        "permissions", "config", "budget_fallbacks", "model_max_budget", "budget_limits", "tpd_limit",
                        "max_parallel_requests", "key_type")
# Mechanisms that can widen or redirect what the key may do (not evaluated: reported, R3 gate NOT_VERIFIED).
R3_EXTRA_INDIRECTION = (("user_id", "USER"), ("organization_id", "ORGANIZATION"), ("project_id", "PROJECT"),
                        ("agent_id", "AGENT"), ("permissions", "PERMISSIONS"), ("config", "CONFIG"),
                        ("budget_fallbacks", "BUDGET_FALLBACKS"))
# Mechanisms that only restrict further (reported for the record).
R3_EXTRA_LIMITS = (("model_max_budget", "MODEL_MAX_BUDGET"), ("budget_limits", "BUDGET_LIMITS"),
                   ("tpd_limit", "TPD_LIMIT"), ("max_parallel_requests", "MAX_PARALLEL_REQUESTS"))
R3_KEY_TYPES = {"default": "DEFAULT", "llm_api": "LLM_API", "management": "MANAGEMENT", "read_only": "READ_ONLY"}
OBJPERM_KNOWN_COLUMNS = ("object_permission_id", "mcp_servers", "vector_stores", "mcp_access_groups",
                         "mcp_tool_permissions", "agents", "agent_access_groups", "blocked_tools", "models",
                         "mcp_toolsets", "search_tools", "mcp_tool_search_enabled", "skills")
OBJPERM_LIST_GRANTS = ("mcp_servers", "vector_stores", "mcp_access_groups", "agents", "agent_access_groups", "models",
                       "mcp_toolsets", "search_tools", "skills")
DURATION_PATTERN = re.compile(r"^(\d+)(s|m|h|d|w|mo)$")
# Private prestate: an allowlist of policy fields only. Never token, key_name, metadata, config or
# permissions; secret-looking values are redacted even inside allowed fields.
PRESTATE_KEY_FIELDS = (
    "key_alias", "models", "allowed_routes", "blocked", "expires", "rpm_limit", "tpm_limit", "max_budget",
    "budget_duration", "budget_reset_at", "spend", "aliases", "router_settings", "team_id", "budget_id",
    "access_group_ids", "policies", "object_permission_id", "agent_id", "user_id", "organization_id", "project_id",
    "budget_fallbacks", "model_max_budget", "budget_limits", "tpd_limit", "max_parallel_requests", "key_type",
)
PRESTATE_FORMAT = "newsflux-s5-r3-private-prestate-v1"
SECRET_LIKE = re.compile(r"^(?:sk-|os\.environ/)|://|^[0-9a-f]{64}$", re.IGNORECASE)

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


def _effective_limits(row: Mapping[str, Any], budget_row: Mapping[str, Any] | None) -> tuple[dict[str, Any], str]:
    limits = {name: row.get(name) for name in ("rpm_limit", "tpm_limit", "max_budget", "budget_duration")}
    source = "KEY"
    if row.get("budget_id") and budget_row:
        for name in limits:
            if limits[name] in (None, "") and budget_row.get(name) not in (None, ""):
                limits[name] = budget_row.get(name)
                source = "BUDGET_TABLE"
    return limits, source


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

    limits, source = _effective_limits(row, budget_row)
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


# ---- S5-R3 classifiers (pure; enums and counts only) ----------------------------------------------
def _finite(value: Any) -> float | None:
    number = _number(value)
    return number if number is not None and number == number and number not in (float("inf"), float("-inf")) else None


def _rate_detail(value: Any, cap: Any) -> str:
    if value is None or value == "":
        return "MISSING"
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not value.is_integer()):
        return "NON_INTEGER"  # same acceptance as the R1 _positive_int: integers (or integral floats) only
    if value <= 0:
        return "NONPOSITIVE"
    cap = _positive_int(cap)
    if cap is None:
        return "APP_CAP_MISSING"
    return "ABOVE_APP_CAP" if value > cap else "OK"


def _duration_detail(value: Any) -> tuple[str, str | None]:
    """(detail, cause). Mirrors LiteLLM's parser classes; a string it cannot parse falls back to a daily
    reset in LiteLLM, so it is reported, never treated as the monthly window."""
    if value is None:
        return "MISSING", "BUDGET_DURATION_MISSING"
    if not isinstance(value, str):
        return "UNRECOGNIZED", "BUDGET_DURATION_INVALID_TYPE"
    text = value.strip().lower()
    if not text:
        return "BLANK", "BUDGET_DURATION_BLANK"
    match = DURATION_PATTERN.match(text)
    if not match or int(match.group(1)) == 0:
        return "UNRECOGNIZED", "BUDGET_DURATION_UNRECOGNIZED"
    if text in ("30d", "1mo"):
        return "CALENDAR_MONTH", None
    if text == "1d":
        return "DAILY", None
    if text in ("7d", "1w"):
        return "WEEKLY", None
    return "OTHER_WINDOW", None


def classify_budget_detail(limits: Mapping[str, Any], spend_value: Any, caps: Mapping[str, Any]) -> dict[str, str]:
    """The exact cause(s) behind KEY_BUDGET; consistent with classify_key by construction."""
    causes: list[str] = []
    raw = limits.get("max_budget")
    app = _finite(caps.get("budget"))
    if app is None:
        app_class = "MISSING" if caps.get("budget") in (None, "") else "INVALID"
    else:
        app_class = "PRESENT" if app > 0 else "INVALID"
    if app_class != "PRESENT":
        causes.append(f"APP_BUDGET_CAP_{app_class}")
    max_budget = _finite(raw)
    if raw is None or raw == "":
        detail = "MISSING"
    elif max_budget is None:
        detail = "INVALID"
    elif max_budget <= 0:
        detail = "NONPOSITIVE"
    elif app_class != "PRESENT":
        detail = "APP_CAP_MISSING"
    elif max_budget > app:
        detail = "ABOVE_APP_CAP"
    else:
        detail = "OK"
    if detail in ("MISSING", "INVALID", "NONPOSITIVE", "ABOVE_APP_CAP"):
        causes.append(f"MAX_BUDGET_{detail}")
    duration, duration_cause = _duration_detail(limits.get("budget_duration"))
    if duration_cause:
        causes.append(duration_cause)
    spend = _number(spend_value)
    if spend is not None and (spend != spend or spend < 0):
        spend = None
    if spend is None:
        versus = "NOT_APPLICABLE"
        causes.append("SPEND_UNKNOWN")
    elif max_budget is None or max_budget <= 0:
        versus = "NOT_APPLICABLE"
        if max_budget is not None and spend >= max_budget:
            causes.append("SPEND_AT_OR_ABOVE_MAX")
    else:
        versus = "AT_OR_ABOVE" if spend >= max_budget else "BELOW"
        if versus == "AT_OR_ABOVE":
            causes.append("SPEND_AT_OR_ABOVE_MAX")
    return {"KEY_MAX_BUDGET": detail, "KEY_BUDGET_DURATION": duration, "KEY_SPEND_VS_MAX": versus,
            "APP_BUDGET_CAP": app_class, "KEY_BUDGET_CAUSE": ",".join(sorted(set(causes))) or "NONE"}


def classify_scope_token(models: Any) -> str:
    if not isinstance(models, list):
        return "NONE"
    tokens = set()
    for item in models:
        if not isinstance(item, str):
            continue
        if item == "all-proxy-models":
            tokens.add("ALL_PROXY_MODELS")
        elif item == "all-team-models":
            tokens.add("ALL_TEAM_MODELS")
        elif item == "*":
            tokens.add("STAR")
        elif "*" in item:
            tokens.add("CONTAINS_STAR")
    return ",".join(sorted(tokens)) or "NONE"


def _nonempty(value: Any) -> str | None:
    """None when empty, "OK" for a recognized non-empty shape, "UNRECOGNIZED" otherwise."""
    value = _json_value(value)
    if value is None or value == "" or value == {} or value == [] or value is False:
        return None
    if isinstance(value, (dict, list)) or (isinstance(value, str) and value.strip()) or \
            (isinstance(value, (int, float)) and not isinstance(value, bool)):
        return "OK"
    return "UNRECOGNIZED"


def classify_extra_mechanisms(row: Mapping[str, Any], existing: Iterable[str]) -> dict[str, str]:
    existing = set(existing)
    widening, limiting = [], []
    for column, label in R3_EXTRA_INDIRECTION:
        state = _nonempty(row.get(column))
        if column == "config" and state == "OK" and not isinstance(_json_value(row.get(column)), dict):
            state = "UNRECOGNIZED"
        if state:
            widening.append(label if state == "OK" else f"{label}_UNRECOGNIZED")
    for column, label in R3_EXTRA_LIMITS:
        state = _nonempty(row.get(column))
        if state:
            limiting.append(label if state == "OK" else f"{label}_UNRECOGNIZED")
    if "agent_id" not in existing:
        agent = "COLUMN_ABSENT"
    else:
        agent = "PRESENT" if _nonempty(row.get("agent_id")) else "NONE"
    key_type = row.get("key_type")
    return {"KEY_EXTRA_INDIRECTION": ",".join(sorted(widening)) or "NONE",
            "KEY_EXTRA_LIMITS": ",".join(sorted(limiting)) or "NONE",
            "KEY_AGENT_ID": agent,
            "KEY_TYPE": "NONE" if key_type in (None, "") else R3_KEY_TYPES.get(str(key_type).lower(), "OTHER")}


def classify_schema(existing: Iterable[str], known: Iterable[str], prefix: str) -> dict[str, str]:
    existing, known = set(existing), set(known)
    unknown, missing = len(existing - known), len(known - existing)
    compat = ("LAB_EXACT" if not unknown and not missing else "UNKNOWN_COLUMNS" if not missing
              else "MISSING_COLUMNS" if not unknown else "UNKNOWN_AND_MISSING_COLUMNS")
    return {f"{prefix}_SCHEMA_COLUMNS": str(len(existing)), f"{prefix}_SCHEMA_UNKNOWN_COLUMNS": str(unknown),
            f"{prefix}_SCHEMA_MISSING_KNOWN": str(missing), f"{prefix}_SCHEMA_COMPAT": compat}


def classify_version(version: Any) -> dict[str, str]:
    if not isinstance(version, str) or not version:
        return {"LITELLM_VERSION": "UNKNOWN", "LITELLM_VERSION_CLASS": "UNKNOWN"}
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        return {"LITELLM_VERSION": "UNRECOGNIZED", "LITELLM_VERSION_CLASS": "UNKNOWN"}
    return {"LITELLM_VERSION": version.replace(".", "_"),
            "LITELLM_VERSION_CLASS": "LAB_REHEARSED" if version in LAB_REHEARSED_VERSIONS else "NOT_REHEARSED"}


def classify_object_permission(linked: bool, rows: list | None, existing: Iterable[str]) -> dict[str, str]:
    if not linked:
        return {"OBJPERM_ROW": "NONE", "OBJPERM_EFFECTIVE": "NONE"}
    existing = set(existing)
    facts = {"OBJPERM_UNKNOWN_COLUMNS": str(len(existing - set(OBJPERM_KNOWN_COLUMNS))),
             "OBJPERM_MISSING_COLUMNS": str(len(set(OBJPERM_KNOWN_COLUMNS) - existing))}
    rows = rows or []
    facts["OBJPERM_ROW"] = "PRESENT" if len(rows) == 1 else ("MISSING" if not rows else "MULTIPLE")
    if facts["OBJPERM_ROW"] != "PRESENT":
        facts["OBJPERM_EFFECTIVE"] = "UNKNOWN"
        return facts
    row = rows[0]
    unrecognized = grants = 0
    for column in (*OBJPERM_LIST_GRANTS, "blocked_tools"):
        name = f"OBJPERM_{column.upper()}_COUNT"
        if column not in existing:
            facts[name] = "COLUMN_ABSENT"
            continue
        value = _json_value(row.get(column))
        if value is None:
            facts[name] = "0"
        elif isinstance(value, list):
            facts[name] = str(len(value))
            grants += len(value) if column != "blocked_tools" else 0  # a deny list never grants
        else:
            facts[name] = "UNRECOGNIZED"
            unrecognized += 1
    if "mcp_tool_permissions" in existing:
        value = _json_value(row.get("mcp_tool_permissions"))
        if value is None:
            facts["OBJPERM_MCP_TOOL_PERMISSIONS_COUNT"] = "0"
        elif isinstance(value, dict):
            facts["OBJPERM_MCP_TOOL_PERMISSIONS_COUNT"] = str(len(value))
            grants += len(value)
        else:
            facts["OBJPERM_MCP_TOOL_PERMISSIONS_COUNT"] = "UNRECOGNIZED"
            unrecognized += 1
    if "mcp_tool_search_enabled" in existing:
        value = row.get("mcp_tool_search_enabled")
        facts["OBJPERM_MCP_TOOL_SEARCH_ENABLED"] = {True: "TRUE", False: "FALSE", None: "UNSET"}.get(value, "UNRECOGNIZED") \
            if isinstance(value, (bool, type(None))) else "UNRECOGNIZED"
        unrecognized += facts["OBJPERM_MCP_TOOL_SEARCH_ENABLED"] == "UNRECOGNIZED"
        grants += facts["OBJPERM_MCP_TOOL_SEARCH_ENABLED"] == "TRUE"
    facts["OBJPERM_UNRECOGNIZED_VALUES"] = str(unrecognized)
    if unrecognized or facts["OBJPERM_UNKNOWN_COLUMNS"] != "0" or facts["OBJPERM_MISSING_COLUMNS"] != "0":
        facts["OBJPERM_EFFECTIVE"] = "UNKNOWN"
    else:
        facts["OBJPERM_EFFECTIVE"] = "GRANTS_PRESENT" if grants else "EMPTY"
    return facts


def classify_jwt_auth(blocks: Iterable[Any], sources_complete: bool) -> dict[str, str]:
    """general_settings.enable_jwt_auth (DB + YAML). With it, 1.110.0 can link a JWT identity to an existing,
    unexpired key of the same user (LINK_ONLY / map-existing). Only a boolean False or absence is DISABLED;
    an unreadable source or any other shape is never read as disabled."""
    enabled = unrecognized = False
    for block in blocks:
        block = _json_value(block)
        if block is None or block == {}:
            continue
        if not isinstance(block, dict):
            unrecognized = True
            continue
        value = block.get("enable_jwt_auth")
        if value is True:
            enabled = True
        elif value not in (None, False):
            unrecognized = True
    if enabled:
        return {"JWT_AUTH": "ENABLED"}
    if unrecognized:
        return {"JWT_AUTH": "UNRECOGNIZED"}
    return {"JWT_AUTH": "DISABLED" if sources_complete else "UNKNOWN"}


def classify_r3_gate(facts: Mapping[str, str], linked_permission: bool) -> dict[str, str]:
    """Stricter diagnostic gate. Never promotes: when the R1 gate is not PASS, R3 equals it."""
    reasons = []
    if facts.get("KEY_SCHEMA_COMPAT") != "LAB_EXACT":
        reasons.append("SCHEMA_NOT_LAB_EXACT")
    if facts.get("LITELLM_VERSION_CLASS") != "LAB_REHEARSED":
        reasons.append("VERSION_NOT_REHEARSED")
    if facts.get("KEY_EXTRA_INDIRECTION", "NONE") != "NONE":
        reasons.append("EXTRA_INDIRECTION")
    if facts.get("KEY_BUDGET_DURATION") == "UNRECOGNIZED":
        reasons.append("DURATION_UNRECOGNIZED")
    if facts.get("JWT_AUTH", "UNKNOWN") != "DISABLED":
        reasons.append("JWT_AUTH_NOT_DISABLED")
    if linked_permission:
        reasons.append("OBJECT_PERMISSION_LINKED")  # contract: never PASS while linked, even if EMPTY
    r1 = facts.get("KEY_POLICY_GATE", "FAIL")
    gate = r1 if r1 != "PASS" else ("NOT_VERIFIED" if reasons else "PASS")
    return {"KEY_POLICY_GATE_R3": gate, "KEY_POLICY_GATE_R3_REASONS": ",".join(reasons) or "NONE"}


def _redact(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return "REDACTED"
    if isinstance(value, str):
        return "REDACTED" if SECRET_LIKE.search(value) else value
    if isinstance(value, dict):
        return {str(k): _redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact(v) for v in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return "REDACTED"


def build_private_prestate(key_row: Mapping[str, Any], objperm_row: Mapping[str, Any] | None,
                           budget_row: Mapping[str, Any] | None, *, fingerprint: str, version: Any,
                           facts: Mapping[str, str], now: datetime) -> dict[str, Any]:
    return {
        "format": PRESTATE_FORMAT,
        "binding": {"fingerprint": fingerprint, "key_match": "ONE", "litellm_version": version if isinstance(version, str) else None,
                    "key_schema_compat": facts.get("KEY_SCHEMA_COMPAT"), "captured_at": now.isoformat()},
        "key": {name: _redact(key_row.get(name)) for name in PRESTATE_KEY_FIELDS if name in key_row},
        "object_permission": None if objperm_row is None else {k: _redact(objperm_row.get(k)) for k in OBJPERM_KNOWN_COLUMNS if k in objperm_row},
        "budget": None if budget_row is None else {k: _redact(v) for k, v in budget_row.items()},
    }


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
            now: datetime, yaml_config: Any, cost_map: Mapping[str, Any], yaml_status: str = "LOADED",
            version: Any = None, prestate_sink: dict | None = None) -> dict[str, str]:
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
    facts.update(classify_schema(existing, R3_KNOWN_KEY_COLUMNS, "KEY"))   # S5-R3
    facts.update(classify_version(version))                                # S5-R3
    extra = [name for name in R3_EXTRA_KEY_COLUMNS if name in existing and name not in present]
    columns = ", ".join(f'"{name}"' for name in (*present, *extra))
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
    linked = False
    if key_row is None:
        facts.update({"KEY_POLICY_GATE": "FAIL", "KEY_INDIRECTION": "NOT_EVALUATED",
                      "KEY_POLICY_GATE_R3": "FAIL", "KEY_POLICY_GATE_R3_REASONS": "KEY_NOT_MATCHED"})
        key_facts: dict[str, str] = {}
    else:
        budget_row = None
        if key_row.get("budget_id"):
            budgets = query('SELECT "rpm_limit", "tpm_limit", "max_budget", "budget_duration" '
                            'FROM "LiteLLM_BudgetTable" WHERE "budget_id" = %s LIMIT 1', (key_row["budget_id"],))
            budget_row = budgets[0] if budgets else None
        key_facts = classify_key(key_row, alias, caps, now, budget_row)
        facts.update(key_facts)
        # ---- S5-R3: causes, effective permissions, extra mechanisms, strict gate (read-only) ----
        limits, _ = _effective_limits(key_row, budget_row)
        facts.update(classify_budget_detail(limits, key_row.get("spend"), caps))
        facts["KEY_RPM"] = _rate_detail(limits["rpm_limit"], caps.get("rpm"))
        facts["KEY_TPM"] = _rate_detail(limits["tpm_limit"], caps.get("tpm"))
        facts["KEY_SCOPE_TOKEN"] = classify_scope_token(key_row.get("models"))
        facts.update(classify_extra_mechanisms(key_row, existing))
        linked = bool(key_row.get("object_permission_id"))
        perm_rows = None
        if linked:
            perm_existing = {row.get("column_name") for row in query(
                "SELECT column_name FROM information_schema.columns WHERE table_name = %s", ("LiteLLM_ObjectPermissionTable",))}
            perm_columns = [name for name in OBJPERM_KNOWN_COLUMNS if name in perm_existing]  # never an unknown column
            perm_rows = []
            if "object_permission_id" in perm_existing:
                perm_rows = query(f'SELECT {", ".join(chr(34) + c + chr(34) for c in perm_columns)} '
                                  'FROM "LiteLLM_ObjectPermissionTable" WHERE "object_permission_id" = %s LIMIT 2',
                                  (key_row["object_permission_id"],))
            facts.update(classify_object_permission(True, perm_rows, perm_existing))
        else:
            facts.update(classify_object_permission(False, None, ()))
        if prestate_sink is not None:
            prestate_sink["PRIVATE_PRESTATE"] = build_private_prestate(
                key_row, perm_rows[0] if perm_rows and len(perm_rows) == 1 else None, budget_row,
                fingerprint=fingerprint, version=version, facts=facts, now=now)

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
    facts.update(classify_jwt_auth([db_config.get("general_settings"), yaml_config.get("general_settings")],  # S5-R3
                                   sources_complete=yaml_class == "LOADED"))
    if key_row is not None:
        facts.update(classify_r3_gate(facts, linked))  # after JWT: every R3 input is known
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


def _container_version() -> Any:
    """Installed package metadata only; litellm itself is never imported."""
    try:
        import importlib.metadata as metadata

        return metadata.version("litellm")
    except Exception:  # noqa: BLE001
        return None


def probe_main(payload: Mapping[str, Any], *, query_factory: Callable[[], Any] = _psycopg_query_factory,
               yaml_loader: Callable[[], Any] = _container_yaml, cost_map_loader: Callable[[], Any] = _container_cost_map,
               now: datetime | None = None, version_loader: Callable[[], Any] = _container_version) -> int:
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
        sink: dict | None = {} if payload.get("private_prestate") is True else None
        facts = collect(query, fingerprint=fingerprint, alias=alias, caps=payload.get("caps") or {},
                        allowed_callbacks=payload.get("allowed_callbacks") or [], now=now or datetime.now(timezone.utc),
                        yaml_config=config, cost_map=cost_map_loader() or {}, yaml_status=status,
                        version=version_loader(), prestate_sink=sink)
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
    if sink and "PRIVATE_PRESTATE" in sink:  # opt-in only; the host writes it 0600 and prints its hash
        emit({"PRIVATE_PRESTATE": sink["PRIVATE_PRESTATE"]})
    emit(facts)
    return 0


# --------------------------------------------------------------------------------------------------
# Host side (root on the OMV host).
# --------------------------------------------------------------------------------------------------
SUMMARY_SNIPPET = r"""
import json, os
from services.article_intel_summary.litellm_adapter import load_litellm_settings
from services.article_intel_summary.s5_preflight import key_fingerprint, simulated_environment
def _runtime_flags():
    # S5-R3A: the deployed runtime's own parser on the real process environment (no key read).
    from services.article_intel_summary.litellm_adapter import load_gateway_settings
    g = load_gateway_settings(os.environ, read_key=False)
    return {"inference": g.enabled, "external_transfer": g.external_transfer_authorized}
s = load_litellm_settings(simulated_environment(os.environ))
budget = s.monthly_budget_usd
print(json.dumps({
    "fingerprint": key_fingerprint(s.virtual_key) if s.virtual_key else None,
    "alias": s.model_id,
    "caps": {"rpm": s.requests_per_minute, "tpm": s.tokens_per_minute, "budget": float(budget) if budget is not None else None},
    "allowed_callbacks": [i.strip() for i in os.environ.get("NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS", "").split(",") if i.strip()],
    "runtime_flags": _runtime_flags(),
}))
"""
PROBE_BOOTSTRAP = (
    "import json,sys;payload=json.loads(sys.stdin.readline());source=sys.stdin.read();"
    "g={'__name__':'s5_probe'};exec(compile(source,'s5_db_readonly_audit.py','exec'),g);"
    "sys.exit(g['probe_main'](payload))"
)
SNAPSHOT_FORMAT = "{{.Id}} {{.Image}} {{.State.StartedAt}} {{.RestartCount}} {{.State.Status}}"
# S5-R3A strict binding: one line per container, compared byte for byte with the wrapper's gate snapshot.
IDENTITY_FORMAT = ('{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}|'
                   '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}')
FLAG_LABELS = {"NEWSFLUX_AI_INFERENCE_ENABLED": "INFERENCE_EFFECTIVE",
               "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "EXTERNAL_TRANSFER_EFFECTIVE"}
HOST_FACT_NAMES = frozenset({*FLAG_LABELS.values(), "FLAGS_RUNTIME_PARSER", "SUMMARY_BINDING", "LITELLM_BINDING"})


def classify_flag(environment: Iterable[Any], name: str) -> str:
    """Effective value of one AI flag from the container's Config.Env, per the runtime parsers at the
    reviewed Summary revision: litellm_adapter/catalog use value.strip().casefold() == "true",
    admin_settings/operator preflight use value.lower() == "true"; a missing name is OFF (runtime
    default), and managed settings never override these flags.
      ON                  any parser would turn it on
      OFF_EXPLICIT        "false" in any case/surrounding whitespace (OFF in every parser)
      OFF_DEFAULT_RUNTIME absent: the runtime default (only valid for a reviewed Summary revision)
      AMBIGUOUS           anything else (1/0/yes/no/on/off/empty/unknown): OFF at runtime, intent unclear
      DUPLICATE           the name appears more than once
    Only OFF_EXPLICIT and OFF_DEFAULT_RUNTIME admit a diagnostic run."""
    values: list[str | None] = []
    for entry in environment:
        if not isinstance(entry, str):
            continue
        key, sep, value = entry.partition("=")
        if key == name:
            values.append(value if sep else None)
    if len(values) > 1:
        return "DUPLICATE"
    if not values:
        return "OFF_DEFAULT_RUNTIME"
    value = values[0]
    if value is None:
        return "AMBIGUOUS"
    if value.strip().casefold() == "true" or value.lower() == "true":
        return "ON"
    if value.strip().casefold() == "false":
        return "OFF_EXPLICIT"
    return "AMBIGUOUS"


def _flag_facts(environment: Any) -> dict[str, str]:
    if not isinstance(environment, list):
        raise ProbeError("AI_FLAGS_UNREADABLE")
    facts = {}
    for name, label in FLAG_LABELS.items():
        cls = classify_flag(environment, name)
        if cls == "ON":
            raise ProbeError("AI_FLAGS_NOT_OFF")
        if cls in ("AMBIGUOUS", "DUPLICATE"):
            raise ProbeError(f"AI_FLAGS_{cls}")
        facts[label] = cls
    return facts


def _identity_matches(observed: str, expected: str, cid: str, image: str,
                      project: str | None = None, service: str | None = None) -> bool:
    observed = observed.strip()
    parts = observed.split("|")
    if observed != expected or len(parts) != 7:
        return False
    if parts[0] != cid or parts[1] != image or parts[4] != "running":
        return False
    return project is None or (parts[5] == project and parts[6] == service)


def validate_prestate_path(path: str, *, euid: int) -> str | None:
    """None when the path may receive the private prestate; otherwise a detail-free reason."""
    if not isinstance(path, str) or not os.path.isabs(path):
        return "NOT_ABSOLUTE"
    parent = os.path.dirname(path)
    try:
        info = os.lstat(parent)
    except OSError:
        return "PARENT_INVALID"
    if not stat.S_ISDIR(info.st_mode) or os.path.realpath(parent) != parent:
        return "PARENT_INVALID"   # a symlink anywhere on the way could redirect the write
    if info.st_uid != euid:
        return "PARENT_NOT_OWNED"
    if info.st_mode & 0o077:
        return "PARENT_NOT_PRIVATE"
    if os.path.lexists(path):
        return "EXISTS"
    return None


def write_private_prestate(path: str, document: Mapping[str, Any]) -> str:
    """Exclusive create, never follows a symlink, mode 0600, fsync. Returns the SHA-256 of the bytes."""
    data = (json.dumps(document, sort_keys=True, indent=2) + "\n").encode("utf-8")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError as error:
        raise ProbeError("PRESTATE_WRITE_REFUSED") from error
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
        if stat.S_IMODE(os.fstat(fd).st_mode) != 0o600:
            raise ProbeError("PRESTATE_MODE_UNEXPECTED")
    finally:
        os.close(fd)
    return hashlib.sha256(data).hexdigest()


def _docker(argv: list[str], stdin: str | None = None) -> str:
    result = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        raise ProbeError("DOCKER_" + (argv[1].upper() if len(argv) > 1 else "CALL") + "_FAILED")
    return result.stdout


def main(argv: list[str] | None = None, *, run: Callable[..., str] = _docker, euid: int | None = None,
         prestate_owner: int | None = None) -> int:
    parser = argparse.ArgumentParser(description="S5-R1 read-only LiteLLM DB/config diagnostic (operator only).")
    parser.add_argument("--litellm-container")
    parser.add_argument("--project")
    parser.add_argument("--summary-service")
    parser.add_argument("--private-prestate", metavar="ABSOLUTE_PATH",
                        help="S5-R3, opt-in: write a redacted policy prestate (0600, root-only 0700 parent); prints its SHA-256 only")
    # S5-R3A strict binding (used by s5-r3-omv-readonly-run.sh): exact containers, no discovery.
    parser.add_argument("--summary-container")
    parser.add_argument("--expect-summary-image")
    parser.add_argument("--expect-litellm-image")
    parser.add_argument("--expect-summary-snapshot")
    parser.add_argument("--expect-litellm-snapshot")
    args = parser.parse_args(argv)
    if (os.geteuid() if euid is None else euid) != 0:
        print("S5R1_AUDIT=HOLD_NOT_ROOT")
        return 2
    strict = args.summary_container is not None
    if strict:
        hex64, image_id = re.compile(r"^[0-9a-f]{64}$"), re.compile(r"^sha256:[0-9a-f]{64}$")
        complete = (hex64.match(args.summary_container or "") and hex64.match(args.litellm_container or "")
                    and image_id.match(args.expect_summary_image or "") and image_id.match(args.expect_litellm_image or "")
                    and all(isinstance(v, str) and v and "\n" not in v
                            for v in (args.expect_summary_snapshot, args.expect_litellm_snapshot, args.project, args.summary_service)))
        if not complete:
            print("S5R1_AUDIT=HOLD_STRICT_BINDING_INCOMPLETE")
            return 2
        for variable, explicit in (("NEWSFLUX_PROJECT", args.project), ("NEWSFLUX_SUMMARY_SERVICE", args.summary_service)):
            if variable in os.environ and os.environ[variable] != explicit:
                print("S5R1_AUDIT=HOLD_ENV_DIVERGENT")  # never let the environment pick another Summary
                return 2
    project = args.project or os.environ.get("NEWSFLUX_PROJECT", "newsflux")
    service = args.summary_service or os.environ.get("NEWSFLUX_SUMMARY_SERVICE", "summary-api")
    prestate_path = args.private_prestate
    if prestate_path is not None:  # refused before any docker call
        owner = prestate_owner if prestate_owner is not None else (os.geteuid() if euid is None else euid)
        problem = validate_prestate_path(prestate_path, euid=owner)
        if problem:
            print(f"S5R3_PRIVATE_PRESTATE=HOLD_{problem}")
            return 2
    host_facts: dict[str, str] = {}
    try:
        if strict:
            summary_id, litellm_id = args.summary_container, args.litellm_container
            expected = {summary_id: args.expect_summary_snapshot, litellm_id: args.expect_litellm_snapshot}

            def identities() -> dict[str, str]:
                return {cid: run(["docker", "inspect", "--format", IDENTITY_FORMAT, cid]).strip() for cid in (summary_id, litellm_id)}

            def bound(observed: dict[str, str]) -> tuple[bool, bool]:
                return (_identity_matches(observed[summary_id], expected[summary_id], summary_id, args.expect_summary_image,
                                          project, service),
                        _identity_matches(observed[litellm_id], expected[litellm_id], litellm_id, args.expect_litellm_image))

            summary_ok, litellm_ok = bound(identities())
            if not summary_ok:
                raise ProbeError("IDENTITY_MISMATCH_SUMMARY")
            if not litellm_ok:
                raise ProbeError("IDENTITY_MISMATCH_LITELLM")
            host_facts.update(SUMMARY_BINDING="EXACT_ID_IMAGE_LABELS_LIFECYCLE", LITELLM_BINDING="EXACT_ID_IMAGE_LIFECYCLE")
        else:
            summary = run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}",
                           "--filter", f"label=com.docker.compose.service={service}"]).split()
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
            host_facts.update(SUMMARY_BINDING="DISCOVERED_BY_LABELS", LITELLM_BINDING="NAME_OR_IMAGE_DISCOVERY")
        environment = json.loads(run(["docker", "inspect", "--format", "{{json .Config.Env}}", summary_id]))
        host_facts.update(_flag_facts(environment))
        if strict:  # immediately before the first exec: still exactly the gated containers
            if bound(identities()) != (True, True):
                raise ProbeError("IDENTITY_CHANGED_BEFORE_EXEC")
            before = None
        else:
            before = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
        # -B: no bytecode is written inside the containers.
        summary_info = json.loads(run(["docker", "exec", "-u", "10001", summary_id, "python", "-B", "-c", SUMMARY_SNIPPET]))
        if not isinstance(summary_info, dict) or not isinstance(summary_info.get("fingerprint"), str):
            raise ProbeError("SUMMARY_KEY_UNAVAILABLE")
        flags = summary_info.pop("runtime_flags", None)
        if (not isinstance(flags, dict) or set(flags) != {"inference", "external_transfer"}
                or not all(isinstance(value, bool) for value in flags.values())):
            raise ProbeError("FLAGS_RUNTIME_UNAVAILABLE")
        if any(flags.values()):
            raise ProbeError("FLAGS_RUNTIME_NOT_OFF")
        host_facts["FLAGS_RUNTIME_PARSER"] = "CONFIRMED_OFF"
        if strict and bound(identities()) != (True, True):
            # R3B: re-prove both containers after the Summary parser and immediately before the LiteLLM exec.
            # Atomicity stays bounded: a later swap makes the exec by full ID fail, a restart shows up post-run.
            raise ProbeError("IDENTITY_CHANGED_BETWEEN_EXECS")
        with open(os.path.abspath(__file__), encoding="utf-8") as handle:
            source = handle.read()
        request = dict(summary_info, private_prestate=prestate_path is not None)
        stdin = json.dumps(request) + "\n" + source  # alias + fingerprint on stdin only, never argv
        raw = run(["docker", "exec", "-i", litellm_id, "python3", "-B", "-c", PROBE_BOOTSTRAP], stdin=stdin)
        if strict:
            unchanged = bound(identities()) == (True, True)
            before = after = None
        else:
            after = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
            unchanged = before == after
        output = raw.strip().splitlines()
        facts = json.loads(output[-1]) if output else {}
        if not isinstance(facts, dict):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")
        prestate = None
        for extra in output[:-1]:
            try:
                document = json.loads(extra)
            except ValueError:
                continue
            if isinstance(document, dict) and "PRIVATE_PRESTATE" in document:
                if prestate_path is None or prestate is not None:
                    raise ProbeError("PROBE_OUTPUT_UNSAFE")  # never accept raw policy values unrequested
                prestate = document["PRIVATE_PRESTATE"]
        if "PROBE" in facts:
            code = facts["PROBE"] if isinstance(facts["PROBE"], str) and SAFE_NAME.match(facts["PROBE"]) else "UNSAFE"
            raise ProbeError("PROBE_" + code)
        if HOST_FACT_NAMES & set(facts):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")  # the probe can never speak for the host checks
        lines = render({**facts, **host_facts}, container_identity="UNCHANGED" if unchanged else "CHANGED")
    except ProbeError as error:
        print(f"S5R1_AUDIT=HOLD_{error}")
        return 2
    except (ValueError, OSError, subprocess.SubprocessError):
        print("S5R1_AUDIT=HOLD_UNVERIFIED")
        return 2
    for line in lines:
        print(line)
    if not unchanged:
        print("S5R1_AUDIT=HOLD_CONTAINER_STATE_CHANGED")
        return 3
    if prestate_path is not None:
        binding = prestate.get("binding") if isinstance(prestate, dict) else None
        if (facts.get("KEY_MATCH") != "ONE" or not isinstance(binding, dict)
                or binding.get("fingerprint") != summary_info.get("fingerprint")):
            print("S5R3_PRIVATE_PRESTATE=NOT_WRITTEN")
            print("S5R1_AUDIT=HOLD_PRIVATE_PRESTATE_NOT_WRITTEN")
            return 2
        snapshot = before if before is not None else "\n".join(expected.values())
        binding.update(litellm_container=litellm_id, container_snapshot_sha256=hashlib.sha256(snapshot.encode()).hexdigest())
        try:
            digest = write_private_prestate(prestate_path, prestate)
        except ProbeError as error:
            print("S5R3_PRIVATE_PRESTATE=NOT_WRITTEN")
            print(f"S5R1_AUDIT=HOLD_{error}")
            return 2
        print("S5R3_PRIVATE_PRESTATE=WRITTEN")
        print(f"S5R3_PRIVATE_PRESTATE_SHA256={digest}")
    print("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY")
    print("NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
