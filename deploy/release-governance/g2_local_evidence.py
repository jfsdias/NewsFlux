#!/usr/bin/env python3
"""S5-R3B G2_LOCAL_INDEPENDENT: offline evidence for the diagnostic executor's G2 gate when no GitHub Actions run
exists. It is NOT a way to skip CI: it requires the same workflow steps (plus the R3/R3A rehearsals), run twice by
two distinct producers at the exact commit and tree, and a detached review signed by a third-party reviewer.

    run      execute every step of g2-local-test-manifest.json in a clean exact checkout on an exclusive Docker
             daemon; write a bundle (EVIDENCE_MANIFEST.json, TEST_RESULTS.json, ENVIRONMENT_PROVENANCE.json,
             SANITIZED_RECEIPT.txt, REPLAY_INSTRUCTIONS.md, SHA256SUMS, SHA256SUMS.sig); full logs stay private
    approve  a reviewer checks both bundles (producer + independent replay) and writes a signed detached approval
    verify   (used by s5-r3-omv-readonly-run.sh) every check below; prints one G2L_RESULT=PASS|HOLD_<code> line

No hash cycle: the approval names the SHA-256 of each bundle's SHA256SUMS, which names every bundle file; the
manifest names the bound source files. Signatures use OpenSSH (`ssh-keygen -Y`), namespaced per document kind.
Signers are accepted only from the allowed-signers text the caller passes (the wrapper's PM-admitted table)."""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
import uuid

EVIDENCE_SCHEMA = "newsflux.g2-local-evidence/v1"
APPROVAL_SCHEMA = "newsflux.g2-local-approval/v1"
TEST_MANIFEST_SCHEMA = "newsflux.g2-local-test-manifest/v1"
REPOSITORY = "jfsdias/NewsFlux"
NS_EVIDENCE = "newsflux-g2-local-evidence"
NS_APPROVAL = "newsflux-g2-local-approval"
APPROVAL_VERDICT = "APPROVE_G2_LOCAL_DIAGNOSTIC_ONLY"
APPROVAL_SCOPE = "S5_R3_OMV_READONLY_DIAGNOSTIC"
TEST_MANIFEST_PATH = "deploy/release-governance/g2-local-test-manifest.json"
BOUND_FILES = {
    "auditor": "deploy/release-governance/s5_db_readonly_audit.py",
    "wrapper": "deploy/release-governance/s5-r3-omv-readonly-run.sh",
    "executor": "deploy/release-governance/s5-r3-omv-executor.sh",
    "workflow": ".github/workflows/summary-release-rehearsal.yaml",
    "test_manifest": TEST_MANIFEST_PATH,
    "verifier": "deploy/release-governance/g2_local_evidence.py",
}
BUNDLE_FILES = ("EVIDENCE_MANIFEST.json", "TEST_RESULTS.json", "ENVIRONMENT_PROVENANCE.json", "SANITIZED_RECEIPT.txt",
                "REPLAY_INSTRUCTIONS.md")
SUMS, SUMS_SIG = "SHA256SUMS", "SHA256SUMS.sig"
MANIFEST_KEYS = ("schema", "repository", "commit", "tree", "clean_checkout", "role", "principal", "run_id",
                 "started_at", "finished_at", "completed", "interrupted", "bound_files", "bundle_files")
STEP_STATUSES = {"PASS", "FAIL", "ERROR", "SKIPPED", "BLOCKED"}
SECRET_PATTERNS = (r"sk-[A-Za-z0-9_-]{20,}", r"gh[pousr]_[A-Za-z0-9]{20,}", r"github_pat_[A-Za-z0-9_]{20,}",
                   r"AKIA[0-9A-Z]{16}", r"-----BEGIN [A-Z ]*PRIVATE KEY-----", r"xox[abprs]-[A-Za-z0-9-]{10,}",
                   r"AIza[0-9A-Za-z_-]{30,}", r"(?i)bearer\s+(?!synthetic)[A-Za-z0-9._~+/-]{24,}")
HEX40, HEX64 = re.compile(r"^[0-9a-f]{40}$"), re.compile(r"^[0-9a-f]{64}$")


