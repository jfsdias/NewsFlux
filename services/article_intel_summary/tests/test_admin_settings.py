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

    def test_public_models_classify_price_without_inventing_amounts(self):
        self.gateway.listed.append("paid-synthetic")
        self.gateway.listed.append("unpriced-synthetic")
        self.gateway.infos.append(model_info("paid-synthetic", input_cost=0.000001, output_cost=0.000002))
        self.gateway.infos.append(model_info("unpriced-synthetic", input_cost=None, output_cost=None))
        rows = {row["id"]: row for row in self.store.public_models()["models"]}
        self.assertEqual(rows["secondary-synthetic"]["price_class"], "free")
        self.assertEqual(rows["paid-synthetic"]["price_class"], "paid")
        self.assertEqual(rows["unpriced-synthetic"]["price_class"], "unknown")
        for row in rows.values():
            self.assertFalse({"input_price", "output_price", "api_base", "api_key"} & set(row))

    def test_red_team_request_matrix_never_writes(self):
        client = self.make_client()
        route = "/api/ai/v1/admin/litellm/save-key"
        body = {"key": NEW_KEY, "expected_revision": "bootstrap"}
        cases = [
            ("invalid json", dict(headers={**request_headers(), "Content-Type": "application/json"},
                                  content="{not-json"), 422),
            ("wrong content type", dict(headers={**request_headers(), "Content-Type": "text/plain"},
                                        content=json.dumps(body)), 422),
            ("extra field", dict(headers=request_headers(), json={**body, "admin": True}), 422),
            ("non-string revision", dict(headers=request_headers(), json={"key": NEW_KEY, "expected_revision": 1}), 422),
            ("host mismatch", dict(headers={**request_headers(), "Host": "attacker.example"}, json=body), 403),
            ("query string", dict(headers=request_headers(), json=body, params={"x": "1"}), 403),
            ("expired session", dict(headers=request_headers(api_key="expired-or-revoked-key"), json=body), 401),
        ]
        for name, kwargs, status in cases:
            with self.subTest(name):
                if name == "expired session":
                    client.app.state.auth_service.http.identity_status = 401
                response = client.post(route, **kwargs)
                client.app.state.auth_service.http.identity_status = 200
                self.assertEqual(response.status_code, status, (name, response.text))
                self.assertNotIn(NEW_KEY, response.text)
                self.assertFalse(self.root.exists(), name)
        for method in ("get", "put", "delete"):
            with self.subTest(method):
                response = client.request(method.upper(), route, headers=request_headers())
                self.assertIn(response.status_code, (404, 405), method)
                self.assertFalse(self.root.exists())

    def test_stale_revision_via_api_is_409_and_key_never_in_any_get(self):
        client = self.make_client()
        root = "/api/ai/v1/admin/litellm"
        saved = client.post(root + "/save-key", headers=request_headers(),
                            json={"key": NEW_KEY, "expected_revision": "bootstrap"})
        self.assertEqual(saved.status_code, 200, saved.text)
        stale = client.post(root + "/save-key", headers=request_headers(),
                            json={"key": KEY, "expected_revision": "bootstrap"})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.store.read()["key"], NEW_KEY)
        for action in ("status", "models", "policy"):
            response = client.get(f"{root}/{action}", headers=request_headers())
            self.assertEqual(response.status_code, 200, (action, response.text))
            self.assertNotIn(NEW_KEY, response.text)
            self.assertNotIn(KEY, response.text)
            self.assertNotIn("sk-", response.text)

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


class ManagedPolicyNullLegacyTests(unittest.TestCase):
    """P1 (R3): first activation without an operator policy must not revive legacy S5/Mistral."""

    def setUp(self):
        from services.article_intel_summary.tests.test_litellm_adapter import (
            MISTRAL_ALIAS, S5_ALIAS, approved_environment,
        )
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        boot = Path(self.tmp.name) / "key"
        boot.write_text(KEY + "\n", encoding="ascii")
        boot.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(boot),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
        })
        env.pop("NEWSFLUX_AI_MODEL_POLICY_JSON", None)  # legacy deployment: no explicit policy
        self.env = env
        self.gateway = FakeGateway(listed=(S5_ALIAS, MISTRAL_ALIAS))
        self.root = Path(self.tmp.name) / "managed"

    def store(self):
        return ManagedSettingsStore(self.env, root=str(self.root), getter_factory=lambda *_: self.gateway)

    def activate_with_new_key(self, store=None):
        """First activation is an explicit migration (P0), then the key replacement."""
        store = store or self.store()
        preview = store.migration_preview()
        migrated = store.migrate_legacy_policy("bootstrap", preview["preview_token"], "MIGRATE-LEGACY-POLICY")
        return store.save_key(NEW_KEY, migrated["revision"])

    def router(self, store):
        from services.article_intel_summary.catalog import create_model_router
        router, adapter = create_model_router(
            self.env, discovery_getter=self.gateway, config_values_provider=store.effective_values,
        )
        owner = getattr(getattr(adapter, "primary", adapter), "_owner", None) or router.ledger_owner
        if owner is not None:
            self.addCleanup(owner.__exit__)
        return router

    @staticmethod
    def available(router):
        return {m["id"] for m in router.catalog_document()["models"] if m["available"]}

    def test_legacy_models_before_activation_remain_compatible(self):
        router = self.router(self.store())
        self.assertEqual(router.catalog_document()["policy"]["status"], "LEGACY")
        self.assertIn("s5-free", self.available(router))

    def test_key_only_first_activation_does_not_revive_legacy_models_after_restart(self):
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().save_key(NEW_KEY, "bootstrap")  # implicit null -> empty is refused
        self.assertEqual(caught.exception.code, "MIGRATION_REQUIRED")
        self.activate_with_new_key()
        router = self.router(self.store())  # simulated restart: fresh store and router
        document = router.catalog_document()
        self.assertNotEqual(document["policy"]["status"], "LEGACY")
        self.assertEqual(self.available(router), set())
        self.assertEqual(self.store().read()["policy"], {"version": 1, "models": []})

    def test_explicit_empty_allowlist_then_approval_and_last_revocation(self):
        store = self.store()
        rev = self.activate_with_new_key(store)["revision"]
        self.assertEqual(store.status()["policy_models"], 0)
        from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS
        self.gateway.infos = [model_info(S5_ALIAS, provider="ollama")]
        self.gateway.infos[0]["litellm_params"]["api_base"] = "http://ollama:11434"
        rev = store.approve_model(S5_ALIAS, rev)["revision"]
        router = self.router(self.store())
        from services.article_intel_summary.catalog import discovered_model_id
        self.assertIn(discovered_model_id(S5_ALIAS), self.available(router))
        self.store().remove_model(S5_ALIAS, rev)
        router = self.router(self.store())
        self.assertEqual(self.available(router), set())
        self.assertNotEqual(router.catalog_document()["policy"]["status"], "LEGACY")

    def test_previously_written_null_policy_record_fails_closed(self):
        # A record written by an earlier build with policy=null must not mean "legacy".
        store = self.store()
        self.activate_with_new_key(store)
        raw = json.loads((self.root / "settings.json").read_text())
        raw["policy"] = None
        (self.root / "settings.json").write_text(json.dumps(raw))
        router = self.router(self.store())
        self.assertNotEqual(router.catalog_document()["policy"]["status"], "LEGACY")
        self.assertEqual(self.available(router), set())

    def test_restore_of_bootstrap_snapshot_keeps_managed_authority(self):
        store = self.store()
        rev = self.activate_with_new_key(store)["revision"]
        store.operator_restore_previous(rev)
        router = self.router(self.store())
        self.assertNotEqual(router.catalog_document()["policy"]["status"], "LEGACY")
        self.assertEqual(self.available(router), set())
        self.assertEqual(self.store().read()["key"], KEY)

    def test_concurrent_key_and_policy_change_one_conflicts(self):
        import threading
        store = self.store()
        rev = self.activate_with_new_key(store)["revision"]
        from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS
        self.gateway.infos = [model_info(S5_ALIAS, provider="ollama")]
        self.gateway.infos[0]["litellm_params"]["api_base"] = "http://ollama:11434"
        barrier, results = threading.Barrier(2), []

        def run(action):
            barrier.wait()
            try:
                action()
                results.append("ok")
            except ManagedSettingsError as error:
                results.append(error.code)

        threads = [
            threading.Thread(target=run, args=(lambda: self.store().save_key(KEY, rev),)),
            threading.Thread(target=run, args=(lambda: self.store().approve_model(S5_ALIAS, rev),)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), ["CONFIG_CONFLICT", "ok"], results)


