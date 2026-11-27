#!/usr/bin/env bash
# NEWSFLUX-AI-SETTINGS-01 — single read-only OMV preflight (operator-run, idempotent, sanitized, FAIL-CLOSED).
#
#   sudo bash ops/deploy/release-governance/ai-settings-readonly-preflight.sh
#   # post-promotion WallHop no-touch comparison with the digest printed by the pre-install run:
#   sudo NEWSFLUX_WALLHOP_EXPECTED_SHA256=<digest> bash ops/deploy/release-governance/ai-settings-readonly-preflight.sh
#
# Run from a checkout of the approved SHA: the reviewed flag baseline
# (ai-settings-flag-baseline.json) and the target Caddyfile are read from that checkout, never from the
# environment. Docker is used read-only (ps, inspect, image inspect, network ls, exec of stat /
# sha256sum / one python origin check). No file, container, network or setting is created or changed.
# Prints only classifications, counts, identifiers and SHA-256 of non-secret files: never environment
# values, keys, URLs, IPs, user IDs, host paths or file contents.
# Exit 0 = every gate PASS; 3 = at least one HOLD (operator decision needed before any release).
# Gates for the INITIAL canary: admin writes, inference, external transfer and paid inference OFF;
# local article processing equal to the reviewed baseline; Summary healthy, UID 10001, no published
# port, not host network; /data RW bind/volume owned by 10001 with owner rwx and not world-writable;
# HTTPS origins valid one by one (host rules and the backend's own validator); admin allowlist valid;
# Caddyfile a regular file in an accepted state; protected services running.
set -Euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -I - "$HERE" <<'PY'
import hashlib
import ipaddress
import json
import os
import re
import stat
import subprocess
import sys

HERE = sys.argv[1]
PROJECT = os.environ.get("NEWSFLUX_PROJECT", "newsflux")
SUMMARY_SERVICE = os.environ.get("NEWSFLUX_SUMMARY_SERVICE", "summary-api")
READER = os.environ.get("NEWSFLUX_READER_CONTAINER", "newsflux")
PROTECTED = os.environ.get("NEWSFLUX_PROTECTED_CONTAINERS", "miniflux miniflux-db").split()
LOCK = os.environ.get("NEWSFLUX_RELEASE_LOCK", "/run/lock/newsflux-release.lock")
WALLHOP_EXPECTED = os.environ.get("NEWSFLUX_WALLHOP_EXPECTED_SHA256")
PRE_STAGE1 = "6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108"
STAGE1 = "56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6"
CANARY_OFF = (
    "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED",
    "NEWSFLUX_AI_INFERENCE_ENABLED",
    "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER",
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE",
)
LOCAL_FLAG = "NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING"
READ_ONLY_DOCKER = {
    ("ps",), ("inspect",), ("image", "inspect"), ("network", "ls"), ("exec",),
}
READ_ONLY_EXEC = {"stat", "sha256sum", "python"}
HOLD = []


def out(key, value):
    print(f"{key}={value}", flush=True)


def hold(key, value):
    out(key, value)
    HOLD.append(key)


def docker(*args):
    """Read-only Docker access only; anything else is a programming error, never executed."""
    if not (args[:1] in READ_ONLY_DOCKER or args[:2] in READ_ONLY_DOCKER):
        raise SystemExit("PREFLIGHT_INTERNAL=NON_READ_ONLY_DOCKER_CALL")
    if args[0] == "exec" and args[2] not in READ_ONLY_EXEC:
        raise SystemExit("PREFLIGHT_INTERNAL=NON_READ_ONLY_EXEC")
    try:
        done = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def inspect(name):
    raw = docker("inspect", name)
    try:
        document = json.loads(raw)[0] if raw else None
    except (ValueError, IndexError, TypeError):
        return None
    return document if isinstance(document, dict) else None


def env_of(document):
    result = {}
    env = (document.get("Config") or {}).get("Env") if isinstance(document.get("Config"), dict) else None
    for item in env or []:
        if isinstance(item, str) and "=" in item:
            key, value = item.split("=", 1)
            result[key] = value
    return result


def flag_state(env, name):
    """ON/OFF exactly as the backend reads it (only 'true' is ON); anything else is MALFORMED."""
    if name not in env:
        return "OFF"
    value = env[name].strip().casefold()
    if value == "true":
        return "ON"
    if value in ("false", ""):
        return "OFF"
    return "MALFORMED"


HOST_LABEL = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")


