#!/usr/bin/env python3
"""Governed, service-scoped Docker Compose release tool.

Subcommands (all print only gate names, identifiers and hashes; never environment
values, secrets or file contents):

  inspect   read-only evidence for one Compose project
  plan      build a durable release manifest for an exact candidate image
  promote   verify the manifest against live state, then recreate only the
            selected service with the exact candidate image ID
  rollback  restore the manifest's previous image when, and only when, the live
            state still corresponds to that release

Safety properties:
  * a closed policy decides which (project, service) pairs may ever be touched;
    Miniflux, its database and NPM are always forbidden;
  * Compose files are taken from the running container's own labels, in order,
    and must hash to the manifest values (configuration drift blocks);
  * the candidate image is an immutable image ID whose OCI revision label must
    equal the approved commit SHA;
  * protected containers must keep their exact container ID, image and config
    hash before and after the operation;
  * a host-wide exclusive lock (flock) serializes release operations;
  * only `docker compose up -d --no-deps --no-build --pull never <service>` is
    ever executed, with a release-owned override that pins the image ID;
  * a failed promotion is rolled back automatically; rollback is idempotent and
    refuses when the live state is neither the candidate nor the previous image.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

MANIFEST_VERSION = "newsflux-release-manifest-v1"
IMAGE_ID_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
SHA_RE = re.compile(r"^[a-f0-9]{40}$")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,62}$")
REVISION_LABELS = ("org.opencontainers.image.revision", "org.newsflux.source-revision")
ALWAYS_FORBIDDEN_SERVICES = frozenset({"miniflux", "miniflux-db", "db", "postgres", "npm", "nginx-proxy-manager", "app"})
ALWAYS_FORBIDDEN_PROJECTS = frozenset({"miniflux", "npm", "npm-proxyyml"})
DEFAULT_LOCK = "/run/lock/newsflux-release.lock"
DEFAULT_POLICY = Path(__file__).with_name("policy.json")


class GateError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def require(condition: object, code: str) -> None:
    if not condition:
        raise GateError(code)


Runner = Callable[[Sequence[str]], str]


def run_docker(args: Sequence[str]) -> str:
    """Run a docker CLI command; output stays in memory and is never echoed."""
    completed = subprocess.run(
        ["docker", *args], check=False, capture_output=True, text=True, timeout=300
    )
    if completed.returncode != 0:
        raise GateError("DOCKER_COMMAND_FAILED")
    return completed.stdout


def sha256_file(path: Path) -> str:
    require(path.is_absolute() and path.is_file() and not path.is_symlink(), "COMPOSE_FILE_INVALID")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_policy(path: Path) -> set[tuple[str, str]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    require(document.get("version") == "newsflux-release-policy-v1", "POLICY_INVALID")
    allowed = set()
    for item in document["allowed"]:
        project, service = item["project"], item["service"]
        require(NAME_RE.fullmatch(project) and NAME_RE.fullmatch(service), "POLICY_INVALID")
        require(service not in ALWAYS_FORBIDDEN_SERVICES and project not in ALWAYS_FORBIDDEN_PROJECTS, "POLICY_FORBIDDEN_TARGET")
        allowed.add((project, service))
    return allowed


@dataclass(frozen=True)
class ContainerIdentity:
    container_id: str
    name: str
    project: str
    service: str
    image_id: str
    config_hash: str
    config_files: tuple[str, ...]
    working_dir: str
    env_files: tuple[str, ...]
    networks: tuple[str, ...]
    mounts: tuple[tuple[str, str, str, bool], ...]
    published_ports: int
    health: str | None
    running: bool

    def protected_fingerprint(self) -> dict[str, str]:
        return {"container_id": self.container_id, "image_id": self.image_id, "config_hash": self.config_hash}


def _parse_container(document: dict) -> ContainerIdentity:
    labels = document.get("Config", {}).get("Labels") or {}
    files = tuple(item for item in labels.get("com.docker.compose.project.config_files", "").split(",") if item)
    env_files = tuple(item for item in labels.get("com.docker.compose.project.environment_file", "").split(",") if item)
    mounts = tuple(
        sorted(
            (
                str(mount.get("Type", "")),
                str(mount.get("Name") or mount.get("Source") or ""),
                str(mount.get("Destination", "")),
                bool(mount.get("RW", False)),
            )
            for mount in document.get("Mounts") or []
        )
    )
    ports = document.get("HostConfig", {}).get("PortBindings") or {}
    state = document.get("State", {})
    health = (state.get("Health") or {}).get("Status")
    return ContainerIdentity(
        container_id=document["Id"],
        name=document.get("Name", "").lstrip("/"),
        project=labels.get("com.docker.compose.project", ""),
        service=labels.get("com.docker.compose.service", ""),
        image_id=document["Image"],
        config_hash=labels.get("com.docker.compose.config-hash", ""),
        config_files=files,
        working_dir=labels.get("com.docker.compose.project.working_dir", ""),
        env_files=env_files,
        networks=tuple(sorted((document.get("NetworkSettings", {}).get("Networks") or {}).keys())),
        mounts=mounts,
        published_ports=sum(len(bindings or []) for bindings in ports.values()),
        health=health,
        running=bool(state.get("Running")),
    )


class Docker:
    def __init__(self, runner: Runner = run_docker) -> None:
        self.run = runner

    def containers(self, *, project: str | None = None) -> list[ContainerIdentity]:
        args = ["ps", "-aq", "--no-trunc"]
        if project:
            args += ["--filter", f"label=com.docker.compose.project={project}"]
        ids = [line for line in self.run(args).split() if line]
        if not ids:
            return []
        return [_parse_container(item) for item in json.loads(self.run(["inspect", *ids]))]

    def container_by_name(self, name: str) -> ContainerIdentity:
        found = [c for c in self.containers() if c.name == name]
        require(len(found) == 1, "PROTECTED_CONTAINER_MISSING")
        return found[0]

    def service_container(self, project: str, service: str) -> ContainerIdentity:
        found = [c for c in self.containers(project=project) if c.service == service]
        require(len(found) == 1, "SERVICE_CONTAINER_NOT_UNIQUE")
        return found[0]

    def image_labels(self, image_id: str) -> dict[str, str]:
        document = json.loads(self.run(["image", "inspect", image_id]))
        require(len(document) == 1 and document[0]["Id"] == image_id, "IMAGE_NOT_FOUND")
        return document[0].get("Config", {}).get("Labels") or {}

    def compose_up(self, identity: ContainerIdentity, files: Sequence[str], override: Path, service: str) -> None:
        args = ["compose", "-p", identity.project, "--project-directory", identity.working_dir]
        for env_file in identity.env_files:
            args += ["--env-file", env_file]
        for item in files:
            args += ["-f", item]
        args += ["-f", str(override), "up", "-d", "--no-deps", "--no-build", "--pull", "never", service]
        self.run(args)


@contextlib.contextmanager
def release_lock(path: str):
    lock_path = Path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise GateError("CONCURRENT_RELEASE_BLOCKED") from None
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _atomic_write(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".release-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _manifest_digest(manifest: dict) -> str:
    body = {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def build_manifest(
    docker: Docker,
    *,
    project: str,
    service: str,
    candidate_image: str,
    approved_sha: str,
    protected: Sequence[str],
    policy: set[tuple[str, str]],
    release_dir: Path,
) -> dict:
    require((project, service) in policy, "SERVICE_NOT_AUTHORIZED")
    require(IMAGE_ID_RE.fullmatch(candidate_image), "CANDIDATE_IMAGE_NOT_IMMUTABLE")
    require(SHA_RE.fullmatch(approved_sha), "APPROVED_SHA_INVALID")
    require(release_dir.is_absolute(), "RELEASE_DIR_INVALID")
    require(protected, "PROTECTED_SET_EMPTY")
    target = docker.service_container(project, service)
    require(target.name not in protected, "TARGET_IS_PROTECTED")
    require(target.config_files and target.working_dir, "COMPOSE_LABELS_MISSING")
    require(target.image_id != candidate_image, "CANDIDATE_EQUALS_CURRENT")
    labels = docker.image_labels(candidate_image)
    require(any(labels.get(label) == approved_sha for label in REVISION_LABELS), "CANDIDATE_REVISION_MISMATCH")
    compose = [{"path": item, "sha256": sha256_file(Path(item))} for item in target.config_files]
    env_files = [{"path": item, "sha256": sha256_file(Path(item))} for item in target.env_files]
    protected_state = {name: docker.container_by_name(name).protected_fingerprint() for name in protected}
    manifest = {
        "version": MANIFEST_VERSION,
        "created_at": int(time.time()),
        "project": project,
        "service": service,
        "approved_sha": approved_sha,
        "candidate_image": candidate_image,
        "previous_image": target.image_id,
        "previous_container_id": target.container_id,
        "working_dir": target.working_dir,
        "compose_files": compose,
        "env_files": env_files,
        "networks": list(target.networks),
        "mounts": [list(item) for item in target.mounts],
        "published_ports": target.published_ports,
        "protected": protected_state,
        "release_dir": str(release_dir),
    }
    manifest["manifest_sha256"] = _manifest_digest(manifest)
    return manifest


def verify_manifest(manifest: dict, policy: set[tuple[str, str]]) -> None:
    require(manifest.get("version") == MANIFEST_VERSION, "MANIFEST_INVALID")
    require(manifest.get("manifest_sha256") == _manifest_digest(manifest), "MANIFEST_TAMPERED")
    require((manifest["project"], manifest["service"]) in policy, "SERVICE_NOT_AUTHORIZED")
    for key in ("candidate_image", "previous_image"):
        require(IMAGE_ID_RE.fullmatch(manifest[key]), "MANIFEST_INVALID")


def _override_document(manifest: dict, image: str) -> str:
    return json.dumps({"services": {manifest["service"]: {"image": image, "pull_policy": "never"}}}, indent=2) + "\n"


def _release_overrides(manifest: dict) -> dict[str, str]:
    directory = Path(manifest["release_dir"])
    return {
        str(directory / "candidate.override.json"): _override_document(manifest, manifest["candidate_image"]),
        str(directory / "rollback.override.json"): _override_document(manifest, manifest["previous_image"]),
    }


def _check_configuration(manifest: dict, identity: ContainerIdentity) -> None:
    base = [item["path"] for item in manifest["compose_files"]]
    files = list(identity.config_files)
    # Compose records every -f file in the container labels. After a release-owned
    # transition the sequence is the approved base plus exactly one release override,
    # whose content must be byte-identical to what this manifest produces.
    if files != base:
        overrides = _release_overrides(manifest)
        require(files[:-1] == base and files[-1] in overrides, "COMPOSE_SEQUENCE_DRIFT")
        override = Path(files[-1])
        require(override.is_file() and not override.is_symlink(), "COMPOSE_SEQUENCE_DRIFT")
        require(override.read_text(encoding="utf-8") == overrides[files[-1]], "CONFIGURATION_DRIFT")
    for item in manifest["compose_files"] + manifest["env_files"]:
        require(sha256_file(Path(item["path"])) == item["sha256"], "CONFIGURATION_DRIFT")
    require(identity.working_dir == manifest["working_dir"], "CONFIGURATION_DRIFT")
    require(list(identity.env_files) == [item["path"] for item in manifest["env_files"]], "CONFIGURATION_DRIFT")


def _check_shape(manifest: dict, identity: ContainerIdentity) -> None:
    require(list(identity.networks) == manifest["networks"], "NETWORK_DRIFT")
    require([list(item) for item in identity.mounts] == manifest["mounts"], "VOLUME_DRIFT")
    require(identity.published_ports == manifest["published_ports"], "PORT_DRIFT")


def _check_protected(docker: Docker, manifest: dict) -> None:
    for name, expected in manifest["protected"].items():
        require(docker.container_by_name(name).protected_fingerprint() == expected, "PROTECTED_SERVICE_DRIFT")


def _wait_healthy(docker: Docker, manifest: dict, image: str, timeout: float) -> ContainerIdentity:
    deadline = time.monotonic() + timeout
    while True:
        identity = docker.service_container(manifest["project"], manifest["service"])
        healthy = identity.running and identity.image_id == image and identity.health in (None, "healthy")
        if healthy:
            return identity
        if identity.health == "unhealthy" or time.monotonic() > deadline:
            raise GateError("HEALTHCHECK_FAILED")
        time.sleep(1)


def _override(manifest: dict, image: str, name: str) -> Path:
    path = Path(manifest["release_dir"]) / f"{name}.override.json"
    _atomic_write(path, _override_document(manifest, image), 0o644)
    return path


def _journal(manifest: dict, event: str, **details: object) -> None:
    path = Path(manifest["release_dir"]) / "journal.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"at": int(time.time()), "event": event, "manifest": manifest["manifest_sha256"], **details}) + "\n")
        output.flush()
        os.fsync(output.fileno())


def _transition(docker: Docker, manifest: dict, *, source: str, target: str, name: str, timeout: float) -> str:
    identity = docker.service_container(manifest["project"], manifest["service"])
    if identity.image_id == target:
        _check_configuration(manifest, identity)
        _check_protected(docker, manifest)
        return "ALREADY_APPLIED"
    require(identity.image_id == source, "LIVE_STATE_DOES_NOT_MATCH_RELEASE")
    _check_configuration(manifest, identity)
    _check_shape(manifest, identity)
    _check_protected(docker, manifest)
    override = _override(manifest, target, name)
    docker.compose_up(identity, [item["path"] for item in manifest["compose_files"]], override, manifest["service"])
    _wait_healthy(docker, manifest, target, timeout)
    _check_shape(manifest, docker.service_container(manifest["project"], manifest["service"]))
    _check_protected(docker, manifest)
    return "APPLIED"


def promote(docker: Docker, manifest: dict, policy: set, *, lock: str, timeout: float = 120) -> str:
    verify_manifest(manifest, policy)
    with release_lock(lock):
        _journal(manifest, "promote_started")
        try:
            result = _transition(docker, manifest, source=manifest["previous_image"], target=manifest["candidate_image"], name="candidate", timeout=timeout)
        except GateError as error:
            current = docker.service_container(manifest["project"], manifest["service"]).image_id
            if current == manifest["previous_image"]:
                # Blocked before any change (drift, concurrency, protected services): nothing to undo.
                _journal(manifest, "promote_blocked", code=error.code)
                raise
            if current != manifest["candidate_image"]:
                _journal(manifest, "promote_unknown_state", code=error.code)
                raise GateError("UNKNOWN_STATE_MANUAL_DECISION_REQUIRED") from None
            _journal(manifest, "promote_failed_auto_rollback", code=error.code)
            _transition(docker, manifest, source=manifest["candidate_image"], target=manifest["previous_image"], name="rollback", timeout=timeout)
            _journal(manifest, "auto_rollback_completed")
            raise GateError(f"PROMOTION_FAILED_ROLLED_BACK:{error.code}") from None
        _journal(manifest, "promote_completed", result=result)
        return result


def rollback(docker: Docker, manifest: dict, policy: set, *, lock: str, timeout: float = 120) -> str:
    verify_manifest(manifest, policy)
    with release_lock(lock):
        result = _transition(docker, manifest, source=manifest["candidate_image"], target=manifest["previous_image"], name="rollback", timeout=timeout)
        _journal(manifest, "rollback_completed", result=result)
        return result


def inspect_project(docker: Docker, project: str) -> dict:
    containers = docker.containers(project=project)
    return {
        "project": project,
        "containers": [
            {
                "name": c.name,
                "service": c.service,
                "container_id": c.container_id,
                "image_id": c.image_id,
                "config_hash": c.config_hash,
                "compose_files": [{"path": item, "sha256": sha256_file(Path(item)) if Path(item).is_file() else None} for item in c.config_files],
                "env_files": list(c.env_files),
                "working_dir": c.working_dir,
                "networks": list(c.networks),
                "mounts": [{"type": m[0], "source": m[1], "target": m[2], "rw": m[3]} for m in c.mounts],
                "published_ports": c.published_ports,
                "health": c.health,
            }
            for c in containers
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--policy", default=str(DEFAULT_POLICY))
    parser.add_argument("--lock", default=DEFAULT_LOCK)
    sub = parser.add_subparsers(dest="command", required=True)
    p_inspect = sub.add_parser("inspect")
    p_inspect.add_argument("--project", required=True)
    p_plan = sub.add_parser("plan")
    p_plan.add_argument("--project", required=True)
    p_plan.add_argument("--service", required=True)
    p_plan.add_argument("--candidate-image", required=True)
    p_plan.add_argument("--approved-sha", required=True)
    p_plan.add_argument("--protected", action="append", default=[])
    p_plan.add_argument("--release-dir", required=True)
    for name in ("promote", "rollback"):
        p = sub.add_parser(name)
        p.add_argument("--manifest", required=True)
        p.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args(argv)
    docker = Docker()
    try:
        if args.command == "inspect":
            print(json.dumps(inspect_project(docker, args.project), indent=2))
            return 0
        policy = load_policy(Path(args.policy))
        if args.command == "plan":
            release_dir = Path(args.release_dir)
            manifest = build_manifest(
                docker, project=args.project, service=args.service, candidate_image=args.candidate_image,
                approved_sha=args.approved_sha, protected=args.protected, policy=policy, release_dir=release_dir,
            )
            path = release_dir / "manifest.json"
            require(not path.exists(), "MANIFEST_ALREADY_EXISTS")
            _atomic_write(path, json.dumps(manifest, indent=2, sort_keys=True) + "\n", 0o444)
            print(f"PLAN=PASS MANIFEST={path} MANIFEST_SHA256={manifest['manifest_sha256']}")
            return 0
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        action = promote if args.command == "promote" else rollback
        result = action(docker, manifest, policy, lock=args.lock, timeout=args.timeout)
        print(f"{args.command.upper()}={result} SERVICE={manifest['project']}/{manifest['service']}")
        return 0
    except GateError as error:
        print(f"{args.command.upper()}=BLOCKED CODE={error.code}")
        return 1
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(f"{args.command.upper()}=BLOCKED CODE=INVALID_INPUT")
        return 1


if __name__ == "__main__":
    sys.exit(main())
