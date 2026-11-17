"""Owner-only NewsFlux LiteLLM configuration, never serialized to browser state.

The existing virtual-key secret file is bootstrap-only. After the first authorized
admin save the atomic /data record becomes canonical; restarting never reverts to
bootstrap. Invalid/corrupt/unsafe records fail closed, not back to the old key.
"""
from __future__ import annotations

import fcntl
import json
import os
import secrets
import stat
import tempfile
from pathlib import Path
from typing import Mapping

from services.article_intel_summary.catalog import (
    GatewayDiscovery,
    MAX_POLICY_MODELS,
    _parse_policy,
    discovered_model_id,
    gateway_getter,
)
from services.article_intel_summary.litellm_adapter import (
    _read_private_secret_file,
    _valid_gateway_base_url,
    _valid_model_alias,
)

MAX_KEY_BYTES = 4096
MAX_RECORD_BYTES = 24 * 1024
MAX_POLICY_BYTES = 16 * 1024
DEFAULT_ROOT = "/data/newsflux-ai-settings"


class ManagedSettingsError(Exception):
    """Fixed error code only. Never contains a credential or internal path."""

    def __init__(self, code: str):
        if code not in {
            "CONFIG_UNAVAILABLE", "CONFIG_UNSAFE", "CONFIG_INVALID",
            "CONFIG_CONFLICT", "KEY_INVALID", "KEY_UNVERIFIED",
            "POLICY_INVALID", "MODEL_NOT_DISCOVERED", "MODEL_UNVERIFIED",
            "CHANGES_DISABLED",
        }:
            code = "CONFIG_UNAVAILABLE"
        self.code = code
        super().__init__(code)


def _parse_key(value: object) -> str:
    if not isinstance(value, str) or not value.startswith("sk-"):
        raise ManagedSettingsError("KEY_INVALID")
    if not 8 <= len(value.encode("utf-8")) <= MAX_KEY_BYTES:
        raise ManagedSettingsError("KEY_INVALID")
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        raise ManagedSettingsError("KEY_INVALID")
    return value


