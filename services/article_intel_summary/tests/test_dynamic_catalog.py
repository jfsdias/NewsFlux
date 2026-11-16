"""Dynamic model catalog (Track A). Synthetic gateway answers only; no network.

Gates: DISCOVERY_READ_ONLY, DISCOVERY_IS_NOT_AUTHORIZATION, OPERATOR_APPROVAL_REQUIRED,
COMPATIBILITY_REQUIRED, PRICE_VERIFIED_BY_GATEWAY, PAID_AUTHORIZATION_REQUIRED, NO_SILENT_SUBSTITUTION,
GATEWAY_FAILURE_FAILS_CLOSED, NO_CREDENTIAL_EXPOSURE, ADD_REMOVE_WITHOUT_CODE_CHANGE.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import httpx

from services.article_intel_summary.catalog import (
    MAX_CATALOG_MODELS,
    GatewayDiscovery,
    ModelNotAvailable,
    create_model_router,
    gateway_getter,
)
from services.article_intel_summary.contracts import validate_catalog
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.tests.test_litellm_adapter import (
    approved_environment,
)

KEY = "sk-synthetic-virtual-key-000000000000"


def model_info(alias, *, mode="chat", input_cost=0.0, output_cost=0.0, max_output=4096, provider="openai"):
    info = {"mode": mode, "litellm_provider": provider, "max_input_tokens": 32768, "max_output_tokens": max_output}
    if input_cost is not None:
        info["input_cost_per_token"] = input_cost
    if output_cost is not None:
        info["output_cost_per_token"] = output_cost
    # Admin-only details a gateway might include; they must never reach the catalog.
    return {"model_name": alias, "litellm_params": {"api_base": "http://internal-provider:9", "api_key": "provider-secret"}, "model_info": info}


class FakeGateway:
    def __init__(self, listed=("newsflux-s5-free",), infos=None, errors=None):
        self.listed = list(listed)
        self.infos = infos if infos is not None else [model_info(alias) for alias in self.listed]
        self.errors = errors or {}
        self.calls = []

    def __call__(self, path):
        self.calls.append(path)
        if path in self.errors:
            raise self.errors[path]
        if path == "/v1/models":
            return {"object": "list", "data": [{"id": alias, "object": "model"} for alias in self.listed]}
        if path == "/model/info":
            return {"data": self.infos}
        raise AssertionError(path)


def policy(*models):
    return json.dumps({"version": 1, "models": list(models)})


def policy_model(model_id, alias, **overrides):
    entry = {
        "id": model_id,
        "alias": alias,
        "label": model_id.upper(),
        "provider": "Synthetic",
        "compatible_for_summary": True,
        "input_usd_per_million": "0",
        "output_usd_per_million": "0",
        "paid_authorized": False,
        "transfer_authorized": True,
    }
    entry.update(overrides)
    return entry


class DynamicCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text(KEY + "\n", encoding="ascii")
        key.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        env.update(
            {
                "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
                "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
                "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
                "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            }
        )
        self.env = env

    def router(self, gateway, **env):
        router, adapter = create_model_router({**self.env, **env}, discovery_getter=gateway)
        owner = getattr(getattr(adapter, "primary", adapter), "_owner", None) or router.ledger_owner
        if owner is not None:
            self.addCleanup(owner.__exit__)
        return router

    def models(self, router):
        document = router.catalog_document()
        validate_catalog(document)
        return document, {item["id"]: item for item in document["models"]}

    # --- add / remove without code change -------------------------------------------------------

    def test_new_gateway_model_approved_by_policy_is_available_without_code_change(self) -> None:
        gateway = FakeGateway(listed=("newsflux-s5-free", "acme-summarizer-7b"))
        router = self.router(gateway, NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free"), policy_model("acme-7b", "acme-summarizer-7b")
        ))
        document, models = self.models(router)
        self.assertEqual(document["schema_version"], "2")
        self.assertTrue(models["acme-7b"]["available"], models["acme-7b"])
        self.assertEqual(models["acme-7b"]["status"], "AVAILABLE")
        self.assertEqual(models["acme-7b"]["pricing"]["status"], "verified_zero")
        self.assertTrue(models["acme-7b"]["checks"]["pricing_verified"])
        adapter = router.adapter_for("acme-7b")
        self.assertIsInstance(adapter, LiteLLMInferenceAdapter)
        self.assertEqual(adapter.settings.model_id, "acme-summarizer-7b")
        self.assertIs(adapter.ledger, router.adapter_for("s5-free").ledger)

    def test_model_removed_from_gateway_is_not_discovered_and_never_substituted(self) -> None:
        gateway = FakeGateway(listed=("newsflux-s5-free", "acme-summarizer-7b"))
        router = self.router(gateway, NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free"), policy_model("acme-7b", "acme-summarizer-7b")
        ), NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS="0")
        self.assertTrue(self.models(router)[1]["acme-7b"]["available"])
        gateway.listed = ["newsflux-s5-free"]
        gateway.infos = [model_info("newsflux-s5-free")]
        _, models = self.models(router)
        self.assertFalse(models["acme-7b"]["available"])
        self.assertEqual(models["acme-7b"]["status"], "NOT_DISCOVERED")
        self.assertEqual(models["acme-7b"]["unavailable_reason"], "NOT_DISCOVERED")
        with self.assertRaises(ModelNotAvailable) as raised:
            router.adapter_for("acme-7b")
        self.assertEqual(raised.exception.code, "MODEL_NOT_AVAILABLE")

    # --- discovery is not authorization ---------------------------------------------------------

    def test_discovered_but_not_approved_is_listed_blocked_with_opaque_id(self) -> None:
        router = self.router(FakeGateway(listed=("newsflux-s5-free", "rogue/expensive-model")))
        _, models = self.models(router)
        discovered = [item for item in models.values() if item["status"] == "OPERATOR_APPROVAL_REQUIRED"]
        self.assertEqual(len(discovered), 1)
        entry = discovered[0]
        self.assertRegex(entry["id"], r"^gw-[a-f0-9]{12}$")
        self.assertFalse(entry["available"])
        self.assertFalse(entry["checks"]["operator_approved"])
        self.assertTrue(entry["checks"]["discovered"])
        with self.assertRaises(ModelNotAvailable):
            router.adapter_for(entry["id"])

    def test_incompatible_or_unverifiable_mode_is_not_selectable(self) -> None:
        gateway = FakeGateway(
            listed=("newsflux-s5-free", "embed-1", "mystery"),
            infos=[model_info("newsflux-s5-free"), model_info("embed-1", mode="embedding"), {"model_name": "mystery", "model_info": {}}],
        )
        router = self.router(gateway, NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free"), policy_model("embed", "embed-1"), policy_model("mystery", "mystery")
        ))
        _, models = self.models(router)
        self.assertEqual(models["embed"]["status"], "UNSUPPORTED")
        self.assertEqual(models["embed"]["unavailable_reason"], "NOT_COMPATIBLE")
        self.assertEqual(models["mystery"]["status"], "UNVERIFIED")
        self.assertEqual(models["mystery"]["unavailable_reason"], "COMPATIBILITY_UNVERIFIED")
        self.assertIsNone(models["mystery"]["checks"]["compatible"])

    def test_operator_marked_incompatible_is_unsupported_even_if_chat(self) -> None:
        router = self.router(FakeGateway(), NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free", compatible_for_summary=False)
        ))
        self.assertEqual(self.models(router)[1]["s5-free"]["status"], "UNSUPPORTED")

    # --- pricing --------------------------------------------------------------------------------

    def test_unpublished_or_mismatched_price_is_unverified(self) -> None:
        gateway = FakeGateway(
            listed=("newsflux-s5-free", "acme"),
            infos=[model_info("newsflux-s5-free", input_cost=None, output_cost=None), model_info("acme", input_cost=1e-6, output_cost=1e-6)],
        )
        router = self.router(gateway, NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free"), policy_model("acme", "acme")
        ))
        _, models = self.models(router)
        self.assertEqual(models["s5-free"]["unavailable_reason"], "PRICE_NOT_VERIFIED")
        self.assertEqual(models["s5-free"]["pricing"]["status"], "operator_declared_zero")
        self.assertFalse(models["s5-free"]["checks"]["pricing_verified"])
        self.assertEqual(models["acme"]["unavailable_reason"], "PRICE_MISMATCH")
        self.assertEqual(models["acme"]["pricing"]["status"], "mismatch")

    def test_paid_model_requires_global_and_per_model_paid_authorization(self) -> None:
        gateway = FakeGateway(listed=("paid-x",), infos=[model_info("paid-x", input_cost=1.5e-7, output_cost=6e-7)])
        paid = policy_model("paid", "paid-x", input_usd_per_million="0.15", output_usd_per_million="0.6")
        for index, (env, per_model, expected) in enumerate((
            ({"NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false"}, True, "PAID_AUTHORIZATION_REQUIRED"),
            ({"NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true"}, False, "PAID_AUTHORIZATION_REQUIRED"),
            ({"NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true"}, True, "AVAILABLE"),
        )):
            # One ledger file per router: a held ledger lock correctly makes a second owner unavailable.
            env = {**env, "NEWSFLUX_AI_USAGE_DATABASE_PATH": str(Path(self.tmp.name) / f"usage-{index}.sqlite3")}
            router = self.router(gateway, NEWSFLUX_AI_MODEL_POLICY_JSON=policy({**paid, "paid_authorized": per_model}), **env)
            entry = self.models(router)[1]["paid"]
            self.assertEqual(entry["status"], expected, (env, per_model))
            self.assertTrue(entry["requires_paid_authorization"])
            self.assertEqual(entry["pricing"]["status"], "verified_paid")

    # --- gateway failures -------------------------------------------------------------------------

    def test_gateway_errors_fail_closed_but_catalog_is_served(self) -> None:
        for error in (RuntimeError("HTTP_403"), RuntimeError("HTTP_500"), httpx.ReadTimeout("t"), ValueError("bad json")):
            router = self.router(FakeGateway(errors={"/v1/models": error}))
            document, models = self.models(router)
            self.assertEqual(document["discovery"]["status"], "UNAVAILABLE")
            self.assertTrue(all(not item["available"] for item in models.values()))
            self.assertEqual(models["s5-free"]["unavailable_reason"], "GATEWAY_UNAVAILABLE")

    def test_malformed_listing_fails_closed(self) -> None:
        for listing in ({}, {"data": "x"}, {"data": [{"id": 5}]}, [], {"data": [{"id": "a b"}]}):
            gateway = FakeGateway()

            def call(path, listing=listing, gateway=gateway):
                return listing if path == "/v1/models" else gateway(path)

            router = self.router(call)
            _, models = self.models(router)
            self.assertFalse(models["s5-free"]["available"], listing)


    def test_mixed_litellm_listing_preserves_valid_approved_alias_without_approving_invalid_rows(self) -> None:
        """One malformed/unrelated LiteLLM alias must not hide an approved, valid chat model."""
        gateway = FakeGateway(listed=("newsflux-s5-free",))

        def mixed_listing(path):
            if path == "/v1/models":
                return {"data": [
                    {"id": "newsflux-s5-free", "object": "model"},
                    {"id": "unsupported model with spaces", "object": "model"},
                    {"id": None},
                    {"name": "missing-id"},
                ]}
            return gateway(path)

        router = self.router(mixed_listing)
        document, models = self.models(router)
        self.assertEqual(document["discovery"]["status"], "OK")
        self.assertTrue(models["s5-free"]["available"])
        self.assertEqual(set(models), {"s5-free", "mistral-small"})
        self.assertEqual(document["default_model_id"], "s5-free")

    def test_mixed_litellm_metadata_preserves_valid_price_and_rejects_unpriced_rows(self) -> None:
        """Bad entries cannot hide a valid model or supply price/identity to another alias."""
        gateway = FakeGateway(listed=("newsflux-s5-free",))

        def mixed_metadata(path):
            if path == "/model/info":
                return {"data": [
                    model_info("newsflux-s5-free", input_cost=0.0, output_cost=0.0),
                    {"model_name": "unsupported model with spaces", "model_info": {
                        "mode": "chat", "input_cost_per_token": 0, "output_cost_per_token": 0,
                    }},
                    {"model_name": None, "model_info": {
                        "mode": "chat", "input_cost_per_token": 0, "output_cost_per_token": 0,
                    }},
                    {"model_info": {"mode": "chat"}},
                ]}
            return gateway(path)

        router = self.router(mixed_metadata)
        document, models = self.models(router)
        self.assertEqual(document["discovery"]["status"], "OK")
        self.assertTrue(models["s5-free"]["available"])
        self.assertEqual(models["s5-free"]["pricing"]["status"], "verified_zero")

    def test_invalid_only_listing_stays_unavailable_and_cannot_be_dispatched(self) -> None:
        gateway = FakeGateway()

        def invalid_only(path):
            if path == "/v1/models":
                return {"data": [{"id": None}, {"id": "invalid whitespace"}]}
            return gateway(path)

        router = self.router(invalid_only)
        document, models = self.models(router)
        self.assertEqual(document["discovery"]["status"], "UNAVAILABLE")
        self.assertFalse(models["s5-free"]["available"])
        with self.assertRaises(ModelNotAvailable):
            router.adapter_for("s5-free")

    def test_model_info_failure_leaves_compatibility_unverified(self) -> None:
        router = self.router(FakeGateway(errors={"/model/info": RuntimeError("HTTP_403")}))
        entry = self.models(router)[1]["s5-free"]
        self.assertEqual(entry["unavailable_reason"], "COMPATIBILITY_UNVERIFIED")
        self.assertTrue(entry["checks"]["discovered"])

    def test_discovery_disabled_makes_no_gateway_call_and_nothing_is_available(self) -> None:
        gateway = FakeGateway()
        router = self.router(gateway, NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED="false")
        document, models = self.models(router)
        self.assertEqual(gateway.calls, [])
        self.assertEqual(document["discovery"]["status"], "DISABLED")
        self.assertEqual(models["s5-free"]["unavailable_reason"], "DISCOVERY_DISABLED")
        self.assertIsNone(document["default_model_id"])

    def test_discovery_result_is_cached_within_ttl(self) -> None:
        gateway = FakeGateway()
        router = self.router(gateway)
        for _ in range(3):
            router.catalog_document()
            router.adapter_for("s5-free")
        self.assertEqual(gateway.calls, ["/v1/models", "/model/info"])

    # --- policy ---------------------------------------------------------------------------------

    def test_invalid_policy_fails_closed(self) -> None:
        for raw in ("not json", json.dumps({"version": 2, "models": []}),
                    policy(policy_model("Bad ID", "x")), policy(policy_model("a", "x"), policy_model("a", "y")),
                    policy(policy_model("a", "x"), policy_model("b", "x")), policy({**policy_model("a", "x"), "extra": 1}),
                    policy(policy_model("a", "x", input_usd_per_million="-1")),
                    policy(policy_model("auto", "x")), policy(policy_model("none", "x"))):
            router = self.router(FakeGateway(), NEWSFLUX_AI_MODEL_POLICY_JSON=raw)
            document, models = self.models(router)
            self.assertEqual(document["policy"]["status"], "INVALID", raw)
            self.assertTrue(all(not item["available"] for item in models.values()))

    def test_legacy_environment_keeps_s5_and_mistral_ids(self) -> None:
        gateway = FakeGateway(listed=("synthetic-s5-free",), infos=[model_info("synthetic-s5-free")])
        router = self.router(gateway, NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="synthetic-s5-free")
        document, models = self.models(router)
        self.assertEqual(document["policy"]["status"], "LEGACY")
        self.assertEqual(set(models) & {"s5-free", "mistral-small"}, {"s5-free", "mistral-small"})
        self.assertTrue(models["s5-free"]["available"], models["s5-free"])
        self.assertEqual(document["default_model_id"], "s5-free")

    def test_transfer_not_authorized_per_model(self) -> None:
        router = self.router(FakeGateway(), NEWSFLUX_AI_MODEL_POLICY_JSON=policy(
            policy_model("s5-free", "newsflux-s5-free", transfer_authorized=False)
        ))
        self.assertEqual(self.models(router)[1]["s5-free"]["unavailable_reason"], "TRANSFER_NOT_AUTHORIZED")

    def test_catalog_size_is_bounded_with_policy_models_first(self) -> None:
        listed = ["newsflux-s5-free"] + [f"extra-{n}" for n in range(60)]
        router = self.router(FakeGateway(listed=listed, infos=[model_info(a) for a in listed]))
        document, models = self.models(router)
        self.assertLessEqual(len(document["models"]), MAX_CATALOG_MODELS)
        self.assertEqual(document["models"][0]["id"], "s5-free")

    def test_no_credentials_urls_or_provider_params_in_catalog(self) -> None:
        router = self.router(FakeGateway(listed=("newsflux-s5-free", "other")))
        text = json.dumps(router.catalog_document())
        for secret in (KEY, "litellm.example", "provider-secret", "internal-provider", "api_base"):
            self.assertNotIn(secret, text)

    def test_unavailable_default_is_not_advertised(self) -> None:
        router = self.router(FakeGateway(listed=()), NEWSFLUX_AI_DEFAULT_MODEL_ID="s5-free")
        self.assertIsNone(router.catalog_document()["default_model_id"])

    def test_configuration_is_snapshotted_at_startup(self) -> None:
        env = dict(self.env)
        router, adapter = create_model_router(env, discovery_getter=FakeGateway())
        self.addCleanup(lambda: getattr(adapter, "_owner", None) and adapter._owner.__exit__())
        env.clear()  # the lazily rebuilt catalog must not read a mutated/emptied environment
        self.assertTrue(router.catalog_document()["models"][0]["available"])

    def test_inference_disabled_still_shows_discovery_checks(self) -> None:
        router = self.router(FakeGateway(), NEWSFLUX_AI_INFERENCE_ENABLED="false")
        entry = self.models(router)[1]["s5-free"]
        self.assertEqual(entry["status"], "DISABLED")
        self.assertEqual(entry["unavailable_reason"], "INFERENCE_DISABLED")
        self.assertTrue(entry["checks"]["discovered"])
        self.assertTrue(entry["checks"]["pricing_verified"])


class GatewayGetterTests(unittest.TestCase):
    def transport(self, handler):
        return httpx.MockTransport(handler)

    def test_get_only_bearer_no_redirect_and_size_cap(self) -> None:
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"data": []})

        get = gateway_getter("https://litellm.example", None, KEY, client=httpx.Client(transport=self.transport(handler)))
        self.assertEqual(get("/v1/models"), {"data": []})
        self.assertEqual(seen[0].method, "GET")
        self.assertEqual(seen[0].headers["authorization"], f"Bearer {KEY}")
        self.assertEqual(seen[0].url.path, "/v1/models")

        big = httpx.Client(transport=self.transport(lambda r: httpx.Response(200, content=b"[" + b"0," * 200_000 + b"0]")))
        with self.assertRaises(RuntimeError):
            gateway_getter("https://litellm.example", None, KEY, client=big)("/v1/models")
        redirect = httpx.Client(transport=self.transport(lambda r: httpx.Response(302, headers={"location": "https://evil.example/"})))
        with self.assertRaises(RuntimeError):
            gateway_getter("https://litellm.example", None, KEY, client=redirect)("/v1/models")

    def test_http_gateway_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            gateway_getter("http://litellm.example", None, KEY)
        self.assertIsNone(GatewayDiscovery.from_environment({"NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true", "NEWSFLUX_AI_LITELLM_BASE_URL": "http://litellm.example"}))


if __name__ == "__main__":
    unittest.main()
