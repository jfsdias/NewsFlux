"""S5-R3A OMV read-only wrapper: gates, CI/run/job/SHA binding, authorized Summary deploy, exact container
binding, strict receipt contract and exit semantics. Fake docker/curl/id and a stub auditor in a real git repo."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

import s5_db_readonly_audit as audit
import test_s5_db_readonly_audit as T

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(HERE, "s5-r3-omv-readonly-run.sh")
LITELLM_ID = "09650c4573154471943d576a4a2429ac3c7a3f5fecb2e132a5444be51789e50b"
IMAGE_ID = "sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"
DIGEST = "ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a"
SUMMARY_REV = "12929fbabe603ec24dcc700c8393f1f6bc7bbf60"
SUMMARY_IMAGE = "sha256:6cee8366be056e84893b32dd6708248d983f1d3a939261af6cfe27db8572adc3"
SUMMARY_ID = "5" * 64
CI_RUN = "44755113665"
NEXT = "NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)"
HOST_FACTS = {"INFERENCE_EFFECTIVE": "OFF_EXPLICIT", "EXTERNAL_TRANSFER_EFFECTIVE": "OFF_DEFAULT_RUNTIME",
              "FLAGS_RUNTIME_PARSER": "CONFIRMED_OFF", "SUMMARY_BINDING": "EXACT_ID_IMAGE_LABELS_LIFECYCLE",
              "LITELLM_BINDING": "EXACT_ID_IMAGE_LIFECYCLE"}


def contract():
    """The receipt contract exactly as embedded in the wrapper (single source)."""
    with open(WRAPPER, encoding="utf-8") as handle:
        text = handle.read()
    block = text.split("# ---BEGIN RECEIPT CONTRACT---", 1)[1].split("# ---END RECEIPT CONTRACT---", 1)[0]
    source = block.split("<<'PY'\n", 1)[1].rsplit("\nPY\n", 1)[0]
    namespace = {"__name__": "contract"}
    exec(compile(source, "receipt_contract", "exec"), namespace)  # noqa: S102 - the wrapper's own pinned code
    return namespace


def real_receipt(db=None, *, version=T.ADMITTED, identity="UNCHANGED", host=None):
    facts = T.r3_collect(db, version=version)
    lines = audit.render({**facts, **(host or HOST_FACTS)}, container_identity=identity)
    return lines + ["S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", NEXT]


def snap(cid, image, restarts=0, status="running", project="newsflux", service="summary-api"):
    return "|".join((cid, image, "2026-11-19T23:30:00Z", str(restarts), status, project, service))


STUB_AUDITOR = r'''import json, os, sys
CONFIG = __CONFIG__
with open(CONFIG["log"], "a") as log:
    log.write(json.dumps({"argv": sys.argv[1:], "env": sorted(os.environ)}) + "\n")
with open(CONFIG["receipt"]) as handle:
    receipt = json.load(handle)
sys.stdout.write("\n".join(receipt["lines"]) + ("\n" if receipt["lines"] else ""))
sys.exit(receipt.get("code", 0))
'''

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["FAKE_STATE"]) as handle:
    state = json.load(handle)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["docker"] + sys.argv[1:]) + "\n")
args = sys.argv[1:]
counter_path = os.environ["FAKE_LOG"] + ".snapshots"
counts = json.load(open(counter_path)) if os.path.exists(counter_path) else {}
if args[0] == "inspect":
    fmt, target = args[args.index("--format") + 1], args[-1]
    if target not in state["containers"]:
        sys.exit(1)
    n = counts.get(target, 0)
    counts[target] = n + 1
    json.dump(counts, open(counter_path, "w"))
    sequence = state["containers"][target]
    print(sequence[min(n, len(sequence) - 1)])
    sys.exit(0)
if args[:2] == ["image", "inspect"]:
    fmt, target = args[args.index("--format") + 1], args[-1]
    image = state["images"].get(target)
    if image is None:
        sys.exit(1)
    if "RepoDigests" in fmt:
        print(json.dumps(image["digests"]))
    elif "revision" in fmt:
        print(image["revision"])
    else:
        print(target)
    sys.exit(0)
if args[0] == "ps":
    print("\n".join(state["summary_ids"]))
    sys.exit(0)
sys.exit(97)  # exec, run, pull, rm, restart... are forbidden for the wrapper itself
'''

FAKE_CURL = r'''#!/usr/bin/env python3
import json, os, re, sys
with open(os.environ["FAKE_STATE"]) as handle:
    state = json.load(handle)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["curl"] + sys.argv[1:]) + "\n")
url = sys.argv[-1]
if "/jobs" in url:
    pages = state["ci"].get("jobs")
    if isinstance(pages, dict) or pages is None:
        pages = [pages]
    number = int(re.search(r"[?&]page=([0-9]+)", url).group(1)) if "page=" in url else 1
    body = pages[number - 1] if number <= len(pages) else {"total_count": state["ci"].get("total_override", 0), "jobs": []}
else:
    body = state["ci"].get("run")
if body is None:
    sys.exit(22)
print(json.dumps(body))
'''


def job(head, name="synthetic-release", conclusion="success", job_id=1, attempt=1, run_id=None, status="completed"):
    return {"id": job_id, "name": name, "head_sha": head, "status": status, "conclusion": conclusion,
            "run_id": int(run_id or CI_RUN), "run_attempt": attempt}


def ci_state(head, **run_overrides):
    run = {"id": int(CI_RUN), "run_attempt": 1, "head_sha": head, "path": ".github/workflows/summary-release-rehearsal.yaml",
           "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
           "repository": {"full_name": "jfsdias/NewsFlux"}, "head_repository": {"full_name": "jfsdias/NewsFlux"}}
    run.update(run_overrides)
    jobs = {"total_count": 1, "jobs": [job(head)]}
    return {"run": run, "jobs": jobs}


class WrapperBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.log = os.path.join(root, "calls.log")
        self.stub_log = os.path.join(root, "auditor.log")
        self.receipt_path = os.path.join(root, "receipt.json")
        self.state_path = os.path.join(root, "state.json")
        self.src = os.path.join(root, "src")
        os.makedirs(os.path.join(self.src, "ops", "deploy", "release-governance"))
        auditor = os.path.join(self.src, "ops", "deploy", "release-governance", "s5_db_readonly_audit.py")
        with open(auditor, "w") as handle:
            handle.write(STUB_AUDITOR.replace("__CONFIG__", repr({"log": self.stub_log, "receipt": self.receipt_path})))
        git = ["git", "-C", self.src, "-c", "user.email=t@example.invalid", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q", self.src], check=True)
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "stub"], check=True)
        self.head = subprocess.run(["git", "-C", self.src, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        with open(auditor, "rb") as handle:
            self.sha = hashlib.sha256(handle.read()).hexdigest()
        self.bin = os.path.join(root, "bin")
        os.mkdir(self.bin)
        # A fake `id` reporting root lets the suite run on non-root CI runners; the wrapper has no bypass flag.
        for name, body in (("docker", FAKE_DOCKER), ("curl", FAKE_CURL), ("id", "#!/bin/sh\necho 0\n")):
            path = os.path.join(self.bin, name)
            with open(path, "w") as handle:
                handle.write(body)
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
        self.state = {
            "containers": {SUMMARY_ID: [snap(SUMMARY_ID, SUMMARY_IMAGE)],
                           LITELLM_ID: [snap(LITELLM_ID, IMAGE_ID, project="litellm", service="litellm")]},
            "images": {IMAGE_ID: {"digests": [DIGEST]}, SUMMARY_IMAGE: {"revision": SUMMARY_REV}},
            "summary_ids": [SUMMARY_ID], "ci": ci_state(self.head)}
        self.receipt = {"lines": real_receipt(), "code": 0}

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, **overrides):
        values = {"--source": self.src, "--expect-head": self.head, "--expect-auditor-sha256": self.sha,
                  "--expect-ci-run-id": CI_RUN, "--expect-ci-run-attempt": "1", "--litellm-container-id": LITELLM_ID, "--expect-image-id": IMAGE_ID,
                  "--expect-repo-digest": DIGEST, "--expect-litellm-version": "1.110.0", "--summary-project": "newsflux",
                  "--summary-service": "summary-api", "--expect-summary-revision": SUMMARY_REV}
        values.update(overrides)
        return [part for key, value in values.items() if value is not None for part in (key, value)]

    def run_wrapper(self, argv=None):
        for stale in (self.log, self.log + ".snapshots", self.stub_log):   # each run is observed on its own
            if os.path.exists(stale):
                os.remove(stale)
        with open(self.state_path, "w") as handle:
            json.dump(self.state, handle)
        with open(self.receipt_path, "w") as handle:
            json.dump(self.receipt, handle)
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], FAKE_STATE=self.state_path, FAKE_LOG=self.log,
                   NEWSFLUX_PROJECT="divergent", NEWSFLUX_SUMMARY_SERVICE="divergent")
        result = subprocess.run(["bash", WRAPPER, *(argv if argv is not None else self.args())], capture_output=True,
                                text=True, env=env, timeout=60)
        calls, audits = [], []
        if os.path.exists(self.log):
            with open(self.log) as handle:
                calls = [json.loads(line) for line in handle]
        if os.path.exists(self.stub_log):
            with open(self.stub_log) as handle:
                audits = [json.loads(line) for line in handle]
        return result.returncode, result.stdout.splitlines(), calls, audits

    def assert_hold(self, reason, argv=None, audited=False):
        code, lines, calls, audits = self.run_wrapper(argv)
        self.assertEqual(code, 2, lines)
        self.assertEqual(lines[-1], f"S5R3_RUN_RESULT=HOLD_{reason}")
        self.assertFalse([line for line in lines if line.startswith("S5R1_")], "no receipt line on a HOLD")
        self.assertEqual(bool(audits), audited, "auditor invocation")
        return lines, calls, audits


class WrapperGateTests(WrapperBase):
    def test_happy_path_prints_validated_receipt_after_every_gate(self):
        code, lines, calls, audits = self.run_wrapper()
        self.assertEqual(code, 0, lines)
        for expected in ("S5R3_RUN_PRIVATE_PRESTATE=OFF", "S5R3_RUN_SOURCE_GATE=PASS_EXACT_HEAD",
                         f"S5R3_RUN_CI_RUN_ID={CI_RUN}", f"S5R3_RUN_CI_HEAD_SHA={self.head}", "S5R3_RUN_CI_JOB=SYNTHETIC_RELEASE",
                         "S5R3_RUN_CI_GATE=PASS_EXACT_RUN_ATTEMPT_JOB_SHA", "S5R3_RUN_CI_RUN_ATTEMPT=1",
                         "S5R3_RUN_CI_JOBS_LISTING=COMPLETE", "S5R3_RUN_G2_MODE=REMOTE_CI", "S5R3_RUN_IMAGE_VERSION_BINDING=PASS_1_110_0",
                         "S5R3_RUN_SUMMARY_DEPLOY_AUTHORIZED=PASS_TABLE", f"S5R3_RUN_LIVE_SUMMARY_REVISION={SUMMARY_REV}",
                         "S5R1_LITELLM_VERSION=1_110_0", "S5R1_FILESYSTEM_INTEGRITY=NOT_PROVEN",
                         "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", "S5R3_RUN_POST_GATES=PASS",
                         "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY"):
            self.assertIn(expected, lines)
        self.assertNotIn(NEXT, lines)
        self.assertLess(lines.index("S5R3_RUN_SUMMARY_IMAGE_ID=" + SUMMARY_IMAGE), lines.index("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY"))
        argv = audits[0]["argv"]
        expected_args = {"--litellm-container": LITELLM_ID, "--summary-container": SUMMARY_ID, "--project": "newsflux",
                         "--summary-service": "summary-api", "--expect-summary-image": SUMMARY_IMAGE,
                         "--expect-litellm-image": IMAGE_ID, "--expect-summary-snapshot": snap(SUMMARY_ID, SUMMARY_IMAGE),
                         "--expect-litellm-snapshot": snap(LITELLM_ID, IMAGE_ID, project="litellm", service="litellm")}
        self.assertEqual(dict(zip(argv[::2], argv[1::2])), expected_args)
        self.assertNotIn("--private-prestate", argv)
        # env -i: no NEWSFLUX_* or other variable reaches the auditor (LC_CTYPE is Python's own PEP 538 coercion)
        self.assertTrue(set(audits[0]["env"]) <= {"PATH", "LC_CTYPE"}, audits[0]["env"])
        for call in calls:
            if call[0] == "docker":
                self.assertIn(call[1], ("inspect", "image", "ps"), call)

    def test_gates_only_mode_never_runs_the_auditor(self):
        code, lines, calls, audits = self.run_wrapper(self.args() + ["--gates-only"])
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1], "S5R3_RUN_RESULT=GATES_PASS_METADATA_ONLY_NO_AUDIT")
        self.assertEqual(audits, [])

    def test_prestate_and_usage(self):
        self.assert_hold("PRIVATE_PRESTATE_FORBIDDEN", self.args() + ["--private-prestate", "/root/x"])
        self.assert_hold("USAGE", self.args(**{"--expect-ci-run-id": None}))
        self.assert_hold("USAGE", self.args(**{"--expect-ci-run-id": "abc"}))
        self.assert_hold("USAGE", self.args() + ["--unknown", "x"])

    def test_non_root(self):
        with open(os.path.join(self.bin, "id"), "w") as handle:
            handle.write("#!/bin/sh\necho 1000\n")
        _, calls, _ = self.assert_hold("NOT_ROOT")
        self.assertEqual(calls, [])

    def test_source_gates(self):
        self.assert_hold("SOURCE_HEAD_MISMATCH", self.args(**{"--expect-head": "0" * 40}))
        self.assert_hold("SOURCE_AUDITOR_SHA256", self.args(**{"--expect-auditor-sha256": "0" * 64}))

    def test_ci_binding(self):
        cases = ((dict(head_sha="0" * 40), "CI_OTHER_SHA"), (dict(path=".github/workflows/other.yaml"), "CI_OTHER_WORKFLOW"),
                 (dict(status="in_progress", conclusion=None), "CI_RUN_NOT_SUCCESS"), (dict(conclusion="failure"), "CI_RUN_NOT_SUCCESS"),
                 (dict(id=1), "CI_UNVERIFIED"))
        for overrides, reason in cases:
            self.state["ci"] = ci_state(self.head, **overrides)
            self.assert_hold(reason)
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"] = {"total_count": 2, "jobs": [job(self.head), job(self.head, job_id=2)]}
        self.assert_hold("CI_JOB_MISSING_OR_AMBIGUOUS")
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"] = {"total_count": 2, "jobs": [job(self.head), job(self.head, "other", "failure", 2)]}
        self.assert_hold("CI_JOB_NOT_SUCCESS")
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"]["jobs"][0]["head_sha"] = "1" * 40
        self.assert_hold("CI_JOB_OTHER_RUN")
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"] = None
        self.assert_hold("CI_UNVERIFIED")
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"] = {"jobs": "not-a-list"}
        self.assert_hold("CI_UNVERIFIED")

    def test_ci_run_attempt_repository_and_complete_listing(self):
        # R3B A1.3: the run attempt, both repositories, every job's run/attempt/SHA and a complete paginated listing.
        cases = (
            (dict(run_attempt=2), "CI_ATTEMPT_MISMATCH"),
            (dict(run_attempt="1"), "CI_UNVERIFIED"),
            (dict(head_repository={"full_name": "fork/NewsFlux"}), "CI_OTHER_REPOSITORY"),
            (dict(repository={"full_name": "other/NewsFlux"}), "CI_OTHER_REPOSITORY"),
            (dict(repository=None), "CI_OTHER_REPOSITORY"),
        )
        for overrides, reason in cases:
            self.state["ci"] = ci_state(self.head, **overrides)
            self.assert_hold(reason)
        jobs_cases = (
            ({"total_count": 3, "jobs": [job(self.head)]}, "CI_JOBS_INCOMPLETE"),          # listing shorter than total
            ({"total_count": 0, "jobs": []}, "CI_JOBS_INCOMPLETE"),
            ({"total_count": "1", "jobs": [job(self.head)]}, "CI_UNVERIFIED"),
            ({"total_count": 2, "jobs": [job(self.head), job(self.head, "lint", job_id=1)]}, "CI_JOBS_INCOMPLETE"),  # dup id
            ({"total_count": 1, "jobs": [job(self.head, attempt=2)]}, "CI_JOB_OTHER_RUN"),
            ({"total_count": 1, "jobs": [job(self.head, run_id=7)]}, "CI_JOB_OTHER_RUN"),
            ({"total_count": 1, "jobs": [job(self.head, status="in_progress", conclusion=None)]}, "CI_JOB_NOT_SUCCESS"),
            ({"total_count": 1, "jobs": [job(self.head, conclusion="skipped")]}, "CI_JOB_NOT_SUCCESS"),
            ({"total_count": 1, "jobs": [job(self.head, "other")]}, "CI_JOB_MISSING_OR_AMBIGUOUS"),
        )
        for jobs, reason in jobs_cases:
            self.state["ci"] = ci_state(self.head)
            self.state["ci"]["jobs"] = jobs
            self.assert_hold(reason)

    def test_ci_pagination_reads_every_page_and_the_attempt_endpoint(self):
        full = [job(self.head, "lint-%d" % i, job_id=i + 10) for i in range(100)]
        self.state["ci"] = ci_state(self.head)
        self.state["ci"]["jobs"] = [{"total_count": 101, "jobs": full}, {"total_count": 101, "jobs": [job(self.head)]}]
        code, lines, calls, _ = self.run_wrapper()
        self.assertEqual(code, 0, lines)
        urls = [c[-1] for c in calls if c[0] == "curl" and "/jobs" in c[-1]]
        self.assertEqual(len(urls), 2)
        self.assertTrue(all(f"/actions/runs/{CI_RUN}/attempts/1/jobs?per_page=100&page=" in u for u in urls), urls)
        # a failing job hidden on page 2 is found
        self.state["ci"]["jobs"] = [{"total_count": 101, "jobs": full},
                                    {"total_count": 101, "jobs": [job(self.head), ]}]
        self.state["ci"]["jobs"][1]["jobs"][0]["conclusion"] = "failure"
        self.assert_hold("CI_JOB_NOT_SUCCESS")
        # the total changing between pages, or a missing page, is incomplete
        self.state["ci"]["jobs"] = [{"total_count": 101, "jobs": full}, {"total_count": 102, "jobs": [job(self.head)]}]
        self.assert_hold("CI_JOBS_INCOMPLETE")
        self.state["ci"]["jobs"] = [{"total_count": 101, "jobs": full}]
        self.state["ci"]["total_override"] = 101
        self.assert_hold("CI_JOBS_INCOMPLETE")

    def test_g2_mode_is_exactly_one_source(self):
        self.assert_hold("USAGE", self.args(**{"--expect-ci-run-attempt": None}))
        self.assert_hold("USAGE", self.args(**{"--expect-ci-run-attempt": "0"}))
        self.assert_hold("USAGE", self.args() + ["--local-evidence", "/x"])
        self.assert_hold("USAGE", self.args(**{"--expect-ci-run-id": None, "--expect-ci-run-attempt": None}))
        local = self.args(**{"--expect-ci-run-id": None, "--expect-ci-run-attempt": None})
        self.assert_hold("USAGE", local + ["--local-evidence", "/a", "--local-replay", "/b"])
        self.assert_hold("USAGE", local + ["--local-evidence", "a", "--local-replay", "/b", "--local-approval", "/c"])
        for forbidden in ("--skip-ci", "--force", "--ignore-gates"):
            self.assert_hold("USAGE", self.args() + [forbidden, "1"])

    def test_litellm_identity_and_binding(self):
        self.state["containers"][LITELLM_ID] = [snap(LITELLM_ID, "sha256:" + "1" * 64, project="litellm", service="litellm")]
        self.assert_hold("LITELLM_IDENTITY_OR_IMAGE")
        self.setUp()
        self.state["images"][IMAGE_ID]["digests"] = ["ghcr.io/berriai/litellm-database@sha256:" + "2" * 64]
        self.assert_hold("LITELLM_IDENTITY_OR_IMAGE")
        self.setUp()
        self.assert_hold("IMAGE_NOT_LAB_PROVEN_FOR_VERSION", self.args(**{"--expect-litellm-version": "1.109.1"}))

    def test_summary_must_be_an_authorized_deploy_with_its_recorded_image(self):
        self.assert_hold("SUMMARY_REVISION_NOT_AUTHORIZED", self.args(**{"--expect-summary-revision": "d54eda2bdb8bc5c3d1bd58d40236f48da762e852"}))
        other = "sha256:" + "7" * 64
        self.state["containers"][SUMMARY_ID] = [snap(SUMMARY_ID, other)]
        self.state["images"][other] = {"revision": SUMMARY_REV}   # right label, unrecorded image: never adopted
        self.assert_hold("SUMMARY_IMAGE_NOT_AUTHORIZED")
        self.setUp()
        self.state["images"][SUMMARY_IMAGE]["revision"] = "1" * 40
        self.assert_hold("SUMMARY_REVISION_MISMATCH")

    def test_summary_selection(self):
        self.state["summary_ids"] = []
        self.assert_hold("SUMMARY_NOT_UNIQUE")
        self.state["summary_ids"] = [SUMMARY_ID, "6" * 64]
        self.assert_hold("SUMMARY_NOT_UNIQUE")
        self.state["summary_ids"] = [SUMMARY_ID]
        self.state["containers"][SUMMARY_ID] = [snap(SUMMARY_ID, SUMMARY_IMAGE, project="other")]
        self.assert_hold("SUMMARY_IDENTITY")
        self.state["containers"][SUMMARY_ID] = [snap(SUMMARY_ID, SUMMARY_IMAGE, status="restarting")]
        self.assert_hold("SUMMARY_IDENTITY")

    def test_restart_between_gates_and_run_holds_before_the_auditor(self):
        self.state["containers"][LITELLM_ID] = [snap(LITELLM_ID, IMAGE_ID, project="litellm", service="litellm"),
                                                snap(LITELLM_ID, IMAGE_ID, restarts=1, project="litellm", service="litellm")]
        self.assert_hold("IDENTITY_CHANGED_BETWEEN_GATES")
        self.setUp()
        self.state["containers"][SUMMARY_ID] = [snap(SUMMARY_ID, SUMMARY_IMAGE), snap(SUMMARY_ID, SUMMARY_IMAGE, restarts=2)]
        self.assert_hold("IDENTITY_CHANGED_BETWEEN_GATES", self.args() + ["--gates-only"])

    def test_change_after_the_run_holds_and_prints_no_receipt(self):
        same = snap(SUMMARY_ID, SUMMARY_IMAGE)
        self.state["containers"][SUMMARY_ID] = [same, same, snap(SUMMARY_ID, SUMMARY_IMAGE, restarts=1)]
        self.assert_hold("IDENTITY_CHANGED_AFTER_RUN", audited=True)


class WrapperLocalIndependentTests(WrapperBase):
    """G2_LOCAL_INDEPENDENT through the wrapper: verified offline evidence replaces the Actions run, but the mode
    stays inadmissible while the wrapper's PM-admitted signer table is empty."""

    def setUp(self):
        super().setUp()
        if not shutil.which("ssh-keygen"):
            self.skipTest("ssh-keygen is required")
        import test_g2_local_evidence as G
        self.keys_root = os.path.join(self.tmp.name, "keys")
        os.mkdir(self.keys_root)
        self.f = G.Fixture(self.keys_root, src=self.src, keep=("auditor",))   # the stub auditor stays bound
        self.head = self.f.head
        self.evidence = self.f.bundle()
        self.replay = self.f.bundle("REPLAY", "replayer")
        self.approval = self.f.approval(self.evidence, self.replay)

    def local_args(self, **overrides):
        values = {"--expect-ci-run-id": None, "--expect-ci-run-attempt": None, "--local-evidence": self.evidence,
                  "--local-replay": self.replay, "--local-approval": self.approval}
        values.update(overrides)
        return self.args(**values)

    def test_empty_admission_table_holds_before_any_docker_call(self):
        lines, calls, _ = self.assert_hold("G2L_SIGNERS_NOT_ADMITTED", self.local_args())
        self.assertEqual(calls, [])                       # no curl, no docker
        self.assertNotIn("S5R3_RUN_CI_GATE=PASS_LOCAL_INDEPENDENT_REPLAYED_APPROVED", lines)

    def test_admitted_signers_complete_the_run_with_local_evidence(self):
        # PM admission = a commit on top of the tested one that changes only the admitted-signers file
        self.head = self.f.admit()
        code, lines, calls, audits = self.run_wrapper(self.local_args())
        self.assertEqual(code, 0, lines)
        self.assertIn("S5R3_RUN_G2_MODE=LOCAL_INDEPENDENT", lines)
        self.assertIn("S5R3_RUN_CI_GATE=PASS_LOCAL_INDEPENDENT_REPLAYED_APPROVED", lines)
        self.assertEqual(lines[-1], "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY")
        self.assertFalse([c for c in calls if c[0] == "curl"])     # offline: GitHub is never asked
        # tampered evidence, a self-approval or a stale approval still hold through the wrapper
        with open(os.path.join(self.evidence, "SANITIZED_RECEIPT.txt"), "a") as handle:
            handle.write("x\n")
        self.assert_hold("G2L_BUNDLE_TAMPERED", self.local_args())
        other = self.f.bundle()
        self.assert_hold("G2L_SELF_APPROVAL", self.local_args(**{
            "--local-evidence": other, "--local-approval": self.f.approval(other, self.replay, reviewer="producer",
                                                                           key=self.f.keys["producer"])}))
        self.assert_hold("G2L_APPROVAL_OTHER_EVIDENCE", self.local_args(**{"--local-evidence": other}))
        self.assert_hold("G2L_APPROVAL_MISSING", self.local_args(**{"--local-evidence": other,
                                                                     "--local-approval": "/nonexistent/approval.json"}))

    def test_admission_commit_that_also_changes_code_holds(self):
        self.f.admit()
        self.head = self.f.commit({"ops/deploy/release-governance/s5_db_readonly_audit.py": "print('swapped')\n"}, "swap")
        self.sha = hashlib.sha256(b"print('swapped')\n").hexdigest()
        self.assert_hold("G2L_ADMISSION_DELTA_NOT_ALLOWED", self.local_args())

    def test_local_evidence_never_outranks_the_source_gate(self):
        self.assert_hold("SOURCE_HEAD_MISMATCH", self.local_args(**{"--expect-head": "0" * 40}))


