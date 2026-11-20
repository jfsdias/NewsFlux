"""S5-R3 production LiteLLM image inventory: metadata only. A fake `docker` on PATH records every call."""
from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "s5-litellm-image-inventory.sh")
CID = "09650c457315" + "a" * 52
IMAGE_ID = "sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"
REF = "ghcr.io/berriai/litellm-database:main-latest"
DIGEST = "ghcr.io/berriai/litellm-database@sha256:" + "b" * 64

FAKE = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["FAKE_STATE"]) as handle:
    state = json.load(handle)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\n")
args = sys.argv[1:]
if args[0] in state.get("fail", []):
    sys.exit(1)
if args[:1] == ["inspect"]:
    fmt = args[args.index("--format") + 1]
    target = args[-1]
    if target not in (state["cid"], state["name"]):
        sys.exit(1)
    c = state["container"]
    if state.get("restart_after_first") and os.path.exists(os.environ["FAKE_LOG"] + ".seen"):
        c = dict(c, RestartCount=c["RestartCount"] + 1)
    if "{{.State.StartedAt}}" in fmt:
        open(os.environ["FAKE_LOG"] + ".seen", "w").close()
    out = fmt
    for key, value in (("{{.Id}}", state["cid"]), ("{{.Name}}", "/" + state["name"]), ("{{.Image}}", c["Image"]),
                       ("{{.Config.Image}}", c["ConfigImage"]), ("{{.State.Status}}", c["Status"]),
                       ("{{.State.StartedAt}}", c["StartedAt"]), ("{{.RestartCount}}", str(c["RestartCount"])),
                       ('{{index .Config.Labels "com.docker.compose.project"}}', c["Project"]),
                       ('{{index .Config.Labels "com.docker.compose.service"}}', c["Service"])):
        out = out.replace(key, value)
    print(out)
    sys.exit(0)
if args[:2] == ["image", "inspect"]:
    fmt = args[args.index("--format") + 1]
    if args[-1] != state["image"]["Id"]:
        sys.exit(1)
    i = state["image"]
    out = fmt
    for key, value in (("{{.Id}}", i["Id"]), ("{{json .RepoDigests}}", json.dumps(i["RepoDigests"])),
                       ("{{.Created}}", i["Created"]), ("{{.Architecture}}", i["Architecture"]), ("{{.Os}}", i["Os"]),
                       ('{{index .Config.Labels "org.opencontainers.image.version"}}', i.get("Version", "")),
                       ('{{index .Config.Labels "org.opencontainers.image.revision"}}', i.get("Revision", ""))):
        out = out.replace(key, value)
    print(out)
    sys.exit(0)
if args[:1] == ["exec"]:
    print(state.get("package_version", "1.2.3"))
    sys.exit(0)
