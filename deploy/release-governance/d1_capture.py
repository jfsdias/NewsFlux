#!/usr/bin/env python3
"""D1 complementary capture (D1-R7-01): one root invocation on the OMV that produces the cost-authority evidence.

Requires its own owner authorization (it is NOT covered by GO-NEWSFLUX-S5-R5-READONLY-57C536F: it uses the
auditor's opt-in --private-prestate and writes files under /root). Read-only toward Docker, LiteLLM and its DB:
the only writes are the root-only prestate (0600) and the evidence file (0644) in a new root-only directory.

  1. verify the auditor (sha256 pinned, the 57c536f build) and the vendored receipt contract;
  2. read the Summary and LiteLLM identity lines; LiteLLM image ID and repo digest must equal the pins;
  3. run the auditor ONCE in strict mode with --private-prestate: in that single run it reads the Summary key
     fingerprint, matches it in the LiteLLM DB, and writes the same fingerprint, the read time and the key
     policy into the prestate, printing the prestate sha256 in its receipt; the exit code is recorded;
  4. read the identity lines again (must be byte-identical);
  5. assemble the v3 evidence (no amounts: the policy stays in the root-only prestate), verify it with the
     same code the Summary uses, write it with O_EXCL|O_NOFOLLOW, and print its sha256.

The operator records D1_EVIDENCE_SHA256 in the homeserver ledger; the deployment pins it.

  python3 -I -B d1_capture.py --auditor A --expect-auditor-sha256 H --evidence-lib DIR \\
      --summary-container ID --litellm-container ID --expect-litellm-image sha256:... \\
      --expect-repo-digest repo@sha256:... --expect-litellm-version X.Y.Z --project newsflux \\
      --summary-service summary-api --declaration gateway_budget_enforced --out-dir /root/newsflux-d1.XXXXXXXX
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

IDENTITY_FORMAT = ('{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}|'
                   '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}')
REVISION_FORMAT = '{{index .Config.Labels "org.opencontainers.image.revision"}}'
OUT_DIR = re.compile(r"^/root/newsflux-d1\.[A-Za-z0-9]{8}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def say(name: str, value: str) -> None:
    print(f"D1CAPTURE_{name}={value}", flush=True)


def _run(argv: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=600, check=False)


def load_evidence_lib(directory: str):
    spec = importlib.util.spec_from_file_location("newsflux_d1_evidence", Path(directory) / "d1_evidence.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def sha256_file(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def private_dir(path: str) -> bool:
    try:
        info = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077 and os.path.realpath(path) == path


def capture(args, *, run: Callable[..., subprocess.CompletedProcess] = _run, euid: int | None = None,
            clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> int:
    if (os.geteuid() if euid is None else euid) != 0:
        say("RESULT", "HOLD_NOT_ROOT")
        return 2
    lib = load_evidence_lib(args.evidence_lib)
    if args.declaration not in lib.DECLARATIONS:
        say("RESULT", "HOLD_DECLARATION")
        return 2
    if not OUT_DIR.match(args.out_dir) or not private_dir(args.out_dir) or os.listdir(args.out_dir):
        say("RESULT", "HOLD_OUT_DIR")   # a fresh mktemp -d /root/newsflux-d1.XXXXXXXX, empty, root 0700
        return 2
    if sha256_file(args.auditor) != args.expect_auditor_sha256 or args.expect_auditor_sha256 not in lib.ADMITTED_AUDITOR_SHA256:
        say("RESULT", "HOLD_AUDITOR_SHA256")
        return 2
    say("AUDITOR_GATE", "PASS")
    if lib.contract_sha256() != lib.contract.VERBATIM_SHA256:
        say("RESULT", "HOLD_CONTRACT")
        return 2

    def identities() -> list[str] | None:
        lines = []
        for cid in (args.summary_container, args.litellm_container):
            done = run(["docker", "inspect", "--format", IDENTITY_FORMAT, cid])
            if done.returncode != 0:
                return None
            lines.append(done.stdout.strip())
        return lines

    before = identities()
    if before is None:
        say("RESULT", "HOLD_CONTAINER_UNAVAILABLE")
        return 2
    summary_parts, litellm_parts = before[0].split("|"), before[1].split("|")
    if (len(summary_parts) != 7 or summary_parts[0] != args.summary_container or summary_parts[4] != "running"
            or summary_parts[5] != args.project or summary_parts[6] != args.summary_service):
        say("RESULT", "HOLD_SUMMARY_IDENTITY")
        return 2
    if len(litellm_parts) != 7 or litellm_parts[0] != args.litellm_container or litellm_parts[1] != args.expect_litellm_image \
            or litellm_parts[4] != "running":
        say("RESULT", "HOLD_LITELLM_IDENTITY")
        return 2
    digests = run(["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", args.expect_litellm_image])
    try:
        repo_digests = json.loads(digests.stdout) if digests.returncode == 0 else []
    except ValueError:
        repo_digests = []
    if args.expect_repo_digest not in repo_digests:
        say("RESULT", "HOLD_LITELLM_REPO_DIGEST")
        return 2
    revision = run(["docker", "image", "inspect", "--format", REVISION_FORMAT, summary_parts[1]]).stdout.strip()
    say("IDENTITY_GATE", "PASS")

    prestate = os.path.join(args.out_dir, "prestate.json")
    started = clock()
    audit = run(["python3", "-I", "-B", args.auditor, "--litellm-container", args.litellm_container,
                 "--project", args.project, "--summary-service", args.summary_service,
                 "--summary-container", args.summary_container, "--expect-summary-image", summary_parts[1],
                 "--expect-litellm-image", args.expect_litellm_image, "--expect-summary-snapshot", before[0],
                 "--expect-litellm-snapshot", before[1], "--private-prestate", prestate])
    finished = clock()
    after = identities()
    say("AUDITOR_EXIT", str(audit.returncode))
    if after != before:
        say("RESULT", "HOLD_IDENTITY_CHANGED")
        return 2
    try:
        with open(prestate, "rb") as handle:
            prestate_raw = handle.read()
        document = json.loads(prestate_raw)
        binding = document["binding"]
    except (OSError, ValueError, KeyError, TypeError):
        say("RESULT", "HOLD_PRESTATE_UNAVAILABLE")
        return 2
    evidence = {
        "schema": lib.EVIDENCE_SCHEMA,
        "declaration": args.declaration,
        "capture": {
            "tool": "d1_capture/v1",
            "started_at": lib.fmt(started), "finished_at": lib.fmt(finished),
            "auditor_sha256": args.expect_auditor_sha256, "contract_sha256": lib.contract_sha256(),
            "auditor_exit": audit.returncode, "receipt_text": audit.stdout,
            "receipt_sha256": hashlib.sha256(audit.stdout.encode("utf-8")).hexdigest(),
            "prestate_sha256": hashlib.sha256(prestate_raw).hexdigest(),
            "prestate_captured_at": binding.get("captured_at"), "key_fingerprint": binding.get("fingerprint"),
            "summary": {"container_id": summary_parts[0], "image_id": summary_parts[1], "revision": revision,
                        "project": args.project, "service": args.summary_service},
            "litellm": {"container_id": litellm_parts[0], "image_id": litellm_parts[1],
                        "repo_digest": args.expect_repo_digest, "version": args.expect_litellm_version},
            "identity_before": before, "identity_after": after,
        },
    }
    # Classification is computed, then the whole document is checked by the runtime's own verifier.
    _, reason, _ = lib.verify(evidence, check_classification=False)
    evidence["classification"] = reason
    if args.declaration == "explicit_unlimited":
        if not args.owner_decision_file or not args.owner_decision_ref or not args.ledger_repo:
            say("RESULT", "HOLD_UNLIMITED_NOT_AUTHORIZED")
            return 2
        text = Path(args.owner_decision_file).read_text(encoding="utf-8")
        evidence["owner_decision"] = {"ref": args.owner_decision_ref, "text": text,
                                      "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
        problem = lib.verify_owner_decision_in_ledger(evidence["owner_decision"], args.ledger_repo) or \
            lib.check_owner_decision(evidence["owner_decision"], str(binding.get("fingerprint")), finished.date())
        if problem:
            say("RESULT", "HOLD_" + problem)
            return 2
    verdict, reason, _ = lib.verify(evidence)
    say("CLASSIFICATION", reason)
    if verdict != "PROVEN":
        say("RESULT", "HOLD_" + reason)
        return 2
    data = (json.dumps(evidence, indent=1, sort_keys=True) + "\n").encode("utf-8")
    out = os.path.join(args.out_dir, "evidence.json")
    descriptor = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
    try:
        os.fchmod(descriptor, 0o644)
        view = memoryview(data)
        while view:
            view = view[os.write(descriptor, view):]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    say("EVIDENCE_SHA256", hashlib.sha256(data).hexdigest())
    say("CAPTURED_AT", lib.fmt(lib.parse_iso(binding.get("captured_at"))))
    say("RESULT", "EVIDENCE_WRITTEN")
    print("NEXT=record D1CAPTURE_EVIDENCE_SHA256 in the homeserver ledger; the deployment pins it", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for name in ("auditor", "expect-auditor-sha256", "evidence-lib", "summary-container", "litellm-container",
                 "expect-litellm-image", "expect-repo-digest", "expect-litellm-version", "project", "summary-service",
                 "declaration", "out-dir"):
        parser.add_argument("--" + name, required=True)
    for name in ("owner-decision-file", "owner-decision-ref", "ledger-repo"):
        parser.add_argument("--" + name)
    return capture(parser.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
