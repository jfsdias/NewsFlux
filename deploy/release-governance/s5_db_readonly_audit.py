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
LOCAL_HOSTS = frozenset({"ollama", "localhost", "127.0.0.1", "host.docker.internal"})
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
    if not isinstance(models, list) or not models:
        return "UNRESTRICTED_ALL_MODELS"  # LiteLLM: empty/absent model list = every model
    names = [str(item) for item in models]
    if any(name in WILDCARD_MODELS or "*" in name for name in names):
        return "WILDCARD"
    if set(names) == {alias}:
        return "EXACT_ALIAS"
    return "EXTRA_MODELS" if alias in names else "OTHER_MODEL"


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
        ok = isinstance(routes, list) and bool(routes) and all(isinstance(r, str) for r in routes)
        facts["KEY_ROUTES"] = "PASS" if ok and set(routes) == APPROVED_ROUTES else "FAIL"

    limits = {name: row.get(name) for name in ("rpm_limit", "tpm_limit", "max_budget", "budget_duration")}
    source = "KEY"
    if row.get("budget_id") and budget_row:
        for name in limits:
            if limits[name] in (None, "") and budget_row.get(name) not in (None, ""):
                limits[name] = budget_row.get(name)
                source = "BUDGET_TABLE"
    facts["KEY_LIMIT_SOURCE"] = source

    rpm, tpm = _positive_int(limits["rpm_limit"]), _positive_int(limits["tpm_limit"])
    facts["KEY_RATE_LIMITS"] = "PASS" if rpm and tpm else "FAIL"
    for name, value, cap in (("KEY_RPM_WITHIN_APP", rpm, caps.get("rpm")), ("KEY_TPM_WITHIN_APP", tpm, caps.get("tpm"))):
        facts[name] = "NOT_APPLICABLE" if value is None or not cap else ("YES" if value <= cap else "NO")

    max_budget, spend, app_budget = _number(limits["max_budget"]), _number(row.get("spend")) or 0.0, _number(caps.get("budget"))
    duration = limits["budget_duration"]
    budget_ok = (max_budget is not None and max_budget > 0 and app_budget is not None and max_budget <= app_budget
                 and isinstance(duration, str) and bool(duration.strip()) and spend < max_budget)
    facts["KEY_BUDGET"] = "PASS" if budget_ok else "FAIL"

    indirection = []
    if isinstance(_json_value(row.get("aliases")), dict) and _json_value(row.get("aliases")):
        indirection.append("ALIASES")
    if isinstance(_json_value(row.get("router_settings")), dict) and _json_value(row.get("router_settings")):
        indirection.append("ROUTER_SETTINGS")
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
    if "FAIL" in core or "ALIASES" in indirection or "ROUTER_SETTINGS" in indirection:
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
        if family == "OLLAMA" and (host in LOCAL_HOSTS or port == 11434):
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

    if (not deployments or facts["DEPLOYMENT_BLOCKED"] == "ALL" or facts["PROVIDER_FAMILY"] == "MIXED"
            or "ALIASES" in key_facts.get("KEY_INDIRECTION", "")):
        facts["MODEL_ROUTE_GATE"] = "FAIL"
    elif (facts["PROVIDER_FAMILY"] == "OTHER" or facts["ENDPOINT_CLASS"] in ("CUSTOM_ENDPOINT", "MIXED")
          or facts["DEPLOYMENT_BLOCKED"] == "SOME"):
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
    names: set[str] = set()
    for block in settings:
        block = _json_value(block)
        if not isinstance(block, dict):
            continue
        for key in CALLBACK_KEYS:
            value = _json_value(block.get(key))
            if isinstance(value, str) and value:
                value = [value]
            if isinstance(value, list):
                names.update(str(item).strip().lower() for item in value if str(item).strip())
    allowed_set = {item.strip().lower() for item in allowed if item.strip()}
    labels = sorted({name.upper() if name in CALLBACK_FAMILIES else "OTHER" for name in names})
    return {
        "CALLBACKS_CONFIGURED": ",".join(labels) or "NONE",
        "CALLBACK_GATE": "PASS" if names <= allowed_set else "FAIL",
    }


