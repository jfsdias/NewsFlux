"""D1 successor contract: the LiteLLM virtual key is the model authority, LiteLLM is the cost authority.

Owner decisions (2026-11-20): R2 "Chave do LiteLLM rege os modelos disponíveis"; R3 "LiteLLM controla custos.
Não precisa ser controlado ou aparecer no NewsFlux." Mode NEWSFLUX_AI_MODEL_AUTHORITY=litellm_key (default
off: the current operator-policy contract stays in force). Synthetic gateway answers only; no network.

Gates: KEY_LISTING_IS_THE_CATALOG, NO_SECOND_ALLOWLIST, CAPABILITY_STILL_REQUIRED, COST_AUTHORITY_DECLARED
(declaration must match fresh gateway evidence bound to the key; explicit unlimited is distinct from missing), NON_FINANCIAL_GATES_KEPT
(inference, external transfer, gateway, discovery), NO_SILENT_SUBSTITUTION, NO_COST_IN_CATALOG,
NO_CREDENTIAL_EXPOSURE, LOCAL_RATE_THROTTLE_KEPT.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from services.article_intel_summary.budget import BudgetBlocked, BudgetLedger
from services.article_intel_summary.catalog import ModelNotAvailable, create_model_router, discovered_model_id
from services.article_intel_summary.contracts import validate_catalog
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.tests.test_dynamic_catalog import FakeGateway, model_info
from services.article_intel_summary.tests.test_litellm_adapter import approved_environment

KEY = "sk-synthetic-virtual-key-000000000000"
COST_ENV = (
    "NEWSFLUX_AI_MONTHLY_BUDGET_USD",
    "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE",
)


def with_pinned_evidence(values):
    """The deployment pins the ledger-recorded evidence digest; tests pin the digest of the file they wrote."""
    values = {k: v for k, v in values.items() if v is not None}
    path = values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE")
    if path and "NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256" not in values and Path(path).is_file():
        values["NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256"] = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return values


class KeyAuthorityCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text(KEY + "\n", encoding="ascii")
        key.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        for name in COST_ENV:   # no NewsFlux cost administration at all
            env.pop(name, None)
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS": "0",
            "NEWSFLUX_AI_MODEL_AUTHORITY": "litellm_key",
            "NEWSFLUX_AI_LITELLM_COST_AUTHORITY": "gateway_budget_enforced",
            "NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE": self.write_evidence("budget.json"),
        })
        env.pop("NEWSFLUX_AI_LITELLM_MODEL_CHOICE", None)
        self.env = env

    def write_evidence(self, name, declaration="gateway_budget_enforced", facts=None, key=KEY):
        """v2 evidence as the root-run builder writes it from an executor receipt (see test_cost_authority_evidence)."""
        from datetime import datetime, timedelta, timezone

        from services.article_intel_summary.tests.test_cost_authority_evidence import (
            evidence,
            trust_current_user,
            write_trusted,
        )
        trust_current_user(self)
        directory = Path(self.tmp.name) / "evidence"      # trusted-file contract: root-owned, not group/other-writable
        directory.mkdir(mode=0o755, exist_ok=True)
        captured = datetime.now(timezone.utc) - timedelta(hours=1)
        return write_trusted(directory, name, evidence(declaration, facts, key=key, captured=captured))

    def router(self, gateway, **overrides):
        values = with_pinned_evidence({**self.env, **overrides})
        router, adapter = create_model_router(values, discovery_getter=gateway, default_adapter=object())
        if router.ledger_owner is not None:
            self.addCleanup(router.ledger_owner.__exit__)
        return router

    def models(self, router):
        document = router.catalog_document()
        validate_catalog(document)
        return document, {item["label"]: item for item in document["models"]}

    # --- the key listing is the catalog ---------------------------------------------------------

    def test_every_chat_model_the_key_lists_is_available_without_a_newsflux_allowlist(self) -> None:
        gateway = FakeGateway(listed=("acme-7b", "other-13b"), infos=[
            model_info("acme-7b", input_cost=0.000001, output_cost=0.000002), model_info("other-13b")])
        router = self.router(gateway)
        document, models = self.models(router)
        self.assertEqual(set(models), {"acme-7b", "other-13b"})
        for label, item in models.items():
            self.assertTrue(item["available"], item)
            self.assertEqual(item["status"], "AVAILABLE")
            self.assertEqual(item["id"], discovered_model_id(label))
            self.assertTrue(item["checks"]["operator_approved"])          # approved by the key itself
            self.assertNotEqual(item["status"], "OPERATOR_APPROVAL_REQUIRED")
        adapter = router.adapter_for(discovered_model_id("acme-7b"))
        self.assertIsInstance(adapter, LiteLLMInferenceAdapter)
        self.assertEqual(adapter.settings.model_id, "acme-7b")
        self.assertTrue(adapter.settings.is_ready())

    def test_no_cost_amount_or_paid_gate_reaches_the_catalog(self) -> None:
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b", input_cost=0.00003, output_cost=0.00006)])
        _, models = self.models(self.router(gateway))
        item = models["acme-7b"]
        self.assertEqual(item["pricing"], {"status": "gateway_governed", "input_usd_per_million": None,
                                           "output_usd_per_million": None})
        self.assertFalse(item["requires_paid_authorization"])
        self.assertTrue(item["available"])

    def test_capability_is_still_required(self) -> None:
        gateway = FakeGateway(listed=("embed-1", "mystery", "acme-7b"), infos=[
            model_info("embed-1", mode="embedding"), {"model_name": "mystery", "model_info": {}}, model_info("acme-7b")])
        _, models = self.models(self.router(gateway))
        self.assertEqual((models["embed-1"]["status"], models["embed-1"]["unavailable_reason"]), ("UNSUPPORTED", "NOT_COMPATIBLE"))
        self.assertEqual(models["mystery"]["unavailable_reason"], "COMPATIBILITY_UNVERIFIED")
        self.assertFalse(models["mystery"]["available"])
        self.assertTrue(models["acme-7b"]["available"])

    # --- cost authority must be declared: missing is not unlimited ------------------------------

    def test_missing_or_unknown_cost_authority_declaration_fails_closed(self) -> None:
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        for value in (None, "", "yes", "unlimited", "true"):
            router = self.router(gateway, NEWSFLUX_AI_LITELLM_COST_AUTHORITY=value)
            _, models = self.models(router)
            self.assertFalse(models["acme-7b"]["available"], value)
            self.assertEqual(models["acme-7b"]["unavailable_reason"], "COST_AUTHORITY_UNPROVEN", value)
            with self.assertRaises(ModelNotAvailable):
                router.adapter_for(discovered_model_id("acme-7b"))

    def test_declaration_without_matching_fresh_evidence_for_this_key_fails_closed(self) -> None:
        from services.article_intel_summary.tests.test_cost_authority_evidence import OTHER_KEY, UNLIMITED_FACTS
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        cases = (
            {"NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE": None},                                  # no evidence
            {"NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE": self.write_evidence("other.json", key=OTHER_KEY)},  # rotated key
            {"NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE": self.write_evidence(
                "nobudget.json", facts={**UNLIMITED_FACTS})},                                          # budget missing
            {"NEWSFLUX_AI_LITELLM_COST_AUTHORITY": "explicit_unlimited"},                              # declaration mismatch
        )
        for overrides in cases:
            _, models = self.models(self.router(gateway, **overrides))
            self.assertEqual(models["acme-7b"]["unavailable_reason"], "COST_AUTHORITY_UNPROVEN", overrides)

    def test_explicit_unlimited_is_accepted_as_a_distinct_declaration(self) -> None:
        from services.article_intel_summary.tests.test_cost_authority_evidence import UNLIMITED_FACTS
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        router = self.router(gateway, NEWSFLUX_AI_LITELLM_COST_AUTHORITY="explicit_unlimited",
                             NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE=self.write_evidence(
                                 "unlimited.json", "explicit_unlimited", UNLIMITED_FACTS))
        _, models = self.models(router)
        self.assertTrue(models["acme-7b"]["available"])
        self.assertEqual(router.adapter_for(discovered_model_id("acme-7b")).settings.cost_authority, "explicit_unlimited")

    def test_local_only_consent_never_admits_a_model_in_key_mode(self) -> None:
        """PR260 reconciliation (R6): in key mode local-only consent cannot be proven from what the virtual key
        sees (model_info names a deployment, not its fallbacks, callbacks or indirect routes), and neither the
        alias, the provider string nor a zero/absent price is identity. Until a key-mode local proof exists,
        local-only consent admits nothing: privacy is never weakened."""
        local = model_info("ollama-local", provider="ollama", input_cost=None, output_cost=None)
        local["litellm_params"] = {"api_base": "http://ollama:11434", "model": "ollama/llama3"}
        gateway = FakeGateway(listed=("ollama-local", "acme-7b"), infos=[local, model_info("acme-7b")])
        router = self.router(gateway, NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER="false",
                             NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING="true")
        _, models = self.models(router)
        for alias in ("ollama-local", "acme-7b"):
            self.assertFalse(models[alias]["available"], alias)
            self.assertEqual(models[alias]["unavailable_reason"], "EXTERNAL_TRANSFER_NOT_AUTHORIZED", alias)
            with self.assertRaises(ModelNotAvailable):
                router.adapter_for(discovered_model_id(alias))

    # --- non-financial gates are unchanged --------------------------------------------------------

    def test_inference_transfer_and_discovery_gates_still_hold(self) -> None:
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        cases = (
            ({"NEWSFLUX_AI_INFERENCE_ENABLED": "false"}, "INFERENCE_DISABLED"),
            ({"NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false"}, "EXTERNAL_TRANSFER_NOT_AUTHORIZED"),
        )
        for overrides, reason in cases:
            _, models = self.models(self.router(gateway, **overrides))
            self.assertEqual(models["acme-7b"]["unavailable_reason"], reason, overrides)
            self.assertFalse(models["acme-7b"]["available"])
        document, models = self.models(self.router(gateway, NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED="false"))
        self.assertEqual(models, {})
        self.assertEqual(document["discovery"]["status"], "DISABLED")

    def test_gateway_unavailable_lists_nothing_and_selects_nothing(self) -> None:
        import httpx
        gateway = FakeGateway(listed=("acme-7b",), errors={"/v1/models": httpx.ConnectError("down")})
        router = self.router(gateway)
        document, models = self.models(router)
        self.assertEqual(models, {})
        self.assertEqual(document["discovery"]["status"], "UNAVAILABLE")
        with self.assertRaises(ModelNotAvailable) as raised:
            router.adapter_for(discovered_model_id("acme-7b"))
        self.assertEqual(raised.exception.code, "MODEL_NOT_AVAILABLE")

    # --- revocation: no silent substitution -------------------------------------------------------

    def test_model_revoked_from_the_key_disappears_and_is_never_substituted(self) -> None:
        gateway = FakeGateway(listed=("acme-7b", "other-13b"), infos=[model_info("acme-7b"), model_info("other-13b")])
        acme = discovered_model_id("acme-7b")
        router = self.router(gateway, NEWSFLUX_AI_DEFAULT_MODEL_ID=acme)
        self.assertEqual(router.default_model_id, acme)
        gateway.listed = ["other-13b"]
        gateway.infos = [model_info("other-13b")]
        _, models = self.models(router)
        self.assertNotIn("acme-7b", models)
        self.assertIsNone(router.default_model_id)        # never silently replaced by other-13b
        with self.assertRaises(ModelNotAvailable) as raised:
            router.adapter_for(acme)
        self.assertEqual(raised.exception.code, "MODEL_NOT_AVAILABLE")

    def test_key_and_provider_internals_never_reach_the_catalog(self) -> None:
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        text = json.dumps(self.router(gateway).catalog_document())
        for secret in (KEY, "provider-secret", "internal-provider"):
            self.assertNotIn(secret, text)

    def test_default_contract_is_unchanged_without_the_mode(self) -> None:
        # Without NEWSFLUX_AI_MODEL_AUTHORITY=litellm_key a listed alias still needs operator approval.
        gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b")])
        _, models = self.models(self.router(gateway, NEWSFLUX_AI_MODEL_AUTHORITY=None))
        self.assertEqual(models["acme-7b"]["status"], "OPERATOR_APPROVAL_REQUIRED")
        self.assertFalse(models["acme-7b"]["available"])


class GatewayCostAuthorityLedgerTests(unittest.TestCase):
    """LiteLLM owns money; NewsFlux keeps only the local request/token/concurrency throttle."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ledger = BudgetLedger(str(Path(self.tmp.name) / "usage.sqlite3"))

    def test_no_monthly_usd_budget_but_rate_limits_still_enforced(self) -> None:
        for _ in range(2):
            self.ledger.reserve(estimated_cost_usd=Decimal("0"), input_tokens=10, output_tokens=10,
                                monthly_budget_usd=None, requests_per_minute=2, tokens_per_minute=1000, max_concurrent=5)
        with self.assertRaises(BudgetBlocked):
            self.ledger.reserve(estimated_cost_usd=Decimal("0"), input_tokens=10, output_tokens=10,
                                monthly_budget_usd=None, requests_per_minute=2, tokens_per_minute=1000, max_concurrent=5)

    def test_a_missing_budget_is_only_accepted_with_zero_local_cost(self) -> None:
        from services.article_intel_summary.budget import UsageLedgerError
        with self.assertRaises(UsageLedgerError):
            self.ledger.reserve(estimated_cost_usd=Decimal("0.01"), input_tokens=10, output_tokens=10,
                                monthly_budget_usd=None, requests_per_minute=2, tokens_per_minute=1000)