def origin_ok(origin):
    match = re.fullmatch(r"https://([^/:?#@*\s]+)(?::(\d{1,5}))?/?", origin)
    if not match:
        return False
    host, port = match.group(1), match.group(2)
    if port is not None and not 1 <= int(port) <= 65535:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    labels = host.rstrip(".").split(".")
    return len(host) <= 253 and all(HOST_LABEL.fullmatch(label) for label in labels)


# Runs as `docker exec <summary> python -I -c ...`. -I keeps the check isolated (no PYTHONPATH, no user
# site, no current directory on sys.path), so the image's fixed code root (/app, Dockerfile WORKDIR,
# code at /app/services) is added explicitly. Before it is put on sys.path, /app and the whole
# /app/services tree (the auth package imports services.content_fallback transitively; cached
# bytecode included) must be real paths (no symlink), owned by root as Dockerfile COPY creates them,
# and not writable by group/others; otherwise UNSAFE_IMPORT_PATH. Every loaded services.* module must
# then come from that tree. Bytecode writing is disabled, so the check creates no file.
# Prints only VALID, INVALID, IMPORT_FAILED or UNSAFE_IMPORT_PATH; never an origin value.
BACKEND_ORIGIN_CHECK = (
    "import os,stat,sys\n"
    "sys.dont_write_bytecode=True\n"
    "root='/app'\n"
    "TRUSTED_UID=0\n"
    "tree=os.path.join(root,'services')\n"
    "def unsafe(p):\n"
    "    try:\n"
    "        st=os.lstat(p)\n"
    "    except OSError:\n"
    "        return True\n"
    "    return stat.S_ISLNK(st.st_mode) or st.st_uid!=TRUSTED_UID or bool(st.st_mode&0o022)\n"
    "if not os.path.lexists(tree):\n"
    "    print('IMPORT_FAILED');sys.exit(0)\n"
    "paths=[root,tree]\n"
    "if not any(unsafe(p) for p in paths):\n"
    "    for d,dirs,files in os.walk(tree):\n"
    "        paths.extend(os.path.join(d,n) for n in dirs+files)\n"
    "if any(unsafe(p) for p in paths) or os.path.realpath(tree)!=tree:\n"
    "    print('UNSAFE_IMPORT_PATH');sys.exit(0)\n"
    "sys.path.insert(0,root)\n"
    "try:\n"
    "    import services.article_intel_auth.config as c\n"
    "    f=c.canonicalize_web_origin\n"
    "except Exception:\n"
    "    print('IMPORT_FAILED');sys.exit(0)\n"
    "mods=[m for n,m in list(sys.modules.items()) if n=='services' or n.startswith('services.')]\n"
    "if any(not os.path.realpath(getattr(m,'__file__',None) or '/').startswith(tree+os.sep) for m in mods):\n"
    "    print('UNSAFE_IMPORT_PATH');sys.exit(0)\n"
    "items=[v.strip() for v in os.environ.get('NEWSFLUX_AI_ALLOWED_WEB_ORIGINS','').split(',')]\n"
    "try:\n"
    "    ok=bool(items) and all(items) and all(f(v) for v in items)\n"
    "except Exception:\n"
    "    ok=False\n"
    "print('VALID' if ok else 'INVALID')\n"
)