class Hold(Exception):
    """A verification failure: the code is printed as G2L_RESULT=HOLD_<code> and nothing is accepted."""


def sha256_file(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def git(src: str, *args: str) -> str:
    return subprocess.run(["git", "-C", src, *args], capture_output=True, text=True, check=True).stdout.strip()


def load_json(path: str, code: str):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        raise Hold(code)


# ------------------------------------------------------------------------------------------------ signatures
def ssh_sign(key: str, namespace: str, path: str) -> None:
    if os.path.exists(path + ".sig"):
        os.remove(path + ".sig")
    subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", key, "-n", namespace, path], check=True,
                   capture_output=True)


def ssh_verify(allowed_signers: str, principal: str, namespace: str, path: str, signature: str, code: str) -> str:
    """Return the signing key fingerprint; Hold(code) unless the principal's admitted key signed exactly `path`."""
    if not os.path.isfile(signature):
        raise Hold(code)
    with tempfile.TemporaryDirectory() as tmp:
        allowed = os.path.join(tmp, "allowed_signers")
        with open(allowed, "w", encoding="utf-8") as handle:
            handle.write(allowed_signers.strip() + "\n")
        try:
            with open(path, "rb") as data:
                result = subprocess.run(["ssh-keygen", "-Y", "verify", "-f", allowed, "-I", principal, "-n", namespace,
                                         "-s", signature], stdin=data, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            raise Hold(code)
    match = re.search(r"key (SHA256:[A-Za-z0-9+/=]+)", result.stdout + result.stderr)
    if result.returncode != 0 or not match:
        raise Hold(code)
    return match.group(1)


# --------------------------------------------------------------------------------------------- verification
def check_bundle(bundle: str, src: str, head: str, tree: str, test_manifest: dict, role: str) -> dict:
    """Integrity and content of one bundle (no signature). Returns the parsed documents."""
    if not os.path.isdir(bundle):
        raise Hold("G2L_BUNDLE_MISSING")
    present = set(os.listdir(bundle))
    expected = set(BUNDLE_FILES) | {SUMS, SUMS_SIG}
    if not expected <= present:
        raise Hold("G2L_BUNDLE_INCOMPLETE")
    if present - expected:
        raise Hold("G2L_BUNDLE_UNEXPECTED_FILE")
    try:
        with open(os.path.join(bundle, SUMS), encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except (OSError, UnicodeDecodeError):
        raise Hold("G2L_BUNDLE_TAMPERED")
    listed = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Z_]+\.(?:json|txt|md))", line)
        if not match or match.group(2) in listed:
            raise Hold("G2L_BUNDLE_TAMPERED")
        listed[match.group(2)] = match.group(1)
    if set(listed) != set(BUNDLE_FILES):
        raise Hold("G2L_BUNDLE_TAMPERED")
    for name, digest in listed.items():
        if sha256_file(os.path.join(bundle, name)) != digest:
            raise Hold("G2L_BUNDLE_TAMPERED")
    manifest = load_json(os.path.join(bundle, "EVIDENCE_MANIFEST.json"), "G2L_SCHEMA_UNKNOWN")
    if not isinstance(manifest, dict) or manifest.get("schema") != EVIDENCE_SCHEMA:
        raise Hold("G2L_SCHEMA_UNKNOWN")
    if any(key not in manifest for key in MANIFEST_KEYS) or not isinstance(manifest.get("bound_files"), dict) \
            or not isinstance(manifest.get("bundle_files"), dict):
        raise Hold("G2L_MANIFEST_INCOMPLETE")
    if manifest["bundle_files"] != {name: listed[name] for name in BUNDLE_FILES if name != "EVIDENCE_MANIFEST.json"}:
        raise Hold("G2L_BUNDLE_TAMPERED")
    if manifest["repository"] != REPOSITORY:
        raise Hold("G2L_OTHER_REPOSITORY")
    if manifest["commit"] != head:
        raise Hold("G2L_OTHER_SHA")
    if manifest["tree"] != tree:
        raise Hold("G2L_OTHER_TREE")
    if manifest["clean_checkout"] is not True:
        raise Hold("G2L_CHECKOUT_NOT_CLEAN")
    if manifest["role"] != role:
        raise Hold("G2L_ROLE_MISMATCH")
    if manifest["completed"] is not True or manifest["interrupted"] is not False or not manifest["finished_at"]:
        raise Hold("G2L_RUN_INTERRUPTED")
    if set(manifest["bound_files"]) != set(BOUND_FILES):
        raise Hold("G2L_MANIFEST_INCOMPLETE")
    for name, rel in BOUND_FILES.items():
        if manifest["bound_files"][name] != sha256_file(os.path.join(src, rel)):
            raise Hold("G2L_FILE_HASH_" + name.upper())
    results = load_json(os.path.join(bundle, "TEST_RESULTS.json"), "G2L_SCHEMA_UNKNOWN")
    environment = load_json(os.path.join(bundle, "ENVIRONMENT_PROVENANCE.json"), "G2L_SCHEMA_UNKNOWN")
    if not isinstance(results, dict) or results.get("schema") != EVIDENCE_SCHEMA \
            or not isinstance(environment, dict) or environment.get("schema") != EVIDENCE_SCHEMA:
        raise Hold("G2L_SCHEMA_UNKNOWN")
    if results.get("commit") != head or results.get("run_id") != manifest["run_id"] \
            or environment.get("run_id") != manifest["run_id"]:
        raise Hold("G2L_OTHER_SHA")
    steps = results.get("steps")
    if not isinstance(steps, list) or not all(isinstance(s, dict) and isinstance(s.get("id"), str) for s in steps):
        raise Hold("G2L_MANIFEST_INCOMPLETE")
    by_id = {}
    for step in steps:
        if step["id"] in by_id:
            raise Hold("G2L_RESULTS_DUPLICATE_STEP")
        by_id[step["id"]] = step
    required = {s["id"]: s for s in test_manifest["steps"]}
    if set(by_id) - set(required):
        raise Hold("G2L_RESULTS_UNKNOWN_STEP")
    for step_id, spec in required.items():
        step = by_id.get(step_id)
        if step is None:
            raise Hold("G2L_REQUIRED_TEST_MISSING")
        status = step.get("status")
        if status not in STEP_STATUSES:
            raise Hold("G2L_SCHEMA_UNKNOWN")
        counts = {k: step.get(k) for k in ("exit_code", "ran", "failures", "errors", "skipped", "checks_pass", "checks_fail")}
        if not all(type(v) is int for v in counts.values()):
            raise Hold("G2L_MANIFEST_INCOMPLETE")
        if status in ("SKIPPED", "BLOCKED") or counts["skipped"]:
            raise Hold("G2L_REQUIRED_TEST_SKIPPED")
        if status != "PASS" or counts["exit_code"] or counts["failures"] or counts["errors"] or counts["checks_fail"]:
            raise Hold("G2L_TEST_FAILED")
        if counts["ran"] < spec.get("min_tests", 0) or counts["checks_pass"] < spec.get("min_checks", 0):
            raise Hold("G2L_TEST_COUNT_LOW")
        if not isinstance(step.get("log_sha256"), str) or not HEX64.match(step["log_sha256"]):
            raise Hold("G2L_MANIFEST_INCOMPLETE")
    cleanup, scan = results.get("cleanup"), results.get("secret_scan")
    if not isinstance(cleanup, dict) or cleanup.get("status") != "PASS" or cleanup.get("leftovers") != 0:
        raise Hold("G2L_CLEANUP")
    if not isinstance(scan, dict) or scan.get("status") != "PASS" or scan.get("hits") != 0:
        raise Hold("G2L_SECRET_SCAN")
    images = environment.get("images")
    if not isinstance(images, dict):
        raise Hold("G2L_IMAGE_MISMATCH")
    for ref, image_id in test_manifest["pinned_images"].items():
        if not isinstance(images.get(ref), dict) or images[ref].get("id") != image_id:
            raise Hold("G2L_IMAGE_MISMATCH")
    return {"manifest": manifest, "results": results, "environment": environment,
            "sums_sha256": sha256_file(os.path.join(bundle, SUMS))}


