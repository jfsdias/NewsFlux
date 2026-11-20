"""D1 synthetic canary rehearsal (B5): the key-authority contract end to end through the real adapter, with
a mocked gateway transport. No network, no real key, no inference.

Covers: one authorized request; model identity check; gateway unavailability (5xx); timeout; local rate
throttle; fallback pair from one catalog state; revocation; flags OFF; rollback to the operator-policy
contract by removing the mode. Cost: nothing priced or accounted in NewsFlux (settled cost is exactly 0).
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import httpx

from services.article_intel_summary.catalog import ModelNotAvailable, create_model_router, discovered_model_id
from services.article_intel_summary.litellm_adapter import (
    InferenceUnavailable,
    LiteLLMInferenceAdapter,
    TransientLiteLLMFailure,
)
from services.article_intel_summary.tests.test_dynamic_catalog import FakeGateway, model_info
from services.article_intel_summary.tests.test_litellm_adapter import completion_response, input_fixture
from services.article_intel_summary.tests import test_litellm_key_authority as key_authority

ALIAS, OTHER = "acme-7b", "other-13b"


class D1SyntheticCanaryTests(unittest.TestCase):
    def setUp(self) -> None:
        base = key_authority.KeyAuthorityCatalogTests("test_default_contract_is_unchanged_without_the_mode")
        base.setUp()
        self.addCleanup(base.doCleanups)
        self.env = base.env
        self.gateway = FakeGateway(listed=(ALIAS, OTHER), infos=[model_info(ALIAS), model_info(OTHER)])
        self.requests: list[dict] = []

    def router(self, **overrides):
        values = {k: v for k, v in {**self.env, **overrides}.items() if v is not None}
        router, _ = create_model_router(values, discovery_getter=self.gateway, default_adapter=object())
        if router.ledger_owner is not None:
            self.addCleanup(router.ledger_owner.__exit__)
        return router

    def adapter(self, router, alias=ALIAS, handler=None):
        """The catalog's own settings and ledger, with a mocked transport instead of the network."""
        catalog_adapter = router.adapter_for(discovered_model_id(alias))

        def transport(request: httpx.Request) -> httpx.Response:
            self.requests.append(json.loads(request.content))
            return handler(request) if handler else completion_response(model=alias)

        adapter = LiteLLMInferenceAdapter(catalog_adapter.settings, ledger=catalog_adapter.ledger,
                                          client=httpx.Client(transport=httpx.MockTransport(transport)))
        return adapter

    def test_one_authorized_request_with_no_newsflux_cost_accounting(self) -> None:
        router = self.router()
        adapter = self.adapter(router)
        result = adapter.summarize(input_fixture(), timeout_seconds=10)
        self.assertEqual(result.effective_model_id, ALIAS)
        self.assertEqual(len(self.requests), 1)
        body = self.requests[0]
        self.assertEqual((body["model"], body["disable_fallbacks"], body["num_retries"]), (ALIAS, True, 0))
        rows = sqlite3.connect(adapter.settings.usage_database_path).execute(
            "SELECT state, estimated_cost_usd, actual_cost_usd FROM inference_usage").fetchall()
        self.assertEqual([(state, str(est), str(act)) for state, est, act in rows], [("settled", "0", "0")])

    def test_response_from_another_model_is_rejected(self) -> None:
        adapter = self.adapter(self.router(), handler=lambda r: completion_response(model=OTHER))
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=10)

    def test_gateway_unavailable_and_timeout_fail_safely(self) -> None:
        router = self.router()   # one router: the usage ledger has a single owner
        adapter = self.adapter(router, handler=lambda r: httpx.Response(503, json={"error": "down"}))
        with self.assertRaises((TransientLiteLLMFailure, InferenceUnavailable)):
            adapter.summarize(input_fixture(), timeout_seconds=10)

        def slow(request):
            raise httpx.ReadTimeout("synthetic timeout", request=request)

        adapter = self.adapter(router, handler=slow)
        with self.assertRaises(TransientLiteLLMFailure) as raised:
            adapter.summarize(input_fixture(), timeout_seconds=10)
        self.assertEqual(raised.exception.kind, "TIMEOUT")

    def test_local_rate_throttle_still_applies(self) -> None:
        adapter = self.adapter(self.router(NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE="2"))
        adapter.summarize(input_fixture(), timeout_seconds=10)
        adapter.summarize(input_fixture(), timeout_seconds=10)
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=10)
        self.assertEqual(len(self.requests), 2)

    def test_fallback_pair_comes_from_one_catalog_state(self) -> None:
        router = self.router()
        primary, fallback, adapter = router.fallback_view(discovered_model_id(ALIAS), discovered_model_id(OTHER))
        self.assertTrue(primary.available and fallback.available)
        self.assertEqual(adapter.settings.model_id, OTHER)
        self.gateway.listed = [ALIAS]
        self.gateway.infos = [model_info(ALIAS)]
        with self.assertRaises(ModelNotAvailable):
            router.fallback_view(discovered_model_id(ALIAS), discovered_model_id(OTHER))

    def test_revocation_flags_off_and_rollback(self) -> None:
        router = self.router()
        self.gateway.listed = [OTHER]
        self.gateway.infos = [model_info(OTHER)]
        with self.assertRaises(ModelNotAvailable):
            router.adapter_for(discovered_model_id(ALIAS))                       # revoked: no substitution
        for flag in ("NEWSFLUX_AI_INFERENCE_ENABLED", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER"):
            with self.assertRaises(ModelNotAvailable):
                self.router(**{flag: "false"}).adapter_for(discovered_model_id(OTHER))   # flags OFF
        rolled_back = self.router(NEWSFLUX_AI_MODEL_AUTHORITY=None)                       # rollback
        with self.assertRaises(ModelNotAvailable) as raised:
            rolled_back.adapter_for(discovered_model_id(OTHER))
        self.assertEqual(raised.exception.code, "MODEL_NOT_AUTHORIZED")


if __name__ == "__main__":
    unittest.main()
