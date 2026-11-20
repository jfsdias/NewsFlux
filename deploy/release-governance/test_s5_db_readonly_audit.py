"""S5-R1 read-only DB/config auditor. Synthetic rows and config only; never operator evidence."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import re
import unittest
from datetime import datetime, timedelta, timezone

import s5_db_readonly_audit as audit

KEY = "sk-synthetic-virtual-key-000000000000"
OTHER_KEY = "sk-synthetic-other-key-0000000000000"
ALIAS = "newsflux-s5-free"
NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
CAPS = {"rpm": 5, "tpm": 20000, "budget": 1.0}
SAFE_VALUE = re.compile(r"^(?:[A-Z0-9_]+(?:,[A-Z0-9_]+)*|\d+)$")


def token_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def key_row(**overrides):
    row = {
        "token": token_hash(KEY), "models": [ALIAS], "allowed_routes": ["llm_api_routes"],
        "blocked": None, "expires": None, "rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5,
        "budget_duration": "30d", "spend": 0.0, "aliases": {}, "router_settings": {}, "config": {},
        "team_id": None, "budget_id": None, "access_group_ids": [], "policies": [],
        "object_permission_id": None, "key_alias": "newsflux-prod", "metadata": {"owner": "x"},
    }
    row.update(overrides)
    return row


def deployment(model="openrouter/vendor/model:free", api_base=None, costs=(0, 0), blocked=False):
    params = {"model": model, "api_key": "os.environ/PROVIDER_KEY"}
    if api_base:
        params["api_base"] = api_base
    info = {}
    if costs is not None:
        info = {"input_cost_per_token": costs[0], "output_cost_per_token": costs[1]}
    return {"litellm_params": params, "model_info": info, "blocked": blocked}


class FakeDb:
    """Records every statement; serves canned rows. Mirrors the probe's query() contract."""

    def __init__(self, tokens=None, models=None, config=None, budgets=None, read_only="on", columns=None):
        self.tokens = tokens if tokens is not None else [key_row(), key_row(token=token_hash(OTHER_KEY), models=[])]
        self.models = models if models is not None else [dict(deployment(), model_name=ALIAS)]
        self.config = config if config is not None else {}
        self.budgets = budgets or {}
        self.read_only = read_only
        self.columns = columns if columns is not None else list(audit.KEY_COLUMNS)
        self.statements = []

    def __call__(self, sql, params=()):
        self.statements.append(sql)
        lowered = " ".join(sql.split()).lower()
        if lowered.startswith("show transaction_read_only"):
            return [(self.read_only,)]
        if "information_schema.columns" in lowered:
            return [{"column_name": name} for name in self.columns]
        limit = re.search(r"\blimit (\d+)", lowered)
        limit = int(limit.group(1)) if limit else None
        if '"litellm_verificationtoken"' in lowered:
            # The probe matches by fingerprint inside Postgres (sha256 of domain || token), exactly.
            domain_hex, fingerprint = params
            self.token_lookup = (bytes.fromhex(domain_hex), fingerprint)
            selected = re.findall(r'"([a-z_]+)"', sql.split("FROM")[0])
            rows = [{k: v for k, v in row.items() if k in selected} for row in self.tokens
                    if isinstance(row.get("token"), str)
                    and hashlib.sha256(bytes.fromhex(domain_hex) + row["token"].encode()).hexdigest() == fingerprint]
            return rows[:limit] if limit else rows
        if '"litellm_proxymodeltable"' in lowered:
            rows = [row for row in self.models if row.get("model_name") == params[0]]
            if "count(*)" in lowered:
                return [{"count": len(rows)}]
            return rows[:limit] if limit else rows
        if '"litellm_config"' in lowered:
            return [{"param_name": k, "param_value": v} for k, v in self.config.items()]
        if '"litellm_budgettable"' in lowered:
            row = self.budgets.get(params[0])
            return [row] if row else []
        if '"litellm_objectpermissiontable"' in lowered:  # S5-R3: no permission row in the R1 fixtures
            return []
        raise AssertionError(sql)


def collect(db=None, *, yaml_config=None, cost_map=None, allowed_callbacks=frozenset(), fingerprint=None, caps=CAPS):
    return audit.collect(
        db or FakeDb(),
        fingerprint=fingerprint or audit.fingerprint_token_hash(token_hash(KEY)),
        alias=ALIAS, caps=caps, allowed_callbacks=allowed_callbacks, now=NOW,
        yaml_config=yaml_config if yaml_config is not None else {},
        cost_map=cost_map if cost_map is not None else {"openrouter/vendor/model:free": {"input_cost_per_token": 0, "output_cost_per_token": 0}},
    )


class FingerprintTests(unittest.TestCase):
    def test_fingerprint_matches_the_official_attestation_binding(self):
        import s5_key_audit
        self.assertEqual(audit.fingerprint_token_hash(token_hash(KEY)), s5_key_audit.key_fingerprint(KEY))


class KeyPolicyTests(unittest.TestCase):
    def test_least_privilege_key_passes_every_key_gate(self):
        facts = collect()
        self.assertEqual(facts["KEY_MATCH"], "ONE")
        for gate in ("KEY_VALIDITY", "KEY_SCOPE", "KEY_ROUTES", "KEY_RATE_LIMITS", "KEY_BUDGET"):
            self.assertEqual(facts[gate], "PASS", gate)
        self.assertEqual(facts["KEY_INDIRECTION"], "NONE")
        self.assertEqual(facts["KEY_POLICY_GATE"], "PASS")

    def test_key_not_found_or_ambiguous_blocks(self):
        self.assertEqual(collect(FakeDb(tokens=[key_row(token=token_hash(OTHER_KEY))]))["KEY_MATCH"], "NONE")
        self.assertEqual(collect(FakeDb(tokens=[key_row(token=token_hash(OTHER_KEY))]))["KEY_POLICY_GATE"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(), key_row()]))["KEY_MATCH"], "MULTIPLE")

    def test_r4b_r2_shape_other_single_model_and_missing_limits_fails(self):
        facts = collect(FakeDb(tokens=[key_row(models=["some-other-alias"], rpm_limit=None, tpm_limit=None,
                                               max_budget=None, budget_duration=None)]))
        self.assertEqual(facts["KEY_SCOPE"], "FAIL")
        self.assertEqual(facts["KEY_SCOPE_DETAIL"], "OTHER_MODEL")
        self.assertEqual(facts["KEY_MODELS_COUNT"], "1")
        self.assertEqual(facts["KEY_RATE_LIMITS"], "FAIL")
        self.assertEqual(facts["KEY_BUDGET"], "FAIL")
        self.assertEqual(facts["KEY_POLICY_GATE"], "FAIL")

    def test_scope_variants(self):
        cases = {
            (): "UNRESTRICTED_ALL_MODELS",
            ("all-proxy-models",): "WILDCARD",
            ("openrouter/*",): "WILDCARD",
            (ALIAS, "mistral-small"): "EXTRA_MODELS",
            (ALIAS,): "EXACT_ALIAS",
        }
        for models, detail in cases.items():
            facts = collect(FakeDb(tokens=[key_row(models=list(models))]))
            self.assertEqual(facts["KEY_SCOPE_DETAIL"], detail, models)
            self.assertEqual(facts["KEY_SCOPE"], "PASS" if detail == "EXACT_ALIAS" else "FAIL")

    def test_routes_validity_rate_and_budget_edges(self):
        self.assertEqual(collect(FakeDb(tokens=[key_row(allowed_routes=[])]))["KEY_ROUTES"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(allowed_routes=["llm_api_routes", "/key/generate"])]))["KEY_ROUTES"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(blocked=True)]))["KEY_VALIDITY"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(expires=NOW - timedelta(seconds=1))]))["KEY_VALIDITY"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(expires=NOW + timedelta(days=30))]))["KEY_VALIDITY"], "PASS")
        self.assertEqual(collect(FakeDb(tokens=[key_row(rpm_limit=0)]))["KEY_RATE_LIMITS"], "FAIL")
        self.assertEqual(collect(FakeDb(tokens=[key_row(rpm_limit=50)]))["KEY_RPM_WITHIN_APP"], "NO")
        self.assertEqual(collect(FakeDb(tokens=[key_row(max_budget=5.0)]))["KEY_BUDGET"], "FAIL")  # above app cap
        self.assertEqual(collect(FakeDb(tokens=[key_row(spend=0.5)]))["KEY_BUDGET"], "FAIL")      # exhausted
        self.assertEqual(collect(FakeDb(tokens=[key_row(budget_duration="")]))["KEY_BUDGET"], "FAIL")

    def test_indirections_that_change_the_effective_policy_are_never_a_pass(self):
        cases = {
            "ALIASES": {"aliases": {ALIAS: "openai/gpt-4o"}},
            "ROUTER_SETTINGS": {"router_settings": {"fallbacks": [{ALIAS: ["paid-model"]}]}},
            "TEAM": {"team_id": "team-1"},
            "ACCESS_GROUPS": {"access_group_ids": ["grp"]},
            "POLICIES": {"policies": ["p1"]},
            "OBJECT_PERMISSION": {"object_permission_id": "op-1"},
        }
        for name, change in cases.items():
            facts = collect(FakeDb(tokens=[key_row(**change)]))
            self.assertIn(name, facts["KEY_INDIRECTION"].split(","), name)
            self.assertNotEqual(facts["KEY_POLICY_GATE"], "PASS", name)

    def test_budget_table_limits_are_used_when_the_key_delegates_them(self):
        db = FakeDb(tokens=[key_row(budget_id="b-1", rpm_limit=None, tpm_limit=None, max_budget=None, budget_duration=None)],
                    budgets={"b-1": {"rpm_limit": 5, "tpm_limit": 20000, "max_budget": 0.5, "budget_duration": "30d"}})
        facts = collect(db)
        self.assertEqual(facts["KEY_LIMIT_SOURCE"], "BUDGET_TABLE")
        self.assertEqual(facts["KEY_RATE_LIMITS"], "PASS")
        self.assertEqual(facts["KEY_BUDGET"], "PASS")
        self.assertEqual(facts["KEY_POLICY_GATE"], "PASS")


class SchemaCompatibilityTests(unittest.TestCase):
    """Older LiteLLM versions lack newer key columns: select only what exists, never guess."""

    def test_missing_optional_indirection_columns_are_not_selected_or_flagged(self):
        columns = [c for c in audit.KEY_COLUMNS if c not in ("access_group_ids", "policies", "object_permission_id")]
        db = FakeDb(columns=columns)
        facts = collect(db)
        self.assertEqual(facts["KEY_SCHEMA"], "PARTIAL_OPTIONAL")
        self.assertEqual(facts["KEY_POLICY_GATE"], "PASS")
        token_sql = next(sql for sql in db.statements if "LiteLLM_VerificationToken" in sql)
        self.assertNotIn("access_group_ids", token_sql)

    def test_missing_allowed_routes_column_is_not_verified(self):
        db = FakeDb(columns=[c for c in audit.KEY_COLUMNS if c != "allowed_routes"])
        facts = collect(db)
        self.assertEqual(facts["KEY_ROUTES"], "NOT_VERIFIED")
        self.assertEqual(facts["KEY_POLICY_GATE"], "NOT_VERIFIED")

    def test_missing_required_columns_hold(self):
        with self.assertRaises(audit.ProbeError) as caught:
            collect(FakeDb(columns=["token", "spend"]))
        self.assertEqual(str(caught.exception), "DB_SCHEMA_UNSUPPORTED")

    def test_full_schema_is_reported(self):
        self.assertEqual(collect()["KEY_SCHEMA"], "FULL")