class ManagedSettingsStore:
    """One authenticated/admin-owned atomic record for a key and operator policy.

    A root-only, read-only Docker mount may continue to supply the bootstrap key.
    The writable persistent /data volume owns the managed record after first save.
    The managed record is the single authority, and is never copied to web settings.
    """

    def __init__(self, environ: Mapping[str, str] | None = None, *, root: str | None = None,
                 getter_factory=None):
        self.env = dict(os.environ if environ is None else environ)
        self.root = Path(root or self.env.get("NEWSFLUX_AI_ADMIN_SETTINGS_DIR") or DEFAULT_ROOT)
        if not self.root.is_absolute():
            raise ManagedSettingsError("CONFIG_UNSAFE")
        self.getter_factory = getter_factory or gateway_getter
        self.enabled = self.env.get("NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED", "").lower() == "true"

    def _check_dir(self, *, create: bool = False) -> bool:
        if not self.root.exists() and not self.root.is_symlink():
            if not create:
                return False
            try:
                self.root.mkdir(mode=0o700)
            except FileExistsError:
                pass  # concurrent first writer; the lstat checks below still apply
            except (OSError, ValueError):
                raise ManagedSettingsError("CONFIG_UNAVAILABLE") from None
        try:
            info = self.root.lstat()
        except OSError:
            raise ManagedSettingsError("CONFIG_UNAVAILABLE") from None
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ManagedSettingsError("CONFIG_UNSAFE")
        return True

    def _read_private(self, path: Path, *, limit: int) -> bytes | None:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            return None
        except OSError:
            raise ManagedSettingsError("CONFIG_UNSAFE") from None
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
                    or info.st_size > limit):
                raise ManagedSettingsError("CONFIG_UNSAFE")
            with os.fdopen(fd, "rb", closefd=False) as handle:
                value = handle.read(limit + 1)
            if len(value) > limit:
                raise ManagedSettingsError("CONFIG_UNSAFE")
            return value
        finally:
            os.close(fd)

    def _managed(self) -> dict | None:
        if not self._check_dir():
            return None
        marker = self._read_private(self.root / "activated", limit=32)
        if marker is not None and marker != b"v1\n":
            raise ManagedSettingsError("CONFIG_UNSAFE")
        raw = self._read_private(self.root / "settings.json", limit=MAX_RECORD_BYTES)
        if raw is None:
            if marker is not None:
                # Previously activated settings must NEVER silently fall back to
                # an old Docker-mounted bootstrap key after deletion or corruption.
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return None
        if marker is None:
            raise ManagedSettingsError("CONFIG_UNSAFE")
        try:
            value = json.loads(raw.decode("utf-8"))
            if (not isinstance(value, dict) or set(value) != {"version", "revision", "key", "policy"}
                    or value["version"] != 1 or not isinstance(value["revision"], str)
                    or len(value["revision"]) != 32):
                raise ValueError()
            _parse_key(value["key"])
            if value["policy"] is not None:
                _parse_policy(value["policy"])
            return value
        except (ValueError, TypeError, UnicodeError, ArithmeticError):
            raise ManagedSettingsError("CONFIG_INVALID") from None

    def _bootstrap(self) -> dict:
        key = _read_private_secret_file(self.env.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"))
        policy_raw = self.env.get("NEWSFLUX_AI_MODEL_POLICY_JSON")
        policy = None
        if policy_raw and policy_raw.strip():
            try:
                policy = json.loads(policy_raw)
                _parse_policy(policy)
            except (ValueError, TypeError, ArithmeticError):
                raise ManagedSettingsError("CONFIG_INVALID") from None
        return {"version": 1, "revision": "bootstrap", "key": key, "policy": policy}

    def read(self) -> dict:
        return self._managed() or self._bootstrap()

    def effective_values(self, values: Mapping[str, str] | None = None) -> dict[str, str]:
        result = dict(self.env if values is None else values)
        managed = self._managed()
        if managed is None:
            return result
        # In-memory, private backend-only override: one atomic canonical JSON file.
        # Never expose this key in API responses, settings documents or logs.
        result["__newsflux_managed_virtual_key"] = managed["key"]
        if managed["policy"] is not None:
            result["NEWSFLUX_AI_MODEL_POLICY_JSON"] = json.dumps(managed["policy"], separators=(",", ":"))
        else:
            result.pop("NEWSFLUX_AI_MODEL_POLICY_JSON", None)
        return result

    def status(self) -> dict:
        state = self.read()
        return {
            "configured": bool(state["key"]),
            "managed": state["revision"] != "bootstrap",
            "revision": state["revision"],
            "writes_enabled": self.enabled,
            "policy_models": len(state["policy"]["models"]) if state["policy"] else 0,
        }

    def policy(self) -> dict:
        state = self.read()
        policy = state["policy"] or {"version": 1, "models": []}
        return {
            "revision": state["revision"],
            # Provider identity can include an internal upstream hostname; it stays server-only.
            "policy": {"version": 1, "models": [
                {k: v for k, v in item.items() if k != "provider_identity"}
                for item in policy["models"]
            ]},
        }

    def discover(self, *, candidate_key: str | None = None):
        state = self.read()
        key = _parse_key(candidate_key if candidate_key is not None else state["key"])
        base = self.env.get("NEWSFLUX_AI_LITELLM_BASE_URL")
        peer = self.env.get("NEWSFLUX_AI_LITELLM_PRIVATE_DOCKER_PEER") or None
        if not _valid_gateway_base_url(base) or peer not in (None, "npm"):
            raise ManagedSettingsError("CONFIG_UNAVAILABLE")
        try:
            getter = self.getter_factory(base, peer, key)
            snapshot = GatewayDiscovery(getter).snapshot()
        except Exception:
            raise ManagedSettingsError("KEY_UNVERIFIED") from None
        if snapshot.status != "OK" or not snapshot.listed:
            raise ManagedSettingsError("KEY_UNVERIFIED")
        return snapshot

    def public_models(self) -> dict:
        state = self.read()
        snapshot = self.discover()
        policy = state["policy"]
        approved = {item["alias"] for item in policy["models"]} if policy else set()
        results = []
        for alias in snapshot.listed:
            detail = (snapshot.info or {}).get(alias)
            results.append({
                "id": alias,
                "approved": alias in approved,
                "provider": detail.provider if detail and detail.provider else "Unverified",
                "mode": detail.mode if detail else None,
                "identity_verified": bool(detail and detail.provider_identity),
                "local_ollama": bool(detail and detail.provider_identity == "ollama@ollama:11434"),
                "price_known": bool(detail and detail.input_price is not None and detail.output_price is not None
                                    and not detail.price_conflict),
            })
        return {"models": results[:256], "revision": state["revision"]}

    def validate_candidate(self, key: str) -> dict:
        self.discover(candidate_key=_parse_key(key))
        return {"validated": True}

    def _write_bytes(self, path: Path, data: bytes) -> None:
        temp_path = None
        try:
            fd, temp_path = tempfile.mkstemp(dir=str(self.root), prefix=".new-", text=False)
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, path)
            temp_path = None
            dirfd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(dirfd)
            finally:
                os.close(dirfd)
        except OSError:
            raise ManagedSettingsError("CONFIG_UNAVAILABLE") from None
        finally:
            if temp_path is not None:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    def _save(self, expected_revision: str, *, key: str | None = None, policy: dict | None = None,
              change: str) -> dict:
        if not self.enabled:
            raise ManagedSettingsError("CHANGES_DISABLED")
        self._check_dir(create=True)
        lock = self.root / "write.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600 or
                    not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
                raise ManagedSettingsError("CONFIG_UNSAFE")
            fcntl.flock(fd, fcntl.LOCK_EX)
            state = self.read()
            if expected_revision != state["revision"]:
                raise ManagedSettingsError("CONFIG_CONFLICT")
            next_state = {
                "version": 1, "revision": secrets.token_hex(16),
                "key": _parse_key(key if change == "key" else state["key"]),
                "policy": policy if change == "policy" else state["policy"],
            }
            if next_state["policy"] is not None:
                try:
                    _parse_policy(next_state["policy"])
                except (ValueError, TypeError, ArithmeticError):
                    raise ManagedSettingsError("POLICY_INVALID") from None
            raw = json.dumps(next_state, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
            if len(raw) > MAX_RECORD_BYTES:
                raise ManagedSettingsError("CONFIG_INVALID")
            # Durable single-file authority: a marker prevents silent bootstrap
            # fallback if the managed record vanishes. Save the prior record for
            # an operator-controlled restoration, never in a public response.
            current = self._managed()
            previous = json.dumps(state, separators=(",", ":")).encode("utf-8")
            if len(previous) > MAX_RECORD_BYTES:
                raise ManagedSettingsError("CONFIG_INVALID")
            self._write_bytes(self.root / "previous.json", previous)
            first_activation = current is None
            if first_activation:
                self._write_bytes(self.root / "activated", b"v1\n")
            try:
                self._write_bytes(self.root / "settings.json", raw)
            except ManagedSettingsError:
                if first_activation:
                    # Nothing managed was ever committed: withdraw the marker so the
                    # unchanged bootstrap remains authoritative instead of bricking.
                    try:
                        os.unlink(self.root / "activated")
                    except OSError:
                        pass
                raise
            check = self._managed()
            if check is None or check["revision"] != next_state["revision"]:
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return self.status()
        finally:
            os.close(fd)

    def operator_restore_previous(self, expected_revision: str) -> dict:
        """Only callable by the trusted operator inside the Summary container.

        The HTTP API deliberately has no endpoint for reverting to an unverified
        old key. The previous record is kept owner-only; never return its body.
        """
        if not self.enabled:
            raise ManagedSettingsError("CHANGES_DISABLED")
        if not isinstance(expected_revision, str) or not self._check_dir():
            raise ManagedSettingsError("CONFIG_UNSAFE")
        fd = os.open(
            self.root / "write.lock",
            os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW,
        )
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
            ):
                raise ManagedSettingsError("CONFIG_UNSAFE")
            fcntl.flock(fd, fcntl.LOCK_EX)
            current = self._managed()
            if current is None or current["revision"] != expected_revision:
                raise ManagedSettingsError("CONFIG_CONFLICT")
            raw = self._read_private(self.root / "previous.json", limit=MAX_RECORD_BYTES)
            if raw is None:
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            try:
                previous = json.loads(raw.decode("utf-8"))
                if not isinstance(previous, dict) or set(previous) != {"version", "revision", "key", "policy"}:
                    raise ValueError()
                _parse_key(previous["key"])
                if previous["policy"] is not None:
                    _parse_policy(previous["policy"])
            except (ValueError, TypeError, UnicodeError, ArithmeticError):
                raise ManagedSettingsError("CONFIG_INVALID") from None
            previous["revision"] = secrets.token_hex(16)
            payload = json.dumps(previous, separators=(",", ":")).encode("utf-8")
            self._write_bytes(self.root / "settings.json", payload)
            restored = self._managed()
            if restored is None or restored["revision"] != previous["revision"]:
                raise ManagedSettingsError("CONFIG_UNAVAILABLE")
            return self.status()
        finally:
            os.close(fd)

    def save_key(self, key: str, expected_revision: str) -> dict:
        if not self.enabled:
            raise ManagedSettingsError("CHANGES_DISABLED")
        key = _parse_key(key)
        self.validate_candidate(key)  # cannot destroy working key with an unverified credential
        return self._save(expected_revision, key=key, change="key")

    def save_policy(self, policy: dict, expected_revision: str) -> dict:
        if not isinstance(policy, dict):
            raise ManagedSettingsError("POLICY_INVALID")
        try:
            models = _parse_policy(policy)
            if not models:
                raise ValueError("empty policy")
        except (ValueError, TypeError, ArithmeticError):
            # decimal.InvalidOperation is an ArithmeticError, not a ValueError.
            raise ManagedSettingsError("POLICY_INVALID") from None
        snapshot = self.discover()
        for item in models:
            detail = (snapshot.info or {}).get(item.alias)
            if item.alias not in snapshot.listed:
                raise ManagedSettingsError("MODEL_NOT_DISCOVERED")
            if not detail or detail.mode != "chat" or not detail.provider_identity:
                raise ManagedSettingsError("MODEL_UNVERIFIED")
            if item.provider_identity is not None and item.provider_identity != detail.provider_identity:
                raise ManagedSettingsError("MODEL_UNVERIFIED")
            if detail.price_conflict:
                raise ManagedSettingsError("MODEL_UNVERIFIED")
            if detail.provider_identity != "ollama@ollama:11434":
                # External models require complete, verified cost and positive operator consent.
                if (detail.input_price is None or detail.output_price is None
                        or item.input_price != detail.input_price
                        or item.output_price != detail.output_price
                        or not item.transfer_authorized):
                    raise ManagedSettingsError("MODEL_UNVERIFIED")
            elif item.provider_identity != "ollama@ollama:11434":
                raise ManagedSettingsError("MODEL_UNVERIFIED")
        return self._save(expected_revision, policy=policy, change="policy")

    def approve_model(self, alias: str, expected_revision: str,
                      *, allow_paid: bool = False, allow_external: bool = False) -> dict:
        if not self.enabled:
            raise ManagedSettingsError("CHANGES_DISABLED")
        if not _valid_model_alias(alias) or not isinstance(expected_revision, str):
            raise ManagedSettingsError("POLICY_INVALID")
        if not isinstance(allow_paid, bool) or not isinstance(allow_external, bool):
            raise ManagedSettingsError("POLICY_INVALID")
        state = self.read()
        if state["revision"] != expected_revision:
            raise ManagedSettingsError("CONFIG_CONFLICT")
        snapshot = self.discover()
        if alias not in snapshot.listed:
            raise ManagedSettingsError("MODEL_NOT_DISCOVERED")
        detail = (snapshot.info or {}).get(alias)
        if not detail or detail.mode != "chat" or not detail.provider_identity or detail.price_conflict:
            raise ManagedSettingsError("MODEL_UNVERIFIED")
        local = detail.provider_identity == "ollama@ollama:11434"
        if not local and not allow_external:
            raise ManagedSettingsError("MODEL_UNVERIFIED")
        if not local and (detail.input_price is None or detail.output_price is None):
            raise ManagedSettingsError("MODEL_UNVERIFIED")
        paid = bool((detail.input_price or 0) > 0 or (detail.output_price or 0) > 0)
        if paid and not allow_paid:
            raise ManagedSettingsError("MODEL_UNVERIFIED")
        new_item = {
            "id": discovered_model_id(alias),
            "alias": alias,
            "label": alias[:64],
            "provider": (detail.provider or "LiteLLM")[:64],
            "provider_identity": detail.provider_identity,
            "compatible_for_summary": True,
            "paid_authorized": allow_paid,
            "transfer_authorized": True,
        }
        if detail.input_price is not None:
            new_item["input_usd_per_million"] = str(detail.input_price)
        if detail.output_price is not None:
            new_item["output_usd_per_million"] = str(detail.output_price)
        policy = state["policy"] or {"version": 1, "models": []}
        rows = [item for item in policy["models"] if item["alias"] != alias]
        rows.append(new_item)
        if len(rows) > MAX_POLICY_MODELS:
            raise ManagedSettingsError("POLICY_INVALID")
        return self.save_policy({"version": 1, "models": rows}, expected_revision)

    def remove_model(self, alias: str, expected_revision: str) -> dict:
        if not self.enabled:
            raise ManagedSettingsError("CHANGES_DISABLED")
        if not isinstance(alias, str) or not isinstance(expected_revision, str):
            raise ManagedSettingsError("POLICY_INVALID")
        state = self.read()
        if state["revision"] != expected_revision:
            raise ManagedSettingsError("CONFIG_CONFLICT")
        policy = state["policy"]
        if not policy or not any(item["alias"] == alias for item in policy["models"]):
            raise ManagedSettingsError("MODEL_NOT_DISCOVERED")
        remaining = [item for item in policy["models"] if item["alias"] != alias]
        return self._save(
            expected_revision,
            policy={"version": 1, "models": remaining},
            change="policy"
        )
