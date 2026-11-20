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
        if '"litellm_verificationtoken"' in lowered:
            selected = re.findall(r'"([a-z_]+)"', sql.split("FROM")[0])
            return [{k: v for k, v in row.items() if k in selected} for row in self.tokens]
        if '"litellm_proxymodeltable"' in lowered:
            return [row for row in self.models if row.get("model_name") == params[0]]
        if '"litellm_config"' in lowered:
            return [{"param_name": k, "param_value": v} for k, v in self.config.items()]
        if '"litellm_budgettable"' in lowered:
            row = self.budgets.get(params[0])
            return [row] if row else []
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
        lines = audit.render(facts, mutations="0")
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
            audit.render({"KEY_MATCH": "newsflux-s5-free"}, mutations="0")


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
            if argv[:2] == ["docker", "inspect"]:
                return snaps.pop(0)
            if argv[:3] == ["docker", "exec", "-u"]:  # Summary: fingerprint + alias + caps
                return json.dumps({"fingerprint": "f" * 64, "alias": ALIAS, "caps": CAPS, "allowed_callbacks": []})
            if argv[:3] == ["docker", "exec", "-i"]:
                return json.dumps(probe or {"KEY_MATCH": "ONE", "KEY_POLICY_GATE": "FAIL", "DB_READ_ONLY": "VERIFIED"})
            raise AssertionError(argv)

        return run, calls

    def host(self, run, **kwargs):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(["--litellm-container", "litellm"], run=run, euid=kwargs.get("euid", 0))
        return code, out.getvalue().splitlines()

    def test_happy_path_prints_classifications_and_zero_mutations(self):
        run, calls = self.fake_docker()
        code, lines = self.host(run)
        self.assertEqual(code, 0, lines)
        self.assertIn("S5R1_KEY_POLICY_GATE=FAIL", lines)
        self.assertIn("S5R1_PRODUCTION_MUTATIONS=0", lines)
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