class RouteAndFallbackTests(unittest.TestCase):
    def test_single_enabled_db_deployment_with_one_provider_passes(self):
        facts = collect()
        self.assertEqual(facts["DEPLOYMENTS_DB"], "1")
        self.assertEqual(facts["DEPLOYMENTS_YAML"], "0")
        self.assertEqual(facts["PROVIDER_FAMILY"], "OPENROUTER")
        self.assertEqual(facts["ENDPOINT_CLASS"], "PROVIDER_DEFAULT")
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "PASS")

    def test_yaml_and_db_deployments_are_both_counted(self):
        yaml_config = {"model_list": [{"model_name": ALIAS, "litellm_params": {"model": "groq/llama"}}]}
        facts = collect(yaml_config=yaml_config)
        self.assertEqual(facts["DEPLOYMENT_SOURCE"], "DB_AND_YAML")
        self.assertEqual(facts["PROVIDER_FAMILY"], "MIXED")
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "FAIL")

    def test_missing_blocked_custom_and_unknown_deployments(self):
        self.assertEqual(collect(FakeDb(models=[]))["MODEL_ROUTE_GATE"], "FAIL")
        blocked = collect(FakeDb(models=[dict(deployment(blocked=True), model_name=ALIAS)]))
        self.assertEqual(blocked["DEPLOYMENT_BLOCKED"], "ALL")
        self.assertEqual(blocked["MODEL_ROUTE_GATE"], "FAIL")
        custom = collect(FakeDb(models=[dict(deployment(api_base="https://proxy.internal:9/v1"), model_name=ALIAS)]))
        self.assertEqual(custom["ENDPOINT_CLASS"], "CUSTOM_ENDPOINT")
        self.assertEqual(custom["MODEL_ROUTE_GATE"], "NOT_VERIFIED")
        local = collect(FakeDb(models=[dict(deployment(model="ollama_chat/llama3.2:3b", api_base="http://ollama:11434"), model_name=ALIAS)]))
        self.assertEqual((local["PROVIDER_FAMILY"], local["ENDPOINT_CLASS"]), ("OLLAMA", "LOCAL_OLLAMA"))
        unknown = collect(FakeDb(models=[dict(deployment(model="weird-vendor/m"), model_name=ALIAS)]))
        self.assertEqual(unknown["PROVIDER_FAMILY"], "OTHER")
        self.assertEqual(unknown["MODEL_ROUTE_GATE"], "NOT_VERIFIED")

    def test_key_alias_remap_fails_the_route(self):
        facts = collect(FakeDb(tokens=[key_row(aliases={ALIAS: "openai/gpt-4o"})]))
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "FAIL")

    def test_no_fallback_anywhere_passes(self):
        facts = collect(FakeDb(config={"router_settings": {"num_retries": 1}}),
                        yaml_config={"router_settings": {"routing_strategy": "simple-shuffle"}})
        for name in ("FALLBACK_ALIAS_RULE", "FALLBACK_DEFAULT_RULE", "FALLBACK_CONTEXT_WINDOW", "FALLBACK_CONTENT_POLICY"):
            self.assertEqual(facts[name], "NONE", name)
        self.assertEqual(facts["FALLBACK_GATE"], "PASS")

    def test_every_fallback_source_and_shape_is_detected(self):
        cases = [
            ({"router_settings": {"fallbacks": [{ALIAS: ["paid"]}]}}, {}, None, "FALLBACK_ALIAS_RULE"),
            ({}, {"router_settings": {"default_fallbacks": ["paid"]}}, None, "FALLBACK_DEFAULT_RULE"),
            ({}, {"litellm_settings": {"fallbacks": [{ALIAS: ["paid"]}]}}, None, "FALLBACK_ALIAS_RULE"),
            ({}, {"router_settings": {"context_window_fallbacks": [{ALIAS: ["big"]}]}}, None, "FALLBACK_CONTEXT_WINDOW"),
            ({}, {"router_settings": {"content_policy_fallbacks": [{ALIAS: ["x"]}]}}, None, "FALLBACK_CONTENT_POLICY"),
            ({"router_settings": {"fallbacks": [{"*": ["paid"]}]}}, {}, None, "FALLBACK_DEFAULT_RULE"),
            ({}, {}, {"fallbacks": [{ALIAS: ["paid"]}]}, "FALLBACK_ALIAS_RULE"),  # key-level router_settings
        ]
        for db_config, yaml_config, key_router, field in cases:
            tokens = [key_row(router_settings=key_router)] if key_router else None
            facts = collect(FakeDb(tokens=tokens, config=db_config), yaml_config=yaml_config)
            self.assertEqual(facts[field], "PRESENT", (db_config, yaml_config, key_router))
            self.assertEqual(facts["FALLBACK_GATE"], "FAIL")

    def test_unparseable_fallback_shape_is_not_verified(self):
        facts = collect(FakeDb(config={"router_settings": {"fallbacks": "not-a-list"}}))
        self.assertEqual(facts["FALLBACK_GATE"], "NOT_VERIFIED")


class PricingCallbacksPrivacyTests(unittest.TestCase):
    def test_configured_and_published_price_are_separate_and_never_prove_cost(self):
        facts = collect()
        self.assertEqual(facts["CONFIGURED_PRICE"], "ZERO")
        self.assertEqual(facts["PUBLISHED_PRICE_MAP"], "ZERO")
        self.assertEqual(facts["PRICING_GATE"], "NOT_VERIFIED_PROVIDER_TERMS")

    def test_nonzero_or_missing_prices(self):
        paid = collect(FakeDb(models=[dict(deployment(costs=(1e-7, 2e-7)), model_name=ALIAS)]))
        self.assertEqual((paid["CONFIGURED_PRICE"], paid["PRICING_GATE"]), ("NONZERO", "FAIL"))
        unpriced = collect(FakeDb(models=[dict(deployment(costs=None), model_name=ALIAS)]), cost_map={})
        self.assertEqual(unpriced["CONFIGURED_PRICE"], "NOT_PUBLISHED")
        self.assertEqual(unpriced["PUBLISHED_PRICE_MAP"], "NOT_LISTED")
        self.assertEqual(unpriced["PRICING_GATE"], "NOT_VERIFIED")
        published_paid = collect(cost_map={"openrouter/vendor/model:free": {"input_cost_per_token": 3e-7, "output_cost_per_token": 0}})
        self.assertEqual(published_paid["PUBLISHED_PRICE_MAP"], "NONZERO")
        self.assertEqual(published_paid["PRICING_GATE"], "FAIL")

    def test_callbacks_from_db_and_yaml_against_the_allowlist(self):
        facts = collect(FakeDb(config={"litellm_settings": {"success_callback": ["langfuse"]}}),
                        yaml_config={"litellm_settings": {"callbacks": ["prometheus"], "failure_callback": ["sentry"]}})
        self.assertEqual(facts["CALLBACKS_CONFIGURED"], "LANGFUSE,PROMETHEUS,SENTRY")
        self.assertEqual(facts["CALLBACK_GATE"], "FAIL")
        allowed = collect(FakeDb(config={"litellm_settings": {"success_callback": ["prometheus"]}}),
                          allowed_callbacks=frozenset({"prometheus"}))
        self.assertEqual(allowed["CALLBACK_GATE"], "PASS")
        self.assertEqual(collect()["CALLBACKS_CONFIGURED"], "NONE")
        custom = collect(yaml_config={"litellm_settings": {"callbacks": ["my_module.handler_instance"]}})
        self.assertEqual(custom["CALLBACKS_CONFIGURED"], "OTHER")
        self.assertEqual(custom["CALLBACK_GATE"], "FAIL")

    def test_provider_privacy_and_official_attestation_are_never_claimed(self):
        facts = collect()
        self.assertEqual(facts["PROVIDER_PRIVACY_GATE"], "NOT_VERIFIED_OPERATOR_TERMS_REQUIRED")
        self.assertEqual(facts["OFFICIAL_ATTESTATION"], "HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE")
        self.assertEqual(facts["EVIDENCE_KIND"], "DIAGNOSTIC_DB_CONFIG_READONLY")
        self.assertEqual(facts["S5_PREFLIGHT_EFFECT"], "NONE")


class SafetyTests(unittest.TestCase):
    def test_read_only_transaction_is_required(self):
        with self.assertRaises(audit.ProbeError) as caught:
            collect(FakeDb(read_only="off"))
        self.assertEqual(str(caught.exception), "DB_NOT_READ_ONLY")

    def test_only_select_and_show_statements_are_issued(self):
        db = FakeDb(tokens=[key_row(budget_id="b-1")], budgets={"b-1": {"rpm_limit": 1}})
        collect(db)
        for sql in db.statements:
            self.assertRegex(" ".join(sql.split()).upper(), r"^(SELECT|SHOW) ")
            self.assertNotRegex(sql.upper(), r"\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|TRUNCATE)\b")

    def test_receipt_never_contains_aliases_hashes_urls_or_keys(self):
        db = FakeDb(models=[dict(deployment(api_base="https://proxy.internal:9/v1"), model_name=ALIAS)],
                    config={"litellm_settings": {"success_callback": ["langfuse"]}})
        facts = collect(db)
        lines = audit.render(facts, container_identity="UNCHANGED")
        text = "\n".join(lines)
        for forbidden in (ALIAS, KEY, token_hash(KEY), "proxy.internal", "openrouter/vendor", "newsflux-prod",
                          "PROVIDER_KEY", audit.fingerprint_token_hash(token_hash(KEY))):
            self.assertNotIn(forbidden, text)
        for line in lines:
            name, _, value = line.partition("=")
            self.assertRegex(name, r"^[A-Z0-9_]+$")
            self.assertRegex(value, SAFE_VALUE, line)

    def test_render_rejects_unsafe_values(self):
        with self.assertRaises(audit.ProbeError):
            audit.render({"KEY_MATCH": "newsflux-s5-free"}, container_identity="UNCHANGED")


class ProbeTransportTests(unittest.TestCase):
    """Container side: input on stdin, classifications only on stdout, detail-free errors."""

    def run_probe(self, db, payload=None):
        payload = payload or {"fingerprint": audit.fingerprint_token_hash(token_hash(KEY)), "alias": ALIAS,
                              "caps": CAPS, "allowed_callbacks": []}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.probe_main(payload, query_factory=lambda: db, yaml_loader=lambda: {}, cost_map_loader=lambda: {}, now=NOW)
        return code, out.getvalue()

    def test_probe_prints_one_json_document_of_safe_values(self):
        code, text = self.run_probe(FakeDb())
        self.assertEqual(code, 0)
        document = json.loads(text)
        self.assertEqual(document["KEY_POLICY_GATE"], "PASS")
        for value in document.values():
            self.assertRegex(value, SAFE_VALUE)

    def test_probe_errors_are_detail_free(self):
        def broken():
            raise RuntimeError("postgresql://user:secret@db/litellm")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.probe_main({"fingerprint": "0" * 64, "alias": ALIAS, "caps": CAPS, "allowed_callbacks": []},
                                    query_factory=broken, yaml_loader=lambda: {}, cost_map_loader=lambda: {}, now=NOW)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue()), {"PROBE": "DB_UNAVAILABLE"})
        self.assertNotIn("secret", out.getvalue())