if __name__ == "__main__":
    unittest.main()


class LegacyFixture:
    """LEGACY server: S5 (local) and Mistral Small (external, paid) aliases, no policy JSON."""

    def setUp(self):
        from services.article_intel_summary.tests.test_litellm_adapter import (
            MISTRAL_ALIAS, S5_ALIAS, approved_environment,
        )
        self.s5, self.mistral = S5_ALIAS, MISTRAL_ALIAS
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.boot = Path(self.tmp.name) / "key"
        self.boot.write_text(KEY + "\n", encoding="ascii")
        self.boot.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.boot),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
        })
        env.pop("NEWSFLUX_AI_MODEL_POLICY_JSON", None)
        self.env = env
        local = model_info(S5_ALIAS, provider="ollama")
        local["litellm_params"]["api_base"] = "http://ollama:11434"
        external = model_info(MISTRAL_ALIAS, provider="mistral", input_cost=0.15e-6, output_cost=0.6e-6)
        external["litellm_params"]["model"] = "mistral/mistral-small"
        self.gateway = FakeGateway(listed=(S5_ALIAS, MISTRAL_ALIAS), infos=[local, external])
        self.root = Path(self.tmp.name) / "managed"

    def store(self, **overrides):
        env = dict(self.env, **overrides)
        return ManagedSettingsStore(env, root=str(self.root), getter_factory=lambda *_: self.gateway)

    def files(self):
        return sorted(p.name for p in self.root.iterdir()) if self.root.exists() else []

    def migrate(self, store=None):
        store = store or self.store()
        preview = store.migration_preview()
        return store.migrate_legacy_policy(
            preview["revision"], preview["preview_token"], "MIGRATE-LEGACY-POLICY",
        )

    def revert_store(self, **overrides):
        # Reverting to legacy is only allowed with inference OFF (red-team P0-RT-01).
        return self.store(NEWSFLUX_AI_INFERENCE_ENABLED="false", **overrides)

    def snapshot(self):
        """Every byte under the store, for "refused and nothing changed" assertions."""
        if not self.root.exists():
            return {}
        return {
            str(p.relative_to(self.root)): (p.read_bytes() if p.is_file() else "dir")
            for p in sorted(self.root.rglob("*"))
        }