def check_summary():
    raw = docker("ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}",
                 "--filter", f"label=com.docker.compose.service={SUMMARY_SERVICE}")
    if raw is None:
        hold("DOCKER", "UNAVAILABLE")
        return
    names = [line for line in raw.splitlines() if line.strip()]
    if len(names) != 1:
        hold("SUMMARY_CONTAINER", "NOT_UNIQUE")
        return
    name = names[0]
    doc = inspect(name)
    if doc is None:
        hold("SUMMARY_CONTAINER", "INSPECT_FAILED")
        return
    out("SUMMARY_CONTAINER", "UNIQUE")
    image = doc.get("Image") if isinstance(doc.get("Image"), str) else ""
    out("SUMMARY_IMAGE", image or "UNKNOWN")
    image_doc = docker("image", "inspect", image) if image else None
    try:
        revision = json.loads(image_doc)[0]["Config"]["Labels"]["org.opencontainers.image.revision"]
    except (TypeError, ValueError, KeyError, IndexError):
        revision = None
    out("SUMMARY_REVISION", revision if isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision) else "UNKNOWN")

    state = doc.get("State")
    health = "UNKNOWN"
    if isinstance(state, dict):
        health_doc = state.get("Health")
        health = health_doc.get("Status", "UNKNOWN") if isinstance(health_doc, dict) else "none"
        if health not in ("healthy", "unhealthy", "starting", "none"):
            health = "UNKNOWN"
    (out if health == "healthy" else hold)("SUMMARY_HEALTH", health)

    config = doc.get("Config") if isinstance(doc.get("Config"), dict) else {}
    user = config.get("User")
    (out("SUMMARY_USER", "UID10001") if user in ("10001:10001", "10001") else hold("SUMMARY_USER", "NOT_10001"))

    host = doc.get("HostConfig") if isinstance(doc.get("HostConfig"), dict) else {}
    published = 0
    for source in (host.get("PortBindings"), (doc.get("NetworkSettings") or {}).get("Ports")
                   if isinstance(doc.get("NetworkSettings"), dict) else None):
        if source is None:
            continue
        if not isinstance(source, dict):
            published += 1
            continue
        for bindings in source.values():
            if bindings:
                published += len(bindings) if isinstance(bindings, list) else 1
    out("SUMMARY_PUBLISHED_PORTS", str(published))
    (out if published == 0 else hold)("SUMMARY_PUBLISHED_PORTS_GATE", "PASS" if published == 0 else "HOLD")
    mode = host.get("NetworkMode")
    if mode == "host":
        hold("SUMMARY_NETWORK_MODE", "HOST")
    elif isinstance(mode, str) and mode:
        out("SUMMARY_NETWORK_MODE", "NOT_HOST")
    else:
        hold("SUMMARY_NETWORK_MODE", "UNKNOWN")
    labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
    files = [f for f in str(labels.get("com.docker.compose.project.config_files", "")).split(",") if f]
    out("SUMMARY_COMPOSE_FILES", str(len(files)))

    check_data(name, doc)
    check_env(name, env_of(doc))


def check_data(name, doc):
    mounts = doc.get("Mounts") if isinstance(doc.get("Mounts"), list) else []
    data = [m for m in mounts if isinstance(m, dict) and m.get("Destination") == "/data"]
    if not data:
        hold("DATA_MOUNT", "ABSENT")
        return
    mount = data[0]
    if mount.get("Type") not in ("bind", "volume"):
        hold("DATA_MOUNT", "TYPE_NOT_ALLOWED")
        return
    out("DATA_MOUNT", mount["Type"])
    rw = mount.get("RW") is True
    (out if rw else hold)("DATA_MOUNT_RW", "RW" if rw else "RO")
    raw = docker("exec", name, "stat", "-c", "%u %g %a %F", "/data")
    if raw is None:
        hold("DATA_STAT", "UNVERIFIED")
        hold("DATA_WRITABLE_BY_UID10001", "UNVERIFIED")
        return
    parts = raw.strip().split(" ", 3)
    if len(parts) != 4 or not parts[0].isdecimal() or not parts[1].isdecimal() or not re.fullmatch(r"[0-7]{3,4}", parts[2]):
        hold("DATA_STAT", "MALFORMED")
        hold("DATA_WRITABLE_BY_UID10001", "UNVERIFIED")
        return
    uid, mode_bits, kind = int(parts[0]), int(parts[2], 8), parts[3]
    out("DATA_STAT", "READ")
    owner_ok = uid == 10001
    (out("DATA_OWNER", "UID10001") if owner_ok else hold("DATA_OWNER", "NOT_10001"))
    is_dir = kind == "directory"
    (out("DATA_TYPE", "DIRECTORY") if is_dir else hold("DATA_TYPE", "NOT_DIRECTORY"))
    out("DATA_MODE", f"{mode_bits:o}")
    world_writable = bool(mode_bits & stat.S_IWOTH)
    (hold("DATA_WORLD_WRITABLE", "YES") if world_writable else out("DATA_WORLD_WRITABLE", "NO"))
    owner_rwx = (mode_bits & stat.S_IRWXU) == stat.S_IRWXU
    if owner_ok and is_dir and owner_rwx and rw:
        out("DATA_WRITABLE_BY_UID10001", "PROVEN_BY_METADATA")
    else:
        hold("DATA_WRITABLE_BY_UID10001", "UNVERIFIED")
    managed = docker("exec", name, "stat", "-c", "%u %g %a %F", "/data/newsflux-ai-settings")
    if managed is None:
        out("MANAGED_SETTINGS_DIR", "ABSENT")
    else:
        m = managed.strip().split(" ", 3)
        if len(m) == 4 and m[0] == "10001" and m[2] == "700" and m[3] == "directory":
            out("MANAGED_SETTINGS_DIR", "PRESENT_PRIVATE")
        else:
            hold("MANAGED_SETTINGS_DIR", "PRESENT_UNSAFE")