class HostOrchestrationTests(unittest.TestCase):
    """Host side: docker calls are injected; checks order, flags OFF, snapshots and no secret on argv."""

    def fake_docker(self, *, flags=None, snapshots=None, probe=None):
        calls = []
        snaps = list(snapshots or ["SNAP-A", "SNAP-A"])
        env = {"NEWSFLUX_AI_INFERENCE_ENABLED": "false", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false"}
        env.update(flags or {})

        def run(argv, stdin=None):
            calls.append((argv, stdin))
            if argv[:2] == ["docker", "ps"]:
                return "summary-id\n" if "label=com.docker.compose.service=summary-api" in argv else "litellm-id\n"
            if argv[:2] == ["docker", "inspect"] and "{{range .Config.Env}}" in " ".join(argv):
                return "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"
            if argv[:2] == ["docker", "inspect"] and "{{json .Config.Env}}" in " ".join(argv):
                return json.dumps([f"{k}={v}" for k, v in env.items()])
            if argv[:2] == ["docker", "inspect"]:
                return snaps.pop(0)
            if argv[:3] == ["docker", "exec", "-u"]:  # Summary: fingerprint + alias + caps
                return json.dumps({"fingerprint": "f" * 64, "alias": ALIAS, "caps": CAPS, "allowed_callbacks": [],
                                   "runtime_flags": {"inference": False, "external_transfer": False}})
            if argv[:3] == ["docker", "exec", "-i"]:
                return json.dumps(probe or {"KEY_MATCH": "ONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"})
            raise AssertionError(argv)

        return run, calls

    def host(self, run, **kwargs):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(["--litellm-container", "litellm"], run=run, euid=kwargs.get("euid", 0))
        return code, out.getvalue().splitlines()

    def test_happy_path_prints_classifications_and_unchanged_container_identity(self):
        run, calls = self.fake_docker()
        code, lines = self.host(run)
        self.assertEqual(code, 0, lines)
        self.assertIn("S5R1_KEY_POLICY_GATE=FAIL", lines)
        self.assertIn("S5R1_CONTAINER_IDENTITY=UNCHANGED", lines)
        self.assertIn("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", lines)
        text = "\n".join(lines)
        self.assertNotIn(ALIAS, text)
        for argv, stdin in calls:
            self.assertNotIn(ALIAS, " ".join(argv))       # the alias travels on stdin only
            self.assertNotIn("f" * 64, " ".join(argv))     # so does the fingerprint
        probe_calls = [stdin for argv, stdin in calls if argv[:3] == ["docker", "exec", "-i"]]
        self.assertEqual(len(probe_calls), 1)
        self.assertIn(ALIAS, probe_calls[0])

    def test_refuses_without_root_or_with_ai_flags_on(self):
        run, _ = self.fake_docker()
        self.assertEqual(self.host(run, euid=1000), (2, ["S5R1_AUDIT=HOLD_NOT_ROOT"]))
        run, calls = self.fake_docker(flags={"NEWSFLUX_AI_INFERENCE_ENABLED": "true"})
        self.assertEqual(self.host(run), (2, ["S5R1_AUDIT=HOLD_AI_FLAGS_NOT_OFF"]))
        self.assertFalse([argv for argv, _ in calls if argv[:2] == ["docker", "exec"]])

    def test_container_state_change_during_the_audit_is_reported(self):
        run, _ = self.fake_docker(snapshots=["SNAP-A", "SNAP-B"])
        code, lines = self.host(run)
        self.assertEqual(code, 3)
        self.assertIn("S5R1_AUDIT=HOLD_CONTAINER_STATE_CHANGED", lines)

    def test_litellm_container_is_detected_by_image_not_by_name(self):
        run, calls = self.fake_docker()

        def wrapped(argv, stdin=None):
            if argv[:2] == ["docker", "ps"] and "--format" in argv:
                return ("aaa postgres:16\nbbb ghcr.io/berriai/litellm-database:main-stable\n"
                        "ccc litellm/litellm@sha256:abc\nddd redis:7\n")
            return run(argv, stdin)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main([], run=wrapped, euid=0)
        self.assertEqual(code, 0, out.getvalue())
        probe = [argv for argv, _ in calls if argv[:3] == ["docker", "exec", "-i"]]
        self.assertEqual(probe[0][3], "ccc")

    def test_ambiguous_litellm_containers_hold(self):
        run, _ = self.fake_docker()

        def wrapped(argv, stdin=None):
            if argv[:2] == ["docker", "ps"] and "--format" in argv:
                return "ccc litellm/litellm:v1\neee ghcr.io/berriai/litellm:main\n"
            return run(argv, stdin)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main([], run=wrapped, euid=0)
        self.assertEqual((code, out.getvalue().strip()), (2, "S5R1_AUDIT=HOLD_LITELLM_CONTAINER_NOT_UNIQUE"))

    def test_unsafe_probe_output_is_rejected(self):
        run, _ = self.fake_docker(probe={"KEY_MATCH": "newsflux-s5-free"})
        code, lines = self.host(run)
        self.assertEqual((code, lines[-1]), (2, "S5R1_AUDIT=HOLD_PROBE_OUTPUT_UNSAFE"))


if __name__ == "__main__":
    unittest.main()


# ----------------------------------------------------------------------------------------------
# PM corrective R2 (review 7025985878): every finding RED first.
# ----------------------------------------------------------------------------------------------
def collect_with_yaml(status, config, db=None, **kwargs):
    return audit.collect(
        db or FakeDb(), fingerprint=audit.fingerprint_token_hash(token_hash(KEY)), alias=ALIAS, caps=CAPS,
        allowed_callbacks=kwargs.get("allowed_callbacks", frozenset()), now=NOW, yaml_config=config,
        cost_map={"openrouter/vendor/model:free": {"input_cost_per_token": 0, "output_cost_per_token": 0}},
        yaml_status=status,
    )


class YamlCompletenessTests(unittest.TestCase):
    """Finding 1: a YAML source that is missing, unreadable or malformed never yields PASS."""

    GATES = ("FALLBACK_GATE", "CALLBACK_GATE", "MODEL_ROUTE_GATE")

    def assert_not_pass(self, facts, yaml_class):
        self.assertEqual(facts["YAML_CONFIG"], yaml_class)
        for gate in self.GATES:
            self.assertNotEqual(facts[gate], "PASS", (yaml_class, gate))

    def test_safe_db_rows_alone_pass_only_with_a_loaded_yaml(self):
        facts = collect_with_yaml("LOADED", {})
        for gate in self.GATES:
            self.assertEqual(facts[gate], "PASS", gate)

    def test_not_found_unreadable_and_invalid_root_are_not_verified(self):
        for status, config, expected in (
            ("NOT_FOUND", {}, "NOT_FOUND"),
            ("UNREADABLE", {}, "UNREADABLE"),
            ("LOADED", None, "INVALID_ROOT"),          # empty file
            ("LOADED", ["model_list"], "INVALID_ROOT"),
            ("LOADED", "text", "INVALID_ROOT"),
        ):
            facts = collect_with_yaml(status, config)
            self.assert_not_pass(facts, expected)
            for gate in self.GATES:
                self.assertEqual(facts[gate], "NOT_VERIFIED", (status, gate))

    def test_incompatible_section_shapes_are_not_verified(self):
        for config in (
            {"model_list": {"model_name": ALIAS}},
            {"model_list": ["not-a-mapping"]},
            {"router_settings": ["fallbacks"]},
            {"litellm_settings": "callbacks"},
        ):
            self.assert_not_pass(collect_with_yaml("LOADED", config), "INVALID_STRUCTURE")

    def test_fail_findings_are_kept_even_without_yaml(self):
        db = FakeDb(config={"router_settings": {"fallbacks": [{ALIAS: ["paid"]}]}})
        self.assertEqual(collect_with_yaml("UNREADABLE", {}, db)["FALLBACK_GATE"], "FAIL")

    def test_probe_rejects_a_non_mapping_root_even_when_the_loader_says_loaded(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            audit.probe_main({"fingerprint": audit.fingerprint_token_hash(token_hash(KEY)), "alias": ALIAS,
                              "caps": CAPS, "allowed_callbacks": []},
                             query_factory=lambda: FakeDb(), yaml_loader=lambda: ("LOADED", ["x"]),
                             cost_map_loader=lambda: {}, now=NOW)
        document = json.loads(out.getvalue())
        self.assertEqual(document["YAML_CONFIG"], "INVALID_ROOT")
        self.assertEqual(document["FALLBACK_GATE"], "NOT_VERIFIED")


class CallbackShapeTests(unittest.TestCase):
    """Finding 2: unrecognized callback shapes are never read as "no callbacks"."""

    def callbacks(self, db_settings=None, yaml_settings=None, allowed=frozenset()):
        db = FakeDb(config={"litellm_settings": db_settings} if db_settings is not None else {})
        yaml_config = {"litellm_settings": yaml_settings} if yaml_settings is not None else {}
        return collect_with_yaml("LOADED", yaml_config, db, allowed_callbacks=allowed)

    def test_dict_nested_and_non_string_values_are_not_verified(self):
        for value in ({"handler": "custom"}, [{"handler": "custom"}], [["langfuse"]], [1], 7, True):
            facts = self.callbacks(db_settings={"success_callback": value})
            self.assertEqual(facts["CALLBACK_GATE"], "NOT_VERIFIED", value)
            self.assertIn("UNRECOGNIZED", facts["CALLBACKS_CONFIGURED"].split(","), value)

    def test_non_mapping_db_settings_block_is_not_verified(self):
        facts = self.callbacks(db_settings=["success_callback", "langfuse"])
        self.assertEqual(facts["CALLBACK_GATE"], "NOT_VERIFIED")

    def test_strings_and_lists_across_db_and_yaml(self):
        facts = self.callbacks(db_settings={"success_callback": "langfuse"},
                               yaml_settings={"failure_callback": ["sentry"], "callbacks": []},
                               allowed=frozenset({"langfuse", "sentry"}))
        self.assertEqual((facts["CALLBACKS_CONFIGURED"], facts["CALLBACK_GATE"]), ("LANGFUSE,SENTRY", "PASS"))
        facts = self.callbacks(yaml_settings={"service_callback": ["datadog"]}, allowed=frozenset({"langfuse"}))
        self.assertEqual(facts["CALLBACK_GATE"], "FAIL")

    def test_known_disallowed_callback_fails_even_next_to_an_unrecognized_one(self):
        facts = self.callbacks(db_settings={"success_callback": ["langfuse", {"x": 1}]})
        self.assertEqual(facts["CALLBACK_GATE"], "FAIL")

    def test_empty_values_are_absence(self):
        for value in (None, "", []):
            self.assertEqual(self.callbacks(db_settings={"success_callback": value})["CALLBACK_GATE"], "PASS", value)


class SpendAndRateCapTests(unittest.TestCase):
    """Finding 3: unknown spend is never zero; key limits above the app caps never pass."""

    def test_null_or_invalid_spend_is_not_verified(self):
        for spend in (None, "abc", True, float("nan")):
            facts = collect(FakeDb(tokens=[key_row(spend=spend)]))
            self.assertEqual(facts["KEY_BUDGET"], "NOT_VERIFIED", spend)
            self.assertEqual(facts["KEY_SPEND"], "UNKNOWN", spend)
            self.assertNotEqual(facts["KEY_POLICY_GATE"], "PASS", spend)

    def test_known_spend_is_reported(self):
        self.assertEqual(collect()["KEY_SPEND"], "KNOWN")

    def test_key_limits_above_the_app_caps_fail(self):
        for change, field in (({"rpm_limit": 50}, "KEY_RPM_WITHIN_APP"), ({"tpm_limit": 200000}, "KEY_TPM_WITHIN_APP")):
            facts = collect(FakeDb(tokens=[key_row(**change)]))
            self.assertEqual(facts[field], "NO")
            self.assertEqual(facts["KEY_RATE_LIMITS"], "FAIL")
            self.assertEqual(facts["KEY_POLICY_GATE"], "FAIL")

    def test_missing_app_caps_never_pass(self):
        for caps in ({"rpm": None, "tpm": 20000, "budget": 1.0}, {"rpm": 5, "tpm": 0, "budget": 1.0}, {}):
            facts = collect(caps=caps)
            self.assertNotEqual(facts["KEY_RATE_LIMITS"], "PASS", caps)
            self.assertNotEqual(facts["KEY_POLICY_GATE"], "PASS", caps)
            self.assertIn("APP_CAP_MISSING", (facts["KEY_RPM_WITHIN_APP"], facts["KEY_TPM_WITHIN_APP"]), caps)

    def test_limits_equal_to_the_app_caps_pass(self):
        facts = collect(FakeDb(tokens=[key_row(rpm_limit=5, tpm_limit=20000)]))
        self.assertEqual((facts["KEY_RATE_LIMITS"], facts["KEY_POLICY_GATE"]), ("PASS", "PASS"))


class ExactScopeTests(unittest.TestCase):
    """Finding 4: models must be exactly a one-element list holding the S5 alias string."""

    def test_duplicates_non_strings_and_non_lists_fail(self):
        for models, detail in (
            ([ALIAS, ALIAS], "DUPLICATE_ENTRIES"),
            ([ALIAS, None], "INVALID_ENTRY"),
            ([b"newsflux-s5-free"], "INVALID_ENTRY"),
            (ALIAS, "INVALID_TYPE"),
            ({ALIAS: True}, "INVALID_TYPE"),
            ([ALIAS + " "], "OTHER_MODEL"),
        ):
            facts = collect(FakeDb(tokens=[key_row(models=models)]))
            self.assertEqual(facts["KEY_SCOPE_DETAIL"], detail, models)
            self.assertEqual(facts["KEY_SCOPE"], "FAIL", models)
            self.assertNotEqual(facts["KEY_POLICY_GATE"], "PASS", models)

    def test_duplicate_routes_fail_the_exact_route_contract(self):
        facts = collect(FakeDb(tokens=[key_row(allowed_routes=["llm_api_routes", "llm_api_routes"])]))
        self.assertEqual(facts["KEY_ROUTES"], "FAIL")


class CompletenessTests(unittest.TestCase):
    """Finding 5: bounded reads are never presented as complete."""

    def test_key_lookup_is_an_exact_server_side_match_without_a_scan_limit(self):
        tokens = [key_row(token=token_hash(f"sk-synthetic-bulk-{index:06d}-0000000000")) for index in range(6000)]
        tokens.append(key_row())
        db = FakeDb(tokens=tokens)
        facts = collect(db)
        self.assertEqual((facts["KEY_MATCH"], facts["KEY_LOOKUP"]), ("ONE", "EXACT_FINGERPRINT"))
        token_sql = next(sql for sql in db.statements if "LiteLLM_VerificationToken" in sql and "information_schema" not in sql)
        self.assertIn("sha256", token_sql)
        self.assertEqual(db.token_lookup[0], b"newsflux-s5-key-attestation-v1\x00")

    def test_two_matches_are_multiple_not_one(self):
        self.assertEqual(collect(FakeDb(tokens=[key_row(), key_row()]))["KEY_MATCH"], "MULTIPLE")

    def test_deployment_read_at_its_bound_is_truncated_not_complete(self):
        models = [dict(deployment(), model_name=ALIAS) for _ in range(audit.MAX_DEPLOYMENT_ROWS + 1)]
        facts = collect(FakeDb(models=models))
        self.assertEqual(facts["DEPLOYMENTS_DB"], "NOT_VERIFIED_TRUNCATED")
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "NOT_VERIFIED")
        self.assertEqual(facts["PRICING_GATE"], "NOT_VERIFIED")

    def test_deployments_just_below_the_bound_are_complete(self):
        models = [dict(deployment(), model_name=ALIAS) for _ in range(audit.MAX_DEPLOYMENT_ROWS)]
        facts = collect(FakeDb(models=models))
        self.assertEqual(facts["DEPLOYMENTS_DB"], str(audit.MAX_DEPLOYMENT_ROWS))
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "PASS")