class WrapperReceiptTests(WrapperBase):
    def hold_with(self, lines, code, reason):
        self.receipt = {"lines": lines, "code": code}
        self.assert_hold(reason, audited=True)

    def test_contract_rejections_never_echo_content(self):
        good = real_receipt()
        secret = [("S5R1_KEY_MATCH=SKLIVESECRETUPPERCASE0123456789" if line == "S5R1_KEY_MATCH=ONE" else line) for line in good]
        self.assertNotEqual(secret, good)
        cases = (
            (secret, 0, "RECEIPT_VALUE_NOT_ALLOWED"),
            (good[:-2] + ["S5R1_NEW_FIELD=PASS"] + good[-2:], 0, "RECEIPT_UNKNOWN_FIELD"),
            (good[:-2] + ["S5R1_KEY_POLICY_GATE=PASS"] + good[-2:], 0, "RECEIPT_DUPLICATE_FIELD"),
            (good[:-2] + ["S5R1_KEY_MODELS_COUNT=999999"] + good[-2:], 0, "RECEIPT_DUPLICATE_FIELD"),
            ([line for line in good if not line.startswith("S5R1_KEY_MODELS_COUNT")][:-2] + ["S5R1_KEY_MODELS_COUNT=999999"] + good[-2:],
             0, "RECEIPT_COUNT_OUT_OF_RANGE"),
            (good[:-2] + ["postgresql://user:pass@db/litellm"] + good[-2:], 0, "RECEIPT_UNEXPECTED_LINE"),
            (good[:5], 0, "RECEIPT_EXIT_INCOHERENT"),
            ([line for line in good if not line.startswith("S5R1_FLAGS_RUNTIME_PARSER")], 0, "RECEIPT_MISSING_REQUIRED"),
            (good[:-2] + ["S5R3_PRIVATE_PRESTATE_SHA256=" + "a" * 64] + good[-2:], 0, "RECEIPT_PRIVATE_PRESTATE"),
            (good + [NEXT], 0, "RECEIPT_UNEXPECTED_LINE"),
            (good, 2, "RECEIPT_EXIT_INCOHERENT"),
            (["S5R1_AUDIT=HOLD_SOMETHING_NEW"], 2, "RECEIPT_VALUE_NOT_ALLOWED"),
            (["S5R1_AUDIT=HOLD_AI_FLAGS_AMBIGUOUS", "S5R1_KEY_MATCH=ONE"], 2, "RECEIPT_EXIT_INCOHERENT"),
            (good, 7, "AUDITOR_EXIT_UNEXPECTED"),
            ([], 0, "RECEIPT_EXIT_INCOHERENT"),
        )
        for lines, code, reason in cases:
            self.setUp()
            self.receipt = {"lines": lines, "code": code}
            out, _, _ = self.assert_hold(reason, audited=True)
            joined = "\n".join(out)
            self.assertNotIn("SKLIVESECRET", joined)
            self.assertNotIn("postgresql", joined)
            self.assertNotIn("999999", joined)

    def test_auditor_holds_are_bounded_codes(self):
        self.hold_with(["S5R1_AUDIT=HOLD_AI_FLAGS_NOT_OFF"], 2, "AUDITOR_AI_FLAGS_NOT_OFF")
        self.setUp()
        self.hold_with(["S5R1_AUDIT=HOLD_IDENTITY_CHANGED_BEFORE_EXEC"], 2, "AUDITOR_IDENTITY_CHANGED_BEFORE_EXEC")
        self.setUp()
        changed = real_receipt(identity="CHANGED")[:-2] + ["S5R1_AUDIT=HOLD_CONTAINER_STATE_CHANGED"]
        self.hold_with(changed, 3, "AUDITOR_CONTAINER_STATE_CHANGED")

    def test_unchanged_identity_required_and_version_bound(self):
        self.hold_with(real_receipt(identity="CHANGED"), 0, "RECEIPT_CONTAINER_CHANGED")
        self.setUp()
        self.hold_with(real_receipt(version="1.109.1"), 0, "RECEIPT_VERSION_MISMATCH")

    def test_filesystem_integrity_claim_must_stay_not_proven(self):
        lines = [line.replace("FILESYSTEM_INTEGRITY=NOT_PROVEN", "FILESYSTEM_INTEGRITY=PROVEN") for line in real_receipt()]
        self.hold_with(lines, 0, "RECEIPT_VALUE_NOT_ALLOWED")


