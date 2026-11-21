"""Receipt contract of the authorized read-only diagnostic, vendored verbatim (D1-R7-01).

Source: deploy/release-governance/s5-r3-omv-readonly-run.sh at 57c536fb583a52bb42a88d9a1b051869abc64b1f, the
CONTRACT_PY block between `CONTRACT_PY=$(cat <<'PY'` and `PY`. The bytes between the BEGIN/END markers below are
that block unchanged (sha256 VERBATIM_SHA256); test_d1_receipt_contract checks it, so the D1 evidence is judged by
exactly the contract the PM admitted, not by a subset. Stdlib only: the OMV capture and the Summary image both
import it.
"""
VERBATIM_SHA256 = "7aa686a3d3b970c0417ad4d827574cd3893a1cc6b6451b01ba70db25ebde1d71"
VERBATIM_SOURCE = "57c536fb583a52bb42a88d9a1b051869abc64b1f:deploy/release-governance/s5-r3-omv-readonly-run.sh"
# ---BEGIN VERBATIM CONTRACT_PY---
import re, sys

NEXT_LINE = "NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)"
GATES = {"PASS", "FAIL", "NOT_VERIFIED"}
FAMILIES = {"OPENROUTER", "GROQ", "GEMINI", "VERTEX_AI", "MISTRAL", "OPENAI", "AZURE", "ANTHROPIC", "TOGETHER_AI", "CEREBRAS",
            "OLLAMA", "HUGGINGFACE", "NVIDIA_NIM", "COHERE", "DEEPSEEK", "BEDROCK", "XAI", "FIREWORKS_AI", "SAMBANOVA",
            "GITHUB_MODELS", "CLOUDFLARE", "OTHER", "MIXED", "NONE"}
CALLBACKS = {"LANGFUSE", "LANGSMITH", "DATADOG", "PROMETHEUS", "SENTRY", "S3", "GCS_BUCKET", "OTEL", "OPENTELEMETRY",
             "LUNARY", "HELICONE", "POSTHOG", "ARIZE", "BRAINTRUST", "MLFLOW", "SLACK", "EMAIL", "DYNAMODB", "ATHINA",
             "LOGFIRE", "WANDB", "LANGTRACE", "OPENMETER", "LAGO", "ARGILLA", "GALILEO", "SUPABASE", "GREENSCALE",
             "HUMANLOOP", "OPIK", "GENERIC_API", "OTHER", "UNRECOGNIZED"}
EXTRA_IND = {"USER", "ORGANIZATION", "PROJECT", "AGENT", "PERMISSIONS", "CONFIG", "BUDGET_FALLBACKS"}
EXTRA_LIM = {"MODEL_MAX_BUDGET", "BUDGET_LIMITS", "TPD_LIMIT", "MAX_PARALLEL_REQUESTS"}
OBJPERM_COUNTED = ("MCP_SERVERS", "VECTOR_STORES", "MCP_ACCESS_GROUPS", "AGENTS", "AGENT_ACCESS_GROUPS", "MODELS",
                   "MCP_TOOLSETS", "SEARCH_TOOLS", "SKILLS", "BLOCKED_TOOLS", "MCP_TOOL_PERMISSIONS")
AUDITOR_HOLDS = {"NOT_ROOT", "STRICT_BINDING_INCOMPLETE", "ENV_DIVERGENT", "UNVERIFIED", "CONTAINER_STATE_CHANGED",
                 "IDENTITY_MISMATCH_SUMMARY", "IDENTITY_MISMATCH_LITELLM", "IDENTITY_CHANGED_BEFORE_EXEC",
                 "IDENTITY_CHANGED_BETWEEN_EXECS",
                 "AI_FLAGS_NOT_OFF", "AI_FLAGS_AMBIGUOUS", "AI_FLAGS_DUPLICATE", "AI_FLAGS_UNREADABLE",
                 "FLAGS_RUNTIME_NOT_OFF", "FLAGS_RUNTIME_UNAVAILABLE", "SUMMARY_KEY_UNAVAILABLE", "PROBE_OUTPUT_UNSAFE",
                 "SUMMARY_CONTAINER_NOT_UNIQUE", "LITELLM_CONTAINER_NOT_UNIQUE", "DOCKER_INSPECT_FAILED",
                 "DOCKER_EXEC_FAILED", "DOCKER_PS_FAILED", "PROBE_INPUT_INVALID", "PROBE_DB_UNAVAILABLE",
                 "PROBE_DB_READ_FAILED", "PROBE_DB_NOT_READ_ONLY", "PROBE_DB_SCHEMA_UNSUPPORTED",
                 "PROBE_PROBE_OUTPUT_UNSAFE", "PROBE_UNSAFE"}


def enum(*values):
    allowed = set(values)
    return lambda v: v in allowed