class ContainerYamlLoaderTests(unittest.TestCase):
    """The in-container loader reports what it read; collect() classifies the root (found by the
    real-LiteLLM rehearsal: a list root was collapsed into UNREADABLE)."""

    def load(self, content, *, with_config=True):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "config.yaml")
            if content is not None:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(content)
            cmdline = os.path.join(directory, "cmdline")
            argv = [b"litellm", b"--config", path.encode()] if with_config else [b"litellm"]
            with open(cmdline, "wb") as handle:
                handle.write(b"\0".join(argv))
            return audit._container_yaml(cmdline_path=cmdline, environ={})

    def test_classes(self):
        import importlib.util
        if importlib.util.find_spec("yaml") is None:  # present in the LiteLLM image; optional on a CI host
            self.skipTest("PyYAML not installed on this host")
        self.assertEqual(self.load("model_list: []\n"), ("LOADED", {"model_list": []}))
        self.assertEqual(self.load("- just\n- a list\n"), ("LOADED", ["just", "a list"]))
        self.assertEqual(self.load("")[0], "LOADED")  # None root: collect() calls it INVALID_ROOT
        self.assertEqual(self.load("model_list: [unclosed\n  : :\n")[0], "UNREADABLE")
        self.assertEqual(self.load(None)[0], "UNREADABLE")  # named but missing file
        self.assertEqual(self.load("x: 1\n", with_config=False), ("NOT_FOUND", {}))

    def test_list_root_reaches_collect_as_invalid_root(self):
        facts = collect_with_yaml("LOADED", ["just", "a list"])
        self.assertEqual(facts["YAML_CONFIG"], "INVALID_ROOT")


class UnreadYamlRouteTests(unittest.TestCase):
    """No DB deployment while the YAML could not be read is unknown, not a proven absence."""

    def test_no_db_deployment_and_unread_yaml_is_not_verified(self):
        for status, config in (("NOT_FOUND", {}), ("UNREADABLE", {}), ("LOADED", ["x"])):
            facts = collect_with_yaml(status, config, FakeDb(models=[]))
            self.assertEqual(facts["MODEL_ROUTE_GATE"], "NOT_VERIFIED", status)

    def test_no_deployment_with_a_readable_yaml_is_a_fail(self):
        self.assertEqual(collect_with_yaml("LOADED", {}, FakeDb(models=[]))["MODEL_ROUTE_GATE"], "FAIL")

    def test_proven_route_failures_stay_fail_without_yaml(self):
        db = FakeDb(tokens=[key_row(aliases={ALIAS: "other"})])
        self.assertEqual(collect_with_yaml("UNREADABLE", {}, db)["MODEL_ROUTE_GATE"], "FAIL")


# ----------------------------------------------------------------------------------------------
# PM final corrective R2A (review 7026347085).
# ----------------------------------------------------------------------------------------------
class GeneralSettingsFallbackTests(unittest.TestCase):
    """P1: general_settings is a source; a fallback there is never omitted, never claimed effective."""

    def test_alias_and_global_fallbacks_in_db_and_yaml_general_settings_never_pass(self):
        cases = [
            ({"general_settings": {"fallbacks": [{ALIAS: ["paid"]}]}}, {}),
            ({"general_settings": {"default_fallbacks": ["paid"]}}, {}),
            ({}, {"general_settings": {"fallbacks": [{"*": ["paid"]}]}}),
            ({}, {"general_settings": {"context_window_fallbacks": [{ALIAS: ["big"]}]}}),
            ({}, {"general_settings": {"content_policy_fallbacks": [{ALIAS: ["x"]}]}}),
        ]
        for db_config, yaml_config in cases:
            facts = collect_with_yaml("LOADED", yaml_config, FakeDb(config=db_config))
            self.assertEqual(facts["FALLBACK_GENERAL_SETTINGS"], "PRESENT_UNVERIFIED_SEMANTICS", (db_config, yaml_config))
            self.assertEqual(facts["FALLBACK_GATE"], "NOT_VERIFIED", (db_config, yaml_config))

    def test_general_settings_without_fallbacks_still_passes(self):
        facts = collect_with_yaml("LOADED", {"general_settings": {"master_key": "os.environ/X"}},
                                  FakeDb(config={"general_settings": {"alerting": ["slack"]}}))
        self.assertEqual((facts["FALLBACK_GENERAL_SETTINGS"], facts["FALLBACK_GATE"]), ("NONE", "PASS"))

    def test_unrecognized_general_settings_shapes_are_not_verified(self):
        facts = collect_with_yaml("LOADED", {}, FakeDb(config={"general_settings": ["fallbacks"]}))
        self.assertEqual(facts["FALLBACK_GATE"], "NOT_VERIFIED")
        facts = collect_with_yaml("LOADED", {"general_settings": {"fallbacks": "paid"}})
        self.assertEqual(facts["FALLBACK_GATE"], "NOT_VERIFIED")
        facts = collect_with_yaml("LOADED", {"general_settings": "fallbacks"})
        self.assertEqual(facts["YAML_CONFIG"], "INVALID_STRUCTURE")
        self.assertEqual(facts["FALLBACK_GATE"], "NOT_VERIFIED")

    def test_a_proven_router_fallback_still_fails(self):
        db = FakeDb(config={"router_settings": {"fallbacks": [{ALIAS: ["paid"]}]},
                            "general_settings": {"default_fallbacks": ["paid"]}})
        self.assertEqual(collect_with_yaml("LOADED", {}, db)["FALLBACK_GATE"], "FAIL")


class KeyIndirectionShapeTests(unittest.TestCase):
    """P1: non-dict aliases/router_settings are never ignored as "no indirection"."""

    def test_unexpected_shapes_never_yield_none_or_pass(self):
        for field in ("aliases", "router_settings"):
            for value in ([ALIAS, "other"], "remap", 7, True, ["x"], "not json {"):
                facts = collect(FakeDb(tokens=[key_row(**{field: value})]))
                self.assertNotEqual(facts["KEY_INDIRECTION"], "NONE", (field, value))
                self.assertIn(f"{field.upper()}_UNRECOGNIZED", facts["KEY_INDIRECTION"].split(","), (field, value))
                self.assertNotEqual(facts["KEY_POLICY_GATE"], "PASS", (field, value))

    def test_unrecognized_aliases_make_the_route_not_verified(self):
        facts = collect(FakeDb(tokens=[key_row(aliases=["x"])]))
        self.assertEqual(facts["MODEL_ROUTE_GATE"], "NOT_VERIFIED")

    def test_json_text_dicts_are_parsed_and_empty_values_are_none(self):
        facts = collect(FakeDb(tokens=[key_row(aliases=json.dumps({ALIAS: "other"}))]))
        self.assertIn("ALIASES", facts["KEY_INDIRECTION"].split(","))
        self.assertEqual(facts["KEY_POLICY_GATE"], "FAIL")
        for empty in (None, {}, "{}", ""):
            facts = collect(FakeDb(tokens=[key_row(aliases=empty, router_settings=empty)]))
            self.assertEqual((facts["KEY_INDIRECTION"], facts["KEY_POLICY_GATE"]), ("NONE", "PASS"), empty)


class EndpointLocalityTests(unittest.TestCase):
    """P2: port 11434 alone never proves a local endpoint."""

    def endpoint(self, api_base, model="ollama_chat/llama3.2:3b"):
        db = FakeDb(models=[dict(deployment(model=model, api_base=api_base), model_name=ALIAS)])
        return collect(db)["ENDPOINT_CLASS"]

    def test_external_hosts_on_the_ollama_port_are_custom(self):
        for base in ("http://api.example.com:11434", "https://ollama.example.org:11434/v1", "http://10.0.0.5:11434",
                     "http://ollama.evil:11434"):
            self.assertEqual(self.endpoint(base), "CUSTOM_ENDPOINT", base)

    def test_approved_local_identities(self):
        for base in ("http://ollama:11434", "http://localhost:11434", "http://127.0.0.1:11434"):
            self.assertEqual(self.endpoint(base), "LOCAL_OLLAMA", base)
        self.assertEqual(self.endpoint("http://ollama:11434", model="openai/x"), "CUSTOM_ENDPOINT")


class NoBytecodeAndHonestMutationClaimTests(HostOrchestrationTests):
    """P2: container Python runs with -B; the receipt claims no deliberate DB/config write and an
    unchanged container identity, never a complete filesystem-integrity proof."""

    def test_every_container_python_runs_with_dash_b(self):
        run, calls = self.fake_docker()
        self.host(run)
        execs = [argv for argv, _ in calls if argv[:2] == ["docker", "exec"]]
        self.assertEqual(len(execs), 2)
        for argv in execs:
            interpreter = next(i for i, part in enumerate(argv) if part in ("python", "python3"))
            self.assertEqual(argv[interpreter + 1], "-B", argv)

    def test_receipt_wording_is_qualified(self):
        run, _ = self.fake_docker()
        code, lines = self.host(run)
        self.assertEqual(code, 0)
        self.assertIn("S5R1_DELIBERATE_DB_CONFIG_WRITES=NONE", lines)
        self.assertIn("S5R1_CONTAINER_IDENTITY=UNCHANGED", lines)
        self.assertIn("S5R1_FILESYSTEM_INTEGRITY=NOT_PROVEN", lines)
        self.assertFalse([line for line in lines if line.startswith("S5R1_PRODUCTION_MUTATIONS")])


# ==================================================================================================
# S5-R3 read-only increment: budget cause, rate detail, effective object permissions, extra
# mechanisms, schema/version compatibility, strict R3 gate and the optional private prestate.
# ==================================================================================================
LAB_VERSION = "1.109.1"
# Literal copy of the 48 columns of LiteLLM_VerificationToken in the rehearsed lab image (1.109.1):
# a change in the auditor's list must be deliberate and visible here.
LAB_KEY_COLUMNS = (
    "token", "key_name", "key_alias", "soft_budget_cooldown", "spend", "expires", "models", "aliases", "config",
    "user_id", "team_id", "permissions", "max_parallel_requests", "metadata", "blocked", "tpm_limit", "rpm_limit",
    "max_budget", "budget_duration", "budget_reset_at", "allowed_cache_controls", "model_spend", "model_max_budget",
    "budget_id", "organization_id", "created_at", "created_by", "updated_at", "updated_by", "allowed_routes",
    "object_permission_id", "auto_rotate", "key_rotation_at", "last_rotation_at", "rotation_count",
    "rotation_interval", "project_id", "router_settings", "policies", "access_group_ids", "last_active", "agent_id",
    "budget_limits", "budget_fallbacks", "key_type", "settings_updated_at", "tpd_limit", "total_spend",
)
LAB_OBJPERM_COLUMNS = (
    "object_permission_id", "mcp_servers", "vector_stores", "mcp_access_groups", "mcp_tool_permissions", "agents",
    "agent_access_groups", "blocked_tools", "models", "mcp_toolsets", "search_tools", "mcp_tool_search_enabled", "skills",
)


def lab_key_row(**overrides):
    row = {name: None for name in LAB_KEY_COLUMNS}
    row.update(key_row())
    row.update(key_name="sk-...0000", auto_rotate=False, rotation_count=0, soft_budget_cooldown=False, key_type="default",
               total_spend=0.0, permissions={}, model_spend={}, model_max_budget={}, allowed_cache_controls=[],
               created_by="default_user_id", updated_by="default_user_id")
    row.update(overrides)
    return row


def empty_objperm(**overrides):
    row = {name: [] for name in LAB_OBJPERM_COLUMNS}
    row.update(object_permission_id="op-synthetic", mcp_tool_permissions={}, mcp_tool_search_enabled=None)
    row.update(overrides)
    return row


class R3Db(FakeDb):
    def __init__(self, *, row=None, objperms=None, key_columns=LAB_KEY_COLUMNS, objperm_columns=LAB_OBJPERM_COLUMNS, **kwargs):
        super().__init__(tokens=[row or lab_key_row()], columns=list(key_columns), **kwargs)
        self.objperms = objperms or {}
        self.objperm_columns = list(objperm_columns)

    def __call__(self, sql, params=()):
        lowered = " ".join(sql.split()).lower()
        if "information_schema.columns" in lowered and params and params[0] == "LiteLLM_ObjectPermissionTable":
            self.statements.append(sql)
            return [{"column_name": name} for name in self.objperm_columns]
        if '"litellm_objectpermissiontable"' in lowered:
            self.statements.append(sql)
            selected = re.findall(r'"([a-z_]+)"', sql.split("FROM")[0])
            rows = self.objperms.get(params[0], [])
            return [{k: v for k, v in r.items() if k in selected} for r in rows][:2]
        return super().__call__(sql, params)