def verify(src: str, head: str, evidence: str, replay: str, approval_path: str, allowed_signers: str) -> None:
    if not HEX40.match(head):
        raise Hold("G2L_USAGE")
    try:
        if git(src, "rev-parse", "HEAD") != head:
            raise Hold("G2L_OTHER_SHA")
        if git(src, "status", "--porcelain", "--untracked-files=no"):
            raise Hold("G2L_CHECKOUT_NOT_CLEAN")
        tree = git(src, "rev-parse", "HEAD^{tree}")
    except (OSError, subprocess.CalledProcessError):
        raise Hold("G2L_SOURCE_UNREADABLE")
    test_manifest = load_json(os.path.join(src, TEST_MANIFEST_PATH), "G2L_SCHEMA_UNKNOWN")
    if not isinstance(test_manifest, dict) or test_manifest.get("schema") != TEST_MANIFEST_SCHEMA:
        raise Hold("G2L_SCHEMA_UNKNOWN")
    produced = check_bundle(evidence, src, head, tree, test_manifest, "PRODUCER")
    replayed = check_bundle(replay, src, head, tree, test_manifest, "REPLAY")
    if not os.path.isfile(approval_path):
        raise Hold("G2L_APPROVAL_MISSING")
    approval = load_json(approval_path, "G2L_SCHEMA_UNKNOWN")
    keys = ("schema", "repository", "commit", "tree", "evidence_sums_sha256", "replay_sums_sha256", "producer_principal",
            "replay_principal", "reviewer_principal", "verdict", "scope", "reviewed_at")
    if not isinstance(approval, dict) or approval.get("schema") != APPROVAL_SCHEMA:
        raise Hold("G2L_SCHEMA_UNKNOWN")
    if any(not isinstance(approval.get(key), str) for key in keys):
        raise Hold("G2L_APPROVAL_INCOMPLETE")
    if approval["commit"] != head or approval["tree"] != tree or approval["repository"] != REPOSITORY:
        raise Hold("G2L_APPROVAL_OTHER_SHA")
    if (approval["evidence_sums_sha256"], approval["replay_sums_sha256"]) != (produced["sums_sha256"], replayed["sums_sha256"]):
        raise Hold("G2L_APPROVAL_OTHER_EVIDENCE")
    if (approval["producer_principal"], approval["replay_principal"]) != \
            (produced["manifest"]["principal"], replayed["manifest"]["principal"]):
        raise Hold("G2L_APPROVAL_OTHER_EVIDENCE")
    if approval["verdict"] != APPROVAL_VERDICT or approval["scope"] != APPROVAL_SCOPE:
        raise Hold("G2L_NOT_APPROVED")
    producer, replayer, reviewer = approval["producer_principal"], approval["replay_principal"], approval["reviewer_principal"]
    if reviewer == producer:
        raise Hold("G2L_SELF_APPROVAL")
    if replayer == producer or produced["manifest"]["run_id"] == replayed["manifest"]["run_id"]:
        raise Hold("G2L_REPLAY_NOT_INDEPENDENT")
    if not allowed_signers.strip():
        raise Hold("G2L_SIGNERS_NOT_ADMITTED")   # integrity holds; the PM has admitted no signer yet
    fp_producer = ssh_verify(allowed_signers, producer, NS_EVIDENCE, os.path.join(evidence, SUMS),
                             os.path.join(evidence, SUMS_SIG), "G2L_EVIDENCE_SIGNATURE")
    fp_replay = ssh_verify(allowed_signers, replayer, NS_EVIDENCE, os.path.join(replay, SUMS),
                           os.path.join(replay, SUMS_SIG), "G2L_EVIDENCE_SIGNATURE")
    fp_reviewer = ssh_verify(allowed_signers, reviewer, NS_APPROVAL, approval_path, approval_path + ".sig",
                             "G2L_APPROVAL_SIGNATURE")
    if fp_reviewer == fp_producer:
        raise Hold("G2L_SELF_APPROVAL")             # same key under another name
    if fp_replay == fp_producer:
        raise Hold("G2L_REPLAY_NOT_INDEPENDENT")


