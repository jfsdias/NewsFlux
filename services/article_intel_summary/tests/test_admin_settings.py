"""TDD: owner-only LiteLLM admin config, no network, no real credentials."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.article_intel_auth.auth import AuthSettings, MinifluxAuthService
from services.article_intel_summary.admin_settings import (
    ManagedSettingsError, ManagedSettingsStore,
)
from services.article_intel_summary.app import create_app
from services.article_intel_summary.inference import DisabledInferenceAdapter
from services.article_intel_summary.service import SummaryService
from services.article_intel_summary.tests.support import (
    API_KEY, MINIFLUX_BASE, USER_ID, WEB_ORIGIN,
    FakeMinifluxHTTP, SyncASGIClient, request_headers,
)
from services.article_intel_summary.tests.test_dynamic_catalog import (
    FakeGateway, model_info, policy_model,
)
from services.content_fallback.http_client import HTTPResponse


KEY = "sk-synthetic-newsflux-first-key-abcdefg"
NEW_KEY = "sk-synthetic-newsflux-updated-key-hijklm"


class AdminMiniflux(FakeMinifluxHTTP):
    def get(self, url, **kwargs):
        answer = super().get(url, **kwargs)
        if url.endswith("/v1/me"):
            body = json.loads(answer.body)
            body["is_admin"] = True
            return HTTPResponse(
                answer.status,
                answer.headers,
                json.dumps(body).encode(),
                url
            )
        return answer


class AdminSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "managed"
        self.bootstrap = Path(self.tmp.name) / "original-key"
        self.bootstrap.write_text(KEY, encoding="utf-8")
        self.bootstrap.chmod(0o600)
        self.gateway = FakeGateway(
            listed=("primary-ollama", "secondary-synthetic"),
            infos=[
                model_info("primary-ollama", provider="ollama"),
                model_info("secondary-synthetic", provider="openai"),
            ],
        )
        self.requests = []
        def factory(base, peer, key):
            self.requests.append((base, peer, key))
            return self.gateway
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.bootstrap),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_INFERENCE_ENABLED": "false",
            "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false",
        }
        self.store = ManagedSettingsStore(self.env, root=str(self.root), getter_factory=factory)

    def test_read_legacy_no_new_file_or_dir(self):
        status = self.store.status()
        self.assertTrue(status["configured"])
        self.assertFalse(status["managed"])
        self.assertEqual(status["revision"], "bootstrap")
        self.assertFalse(self.root.exists())
        self.assertEqual(self.store.effective_values()["NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"], str(self.bootstrap))

    def test_atomic_key_replacement_does_not_modify_bootstrap(self):
        status = self.store.save_key(NEW_KEY, "bootstrap")
        self.assertTrue(status["managed"])
        self.assertEqual(self.store.effective_values()["__newsflux_managed_virtual_key"], NEW_KEY)
        self.assertEqual(self.bootstrap.read_text(), KEY)
        self.assertEqual((self.root / "settings.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
        self.assertNotIn(NEW_KEY, json.dumps(status))
        self.assertEqual(self.requests[-1][-1], NEW_KEY)

    def test_old_revision_never_overwrites_new(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.save_key(KEY, "bootstrap")
        self.assertEqual(ex.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.store.read()["key"], NEW_KEY)

    def test_failed_gateway_validation_preserves_prior_key(self):
        self.gateway.errors["/v1/models"] = RuntimeError("synthetic error")
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual(ex.exception.code, "KEY_UNVERIFIED")
        self.assertEqual(self.store.read()["key"], KEY)
        self.assertFalse(self.root.exists())

    def test_invalid_permission_or_symlink_never_falls_back(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        target = self.root / "settings.json"
        target.chmod(0o644)
        with self.assertRaises(ManagedSettingsError):
            self.store.effective_values()
        target.chmod(0o600)
        target.unlink()
        target.symlink_to(self.bootstrap)
        with self.assertRaises(ManagedSettingsError):
            self.store.effective_values()

    def test_policy_sanitized_validated_and_dynamically_stored(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        current = self.store.status()["revision"]
        info = self.store.discover().info["secondary-synthetic"]
        definition = {
            "version": 1,
            "models": [
                policy_model(
                    "selected-primary", "secondary-synthetic",
                    provider_identity=info.provider_identity,
                    input_usd_per_million="0",
                    output_usd_per_million="0",
                    transfer_authorized=True,
                ),
            ],
        }
        updated = self.store.save_policy(definition, current)
        self.assertEqual(updated["policy_models"], 1)
        self.assertEqual(self.store.policy()["policy"], definition)
        self.assertIn("selected-primary", self.store.effective_values()["NEWSFLUX_AI_MODEL_POLICY_JSON"])
        self.assertNotIn(NEW_KEY, json.dumps(self.store.policy()))

    def test_policy_rejects_undiscovered_and_does_not_modify_store(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        old = self.store.read()
        definition = {"version": 1, "models": [policy_model("unknown", "not-listed")]}
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.save_policy(definition, old["revision"])
        self.assertEqual(ex.exception.code, "MODEL_NOT_DISCOVERED")
        self.assertEqual(old, self.store.read())

    def test_disabled_changes_fail_closed(self):
        env = {**self.env, "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "false"}
        store = ManagedSettingsStore(env, root=str(self.root), getter_factory=lambda *_: self.gateway)
        with self.assertRaises(ManagedSettingsError) as ex:
            store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual(ex.exception.code, "CHANGES_DISABLED")
        self.assertFalse(self.root.exists())

    def make_client(self, *, admin=True):
        auth_settings = AuthSettings(
            miniflux_base_url=MINIFLUX_BASE,
            allowed_web_origins=frozenset({WEB_ORIGIN}),
            admin_user_ids=frozenset({USER_ID}) if admin else frozenset(),
            admin_allowlist_state="configured" if admin else "empty",
        )
        auth = MinifluxAuthService(auth_settings, http=AdminMiniflux())
        app = create_app(
            auth_service=auth,
            summary_service=SummaryService(DisabledInferenceAdapter()),
            admin_store=self.store,
        )
        return SyncASGIClient(app)

    def test_admin_status_and_models_are_read_only_and_never_expose_key(self):
        client = self.make_client()
        route = "/api/ai/v1/admin/litellm"
        response = client.get(route + "/status", headers=request_headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["configured"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn(KEY, response.text)
        response = client.get(route + "/models", headers=request_headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["models"]), 2)
        self.assertNotIn("gateway.example", response.text)
        self.assertNotIn(KEY, response.text)

    def test_admin_validated_key_update_uses_existing_miniflux_admin_auth(self):
        client = self.make_client()
        route = "/api/ai/v1/admin/litellm"
        response = client.post(
            route + "/test-key",
            headers=request_headers(),
            json={"key": NEW_KEY}
        )
        self.assertEqual(response.status_code, 200, response.text)
        response = client.post(
            route + "/save-key",
            headers=request_headers(),
            json={"key": NEW_KEY, "expected_revision": "bootstrap"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["managed"])
        self.assertNotIn(NEW_KEY, response.text)
        self.assertEqual(self.store.read()["key"], NEW_KEY)

    def test_nonadmin_forbidden_and_no_backend_write(self):
        client = self.make_client(admin=False)
        response = client.post(
            "/api/ai/v1/admin/litellm/save-key",
            headers=request_headers(),
            json={"key": NEW_KEY, "expected_revision": "bootstrap"}
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.root.exists())

    def test_missing_origin_and_cross_origin_fail_closed(self):
        client = self.make_client()
        for headers in (
            {"X-Miniflux-API-Key": API_KEY, "X-NewsFlux-Miniflux-Server": MINIFLUX_BASE},
            {**request_headers(), "Origin": "https://attacker.example"},
        ):
            response = client.post(
                "/api/ai/v1/admin/litellm/save-key",
                headers=headers,
                json={"key": NEW_KEY, "expected_revision": "bootstrap"}
            )
            self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.root.exists())

    def test_wrong_key_and_duplicate_json_fields_do_not_write(self):
        client = self.make_client()
        response = client.post(
            "/api/ai/v1/admin/litellm/save-key",
            headers={**request_headers(), "Content-Type": "application/json"},
            content='{"key":"a","key":"b","expected_revision":"bootstrap"}',
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(self.root.exists())

    def test_preflight_only_existing_route_and_safe_headers(self):
        client = self.make_client()
        response = client.options(
            "/api/ai/v1/admin/litellm/save-key",
            headers={
                "Origin": WEB_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-miniflux-api-key",
            },
        )
        self.assertEqual(response.status_code, 204, response.text)


if __name__ == "__main__":
    unittest.main()