def subset(options, extra=("NONE",)):
    def check(v):
        if v in extra:
            return True
        parts = v.split(",")
        return len(parts) == len(set(parts)) and all(p in options for p in parts)
    return check


def count(low, high, words=()):
    def check(v):
        if v in words:
            return True
        return bool(re.fullmatch(r"0|[1-9][0-9]{0,5}", v)) and low <= int(v) <= high
    return check


CONTRACT = {
    "DB_READ_ONLY": enum("VERIFIED"),
    "YAML_CONFIG": enum("LOADED", "NOT_FOUND", "UNREADABLE", "INVALID_ROOT", "INVALID_STRUCTURE"),
    "KEY_SCHEMA": enum("FULL", "PARTIAL_OPTIONAL"),
    "KEY_LOOKUP": enum("EXACT_FINGERPRINT"),
    "KEY_MATCH": enum("ONE", "NONE", "MULTIPLE"),
    "KEY_POLICY_GATE": enum(*GATES),
    "KEY_INDIRECTION": subset({"ALIASES", "ALIASES_UNRECOGNIZED", "ROUTER_SETTINGS", "ROUTER_SETTINGS_UNRECOGNIZED", "TEAM",
                               "ACCESS_GROUPS", "POLICIES", "OBJECT_PERMISSION"}, ("NONE", "NOT_EVALUATED")),
    "KEY_MODELS_COUNT": count(0, 10000),
    "KEY_SCOPE_DETAIL": enum("UNRESTRICTED_ALL_MODELS", "INVALID_TYPE", "INVALID_ENTRY", "WILDCARD", "EXACT_ALIAS",
                             "DUPLICATE_ENTRIES", "EXTRA_MODELS", "OTHER_MODEL"),
    "KEY_SCOPE": enum("PASS", "FAIL"),
    "KEY_VALIDITY": enum("PASS", "FAIL"),
    "KEY_ROUTES": enum(*GATES),
    "KEY_LIMIT_SOURCE": enum("KEY", "BUDGET_TABLE"),
    "KEY_RPM_WITHIN_APP": enum("APP_CAP_MISSING", "NOT_APPLICABLE", "YES", "NO"),
    "KEY_TPM_WITHIN_APP": enum("APP_CAP_MISSING", "NOT_APPLICABLE", "YES", "NO"),
    "KEY_RATE_LIMITS": enum("PASS", "FAIL"),
    "KEY_SPEND": enum("KNOWN", "UNKNOWN"),
    "KEY_BUDGET": enum(*GATES),
    "KEY_SCHEMA_COLUMNS": count(0, 500),
    "KEY_SCHEMA_UNKNOWN_COLUMNS": count(0, 500),
    "KEY_SCHEMA_MISSING_KNOWN": count(0, 500),
    "KEY_SCHEMA_COMPAT": enum("LAB_EXACT", "UNKNOWN_COLUMNS", "MISSING_COLUMNS", "UNKNOWN_AND_MISSING_COLUMNS"),
    "LITELLM_VERSION": lambda v: v in ("UNKNOWN", "UNRECOGNIZED") or bool(re.fullmatch(r"[0-9]{1,4}_[0-9]{1,4}_[0-9]{1,6}", v)),
    "LITELLM_VERSION_CLASS": enum("LAB_REHEARSED", "NOT_REHEARSED", "UNKNOWN"),
    "KEY_POLICY_GATE_R3": enum(*GATES),
    "KEY_POLICY_GATE_R3_REASONS": subset({"SCHEMA_NOT_LAB_EXACT", "VERSION_NOT_REHEARSED", "EXTRA_INDIRECTION",
                                          "DURATION_UNRECOGNIZED", "JWT_AUTH_NOT_DISABLED", "OBJECT_PERMISSION_LINKED",
                                          "KEY_NOT_MATCHED"}),
    "KEY_MAX_BUDGET": enum("MISSING", "INVALID", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_BUDGET_DURATION": enum("MISSING", "BLANK", "UNRECOGNIZED", "CALENDAR_MONTH", "DAILY", "WEEKLY", "OTHER_WINDOW"),
    "KEY_SPEND_VS_MAX": enum("BELOW", "AT_OR_ABOVE", "NOT_APPLICABLE"),
    "APP_BUDGET_CAP": enum("PRESENT", "MISSING", "INVALID"),
    "KEY_BUDGET_CAUSE": subset({"APP_BUDGET_CAP_MISSING", "APP_BUDGET_CAP_INVALID", "MAX_BUDGET_MISSING", "MAX_BUDGET_INVALID",
                                "MAX_BUDGET_NONPOSITIVE", "MAX_BUDGET_ABOVE_APP_CAP", "BUDGET_DURATION_MISSING",
                                "BUDGET_DURATION_INVALID_TYPE", "BUDGET_DURATION_BLANK", "BUDGET_DURATION_UNRECOGNIZED",
                                "SPEND_UNKNOWN", "SPEND_AT_OR_ABOVE_MAX"}),
    "KEY_RPM": enum("MISSING", "NON_INTEGER", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_TPM": enum("MISSING", "NON_INTEGER", "NONPOSITIVE", "APP_CAP_MISSING", "ABOVE_APP_CAP", "OK"),
    "KEY_SCOPE_TOKEN": subset({"ALL_PROXY_MODELS", "ALL_TEAM_MODELS", "STAR", "CONTAINS_STAR"}),
    "KEY_EXTRA_INDIRECTION": subset(EXTRA_IND | {x + "_UNRECOGNIZED" for x in EXTRA_IND}),
    "KEY_EXTRA_LIMITS": subset(EXTRA_LIM | {x + "_UNRECOGNIZED" for x in EXTRA_LIM}),
    "KEY_AGENT_ID": enum("NONE", "PRESENT", "COLUMN_ABSENT"),
    "KEY_TYPE": enum("NONE", "DEFAULT", "LLM_API", "MANAGEMENT", "READ_ONLY", "OTHER"),
    "OBJPERM_ROW": enum("NONE", "PRESENT", "MISSING", "MULTIPLE"),
    "OBJPERM_EFFECTIVE": enum("NONE", "EMPTY", "GRANTS_PRESENT", "UNKNOWN"),
    "OBJPERM_UNKNOWN_COLUMNS": count(0, 100),
    "OBJPERM_MISSING_COLUMNS": count(0, 100),
    "OBJPERM_UNRECOGNIZED_VALUES": count(0, 100),
    "OBJPERM_MCP_TOOL_SEARCH_ENABLED": enum("TRUE", "FALSE", "UNSET", "UNRECOGNIZED"),
    "JWT_AUTH": enum("ENABLED", "DISABLED", "UNRECOGNIZED", "UNKNOWN"),
    "DEPLOYMENTS_DB": count(0, 200, ("NOT_VERIFIED_TRUNCATED",)),
    "DEPLOYMENTS_YAML": count(0, 1000),
    "DEPLOYMENT_SOURCE": enum("DB_AND_YAML", "DB", "YAML", "NONE"),
    "PROVIDER_FAMILY": enum(*FAMILIES),
    "ENDPOINT_CLASS": enum("PROVIDER_DEFAULT", "LOCAL_OLLAMA", "CUSTOM_ENDPOINT", "MIXED", "NONE"),
    "DEPLOYMENT_BLOCKED": enum("NONE", "ALL", "SOME"),
    "MODEL_ROUTE_GATE": enum(*GATES),
    "CONFIGURED_PRICE": enum("NONZERO", "ZERO", "NOT_PUBLISHED"),
    "PUBLISHED_PRICE_MAP": enum("NONZERO", "ZERO", "NOT_LISTED", "MIXED"),
    "PRICING_GATE": enum("FAIL", "NOT_VERIFIED_PROVIDER_TERMS", "NOT_VERIFIED"),
    "FALLBACK_ALIAS_RULE": enum("NONE", "PRESENT"),
    "FALLBACK_CONTEXT_WINDOW": enum("NONE", "PRESENT"),
    "FALLBACK_CONTENT_POLICY": enum("NONE", "PRESENT"),
    "FALLBACK_DEFAULT_RULE": enum("NONE", "PRESENT"),
    "FALLBACK_GATE": enum(*GATES),
    "FALLBACK_GENERAL_SETTINGS": enum("NONE", "UNRECOGNIZED", "PRESENT_UNVERIFIED_SEMANTICS"),
    "CALLBACKS_CONFIGURED": subset(CALLBACKS),
    "CALLBACK_GATE": enum(*GATES),
    "PROVIDER_PRIVACY_GATE": enum("NOT_VERIFIED_OPERATOR_TERMS_REQUIRED"),
    "OFFICIAL_ATTESTATION": enum("HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE"),
    "EVIDENCE_KIND": enum("DIAGNOSTIC_DB_CONFIG_READONLY"),
    "S5_PREFLIGHT_EFFECT": enum("NONE"),
    "INFERENCE_EFFECTIVE": enum("OFF_EXPLICIT", "OFF_DEFAULT_RUNTIME"),
    "EXTERNAL_TRANSFER_EFFECTIVE": enum("OFF_EXPLICIT", "OFF_DEFAULT_RUNTIME"),
    "FLAGS_RUNTIME_PARSER": enum("CONFIRMED_OFF"),
    "SUMMARY_BINDING": enum("EXACT_ID_IMAGE_LABELS_LIFECYCLE"),
    "LITELLM_BINDING": enum("EXACT_ID_IMAGE_LIFECYCLE"),
    "DELIBERATE_DB_CONFIG_WRITES": enum("NONE"),
    "CONTAINER_IDENTITY": enum("UNCHANGED", "CHANGED"),
    "FILESYSTEM_INTEGRITY": enum("NOT_PROVEN"),
    "AUDIT": lambda v: v == "COMPLETE_DIAGNOSTIC_ONLY" or (v.startswith("HOLD_") and v[5:] in AUDITOR_HOLDS),
}
for _name in OBJPERM_COUNTED:
    CONTRACT[f"OBJPERM_{_name}_COUNT"] = count(0, 100000, ("COLUMN_ABSENT", "UNRECOGNIZED"))
REQUIRED = ("DB_READ_ONLY", "KEY_LOOKUP", "KEY_MATCH", "KEY_POLICY_GATE", "KEY_POLICY_GATE_R3", "KEY_POLICY_GATE_R3_REASONS",
            "KEY_SCHEMA_COMPAT", "LITELLM_VERSION", "LITELLM_VERSION_CLASS", "JWT_AUTH", "MODEL_ROUTE_GATE", "PRICING_GATE",
            "FALLBACK_GATE", "CALLBACK_GATE", "PROVIDER_PRIVACY_GATE", "OFFICIAL_ATTESTATION", "EVIDENCE_KIND",
            "S5_PREFLIGHT_EFFECT", "INFERENCE_EFFECTIVE", "EXTERNAL_TRANSFER_EFFECTIVE", "FLAGS_RUNTIME_PARSER",
            "SUMMARY_BINDING", "LITELLM_BINDING", "DELIBERATE_DB_CONFIG_WRITES", "CONTAINER_IDENTITY",
            "FILESYSTEM_INTEGRITY", "AUDIT")
LINE = re.compile(r"S5R1_([A-Z0-9_]{1,64})=([A-Z0-9_,]{1,512})")


def validate(text, code, version_token):
    """("OK", lines) or (hold_code, None). Never echoes rejected content."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if len(lines) > 400:
        return "RECEIPT_TOO_LONG", None
    if code not in (0, 2, 3):
        return "AUDITOR_EXIT_UNEXPECTED", None
    fields, kept, next_seen = {}, [], 0
    for index, line in enumerate(lines):
        if "PRESTATE" in line.upper():
            return "RECEIPT_PRIVATE_PRESTATE", None
        if line == NEXT_LINE:
            if index != len(lines) - 1 or next_seen:
                return "RECEIPT_UNEXPECTED_LINE", None
            next_seen += 1
            continue
        match = LINE.fullmatch(line)
        if not match:
            return "RECEIPT_UNEXPECTED_LINE", None
        name, value = match.groups()
        if name in fields:
            return "RECEIPT_DUPLICATE_FIELD", None
        check = CONTRACT.get(name)
        if check is None:
            return "RECEIPT_UNKNOWN_FIELD", None
        if not check(value):
            return ("RECEIPT_COUNT_OUT_OF_RANGE" if re.fullmatch(r"[0-9]+", value) else "RECEIPT_VALUE_NOT_ALLOWED"), None
        fields[name] = value
        kept.append(line)
    audit = fields.get("AUDIT")
    if code != 0:
        if audit is None or audit == "COMPLETE_DIAGNOSTIC_ONLY" or next_seen:
            return "RECEIPT_EXIT_INCOHERENT", None
        if code == 3 and (audit != "HOLD_CONTAINER_STATE_CHANGED" or fields.get("CONTAINER_IDENTITY") != "CHANGED"):
            return "RECEIPT_EXIT_INCOHERENT", None
        if code == 2 and len(fields) != 1:
            return "RECEIPT_EXIT_INCOHERENT", None
        return "AUDITOR_" + audit[5:], None
    if audit != "COMPLETE_DIAGNOSTIC_ONLY" or next_seen != 1:
        return "RECEIPT_EXIT_INCOHERENT", None
    if lines[-2] != "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY":
        return "RECEIPT_EXIT_INCOHERENT", None
    if any(name not in fields for name in REQUIRED):
        return "RECEIPT_MISSING_REQUIRED", None
    if fields["CONTAINER_IDENTITY"] != "UNCHANGED":
        return "RECEIPT_CONTAINER_CHANGED", None
    if fields["LITELLM_VERSION"] != version_token or fields["LITELLM_VERSION_CLASS"] != "LAB_REHEARSED":
        return "RECEIPT_VERSION_MISMATCH", None
    return "OK", kept


if __name__ == "__main__":
    verdict, kept = validate(sys.stdin.read(), int(sys.argv[1]), sys.argv[2])
    print(verdict)
    if kept is not None:
        print("\n".join(kept))
# ---END VERBATIM CONTRACT_PY---