if __name__ == "__main__":
    unittest.main()


class KeyAuthorityAdminTests(unittest.TestCase):
    """In key-authority mode NewsFlux administers neither models nor costs: no approval writes, no prices."""

    def setUp(self) -> None:
        from services.article_intel_summary.admin_settings import ManagedSettingsStore

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text(KEY, encoding="utf-8")
        key.chmod(0o600)
        self.gateway = FakeGateway(listed=("acme-7b",), infos=[model_info("acme-7b", input_cost=0.00003)])
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_AUTHORITY": "litellm_key",
        }
        self.Store = ManagedSettingsStore
        self.root = str(Path(self.tmp.name) / "managed")

    def store(self, **overrides):
        env = {k: v for k, v in {**self.env, **overrides}.items() if v is not None}
        return self.Store(env, root=self.root, getter_factory=lambda *_: self.gateway)

    def test_status_reports_the_authority(self) -> None:
        self.assertEqual(self.store().status()["model_authority"], "litellm_key")
        self.assertEqual(self.store(NEWSFLUX_AI_MODEL_AUTHORITY=None).status()["model_authority"], "newsflux_policy")

    def test_no_duplicate_model_administration_in_key_mode(self) -> None:
        from services.article_intel_summary.admin_settings import ManagedSettingsError

        store = self.store()
        with self.assertRaises(ManagedSettingsError) as raised:
            store.approve_model("acme-7b", store.status()["revision"], allow_external=True, allow_paid=True)
        self.assertEqual(raised.exception.code, "MODEL_AUTHORITY_IS_LITELLM_KEY")
        with self.assertRaises(ManagedSettingsError) as raised:
            store.save_policy({"version": 1, "models": []}, store.status()["revision"])
        self.assertEqual(raised.exception.code, "MODEL_AUTHORITY_IS_LITELLM_KEY")

    def test_public_models_carry_no_price_in_key_mode(self) -> None:
        document = self.store().public_models()
        text = json.dumps(document)
        for field in ("price_known", "price_class", "input_usd_per_million", "output_usd_per_million"):
            self.assertNotIn(field, text)
        self.assertEqual([m["id"] for m in document["models"]], ["acme-7b"])
