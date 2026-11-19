"""Read-only operator preflight for NEWSFLUX-AI-SETTINGS-01 inside the Summary container.

Prints bounded classifications only. Never prints a key, hash, path content,
revision body or policy. Never writes, creates directories or calls LiteLLM
unless --check-gateway is passed (GET /v1/models and /model/info only).
Exit 0 = PASS, 3 = HOLD (an operator decision is needed).
"""
from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path

from services.article_intel_summary.admin_settings import (
    DEFAULT_ROOT, ManagedSettingsError, ManagedSettingsStore,
)
from services.article_intel_summary.litellm_adapter import _read_private_secret_file


def _classify_root(root: Path) -> str:
    if root.is_symlink():
        return "UNSAFE_SYMLINK"
    if not root.exists():
        parent = root.parent
        if not parent.is_dir() or not os.access(parent, os.W_OK | os.X_OK):
            return "ABSENT_PARENT_NOT_WRITABLE"
        return "ABSENT_CREATABLE"
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode):
        return "UNSAFE_NOT_DIRECTORY"
    if info.st_uid != os.geteuid():
        return "UNSAFE_OWNER"
    if stat.S_IMODE(info.st_mode) != 0o700:
        return "UNSAFE_MODE"
    return "PRESENT_PRIVATE"


def run(environ=None, *, check_gateway: bool = False, store_factory=ManagedSettingsStore) -> tuple[int, list[str]]:
    env = dict(os.environ if environ is None else environ)
    lines: list[str] = []
    hold = False
    lines.append(f"RUNTIME_UID={'10001' if os.geteuid() == 10001 else 'OTHER'}")
    writes = env.get("NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED", "").lower() == "true"
    lines.append(f"ADMIN_WRITES_ENABLED={'YES' if writes else 'NO'}")
    for name in ("NEWSFLUX_AI_INFERENCE_ENABLED", "NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING",
                 "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER", "NEWSFLUX_AI_ALLOW_PAID_INFERENCE"):
        lines.append(f"{name.removeprefix('NEWSFLUX_AI_')}={'ON' if env.get(name, '').lower() == 'true' else 'OFF'}")
    bootstrap = _read_private_secret_file(env.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"))
    lines.append(f"BOOTSTRAP_KEY_READABLE={'YES' if bootstrap else 'NO'}")
    root = Path(env.get("NEWSFLUX_AI_ADMIN_SETTINGS_DIR") or DEFAULT_ROOT)
    root_state = _classify_root(root) if root.is_absolute() else "UNSAFE_RELATIVE"
    lines.append(f"MANAGED_DIR={root_state}")
    if root_state.startswith("UNSAFE") or (writes and root_state == "ABSENT_PARENT_NOT_WRITABLE"):
        hold = True
    try:
        store = store_factory(env)
        status = store.status()
        lines.append("STORE=READABLE")
        lines.append(f"KEY_SOURCE={'MANAGED' if status['managed'] else 'BOOTSTRAP'}")
        lines.append(f"KEY_CONFIGURED={'YES' if status['configured'] else 'NO'}")
        lines.append(f"POLICY_MODELS={min(int(status['policy_models']), 999)}")
        lines.append(f"POLICY_SOURCE={str(status.get('policy_source', 'unknown')).upper()}")
        # Informational: the first managed write is refused until an admin migrates explicitly.
        lines.append(f"LEGACY_MIGRATION_REQUIRED={'YES' if status.get('migration_required') else 'NO'}")
        if not status["configured"]:
            hold = True
        if check_gateway:
            try:
                snapshot = store.discover()
                lines.append(f"GATEWAY_DISCOVERY=PASS_MODELS_{min(len(snapshot.listed), 999)}")
            except ManagedSettingsError as error:
                lines.append(f"GATEWAY_DISCOVERY=HOLD_{error.code}")
                hold = True
    except ManagedSettingsError as error:
        lines.append(f"STORE=HOLD_{error.code}")
        hold = True
    except Exception:
        lines.append("STORE=HOLD_UNVERIFIED")
        hold = True
    lines.append("SECRET_PRINTED=NO")
    lines.append("WRITES_PERFORMED=NO")
    lines.append(f"PREFLIGHT={'HOLD' if hold else 'PASS'}")
    return (3 if hold else 0), lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--check-gateway", action="store_true",
                        help="also run read-only GET discovery with the current key")
    args = parser.parse_args(argv)
    code, lines = run(check_gateway=args.check_gateway)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())
