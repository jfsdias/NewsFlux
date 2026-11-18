#!/usr/bin/env python3
"""NEWSFLUX-AI-SETTINGS-01 R4.4B — admin allowlist remediation for the running Summary (operator tool).

Run as root on the OMV from a checkout whose commit and SHA-256 the operator command verified.

  audit     read-only. Runtime trust (pinned image, revision label, no filesystem drift, loaded code
            byte-identical to the approved revision), complete host inventory, Compose source of truth,
            rendered-vs-running proof, flags, dependents, protected services.
  identity  read-only. Runtime trust FIRST; only then asks the owner for their own Miniflux API key at a
            hidden terminal prompt and, with explicit consent, for admin enumeration. GET /v1/me (and
            /v1/users when consented) run inside the Summary through its own MinifluxAuthService; the key
            travels on stdin only (never argv, env, file or log).
  apply     mutating, owner-confirmed. Changes only NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS in the proven env
            source, recreates only the Summary with the running image (no build, no pull), verifies.
            Every step from the first write on runs inside the rollback boundary.
  rollback  mutating, owner-confirmed. Restores a backup written by apply (by BACKUP_ID) and verifies.

Trust options (required for audit, identity and apply):
  --expect-image sha256:<64 hex>  --expect-revision <40 hex>  --source-repo <git checkout containing it>

Output contract: one KEY=VALUE per line, keys from an explicit schema, values [A-Za-z0-9_.:,+-]{0,96}:
classifications, counts, numeric IDs, SHA-256 and 12-hex path fingerprints. Never paths, URLs, hosts,
usernames, keys, tokens, headers or env values. A line outside the schema is suppressed and HOLDs.
Exit: 0 PASS; 3 HOLD (nothing changed); 4 owner decision required (identity); 5 change failed and was
rolled back (verified); 6 rollback incomplete or unproven (operator intervention required).
"""
from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import time

PROJECT = "newsflux"
SERVICE = "summary-api"
PROTECTED = ("miniflux", "miniflux-db", "npm")
READER = "newsflux"
MINIFLUX = "miniflux"
STATE_ROOT = "/root/newsflux-r44"
LOCK = "/run/lock/newsflux-release.lock"
HEALTH_TIMEOUT = 180.0
KEY = "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS"
FLAGS = (
    "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED",
    "NEWSFLUX_AI_INFERENCE_ENABLED",
    "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER",
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE",
    "NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING",
)
CODE_PATHS = ("services/__init__.py", "services/article_intel_auth", "services/content_fallback")
DRIFT_ALLOWED_PREFIXES = ("/data", "/tmp")
CONSENT_PHRASE = "LIST-ADMIN-IDS"
HOLD: list[str] = []
READ_ONLY = True

# ---------------------------------------------------------------- output schema
VALUE_RE = re.compile(r"[A-Za-z0-9_.:,+-]{0,96}")
SCHEMA_KEYS = frozenset("""
R44_MODE R44_PYTHON R44_RESULT R44_INTERNAL R44_SCHEMA_VIOLATION SECRET_PRINTED HOLD_COUNT WRITES_PERFORMED AUDIT_GATE
IDENTITY_GATE_FINAL RUNTIME_EXPECTATIONS RUNTIME_SOURCE_REPO RUNTIME_IMAGE_PINNED RUNTIME_REVISION RUNTIME_USER
RUNTIME_FS_DRIFT RUNTIME_CODE_MANIFEST RUNTIME_TRUST_GATE SUMMARY_CONTAINER SUMMARY_IMAGE SUMMARY_REVISION
SUMMARY_HEALTH SUMMARY_USER SUMMARY_PUBLISHED_PORTS SUMMARY_RESTART_COUNT SUMMARY_MOUNTS_COUNT SUMMARY_DATA_MOUNT
SUMMARY_MOUNTS_FP SUMMARY_NETWORKS ADMIN_CONFIG_WRITES_ENABLED INFERENCE_ENABLED ALLOW_EXTERNAL_ARTICLE_TRANSFER
ALLOW_PAID_INFERENCE ALLOW_LOCAL_ARTICLE_PROCESSING ADMIN_ALLOWLIST_RUNTIME DEPLOYED_ADMIN_ROUTE_CALLERS
COMPOSE_LABELS COMPOSE_PROJECT_DIR_FP COMPOSE_CONFIG_FILES COMPOSE_ENV_FILES COMPOSE_RENDER COMPOSE_HASH
COMPOSE_ENV_FILE RENDERED_CONFIG_HASH_MATCHES_RUNNING RENDERED_IMAGE_MATCHES_RUNNING SUMMARY_HAS_BUILD_SECTION
RENDERED_ENV_MATCHES_RUNNING RENDERED_ENV_DIFF_COUNT SUMMARY_DEPENDENTS_COUNT DEPENDENTS_RESTART_ON_RECREATE
SUMMARY_FIXED_IP SUMMARY_ENV_FILES ADMIN_KEY_SOURCE ENV_SOURCE ENV_SOURCE_FILE ENV_SOURCE_PATH_FP ENV_SOURCE_SHA256
ENV_SOURCE_MODE ENV_SOURCE_OWNER_UID ENV_SOURCE_KEY_LINES ENV_SOURCE_PROVEN_AGAINST_RUNTIME ENV_SOURCE_PERMISSIONS
READER_CADDYFILE_SHA256 HOST_INVENTORY RELEASE_LOCK_FILE RELEASE_LOCK MINIFLUX_SOURCE MINIFLUX_BASE_FINGERPRINT
MINIFLUX_BASE_ROUTE ME_LOOKUP ADMIN_ID_CANDIDATE MINIFLUX_IS_ADMIN ADMIN_ENUMERATION USERS_LOOKUP ADMIN_COUNT
ADMIN_IDS CURRENT_ALLOWLIST OWNER_SELECTION IDENTITY_PROBE API_KEY_INPUT ADMIN_ID_ARGUMENT PRESTATE_GATE
ENV_SOURCE_KEY_VALUE ENV_SOURCE_KEY_LINES_FORM ADMIN_ID_VERIFIED CONFIG_CHANGE_AUTHORIZED BACKUP_ID BACKUP_SHA256
BACKUP_GATE ENV_DIFF_GATE CONFIG_CHANGE_EXECUTED RENDER_DIFF_GATE RENDER_DIFF_PROBLEMS SUMMARY_RECREATE
CONFIG_HASH_IS_RENDERED IMAGE_IDENTITY_PRESERVED OTHER_ENV_UNCHANGED SUMMARY_USER_PRESERVED SUMMARY_MOUNTS_PRESERVED
SUMMARY_NETWORKS_PRESERVED SUMMARY_NO_PUBLISHED_PORTS EFFECTIVE_ALLOWLIST_CONFIGURED_COUNT_1 ADMIN_AUTHZ_PROBE
PROTECTED_SERVICES_UNCHANGED READER_CADDYFILE_UNCHANGED POSTCHECK CONFIG_CHANGE_RESULT ROLLBACK_READY
FAULT_INJECTED BACKUP_ID_ARGUMENT BACKUP_INTEGRITY ROLLBACK_AUTHORIZED ROLLBACK ROLLBACK_ENV_FILE_RESTORED
ROLLBACK_ENV_FILE_DURABLE ROLLBACK_SOURCE_HASH ROLLBACK_CONFIG_HASH ROLLBACK_IMAGE ROLLBACK_ENV ROLLBACK_HEALTH
ROLLBACK_OTHER_CONTAINERS ROLLBACK_CADDYFILE ROLLBACK_RECREATE SUMMARY_RECREATE_RESULT
""".split())
SCHEMA_KEY_RES = (re.compile(r"COMPOSE_CONFIG_FILE_[0-9]{1,3}"), re.compile(r"PROTECTED_[A-Z0-9_]{1,40}_STATUS"),
                  re.compile(r"FLAG_[A-Z_]{1,60}_UNCHANGED"))