def r3_collect(db=None, *, version=LAB_VERSION, caps=CAPS, sink=None):
    return audit.collect(
        db or R3Db(), fingerprint=audit.fingerprint_token_hash(token_hash(KEY)), alias=ALIAS, caps=caps,
        allowed_callbacks=frozenset(), now=NOW, yaml_config={}, version=version, prestate_sink=sink,
        cost_map={"openrouter/vendor/model:free": {"input_cost_per_token": 0, "output_cost_per_token": 0}},
    )


class R3BudgetCauseTests(unittest.TestCase):
    """KEY_BUDGET=FAIL is resolved into its exact cause(s), consistent with the R1 KEY_BUDGET verdict."""

    CASES = (
        ({"max_budget": None}, "MISSING", "MAX_BUDGET_MISSING"),
        ({"max_budget": "abc"}, "INVALID", "MAX_BUDGET_INVALID"),
        ({"max_budget": float("nan")}, "INVALID", "MAX_BUDGET_INVALID"),
        ({"max_budget": 0}, "NONPOSITIVE", "MAX_BUDGET_NONPOSITIVE"),
        ({"max_budget": -1.0}, "NONPOSITIVE", "MAX_BUDGET_NONPOSITIVE"),
        ({"max_budget": 2.0}, "ABOVE_APP_CAP", "MAX_BUDGET_ABOVE_APP_CAP"),
    )

    def test_each_max_budget_cause_is_named(self):
        for overrides, detail, cause in self.CASES:
            facts = r3_collect(R3Db(row=lab_key_row(**overrides)))
            self.assertEqual(facts["KEY_MAX_BUDGET"], detail, overrides)
            self.assertIn(cause, facts["KEY_BUDGET_CAUSE"].split(","), overrides)
            self.assertEqual(facts["KEY_BUDGET"], "FAIL", overrides)

    def test_duration_causes(self):
        for value, detail in ((None, "MISSING"), ("", "BLANK"), ("  ", "BLANK"), ("30d", "CALENDAR_MONTH"),
                              ("1mo", "CALENDAR_MONTH"), ("1d", "DAILY"), ("7d", "WEEKLY"), ("14d", "OTHER_WINDOW"),
                              ("monthly", "UNRECOGNIZED"), (30, "UNRECOGNIZED")):
            facts = r3_collect(R3Db(row=lab_key_row(budget_duration=value)))
            self.assertEqual(facts["KEY_BUDGET_DURATION"], detail, value)
        facts = r3_collect(R3Db(row=lab_key_row(budget_duration=None)))
        self.assertIn("BUDGET_DURATION_MISSING", facts["KEY_BUDGET_CAUSE"].split(","))

    def test_spend_and_app_cap(self):
        facts = r3_collect(R3Db(row=lab_key_row(spend=0.5, max_budget=0.5)))
        self.assertEqual((facts["KEY_SPEND_VS_MAX"], facts["KEY_BUDGET"]), ("AT_OR_ABOVE", "FAIL"))
        self.assertIn("SPEND_AT_OR_ABOVE_MAX", facts["KEY_BUDGET_CAUSE"])
        facts = r3_collect(caps={"rpm": 5, "tpm": 20000, "budget": None})
        self.assertEqual(facts["APP_BUDGET_CAP"], "MISSING")
        self.assertIn("APP_BUDGET_CAP_MISSING", facts["KEY_BUDGET_CAUSE"])
        facts = r3_collect(R3Db(row=lab_key_row(spend=None)))
        self.assertEqual((facts["KEY_SPEND_VS_MAX"], facts["KEY_BUDGET"]), ("NOT_APPLICABLE", "NOT_VERIFIED"))
        self.assertIn("SPEND_UNKNOWN", facts["KEY_BUDGET_CAUSE"])

    def test_healthy_budget_has_no_cause(self):
        facts = r3_collect()
        self.assertEqual((facts["KEY_MAX_BUDGET"], facts["KEY_BUDGET_DURATION"], facts["KEY_SPEND_VS_MAX"],
                          facts["APP_BUDGET_CAP"], facts["KEY_BUDGET_CAUSE"]), ("OK", "CALENDAR_MONTH", "BELOW", "PRESENT", "NONE"))

    def test_cause_is_consistent_with_r1_verdict(self):
        failing = {"MAX_BUDGET_MISSING", "MAX_BUDGET_INVALID", "MAX_BUDGET_NONPOSITIVE", "MAX_BUDGET_ABOVE_APP_CAP",
                   "BUDGET_DURATION_MISSING", "BUDGET_DURATION_BLANK", "APP_BUDGET_CAP_MISSING", "SPEND_AT_OR_ABOVE_MAX"}
        rows = [lab_key_row(**o) for o, _, _ in self.CASES] + [lab_key_row(budget_duration=d) for d in (None, "", "x", "30d")]
        rows += [lab_key_row(spend=s) for s in (None, 0.0, 0.5, 9.0)]
        for row in rows:
            facts = r3_collect(R3Db(row=row))
            causes = set(facts["KEY_BUDGET_CAUSE"].split(","))
            self.assertEqual(facts["KEY_BUDGET"] == "FAIL", bool(causes & failing), (row["max_budget"], row["budget_duration"], row["spend"]))

    def test_budget_table_fallback_is_named(self):
        db = R3Db(row=lab_key_row(max_budget=None, budget_duration=None, budget_id="bud-1"),
                  budgets={"bud-1": {"rpm_limit": None, "tpm_limit": None, "max_budget": 0.5, "budget_duration": "30d"}})
        facts = r3_collect(db)
        self.assertEqual((facts["KEY_LIMIT_SOURCE"], facts["KEY_MAX_BUDGET"], facts["KEY_BUDGET_CAUSE"]), ("BUDGET_TABLE", "OK", "NONE"))


class R3RateDetailTests(unittest.TestCase):
    def test_rpm_and_tpm_are_classified_individually(self):
        for value, detail in ((None, "MISSING"), ("", "MISSING"), ("5", "NON_INTEGER"), (5.5, "NON_INTEGER"),
                              (True, "NON_INTEGER"), (0, "NONPOSITIVE"), (-3, "NONPOSITIVE"), (6, "ABOVE_APP_CAP"), (5, "OK")):
            facts = r3_collect(R3Db(row=lab_key_row(rpm_limit=value)))
            self.assertEqual(facts["KEY_RPM"], detail, value)
            self.assertEqual(facts["KEY_TPM"], "OK", value)
        facts = r3_collect(R3Db(row=lab_key_row(tpm_limit=None)))
        self.assertEqual((facts["KEY_RPM"], facts["KEY_TPM"]), ("OK", "MISSING"))
        facts = r3_collect(caps={"rpm": None, "tpm": 20000, "budget": 1.0})
        self.assertEqual(facts["KEY_RPM"], "APP_CAP_MISSING")

    def test_rate_detail_is_consistent_with_r1_verdict(self):
        for rpm in (None, 0, 5, 6, "5"):
            for tpm in (None, 20000, 20001):
                facts = r3_collect(R3Db(row=lab_key_row(rpm_limit=rpm, tpm_limit=tpm)))
                both_ok = facts["KEY_RPM"] == "OK" and facts["KEY_TPM"] == "OK"
                self.assertEqual(facts["KEY_RATE_LIMITS"] == "PASS", both_ok, (rpm, tpm))

    def test_wildcard_token_is_named_by_keyword(self):
        for models, token in ((["all-proxy-models"], "ALL_PROXY_MODELS"), (["all-team-models"], "ALL_TEAM_MODELS"),
                              (["*"], "STAR"), (["openrouter/*"], "CONTAINS_STAR"), ([ALIAS], "NONE")):
            self.assertEqual(r3_collect(R3Db(row=lab_key_row(models=models)))["KEY_SCOPE_TOKEN"], token, models)


class R3ObjectPermissionTests(unittest.TestCase):
    def facts(self, perm=None, *, link="op-synthetic", columns=LAB_OBJPERM_COLUMNS, rows=None):
        objperms = {link: rows if rows is not None else ([perm] if perm is not None else [])} if link else {}
        return r3_collect(R3Db(row=lab_key_row(object_permission_id=link), objperms=objperms, objperm_columns=columns))

    def test_no_link(self):
        facts = self.facts(link=None)
        self.assertEqual((facts["OBJPERM_ROW"], facts["OBJPERM_EFFECTIVE"]), ("NONE", "NONE"))

    def test_empty_row_is_empty_but_r1_gate_stays_not_verified(self):
        facts = self.facts(empty_objperm())
        self.assertEqual((facts["OBJPERM_ROW"], facts["OBJPERM_EFFECTIVE"]), ("PRESENT", "EMPTY"))
        self.assertEqual(facts["KEY_POLICY_GATE"], "NOT_VERIFIED")      # R1 contract unchanged
        self.assertEqual(facts["KEY_POLICY_GATE_R3"], "NOT_VERIFIED")   # an inert row never promotes
        self.assertIn("OBJECT_PERMISSION_LINKED", facts["KEY_POLICY_GATE_R3_REASONS"].split(","))

    def test_grants_are_counted_by_field(self):
        facts = self.facts(empty_objperm(vector_stores=["a", "b"], mcp_servers=["m"], mcp_tool_permissions={"m": ["t"]},
                                         skills=["s"], mcp_tool_search_enabled=True))
        self.assertEqual(facts["OBJPERM_EFFECTIVE"], "GRANTS_PRESENT")
        self.assertEqual((facts["OBJPERM_VECTOR_STORES_COUNT"], facts["OBJPERM_MCP_SERVERS_COUNT"],
                          facts["OBJPERM_MCP_TOOL_PERMISSIONS_COUNT"], facts["OBJPERM_SKILLS_COUNT"],
                          facts["OBJPERM_MCP_TOOL_SEARCH_ENABLED"]), ("2", "1", "1", "1", "TRUE"))

    def test_blocked_tools_is_a_restriction_not_a_grant(self):
        facts = self.facts(empty_objperm(blocked_tools=["x"]))
        self.assertEqual((facts["OBJPERM_EFFECTIVE"], facts["OBJPERM_BLOCKED_TOOLS_COUNT"]), ("EMPTY", "1"))

    def test_model_grant_with_agent_is_flagged(self):
        db = R3Db(row=lab_key_row(object_permission_id="op-synthetic", agent_id="agent-1"),
                  objperms={"op-synthetic": [empty_objperm(models=["m"])]})
        facts = r3_collect(db)
        self.assertEqual((facts["OBJPERM_MODELS_COUNT"], facts["KEY_AGENT_ID"], facts["OBJPERM_EFFECTIVE"]), ("1", "PRESENT", "GRANTS_PRESENT"))

    def test_unknown_states_are_never_empty(self):
        self.assertEqual(self.facts(rows=[])["OBJPERM_ROW"], "MISSING")
        self.assertEqual(self.facts(rows=[])["OBJPERM_EFFECTIVE"], "UNKNOWN")
        self.assertEqual(self.facts(rows=[empty_objperm(), empty_objperm()])["OBJPERM_ROW"], "MULTIPLE")
        unknown = self.facts(empty_objperm(), columns=LAB_OBJPERM_COLUMNS + ("future_grant",))
        self.assertEqual((unknown["OBJPERM_UNKNOWN_COLUMNS"], unknown["OBJPERM_EFFECTIVE"]), ("1", "UNKNOWN"))
        missing = self.facts(empty_objperm(), columns=tuple(c for c in LAB_OBJPERM_COLUMNS if c != "skills"))
        self.assertEqual((missing["OBJPERM_MISSING_COLUMNS"], missing["OBJPERM_EFFECTIVE"]), ("1", "UNKNOWN"))
        odd = self.facts(empty_objperm(vector_stores="not-a-list"))
        self.assertEqual((odd["OBJPERM_UNRECOGNIZED_VALUES"], odd["OBJPERM_EFFECTIVE"]), ("1", "UNKNOWN"))

    def test_unknown_columns_are_never_selected(self):
        db = R3Db(row=lab_key_row(object_permission_id="op-synthetic"), objperms={"op-synthetic": [empty_objperm()]},
                  objperm_columns=LAB_OBJPERM_COLUMNS + ("future_grant",))
        r3_collect(db)
        sql = next(s for s in db.statements if '"LiteLLM_ObjectPermissionTable"' in s and "information_schema" not in s)
        self.assertNotIn("future_grant", sql)
        self.assertNotIn("*", sql.split("FROM")[0])