def check_env(name, env):
    ids = env.get("NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS")
    if ids is None or not ids.strip():
        hold("ADMIN_ALLOWLIST", "EMPTY")
    else:
        items = [v.strip() for v in ids.split(",")]
        valid = all(v.isascii() and v.isdecimal() and 1 <= int(v) <= 9_223_372_036_854_775_807 for v in items if v) \
            and all(items)
        (out("ADMIN_ALLOWLIST", f"CONFIGURED_COUNT_{len(set(items))}") if valid else hold("ADMIN_ALLOWLIST", "INVALID"))

    raw = env.get("NEWSFLUX_AI_ALLOWED_WEB_ORIGINS", "")
    if not raw.strip():
        hold("ALLOWED_ORIGINS", "EMPTY")
    else:
        items = [v.strip() for v in raw.split(",")]
        valid = all(items) and all(origin_ok(v) for v in items)
        (out("ALLOWED_ORIGINS", f"VALID_COUNT_{len(items)}") if valid else hold("ALLOWED_ORIGINS", "INVALID"))
    backend = docker("exec", name, "python", "-I", "-c", BACKEND_ORIGIN_CHECK)
    verdict = backend.strip() if backend is not None else None
    if verdict == "VALID":
        out("ALLOWED_ORIGINS_BACKEND", "VALID")
    elif verdict in ("INVALID", "UNSAFE_IMPORT_PATH"):
        hold("ALLOWED_ORIGINS_BACKEND", verdict)
    else:  # exec failed, import failed (IMPORT_FAILED) or unexpected output
        hold("ALLOWED_ORIGINS_BACKEND", "UNVERIFIED")

    key_file = env.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE", "")
    (out("BOOTSTRAP_KEY_FILE_CONFIGURED", "YES") if key_file.strip() else hold("BOOTSTRAP_KEY_FILE_CONFIGURED", "NO"))
    out("ENV_MODEL_POLICY", "PRESENT" if env.get("NEWSFLUX_AI_MODEL_POLICY_JSON", "").strip() else "ABSENT_LEGACY")

    for flag in CANARY_OFF:
        value = flag_state(env, flag)
        (out if value == "OFF" else hold)(flag.removeprefix("NEWSFLUX_AI_"), value)

    baseline = None
    try:
        with open(os.path.join(HERE, "ai-settings-flag-baseline.json"), encoding="utf-8") as handle:
            document = json.load(handle)
        candidate = document["flags"][LOCAL_FLAG] if document.get("version") == 1 else None
        baseline = candidate if candidate in ("ON", "OFF") else None
    except (OSError, ValueError, KeyError, TypeError):
        baseline = None
    actual = flag_state(env, LOCAL_FLAG)
    (out if actual in ("ON", "OFF") else hold)(LOCAL_FLAG.removeprefix("NEWSFLUX_AI_"), actual)
    if baseline is None:
        hold("LOCAL_PROCESSING_BASELINE", "UNAVAILABLE")
        hold("LOCAL_PROCESSING_BASELINE_GATE", "UNVERIFIED")
    else:
        out("LOCAL_PROCESSING_BASELINE", baseline)
        (out("LOCAL_PROCESSING_BASELINE_GATE", "MATCH") if actual == baseline
         else hold("LOCAL_PROCESSING_BASELINE_GATE", "DRIFT"))


