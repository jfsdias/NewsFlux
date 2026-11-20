"""S5-R3 OMV read-only wrapper: every gate, in order, with fake docker/curl and a stub auditor in a real git repo."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(HERE, "s5-r3-omv-readonly-run.sh")
LITELLM_ID = "09650c4573154471943d576a4a2429ac3c7a3f5fecb2e132a5444be51789e50b"
IMAGE_ID = "sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"
DIGEST = "ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a"
SUMMARY_REV = "d54eda2bdb8bc5c3d1bd58d40236f48da762e852"
SUMMARY_ID = "5" * 64
SUMMARY_IMAGE = "sha256:" + "6" * 64
GOOD_RECEIPT = [
    "S5R1_DB_READ_ONLY=VERIFIED", "S5R1_KEY_MATCH=ONE", "S5R1_KEY_POLICY_GATE=FAIL", "S5R1_KEY_POLICY_GATE_R3=FAIL",
    "S5R1_LITELLM_VERSION=1_110_0", "S5R1_LITELLM_VERSION_CLASS=LAB_REHEARSED", "S5R1_JWT_AUTH=DISABLED",
    "S5R1_DELIBERATE_DB_CONFIG_WRITES=NONE", "S5R1_CONTAINER_IDENTITY=UNCHANGED", "S5R1_FILESYSTEM_INTEGRITY=NOT_PROVEN",
    "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY",
    "NEXT=evidence for PM review only; S5_PREFLIGHT is unchanged (no official attestation produced)",
]

STUB_AUDITOR = r'''import json, os, sys
with open(os.environ["STUB_LOG"], "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\n")
with open(os.environ["STUB_RECEIPT"]) as handle:
    receipt = json.load(handle)
print("\n".join(receipt["lines"]))
sys.exit(receipt.get("code", 0))
'''

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["FAKE_STATE"]) as handle:
    state = json.load(handle)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["docker"] + sys.argv[1:]) + "\n")
args = sys.argv[1:]
calls_path = os.environ["FAKE_LOG"] + ".n"
n = int(open(calls_path).read()) if os.path.exists(calls_path) else 0
open(calls_path, "w").write(str(n + 1))
if args[0] == "inspect":
    fmt, target = args[args.index("--format") + 1], args[-1]
    if target == state["litellm_id"]:
        image = state["litellm_image"]
        if state.get("image_changes_after") is not None and n >= state["image_changes_after"]:
            image = "sha256:" + "9" * 64
        print(fmt.replace("{{.Id}}", state["litellm_id"]).replace("{{.State.Status}}", state["litellm_status"]).replace("{{.Image}}", image))
        sys.exit(0)
    if target == state["summary_id"]:
        print(fmt.replace("{{.Image}}", state["summary_image"]))
        sys.exit(0)
    sys.exit(1)
if args[:2] == ["image", "inspect"]:
    fmt, target = args[args.index("--format") + 1], args[-1]
    if target == state["image_id"]:
        print(fmt.replace("{{.Id}}", state["image_id"]).replace("{{json .RepoDigests}}", json.dumps(state["digests"])))
        sys.exit(0)
    if target == state["summary_image"]:
        print(state["summary_rev"])
        sys.exit(0)
    sys.exit(1)
if args[0] == "ps":
    print("\n".join(state["summary_ids"]))
    sys.exit(0)
sys.exit(97)  # anything else (exec, run, pull, rm, restart...) is forbidden for the wrapper itself
'''

FAKE_CURL = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["FAKE_STATE"]) as handle:
    state = json.load(handle)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["curl"] + sys.argv[1:]) + "\n")
if state.get("ci") is None:
    sys.exit(22)
print(json.dumps({"total_count": len(state["ci"]), "check_runs": state["ci"]}))
'''


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.src = os.path.join(root, "src")
        os.makedirs(os.path.join(self.src, "deploy", "release-governance"))
        self.auditor = os.path.join(self.src, "deploy", "release-governance", "s5_db_readonly_audit.py")
        with open(self.auditor, "w") as handle:
            handle.write(STUB_AUDITOR)
        git = ["git", "-C", self.src, "-c", "user.email=t@example.invalid", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q", self.src], check=True)
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "stub"], check=True)
        self.head = subprocess.run(["git", "-C", self.src, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        with open(self.auditor, "rb") as handle:
            self.sha = hashlib.sha256(handle.read()).hexdigest()
        self.bin = os.path.join(root, "bin")
        os.mkdir(self.bin)
        # A fake `id` reporting root lets the suite run on non-root CI runners; the wrapper has no bypass flag.
        for name, body in (("docker", FAKE_DOCKER), ("curl", FAKE_CURL), ("id", "#!/bin/sh\necho 0\n")):
            path = os.path.join(self.bin, name)
            with open(path, "w") as handle:
                handle.write(body)
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
        self.log = os.path.join(root, "calls.log")
        self.stub_log = os.path.join(root, "auditor.log")
        self.receipt = os.path.join(root, "receipt.json")
        self.state_path = os.path.join(root, "state.json")
        self.state = {"litellm_id": LITELLM_ID, "litellm_status": "running", "litellm_image": IMAGE_ID, "image_id": IMAGE_ID,
                      "digests": [DIGEST], "summary_ids": [SUMMARY_ID], "summary_id": SUMMARY_ID, "summary_image": SUMMARY_IMAGE,
                      "summary_rev": SUMMARY_REV, "ci": [{"name": "synthetic-release", "status": "completed", "conclusion": "success"}]}
        self.receipt_doc = {"lines": list(GOOD_RECEIPT), "code": 0}

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, **overrides):
        values = {"--source": self.src, "--expect-head": self.head, "--expect-auditor-sha256": self.sha,
                  "--litellm-container-id": LITELLM_ID, "--expect-image-id": IMAGE_ID, "--expect-repo-digest": DIGEST,
                  "--expect-litellm-version": "1.110.0", "--summary-project": "newsflux", "--summary-service": "summary-api",
                  "--expect-summary-revision": SUMMARY_REV}
        values.update(overrides)
        return [part for key, value in values.items() if value is not None for part in (key, value)]

    def run_wrapper(self, argv):
        with open(self.state_path, "w") as handle:
            json.dump(self.state, handle)
        with open(self.receipt, "w") as handle:
            json.dump(self.receipt_doc, handle)
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], FAKE_STATE=self.state_path,
                   FAKE_LOG=self.log, STUB_LOG=self.stub_log, STUB_RECEIPT=self.receipt)
        result = subprocess.run(["bash", WRAPPER, *argv], capture_output=True, text=True, env=env, timeout=60)
        calls = []
        if os.path.exists(self.log):
            with open(self.log) as handle:
                calls = [json.loads(line) for line in handle]
        audits = []
        if os.path.exists(self.stub_log):
            with open(self.stub_log) as handle:
                audits = [json.loads(line) for line in handle]
        return result.returncode, result.stdout.splitlines(), calls, audits

    def assert_hold(self, reason, argv=None, audited=False):
        code, lines, calls, audits = self.run_wrapper(argv if argv is not None else self.args())
        self.assertEqual(code, 2, lines)
        self.assertIn(f"S5R3_RUN_RESULT=HOLD_{reason}", lines)
        if not audited:
            self.assertEqual(audits, [], "the auditor must not run after a failed pre-gate")
        return lines, calls

    def test_happy_path(self):
        code, lines, calls, audits = self.run_wrapper(self.args())
        self.assertEqual(code, 0, lines)
        for expected in ("S5R3_RUN_PRIVATE_PRESTATE=OFF", "S5R3_RUN_SOURCE_GATE=PASS_EXACT_HEAD", "S5R3_RUN_CI_GATE=PASS_EXACT_HEAD",
                         "S5R3_RUN_LITELLM_IDENTITY_GATE=PASS", "S5R3_RUN_IMAGE_VERSION_BINDING=PASS_1_110_0",
                         "S5R3_RUN_SUMMARY_REVISION_GATE=PASS", "S5R1_LITELLM_VERSION=1_110_0", "S5R3_RUN_POST_GATES=PASS",
                         "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY"):
            self.assertIn(expected, lines)
        self.assertEqual(audits, [["--litellm-container", LITELLM_ID]])       # never --private-prestate
        for call in calls:
            self.assertIn(call[0], ("docker", "curl"))
            if call[0] == "docker":
                self.assertIn(call[1], ("inspect", "image", "ps"), call)   # no exec/run/pull/rm by the wrapper
        self.assertTrue(any(c[0] == "curl" and f"/commits/{self.head}/check-runs" in c[-1] for c in calls))

    def test_non_root_holds_before_any_call(self):
        with open(os.path.join(self.bin, "id"), "w") as handle:
            handle.write("#!/bin/sh\necho 1000\n")
        lines, calls = self.assert_hold("NOT_ROOT")
        self.assertEqual(calls, [])

    def test_prestate_cannot_be_enabled(self):
        for extra in (["--private-prestate", "/root/x"], ["--source", "/tmp/prestate"]):
            lines, _ = self.assert_hold("PRIVATE_PRESTATE_FORBIDDEN", self.args() + extra)

    def test_usage_holds(self):
        self.assert_hold("USAGE", self.args(**{"--expect-head": "abc"}))
        self.assert_hold("USAGE", self.args(**{"--expect-summary-revision": None}))
        self.assert_hold("USAGE", self.args() + ["--unknown", "x"])
        self.assert_hold("USAGE", self.args(**{"--expect-repo-digest": "ghcr.io/berriai/litellm-database:main-latest"}))

    def test_source_gates(self):
        self.assert_hold("SOURCE_HEAD_MISMATCH", self.args(**{"--expect-head": "0" * 40}))
        self.assert_hold("SOURCE_AUDITOR_SHA256", self.args(**{"--expect-auditor-sha256": "0" * 64}))
        with open(self.auditor, "a") as handle:
            handle.write("# tampered\n")
        self.assert_hold("SOURCE_NOT_CLEAN")

    def test_ci_gates(self):
        self.state["ci"] = None
        self.assert_hold("CI_UNVERIFIED")
        self.state["ci"] = []
        self.assert_hold("CI_MISSING_SYNTHETIC_RELEASE")
        self.state["ci"] = [{"name": "synthetic-release", "status": "completed", "conclusion": "success"},
                            {"name": "quality", "status": "completed", "conclusion": "failure"}]
        self.assert_hold("CI_FAILED_OR_PENDING")
        self.state["ci"] = [{"name": "synthetic-release", "status": "in_progress", "conclusion": None}]
        self.assert_hold("CI_FAILED_OR_PENDING")

    def test_litellm_identity_and_image_gates(self):
        baseline = json.loads(json.dumps(self.state))
        for mutate in (lambda s: s.update(litellm_status="exited"), lambda s: s.update(litellm_image="sha256:" + "1" * 64),
                       lambda s: s.update(digests=["ghcr.io/berriai/litellm-database@sha256:" + "2" * 64]),
                       lambda s: s.update(digests=[])):
            self.state = json.loads(json.dumps(baseline))
            mutate(self.state)
            self.assert_hold("LITELLM_IDENTITY_OR_IMAGE")
        self.state = baseline
        self.assert_hold("LITELLM_IDENTITY_OR_IMAGE", self.args(**{"--litellm-container-id": "f" * 64}))

    def test_image_version_binding(self):
        self.assert_hold("IMAGE_NOT_LAB_PROVEN_FOR_VERSION", self.args(**{"--expect-litellm-version": "1.109.1"}))
        other = "sha256:" + "3" * 64
        self.state.update(litellm_image=other, image_id=other)
        self.assert_hold("IMAGE_NOT_LAB_PROVEN_FOR_VERSION", self.args(**{"--expect-image-id": other}))

    def test_summary_gates(self):
        self.state["summary_ids"] = []
        self.assert_hold("SUMMARY_NOT_UNIQUE")
        self.state["summary_ids"] = [SUMMARY_ID, "7" * 64]
        self.assert_hold("SUMMARY_NOT_UNIQUE")
        self.state["summary_ids"] = [SUMMARY_ID]
        self.state["summary_rev"] = "1" * 40
        self.assert_hold("SUMMARY_REVISION_MISMATCH")

    def test_receipt_post_gates(self):
        cases = (("S5R1_LITELLM_VERSION=1_110_0", "S5R1_LITELLM_VERSION=1_109_1", "RECEIPT_VERSION_MISMATCH"),
                 ("S5R1_LITELLM_VERSION_CLASS=LAB_REHEARSED", "S5R1_LITELLM_VERSION_CLASS=NOT_REHEARSED", "RECEIPT_VERSION_NOT_REHEARSED"),
                 ("S5R1_CONTAINER_IDENTITY=UNCHANGED", "S5R1_CONTAINER_IDENTITY=CHANGED", "RECEIPT_CONTAINER_CHANGED"),
                 ("S5R1_DB_READ_ONLY=VERIFIED", "S5R1_DB_READ_ONLY=NOT_VERIFIED", "RECEIPT_READ_ONLY_UNVERIFIED"),
                 ("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", "S5R1_AUDIT=HOLD_AI_FLAGS_NOT_OFF", "RECEIPT_NOT_COMPLETE"))
        for old, new, reason in cases:
            self.receipt_doc = {"lines": [new if line == old else line for line in GOOD_RECEIPT], "code": 0}
            self.assert_hold(reason, audited=True)

    def test_flags_on_is_a_hold_from_the_auditor(self):
        self.receipt_doc = {"lines": ["S5R1_AUDIT=HOLD_AI_FLAGS_NOT_OFF"], "code": 2}
        lines, _ = self.assert_hold("AUDITOR_EXIT_2", audited=True)
        self.assertIn("S5R1_AUDIT=HOLD_AI_FLAGS_NOT_OFF", lines)

    def test_unsafe_output_is_never_printed(self):
        secret_line = "postgresql://user:secret@db/litellm"
        self.receipt_doc = {"lines": GOOD_RECEIPT + [secret_line, "S5R1_X=lowercase-value", "S5R3_PRIVATE_PRESTATE_SHA256=ab"], "code": 0}
        lines, _ = self.assert_hold("OUTPUT_UNSAFE", audited=True)
        text = "\n".join(lines)
        self.assertNotIn("secret", text)
        self.assertNotIn("lowercase", text)
        self.assertNotIn("PRIVATE_PRESTATE_SHA256", text)

    def test_litellm_changed_after_run(self):
        code, lines, calls, _ = self.run_wrapper(self.args())
        docker_calls = sum(1 for c in calls if c[0] == "docker")
        os.unlink(self.log + ".n")                              # restart the fake's call counter
        self.state["image_changes_after"] = docker_calls - 3   # only the post-run identity re-check sees a new image
        self.assert_hold("LITELLM_CHANGED_AFTER_RUN", audited=True)


if __name__ == "__main__":
    unittest.main()
