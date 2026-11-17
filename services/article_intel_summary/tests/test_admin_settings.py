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

    def test_managed_record_deletion_never_restores_bootstrap_key(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual((self.root / "activated").read_bytes(), b"v1\n")
        (self.root / "settings.json").unlink()
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.effective_values()
        self.assertEqual(ex.exception.code, "CONFIG_UNAVAILABLE")
        with self.assertRaises(ManagedSettingsError):
            self.store.status()

    def test_second_write_preserves_one_private_operator_rollback_snapshot(self):
        first = self.store.save_key(NEW_KEY, "bootstrap")
        rollback_key = KEY
        self.store.save_key(rollback_key, first["revision"])
        previous = self.root / "previous.json"
        self.assertEqual(previous.stat().st_mode & 0o777, 0o600)
        saved = json.loads(previous.read_text())
        self.assertEqual(saved["key"], NEW_KEY)
        self.assertEqual(saved["revision"], first["revision"])
        self.assertEqual(self.store.read()["key"], KEY)

    def test_operator_rollback_restores_bootstrap_without_reviving_legacy_fallback(self):
        first = self.store.save_key(NEW_KEY, "bootstrap")
        restored = self.store.operator_restore_previous(first["revision"])
        self.assertTrue(restored["managed"])
        self.assertNotEqual(restored["revision"], first["revision"])
        self.assertEqual(self.store.read()["key"], KEY)
        self.assertTrue((self.root / "activated").exists())
        self.assertNotIn(NEW_KEY, json.dumps(restored))

    def test_operator_rollback_requires_exact_current_revision(self):
        first = self.store.save_key(NEW_KEY, "bootstrap")
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.operator_restore_previous("0" * 32)
        self.assertEqual(ex.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.store.status()["revision"], first["revision"])
        self.assertEqual(self.store.read()["key"], NEW_KEY)

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
        self.assertEqual(
            self.store.policy()["policy"]["models"][0]["alias"],
            "secondary-synthetic",
        )
        self.assertNotIn("provider_identity", self.store.policy()["policy"]["models"][0])
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

    # --- R2 audit regressions -------------------------------------------------

    def test_first_activation_write_failure_leaves_no_marker_and_keeps_bootstrap(self):
        real_write = ManagedSettingsStore._write_bytes

        def failing(store, path, data):
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return real_write(store, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", failing):
            with self.assertRaises(ManagedSettingsError) as ex:
                self.store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual(ex.exception.code, "CONFIG_UNAVAILABLE")
        self.assertFalse((self.root / "activated").exists())
        self.assertFalse((self.root / "settings.json").exists())
        status = self.store.status()
        self.assertFalse(status["managed"])
        self.assertEqual(self.store.read()["key"], KEY)

    def test_later_write_failure_preserves_previous_managed_record(self):
        first = self.store.save_key(NEW_KEY, "bootstrap")
        real_write = ManagedSettingsStore._write_bytes

        def failing(store, path, data):
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return real_write(store, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", failing):
            with self.assertRaises(ManagedSettingsError):
                self.store.save_key(KEY, first["revision"])
        self.assertEqual(self.store.status()["revision"], first["revision"])
        self.assertEqual(self.store.read()["key"], NEW_KEY)

    def test_non_numeric_policy_price_is_policy_invalid_not_unavailable(self):
        bad = {"version": 1, "models": [{
            "id": "synthetic-bad", "alias": "secondary-synthetic", "label": "x",
            "provider": "openai", "compatible_for_summary": True,
            "paid_authorized": False, "transfer_authorized": True,
            "input_usd_per_million": "not-a-number", "output_usd_per_million": "0",
        }]}
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.save_policy(bad, "bootstrap")
        self.assertEqual(ex.exception.code, "POLICY_INVALID")
        self.assertFalse(self.root.exists())

    def test_concurrent_writers_with_same_revision_only_one_wins(self):
        import threading
        results = []
        barrier = threading.Barrier(4)

        def writer(key):
            barrier.wait()
            try:
                self.store.save_key(key, "bootstrap")
                results.append("ok")
            except ManagedSettingsError as error:
                results.append(error.code)

        keys = [NEW_KEY, KEY, NEW_KEY + "x", KEY + "y"]
        threads = [threading.Thread(target=writer, args=(k,)) for k in keys]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count("ok"), 1, results)
        self.assertEqual(results.count("CONFIG_CONFLICT"), 3, results)

    def test_symlinked_settings_root_is_unsafe_and_never_written(self):
        target = Path(self.tmp.name) / "elsewhere"
        target.mkdir(mode=0o700)
        self.root.symlink_to(target, target_is_directory=True)
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual(ex.exception.code, "CONFIG_UNSAFE")
        self.assertEqual(list(target.iterdir()), [])
        with self.assertRaises(ManagedSettingsError):
            self.store.status()

    def test_symlinked_settings_file_is_unsafe_without_bootstrap_fallback(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        decoy = Path(self.tmp.name) / "decoy.json"
        decoy.write_bytes((self.root / "settings.json").read_bytes())
        decoy.chmod(0o600)
        (self.root / "settings.json").unlink()
        (self.root / "settings.json").symlink_to(decoy)
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.read()
        self.assertEqual(ex.exception.code, "CONFIG_UNSAFE")

    def test_world_readable_settings_record_is_unsafe(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        (self.root / "settings.json").chmod(0o644)
        with self.assertRaises(ManagedSettingsError) as ex:
            self.store.read()
        self.assertEqual(ex.exception.code, "CONFIG_UNSAFE")

    def test_plain_http_admin_request_is_rejected_without_write(self):
        client = self.make_client()
        headers = {**request_headers(), "Origin": WEB_ORIGIN.replace("https://", "http://")}
        response = client.post(
            "/api/ai/v1/admin/litellm/save-key",
            headers=headers,
            json={"key": NEW_KEY, "expected_revision": "bootstrap"},
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.root.exists())

    def test_oversized_body_rejected_without_write(self):
        client = self.make_client()
        response = client.post(
            "/api/ai/v1/admin/litellm/save-key",
            headers=request_headers(),
            json={"key": "sk-" + "a" * 20000, "expected_revision": "bootstrap"},
        )
        self.assertEqual(response.status_code, 413, response.text)
        self.assertFalse(self.root.exists())

    def test_error_bodies_never_echo_candidate_key(self):
        client = self.make_client()
        self.gateway.errors["/v1/models"] = RuntimeError(NEW_KEY)
        response = client.post(
            "/api/ai/v1/admin/litellm/test-key",
            headers=request_headers(),
            json={"key": NEW_KEY},
        )
        self.assertEqual(response.status_code, 503, response.text)
        self.assertNotIn(NEW_KEY, response.text)
        self.assertEqual(response.json(), {"error": {"code": "KEY_UNVERIFIED"}})

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

    def test_admin_approves_and_removes_a_discovered_model_without_code_change(self):
        client = self.make_client()
        root = "/api/ai/v1/admin/litellm"
        state = client.post(
            root + "/save-key",
            headers=request_headers(),
            json={"key": NEW_KEY, "expected_revision": "bootstrap"}
        )
        self.assertEqual(state.status_code, 200, state.text)
        revision = state.json()["revision"]

        blocked = client.post(
            root + "/approve-model",
            headers=request_headers(),
            json={
                "alias": "secondary-synthetic",
                "expected_revision": revision,
                "allow_paid": False,
                "allow_external": False,
            },
        )
        self.assertEqual(blocked.status_code, 503, blocked.text)
        self.assertEqual(self.store.status()["policy_models"], 0)

        approved = client.post(
            root + "/approve-model",
            headers=request_headers(),
            json={
                "alias": "secondary-synthetic",
                "expected_revision": revision,
                "allow_paid": False,
                "allow_external": True,
            },
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["policy_models"], 1)
        revision = approved.json()["revision"]
        displayed = client.get(root + "/policy", headers=request_headers()).json()
        self.assertEqual(len(displayed["policy"]["models"]), 1)
        self.assertNotIn("provider_identity", displayed["policy"]["models"][0])

        removed = client.post(
            root + "/remove-model",
            headers=request_headers(),
            json={"alias": "secondary-synthetic", "expected_revision": revision},
        )
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertEqual(removed.json()["policy_models"], 0)
        self.assertEqual(self.store.read()["policy"], {"version": 1, "models": []})

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


class ManagedCatalogIntegrationTests(unittest.TestCase):
    """Admin approval reaches the user catalog at runtime; corruption fails closed."""

    def setUp(self):
        from services.article_intel_summary.tests.test_litellm_adapter import approved_environment
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        boot = Path(self.tmp.name) / "key"
        boot.write_text(KEY + "\n", encoding="ascii")
        boot.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(boot),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
            "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_POLICY_JSON": json.dumps({"version": 1, "models": [
                policy_model("s5-free", "newsflux-s5-free"),
            ]}),
        })
        self.env = env
        self.gateway = FakeGateway(listed=("newsflux-s5-free", "acme-summarizer-7b"))
        self.root = Path(self.tmp.name) / "managed"
        self.store = ManagedSettingsStore(env, root=str(self.root), getter_factory=lambda *_: self.gateway)
        from services.article_intel_summary.catalog import create_model_router
        self.router, adapter = create_model_router(
            env, discovery_getter=self.gateway, config_values_provider=self.store.effective_values,
        )
        owner = getattr(getattr(adapter, "primary", adapter), "_owner", None) or self.router.ledger_owner
        if owner is not None:
            self.addCleanup(owner.__exit__)

    def available(self):
        return {m["id"] for m in self.router.catalog_document()["models"] if m["available"]}

    def test_admin_approval_and_revocation_change_user_catalog_without_restart(self):
        self.assertIn("s5-free", self.available())
        revision = self.store.save_key(NEW_KEY, "bootstrap")["revision"]
        # Activation copies the operator bootstrap policy into the single managed record.
        self.assertIn("s5-free", self.available())
        approved = self.store.approve_model(
            "acme-summarizer-7b", revision, allow_paid=False, allow_external=True,
        )
        from services.article_intel_summary.catalog import discovered_model_id
        new_id = discovered_model_id("acme-summarizer-7b")
        self.assertIn(new_id, self.available())
        self.store.remove_model("acme-summarizer-7b", approved["revision"])
        self.assertNotIn(new_id, self.available())
        self.assertIn("s5-free", self.available())

    def test_env_policy_ignored_after_activation_single_source_of_truth(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        rev = self.store.status()["revision"]
        self.store.remove_model("newsflux-s5-free", rev)
        self.assertNotIn("s5-free", self.available())
        self.assertIn("newsflux-s5-free", self.env["NEWSFLUX_AI_MODEL_POLICY_JSON"])

    def test_corrupted_managed_record_disables_every_model(self):
        self.store.save_key(NEW_KEY, "bootstrap")
        (self.root / "settings.json").write_text("{not json", encoding="utf-8")
        self.assertEqual(self.available(), set())
        document = self.router.catalog_document()
        self.assertEqual(document["policy"]["status"], "INVALID")


if __name__ == "__main__":
    unittest.main()