def check_reader():
    doc = inspect(READER)
    if doc is None:
        hold("READER_CONTAINER", "INSPECT_FAILED")
        return
    out("READER_CONTAINER", "PRESENT")
    image = doc.get("Image") if isinstance(doc.get("Image"), str) else ""
    out("READER_IMAGE", image or "UNKNOWN")
    config = doc.get("Config") if isinstance(doc.get("Config"), dict) else {}
    labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
    out("READER_SERVICE", "PRESENT" if labels.get("com.docker.compose.service") else "UNKNOWN")
    proxy = env_of(doc).get("NEWSFLUX_PILOT_TRUSTED_PROXY_IP")
    if proxy is None or not proxy.strip():
        hold("TRUSTED_PROXY_IP", "ABSENT")
    else:
        try:
            address = ipaddress.ip_address(proxy.strip())
            ok = not (address.is_unspecified or address.is_multicast)
        except ValueError:
            ok = False
        (out("TRUSTED_PROXY_IP", "CONFIGURED") if ok else hold("TRUSTED_PROXY_IP", "INVALID"))

    mounts = doc.get("Mounts") if isinstance(doc.get("Mounts"), list) else []
    sources = [m.get("Source") for m in mounts if isinstance(m, dict) and m.get("Destination") == "/etc/caddy/Caddyfile"]
    if not sources or not sources[0]:
        hold("CADDYFILE_MOUNT", "ABSENT")
        return
    source = sources[0]
    if os.path.islink(source):
        hold("CADDYFILE_MOUNT", "SYMLINK")
        return
    if not os.path.isfile(source):
        hold("CADDYFILE_MOUNT", "NOT_REGULAR_FILE")
        return
    out("CADDYFILE_MOUNT", "REGULAR_FILE")
    with open(source, "rb") as handle:
        host_sha = hashlib.sha256(handle.read()).hexdigest()
    container = docker("exec", READER, "sha256sum", "/etc/caddy/Caddyfile")
    out("ACTIVE_CADDY_SHA256", host_sha)
    (out if container and container.split()[0] == host_sha else hold)(
        "CADDY_CONTAINER_READBACK", "MATCH" if container and container.split()[0] == host_sha else "MISMATCH")
    target = None
    try:
        with open(os.path.join(HERE, "..", "article-intel-pilot", "Caddyfile"), "rb") as handle:
            target = hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        target = None
    if host_sha == STAGE1:
        out("CADDY_STATE", "STAGE1_ACCEPTED_PRIOR")
    elif host_sha == PRE_STAGE1:
        out("CADDY_STATE", "PRE_STAGE1_ACCEPTED_PRIOR")
    elif target is not None and host_sha == target:
        out("CADDY_STATE", "TARGET_ALREADY_APPLIED")
    else:
        hold("CADDY_STATE", "UNKNOWN_DRIFT")
    info = os.stat(source)
    out("CADDYFILE_MODE", f"{stat.S_IMODE(info.st_mode):o}")
    out("CADDYFILE_INODE", str(info.st_ino))


def check_protected():
    for name in PROTECTED:
        doc = inspect(name)
        if doc is None:
            hold(f"PROTECTED_{name}", "ABSENT")
            continue
        state = doc.get("State") if isinstance(doc.get("State"), dict) else {}
        if state.get("Running") is True:
            out(f"PROTECTED_{name}", f"RUNNING {doc.get('Image', 'UNKNOWN')}")
        else:
            hold(f"PROTECTED_{name}", "NOT_RUNNING")


def check_wallhop():
    containers = docker("ps", "-a", "--no-trunc", "--filter", "name=wallhop",
                        "--format", "{{.ID}} {{.Image}} {{.Names}} {{.State}}")
    networks = docker("network", "ls", "--no-trunc", "--filter", "name=wallhop", "--format", "{{.ID}} {{.Name}}")
    if containers is None or networks is None:
        hold("WALLHOP_INVENTORY", "UNAVAILABLE")
        return
    lines = sorted(l for l in containers.splitlines() if l.strip()) + sorted("net " + l for l in networks.splitlines() if l.strip())
    digest = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    out("WALLHOP_RESOURCES", str(len(lines)))
    out("WALLHOP_INVENTORY_SHA256", digest)
    if WALLHOP_EXPECTED is None:
        out("WALLHOP_INTEGRITY", "UNVERIFIED_NO_BASELINE")
    elif not re.fullmatch(r"[0-9a-f]{64}", WALLHOP_EXPECTED):
        hold("WALLHOP_INTEGRITY", "EXPECTED_DIGEST_MALFORMED")
    elif WALLHOP_EXPECTED == digest:
        out("WALLHOP_INTEGRITY", "MATCHES_PRIOR_INVENTORY")
        out("WALLHOP_UNAUTHORIZED_MUTATIONS", "0")
    else:
        hold("WALLHOP_INTEGRITY", "CHANGED_SINCE_PRIOR_INVENTORY")
        out("WALLHOP_UNAUTHORIZED_MUTATIONS", "DETECTED")


def main():
    if docker("ps", "-q") is None:
        hold("DOCKER", "UNAVAILABLE")
    else:
        check_summary()
        check_reader()
        check_protected()
        check_wallhop()
        out("RELEASE_LOCK_FILE", "PRESENT" if os.path.exists(LOCK) else "ABSENT")
    out("SECRET_PRINTED", "NO")
    out("WRITES_PERFORMED", "NO")
    out("HOLD_COUNT", str(len(HOLD)))
    if HOLD:
        out("PREFLIGHT", "HOLD")
        return 3
    out("PREFLIGHT", "PASS")
    return 0


sys.exit(main())
PY