class R3ExtraMechanismAndSchemaTests(unittest.TestCase):
    def test_extra_indirection_and_limits(self):
        facts = r3_collect(R3Db(row=lab_key_row(user_id="u1", organization_id="o1", permissions={"x": 1},
                                                budget_fallbacks={"m": ["n"]}, tpd_limit=100, model_max_budget={"m": 1})))
        self.assertEqual(facts["KEY_EXTRA_INDIRECTION"], "BUDGET_FALLBACKS,ORGANIZATION,PERMISSIONS,USER")
        self.assertEqual(facts["KEY_EXTRA_LIMITS"], "MODEL_MAX_BUDGET,TPD_LIMIT")
        self.assertEqual(facts["KEY_POLICY_GATE"], "PASS")              # R1 does not see these
        self.assertEqual(facts["KEY_POLICY_GATE_R3"], "NOT_VERIFIED")
        self.assertIn("EXTRA_INDIRECTION", facts["KEY_POLICY_GATE_R3_REASONS"])

    def test_unrecognized_extra_shape_is_reported(self):
        facts = r3_collect(R3Db(row=lab_key_row(config="not-json-mapping")))
        self.assertIn("CONFIG_UNRECOGNIZED", facts["KEY_EXTRA_INDIRECTION"])

    def test_clean_lab_key_passes_r3(self):
        facts = r3_collect()
        self.assertEqual((facts["KEY_EXTRA_INDIRECTION"], facts["KEY_EXTRA_LIMITS"], facts["KEY_AGENT_ID"],
                          facts["KEY_TYPE"], facts["KEY_SCHEMA_COMPAT"], facts["LITELLM_VERSION_CLASS"]),
                         ("NONE", "NONE", "NONE", "DEFAULT", "LAB_EXACT", "LAB_REHEARSED"))
        self.assertEqual((facts["KEY_POLICY_GATE"], facts["KEY_POLICY_GATE_R3"], facts["KEY_POLICY_GATE_R3_REASONS"]),
                         ("PASS", "PASS", "NONE"))

    def test_schema_drift_blocks_r3_pass(self):
        facts = r3_collect(R3Db(key_columns=LAB_KEY_COLUMNS + ("future_bypass",)))
        self.assertEqual((facts["KEY_SCHEMA_UNKNOWN_COLUMNS"], facts["KEY_SCHEMA_COMPAT"]), ("1", "UNKNOWN_COLUMNS"))
        self.assertEqual(facts["KEY_POLICY_GATE_R3"], "NOT_VERIFIED")
        older = r3_collect(R3Db(key_columns=tuple(c for c in LAB_KEY_COLUMNS if c not in ("agent_id", "policies"))))
        self.assertEqual((older["KEY_SCHEMA_MISSING_KNOWN"], older["KEY_SCHEMA_COMPAT"], older["KEY_AGENT_ID"]),
                         ("2", "MISSING_COLUMNS", "COLUMN_ABSENT"))
        self.assertEqual(older["KEY_POLICY_GATE_R3"], "NOT_VERIFIED")

    def test_unknown_column_values_are_never_read(self):
        db = R3Db(key_columns=LAB_KEY_COLUMNS + ("future_bypass",))
        r3_collect(db)
        sql = next(s for s in db.statements if "LiteLLM_VerificationToken" in s and "information_schema" not in s)
        self.assertNotIn("future_bypass", sql)
        self.assertNotIn("key_name", sql)     # contains a key fragment: never selected
        self.assertNotIn("metadata", sql)

    def test_version_classes(self):
        # Literal expectations, never derived from audit.LAB_REHEARSED_VERSIONS (S5-R3 version admission).
        for version, value, cls in ((LAB_VERSION, "1_109_1", "LAB_REHEARSED"), ("1.110.0", "1_110_0", "LAB_REHEARSED"),
                                    ("1.110.1", "1_110_1", "NOT_REHEARSED"), ("1.108.9", "1_108_9", "NOT_REHEARSED"),
                                    ("2.0.0", "2_0_0", "NOT_REHEARSED"), ("1.110", "UNRECOGNIZED", "UNKNOWN"),
                                    (None, "UNKNOWN", "UNKNOWN"), ("1.109.1-dev; rm -rf", "UNRECOGNIZED", "UNKNOWN")):
            facts = r3_collect(version=version)
            self.assertEqual((facts["LITELLM_VERSION"], facts["LITELLM_VERSION_CLASS"]), (value, cls), version)
            self.assertEqual(facts["KEY_POLICY_GATE_R3"] == "PASS", cls == "LAB_REHEARSED", version)

    def test_r3_gate_never_promotes_r1(self):
        for row in (lab_key_row(models=["all-proxy-models"]), lab_key_row(rpm_limit=None), lab_key_row(team_id="t"),
                    lab_key_row(spend=None)):
            facts = r3_collect(R3Db(row=row))
            if facts["KEY_POLICY_GATE"] != "PASS":
                self.assertEqual(facts["KEY_POLICY_GATE_R3"], facts["KEY_POLICY_GATE"])

    def test_every_r3_value_is_render_safe(self):
        facts = r3_collect(R3Db(row=lab_key_row(object_permission_id="op-synthetic", user_id="u", models=["*"]),
                                objperms={"op-synthetic": [empty_objperm(vector_stores=["v"])]}), version="9.9.9")
        audit.render(facts, container_identity="UNCHANGED")
        text = json.dumps(facts)
        for secret in ("op-synthetic", KEY, token_hash(KEY), "sk-...0000", '"u"'):
            self.assertNotIn(secret, text)


class R3PrivatePrestateTests(unittest.TestCase):
    """Opt-in, never published: a redacted allowlist of policy fields, bound to the audited key."""

    def sink(self, db=None):
        sink = {}
        facts = r3_collect(db or R3Db(row=lab_key_row(object_permission_id="op-synthetic", budget_id="bud-1",
                                                      config={"api_key": "sk-provider-secret"}, metadata={"note": "x"}),
                                      objperms={"op-synthetic": [empty_objperm(vector_stores=["vs"])]},
                                      budgets={"bud-1": {"rpm_limit": 1, "tpm_limit": 2, "max_budget": 0.5, "budget_duration": "30d"}}),
                           sink=sink)
        return facts, sink

    def test_prestate_is_bound_and_redacted(self):
        facts, sink = self.sink()
        document = sink["PRIVATE_PRESTATE"]
        self.assertEqual(document["binding"]["fingerprint"], audit.fingerprint_token_hash(token_hash(KEY)))
        self.assertEqual(document["binding"]["key_match"], "ONE")
        self.assertEqual(document["binding"]["litellm_version"], LAB_VERSION)
        self.assertEqual(document["key"]["models"], [ALIAS])
        self.assertEqual(document["object_permission"]["vector_stores"], ["vs"])
        self.assertEqual(document["budget"]["max_budget"], 0.5)
        text = json.dumps(document)
        for forbidden in (token_hash(KEY), KEY, "sk-provider-secret", "sk-...0000", '"note"'):
            self.assertNotIn(forbidden, text)
        self.assertNotIn("token", document["key"])
        self.assertEqual(set(document["key"]) - set(audit.PRESTATE_KEY_FIELDS), set())

    def test_secret_like_values_are_redacted_even_in_allowed_fields(self):
        _, sink = self.sink(R3Db(row=lab_key_row(key_alias="sk-looks-like-a-key", team_id="https://user:pw@host/x")))
        key = sink["PRIVATE_PRESTATE"]["key"]
        self.assertEqual((key["key_alias"], key["team_id"]), ("REDACTED", "REDACTED"))

    def test_no_prestate_without_exactly_one_key(self):
        sink = {}
        db = R3Db()
        db.tokens = []
        r3_collect(db, sink=sink)
        self.assertNotIn("PRIVATE_PRESTATE", sink)

    def test_facts_never_contain_the_prestate(self):
        facts, _ = self.sink()
        self.assertNotIn("PRIVATE_PRESTATE", facts)
        audit.render(facts, container_identity="UNCHANGED")


class R3PrestateFileTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        import os
        os.chmod(self.dir, 0o700)

    def tearDown(self):
        self.tmp.cleanup()

    def test_path_validation(self):
        import os
        ok = os.path.join(self.dir, "prestate.json")
        self.assertIsNone(audit.validate_prestate_path(ok, euid=os.geteuid()))
        self.assertEqual(audit.validate_prestate_path("relative.json", euid=os.geteuid()), "NOT_ABSOLUTE")
        self.assertEqual(audit.validate_prestate_path(os.path.join(self.dir, "no", "x.json"), euid=os.geteuid()), "PARENT_INVALID")
        open(ok, "w").close()
        self.assertEqual(audit.validate_prestate_path(ok, euid=os.geteuid()), "EXISTS")
        os.unlink(ok)
        os.chmod(self.dir, 0o755)
        self.assertEqual(audit.validate_prestate_path(ok, euid=os.geteuid()), "PARENT_NOT_PRIVATE")
        os.chmod(self.dir, 0o700)
        self.assertEqual(audit.validate_prestate_path(ok, euid=os.geteuid() + 1), "PARENT_NOT_OWNED")
        link = os.path.join(self.dir, "link")
        os.symlink(self.dir, link)
        self.assertEqual(audit.validate_prestate_path(os.path.join(link, "x.json"), euid=os.geteuid()), "PARENT_INVALID")

    def test_write_is_exclusive_private_and_hashed(self):
        import os, stat
        path = os.path.join(self.dir, "prestate.json")
        digest = audit.write_private_prestate(path, {"a": 1})
        mode = stat.S_IMODE(os.stat(path).st_mode)
        self.assertEqual(mode, 0o600)
        with open(path, "rb") as handle:
            self.assertEqual(hashlib.sha256(handle.read()).hexdigest(), digest)
        with self.assertRaises(audit.ProbeError):
            audit.write_private_prestate(path, {"a": 2})   # never overwrites
        target = os.path.join(self.dir, "target")
        os.symlink(target, os.path.join(self.dir, "dangling.json"))
        with self.assertRaises(audit.ProbeError):
            audit.write_private_prestate(os.path.join(self.dir, "dangling.json"), {"a": 3})
        self.assertFalse(os.path.exists(target))


class R3HostPrestateTests(HostOrchestrationTests):
    def setUp(self):
        import tempfile, os
        self.tmp = tempfile.TemporaryDirectory()
        os.chmod(self.tmp.name, 0o700)
        self.path = os.path.join(self.tmp.name, "prestate.json")

    def tearDown(self):
        self.tmp.cleanup()

    def host_with(self, probe_lines, argv_extra):
        run, calls = self.fake_docker()

        def wrapped(argv, stdin=None):
            if argv[:3] == ["docker", "exec", "-i"]:
                calls.append((argv, stdin))
                return "\n".join(probe_lines) + "\n"
            return run(argv, stdin)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(["--litellm-container", "litellm", *argv_extra], run=wrapped, euid=0,
                              prestate_owner=__import__("os").geteuid())
        return code, out.getvalue().splitlines(), calls

    def test_prestate_written_privately_and_only_its_hash_printed(self):
        import os
        facts = {"KEY_MATCH": "ONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"}
        prestate = {"PRIVATE_PRESTATE": {"binding": {"fingerprint": "f" * 64}, "key": {"models": [ALIAS]}}}
        code, lines, calls = self.host_with([json.dumps(prestate), json.dumps(facts)], ["--private-prestate", self.path])
        self.assertEqual(code, 0, lines)
        self.assertTrue(os.path.exists(self.path))
        self.assertTrue(any(line.startswith("S5R3_PRIVATE_PRESTATE_SHA256=") for line in lines))
        self.assertIn("S5R3_PRIVATE_PRESTATE=WRITTEN", lines)
        self.assertNotIn(ALIAS, "\n".join(lines))
        probe_stdin = next(stdin for argv, stdin in calls if argv[:3] == ["docker", "exec", "-i"])
        self.assertTrue(json.loads(probe_stdin.splitlines()[0])["private_prestate"])
        with open(self.path, encoding="utf-8") as handle:
            stored = json.load(handle)
        self.assertEqual(stored["binding"]["litellm_container"], "litellm")

    def test_bad_path_refused_before_any_docker_call(self):
        calls = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(["--litellm-container", "litellm", "--private-prestate", "relative.json"],
                              run=lambda argv, stdin=None: calls.append(argv) or "", euid=0)
        self.assertEqual(code, 2)
        self.assertIn("S5R3_PRIVATE_PRESTATE=HOLD_NOT_ABSOLUTE", out.getvalue())
        self.assertEqual(calls, [])

    def test_unrequested_prestate_from_probe_is_refused(self):
        facts = {"KEY_MATCH": "ONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"}
        code, lines, _ = self.host_with([json.dumps({"PRIVATE_PRESTATE": {}}), json.dumps(facts)], [])
        self.assertEqual(code, 2)
        self.assertIn("S5R1_AUDIT=HOLD_PROBE_OUTPUT_UNSAFE", lines)

    def test_requested_but_missing_prestate_is_a_hold(self):
        import os
        facts = {"KEY_MATCH": "NONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"}
        code, lines, _ = self.host_with([json.dumps(facts)], ["--private-prestate", self.path])
        self.assertEqual(code, 2)
        self.assertIn("S5R3_PRIVATE_PRESTATE=NOT_WRITTEN", lines)
        self.assertFalse(os.path.exists(self.path))