class Stop(Exception):
    pass


def _key_allowed(key: str) -> bool:
    return key in SCHEMA_KEYS or any(r.fullmatch(key) for r in SCHEMA_KEY_RES)


def out(key: str, value: object) -> None:
    text = str(value)
    if not _key_allowed(key) or not VALUE_RE.fullmatch(text):
        bad = key if _key_allowed(key) else "UNLISTED_KEY"
        print(f"R44_SCHEMA_VIOLATION={bad}", flush=True)
        HOLD.append("R44_SCHEMA_VIOLATION")
        return
    print(f"{key}={text}", flush=True)


def hold(key: str, value: object) -> None:
    out(key, value)
    HOLD.append(key)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()[:12]


# ---------------------------------------------------------------- docker access
READ_ONLY_DOCKER = {("ps",), ("inspect",), ("image", "inspect"), ("exec",), ("compose",), ("diff",)}


def docker(*args: str, stdin: str | None = None, timeout: float = 120) -> tuple[int, str]:
    if READ_ONLY:
        if not (args[:1] in READ_ONLY_DOCKER or args[:2] in READ_ONLY_DOCKER):
            raise SystemExit("R44_INTERNAL=NON_READ_ONLY_DOCKER_CALL")
        if args[0] == "compose" and "config" not in args:
            raise SystemExit("R44_INTERNAL=NON_READ_ONLY_COMPOSE_CALL")
    try:
        done = subprocess.run(["docker", *args], input=stdin, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return 125, ""
    return done.returncode, done.stdout


def inspect(ref: str) -> dict | None:
    rc, raw = docker("inspect", ref)
    if rc != 0:
        return None
    try:
        doc = json.loads(raw)[0]
    except (ValueError, IndexError, TypeError):
        return None
    return doc if isinstance(doc, dict) else None


def image_id(ref: str) -> str | None:
    rc, raw = docker("image", "inspect", "-f", "{{.Id}}", ref)
    value = raw.strip()
    return value if rc == 0 and re.fullmatch(r"sha256:[0-9a-f]{64}", value) else None


def summary_container() -> dict:
    rc, raw = docker("ps", "-a", "-q", "--no-trunc", "--filter", f"label=com.docker.compose.project={PROJECT}",
                     "--filter", f"label=com.docker.compose.service={SERVICE}")
    ids = raw.split() if rc == 0 else []
    if len(ids) != 1:
        raise Stop("SUMMARY_CONTAINER", "NOT_UNIQUE" if rc == 0 else "DOCKER_UNAVAILABLE")
    doc = inspect(ids[0])
    if doc is None:
        raise Stop("SUMMARY_CONTAINER", "INSPECT_FAILED")
    return doc


def env_map(doc: dict) -> dict[str, str]:
    result = {}
    for item in (doc.get("Config") or {}).get("Env") or []:
        key, _, value = item.partition("=")
        result[key] = value
    return result


def health(doc: dict) -> str:
    state = doc.get("State") or {}
    if not state.get("Running"):
        return "NOT_RUNNING"
    return ((state.get("Health") or {}).get("Status") or "NO_HEALTHCHECK").upper()


def mounts(doc: dict) -> list[tuple]:
    return sorted((m.get("Type"), m.get("Source"), m.get("Destination"), bool(m.get("RW"))) for m in doc.get("Mounts") or [])


def networks(doc: dict) -> list[str]:
    return sorted(((doc.get("NetworkSettings") or {}).get("Networks") or {}).keys())


def published_ports(doc: dict) -> int:
    ports = (doc.get("NetworkSettings") or {}).get("Ports") or {}
    return sum(len(v or []) for v in ports.values())


def flag_class(value: str | None) -> str:
    if value is None or value.strip() == "":
        return "OFF"
    norm = value.strip().lower()
    return "ON" if norm == "true" else "OFF" if norm == "false" else "MALFORMED"


def allowlist_class(value: str | None) -> str:
    if value is None:
        return "ABSENT"
    if not value.strip():
        return "EMPTY"
    items = [v.strip() for v in value.split(",")]
    if all(v.isascii() and v.isdecimal() and 1 <= int(v) <= 9_223_372_036_854_775_807 for v in items if v) and all(items):
        return f"CONFIGURED_COUNT_{len(set(items))}"
    return "INVALID"


def all_containers() -> dict[str, tuple]:
    """Identity of every container on the host except the Summary. Fails closed: any container that cannot
    be inspected makes the snapshot incomplete, and an incomplete snapshot can prove nothing."""
    rc, raw = docker("ps", "-a", "-q", "--no-trunc")
    if rc != 0:
        raise Stop("HOST_INVENTORY", "UNAVAILABLE")
    snap = {}
    for cid in raw.split():
        doc = inspect(cid)
        if doc is None:
            raise Stop("HOST_INVENTORY", "INSPECT_FAILED")
        labels = (doc.get("Config") or {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") == PROJECT and labels.get("com.docker.compose.service") == SERVICE:
            continue
        state = doc.get("State") or {}
        snap[cid] = (doc.get("Name"), doc.get("Image"), state.get("StartedAt"), state.get("Running"), doc.get("RestartCount"))
    return snap


def file_in_container(container: str, path: str) -> str | None:
    rc, raw = docker("exec", container, "sha256sum", path)
    value = raw.split()[0] if rc == 0 and raw.split() else ""
    return value if re.fullmatch(r"[0-9a-f]{64}", value) else None


# ---------------------------------------------------------------- terminal input (owner only)
def ask(prompt: str, secret: bool) -> str:
    if secret:
        import getpass
        return getpass.getpass(prompt)  # /dev/tty, no echo
    with open("/dev/tty", "r+", encoding="utf-8") as tty:
        tty.write(prompt)
        tty.flush()
        return tty.readline().rstrip("\n")


def read_api_key() -> str:
    key = ask("Miniflux API key of the NewsFlux owner (hidden; never stored or printed): ", True).strip()
    if not 1 <= len(key) <= 4096 or any(not 0x21 <= ord(c) <= 0x7E for c in key):
        raise Stop("API_KEY_INPUT", "INVALID_FORMAT")
    return key


def read_enumeration_consent() -> bool:
    answer = ask(f"Read the Miniflux user list to count other admins (only admin IDs are printed)? "
                 f"Type {CONSENT_PHRASE} to consent, or press Enter to skip: ", False).strip()
    return answer == CONSENT_PHRASE


# ---------------------------------------------------------------- runtime trust (before any secret)
class Trust:
    def __init__(self, image: str | None, revision: str | None, repo: str | None):
        self.image, self.revision, self.repo = image, revision, repo

    @classmethod
    def parse(cls, opts: dict) -> "Trust":
        return cls(opts.get("--expect-image"), opts.get("--expect-revision"), opts.get("--source-repo"))


def code_manifest(trust: Trust) -> dict[str, str] | None:
    def git(*args: str) -> tuple[int, bytes]:
        try:
            done = subprocess.run(["git", "-C", trust.repo, *args], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return 125, b""
        return done.returncode, done.stdout

    rc, _ = git("cat-file", "-e", f"{trust.revision}^{{commit}}")
    if rc != 0:
        return None
    rc, raw = git("ls-tree", "-r", "--name-only", trust.revision, "--", *CODE_PATHS)
    files = sorted(p for p in raw.decode().splitlines() if p.endswith(".py")) if rc == 0 else []
    if not files:
        return None
    manifest = {}
    for path in files:
        rc, blob = git("show", f"{trust.revision}:{path}")
        if rc != 0:
            return None
        manifest[path] = sha256_bytes(blob)
    return manifest


def runtime_trust(doc: dict, trust: Trust) -> bool:
    """Prove the running Summary is the approved image and code before it is given any secret."""
    if not (trust.image and re.fullmatch(r"sha256:[0-9a-f]{64}", trust.image)
            and trust.revision and re.fullmatch(r"[0-9a-f]{40}", trust.revision)
            and trust.repo and os.path.isdir(trust.repo)):
        hold("RUNTIME_EXPECTATIONS", "MISSING")
        hold("RUNTIME_TRUST_GATE", "HOLD")
        return False
    ok = True
    cid = doc["Id"]
    pinned = doc.get("Image") == trust.image and image_id(trust.image) == trust.image
    (out if pinned else hold)("RUNTIME_IMAGE_PINNED", "MATCH" if pinned else "MISMATCH")
    ok &= pinned
    labels = ((inspect(doc.get("Image") or "") or {}).get("Config") or {}).get("Labels") or {}
    rev_ok = labels.get("org.opencontainers.image.revision") == trust.revision
    (out if rev_ok else hold)("RUNTIME_REVISION", "MATCH" if rev_ok else "MISMATCH")
    ok &= rev_ok
    user = ((doc.get("Config") or {}).get("User") or "")
    user_ok = user in ("10001", "10001:10001")
    (out if user_ok else hold)("RUNTIME_USER", "UID10001" if user_ok else "NOT_10001")
    ok &= user_ok

    rc, raw = docker("diff", cid)
    if rc != 0:
        hold("RUNTIME_FS_DRIFT", "UNVERIFIED")
        ok = False
    else:
        dests = [m[2] for m in mounts(doc) if m[2]]
        drift = 0
        for line in raw.splitlines():
            path = line[2:].strip() if len(line) > 2 else ""
            if not path:
                continue
            allowed = any(path == p or path.startswith(p + "/") for p in DRIFT_ALLOWED_PREFIXES) \
                or any(d == path or d.startswith(path.rstrip("/") + "/") for d in dests)
            drift += 0 if allowed else 1
        (out if drift == 0 else hold)("RUNTIME_FS_DRIFT", "NONE" if drift == 0 else "DETECTED")
        ok &= drift == 0

    manifest = code_manifest(trust)
    if manifest is None:
        hold("RUNTIME_CODE_MANIFEST", "UNVERIFIED")
        ok = False
    else:
        paths = sorted(manifest)
        rc, raw = docker("exec", cid, "sha256sum", *[f"/app/{p}" for p in paths], timeout=60)
        seen = {}
        for line in raw.splitlines() if rc == 0 else []:
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[1].startswith("/app/"):
                seen[parts[1][5:]] = parts[0]
        match = rc == 0 and seen == manifest
        (out if match else hold)("RUNTIME_CODE_MANIFEST", f"MATCH_COUNT_{len(paths)}" if match else "MISMATCH")
        ok &= match
    (out if ok else hold)("RUNTIME_TRUST_GATE", "PASS" if ok else "HOLD")
    return ok


# ---------------------------------------------------------------- identity (inside the Summary container)
IDENTITY_CODE = r"""
import hashlib, json, os, socket, sys
from urllib.parse import urlsplit
root = '/app'
sys.path.insert(0, root)
result = {}
try:
    import services.article_intel_auth.auth as auth_mod
    if not os.path.realpath(auth_mod.__file__).startswith(root + '/'):
        print(json.dumps({'error': 'UNSAFE_IMPORT_PATH'})); sys.exit(0)
    from services.article_intel_auth.config import AuthSettings
    from services.article_intel_auth.errors import AuthError
    settings = AuthSettings.from_env()
    service = auth_mod.MinifluxAuthService(settings)
except Exception:
    print(json.dumps({'error': 'IMPORT_OR_SETTINGS_FAILED'})); sys.exit(0)
base = settings.miniflux_base_url
host = urlsplit(base).hostname or ''
result['base_fp'] = hashlib.sha256(base.encode()).hexdigest()[:12]
try:
    result['base_ips'] = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
except OSError:
    result['base_ips'] = []
result['allowlist_state'] = settings.admin_allowlist_state
result['allowlist'] = sorted(settings.admin_user_ids)
key = sys.stdin.readline().strip()
consent = sys.stdin.readline().strip() == '1'
def strict_id(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else None
if key:
    try:
        me = service._get_json('/v1/me', key, max_bytes=auth_mod.MAX_IDENTITY_RESPONSE_BYTES)
        if not isinstance(me, dict) or strict_id(me.get('id')) is None or not isinstance(me.get('is_admin'), bool):
            result['me_error'] = 'invalid_miniflux_response'
        else:
            result['me'] = [me['id'], me['is_admin']]
    except AuthError as exc:
        result['me_error'] = exc.code
    except Exception:
        result['me_error'] = 'unexpected_error'
    if consent and result.get('me') and result['me'][1]:
        try:
            users = service._get_json('/v1/users', key, max_bytes=4 * 1024 * 1024)
            admins = []
            if not isinstance(users, list):
                result['users_error'] = 'invalid_miniflux_response'
            else:
                for u in users:
                    if not isinstance(u, dict) or strict_id(u.get('id')) is None or not isinstance(u.get('is_admin'), bool):
                        result['users_error'] = 'invalid_miniflux_response'; break
                    if u['is_admin']:
                        admins.append(u['id'])
                else:
                    result['admins'] = sorted(admins)
        except AuthError as exc:
            result['users_error'] = exc.code
        except Exception:
            result['users_error'] = 'unexpected_error'
print(json.dumps(result))
"""

EFFECTIVE_ALLOWLIST_CODE = r"""
import json, sys
sys.path.insert(0, '/app')
from services.article_intel_auth.config import AuthSettings
s = AuthSettings.from_env()
print(json.dumps({'state': s.admin_allowlist_state, 'ids': sorted(s.admin_user_ids)}))
"""

DEPLOYED_ADMIN_CALLERS_CODE = r"""
import os, re
n = 0
for d, _, files in os.walk('/app/services'):
    if '/tests' in d or '/article_intel_auth' in d:
        continue
    for f in files:
        if f.endswith('.py'):
            with open(os.path.join(d, f), encoding='utf-8', errors='replace') as h:
                n += len(re.findall(r'\bauthorize_admin\s*\(', h.read()))
print(n)
"""


def container_identity(cid: str, key: str, consent: bool) -> dict:
    rc, raw = docker("exec", "-i", cid, "python", "-I", "-c", IDENTITY_CODE,
                     stdin=f"{key}\n{'1' if consent else '0'}\n", timeout=60)
    try:
        data = json.loads(raw.strip().splitlines()[-1]) if rc == 0 and raw.strip() else None
    except (ValueError, IndexError):
        data = None
    if not isinstance(data, dict):
        raise Stop("IDENTITY_PROBE", "EXEC_FAILED")
    if "error" in data:
        raise Stop("IDENTITY_PROBE", str(data["error"]))
    return data


def miniflux_ips() -> set[str]:
    doc = inspect(MINIFLUX)
    if doc is None:
        return set()
    nets = (doc.get("NetworkSettings") or {}).get("Networks") or {}
    return {n.get("IPAddress") for n in nets.values() if n.get("IPAddress")}


def code_word(value: object) -> str:
    return re.sub(r"[^A-Z0-9_]", "_", str(value).upper())[:60] or "FAILED"


def verify_identity(cid: str, key: str, consent: bool, *, report: bool = True) -> dict:
    data = container_identity(cid, key, consent)
    route = "UNRESOLVED"
    if data.get("base_ips"):
        route = "DIRECT_PROTECTED_MINIFLUX" if set(data["base_ips"]) & miniflux_ips() else "OTHER_ROUTE"
    if report:
        out("MINIFLUX_SOURCE", "SUMMARY_RUNTIME_SETTINGS")
        out("MINIFLUX_BASE_FINGERPRINT", data.get("base_fp", "UNKNOWN"))
        out("MINIFLUX_BASE_ROUTE", route)
    if "me" not in data:
        raise Stop("ME_LOOKUP", code_word(data.get("me_error", "failed")))
    me_id, is_admin = data["me"]
    if report:
        out("ME_LOOKUP", "OK")
        out("ADMIN_ID_CANDIDATE", me_id)
        out("MINIFLUX_IS_ADMIN", "YES" if is_admin else "NO")
        out("CURRENT_ALLOWLIST", code_word(data.get("allowlist_state", "unknown")))
    if not is_admin:
        raise Stop("OWNER_SELECTION", "CALLER_NOT_MINIFLUX_ADMIN")
    data["me_id"] = me_id
    data["selection"] = "OWNER_DECISION_REQUIRED_ENUMERATION_DECLINED"
    if not consent:
        if report:
            out("ADMIN_ENUMERATION", "DECLINED_BY_OWNER")
        return data
    if report:
        out("ADMIN_ENUMERATION", "CONSENTED")
    if "admins" not in data:
        raise Stop("USERS_LOOKUP", code_word(data.get("users_error", "failed")))
    admins = data["admins"]
    if report:
        out("USERS_LOOKUP", "OK")
        out("ADMIN_COUNT", len(admins))
        out("ADMIN_IDS", ",".join(map(str, admins)) or "NONE")
    if me_id not in admins:
        raise Stop("OWNER_SELECTION", "CALLER_NOT_IN_ADMIN_LIST")
    data["selection"] = "SINGLE_ADMIN_IS_CALLER" if admins == [me_id] else "OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS"
    return data


# ---------------------------------------------------------------- compose source of truth
def dotenv(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", key.strip()):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key.strip()] = value
    return values


def interpolate(text: str, variables: dict[str, str]) -> str | None:
    failed = []

    def repl(match: re.Match) -> str:
        name = match.group("b") or match.group("n")
        op, arg = match.group("op") or "", match.group("arg") or ""
        value = variables.get(name)
        if op in (":-", "-"):
            if value is None or (op == ":-" and value == ""):
                return arg
        elif op in (":?", "?"):
            if value is None or (op == ":?" and value == ""):
                failed.append(name)
                return ""
        if value is None:
            failed.append(name)
            return ""
        return value

    result = re.sub(r"\$(?:\{(?P<b>[A-Za-z_][A-Za-z0-9_]*)(?:(?P<op>:?[-?])(?P<arg>[^}]*))?\}|(?P<n>[A-Za-z_][A-Za-z0-9_]*))",
                    repl, text)
    return None if failed else result


class Project:
    def __init__(self, doc: dict):
        labels = (doc.get("Config") or {}).get("Labels") or {}
        self.workdir = labels.get("com.docker.compose.project.working_dir") or ""
        self.files = [f for f in (labels.get("com.docker.compose.project.config_files") or "").split(",") if f]
        self.env_files = [f for f in (labels.get("com.docker.compose.project.environment_file") or "").split(",") if f]
        self.running_hash = labels.get("com.docker.compose.config-hash") or ""
        if not self.workdir or not self.files:
            raise Stop("COMPOSE_LABELS", "INCOMPLETE")

    def base(self) -> list[str]:
        args = ["compose", "-p", PROJECT, "--project-directory", self.workdir]
        for env_file in self.env_files:
            args += ["--env-file", env_file]
        for f in self.files:
            args += ["-f", f]
        return args

    def render(self, *extra: str) -> dict:
        rc, raw = docker(*self.base(), "config", "--format", "json", *extra)
        try:
            data = json.loads(raw) if rc == 0 else None
        except ValueError:
            data = None
        if not isinstance(data, dict) or SERVICE not in (data.get("services") or {}):
            raise Stop("COMPOSE_RENDER", "FAILED")
        return data

    def config_hash(self) -> str:
        rc, raw = docker(*self.base(), "config", "--hash", SERVICE)
        parts = raw.split()
        if rc != 0 or len(parts) != 2 or parts[0] != SERVICE:
            raise Stop("COMPOSE_HASH", "FAILED")
        return parts[1]

    def interpolation_vars(self) -> dict[str, str]:
        variables = {}
        candidates = self.env_files or [os.path.join(self.workdir, ".env")]
        for path in candidates:
            try:
                with open(path, encoding="utf-8") as handle:
                    variables.update(dotenv(handle.read()))
            except OSError:
                if self.env_files:
                    raise Stop("COMPOSE_ENV_FILE", "UNREADABLE") from None
        variables.update(os.environ)
        return variables

    def env_sources(self) -> tuple[list[str], dict]:
        raw = self.render("--no-interpolate")
        svc = raw["services"][SERVICE]
        variables = self.interpolation_vars()
        paths = []
        for entry in svc.get("env_file") or []:
            path = entry.get("path") if isinstance(entry, dict) else entry
            if not isinstance(path, str):
                raise Stop("ENV_SOURCE", "UNPARSEABLE")
            match = re.search(r"\$\{?[A-Za-z_]", path)
            if match:
                value = interpolate(path[match.start():], variables)
                if value is None:
                    raise Stop("ENV_SOURCE", "UNRESOLVED_INTERPOLATION")
                path = value if value.startswith("/") else os.path.normpath(path[:match.start()] + value)
            paths.append(path)
        return paths, svc.get("environment") or {}


def file_meta(path: str) -> dict:
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode):
        raise Stop("ENV_SOURCE_FILE", "NOT_REGULAR_FILE")
    with open(path, "rb") as handle:
        data = handle.read()
    return {"path": path, "sha256": sha256_bytes(data), "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid,
            "gid": info.st_gid, "bytes": data}


KEY_LINE = re.compile(rb"^[ \t]*(export[ \t]+)?" + KEY.encode() + rb"[ \t]*=")


def audit(trust: Trust) -> dict:
    """Read-only prestate. Returns everything apply needs; HOLDs are recorded, never fixed."""
    doc = summary_container()
    cid = doc["Id"]
    env = env_map(doc)
    img = doc.get("Image") or ""
    image_doc = inspect(img) or {}
    labels = (image_doc.get("Config") or {}).get("Labels") or {}
    state = {"doc": doc, "cid": cid, "image": img, "env": env, "source": None}
    out("SUMMARY_CONTAINER", f"UNIQUE_{cid[:12]}")
    out("SUMMARY_IMAGE", img or "UNKNOWN")
    revision = labels.get("org.opencontainers.image.revision", "")
    out("SUMMARY_REVISION", revision if re.fullmatch(r"[0-9a-f]{40}", revision) else "UNKNOWN")
    state["trusted"] = runtime_trust(doc, trust)
    h = health(doc)
    (out if h == "HEALTHY" else hold)("SUMMARY_HEALTH", h)
    (out if published_ports(doc) == 0 else hold)("SUMMARY_PUBLISHED_PORTS", published_ports(doc))
    out("SUMMARY_RESTART_COUNT", doc.get("RestartCount", "UNKNOWN"))
    mlist = mounts(doc)
    out("SUMMARY_MOUNTS_COUNT", len(mlist))
    data = [m for m in mlist if m[2] == "/data"]
    out("SUMMARY_DATA_MOUNT", ("RW" if data[0][3] else "RO") if data else "ABSENT")
    out("SUMMARY_MOUNTS_FP", fingerprint(json.dumps([(m[0], m[2], m[3]) for m in mlist])))
    out("SUMMARY_NETWORKS", len(networks(doc)))
    for flag in FLAGS:
        cls = flag_class(env.get(flag))
        (out if cls == "OFF" else hold)(flag.replace("NEWSFLUX_AI_", ""), cls)
    out("ADMIN_ALLOWLIST_RUNTIME", allowlist_class(env.get(KEY)))
    rc, raw = docker("exec", cid, "python", "-I", "-c", DEPLOYED_ADMIN_CALLERS_CODE)
    out("DEPLOYED_ADMIN_ROUTE_CALLERS", raw.strip() if rc == 0 and raw.strip().isdigit() else "UNVERIFIED")

    project = Project(doc)
    state["project"] = project
    out("COMPOSE_PROJECT_DIR_FP", fingerprint(project.workdir))
    out("COMPOSE_CONFIG_FILES", len(project.files))
    for i, path in enumerate(project.files, 1):
        try:
            meta = file_meta(path)
            out(f"COMPOSE_CONFIG_FILE_{i}", f"{fingerprint(path)}:{meta['sha256'][:16]}:{meta['mode']:o}")
        except (OSError, Stop):
            hold(f"COMPOSE_CONFIG_FILE_{i}", f"{fingerprint(path)}:UNREADABLE")
    out("COMPOSE_ENV_FILES", len(project.env_files))

    rendered = project.render()
    state["rendered"] = rendered
    out("COMPOSE_RENDER", "OK")
    svc = rendered["services"][SERVICE]
    new_hash = project.config_hash()
    state["hash"] = new_hash
    same = new_hash == project.running_hash
    (out if same else hold)("RENDERED_CONFIG_HASH_MATCHES_RUNNING", "YES" if same else "NO")
    ref = svc.get("image") or ""
    ref_id = image_id(ref) if ref else None
    (out if ref_id == img else hold)("RENDERED_IMAGE_MATCHES_RUNNING", "YES" if ref_id == img else "NO")
    (out if not svc.get("build") else hold)("SUMMARY_HAS_BUILD_SECTION", "YES" if svc.get("build") else "NO")
    expected_env = env_map(image_doc)
    expected_env.update({k: ("" if v is None else str(v)) for k, v in (svc.get("environment") or {}).items()})
    diff = [k for k in set(expected_env) | set(env) if expected_env.get(k) != env.get(k)]
    (out if not diff else hold)("RENDERED_ENV_MATCHES_RUNNING", "YES" if not diff else "NO")
    if diff:
        out("RENDERED_ENV_DIFF_COUNT", len(diff))

    dependents, restart_true = 0, 0
    for other in (rendered.get("services") or {}).values():
        dep = other.get("depends_on") or {}
        if SERVICE in dep:
            dependents += 1
            if isinstance(dep[SERVICE], dict) and dep[SERVICE].get("restart"):
                restart_true += 1
    out("SUMMARY_DEPENDENTS_COUNT", dependents)
    (out if restart_true == 0 else hold)("DEPENDENTS_RESTART_ON_RECREATE", restart_true)
    fixed_ip = any(isinstance(n, dict) and (n.get("ipv4_address") or n.get("ipv6_address"))
                   for n in (svc.get("networks") or {}).values())
    (out if not fixed_ip else hold)("SUMMARY_FIXED_IP", "YES" if fixed_ip else "NO")

    paths, raw_environment = project.env_sources()
    out("SUMMARY_ENV_FILES", len(paths))
    if KEY in raw_environment:
        hold("ADMIN_KEY_SOURCE", "COMPOSE_ENVIRONMENT_BLOCK")
    else:
        metas = []
        for path in paths:
            try:
                metas.append(file_meta(path))
            except (OSError, Stop):
                hold("ENV_SOURCE_FILE", "UNREADABLE")
        with_key = [m for m in metas if any(KEY_LINE.match(l) for l in m["bytes"].split(b"\n"))]
        with_base = [m for m in metas if b"NEWSFLUX_AI_MINIFLUX_BASE_URL" in m["bytes"]]
        target = with_key[0] if len(with_key) == 1 else (with_base[0] if not with_key and len(with_base) == 1 else None)
        if target is None:
            hold("ADMIN_KEY_SOURCE", "AMBIGUOUS_OR_UNKNOWN")
        else:
            values = dotenv(target["bytes"].decode("utf-8", "replace"))
            proven = all(env.get(k) == v for k, v in values.items() if k not in raw_environment and k != KEY)
            out("ADMIN_KEY_SOURCE", "ENV_FILE")
            out("ENV_SOURCE_PATH_FP", fingerprint(target["path"]))
            out("ENV_SOURCE_SHA256", target["sha256"])
            out("ENV_SOURCE_MODE", f"{target['mode']:o}")
            out("ENV_SOURCE_OWNER_UID", target["uid"])
            out("ENV_SOURCE_KEY_LINES", sum(bool(KEY_LINE.match(l)) for l in target["bytes"].split(b"\n")))
            (out if proven else hold)("ENV_SOURCE_PROVEN_AGAINST_RUNTIME", "YES" if proven else "NO")
            private = not target["mode"] & 0o077
            (out if private else hold)("ENV_SOURCE_PERMISSIONS", "PRIVATE" if private else "NOT_PRIVATE")
            state["source"] = target if proven and private else None

    caddy = file_in_container(READER, "/etc/caddy/Caddyfile") if inspect(READER) else None
    (out if caddy else hold)("READER_CADDYFILE_SHA256", caddy or "UNVERIFIED")
    state["caddy"] = caddy
    for name in PROTECTED:
        pdoc = inspect(name)
        running = bool(pdoc and (pdoc.get("State") or {}).get("Running"))
        status = "RUNNING" if running else ("ABSENT" if pdoc is None else "NOT_RUNNING")
        (out if running else hold)(f"PROTECTED_{re.sub(r'[^A-Z0-9]', '_', name.upper())}_STATUS", status)
    try:
        state["inventory"] = all_containers()
        out("HOST_INVENTORY", f"COMPLETE_COUNT_{len(state['inventory'])}")
    except Stop as stop:
        hold(stop.args[0], stop.args[1])
    out("RELEASE_LOCK_FILE", "PRESENT" if os.path.exists(LOCK) else "ABSENT")
    return state


# ---------------------------------------------------------------- mutation primitives
def write_atomic(meta: dict, data: bytes, txn: dict | None = None) -> None:
    """Replace the file atomically with the original mode and owner. txn['replaced'] is set the moment the
    live file changes, so a caller knows the mutation happened even if a later step (fsync) raises."""
    path = meta["path"]
    directory = os.path.dirname(path) or "."
    tmp = os.path.join(directory, f".{os.path.basename(path)}.r44.{secrets.token_hex(6)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        try:
            os.write(fd, data)
            os.fchown(fd, meta["uid"], meta["gid"])
            os.fchmod(fd, meta["mode"])
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    if txn is not None:
        txn["replaced"] = True
    dfd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def restore_file(meta: dict) -> tuple[bool, bool]:
    """(restored, durable): bytes/mode/owner equal the backup, and the restoring write completed."""
    durable = True
    try:
        write_atomic(meta, meta["bytes"])
    except Exception:  # noqa: BLE001 - the content check below decides; durability is then unproven
        durable = False
    try:
        now = file_meta(meta["path"])
        restored = now["sha256"] == meta["sha256"] and now["mode"] == meta["mode"] \
            and (now["uid"], now["gid"]) == (meta["uid"], meta["gid"])
    except (OSError, Stop):
        restored = False
    return restored, durable


def env_digest(env: dict[str, str], salt: bytes) -> str:
    body = "\n".join(f"{k}={env[k]}" for k in sorted(env)).encode()
    return hmac.new(salt, body, hashlib.sha256).hexdigest()


def recreate(project: Project) -> None:
    rc, _ = docker(*project.base(), "up", "-d", "--no-deps", "--no-build", "--pull", "never", SERVICE, timeout=300)
    if rc != 0:
        raise Stop("SUMMARY_RECREATE", "COMPOSE_FAILED")


def wait_healthy(old_id: str | None) -> dict:
    deadline = time.monotonic() + HEALTH_TIMEOUT
    while True:
        try:
            doc = summary_container()
        except Stop:
            doc = None
        if doc and (old_id is None or doc["Id"] != old_id) and health(doc) == "HEALTHY":
            return doc
        if time.monotonic() > deadline:
            raise Stop("SUMMARY_HEALTH", health(doc) if doc else "ABSENT")
        time.sleep(2)


def effective_allowlist(cid: str) -> dict:
    rc, raw = docker("exec", cid, "python", "-I", "-c", EFFECTIVE_ALLOWLIST_CODE)
    try:
        return json.loads(raw.strip().splitlines()[-1]) if rc == 0 else {}
    except (ValueError, IndexError):
        return {}


def compare_rendered(before: dict, after: dict, admin_id: int) -> list[str]:
    problems = []
    b_services, a_services = before.get("services") or {}, after.get("services") or {}
    if set(b_services) != set(a_services):
        problems.append("SERVICE_SET")
    for name in b_services:
        if name != SERVICE and json.dumps(b_services[name], sort_keys=True) != json.dumps(a_services.get(name), sort_keys=True):
            problems.append("OTHER_SERVICE")
    b, a = dict(b_services[SERVICE]), dict(a_services.get(SERVICE) or {})
    b_env, a_env = dict(b.pop("environment", {}) or {}), dict(a.pop("environment", {}) or {})
    if json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
        problems.append("SUMMARY_NON_ENV_FIELDS")
    b_env.pop(KEY, None)
    if a_env.pop(KEY, None) != str(admin_id):
        problems.append("SUMMARY_ADMIN_VALUE")
    if b_env != a_env:
        problems.append("SUMMARY_OTHER_ENV")
    for key in ("networks", "volumes", "secrets", "configs"):
        if json.dumps(before.get(key), sort_keys=True) != json.dumps(after.get(key), sort_keys=True):
            problems.append("TOP_LEVEL_" + key.upper())
    return sorted(set(problems))


def rollback(project: Project, meta: dict, original: dict, others_before: dict, caddy: str | None) -> bool:
    """Restore the exact env file and the original Summary config; verify everything. Never raises."""
    ok = True
    try:
        restored, durable = restore_file(meta)
        out("ROLLBACK_ENV_FILE_RESTORED", "YES" if restored else "NO")
        out("ROLLBACK_ENV_FILE_DURABLE", "YES" if durable else "NO")
        ok = restored and durable
        source_ok = project.config_hash() == original["hash"]
        out("ROLLBACK_SOURCE_HASH", "PASS" if source_ok else "FAIL")
        ok &= source_ok
        current = summary_container()
        if current["Config"]["Labels"].get("com.docker.compose.config-hash") != original["hash"] and source_ok:
            out("ROLLBACK_RECREATE", "YES")
            recreate(project)
            current = wait_healthy(current["Id"])
        checks = {
            "ROLLBACK_CONFIG_HASH": current["Config"]["Labels"].get("com.docker.compose.config-hash") == original["hash"],
            "ROLLBACK_IMAGE": current.get("Image") == original["image"],
            "ROLLBACK_ENV": env_map(current) == original["env"],
            "ROLLBACK_HEALTH": health(current) == "HEALTHY",
            "ROLLBACK_CADDYFILE": file_in_container(READER, "/etc/caddy/Caddyfile") == caddy,
        }
        try:
            checks["ROLLBACK_OTHER_CONTAINERS"] = all_containers() == others_before
        except Stop:
            checks["ROLLBACK_OTHER_CONTAINERS"] = False
        for key, good in checks.items():
            out(key, "PASS" if good else "FAIL")
            ok &= good
    except Exception:  # noqa: BLE001 - never report an unproven rollback as success
        ok = False
    out("ROLLBACK", "PASS" if ok else "FAIL")
    return ok


# ---------------------------------------------------------------- modes
def identity_mode(trust: Trust) -> int:
    doc = summary_container()
    if not runtime_trust(doc, trust):
        return 3  # the key is never requested from an unproven runtime
    key = read_api_key()
    consent = read_enumeration_consent()
    try:
        data = verify_identity(doc["Id"], key, consent)
    finally:
        del key
    out("OWNER_SELECTION", data["selection"])
    return 0 if data["selection"] == "SINGLE_ADMIN_IS_CALLER" else 4


def apply(admin_id_arg: str, trust: Trust) -> int:
    global READ_ONLY
    if not re.fullmatch(r"[1-9][0-9]{0,18}", admin_id_arg or ""):
        raise Stop("ADMIN_ID_ARGUMENT", "INVALID")
    admin_id = int(admin_id_arg)
    lock_fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise Stop("RELEASE_LOCK", "BUSY") from None
    out("RELEASE_LOCK", "HELD")

    state = audit(trust)  # includes runtime trust and the complete host inventory
    if HOLD or not state.get("trusted") or state.get("source") is None or "inventory" not in state:
        raise Stop("PRESTATE_GATE", "HOLD")
    if allowlist_class(state["env"].get(KEY)) not in ("ABSENT", "EMPTY"):
        raise Stop("PRESTATE_GATE", "ALLOWLIST_ALREADY_SET")
    meta = state["source"]
    lines = meta["bytes"].split(b"\n")
    hits = [i for i, line in enumerate(lines) if KEY_LINE.match(line)]
    if len(hits) > 1 or any(lines[i].lstrip().startswith(b"export") for i in hits):
        raise Stop("ENV_SOURCE_KEY_LINES_FORM", "UNSUPPORTED")
    if hits and lines[hits[0]].split(b"=", 1)[1].strip().strip(b"'\""):
        raise Stop("ENV_SOURCE_KEY_VALUE", "NOT_EMPTY")
    if hits:
        lines[hits[0]] = f"{KEY}={admin_id}".encode()
        new_bytes = b"\n".join(lines)
    else:
        prefix = meta["bytes"] if meta["bytes"].endswith(b"\n") or not meta["bytes"] else meta["bytes"] + b"\n"
        new_bytes = prefix + f"{KEY}={admin_id}\n".encode()
    old_rest = [l for l in meta["bytes"].split(b"\n") if not KEY_LINE.match(l) and l != b""]
    new_rest = [l for l in new_bytes.split(b"\n") if not KEY_LINE.match(l) and l != b""]
    if old_rest != new_rest:
        raise Stop("ENV_DIFF_GATE", "UNEXPECTED")
    out("PRESTATE_GATE", "PASS")

    key = read_api_key()
    consent = read_enumeration_consent()
    try:
        identity = verify_identity(state["cid"], key, consent)
        if identity["me_id"] != admin_id:
            raise Stop("ADMIN_ID_VERIFIED", "MISMATCH_WITH_LIVE_IDENTITY")
        out("OWNER_SELECTION", identity["selection"])
        out("ADMIN_ID_VERIFIED", admin_id)
        phrase = f"APPLY-R44-ADMIN-{admin_id}"
        answer = ask(f"Production change: set the Summary admin allowlist to {admin_id} and recreate only the "
                     f"Summary. Type {phrase} to proceed: ", False).strip()
        if answer != phrase:
            raise Stop("CONFIG_CHANGE_AUTHORIZED", "NO")
        out("CONFIG_CHANGE_AUTHORIZED", "YES_OWNER_TYPED_PHRASE")

        # Fresh, complete inventory immediately before the first write; failure here changes nothing.
        others_before = all_containers()
        READ_ONLY = False
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        os.makedirs(STATE_ROOT, mode=0o700, exist_ok=True)
        os.chmod(STATE_ROOT, 0o700)
        backup_id = f"r44-{stamp}"
        backup_dir = os.path.join(STATE_ROOT, backup_id)
        os.mkdir(backup_dir, 0o700)
        backup_file = os.path.join(backup_dir, "env-source.orig")
        fd = os.open(backup_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(meta["bytes"])
            handle.flush()
            os.fsync(handle.fileno())
        salt = secrets.token_bytes(32)
        original = {"hash": state["hash"], "image": state["image"], "env": state["env"], "cid": state["cid"]}
        record = {k: meta[k] for k in ("path", "sha256", "mode", "uid", "gid")}
        record.update({"project": PROJECT, "service": SERVICE, "config_hash": state["hash"], "image": state["image"],
                       "container": state["cid"], "env_salt": salt.hex(), "env_digest": env_digest(state["env"], salt),
                       "caddyfile_sha256": state["caddy"], "admin_id": admin_id})
        fd = os.open(os.path.join(backup_dir, "prestate.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=1, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        with open(backup_file, "rb") as handle:
            backup_ok = sha256_bytes(handle.read()) == meta["sha256"]
        out("BACKUP_ID", backup_id)
        out("BACKUP_SHA256", meta["sha256"])
        if not backup_ok:
            raise Stop("BACKUP_GATE", "FAIL")
        out("BACKUP_GATE", "PASS")
        project: Project = state["project"]

        # Rollback boundary: everything from the first production write to the last post-check.
        txn = {"replaced": False}
        try:
            write_atomic(meta, new_bytes, txn)
            out("CONFIG_CHANGE_EXECUTED", "ENV_FILE_WRITTEN")
            problems = compare_rendered(state["rendered"], project.render(), admin_id)
            if problems:
                out("RENDER_DIFF_PROBLEMS", ",".join(problems)[:96])
                raise Stop("RENDER_DIFF_GATE", "FAIL")
            out("RENDER_DIFF_GATE", "PASS_ONLY_ADMIN_KEY")
            new_hash = project.config_hash()
            recreate(project)
            doc = wait_healthy(original["cid"])
            new_env = env_map(doc)
            expected_env = dict(original["env"])
            expected_env[KEY] = str(admin_id)
            allow = effective_allowlist(doc["Id"])
            others_after = all_containers()
            identity_after = verify_identity(doc["Id"], key, False, report=False)
            checks = {
                "IMAGE_IDENTITY_PRESERVED": doc.get("Image") == original["image"],
                "CONFIG_HASH_IS_RENDERED": doc["Config"]["Labels"].get("com.docker.compose.config-hash") == new_hash,
                "OTHER_ENV_UNCHANGED": new_env == expected_env,
                "SUMMARY_USER_PRESERVED": doc["Config"].get("User") == state["doc"]["Config"].get("User"),
                "SUMMARY_MOUNTS_PRESERVED": mounts(doc) == mounts(state["doc"]),
                "SUMMARY_NETWORKS_PRESERVED": networks(doc) == networks(state["doc"]),
                "SUMMARY_NO_PUBLISHED_PORTS": published_ports(doc) == 0,
                "SUMMARY_HEALTH": health(doc) == "HEALTHY",
                "EFFECTIVE_ALLOWLIST_CONFIGURED_COUNT_1": allow == {"state": "configured", "ids": [admin_id]},
                "ADMIN_AUTHZ_PROBE": identity_after["me_id"] == admin_id and admin_id in identity_after["allowlist"],
                "PROTECTED_SERVICES_UNCHANGED": others_after == others_before,
                "READER_CADDYFILE_UNCHANGED": file_in_container(READER, "/etc/caddy/Caddyfile") == state["caddy"],
            }
            for flag in FLAGS:
                checks[f"FLAG_{flag.replace('NEWSFLUX_AI_', '')}_UNCHANGED"] = new_env.get(flag) == original["env"].get(flag)
            for name, good in checks.items():
                out(name, "PASS" if good else "FAIL")
            if not all(checks.values()):
                raise Stop("POSTCHECK", "FAIL")
        except Exception as exc:  # noqa: BLE001 - any failure inside the boundary must roll back
            if isinstance(exc, Stop):
                out(exc.args[0], exc.args[1])
            else:
                out("R44_INTERNAL", type(exc).__name__)
            out("CONFIG_CHANGE_EXECUTED", "ENV_FILE_REPLACED" if txn["replaced"] else "WRITE_NOT_COMPLETED")
            out("CONFIG_CHANGE_RESULT", "FAILED_ROLLING_BACK")
            good = rollback(project, meta, original, others_before, state["caddy"])
            out("R44_RESULT", "ROLLED_BACK_VERIFIED" if good else "ROLLBACK_INCOMPLETE")
            return 5 if good else 6
    finally:
        del key
    out("ROLLBACK_READY", backup_id)
    out("CONFIG_CHANGE_RESULT", "APPLIED_VERIFIED")
    out("R44_RESULT", "APPLIED_VERIFIED")
    return 0


def manual_rollback(backup_id: str) -> int:
    global READ_ONLY
    if not re.fullmatch(r"r44-[0-9]{8}T[0-9]{6}Z", backup_id or ""):
        raise Stop("BACKUP_ID_ARGUMENT", "INVALID")
    backup_dir = os.path.join(STATE_ROOT, backup_id)
    try:
        with open(os.path.join(backup_dir, "prestate.json"), encoding="utf-8") as handle:
            record = json.load(handle)
        with open(os.path.join(backup_dir, "env-source.orig"), "rb") as handle:
            data = handle.read()
    except (OSError, ValueError):
        raise Stop("BACKUP_INTEGRITY", "UNREADABLE") from None
    if sha256_bytes(data) != record.get("sha256"):
        raise Stop("BACKUP_INTEGRITY", "FAIL")
    out("BACKUP_INTEGRITY", "PASS")
    if ask("Type ROLLBACK-R44 to restore the pre-R4.4 Summary configuration: ", False).strip() != "ROLLBACK-R44":
        raise Stop("ROLLBACK_AUTHORIZED", "NO")
    doc = summary_container()
    project = Project(doc)
    others = all_containers()  # complete inventory before the first write, fail closed
    READ_ONLY = False
    meta = {k: record[k] for k in ("path", "mode", "uid", "gid", "sha256")}
    meta["bytes"] = data
    ok = True
    try:
        restored, durable = restore_file(meta)
        out("ROLLBACK_ENV_FILE_RESTORED", "YES" if restored else "NO")
        out("ROLLBACK_ENV_FILE_DURABLE", "YES" if durable else "NO")
        ok = restored and durable
        source_ok = project.config_hash() == record["config_hash"]
        out("ROLLBACK_SOURCE_HASH", "PASS" if source_ok else "FAIL")
        ok &= source_ok
        if source_ok and doc["Config"]["Labels"].get("com.docker.compose.config-hash") != record["config_hash"]:
            out("ROLLBACK_RECREATE", "YES")
            recreate(project)
            doc = wait_healthy(doc["Id"])
        checks = {
            "ROLLBACK_CONFIG_HASH": doc["Config"]["Labels"].get("com.docker.compose.config-hash") == record["config_hash"],
            "ROLLBACK_IMAGE": doc.get("Image") == record["image"],
            "ROLLBACK_ENV": env_digest(env_map(doc), bytes.fromhex(record["env_salt"])) == record["env_digest"],
            "ROLLBACK_HEALTH": health(doc) == "HEALTHY",
        }
        try:
            checks["ROLLBACK_OTHER_CONTAINERS"] = all_containers() == others
        except Stop:
            checks["ROLLBACK_OTHER_CONTAINERS"] = False
        for key, good in checks.items():
            out(key, "PASS" if good else "FAIL")
            ok &= good
    except Exception:  # noqa: BLE001
        ok = False
    out("ROLLBACK", "PASS" if ok else "FAIL")
    out("R44_RESULT", "ROLLED_BACK_VERIFIED" if ok else "ROLLBACK_INCOMPLETE")
    return 0 if ok else 6


def parse_args(argv: list[str]) -> tuple[str, list[str], dict]:
    mode = argv[1] if len(argv) > 1 else ""
    positional, opts, rest = [], {}, iter(argv[2:])
    for arg in rest:
        if arg in ("--expect-image", "--expect-revision", "--source-repo"):
            opts[arg] = next(rest, "")
        else:
            positional.append(arg)
    return mode, positional, opts


def main(argv: list[str]) -> int:
    mode, positional, opts = parse_args(argv)
    out("R44_MODE", mode.upper() if mode in ("identity", "audit", "apply", "rollback") else "UNKNOWN")
    out("R44_PYTHON", "%d.%d" % sys.version_info[:2])
    if sys.version_info < (3, 9):
        hold("R44_PYTHON", "UNSUPPORTED")
        return 3
    trust = Trust.parse(opts)
    rc = 0
    try:
        if mode == "audit":
            audit(trust)
            rc = 0 if not HOLD else 3
        elif mode == "identity":
            rc = identity_mode(trust)
        elif mode == "apply":
            rc = apply(positional[0] if positional else "", trust)
        elif mode == "rollback":
            rc = manual_rollback(positional[0] if positional else "")
        else:
            raise Stop("R44_MODE", "UNKNOWN")
    except Stop as stop:
        hold(stop.args[0], stop.args[1])
        rc = 3
    except Exception as exc:  # noqa: BLE001 - classify, never print a traceback with paths or values
        hold("R44_INTERNAL", type(exc).__name__)
        rc = 3
    if rc in (0, 4) and HOLD:
        rc = 3
    out("SECRET_PRINTED", "NO")
    out("HOLD_COUNT", len(HOLD))
    if mode in ("audit", "identity"):
        out("WRITES_PERFORMED", "NO")
    if mode == "audit":
        out("AUDIT_GATE", "PASS" if rc == 0 else "HOLD")
    if mode == "identity":
        out("IDENTITY_GATE_FINAL", {0: "PASS", 4: "OWNER_DECISION_REQUIRED"}.get(rc, "HOLD"))
    if mode in ("audit", "identity") and rc in (0, 3, 4):
        out("R44_RESULT", {0: "READ_ONLY_PASS", 3: "READ_ONLY_HOLD", 4: "OWNER_DECISION_REQUIRED"}[rc])
    elif mode in ("apply", "rollback") and rc == 3:
        out("R44_RESULT", "REFUSED_NO_CHANGE")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
