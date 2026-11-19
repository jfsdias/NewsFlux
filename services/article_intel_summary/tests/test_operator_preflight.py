"""Read-only operator preflight: classifications only, no secrets, no writes."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from services.article_intel_summary.admin_settings import ManagedSettingsError, ManagedSettingsStore
from services.article_intel_summary.operator_preflight_ai_settings import run
from services.article_intel_summary.tests.test_dynamic_catalog import FakeGateway, model_info

KEY = "sk-synthetic-preflight-key-abcdefghij"


class OperatorPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.key = Path(self.tmp.name) / "key"
        self.key.write_text(KEY, encoding="ascii")
        self.key.chmod(0o600)
        self.root = Path(self.tmp.name) / "managed"
        self.gateway = FakeGateway(listed=("m1",), infos=[model_info("m1")])
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.key),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_SETTINGS_DIR": str(self.root),
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
        }

    def factory(self, env):
        return ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)

    def test_bootstrap_ready_pass_without_writes_or_secret(self):
        code, lines = run(self.env, check_gateway=True, store_factory=self.factory)
        text = "\n".join(lines)
        self.assertEqual(code, 0, text)
        self.assertIn("KEY_SOURCE=BOOTSTRAP", lines)
        self.assertIn("MANAGED_DIR=ABSENT_CREATABLE", lines)
        self.assertIn("GATEWAY_DISCOVERY=PASS_MODELS_1", lines)
        self.assertIn("INFERENCE_ENABLED=OFF", lines)
        self.assertNotIn(KEY, text)
        self.assertNotIn(str(self.root), text)
        self.assertFalse(self.root.exists())

    def test_unsafe_dir_mode_is_hold(self):
        self.root.mkdir(mode=0o755)
        os.chmod(self.root, 0o755)
        code, lines = run(self.env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("MANAGED_DIR=UNSAFE_MODE", lines)
        self.assertIn("PREFLIGHT=HOLD", lines)

    def test_marker_without_record_is_hold_not_bootstrap(self):
        self.root.mkdir(mode=0o700)
        marker = self.root / "activated"
        marker.write_bytes(b"v1\n")
        marker.chmod(0o600)
        code, lines = run(self.env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("STORE=HOLD_CONFIG_UNAVAILABLE", lines)

    def test_missing_key_and_gateway_failure_are_hold(self):
        env = {**self.env, "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(Path(self.tmp.name) / "none")}
        code, lines = run(env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("BOOTSTRAP_KEY_READABLE=NO", lines)
        self.assertIn("KEY_CONFIGURED=NO", lines)
        self.gateway.errors["/v1/models"] = RuntimeError(KEY)
        code, lines = run(self.env, check_gateway=True, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("GATEWAY_DISCOVERY=HOLD_KEY_UNVERIFIED", lines)
        self.assertNotIn(KEY, "\n".join(lines))

    def test_policy_source_and_pending_legacy_migration_are_reported(self):
        env = {**self.env, "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "m1"}
        code, lines = run(env, store_factory=self.factory)
        self.assertEqual(code, 0, lines)
        self.assertIn("POLICY_SOURCE=LEGACY", lines)
        self.assertIn("LEGACY_MIGRATION_REQUIRED=YES", lines)
        code, lines = run(self.env, store_factory=self.factory)
        self.assertIn("LEGACY_MIGRATION_REQUIRED=NO", lines)


class OperatorRevertLegacyMigrationCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text(KEY, encoding="ascii")
        key.chmod(0o600)
        self.root = Path(self.tmp.name) / "managed"
        local = model_info("m1", provider="ollama")
        local["litellm_params"]["api_base"] = "http://ollama:11434"
        self.gateway = FakeGateway(listed=("m1",), infos=[local])
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_SETTINGS_DIR": str(self.root),
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
            "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "m1",
        }

    def factory(self, env=None):
        return ManagedSettingsStore(env or self.env, getter_factory=lambda *_: self.gateway)

    def run_cli(self, *argv, env=None):
        import contextlib
        import io
        from services.article_intel_summary import operator_revert_legacy_migration_ai_settings as cli
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cli.main(list(argv), store_factory=lambda: self.factory(env))
        return code, out.getvalue().splitlines()

    def test_cli_requires_revision_format_and_exact_confirmation(self):
        code, lines = self.run_cli("--expected-revision", "x", "--confirm", "REVERT_NEWSFLUX_AI_LEGACY_MIGRATION")
        self.assertEqual((code, lines), (2, ["REVERT=HOLD_INVALID_REVISION"]))
        code, lines = self.run_cli("--expected-revision", "0" * 32, "--confirm", "yes")
        self.assertEqual((code, lines), (2, ["REVERT=HOLD_NOT_CONFIRMED"]))
        self.assertFalse(self.root.exists())

    def test_cli_reverts_with_writes_disabled_and_prints_no_secret(self):
        store = self.factory()
        token = store.migration_preview()["preview_token"]
        revision = store.migrate_legacy_policy("bootstrap", token, "MIGRATE-LEGACY-POLICY")["revision"]
        env = {**self.env, "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "false"}
        code, lines = self.run_cli("--expected-revision", revision,
                                   "--confirm", "REVERT_NEWSFLUX_AI_LEGACY_MIGRATION", env=env)
        self.assertEqual(code, 0, lines)
        self.assertIn("REVERT=PASS_LEGACY_BOOTSTRAP_RESTORED", lines)
        self.assertIn("RAW_CREDENTIAL_EXPORTED=NO", lines)
        self.assertNotIn(KEY, "\n".join(lines))
        self.assertFalse(self.factory().status()["managed"])
        code, lines = self.run_cli("--expected-revision", revision,
                                   "--confirm", "REVERT_NEWSFLUX_AI_LEGACY_MIGRATION", env=env)
        self.assertEqual((code, lines), (2, ["REVERT=HOLD_CONFIG_CONFLICT"]))


class OperatorRecoveryCliTests(unittest.TestCase):
    """P1/P2 operator CLIs: key file input only, classification output, no secrets."""

    NEW = "sk-synthetic-replacement-recovery-key-01"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.key = Path(self.tmp.name) / "key"
        self.key.write_text(KEY, encoding="ascii")
        self.key.chmod(0o600)
        self.new_key = Path(self.tmp.name) / "replacement"
        self.new_key.write_text(self.NEW + "\n", encoding="ascii")
        self.new_key.chmod(0o600)
        self.root = Path(self.tmp.name) / "managed"
        local = model_info("m1", provider="ollama")
        local["litellm_params"]["api_base"] = "http://ollama:11434"
        self.gateway = FakeGateway(listed=("m1",), infos=[local])
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.key),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_SETTINGS_DIR": str(self.root),
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "false",
            "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "m1",
        }

        class Revoked:
            def __call__(self, path):
                raise RuntimeError("HTTP_401")

        self.factory = lambda: ManagedSettingsStore(
            self.env, getter_factory=lambda base, peer, key: Revoked() if key == KEY else self.gateway,
        )

    def run_cli(self, module_name, *argv):
        import contextlib
        import importlib
        import io
        cli = importlib.import_module(f"services.article_intel_summary.{module_name}")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cli.main(list(argv), store_factory=self.factory)
        text = out.getvalue()
        self.assertNotIn(KEY, text)
        self.assertNotIn(self.NEW, text)
        return code, text.splitlines()

    def test_key_recovery_plan_then_apply(self):
        cli = "operator_recover_legacy_key_ai_settings"
        code, lines = self.run_cli(cli, "--key-file", str(self.new_key), "--plan")
        self.assertEqual(code, 0, lines)
        self.assertIn("RECOVERY_PLAN=READY", lines)
        self.assertIn("CURRENT_KEY=REJECTED", lines)
        self.assertIn("LEGACY_MODELS=1", lines)
        self.assertFalse(self.root.exists())
        digest = next(line.split("=", 1)[1] for line in lines if line.startswith("PLAN_DIGEST="))
        code, lines = self.run_cli(cli, "--key-file", str(self.new_key), "--apply",
                                   "--plan-digest", digest, "--confirm", "nope")
        self.assertEqual((code, lines), (2, ["RECOVERY=HOLD_NOT_CONFIRMED"]))
        code, lines = self.run_cli(cli, "--key-file", str(self.new_key), "--apply",
                                   "--plan-digest", digest, "--confirm", "RECOVER-LEGACY-KEY-AND-MIGRATE")
        self.assertEqual(code, 0, lines)
        self.assertIn("RECOVERY=PASS_KEY_REPLACED_POLICY_MIGRATED", lines)
        self.assertIn("MODELS_APPROVED=0", lines)
        self.assertEqual(self.factory().read()["key"], self.NEW)

    def test_key_recovery_rejects_an_unsafe_key_file(self):
        self.new_key.chmod(0o644)
        code, lines = self.run_cli("operator_recover_legacy_key_ai_settings",
                                   "--key-file", str(self.new_key), "--plan")
        self.assertEqual((code, lines), (2, ["RECOVERY=HOLD_KEY_FILE_UNSAFE"]))

    def test_interrupted_activation_cli_and_preflight_signal(self):
        from unittest.mock import patch
        store = self.factory()
        original = ManagedSettingsStore._write_bytes

        class Crash(BaseException):
            pass

        def crashing(instance, path, data):
            if path.name == "settings.json":
                raise Crash()
            return original(instance, path, data)

        plan = store.operator_plan_legacy_key_recovery(self.NEW)
        with patch.object(ManagedSettingsStore, "_write_bytes", crashing):
            with self.assertRaises(Crash):
                store.operator_recover_legacy_key("bootstrap", self.NEW, plan["plan_digest"],
                                                  "RECOVER-LEGACY-KEY-AND-MIGRATE")
        code, lines = run(self.env, store_factory=lambda env: self.factory())
        self.assertEqual(code, 3)
        self.assertIn("INTERRUPTED_ACTIVATION=YES", lines)
        cli = "operator_recover_interrupted_activation_ai_settings"
        code, lines = self.run_cli(cli, "--confirm", "no")
        self.assertEqual((code, lines), (2, ["RECOVERY=HOLD_NOT_CONFIRMED"]))
        code, lines = self.run_cli(cli, "--confirm", "RECOVER-INTERRUPTED-ACTIVATION")
        self.assertEqual(code, 0, lines)
        self.assertIn("RECOVERY=PASS_ROLLED_BACK_TO_BOOTSTRAP", lines)
        self.assertIn("KEY_SOURCE=BOOTSTRAP", lines)
        # Truthful receipt: the journal is preserved in the backup, nothing is deleted.
        self.assertIn("JOURNAL_REMOVED=NO", lines)
        self.assertIn("JOURNAL_PRESERVED_IN_BACKUP=YES", lines)
        self.assertIn("DATA_FILES_DELETED=0", lines)
        self.assertIn("COMPLETION_RECEIPT=WRITTEN_AFTER_READBACK", lines)
        self.assertNotIn("FILES_DELETED=0", lines)
        code, lines = run(self.env, store_factory=lambda env: self.factory())
        self.assertIn("INTERRUPTED_ACTIVATION=NO", lines)


    def test_roll_forward_receipt_reports_the_journal_cleanup(self):
        from unittest.mock import patch
        env = {**self.env, "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "", "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
               "NEWSFLUX_AI_INFERENCE_ENABLED": "true"}
        self.env = env
        store = ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)
        original = ManagedSettingsStore._write_bytes

        def faulty(instance, path, data):
            original(instance, path, data)
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")  # fsync error after rename

        with patch.object(ManagedSettingsStore, "_write_bytes", faulty):
            with self.assertRaises(ManagedSettingsError):
                store.save_key(self.NEW, "bootstrap")
        self.factory = lambda: ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)
        code, lines = self.run_cli("operator_recover_interrupted_activation_ai_settings",
                                   "--confirm", "RECOVER-INTERRUPTED-ACTIVATION")
        self.assertEqual(code, 0, lines)
        self.assertIn("RECOVERY=PASS_COMMITTED_ACTIVATION_COMPLETED", lines)
        self.assertIn("JOURNAL_REMOVED=YES", lines)
        self.assertIn("DATA_FILES_DELETED=0", lines)
        self.assertIn("KEY_SOURCE=MANAGED", lines)

    def test_key_recovery_cli_reports_inconclusive_key_state(self):
        class Down:
            def __call__(self, path):
                raise RuntimeError("HTTP_503")

        self.factory = lambda: ManagedSettingsStore(
            self.env, getter_factory=lambda base, peer, key: Down() if key == KEY else self.gateway,
        )
        code, lines = self.run_cli("operator_recover_legacy_key_ai_settings",
                                   "--key-file", str(self.new_key), "--plan")
        self.assertEqual((code, lines), (2, ["RECOVERY=HOLD_KEY_STATE_INCONCLUSIVE"]))
        self.assertFalse(self.root.exists())


    def test_roll_forward_finalization_faults_never_print_pass(self):
        import services.article_intel_summary.admin_settings as module
        from unittest.mock import patch
        env = {**self.env, "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "", "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true"}
        store = ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)
        original = ManagedSettingsStore._write_bytes

        def faulty(instance, path, data):
            original(instance, path, data)
            if path.name == "settings.json":
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")

        with patch.object(ManagedSettingsStore, "_write_bytes", faulty):
            with self.assertRaises(ManagedSettingsError):
                store.save_key(self.NEW, "bootstrap")
        self.factory = lambda: ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)
        for restore_fails, code in ((False, "CONFIG_UNAVAILABLE"), (True, "COMMIT_INDETERMINATE")):
            state = {"unlinked": False}
            real_unlink, real_fsync = os.unlink, ManagedSettingsStore._fsync_dir
            real_atomic = ManagedSettingsStore._write_atomic

            def unlink(path, *args, **kwargs):
                if Path(path).name == "activation.pending":
                    state["unlinked"] = True
                return real_unlink(path, *args, **kwargs)

            def fsync(directory):
                if state["unlinked"]:
                    raise OSError("EIO")
                return real_fsync(directory)

            def atomic(instance, directory, name, data, *, prefix):
                if restore_fails and state["unlinked"] and name == "activation.pending":
                    raise ManagedSettingsError("CONFIG_UNAVAILABLE")
                return real_atomic(instance, directory, name, data, prefix=prefix)

            with patch.object(module.os, "unlink", unlink), \
                    patch.object(ManagedSettingsStore, "_fsync_dir", staticmethod(fsync)), \
                    patch.object(ManagedSettingsStore, "_write_atomic", atomic):
                code_, lines = self.run_cli("operator_recover_interrupted_activation_ai_settings",
                                            "--confirm", "RECOVER-INTERRUPTED-ACTIVATION")
            self.assertEqual((code_, lines), (2, [f"RECOVERY=HOLD_{code}"]))
            if not restore_fails:
                self.assertTrue((self.root / "activation.pending").exists())


if __name__ == "__main__":
    unittest.main()