# ==================================================================================================
# S5-R3 version admission (1.110.0) and JWT detection. Expectations are literal and independent of the
# auditor's own allowlist; the allowlist itself is pinned so any change to it is a visible test change.
# ==================================================================================================
ADMITTED = "1.110.0"


class R3VersionAdmissionTests(unittest.TestCase):
    def test_rehearsed_set_is_exactly_the_two_lab_proven_versions(self):
        self.assertEqual(audit.LAB_REHEARSED_VERSIONS, frozenset({"1.109.1", "1.110.0"}))

    def test_both_rehearsed_versions_pass_a_clean_key(self):
        for version in ("1.109.1", "1.110.0"):
            facts = r3_collect(version=version)
            self.assertEqual((facts["KEY_POLICY_GATE"], facts["KEY_POLICY_GATE_R3"], facts["KEY_POLICY_GATE_R3_REASONS"]),
                             ("PASS", "PASS", "NONE"), version)

    def test_unrehearsed_versions_stay_not_verified(self):
        for version in ("1.110.1", "1.109.0", "1.111.0", "0.0.0", None, "x"):
            facts = r3_collect(version=version)
            self.assertEqual(facts["KEY_POLICY_GATE_R3"], "NOT_VERIFIED", version)
            self.assertIn("VERSION_NOT_REHEARSED", facts["KEY_POLICY_GATE_R3_REASONS"], version)

    def test_admitted_version_never_promotes_r1(self):
        cases = ((lab_key_row(models=["all-proxy-models"]), "FAIL"), (lab_key_row(rpm_limit=None), "FAIL"),
                 (lab_key_row(max_budget=None), "FAIL"), (lab_key_row(team_id="t"), "NOT_VERIFIED"),
                 (lab_key_row(spend=None), "NOT_VERIFIED"), (lab_key_row(access_group_ids=["g"]), "NOT_VERIFIED"))
        for row, r1 in cases:
            facts = r3_collect(R3Db(row=row), version=ADMITTED)
            self.assertEqual((facts["KEY_POLICY_GATE"], facts["KEY_POLICY_GATE_R3"]), (r1, r1))

    def test_admitted_version_keeps_object_permission_not_verified(self):
        facts = r3_collect(R3Db(row=lab_key_row(object_permission_id="op-synthetic"),
                                objperms={"op-synthetic": [empty_objperm()]}), version=ADMITTED)
        self.assertEqual((facts["OBJPERM_EFFECTIVE"], facts["KEY_POLICY_GATE"], facts["KEY_POLICY_GATE_R3"]),
                         ("EMPTY", "NOT_VERIFIED", "NOT_VERIFIED"))
        self.assertEqual(facts["KEY_POLICY_GATE_R3_REASONS"], "OBJECT_PERMISSION_LINKED")

    def test_admitted_version_keeps_unknown_schema_and_extra_indirection_not_verified(self):
        facts = r3_collect(R3Db(key_columns=LAB_KEY_COLUMNS + ("future_bypass",)), version=ADMITTED)
        self.assertEqual((facts["KEY_POLICY_GATE_R3"], facts["KEY_POLICY_GATE_R3_REASONS"]), ("NOT_VERIFIED", "SCHEMA_NOT_LAB_EXACT"))
        facts = r3_collect(R3Db(row=lab_key_row(user_id="u")), version=ADMITTED)
        self.assertEqual((facts["KEY_POLICY_GATE_R3"], facts["KEY_POLICY_GATE_R3_REASONS"]), ("NOT_VERIFIED", "EXTRA_INDIRECTION"))


def jwt_collect(general_settings_db=None, yaml_general=None, yaml_status="LOADED", version=ADMITTED):
    config = {} if general_settings_db is None else {"general_settings": general_settings_db}
    yaml_config = {} if yaml_general is None else {"general_settings": yaml_general}
    return audit.collect(R3Db(config=config), fingerprint=audit.fingerprint_token_hash(token_hash(KEY)), alias=ALIAS,
                         caps=CAPS, allowed_callbacks=frozenset(), now=NOW, yaml_config=yaml_config, version=version,
                         yaml_status=yaml_status,
                         cost_map={"openrouter/vendor/model:free": {"input_cost_per_token": 0, "output_cost_per_token": 0}})


class R3JwtDetectionTests(unittest.TestCase):
    """1.110.0 lets a JWT identity link to any unexpired, unblocked key of the same user (LINK_ONLY /
    map-existing). That only exists with general_settings.enable_jwt_auth; detect it, never assume it off."""

    def test_disabled_when_absent_or_false(self):
        for db, yaml_general in ((None, None), ({"enable_jwt_auth": False}, None), (None, {"enable_jwt_auth": False}), ({}, {})):
            facts = jwt_collect(db, yaml_general)
            self.assertEqual((facts["JWT_AUTH"], facts["KEY_POLICY_GATE_R3"]), ("DISABLED", "PASS"), (db, yaml_general))

    def test_enabled_in_db_or_yaml_blocks_r3(self):
        for db, yaml_general in (({"enable_jwt_auth": True}, None), (None, {"enable_jwt_auth": True})):
            facts = jwt_collect(db, yaml_general)
            self.assertEqual((facts["JWT_AUTH"], facts["KEY_POLICY_GATE"], facts["KEY_POLICY_GATE_R3"]), ("ENABLED", "PASS", "NOT_VERIFIED"))
            self.assertIn("JWT_AUTH_NOT_DISABLED", facts["KEY_POLICY_GATE_R3_REASONS"])

    def test_unrecognized_or_unread_is_never_disabled(self):
        for db, yaml_general, status in (({"enable_jwt_auth": "true"}, None, "LOADED"), ("not-a-mapping", None, "LOADED"),
                                         (None, None, "UNREADABLE"), (None, None, "NOT_FOUND")):
            facts = jwt_collect(db, yaml_general, yaml_status=status)
            self.assertIn(facts["JWT_AUTH"], ("UNRECOGNIZED", "UNKNOWN"), (db, status))
            self.assertEqual(facts["KEY_POLICY_GATE_R3"], "NOT_VERIFIED", (db, status))

    def test_jwt_value_is_render_safe(self):
        audit.render(jwt_collect({"enable_jwt_auth": True}), container_identity="UNCHANGED")


# ==================================================================================================
# S5-R3A — PM-R3-01 exact container binding and PM-R3-02 effective flags OFF.
# ==================================================================================================
import os as _os
import sys as _sys
from unittest import mock