def collect(query: Query, *, fingerprint: str, alias: str, caps: Mapping[str, Any], allowed_callbacks: Iterable[str],
            now: datetime, yaml_config: Any, cost_map: Mapping[str, Any], yaml_status: str = "LOADED") -> dict[str, str]:
    rows = query("SHOW transaction_read_only", ())
    first = rows[0] if rows else None
    value = next(iter(first.values())) if isinstance(first, dict) else (first[0] if first else None)
    if str(value).lower() != "on":
        raise ProbeError("DB_NOT_READ_ONLY")
    facts: dict[str, str] = {"DB_READ_ONLY": "VERIFIED", "YAML_CONFIG": yaml_status}

    existing = {row.get("column_name") for row in query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s", ("LiteLLM_VerificationToken",))}
    if not set(REQUIRED_KEY_COLUMNS) <= existing:
        raise ProbeError("DB_SCHEMA_UNSUPPORTED")
    present = [name for name in KEY_COLUMNS if name in existing]  # identifiers from a fixed allowlist only
    facts["KEY_SCHEMA"] = "FULL" if len(present) == len(KEY_COLUMNS) else "PARTIAL_OPTIONAL"
    columns = ", ".join(f'"{name}"' for name in present)
    tokens = query(f'SELECT {columns} FROM "LiteLLM_VerificationToken" LIMIT 5000', ())
    matches = [row for row in tokens if isinstance(row.get("token"), str)
               and fingerprint_token_hash(row["token"]) == fingerprint]
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

    db_models = query('SELECT "model_name", "litellm_params", "model_info", "blocked" FROM "LiteLLM_ProxyModelTable" '
                      'WHERE "model_name" = %s LIMIT 51', (alias,))
    yaml_config = yaml_config if isinstance(yaml_config, dict) else {}
    deployments = [dict(row, source="DB") for row in db_models]
    for entry in yaml_config.get("model_list") or []:
        if isinstance(entry, dict) and entry.get("model_name") == alias:
            deployments.append({"litellm_params": entry.get("litellm_params"), "model_info": entry.get("model_info"),
                                "blocked": False, "source": "YAML"})
    facts.update(classify_route(deployments, key_facts, cost_map))

    config_rows = query('SELECT "param_name", "param_value" FROM "LiteLLM_Config" '
                        "WHERE \"param_name\" IN ('router_settings', 'litellm_settings', 'general_settings')", ())
    db_config = {row.get("param_name"): _json_value(row.get("param_value")) for row in config_rows}
    router_blocks = [db_config.get("router_settings"), db_config.get("litellm_settings"),
                     yaml_config.get("router_settings"), yaml_config.get("litellm_settings")]
    if key_row is not None:
        router_blocks.append(key_row.get("router_settings"))
    facts.update(classify_fallbacks(router_blocks, alias))
    facts.update(classify_callbacks([db_config.get("litellm_settings"), yaml_config.get("litellm_settings")],
                                    allowed_callbacks))
    facts.update({
        "PROVIDER_PRIVACY_GATE": "NOT_VERIFIED_OPERATOR_TERMS_REQUIRED",
        "OFFICIAL_ATTESTATION": "HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE",
        "EVIDENCE_KIND": "DIAGNOSTIC_DB_CONFIG_READONLY",
        "S5_PREFLIGHT_EFFECT": "NONE",
    })
    return facts


def render(facts: Mapping[str, Any], *, mutations: str) -> list[str]:
    lines = []
    for name in sorted(facts):
        value = facts[name]
        if not isinstance(name, str) or not SAFE_NAME.match(name) or not isinstance(value, str) or not SAFE_VALUE.match(value):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")
        lines.append(f"S5R1_{name}={value}")
    lines.append(f"S5R1_PRODUCTION_MUTATIONS={mutations}")
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


def _container_yaml() -> tuple[str, dict]:
    try:
        with open("/proc/1/cmdline", "rb") as handle:
            argv = [part.decode("utf-8", "replace") for part in handle.read().split(b"\0") if part]
    except OSError:
        argv = []
    path = None
    for index, part in enumerate(argv):
        if part == "--config" and index + 1 < len(argv):
            path = argv[index + 1]
        elif part.startswith("--config="):
            path = part.split("=", 1)[1]
    path = path or os.environ.get("CONFIG_FILE_PATH") or os.environ.get("WORKER_CONFIG")
    if not path:
        return "NOT_FOUND", {}
    try:
        import yaml  # installed in the LiteLLM image

        with open(path, encoding="utf-8") as handle:
            document = yaml.safe_load(handle)
    except Exception:  # noqa: BLE001 - classified, detail-free
        return "UNREADABLE", {}
    return ("LOADED", document) if isinstance(document, dict) else ("UNREADABLE", {})


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
        render(facts, mutations="0")  # refuse to emit anything that is not an enum or a count
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
        litellm = [args.litellm_container] if args.litellm_container else run(
            ["docker", "ps", "-q", "--filter", "name=litellm"]).split()
        if len(litellm) != 1:
            raise ProbeError("LITELLM_CONTAINER_NOT_UNIQUE")
        litellm_id = litellm[0]
        environment = run(["docker", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", summary_id])
        values = dict(line.split("=", 1) for line in environment.splitlines() if "=" in line)
        if any(values.get(name, "").strip().lower() == "true" for name in FLAGS_THAT_MUST_BE_OFF):
            raise ProbeError("AI_FLAGS_NOT_OFF")
        before = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
        summary_info = json.loads(run(["docker", "exec", "-u", "10001", summary_id, "python", "-c", SUMMARY_SNIPPET]))
        if not isinstance(summary_info, dict) or not isinstance(summary_info.get("fingerprint"), str):
            raise ProbeError("SUMMARY_KEY_UNAVAILABLE")
        with open(os.path.abspath(__file__), encoding="utf-8") as handle:
            source = handle.read()
        stdin = json.dumps(summary_info) + "\n" + source  # alias + fingerprint on stdin only, never argv
        raw = run(["docker", "exec", "-i", litellm_id, "python3", "-c", PROBE_BOOTSTRAP], stdin=stdin)
        after = run(["docker", "inspect", "-f", SNAPSHOT_FORMAT, summary_id, litellm_id])
        facts = json.loads(raw.strip().splitlines()[-1]) if raw.strip() else {}
        if not isinstance(facts, dict):
            raise ProbeError("PROBE_OUTPUT_UNSAFE")
        if "PROBE" in facts:
            code = facts["PROBE"] if isinstance(facts["PROBE"], str) and SAFE_NAME.match(facts["PROBE"]) else "UNSAFE"
            raise ProbeError("PROBE_" + code)
        lines = render(facts, mutations="0" if before == after else "UNVERIFIED")
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