# ------------------------------------------------------------------------------------------------ producing
def parse_unittest(text: str) -> dict:
    ran = re.findall(r"^Ran (\d+) tests? in ", text, re.M)
    summary = re.findall(r"^(OK|FAILED)(?: \(([^)]*)\))?$", text, re.M)
    counts = {"ran": int(ran[-1]) if ran else 0, "failures": 0, "errors": 0, "skipped": 0}
    if summary:
        for part in (summary[-1][1] or "").split(","):
            key, _, value = part.strip().partition("=")
            if key in ("failures", "errors", "skipped") and value.isdigit():
                counts[key] = int(value)
        counts["ok"] = summary[-1][0] == "OK"
    else:
        counts["ok"] = False
    return counts


def docker_inventory() -> dict:
    def ids(*args):
        result = subprocess.run(["docker", *args], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("docker unavailable")
        return [line for line in result.stdout.split() if line]
    networks = [n for n in ids("network", "ls", "--format", "{{.Name}}") if n not in ("bridge", "host", "none")]
    return {"containers": len(ids("ps", "-aq")), "networks": len(networks), "volumes": len(ids("volume", "ls", "-q"))}


def run(args) -> int:
    src = os.path.abspath(args.source)
    out, logs = os.path.abspath(args.out), os.path.abspath(args.logs)
    for path in (out, logs):
        if os.path.exists(path):
            print("G2L_RUN=HOLD_OUTPUT_EXISTS")
            return 2
    head = git(src, "rev-parse", "HEAD")
    if git(src, "status", "--porcelain", "--untracked-files=all"):
        print("G2L_RUN=HOLD_CHECKOUT_NOT_CLEAN")
        return 2
    tree = git(src, "rev-parse", "HEAD^{tree}")
    with open(os.path.join(src, TEST_MANIFEST_PATH), encoding="utf-8") as handle:
        test_manifest = json.load(handle)
    try:
        before = docker_inventory()
    except RuntimeError:
        print("G2L_RUN=HOLD_DOCKER_UNAVAILABLE")
        return 2
    if before != {"containers": 0, "networks": 0, "volumes": 0}:
        # Legacy rehearsals clean up by name: they run only on a daemon that holds nothing else.
        print("G2L_RUN=HOLD_DOCKER_DAEMON_NOT_EXCLUSIVE")
        return 2
    os.makedirs(out, mode=0o755)
    os.makedirs(logs, mode=0o700)
    run_id = uuid.uuid4().hex
    started = now()
    env_base = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    if args.python_bin:
        env_base["PATH"] = os.path.dirname(os.path.abspath(args.python_bin)) + os.pathsep + env_base["PATH"]
    images, steps, interrupted, leftovers_seen = {}, [], False, 0
    for ref in test_manifest.get("pull_by_tag_then_verify", []):
        if subprocess.run(["docker", "image", "inspect", ref], capture_output=True).returncode:
            subprocess.run(["docker", "pull", "-q", ref], capture_output=True)   # as the workflow does
    try:
        for spec in test_manifest["steps"]:
            step = {"id": spec["id"], "started_at": now(), "exit_code": 0, "ran": 0, "failures": 0, "errors": 0,
                    "skipped": 0, "checks_pass": 0, "checks_fail": 0}
            log_path = os.path.join(logs, spec["id"] + ".log")
            if spec["kind"] == "internal_cleanup_audit":
                text = json.dumps({"leftovers_after_steps": leftovers_seen, "final": docker_inventory()})
                final = docker_inventory()
                ok = leftovers_seen == 0 and final == {"containers": 0, "networks": 0, "volumes": 0}
                step.update(status="PASS" if ok else "FAIL", checks_pass=1 if ok else 0, checks_fail=0 if ok else 1,
                            exit_code=0 if ok else 1)
            else:
                env = dict(env_base, **spec.get("env", {}))
                begin = time.time()
                try:
                    result = subprocess.run(spec["argv"], cwd=os.path.join(src, spec.get("cwd", ".")), env=env,
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=args.step_timeout)
                    text, code = result.stdout.decode("utf-8", "replace"), result.returncode
                except subprocess.TimeoutExpired as error:
                    text, code = (error.stdout or b"").decode("utf-8", "replace") + "\nG2L_STEP_TIMEOUT\n", 124
                step["seconds"] = round(time.time() - begin, 1)
                step["exit_code"] = code
                if spec["kind"] == "unittest":
                    counts = parse_unittest(text)
                    step.update(ran=counts["ran"], failures=counts["failures"], errors=counts["errors"],
                                skipped=counts["skipped"])
                    passed = code == 0 and counts["ok"]
                else:
                    step["checks_pass"] = len(re.findall(r"=PASS\b", text))
                    step["checks_fail"] = len(re.findall(r"=FAIL\b", text))
                    passed = code == 0 and step["checks_fail"] == 0
                step["status"] = "PASS" if passed else ("ERROR" if code == 124 else "FAIL")
                after = docker_inventory()
                step["leftovers_after"] = after["containers"] + after["networks"] + after["volumes"]
                leftovers_seen += step["leftovers_after"]
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write(text)
            os.chmod(log_path, 0o600)
            step["log_sha256"] = sha256_file(log_path)
            step["finished_at"] = now()
            steps.append(step)
            print(f"G2L_STEP {step['id']}={step['status']} exit={step['exit_code']} ran={step['ran']} "
                  f"failures={step['failures']} errors={step['errors']} skipped={step['skipped']} "
                  f"checks={step['checks_pass']}/{step['checks_fail']}", flush=True)
    except KeyboardInterrupt:
        interrupted = True
    final = docker_inventory()
    hits = 0
    for name in sorted(os.listdir(logs)):
        with open(os.path.join(logs, name), encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        hits += sum(len(re.findall(pattern, text)) for pattern in SECRET_PATTERNS)
    for ref in test_manifest["pinned_images"]:
        result = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}} {{json .RepoDigests}}", ref],
                                capture_output=True, text=True)
        if result.returncode == 0:
            image_id, _, digests = result.stdout.strip().partition(" ")
            images[ref] = {"id": image_id, "repo_digests": json.loads(digests or "[]")}

    def version(*argv):
        result = subprocess.run(argv, capture_output=True, text=True, env=env_base)
        return (result.stdout or result.stderr).strip().splitlines()[0] if result.returncode == 0 else "UNAVAILABLE"

    environment = {
        "schema": EVIDENCE_SCHEMA, "run_id": run_id, "os": platform.platform(), "kernel": platform.release(),
        "arch": platform.machine(), "python": version("python3", "--version"),
        "python_modules": version("python3", "-c", "import importlib.util as u;print(','.join(m for m in ('fastapi','httpx','yaml','psycopg') if u.find_spec(m)))"),
        "docker": version("docker", "version", "--format", "client={{.Client.Version}} server={{.Server.Version}}"),
        "compose": version("docker", "compose", "version", "--short"),
        "git": version("git", "--version"),
        "docker_daemon_exclusive_before_run": True, "images": images,
        "isolation": "disposable lab; synthetic data only; rehearsal networks are Docker --internal where the script uses them; "
                     "no production host, no OMV, no real key",
    }
    results = {
        "schema": EVIDENCE_SCHEMA, "commit": head, "run_id": run_id, "steps": steps,
        "totals": {"steps": len(steps), "passed": sum(s["status"] == "PASS" for s in steps),
                   "failed": sum(s["status"] in ("FAIL", "ERROR") for s in steps),
                   "skipped": sum(s["status"] in ("SKIPPED", "BLOCKED") for s in steps),
                   "unittest_ran": sum(s["ran"] for s in steps), "script_checks_pass": sum(s["checks_pass"] for s in steps)},
        "cleanup": {"status": "PASS" if leftovers_seen == 0 and not any(final.values()) else "FAIL",
                    "leftovers": leftovers_seen + sum(final.values()), "final": final},
        "secret_scan": {"status": "PASS" if hits == 0 else "FAIL", "hits": hits, "patterns": len(SECRET_PATTERNS),
                        "scope": "every private step log"},
    }
    completed = not interrupted and len(steps) == len(test_manifest["steps"])
    receipt = [f"G2L_COMMIT={head}", f"G2L_TREE={tree}", f"G2L_ROLE={args.role}", f"G2L_PRINCIPAL={args.principal}",
               f"G2L_RUN_ID={run_id}"]
    receipt += [f"G2L_STEP_{s['id']}={s['status']}" for s in steps]
    receipt += [f"G2L_CLEANUP={results['cleanup']['status']}", f"G2L_SECRET_SCAN={results['secret_scan']['status']}",
                f"G2L_COMPLETED={'YES' if completed else 'NO'}"]
    files = {
        "TEST_RESULTS.json": json.dumps(results, indent=1, sort_keys=True) + "\n",
        "ENVIRONMENT_PROVENANCE.json": json.dumps(environment, indent=1, sort_keys=True) + "\n",
        "SANITIZED_RECEIPT.txt": "\n".join(receipt) + "\n",
        "REPLAY_INSTRUCTIONS.md": REPLAY_INSTRUCTIONS.replace("@HEAD@", head).replace("@TREE@", tree),
    }
    for name, content in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as handle:
            handle.write(content)
    manifest = {
        "schema": EVIDENCE_SCHEMA, "repository": REPOSITORY, "commit": head, "tree": tree, "clean_checkout": True,
        "role": args.role, "principal": args.principal, "run_id": run_id, "started_at": started, "finished_at": now(),
        "completed": completed, "interrupted": interrupted,
        "bound_files": {name: sha256_file(os.path.join(src, rel)) for name, rel in BOUND_FILES.items()},
        "bundle_files": {name: sha256_file(os.path.join(out, name)) for name in files},
        "logs": "private; kept outside the bundle by the producer; per-step SHA-256 in TEST_RESULTS.json",
    }
    with open(os.path.join(out, "EVIDENCE_MANIFEST.json"), "w", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    with open(os.path.join(out, SUMS), "w", encoding="utf-8") as handle:
        for name in BUNDLE_FILES:
            handle.write(f"{sha256_file(os.path.join(out, name))}  {name}\n")
    ssh_sign(args.signing_key, NS_EVIDENCE, os.path.join(out, SUMS))
    ok = completed and results["totals"]["failed"] == 0 and results["totals"]["skipped"] == 0 \
        and results["cleanup"]["status"] == "PASS" and results["secret_scan"]["status"] == "PASS"
    print(f"G2L_RUN={'COMPLETE_ALL_PASS' if ok else 'COMPLETE_WITH_FAILURES'}")
    print(f"G2L_SHA256SUMS_SHA256={sha256_file(os.path.join(out, SUMS))}")
    return 0 if ok else 1


REPLAY_INSTRUCTIONS = """# G2_LOCAL_INDEPENDENT replay (commit @HEAD@, tree @TREE@)

Replay must be done by a different producer (a different principal and signing key) in a disposable lab with an
exclusive Docker daemon (no other containers, networks or volumes). The commands below make no production
change, use synthetic data only and send nothing to any inference provider.

1. git clone https://github.com/jfsdias/NewsFlux.git src && git -C src checkout --detach @HEAD@
2. test "$(git -C src rev-parse HEAD^{tree})" = @TREE@
3. python3 src/deploy/release-governance/g2_local_evidence.py run --source src --out replay-bundle \\
     --logs replay-logs --role REPLAY --principal <your-principal> --signing-key <your-ssh-key> [--python-bin <venv>/bin/python3]
4. A reviewer who produced neither bundle checks both and signs the approval:
   python3 src/deploy/release-governance/g2_local_evidence.py approve --source src --evidence <producer-bundle> \\
     --replay replay-bundle --out approval.json --principal <reviewer> --signing-key <reviewer-key> \\
     --allowed-signers <file>
5. Nothing here admits the mode for a privileged run: the PM admits signers in s5-r3-omv-readonly-run.sh.
"""


def approve(args) -> int:
    with open(args.allowed_signers, encoding="utf-8") as handle:
        allowed = handle.read()
    src = os.path.abspath(args.source)
    head = git(src, "rev-parse", "HEAD")
    tree = git(src, "rev-parse", "HEAD^{tree}")
    test_manifest = load_json(os.path.join(src, TEST_MANIFEST_PATH), "G2L_SCHEMA_UNKNOWN")
    try:
        produced = check_bundle(args.evidence, src, head, tree, test_manifest, "PRODUCER")
        replayed = check_bundle(args.replay, src, head, tree, test_manifest, "REPLAY")
        producer, replayer = produced["manifest"]["principal"], replayed["manifest"]["principal"]
        if args.principal == producer:
            raise Hold("G2L_SELF_APPROVAL")
        if replayer == producer or produced["manifest"]["run_id"] == replayed["manifest"]["run_id"]:
            raise Hold("G2L_REPLAY_NOT_INDEPENDENT")
        ssh_verify(allowed, producer, NS_EVIDENCE, os.path.join(args.evidence, SUMS), os.path.join(args.evidence, SUMS_SIG),
                   "G2L_EVIDENCE_SIGNATURE")
        ssh_verify(allowed, replayer, NS_EVIDENCE, os.path.join(args.replay, SUMS), os.path.join(args.replay, SUMS_SIG),
                   "G2L_EVIDENCE_SIGNATURE")
    except Hold as error:
        print(f"G2L_APPROVAL=NOT_WRITTEN_HOLD_{error}")
        return 2
    approval = {"schema": APPROVAL_SCHEMA, "repository": REPOSITORY, "commit": head, "tree": tree,
                "evidence_sums_sha256": produced["sums_sha256"], "replay_sums_sha256": replayed["sums_sha256"],
                "producer_principal": producer, "replay_principal": replayer, "reviewer_principal": args.principal,
                "verdict": APPROVAL_VERDICT, "scope": APPROVAL_SCOPE, "reviewed_at": now()}
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(approval, indent=1, sort_keys=True) + "\n")
    ssh_sign(args.signing_key, NS_APPROVAL, args.out)
    print(f"G2L_APPROVAL=WRITTEN sha256={sha256_file(args.out)}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command")
    p_run = sub.add_parser("run")
    p_run.add_argument("--source", required=True)
    p_run.add_argument("--out", required=True)
    p_run.add_argument("--logs", required=True)
    p_run.add_argument("--role", required=True, choices=("PRODUCER", "REPLAY"))
    p_run.add_argument("--principal", required=True)
    p_run.add_argument("--signing-key", required=True)
    p_run.add_argument("--python-bin")
    p_run.add_argument("--step-timeout", type=int, default=1800)
    p_app = sub.add_parser("approve")
    for flag in ("--source", "--evidence", "--replay", "--out", "--principal", "--signing-key", "--allowed-signers"):
        p_app.add_argument(flag, required=True)
    p_ver = sub.add_parser("verify")
    for flag in ("--source", "--expect-head", "--evidence", "--replay", "--approval"):
        p_ver.add_argument(flag, required=True)
    p_ver.add_argument("--allowed-signers-text", required=True)
    # The wrapper calls the verifier without a sub-command name.
    if argv is None:
        argv = sys.argv[1:]
    if argv and argv[0].startswith("--"):
        argv = ["verify", *argv]
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        print("G2L_RESULT=HOLD_G2L_USAGE")
        return 2
    if args.command == "run":
        return run(args)
    if args.command == "approve":
        return approve(args)
    if args.command != "verify":
        print("G2L_RESULT=HOLD_G2L_USAGE")
        return 2
    try:
        verify(os.path.abspath(args.source), args.expect_head, os.path.abspath(args.evidence),
               os.path.abspath(args.replay), os.path.abspath(args.approval), args.allowed_signers_text)
    except Hold as error:
        print(f"G2L_RESULT=HOLD_{error}")
        return 2
    except Exception:  # noqa: BLE001 - anything unexpected is a HOLD, never a PASS
        print("G2L_RESULT=HOLD_G2L_UNVERIFIED")
        return 2
    print("G2L_RESULT=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