_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
SUMMARY_ID = "a" * 64
LITELLM_ID = "b" * 64
SUMMARY_IMAGE = "sha256:6cee8366be056e84893b32dd6708248d983f1d3a939261af6cfe27db8572adc3"
LITELLM_IMAGE = "sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"
OFF_ENV = ["NEWSFLUX_AI_INFERENCE_ENABLED=false", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false", "OTHER=x"]
PROBE_OK = {"KEY_MATCH": "ONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"}


def identity(cid, image, started="2026-11-19T23:30:00Z", restarts=0, status="running", project="newsflux", service="summary-api"):
    return "|".join((cid, image, started, str(restarts), status, project, service))


class World:
    """A fake Docker host for the strict path: two containers, mutable between calls."""

    def __init__(self):
        self.containers = {
            SUMMARY_ID: {"image": SUMMARY_IMAGE, "started": "2026-11-19T23:30:00Z", "restarts": 0, "status": "running",
                         "project": "newsflux", "service": "summary-api", "env": list(OFF_ENV)},
            LITELLM_ID: {"image": LITELLM_IMAGE, "started": "2026-11-01T00:00:00Z", "restarts": 0, "status": "running",
                         "project": "litellm", "service": "litellm", "env": []},
        }
        self.runtime_flags = {"inference": False, "external_transfer": False}
        self.calls = []
        self.hooks = {}  # call index -> callable(world)

    def snapshot(self, cid):
        c = self.containers[cid]
        return identity(cid, c["image"], c["started"], c["restarts"], c["status"], c["project"], c["service"])

    def __call__(self, argv, stdin=None):
        index = len(self.calls)
        self.calls.append((argv, stdin))
        hook = self.hooks.get(index)
        if hook:
            hook(self)
        target = argv[-1]
        if argv[:2] == ["docker", "inspect"]:
            fmt = argv[argv.index("--format") + 1]
            if target not in self.containers:
                raise audit.ProbeError("DOCKER_INSPECT_FAILED")
            if fmt == audit.IDENTITY_FORMAT:
                return self.snapshot(target) + "\n"
            if fmt == "{{json .Config.Env}}":
                return json.dumps(self.containers[target]["env"])
            raise AssertionError(argv)
        if argv[:3] == ["docker", "exec", "-u"]:
            if argv[4] not in self.containers:
                raise audit.ProbeError("DOCKER_EXEC_FAILED")
            return json.dumps({"fingerprint": "f" * 64, "alias": ALIAS, "caps": CAPS, "allowed_callbacks": [],
                               "runtime_flags": self.runtime_flags})
        if argv[:3] == ["docker", "exec", "-i"]:
            if argv[3] not in self.containers:
                raise audit.ProbeError("DOCKER_EXEC_FAILED")
            return json.dumps(PROBE_OK)
        raise AssertionError(argv)  # strict mode never lists containers (no discovery)


def strict_argv(world, **overrides):
    values = {"--litellm-container": LITELLM_ID, "--summary-container": SUMMARY_ID, "--project": "newsflux",
              "--summary-service": "summary-api", "--expect-summary-image": SUMMARY_IMAGE,
              "--expect-litellm-image": LITELLM_IMAGE, "--expect-summary-snapshot": world.snapshot(SUMMARY_ID),
              "--expect-litellm-snapshot": world.snapshot(LITELLM_ID)}
    values.update(overrides)
    return [part for key, value in values.items() if value is not None for part in (key, value)]


def run_strict(world, argv=None, env=None):
    out = io.StringIO()
    clean = {k: v for k, v in _os.environ.items() if k not in ("NEWSFLUX_PROJECT", "NEWSFLUX_SUMMARY_SERVICE")}
    clean.update(env or {})
    with mock.patch.dict(_os.environ, clean, clear=True), contextlib.redirect_stdout(out):
        code = audit.main(argv if argv is not None else strict_argv(world), run=world, euid=0)
    return code, out.getvalue().splitlines()


def execs(world):
    return [argv for argv, _ in world.calls if argv[:2] == ["docker", "exec"]]


class R3AExactBindingTests(unittest.TestCase):
    def test_unchanged_identity_completes_with_exact_ids_and_no_discovery(self):
        world = World()
        code, lines = run_strict(world)
        self.assertEqual(code, 0, lines)
        for expected in ("S5R1_SUMMARY_BINDING=EXACT_ID_IMAGE_LABELS_LIFECYCLE", "S5R1_LITELLM_BINDING=EXACT_ID_IMAGE_LIFECYCLE",
                         "S5R1_CONTAINER_IDENTITY=UNCHANGED", "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY"):
            self.assertIn(expected, lines)
        self.assertFalse([argv for argv, _ in world.calls if argv[:2] == ["docker", "ps"]])
        self.assertEqual([argv[4] if argv[2] == "-u" else argv[3] for argv in execs(world)], [SUMMARY_ID, LITELLM_ID])

    def test_strict_mode_requires_every_binding_argument(self):
        world = World()
        for missing in ("--expect-summary-snapshot", "--expect-litellm-snapshot", "--expect-summary-image",
                        "--expect-litellm-image", "--project", "--summary-service"):
            code, lines = run_strict(world, strict_argv(world, **{missing: None}))
            self.assertEqual((code, lines), (2, ["S5R1_AUDIT=HOLD_STRICT_BINDING_INCOMPLETE"]), missing)
        code, lines = run_strict(world, strict_argv(world, **{"--litellm-container": "litellm"}))
        self.assertEqual(lines, ["S5R1_AUDIT=HOLD_STRICT_BINDING_INCOMPLETE"])
        self.assertEqual(world.calls, [])

    def test_divergent_environment_holds_before_any_docker_call(self):
        for env in ({"NEWSFLUX_PROJECT": "other"}, {"NEWSFLUX_SUMMARY_SERVICE": "summary-api-2"}):
            world = World()
            code, lines = run_strict(world, env=env)
            self.assertEqual((code, lines), (2, ["S5R1_AUDIT=HOLD_ENV_DIVERGENT"]), env)
            self.assertEqual(world.calls, [])
        world = World()
        code, _ = run_strict(world, env={"NEWSFLUX_PROJECT": "newsflux", "NEWSFLUX_SUMMARY_SERVICE": "summary-api"})
        self.assertEqual(code, 0)  # the same values are not a divergence

    def test_wrong_summary_or_litellm_holds_before_any_exec(self):
        cases = (
            (lambda w: w.containers[SUMMARY_ID].update(project="other"), "IDENTITY_MISMATCH_SUMMARY"),
            (lambda w: w.containers[SUMMARY_ID].update(service="reader"), "IDENTITY_MISMATCH_SUMMARY"),
            (lambda w: w.containers[SUMMARY_ID].update(image="sha256:" + "1" * 64), "IDENTITY_MISMATCH_SUMMARY"),
            (lambda w: w.containers[SUMMARY_ID].update(status="exited"), "IDENTITY_MISMATCH_SUMMARY"),
            (lambda w: w.containers[LITELLM_ID].update(image="sha256:" + "2" * 64), "IDENTITY_MISMATCH_LITELLM"),
            (lambda w: w.containers[LITELLM_ID].update(restarts=1), "IDENTITY_MISMATCH_LITELLM"),
        )
        for mutate, reason in cases:
            world = World()
            argv = strict_argv(world)          # expected identities captured by the wrapper's gates
            mutate(world)                      # ...then the host changed before the auditor started
            code, lines = run_strict(world, argv)
            self.assertEqual((code, lines), (2, [f"S5R1_AUDIT=HOLD_{reason}"]), reason)
            self.assertEqual(execs(world), [], reason)

    def test_expected_image_must_match_the_snapshot_image(self):
        world = World()
        code, lines = run_strict(world, strict_argv(world, **{"--expect-summary-image": "sha256:" + "3" * 64}))
        self.assertEqual(lines, ["S5R1_AUDIT=HOLD_IDENTITY_MISMATCH_SUMMARY"])

    def test_missing_or_replaced_container_holds(self):
        world = World()
        argv = strict_argv(world)
        world.containers["c" * 64] = world.containers.pop(SUMMARY_ID)   # replaced by a new container ID
        code, lines = run_strict(world, argv)
        self.assertEqual(code, 2)
        self.assertEqual(execs(world), [])

    def test_restart_between_identity_gate_and_first_exec_holds(self):
        world = World()
        argv = strict_argv(world)
        # calls: 0 identity S, 1 identity L, 2 env, 3 pre-exec identity S ... restart lands right before 3
        world.hooks[3] = lambda w: w.containers[SUMMARY_ID].update(restarts=1, started="2026-11-20T00:00:00Z")
        code, lines = run_strict(world, argv)
        self.assertEqual((code, lines), (2, ["S5R1_AUDIT=HOLD_IDENTITY_CHANGED_BEFORE_EXEC"]))
        self.assertEqual(execs(world), [])

    def test_replacement_between_pre_exec_check_and_exec_holds(self):
        world = World()
        argv = strict_argv(world)
        world.hooks[5] = lambda w: w.containers.pop(SUMMARY_ID)       # gone when the first exec runs
        code, lines = run_strict(world, argv)
        self.assertEqual((code, lines), (2, ["S5R1_AUDIT=HOLD_DOCKER_EXEC_FAILED"]))

    def test_restart_during_the_audit_is_changed_and_exit_3(self):
        world = World()
        argv = strict_argv(world)
        world.hooks[7] = lambda w: w.containers[LITELLM_ID].update(restarts=1)   # after both execs
        code, lines = run_strict(world, argv)
        self.assertEqual(code, 3, lines)
        self.assertIn("S5R1_CONTAINER_IDENTITY=CHANGED", lines)
        self.assertEqual(lines[-1], "S5R1_AUDIT=HOLD_CONTAINER_STATE_CHANGED")
        self.assertNotIn("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", lines)

    def test_legacy_mode_is_reported_as_discovered(self):
        run, _ = self.fake_legacy()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(["--litellm-container", "litellm"], run=run, euid=0)
        self.assertEqual(code, 0)
        self.assertIn("S5R1_SUMMARY_BINDING=DISCOVERED_BY_LABELS", out.getvalue().splitlines())

    def fake_legacy(self):
        return HostOrchestrationTests.fake_docker(self)


def _runtime_parsers():
    """The full runtime (needs the Summary's dependencies); absent on a bare CI Python -> explicit skip."""
    if _REPO not in _sys.path:
        _sys.path.insert(0, _REPO)
    try:
        from services.article_intel_summary import litellm_adapter
    except ImportError as error:  # e.g. fastapi/httpx not installed on the runner
        raise unittest.SkipTest(f"Summary runtime dependencies unavailable: {error.name}") from None
    return litellm_adapter


def _function_source(relative, name):
    """Exact source of one top-level function of the Summary package, read statically (no imports)."""
    import ast
    path = _os.path.join(_REPO, "services", "article_intel_summary", relative)
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(text, node)
    raise AssertionError(f"{name} not found in {relative}")


def _static_read_bool(relative):
    namespace = {"Mapping": dict}
    exec(compile(_function_source(relative, "_read_bool"), relative, "exec"), namespace)  # noqa: S102 - repo source
    return namespace["_read_bool"]


FLAG_TABLE = (  # literal expectations, derived from the runtime parser semantics at 12929fb
    ("true", "ON"), ("TRUE", "ON"), (" True ", "ON"), ("\ttrue\n", "ON"),
    ("false", "OFF_EXPLICIT"), ("FALSE", "OFF_EXPLICIT"), (" False ", "OFF_EXPLICIT"),
    ("1", "AMBIGUOUS"), ("0", "AMBIGUOUS"), ("yes", "AMBIGUOUS"), ("no", "AMBIGUOUS"), ("on", "AMBIGUOUS"),
    ("off", "AMBIGUOUS"), ("", "AMBIGUOUS"), ("enabled", "AMBIGUOUS"), ("tru", "AMBIGUOUS"), ("falsey", "AMBIGUOUS"),
)


class R3AEffectiveFlagTests(unittest.TestCase):
    NAME = "NEWSFLUX_AI_INFERENCE_ENABLED"

    def test_literal_table(self):
        for value, expected in FLAG_TABLE:
            self.assertEqual(audit.classify_flag([f"{self.NAME}={value}"], self.NAME), expected, repr(value))
        self.assertEqual(audit.classify_flag(["OTHER=1"], self.NAME), "OFF_DEFAULT_RUNTIME")
        self.assertEqual(audit.classify_flag([f"{self.NAME}=false", f"{self.NAME}=false"], self.NAME), "DUPLICATE")
        self.assertEqual(audit.classify_flag([f"{self.NAME}=false", f"{self.NAME}=true"], self.NAME), "DUPLICATE")
        self.assertEqual(audit.classify_flag([self.NAME], self.NAME), "AMBIGUOUS")
        self.assertEqual(audit.classify_flag(["X=1", 7, None], self.NAME), "OFF_DEFAULT_RUNTIME")

    def test_classification_never_admits_what_any_runtime_parser_turns_on(self):
        adapter = _runtime_parsers()
        values = [v for v, _ in FLAG_TABLE] + [" TRUE", "true ", "TrUe", "true", "faLse\t", "NULL", "none"]
        for value in values:
            runtime_on = adapter._read_bool({self.NAME: value}, self.NAME)   # litellm_adapter / catalog
            admin_on = value.lower() == "true"                                # admin_settings / operator preflight
            cls = audit.classify_flag([f"{self.NAME}={value}"], self.NAME)
            if runtime_on or admin_on:
                self.assertEqual(cls, "ON", repr(value))
            else:
                self.assertIn(cls, ("OFF_EXPLICIT", "AMBIGUOUS"), repr(value))
            if cls == "OFF_EXPLICIT":
                self.assertFalse(runtime_on or admin_on, repr(value))

    def test_static_parsers_of_this_revision_never_admit_on(self):
        """Runs without the Summary dependencies: the real _read_bool bodies, executed in isolation."""
        parsers = [_static_read_bool("litellm_adapter.py")]
        catalog_source = open(_os.path.join(_REPO, "services", "article_intel_summary", "catalog.py"), encoding="utf-8").read()
        self.assertNotIn("def _read_bool", catalog_source)        # catalog reuses the adapter's parser
        self.assertRegex(catalog_source, r"from services\.article_intel_summary\.litellm_adapter import \([^)]*\b_read_bool\b")
        values = [v for v, _ in FLAG_TABLE] + [" TRUE", "true ", "TrUe", "faLse\t", "NULL", "none"]
        for value in values:
            on = any(parse({self.NAME: value}, self.NAME) for parse in parsers) or value.lower() == "true"
            cls = audit.classify_flag([f"{self.NAME}={value}"], self.NAME)
            self.assertEqual(cls == "ON", on, repr(value))
        self.assertFalse(any(parse({}, self.NAME) for parse in parsers))          # absent -> OFF
        admin = open(_os.path.join(_REPO, "services", "article_intel_summary", "admin_settings.py"), encoding="utf-8").read()
        self.assertIn('self.env.get("NEWSFLUX_AI_INFERENCE_ENABLED", "").lower() == "true"', admin)
        gateway = _function_source("litellm_adapter.py", "load_gateway_settings")
        self.assertIn('enabled=_read_bool(values, "NEWSFLUX_AI_INFERENCE_ENABLED")', gateway)
        self.assertIn('external_transfer_authorized=_read_bool(values, "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER")', gateway)
        effective = _function_source("admin_settings.py", "effective_values")
        for name in audit.FLAGS_THAT_MUST_BE_OFF:   # managed settings never override the two flags
            self.assertNotIn(name, effective)

    def test_default_off_is_proven_at_this_revision(self):
        adapter = _runtime_parsers()
        settings = adapter.load_gateway_settings({}, read_key=False)
        self.assertFalse(settings.enabled)
        self.assertFalse(settings.external_transfer_authorized)
        import inspect
        from services.article_intel_summary import admin_settings
        source = inspect.getsource(admin_settings.ManagedSettingsStore.effective_values)
        for name in audit.FLAGS_THAT_MUST_BE_OFF:  # managed settings never override the two flags
            self.assertNotIn(name, source)

    def host_flags(self, env, runtime=None):
        world = World()
        world.containers[SUMMARY_ID]["env"] = env
        if runtime is not None:
            world.runtime_flags = runtime
        code, lines = run_strict(world)
        return code, lines, world

    def test_host_admits_only_effective_off(self):
        for env, expected in ((OFF_ENV, ("OFF_EXPLICIT", "OFF_EXPLICIT")), (["OTHER=x"], ("OFF_DEFAULT_RUNTIME", "OFF_DEFAULT_RUNTIME")),
                              (["NEWSFLUX_AI_INFERENCE_ENABLED= FALSE "], ("OFF_EXPLICIT", "OFF_DEFAULT_RUNTIME"))):
            code, lines, _ = self.host_flags(env)
            self.assertEqual(code, 0, (env, lines))
            self.assertIn(f"S5R1_INFERENCE_EFFECTIVE={expected[0]}", lines)
            self.assertIn(f"S5R1_EXTERNAL_TRANSFER_EFFECTIVE={expected[1]}", lines)
            self.assertIn("S5R1_FLAGS_RUNTIME_PARSER=CONFIRMED_OFF", lines)

    def test_host_holds_on_any_unclear_flag_before_any_exec(self):
        cases = ((["NEWSFLUX_AI_INFERENCE_ENABLED=True"], "AI_FLAGS_NOT_OFF"),
                 (["NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER= true"], "AI_FLAGS_NOT_OFF"),
                 (["NEWSFLUX_AI_INFERENCE_ENABLED=1"], "AI_FLAGS_AMBIGUOUS"),
                 (["NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=yes"], "AI_FLAGS_AMBIGUOUS"),
                 (["NEWSFLUX_AI_INFERENCE_ENABLED=on"], "AI_FLAGS_AMBIGUOUS"),
                 (["NEWSFLUX_AI_INFERENCE_ENABLED="], "AI_FLAGS_AMBIGUOUS"),
                 (["NEWSFLUX_AI_INFERENCE_ENABLED=false", "NEWSFLUX_AI_INFERENCE_ENABLED=false"], "AI_FLAGS_DUPLICATE"))
        for env, reason in cases:
            code, lines, world = self.host_flags(env)
            self.assertEqual((code, lines), (2, [f"S5R1_AUDIT=HOLD_{reason}"]), env)
            self.assertEqual(execs(world), [], env)

    def test_runtime_parser_must_confirm_off_before_the_litellm_exec(self):
        for runtime, reason in (({"inference": True, "external_transfer": False}, "FLAGS_RUNTIME_NOT_OFF"),
                                ({"inference": False, "external_transfer": True}, "FLAGS_RUNTIME_NOT_OFF"),
                                ({"inference": "false", "external_transfer": False}, "FLAGS_RUNTIME_UNAVAILABLE"),
                                ({}, "FLAGS_RUNTIME_UNAVAILABLE")):
            code, lines, world = self.host_flags(OFF_ENV, runtime)
            self.assertEqual((code, lines), (2, [f"S5R1_AUDIT=HOLD_{reason}"]), runtime)
            self.assertFalse([a for a in execs(world) if a[2] == "-i"], runtime)   # LiteLLM never reached

    def test_summary_snippet_uses_the_real_runtime_parser(self):
        self.assertIn("load_gateway_settings(os.environ, read_key=False)", audit.SUMMARY_SNIPPET)
        self.assertIn("runtime_flags", audit.SUMMARY_SNIPPET)