class LegacyMigrationTests(LegacyFixture, unittest.TestCase):
    """P0: LEGACY -> MANAGED only through an explicit, previewed, confirmed migration."""

    # -- implicit null -> empty is no longer reachable from a first write ------------------
    def test_status_reports_legacy_migration_required_without_writing(self):
        status = self.store().status()
        self.assertEqual(status["policy_source"], "legacy")
        self.assertTrue(status["migration_required"])
        self.assertEqual(self.files(), [])

    def test_first_key_save_in_legacy_requires_explicit_migration(self):
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().save_key(NEW_KEY, "bootstrap")
        self.assertEqual(caught.exception.code, "MIGRATION_REQUIRED")
        self.assertFalse((self.root / "settings.json").exists())
        self.assertFalse((self.root / "activated").exists())
        self.assertEqual(self.store().read()["key"], KEY)

    def test_first_approval_and_policy_save_in_legacy_require_migration(self):
        store = self.store()
        for call in (
            lambda: store.approve_model(self.s5, "bootstrap"),
            lambda: store.save_policy({"version": 1, "models": [
                policy_model("s5", self.s5, provider_identity="ollama@ollama:11434"),
            ]}, "bootstrap"),
        ):
            with self.assertRaises(ManagedSettingsError) as caught:
                call()
            self.assertEqual(caught.exception.code, "MIGRATION_REQUIRED")
        self.assertFalse((self.root / "settings.json").exists())

    def test_guard_is_inside_the_locked_save_not_only_in_public_methods(self):
        store = self.store()
        with self.assertRaises(ManagedSettingsError) as caught:
            store._save("bootstrap", key=NEW_KEY, change="key")
        self.assertEqual(caught.exception.code, "MIGRATION_REQUIRED")
        self.assertFalse((self.root / "settings.json").exists())

    def test_no_aliases_configured_means_nothing_to_migrate(self):
        store = self.store(NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="", NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS="")
        self.assertFalse(store.status()["migration_required"])
        store.save_key(NEW_KEY, "bootstrap")
        self.assertTrue(store.status()["managed"])

    def test_configured_env_policy_does_not_require_migration(self):
        store = self.store(NEWSFLUX_AI_MODEL_POLICY_JSON=json.dumps({"version": 1, "models": [
            policy_model("s5", self.s5, provider_identity="ollama@ollama:11434"),
        ]}))
        status = store.status()
        self.assertEqual(status["policy_source"], "environment")
        self.assertFalse(status["migration_required"])

    # -- preview ---------------------------------------------------------------------------
    def test_preview_is_read_only_and_verifies_each_legacy_model(self):
        preview = self.store(NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED="false").migration_preview()
        self.assertEqual(self.files(), [])
        self.assertEqual(preview["source"], "legacy")
        self.assertEqual(preview["revision"], "bootstrap")
        self.assertEqual(preview["gateway"], "ok")
        self.assertEqual(preview["result_policy_models"], 0)
        rows = {row["id"]: row for row in preview["models"]}
        self.assertEqual(set(rows), {"s5-free", "mistral-small"})
        s5, mistral = rows["s5-free"], rows["mistral-small"]
        self.assertEqual(s5["alias"], self.s5)
        self.assertTrue(s5["discovered"])
        self.assertEqual(s5["mode"], "chat")
        self.assertTrue(s5["identity_verified"])
        self.assertTrue(s5["local_ollama"])
        self.assertEqual(s5["price_class"], "free")
        self.assertEqual(s5["after_migration"], "not_approved")
        self.assertEqual(s5["consents_required"], [])
        self.assertEqual(mistral["price_class"], "paid")
        self.assertFalse(mistral["local_ollama"])
        self.assertEqual(mistral["consents_required"], ["external", "paid"])
        self.assertTrue(mistral["legacy_price_matches"])
        self.assertRegex(preview["preview_token"], r"^[0-9a-f]{64}$")
        rendered = json.dumps(preview)
        for forbidden in (KEY, "provider-secret", "internal-provider", "ollama:11434", "api_base"):
            self.assertNotIn(forbidden, rendered)

    def test_preview_marks_missing_and_unverified_legacy_models(self):
        self.gateway.listed = [self.s5]
        self.gateway.infos = [model_info(self.s5, provider="openai")]
        self.gateway.infos[0]["litellm_params"]["model"] = "unverifiable/" + self.s5
        rows = {row["id"]: row for row in self.store().migration_preview()["models"]}
        self.assertFalse(rows["mistral-small"]["discovered"])
        self.assertIn("not_discovered", rows["mistral-small"]["blockers"])
        self.assertFalse(rows["s5-free"]["identity_verified"])
        self.assertIn("identity_unverified", rows["s5-free"]["blockers"])

    def test_preview_with_gateway_failure_is_reported_and_blocks_migration(self):
        self.gateway.errors = {"/v1/models": RuntimeError("down")}
        store = self.store()
        preview = store.migration_preview()
        self.assertEqual(preview["gateway"], "unavailable")
        self.assertTrue(all(row["discovered"] is None for row in preview["models"]))
        with self.assertRaises(ManagedSettingsError) as caught:
            store.migrate_legacy_policy("bootstrap", preview["preview_token"], "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "KEY_UNVERIFIED")
        self.assertEqual(self.files(), [])

    def test_preview_after_migration_reports_managed_and_nothing_to_do(self):
        self.migrate()
        preview = self.store().migration_preview()
        self.assertEqual(preview["source"], "managed")
        self.assertEqual(preview["models"], [])
        self.assertIsNone(preview["preview_token"])

    # -- migrate ---------------------------------------------------------------------------
    def test_confirmed_migration_preserves_key_and_approves_nothing(self):
        before = self.boot.read_bytes()
        status = self.migrate()
        self.assertTrue(status["managed"])
        self.assertFalse(status["migration_required"])
        self.assertEqual(status["policy_models"], 0)
        record = self.store().read()
        self.assertEqual(record["key"], KEY)
        self.assertEqual(record["policy"], {"version": 1, "models": []})
        self.assertEqual(self.boot.read_bytes(), before)
        self.assertEqual(self.files(), ["activated", "migration.json", "previous.json", "settings.json", "write.lock"])
        for name in ("migration.json", "previous.json", "settings.json"):
            self.assertEqual((self.root / name).stat().st_mode & 0o777, 0o600)
        audit = json.loads((self.root / "migration.json").read_text())
        self.assertEqual(audit["from"], "legacy")
        self.assertEqual(audit["revision"], record["revision"])
        self.assertEqual([m["id"] for m in audit["legacy_models"]], ["s5-free", "mistral-small"])
        self.assertNotIn(KEY, (self.root / "migration.json").read_text())

    def test_migration_record_stays_readable_by_the_previous_record_schema(self):
        self.migrate()
        raw = json.loads((self.root / "settings.json").read_text())
        self.assertEqual(set(raw), {"version", "revision", "key", "policy"})

    def test_after_migration_legacy_models_are_unavailable_until_individually_approved(self):
        from services.article_intel_summary.catalog import create_model_router, discovered_model_id
        status = self.migrate()
        store = self.store()

        def available():
            router, adapter = create_model_router(
                self.env, discovery_getter=self.gateway, config_values_provider=store.effective_values,
            )
            owner = getattr(getattr(adapter, "primary", adapter), "_owner", None) or router.ledger_owner
            try:
                document = router.catalog_document()
            finally:
                if owner is not None:
                    owner.__exit__(None, None, None)  # one usage-ledger owner at a time
            self.assertNotEqual(document["policy"]["status"], "LEGACY")
            return {m["id"] for m in document["models"] if m["available"]}

        self.assertEqual(available(), set())
        store.approve_model(self.s5, status["revision"])
        self.assertEqual(available(), {discovered_model_id(self.s5)})

    def test_external_paid_legacy_model_still_needs_both_consents_after_migration(self):
        status = self.migrate()
        store = self.store()
        for paid, external in ((False, False), (True, False), (False, True)):
            with self.assertRaises(ManagedSettingsError):
                store.approve_model(self.mistral, status["revision"], allow_paid=paid, allow_external=external)
        self.assertEqual(store.status()["policy_models"], 0)

    def test_migration_requires_exact_confirmation(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        for confirm in ("", "yes", "migrate-legacy-policy", None, True):
            with self.assertRaises(ManagedSettingsError) as caught:
                store.migrate_legacy_policy("bootstrap", token, confirm)
            self.assertEqual(caught.exception.code, "MIGRATION_NOT_CONFIRMED")
        self.assertEqual(self.files(), [])

    def test_migration_rejects_stale_or_forged_preview(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        for forged in ("0" * 64, token[:-1] + ("0" if token[-1] != "0" else "1"), "", None):
            with self.assertRaises(ManagedSettingsError) as caught:
                store.migrate_legacy_policy("bootstrap", forged, "MIGRATE-LEGACY-POLICY")
            self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        # Gateway state changed after preview (price change): the old preview is stale.
        self.gateway.infos[1]["model_info"]["input_cost_per_token"] = 9e-6
        with self.assertRaises(ManagedSettingsError) as caught:
            store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.files(), [])

    def test_preview_from_one_process_is_not_accepted_after_restart(self):
        token = self.store().migration_preview()["preview_token"]
        import services.article_intel_summary.admin_settings as module
        with patch.object(module, "_PREVIEW_SECRET", os.urandom(32)):
            with self.assertRaises(ManagedSettingsError) as caught:
                self.store().migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")

    def test_migration_rejects_wrong_revision_and_disabled_writes(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        with self.assertRaises(ManagedSettingsError) as caught:
            store.migrate_legacy_policy("0" * 32, token, "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        disabled = self.store(NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED="false")
        with self.assertRaises(ManagedSettingsError) as caught:
            disabled.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "CHANGES_DISABLED")
        self.assertEqual(self.files(), [])

    def test_second_migration_is_a_conflict_not_a_rewrite(self):
        self.migrate()
        record = self.store().read()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().migrate_legacy_policy(record["revision"], "0" * 64, "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.store().read(), record)

    def test_concurrent_migrations_only_one_commits(self):
        import threading
        store = self.store()
        token = store.migration_preview()["preview_token"]
        barrier, results = threading.Barrier(2), []

        def run():
            barrier.wait()
            try:
                results.append(self.store().migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")["revision"])
            except ManagedSettingsError as error:
                results.append(error.code)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(r == "CONFIG_CONFLICT" for r in results), [False, True])

    def test_settings_write_failure_during_migration_leaves_bootstrap_authoritative(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        original = ManagedSettingsStore._write_bytes

        def failing(instance, path, data):
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return original(instance, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", failing):
            with self.assertRaises(ManagedSettingsError):
                store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.assertFalse((self.root / "activated").exists())
        self.assertFalse((self.root / "migration.json").exists())
        self.assertEqual(self.store().status()["policy_source"], "legacy")
        self.assertTrue(self.store().status()["migration_required"])

    def test_interrupted_migration_after_marker_fails_closed_not_to_legacy(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        original = ManagedSettingsStore._write_bytes

        class Crash(BaseException):
            pass

        def crashing(instance, path, data):
            if path.name == "settings.json":
                raise Crash()
            return original(instance, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", crashing):
            with self.assertRaises(Crash):
                store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        # Process died between the marker and the record: never silently legacy again.
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().status()
        self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")

    def test_invalid_migration_audit_record_is_not_trusted(self):
        self.migrate()
        (self.root / "migration.json").write_text("{not json")
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration(self.store().read()["revision"])
        self.assertEqual(caught.exception.code, "CONFIG_INVALID")
        self.assertTrue(self.store().status()["managed"])

    # -- operator rollback to the untouched legacy bootstrap ---------------------------------
    def test_operator_revert_restores_legacy_bootstrap_and_keeps_a_private_backup(self):
        status = self.migrate()
        result = self.revert_store().operator_revert_legacy_migration(status["revision"])
        self.assertFalse(result["managed"])
        self.assertEqual(result["policy_source"], "legacy")
        self.assertTrue(result["migration_required"])
        backups = [p for p in self.root.iterdir() if p.is_dir()]
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o700)
        self.assertEqual(
            sorted(p.name for p in backups[0].iterdir()),
            ["activated", "migration.json", "previous.json", "settings.json"],
        )
        self.assertEqual(self.store().read()["key"], KEY)

    def test_operator_revert_requires_exact_revision_and_unchanged_key(self):
        status = self.migrate()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration("0" * 32)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        changed = self.store().save_key(NEW_KEY, status["revision"])
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration(changed["revision"])
        # The state is no longer the one the migration created (red-team P0-RT-01).
        self.assertEqual(caught.exception.code, "ROLLBACK_STATE_CHANGED")
        self.assertTrue(self.store().status()["managed"])

    def test_operator_revert_refuses_when_not_a_migration(self):
        store = self.revert_store(
            NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="", NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS="",
        )
        status = store.save_key(NEW_KEY, "bootstrap")
        with self.assertRaises(ManagedSettingsError) as caught:
            store.operator_revert_legacy_migration(status["revision"])
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")

    def test_operator_revert_interrupted_midway_completes_idempotently(self):
        status = self.migrate()
        original = os.replace
        calls = []

        class Crash(BaseException):
            pass

        def crashing(src, dst, *args, **kwargs):
            calls.append(Path(src).name)
            if len(calls) == 2:
                raise Crash()
            return original(src, dst, *args, **kwargs)

        import services.article_intel_summary.admin_settings as module
        with patch.object(module.os, "replace", crashing):
            with self.assertRaises(Crash):
                self.revert_store().operator_revert_legacy_migration(status["revision"])
        # Interrupted: the record is gone but the marker remains -> fail closed, never legacy.
        with self.assertRaises(ManagedSettingsError):
            self.store().status()
        result = self.revert_store().operator_revert_legacy_migration(status["revision"])
        self.assertFalse(result["managed"])
        self.assertEqual(result["policy_source"], "legacy")
        # And a repeated completed revert is a conflict, not a second move.
        with self.assertRaises(ManagedSettingsError):
            self.revert_store().operator_revert_legacy_migration(status["revision"])

    def test_operator_revert_then_migrate_again(self):
        status = self.migrate()
        self.revert_store().operator_revert_legacy_migration(status["revision"])
        again = self.migrate()
        self.assertTrue(again["managed"])

    # -- HTTP surface --------------------------------------------------------------------------
    def client(self, *, admin=True, store=None):
        store = store or self.store()
        settings = AuthSettings(
            miniflux_base_url=MINIFLUX_BASE,
            allowed_web_origins=frozenset({WEB_ORIGIN}),
            admin_user_ids=frozenset({USER_ID}) if admin else frozenset(),
            admin_allowlist_state="configured" if admin else "empty",
        )
        auth = MinifluxAuthService(settings, http=AdminMiniflux())
        app = create_app(
            auth_service=auth,
            summary_service=SummaryService(DisabledInferenceAdapter()),
            admin_store=store,
        )
        return SyncASGIClient(app), store

    def test_http_preview_and_migrate_flow(self):
        client, _ = self.client()
        headers = request_headers()
        preview = client.get("/api/ai/v1/admin/litellm/migration-preview", headers=headers)
        self.assertEqual(preview.status_code, 200, preview.text)
        body = preview.json()
        self.assertNotIn(KEY, preview.text)
        blocked = client.post("/api/ai/v1/admin/litellm/save-key", headers=headers,
                              json={"key": NEW_KEY, "expected_revision": "bootstrap"})
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"]["code"], "MIGRATION_REQUIRED")
        unconfirmed = client.post("/api/ai/v1/admin/litellm/migrate-policy", headers=headers, json={
            "expected_revision": "bootstrap", "preview_token": body["preview_token"], "confirm": "yes",
        })
        self.assertEqual(unconfirmed.status_code, 422)
        self.assertEqual(self.files(), [])
        stale = client.post("/api/ai/v1/admin/litellm/migrate-policy", headers=headers, json={
            "expected_revision": "bootstrap", "preview_token": "0" * 64, "confirm": "MIGRATE-LEGACY-POLICY",
        })
        self.assertEqual(stale.status_code, 409)
        done = client.post("/api/ai/v1/admin/litellm/migrate-policy", headers=headers, json={
            "expected_revision": "bootstrap", "preview_token": body["preview_token"],
            "confirm": "MIGRATE-LEGACY-POLICY",
        })
        self.assertEqual(done.status_code, 200, done.text)
        self.assertTrue(done.json()["managed"])
        self.assertNotIn(KEY, done.text)

    def test_http_migration_denied_for_non_admin_and_extra_fields(self):
        client, _ = self.client(admin=False)
        headers = request_headers()
        self.assertEqual(client.get("/api/ai/v1/admin/litellm/migration-preview", headers=headers).status_code, 403)
        self.assertEqual(client.post("/api/ai/v1/admin/litellm/migrate-policy", headers=headers, json={
            "expected_revision": "bootstrap", "preview_token": "0" * 64, "confirm": "MIGRATE-LEGACY-POLICY",
        }).status_code, 403)
        admin, _ = self.client()
        extra = admin.post("/api/ai/v1/admin/litellm/migrate-policy", headers=headers, json={
            "expected_revision": "bootstrap", "preview_token": "0" * 64,
            "confirm": "MIGRATE-LEGACY-POLICY", "approve": ["s5-free"],
        })
        self.assertEqual(extra.status_code, 422)
        self.assertEqual(self.files(), [])


class MigrationRollbackRedTeamTests(LegacyFixture, unittest.TestCase):
    """P0-RT-01: rollback only for the untouched state the original migration created."""

    def refused(self, revision, code, store=None):
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            (store or self.revert_store()).operator_revert_legacy_migration(revision)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.snapshot(), before)  # no file, marker or policy change
        self.assertTrue(self.store().status()["managed"])
        self.assertFalse(self.store().status()["migration_required"])

    def test_revert_refused_after_a_later_model_approval(self):
        migrated = self.migrate()
        approved = self.store().approve_model(self.s5, migrated["revision"])
        self.refused(approved["revision"], "ROLLBACK_STATE_CHANGED")
        self.refused(migrated["revision"], "CONFIG_CONFLICT")
        self.assertEqual([m["alias"] for m in self.store().read()["policy"]["models"]], [self.s5])

    def test_revert_refused_after_approval_then_revocation(self):
        migrated = self.migrate()
        approved = self.store().approve_model(self.s5, migrated["revision"])
        revoked = self.store().remove_model(self.s5, approved["revision"])
        self.assertEqual(self.store().read()["policy"], {"version": 1, "models": []})
        self.refused(revoked["revision"], "ROLLBACK_STATE_CHANGED")

    def test_revert_refused_after_a_policy_save(self):
        migrated = self.migrate()
        saved = self.store().save_policy({"version": 1, "models": [
            policy_model("s5", self.s5, provider_identity="ollama@ollama:11434"),
        ]}, migrated["revision"])
        self.refused(saved["revision"], "ROLLBACK_STATE_CHANGED")

    def test_revert_refused_after_key_replaced_and_changed_back(self):
        migrated = self.migrate()
        replaced = self.store().save_key(NEW_KEY, migrated["revision"])
        back = self.store().save_key(KEY, replaced["revision"])
        record = self.store().read()
        self.assertEqual((record["key"], record["policy"]), (KEY, {"version": 1, "models": []}))
        # Same key and same empty policy as the migration, but not the migration's state.
        self.refused(back["revision"], "ROLLBACK_STATE_CHANGED")

    def test_revert_refused_after_operator_restore_of_the_migration_snapshot(self):
        migrated = self.migrate()
        approved = self.store().approve_model(self.s5, migrated["revision"])
        restored = self.store().operator_restore_previous(approved["revision"])
        self.refused(restored["revision"], "ROLLBACK_STATE_CHANGED")

    def test_revert_refused_with_inference_enabled(self):
        migrated = self.migrate()
        self.refused(migrated["revision"], "INFERENCE_ENABLED",
                     store=self.store(NEWSFLUX_AI_INFERENCE_ENABLED="true"))

    def test_revert_refused_when_legacy_aliases_changed_since_migration(self):
        migrated = self.migrate()
        self.refused(migrated["revision"], "ROLLBACK_STATE_CHANGED",
                     store=self.revert_store(NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="other-local-model"))

    def test_forged_audit_aligned_to_a_later_state_is_refused(self):
        import hashlib
        migrated = self.migrate()
        approved = self.store().approve_model(self.s5, migrated["revision"])
        audit_path = self.root / "migration.json"
        audit = json.loads(audit_path.read_text())
        audit["revision"] = approved["revision"]
        audit["record_sha256"] = hashlib.sha256((self.root / "settings.json").read_bytes()).hexdigest()
        audit_path.write_text(json.dumps(audit))
        self.refused(approved["revision"], "ROLLBACK_STATE_CHANGED")

    def test_audit_missing_digests_is_invalid(self):
        migrated = self.migrate()
        audit_path = self.root / "migration.json"
        audit = json.loads(audit_path.read_text())
        audit.pop("record_sha256")
        audit_path.write_text(json.dumps(audit))
        self.refused(migrated["revision"], "CONFIG_INVALID")

    def test_untouched_migration_still_reverts_and_resume_checks_the_manifest(self):
        migrated = self.migrate()
        audit = json.loads((self.root / "migration.json").read_text())
        self.assertEqual(audit["revision"], migrated["revision"])
        self.assertRegex(audit["record_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(audit["previous_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(audit["kind"], "migration")
        result = self.revert_store().operator_revert_legacy_migration(migrated["revision"])
        self.assertEqual(result["policy_source"], "legacy")

    def test_interrupted_revert_resume_refuses_a_tampered_backup_record(self):
        migrated = self.migrate()
        original = os.replace
        calls = []

        class Crash(BaseException):
            pass

        def crashing(src, dst, *args, **kwargs):
            calls.append(Path(src).name)
            if len(calls) == 2:
                raise Crash()
            return original(src, dst, *args, **kwargs)

        import services.article_intel_summary.admin_settings as module
        with patch.object(module.os, "replace", crashing):
            with self.assertRaises(Crash):
                self.revert_store().operator_revert_legacy_migration(migrated["revision"])
        moved = self.root / f"legacy-revert-{migrated['revision']}" / "settings.json"
        raw = json.loads(moved.read_text())
        raw["policy"] = {"version": 1, "models": [policy_model("x", self.s5)]}
        moved.write_text(json.dumps(raw))
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration(migrated["revision"])
        self.assertEqual(caught.exception.code, "ROLLBACK_STATE_CHANGED")
        self.assertTrue((self.root / "activated").exists())  # still fail-closed, not legacy


class LegacyKeyRecoveryTests(LegacyFixture, unittest.TestCase):
    """P1-RT-02: LEGACY with a revoked bootstrap key and a valid replacement key."""

    CONFIRM = "RECOVER-LEGACY-KEY-AND-MIGRATE"

    def setUp(self):
        super().setUp()
        self.revoked = {KEY}

        class Revoked:
            def __call__(self, path):
                raise RuntimeError("HTTP_401")  # what gateway_getter raises on a refused key

        self.revoked_getter = Revoked()

    def store(self, **overrides):
        env = dict(self.env, **overrides)

        def factory(base, peer, key):
            return self.revoked_getter if key in self.revoked else self.gateway

        return ManagedSettingsStore(env, root=str(self.root), getter_factory=factory)

    def recover(self, store=None, key=NEW_KEY):
        store = store or self.store()
        plan = store.operator_plan_legacy_key_recovery(key)
        return store.operator_recover_legacy_key("bootstrap", key, plan["plan_digest"], self.CONFIRM)

    def test_reproduces_the_deadlock_without_the_recovery_path(self):
        store = self.store()
        with self.assertRaises(ManagedSettingsError) as caught:
            store.save_key(NEW_KEY, "bootstrap")
        self.assertEqual(caught.exception.code, "MIGRATION_REQUIRED")
        preview = store.migration_preview()
        self.assertEqual(preview["gateway"], "unavailable")
        with self.assertRaises(ManagedSettingsError) as caught:
            store.migrate_legacy_policy("bootstrap", preview["preview_token"], "MIGRATE-LEGACY-POLICY")
        self.assertEqual(caught.exception.code, "KEY_UNVERIFIED")
        self.assertEqual(self.files(), [])

    def test_plan_is_read_only_works_with_writes_off_and_verifies_with_the_new_key(self):
        plan = self.store(NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED="false").operator_plan_legacy_key_recovery(NEW_KEY)
        self.assertEqual(self.files(), [])
        self.assertEqual(plan["current_key"], "rejected")  # gateway answered HTTP 401
        self.assertEqual(plan["candidate_key"], "verified")
        self.assertEqual(plan["gateway"], "ok")
        self.assertEqual({row["id"] for row in plan["models"]}, {"s5-free", "mistral-small"})
        self.assertRegex(plan["plan_digest"], r"^[0-9a-f]{64}$")
        rendered = json.dumps(plan)
        for forbidden in (KEY, NEW_KEY, "provider-secret", "internal-provider", "api_base"):
            self.assertNotIn(forbidden, rendered)

    def test_recovery_replaces_the_key_migrates_and_approves_nothing(self):
        before = self.boot.read_bytes()
        status = self.recover()
        self.assertTrue(status["managed"])
        self.assertEqual(status["policy_models"], 0)
        record = self.store().read()
        self.assertEqual((record["key"], record["policy"]), (NEW_KEY, {"version": 1, "models": []}))
        self.assertEqual(self.boot.read_bytes(), before)
        audit = json.loads((self.root / "migration.json").read_text())
        self.assertEqual(audit["kind"], "key_recovery")
        self.assertNotIn(NEW_KEY, (self.root / "migration.json").read_text())
        self.assertNotIn(KEY, (self.root / "migration.json").read_text())
        # External and paid legacy models still need explicit per-model consent.
        with self.assertRaises(ManagedSettingsError):
            self.store().approve_model(self.mistral, status["revision"])

    def test_recovery_works_writes_off_and_with_the_bootstrap_key_file_missing(self):
        self.boot.unlink()
        status = self.recover(self.store(NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED="false"))
        self.assertTrue(status["managed"])

    def test_recovery_is_not_a_rotation_tool_when_the_bootstrap_key_works(self):
        self.revoked = set()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().operator_plan_legacy_key_recovery(NEW_KEY)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().operator_recover_legacy_key("bootstrap", NEW_KEY, "0" * 64, self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.files(), [])

    def test_recovery_refuses_bad_candidates_confirmation_and_stale_plans(self):
        store = self.store()
        plan = store.operator_plan_legacy_key_recovery(NEW_KEY)["plan_digest"]
        cases = [
            (("bootstrap", "sk-synthetic-also-revoked-0000", plan, self.CONFIRM), "KEY_UNVERIFIED"),
            (("bootstrap", KEY, plan, self.CONFIRM), "CONFIG_CONFLICT"),
            (("bootstrap", "not-a-key", plan, self.CONFIRM), "KEY_INVALID"),
            (("bootstrap", NEW_KEY, plan, "yes"), "MIGRATION_NOT_CONFIRMED"),
            (("bootstrap", NEW_KEY, "0" * 64, self.CONFIRM), "CONFIG_CONFLICT"),
            (("0" * 32, NEW_KEY, plan, self.CONFIRM), "CONFIG_CONFLICT"),
        ]
        self.revoked.add("sk-synthetic-also-revoked-0000")
        for args, code in cases:
            with self.assertRaises(ManagedSettingsError) as caught:
                store.operator_recover_legacy_key(*args)
            self.assertEqual(caught.exception.code, code, args[1:])
        # Gateway changed after the plan: stale.
        self.gateway.infos[1]["model_info"]["input_cost_per_token"] = 9e-6
        with self.assertRaises(ManagedSettingsError) as caught:
            store.operator_recover_legacy_key("bootstrap", NEW_KEY, plan, self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.files(), [])

    def test_recovery_only_from_an_unactivated_legacy_source(self):
        env_policy = json.dumps({"version": 1, "models": [
            policy_model("s5", self.s5, provider_identity="ollama@ollama:11434"),
        ]})
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store(NEWSFLUX_AI_MODEL_POLICY_JSON=env_policy).operator_plan_legacy_key_recovery(NEW_KEY)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.recover()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().operator_plan_legacy_key_recovery("sk-synthetic-third-key-000000")
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")

    def test_revoked_key_is_never_reinstated_by_restore_or_revert(self):
        status = self.recover()
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().operator_restore_previous(status["revision"])
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration(status["revision"])
        self.assertEqual(caught.exception.code, "ROLLBACK_STATE_CHANGED")
        self.assertEqual(self.snapshot(), before)

    def test_recovery_has_no_http_route(self):
        from services.article_intel_summary.admin_api import ACTION_NAMES
        self.assertFalse({name for name in ACTION_NAMES if "recover" in name})


class InterruptedActivationRecoveryTests(LegacyFixture, unittest.TestCase):
    """P2: crash after the activated marker and before settings.json is committed."""

    CONFIRM = "RECOVER-INTERRUPTED-ACTIVATION"

    def crash_during(self, call, *, at="settings.json"):
        original = ManagedSettingsStore._write_bytes

        class Crash(BaseException):
            pass

        def crashing(instance, path, data):
            if path.name == at:
                raise Crash()
            return original(instance, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", crashing):
            with self.assertRaises(Crash):
                call()

    def crash_migration(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        self.crash_during(lambda: store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY"))

    def test_interrupted_first_activation_fails_closed_and_leaves_an_intent_journal(self):
        self.crash_migration()
        self.assertIn("activation.pending", self.files())
        self.assertNotIn("settings.json", self.files())
        for call in (self.store().status, self.store().read, lambda: self.store().effective_values()):
            with self.assertRaises(ManagedSettingsError) as caught:
                call()
            self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")

    def test_operator_recovery_returns_to_bootstrap_with_an_auditable_backup(self):
        self.crash_migration()
        before = self.snapshot()
        result = self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "rolled_back_to_bootstrap")
        self.assertFalse(result["status"]["managed"])
        self.assertEqual(result["status"]["policy_source"], "legacy")
        self.assertTrue(result["status"]["migration_required"])
        backups = [p for p in self.root.iterdir() if p.is_dir()]
        self.assertEqual(len(backups), 1)
        self.assertTrue(backups[0].name.startswith("interrupted-activation-"))
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o700)
        audit = json.loads((backups[0] / "recovery.json").read_text())
        import hashlib
        moved = {item["name"]: item["sha256"] for item in audit["files"]}
        self.assertIn("activated", moved)
        self.assertIn("activation.pending", moved)
        for name, digest in moved.items():
            self.assertEqual(hashlib.sha256(before[name]).hexdigest(), digest)
            self.assertEqual((backups[0] / name).read_bytes(), before[name])
        self.assertNotIn(KEY, (backups[0] / "recovery.json").read_text())
        # Readback: plain legacy bootstrap, and a fresh migration works again.
        self.assertTrue(self.migrate()["managed"])

    def test_recovery_of_an_interrupted_key_activation_never_keeps_the_new_key(self):
        store = self.revert_store(
            NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="", NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS="",
        )
        self.crash_during(lambda: store.save_key(NEW_KEY, "bootstrap"))
        result = store.operator_recover_interrupted_activation(self.CONFIRM)
        self.assertFalse(result["status"]["managed"])
        self.assertEqual(store.read()["key"], KEY)

    def test_temporary_partial_writes_are_moved_not_trusted(self):
        self.crash_migration()
        partial = self.root / ".new-partial"
        partial.write_bytes(b'{"version":1')
        partial.chmod(0o600)
        result = self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        backup = next(p for p in self.root.iterdir() if p.is_dir())
        self.assertTrue((backup / ".new-partial").exists())
        self.assertIn(".new-partial", [item["name"] for item in result["moved"]])

    def test_deleted_record_after_completed_activation_is_not_an_interruption(self):
        self.migrate()
        (self.root / "settings.json").unlink()
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.snapshot(), before)

    def test_crash_after_commit_before_journal_removal_rolls_forward_explicitly(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        original = os.unlink

        class Crash(BaseException):
            pass

        def crashing(path, *args, **kwargs):
            if Path(path).name == "activation.pending":
                raise Crash()
            return original(path, *args, **kwargs)

        import services.article_intel_summary.admin_settings as module
        with patch.object(module.os, "unlink", crashing):
            with self.assertRaises(Crash):
                store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        # The record was committed but the transaction did not finish: fail closed (R2) until the
        # operator rolls it forward; roll-forward stays MANAGED and is allowed with inference ON.
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().status()
        self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")
        result = self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")
        self.assertNotIn("activation.pending", self.files())
        self.assertTrue(result["status"]["managed"])

    def test_recovery_requires_confirmation_and_is_not_repeatable(self):
        self.crash_migration()
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_recover_interrupted_activation("yes")
        self.assertEqual(caught.exception.code, "MIGRATION_NOT_CONFIRMED")
        self.assertEqual(self.snapshot(), before)
        self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")

    def test_tampered_intent_journal_is_invalid(self):
        self.crash_migration()
        (self.root / "activation.pending").write_text("{}")
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_INVALID")
        self.assertEqual(self.snapshot(), before)

    def test_interrupted_recovery_resumes_and_stays_fail_closed_meanwhile(self):
        self.crash_migration()
        original = os.replace
        calls = []

        class Crash(BaseException):
            pass

        def crashing(src, dst, *args, **kwargs):
            calls.append(Path(src).name)
            if Path(src).name == "activation.pending":
                raise Crash()
            return original(src, dst, *args, **kwargs)

        import services.article_intel_summary.admin_settings as module
        with patch.object(module.os, "replace", crashing):
            with self.assertRaises(Crash):
                self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        with self.assertRaises(ManagedSettingsError):
            self.store().status()  # marker still present: fail closed, no silent bootstrap
        result = self.revert_store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "rolled_back_to_bootstrap")
        self.assertFalse(self.store().status()["managed"])


class FirstActivationCommitIntegrityTests(LegacyFixture, unittest.TestCase):
    """R2 P0: every failure point of a first activation ends clean or fail-closed recoverable."""

    CONFIRM = "RECOVER-INTERRUPTED-ACTIVATION"
    FILES = ("previous.json", "activation.pending", "activated", "migration.json", "settings.json")

    def fail_at(self, call, name, phase, *, error=None):
        """phase before_replace: nothing written; after_replace: the file is in place and then the
        call fails (directory fsync error after os.replace)."""
        original = ManagedSettingsStore._write_bytes
        failure = error or ManagedSettingsError("CONFIG_UNAVAILABLE")

        def faulty(instance, path, data):
            if path.name == name and phase == "before_replace":
                raise failure
            original(instance, path, data)
            if path.name == name and phase == "after_replace":
                raise failure

        with patch.object(ManagedSettingsStore, "_write_bytes", faulty):
            with self.assertRaises(BaseException):
                call()

    def migration_call(self):
        store = self.store()
        token = store.migration_preview()["preview_token"]
        return lambda: store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")

    def assert_terminal(self):
        """Clean (bootstrap, no marker/journal/record) or fail-closed with a journal; never a
        record without its marker, never a silent legacy fallback with a committed record."""
        names = set(self.files())
        if "settings.json" in names:
            self.assertIn("activated", names)
            self.assertIn("activation.pending", names)
        if "activated" in names:
            self.assertIn("activation.pending", names)
        if "activation.pending" in names:
            with self.assertRaises(ManagedSettingsError) as caught:
                self.store().status()
            self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")
            return "fail_closed"
        self.assertFalse(names & {"activated", "migration.json", "settings.json"})
        status = self.store().status()
        self.assertFalse(status["managed"])
        self.assertTrue(status["migration_required"])
        return "clean"

    def test_every_write_failure_point_is_terminal_and_recoverable(self):
        for name in self.FILES:
            for phase in ("before_replace", "after_replace"):
                with self.subTest(name=name, phase=phase):
                    if self.root.exists():
                        import shutil
                        shutil.rmtree(self.root)
                    self.fail_at(self.migration_call(), name, phase)
                    outcome = self.assert_terminal()
                    if outcome == "fail_closed":
                        committed = (self.root / "settings.json").exists()
                        store = self.store() if committed else self.revert_store()
                        result = store.operator_recover_interrupted_activation(self.CONFIRM)
                        expected = "completed_committed_activation" if committed else "rolled_back_to_bootstrap"
                        self.assertEqual(result["outcome"], expected)
                        self.assertEqual(result["status"]["managed"], committed)
                        if committed:
                            self.assertEqual(self.store().read()["policy"], {"version": 1, "models": []})

    def test_record_renamed_then_fsync_error_is_never_record_without_marker(self):
        self.fail_at(self.migration_call(), "settings.json", "after_replace")
        names = set(self.files())
        self.assertTrue({"settings.json", "activated", "activation.pending", "migration.json",
                         "previous.json"} <= names)
        self.assertEqual(self.assert_terminal(), "fail_closed")
        result = self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")
        self.assertTrue(result["journal_removed"])
        self.assertEqual(result["data_files_deleted"], 0)
        self.assertTrue(self.store().status()["managed"])

    def test_crash_after_record_rename_rolls_forward_not_back(self):
        class Crash(BaseException):
            pass

        self.fail_at(self.migration_call(), "settings.json", "after_replace", error=Crash())
        self.assertEqual(self.assert_terminal(), "fail_closed")
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.revert_store().operator_revert_legacy_migration(
                json.loads((self.root / "activation.pending").read_text())["revision"])
        self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")  # open journal: fail closed
        self.assertEqual(self.snapshot(), before)
        result = self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")

    def test_readback_failure_does_not_declare_success(self):
        with patch.object(ManagedSettingsStore, "_commit_readback",
                          side_effect=ManagedSettingsError("CONFIG_UNAVAILABLE")):
            with self.assertRaises(ManagedSettingsError):
                self.migration_call()()
        self.assertEqual(self.assert_terminal(), "fail_closed")
        self.assertEqual(self.store().operator_recover_interrupted_activation(self.CONFIRM)["outcome"],
                         "completed_committed_activation")

    def test_journal_cleanup_failure_does_not_declare_success(self):
        import services.article_intel_summary.admin_settings as module
        original = os.unlink

        def failing(path, *args, **kwargs):
            if Path(path).name == "activation.pending":
                raise OSError("EIO")
            return original(path, *args, **kwargs)

        with patch.object(module.os, "unlink", failing):
            with self.assertRaises(ManagedSettingsError):
                self.migration_call()()
        self.assertEqual(self.assert_terminal(), "fail_closed")
        self.assertEqual(self.store().operator_recover_interrupted_activation(self.CONFIRM)["outcome"],
                         "completed_committed_activation")

    def post_unlink_fsync_failure(self, *, restore_fails=False):
        """Directory fsync fails once the journal has been unlinked (finalization window).
        restore_fails: the journal restoration write also fails before its rename."""
        import services.article_intel_summary.admin_settings as module
        original_fsync = ManagedSettingsStore._fsync_dir
        original_atomic = ManagedSettingsStore._write_atomic
        real_unlink = os.unlink
        state = {"unlinked": False}

        def tracking_unlink(path, *args, **kwargs):
            if Path(path).name == "activation.pending":
                state["unlinked"] = True
            return real_unlink(path, *args, **kwargs)

        def fsync(directory):
            if state["unlinked"]:
                raise OSError("EIO")
            return original_fsync(directory)

        def atomic(instance, directory, name, data, *, prefix):
            if restore_fails and state["unlinked"] and name == "activation.pending":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return original_atomic(instance, directory, name, data, prefix=prefix)

        return (patch.object(module.os, "unlink", tracking_unlink),
                patch.object(ManagedSettingsStore, "_fsync_dir", staticmethod(fsync)),
                patch.object(ManagedSettingsStore, "_write_atomic", atomic))

    def test_post_unlink_fsync_failure_restores_the_journal_and_fails_closed(self):
        unlink, fsync, atomic = self.post_unlink_fsync_failure()
        call = self.migration_call()
        with unlink, fsync, atomic:
            with self.assertRaises(ManagedSettingsError) as caught:
                call()
        self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")
        # Never "complete": the journal is back, every read fails closed, roll-forward recovers.
        self.assertIn("activation.pending", self.files())
        self.assertEqual(self.assert_terminal(), "fail_closed")
        result = self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")
        self.assertTrue(self.store().status()["managed"])

    def test_double_fault_in_finalization_is_reported_as_indeterminate(self):
        unlink, fsync, atomic = self.post_unlink_fsync_failure(restore_fails=True)
        call = self.migration_call()
        with unlink, fsync, atomic:
            with self.assertRaises(ManagedSettingsError) as caught:
                call()
        # The journal could not be restored: the caller is told the commit is indeterminate, never
        # that it failed cleanly or succeeded. The record itself was durably synced before unlink.
        self.assertEqual(caught.exception.code, "COMMIT_INDETERMINATE")

    def test_record_is_synced_before_the_journal_is_removed(self):
        import services.article_intel_summary.admin_settings as module
        events = []
        original_fsync = ManagedSettingsStore._fsync_dir
        real_unlink = os.unlink

        def fsync(directory):
            events.append("fsync")
            return original_fsync(directory)

        def unlink(path, *args, **kwargs):
            if Path(path).name == "activation.pending":
                events.append("unlink_journal")
            return real_unlink(path, *args, **kwargs)

        with patch.object(ManagedSettingsStore, "_fsync_dir", staticmethod(fsync)), \
                patch.object(module.os, "unlink", unlink):
            self.migration_call()()
        index = events.index("unlink_journal")
        self.assertEqual(events[index - 1], "fsync")  # explicit sync right before the commit point
        self.assertEqual(events[index + 1], "fsync")

    def test_key_only_first_activation_post_rename_failure_is_recoverable(self):
        store = self.store(NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="", NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS="")
        self.fail_at(lambda: store.save_key(NEW_KEY, "bootstrap"), "settings.json", "after_replace")
        self.assertIn("activation.pending", self.files())
        with self.assertRaises(ManagedSettingsError):
            store.status()
        result = store.operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")
        self.assertEqual(store.read()["key"], NEW_KEY)


class InterruptedRecoveryManifestTests(LegacyFixture, unittest.TestCase):
    """R2 P1: recovery manifest, per-file digests and sizes, resume and receipt integrity."""

    CONFIRM = "RECOVER-INTERRUPTED-ACTIVATION"

    def setUp(self):
        super().setUp()
        store = self.store()
        token = store.migration_preview()["preview_token"]
        original = ManagedSettingsStore._write_bytes

        class Crash(BaseException):
            pass

        def crashing(instance, path, data):
            if path.name == "settings.json":
                raise Crash()
            return original(instance, path, data)

        with patch.object(ManagedSettingsStore, "_write_bytes", crashing):
            with self.assertRaises(Crash):
                store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.revision = json.loads((self.root / "activation.pending").read_text())["revision"]
        self.backup = self.root / f"interrupted-activation-{self.revision}"

    def recover(self, **overrides):
        return self.revert_store(**overrides).operator_recover_interrupted_activation(self.CONFIRM)

    def crash_on_move(self, nth):
        import services.article_intel_summary.admin_settings as module
        original = os.replace
        calls = {"n": 0}

        class Crash(BaseException):
            pass

        def crashing(src, dst, *args, **kwargs):
            if Path(dst).parent == self.backup and not Path(src).name.startswith(".recovery-"):
                calls["n"] += 1
                if calls["n"] == nth:
                    raise Crash()
            return original(src, dst, *args, **kwargs)

        with patch.object(module.os, "replace", crashing):
            with self.assertRaises(Crash):
                self.recover()

    def refused(self, code, **overrides):
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.recover(**overrides)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.backup / "recovery.done").exists())

    def test_inference_on_refuses_the_rollback_to_legacy_without_mutation(self):
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.store().operator_recover_interrupted_activation(self.CONFIRM)  # fixture: inference ON
        self.assertEqual(caught.exception.code, "INFERENCE_ENABLED")
        self.assertEqual(self.snapshot(), before)

    def test_rollback_receipt_is_written_last_and_proves_every_file(self):
        before = self.snapshot()
        result = self.recover()
        self.assertEqual(result["outcome"], "rolled_back_to_bootstrap")
        self.assertFalse(result["journal_removed"])  # journal preserved in the backup
        self.assertEqual(result["data_files_deleted"], 0)
        manifest = json.loads((self.backup / "recovery.json").read_text())
        done = json.loads((self.backup / "recovery.done").read_text())
        import hashlib
        self.assertEqual(done["manifest_sha256"],
                         hashlib.sha256((self.backup / "recovery.json").read_bytes()).hexdigest())
        self.assertEqual(done["files_verified"], len(manifest["files"]))
        for item in manifest["files"]:
            data = (self.backup / item["name"]).read_bytes()
            self.assertEqual((hashlib.sha256(data).hexdigest(), len(data)), (item["sha256"], item["bytes"]))
            self.assertEqual(before[item["name"]], data)
        self.assertFalse(self.store().status()["managed"])
        self.assertEqual(self.store().read()["policy"], None)  # no model authorization created

    def test_root_file_changed_after_the_crash_is_refused(self):
        (self.root / "previous.json").write_text(json.dumps({"version": 1, "revision": "bootstrap",
                                                              "key": NEW_KEY, "policy": None}))
        self.refused("RECOVERY_INTEGRITY_FAILED")

    def test_unexpected_content_in_the_store_is_refused(self):
        stray = self.root / "settings.json.bak"
        stray.write_bytes(b"x")
        stray.chmod(0o600)
        self.refused("CONFIG_INVALID")

    def test_backup_altered_after_a_crash_never_completes(self):
        self.crash_on_move(3)
        extra = self.backup / "extra.json"
        extra.write_bytes(b"{}")
        extra.chmod(0o600)
        self.refused("RECOVERY_INTEGRITY_FAILED")

    def test_already_moved_file_with_a_different_digest_never_completes(self):
        self.crash_on_move(2)
        manifest = json.loads((self.backup / "recovery.json").read_text())
        moved = next(item["name"] for item in manifest["files"] if (self.backup / item["name"]).exists())
        (self.backup / moved).write_bytes(b"tampered")
        self.refused("RECOVERY_INTEGRITY_FAILED")

    def test_file_missing_during_resume_never_completes(self):
        self.crash_on_move(2)
        manifest = json.loads((self.backup / "recovery.json").read_text())
        moved = next(item["name"] for item in manifest["files"] if (self.backup / item["name"]).exists())
        (self.backup / moved).unlink()
        self.refused("RECOVERY_INTEGRITY_FAILED")

    def test_manifest_with_a_wrong_size_never_completes(self):
        self.crash_on_move(2)
        path = self.backup / "recovery.json"
        manifest = json.loads(path.read_text())
        manifest["files"][0]["bytes"] += 1
        path.write_text(json.dumps(manifest))
        self.refused("RECOVERY_INTEGRITY_FAILED")

    def test_manifest_with_a_malicious_path_is_rejected(self):
        self.crash_on_move(2)
        path = self.backup / "recovery.json"
        manifest = json.loads(path.read_text())
        for name in ("../settings.json", "a/b", "/etc/passwd", "..", ".", "", "x\x00y"):
            manifest["files"][-1]["name"] = name
            path.write_text(json.dumps(manifest))
            self.refused("CONFIG_INVALID")
        self.assertFalse((self.root.parent / "settings.json").exists())

    def test_manifest_schema_version_and_revision_are_strict(self):
        self.crash_on_move(2)
        path = self.backup / "recovery.json"
        good = json.loads(path.read_text())
        for mutate in (
            lambda m: m.update(version=2),
            lambda m: m.update(revision="0" * 32),
            lambda m: m.update(extra=True),
            lambda m: m["files"].append(dict(m["files"][0])),
            lambda m: m["files"][0].update(sha256="xyz"),
            lambda m: m["files"][0].update(bytes=-1),
            lambda m: m.pop("journal_sha256"),
        ):
            manifest = json.loads(json.dumps(good))
            mutate(manifest)
            path.write_text(json.dumps(manifest))
            self.refused("CONFIG_INVALID")

    def test_crash_while_writing_the_manifest_restarts_cleanly(self):
        original = ManagedSettingsStore._write_atomic

        class Crash(BaseException):
            pass

        def crashing(instance, directory, name, data, *, prefix):
            if name == "recovery.json":
                raise Crash()
            return original(instance, directory, name, data, prefix=prefix)

        before = self.snapshot()
        with patch.object(ManagedSettingsStore, "_write_atomic", crashing):
            with self.assertRaises(Crash):
                self.recover()
        # Nothing was moved before the manifest existed.
        for name in ("activated", "activation.pending", "previous.json", "migration.json"):
            self.assertEqual((self.root / name).read_bytes(), before[name])
        self.assertEqual(self.recover()["outcome"], "rolled_back_to_bootstrap")

    def test_second_interruption_during_resume_then_completion(self):
        self.crash_on_move(2)
        self.crash_on_move(1)
        result = self.recover()
        self.assertEqual(result["outcome"], "rolled_back_to_bootstrap")
        self.assertTrue((self.backup / "recovery.done").exists())

    def test_completed_recovery_cannot_be_repeated(self):
        self.recover()
        before = self.snapshot()
        with self.assertRaises(ManagedSettingsError) as caught:
            self.recover()
        self.assertEqual(caught.exception.code, "CONFIG_CONFLICT")
        self.assertEqual(self.snapshot(), before)

    def test_readback_failure_writes_no_completion_receipt(self):
        with patch.object(ManagedSettingsStore, "_recovery_readback",
                          side_effect=ManagedSettingsError("CONFIG_UNAVAILABLE")):
            with self.assertRaises(ManagedSettingsError):
                self.recover()
        self.assertFalse((self.backup / "recovery.done").exists())

    def test_concurrent_recoveries_only_one_completes(self):
        import threading
        barrier, results = threading.Barrier(2), []

        def run():
            barrier.wait()
            try:
                results.append(self.recover()["outcome"])
            except ManagedSettingsError as error:
                results.append(error.code)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), ["CONFIG_CONFLICT", "rolled_back_to_bootstrap"])
        self.assertTrue((self.backup / "recovery.done").exists())
        self.assertFalse(self.store().status()["managed"])


    def test_unexpected_root_entry_after_staging_stops_the_resume(self):
        self.crash_on_move(2)
        for name in ("unexpected.txt", ".new-injected", "settings.json.bak"):
            with self.subTest(name=name):
                stray = self.root / name
                stray.write_bytes(b"x")
                stray.chmod(0o600)
                self.refused("RECOVERY_INTEGRITY_FAILED")
                stray.unlink()
        self.assertEqual(self.recover()["outcome"], "rolled_back_to_bootstrap")

    def test_unexpected_root_entry_before_completion_writes_no_receipt(self):
        original = ManagedSettingsStore._recovery_readback

        def inject_then_readback(instance, manifest):
            stray = self.root / "unexpected.txt"
            stray.write_bytes(b"x")
            stray.chmod(0o600)
            return original(instance, manifest)

        with patch.object(ManagedSettingsStore, "_recovery_readback", inject_then_readback):
            with self.assertRaises(ManagedSettingsError) as caught:
                self.recover()
        self.assertEqual(caught.exception.code, "RECOVERY_INTEGRITY_FAILED")
        self.assertFalse((self.backup / "recovery.done").exists())

    def test_unexpected_directory_in_root_after_staging_is_refused(self):
        self.crash_on_move(2)
        (self.root / "not-a-backup").mkdir(mode=0o700)
        self.refused("RECOVERY_INTEGRITY_FAILED")


class BootstrapKeyClassificationTests(LegacyFixture, unittest.TestCase):
    """R2 P2: only an authentication refusal (or a missing key) proves the bootstrap key unusable."""

    def store_with(self, error):
        def factory(base, peer, key):
            if key == KEY:
                def broken(path):
                    raise error
                return broken
            return self.gateway

        return ManagedSettingsStore(self.env, root=str(self.root), getter_factory=factory)

    def test_inconclusive_failures_do_not_unlock_key_recovery(self):
        import httpx
        for error in (RuntimeError("HTTP_503"), RuntimeError("HTTP_500"), RuntimeError("HTTP_429"),
                      httpx.ConnectError("down"), TimeoutError("slow"), ValueError("bad json")):
            with self.subTest(error=repr(error)):
                with self.assertRaises(ManagedSettingsError) as caught:
                    self.store_with(error).operator_plan_legacy_key_recovery(NEW_KEY)
                self.assertEqual(caught.exception.code, "KEY_STATE_INCONCLUSIVE")
                with self.assertRaises(ManagedSettingsError) as caught:
                    self.store_with(error).operator_recover_legacy_key(
                        "bootstrap", NEW_KEY, "0" * 64, "RECOVER-LEGACY-KEY-AND-MIGRATE")
                self.assertEqual(caught.exception.code, "KEY_STATE_INCONCLUSIVE")
        self.assertEqual(self.files(), [])

    def test_authentication_refusal_unlocks_the_supervised_plan(self):
        for status in ("HTTP_401", "HTTP_403"):
            with self.subTest(status=status):
                plan = self.store_with(RuntimeError(status)).operator_plan_legacy_key_recovery(NEW_KEY)
                self.assertEqual(plan["current_key"], "rejected")

    def test_missing_bootstrap_key_is_classified_absent(self):
        self.boot.unlink()
        plan = self.store_with(RuntimeError("HTTP_503")).operator_plan_legacy_key_recovery(NEW_KEY)
        self.assertEqual(plan["current_key"], "absent")


class RollForwardFinalizationTests(LegacyFixture, unittest.TestCase):
    """R3: the roll-forward commit point has the same crash-consistent finalization."""

    CONFIRM = "RECOVER-INTERRUPTED-ACTIVATION"

    def setUp(self):
        super().setUp()
        store = self.store()
        token = store.migration_preview()["preview_token"]
        original = ManagedSettingsStore._write_bytes

        def faulty(instance, path, data):
            original(instance, path, data)
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")

        with patch.object(ManagedSettingsStore, "_write_bytes", faulty):
            with self.assertRaises(ManagedSettingsError):
                store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")
        self.assertIn("activation.pending", self.files())

    def test_post_unlink_fsync_failure_in_roll_forward_restores_the_journal(self):
        unlink, fsync, atomic = FirstActivationCommitIntegrityTests.post_unlink_fsync_failure(self)
        with unlink, fsync, atomic:
            with self.assertRaises(ManagedSettingsError) as caught:
                self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(caught.exception.code, "CONFIG_UNAVAILABLE")
        self.assertIn("activation.pending", self.files())
        with self.assertRaises(ManagedSettingsError):
            self.store().status()
        result = self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(result["outcome"], "completed_committed_activation")

    def test_double_fault_in_roll_forward_is_indeterminate(self):
        unlink, fsync, atomic = FirstActivationCommitIntegrityTests.post_unlink_fsync_failure(
            self, restore_fails=True)
        with unlink, fsync, atomic:
            with self.assertRaises(ManagedSettingsError) as caught:
                self.store().operator_recover_interrupted_activation(self.CONFIRM)
        self.assertEqual(caught.exception.code, "COMMIT_INDETERMINATE")

    def test_concurrent_roll_forwards_only_one_completes(self):
        import threading
        barrier, results = threading.Barrier(2), []

        def run():
            barrier.wait()
            try:
                results.append(self.store().operator_recover_interrupted_activation(self.CONFIRM)["outcome"])
            except ManagedSettingsError as error:
                results.append(error.code)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), ["CONFIG_CONFLICT", "completed_committed_activation"])
        self.assertTrue(self.store().status()["managed"])