class ReceiptContractCoverageTests(unittest.TestCase):
    """Every line the real auditor can produce is in the contract; the contract is not a regex."""

    def setUp(self):
        self.ns = contract()

    def receipts(self):
        variants = [None, T.R3Db(row=T.lab_key_row(models=["all-proxy-models"], rpm_limit=None, max_budget=None, budget_duration=None)),
                    T.R3Db(row=T.lab_key_row(object_permission_id="op-synthetic", agent_id="a", user_id="u", tpd_limit=5),
                           objperms={"op-synthetic": [T.empty_objperm(vector_stores=["v"], mcp_tool_search_enabled=True)]}),
                    T.R3Db(key_columns=T.LAB_KEY_COLUMNS + ("future",)),
                    T.R3Db(row=T.lab_key_row(budget_id="b", max_budget=None, budget_duration=None),
                           budgets={"b": {"rpm_limit": 1, "tpm_limit": 2, "max_budget": 0.5, "budget_duration": "1d"}})]
        for db in variants:
            for version in ("1.110.0", "1.109.1", None, "2.0.0"):
                yield real_receipt(db, version=version)
        none = T.R3Db()
        none.tokens = []
        yield real_receipt(none)
        for config in ({"general_settings": {"enable_jwt_auth": True}},
                       {"router_settings": {"fallbacks": [{T.ALIAS: ["x"]}]}, "litellm_settings": {"success_callback": ["langfuse", "custom_x"]}}):
            facts = T.collect(T.FakeDb(config=config))
            yield audit.render({**facts, **HOST_FACTS}, container_identity="UNCHANGED")

    def test_every_auditor_line_is_in_the_contract(self):
        checked = 0
        for lines in self.receipts():
            for line in lines:
                if line == NEXT or line == "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY":
                    continue
                name, value = re.fullmatch(r"S5R1_([A-Z0-9_]+)=(.+)", line).groups()
                self.assertIn(name, self.ns["CONTRACT"], line)
                self.assertTrue(self.ns["CONTRACT"][name](value), line)
                checked += 1
        self.assertGreater(checked, 300)

    def test_contract_sets_cover_auditor_constants(self):
        self.assertTrue(set(audit.PROVIDER_FAMILIES.values()) <= self.ns["FAMILIES"])
        self.assertTrue({name.upper() for name in audit.CALLBACK_FAMILIES} <= self.ns["CALLBACKS"])
        self.assertEqual({label for _, label in audit.R3_EXTRA_INDIRECTION}, self.ns["EXTRA_IND"])
        self.assertEqual({label for _, label in audit.R3_EXTRA_LIMITS}, self.ns["EXTRA_LIM"])

    def test_every_auditor_hold_code_is_bounded(self):
        with open(audit.__file__, encoding="utf-8") as handle:
            source = handle.read()
        raised = set(re.findall(r'ProbeError\("([A-Z0-9_]+)"\)', source)) - {"PRESTATE_WRITE_REFUSED", "PRESTATE_MODE_UNEXPECTED",
                                                                             "DB_NOT_READ_ONLY", "DB_SCHEMA_UNSUPPORTED", "DB_UNAVAILABLE"}
        printed = set(re.findall(r'S5R1_AUDIT=HOLD_([A-Z0-9_]+)"', source)) - {"PRIVATE_PRESTATE_NOT_WRITTEN"}
        flags = {f"AI_FLAGS_{cls}" for cls in ("AMBIGUOUS", "DUPLICATE")}
        probe = {f"PROBE_{c}" for c in ("INPUT_INVALID", "DB_UNAVAILABLE", "DB_READ_FAILED", "DB_NOT_READ_ONLY",
                                        "DB_SCHEMA_UNSUPPORTED", "PROBE_OUTPUT_UNSAFE", "UNSAFE")}
        docker = {f"DOCKER_{c}_FAILED" for c in ("INSPECT", "EXEC", "PS")}
        self.assertEqual(raised | printed | flags | probe | docker, self.ns["AUDITOR_HOLDS"])

    def test_validate_directly(self):
        verdict, kept = self.ns["validate"]("\n".join(real_receipt()) + "\n", 0, "1_110_0")
        self.assertEqual(verdict, "OK")
        self.assertNotIn(NEXT, kept)
        self.assertEqual(self.ns["validate"]("S5R1_KEY_MATCH=ONE\nS5R1_KEY_MATCH=ONE\n", 0, "1_110_0")[0], "RECEIPT_DUPLICATE_FIELD")

    def test_identity_format_matches_the_auditor(self):
        with open(WRAPPER, encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("IDENTITY_FORMAT='" + audit.IDENTITY_FORMAT + "'", text)


if __name__ == "__main__":
    unittest.main()