sys.exit(97)  # anything else is a forbidden call
'''


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = os.path.join(self.tmp.name, "bin")
        os.mkdir(self.bin)
        fake = os.path.join(self.bin, "docker")
        with open(fake, "w") as handle:
            handle.write(FAKE)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        self.log = os.path.join(self.tmp.name, "calls.log")
        self.state_path = os.path.join(self.tmp.name, "state.json")
        self.state = {
            "cid": CID, "name": "litellm",
            "container": {"Image": IMAGE_ID, "ConfigImage": REF, "Status": "running", "StartedAt": "2026-11-01T00:00:00Z",
                          "RestartCount": 0, "Project": "litellm", "Service": "litellm"},
            "image": {"Id": IMAGE_ID, "RepoDigests": [DIGEST], "Created": "2026-11-10T00:00:00Z", "Architecture": "amd64",
                      "Os": "linux", "Version": "", "Revision": "abc123"},
        }

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, env_extra=None):
        with open(self.state_path, "w") as handle:
            json.dump(self.state, handle)
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], FAKE_STATE=self.state_path, FAKE_LOG=self.log)
        env.update(env_extra or {})
        result = subprocess.run(["bash", SCRIPT, *args], capture_output=True, text=True, env=env, timeout=60)
        calls = []
        if os.path.exists(self.log):
            with open(self.log, encoding="utf-8") as handle:
                calls = [json.loads(line) for line in handle]
        return result.returncode, result.stdout.splitlines(), calls

    base = ("--container", "litellm", "--expect-id-prefix", "09650c457315", "--project", "litellm", "--service", "litellm")

    def test_metadata_only_success(self):
        code, lines, calls = self.run_script(*self.base)
        self.assertEqual(code, 0, lines)
        for expected in (f"S5R3_INV_CONTAINER_ID={CID}", f"S5R3_INV_IMAGE_ID={IMAGE_ID}", f"S5R3_INV_CONFIG_IMAGE={REF}",
                         f"S5R3_INV_REPO_DIGESTS={DIGEST}", "S5R3_INV_IMAGE_ID_RESOLVES=YES", "S5R3_INV_ARCH=linux/amd64",
                         "S5R3_INV_LABEL_VERSION=ABSENT", "S5R3_INV_PACKAGE_VERSION=NOT_COLLECTED_METADATA_ONLY",
                         "S5R3_INV_CONTAINER_IDENTITY=UNCHANGED", "S5R3_INV_RESULT=COMPLETE_METADATA_ONLY"):
            self.assertIn(expected, lines)
        for call in calls:
            self.assertIn(call[0], ("inspect", "image"), call)       # never exec/pull/run/restart/rm/ps env
            self.assertNotIn("{{range .Config.Env}}", " ".join(call))
            self.assertNotIn(".Mounts", " ".join(call))
            self.assertNotIn("NetworkSettings", " ".join(call))
        self.assertNotIn("abc123", "\n".join(lines))  # base-layer revision label is not printed as provenance

    def test_identity_mismatches_hold_without_further_calls(self):
        for mutate, reason in (
            (lambda s: s.update(name="other"), "HOLD_TARGET_NOT_FOUND"),
            (lambda s: s.update(cid="ffff" + CID[4:]), "HOLD_TARGET_ID_PREFIX"),
            (lambda s: s["container"].update(Project="other"), "HOLD_COMPOSE_LABELS"),
            (lambda s: s["container"].update(Status="exited"), "HOLD_NOT_RUNNING"),
        ):
            self.setUp()
            mutate(self.state)
            code, lines, calls = self.run_script(*self.base)
            self.assertEqual(code, 2, (reason, lines))
            self.assertIn(f"S5R3_INV_RESULT={reason}", lines)
            self.assertFalse([c for c in calls if c[:1] == ["image"]], reason)
            self.tearDown()

    def test_id_prefix_is_required_and_checked(self):
        code, lines, calls = self.run_script("--container", "litellm")
        self.assertEqual(code, 2)
        self.assertIn("S5R3_INV_RESULT=HOLD_USAGE", lines)
        self.assertEqual(calls, [])
        code, lines, _ = self.run_script("--container", "litellm", "--expect-id-prefix", "0000aaaa1111")
        self.assertIn("S5R3_INV_RESULT=HOLD_TARGET_ID_PREFIX", lines)

    def test_repo_digests_are_filtered_and_may_be_absent(self):
        self.state["image"]["RepoDigests"] = ["bad value; rm -rf /", DIGEST]
        code, lines, _ = self.run_script(*self.base)
        self.assertIn(f"S5R3_INV_REPO_DIGESTS={DIGEST}", lines)
        self.assertNotIn("rm -rf", "\n".join(lines))
        self.state["image"]["RepoDigests"] = []
        code, lines, _ = self.run_script(*self.base)
        self.assertEqual(code, 0)
        self.assertIn("S5R3_INV_REPO_DIGESTS=NONE", lines)   # locally built or digest unknown: reported, not invented

    def test_label_version_is_sanitized(self):
        self.state["image"]["Version"] = "v1.110.0"
        _, lines, _ = self.run_script(*self.base)
        self.assertIn("S5R3_INV_LABEL_VERSION=v1.110.0", lines)
        self.state["image"]["Version"] = "1.0 $(evil)"
        _, lines, _ = self.run_script(*self.base)
        self.assertIn("S5R3_INV_LABEL_VERSION=UNRECOGNIZED", lines)

    def test_container_change_during_read_is_a_hold(self):
        self.state["restart_after_first"] = True
        code, lines, _ = self.run_script(*self.base)
        self.assertEqual(code, 3, lines)
        self.assertIn("S5R3_INV_RESULT=HOLD_CONTAINER_STATE_CHANGED", lines)

    def test_version_read_requires_explicit_approval_reference(self):
        code, lines, calls = self.run_script(*self.base, "--with-version-read")
        self.assertEqual(code, 2)
        self.assertIn("S5R3_INV_RESULT=HOLD_USAGE", lines)
        self.assertFalse([c for c in calls if c[:1] == ["exec"]])
        self.state["package_version"] = "1.110.0"
        code, lines, calls = self.run_script(*self.base, "--with-version-read", "PM-7038526448")
        self.assertEqual(code, 0, lines)
        self.assertIn("S5R3_INV_PACKAGE_VERSION=1.110.0", lines)
        self.assertIn("S5R3_INV_VERSION_READ_APPROVAL=PM-7038526448", lines)
        execs = [c for c in calls if c[:1] == ["exec"]]
        self.assertEqual(len(execs), 1)
        self.assertEqual(execs[0][1], CID)                      # full immutable ID, never a name
        self.assertIn("-B", execs[0])
        self.assertIn("-I", execs[0])
        self.assertNotIn("-u", execs[0])
        self.assertNotIn("import litellm", " ".join(execs[0]))  # metadata only, the package is not imported

    def test_unsafe_package_version_is_not_printed(self):
        self.state["package_version"] = "1.0; cat /etc/shadow"
        _, lines, _ = self.run_script(*self.base, "--with-version-read", "PM-7038526448")
        self.assertIn("S5R3_INV_PACKAGE_VERSION=UNRECOGNIZED", lines)

    def test_docker_failure_is_a_hold(self):
        self.state["fail"] = ["image"]
        code, lines, _ = self.run_script(*self.base)
        self.assertEqual(code, 2)
        self.assertIn("S5R3_INV_RESULT=HOLD_IMAGE_UNREADABLE", lines)


if __name__ == "__main__":
    unittest.main()
