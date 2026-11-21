"""S5-R3B A1.2: the operator executor and the documented one-line command never report success for a failure.

A local git repository stands in for GitHub (a fake `git` rewrites only the clone URL, a fake `curl` serves the
executor from that repository); the wrapper inside it is a stub with a configurable exit code."""
from __future__ import annotations

import hashlib
import os
import signal
import stat
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
EXECUTOR = os.path.join(HERE, "s5-r3-omv-executor.sh")
TEMPLATE = os.path.join(HERE, "s5-r3-operator-command.template")
WRAPPER_REL = "deploy/release-governance/s5-r3-omv-readonly-run.sh"
EXECUTOR_REL = "deploy/release-governance/s5-r3-omv-executor.sh"
REAL_GIT = subprocess.run(["bash", "-c", "command -v git"], capture_output=True, text=True, check=True).stdout.strip()

STUB_WRAPPER = r'''#!/usr/bin/env bash
printf '%s\n' "$@" > "$(dirname "$0")/../../../args.seen"
echo "S5R3_RUN_PRIVATE_PRESTATE=OFF"
[[ -n "${STUB_SLEEP:-}" ]] && sleep "$STUB_SLEEP"
if [[ "${STUB_CODE:-0}" == 0 ]]; then echo "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY"; else echo "S5R3_RUN_RESULT=HOLD_STUB"; fi
exit "${STUB_CODE:-0}"
'''

FAKE_GIT = r'''#!/usr/bin/env bash
args=()
for a in "$@"; do
  if [[ "$a" == "https://github.com/jfsdias/NewsFlux.git" ]]; then args+=("$FAKE_ORIGIN"); else args+=("$a"); fi
done
[[ -n "${FAKE_GIT_FAIL_CLONE:-}" && "$1" == clone ]] && exit 128
exec "$REAL_GIT" "${args[@]}"
'''

FAKE_CURL = r'''#!/usr/bin/env bash
out="" url=""
while [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2 ;; *) url="$1"; shift ;; esac; done
[[ -n "${FAKE_CURL_FAIL:-}" ]] && exit 22
prefix="https://raw.githubusercontent.com/jfsdias/NewsFlux/"
[[ "$url" == "$prefix"* ]] || exit 6
rest="${url#"$prefix"}"
"$REAL_GIT" -C "$FAKE_ORIGIN" show "${rest%%/*}:${rest#*/}" > "$out" || exit 22
'''


def write_exe(path, body):
    with open(path, "w") as handle:
        handle.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)


class ExecutorBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.origin = os.path.join(root, "origin")
        os.makedirs(os.path.join(self.origin, "deploy", "release-governance"))
        write_exe(os.path.join(self.origin, WRAPPER_REL), STUB_WRAPPER)
        with open(EXECUTOR) as source:
            write_exe(os.path.join(self.origin, EXECUTOR_REL), source.read())
        git = [REAL_GIT, "-C", self.origin, "-c", "user.email=t@example.invalid", "-c", "user.name=t"]
        subprocess.run([REAL_GIT, "init", "-q", self.origin], check=True)
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "stub"], check=True)
        self.head = subprocess.run(git + ["rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        self.wrapper_sha = self.sha(os.path.join(self.origin, WRAPPER_REL))
        self.executor_sha = self.sha(EXECUTOR)
        self.bin = os.path.join(root, "bin")
        os.mkdir(self.bin)
        write_exe(os.path.join(self.bin, "git"), FAKE_GIT)
        write_exe(os.path.join(self.bin, "curl"), FAKE_CURL)
        self.workdir = os.path.join(root, "work", "run")
        os.mkdir(os.path.join(root, "work"))
        self.env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], FAKE_ORIGIN=self.origin, REAL_GIT=REAL_GIT)

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def sha(path):
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()

    def run_executor(self, extra_env=None, *, head=None, wrapper_sha=None, workdir=None, wrapper_args=("--gates-only",)):
        argv = ["bash", EXECUTOR, "--workdir", workdir or self.workdir, "--expect-head", head or self.head,
                "--expect-wrapper-sha256", wrapper_sha or self.wrapper_sha, "--", *wrapper_args]
        result = subprocess.run(argv, capture_output=True, text=True, env=dict(self.env, **(extra_env or {})), timeout=60)
        return result.returncode, result.stdout.splitlines()


class ExecutorExitTests(ExecutorBase):
    def test_success_is_the_only_zero(self):
        code, lines = self.run_executor()
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-2:], ["S5R3_EXEC_WRAPPER_EXIT=0", "S5R3_EXEC_EXIT=0"])
        with open(os.path.join(self.workdir, "receipt.txt")) as handle:
            self.assertIn("S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY", handle.read())
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.workdir, "receipt.txt")).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.workdir).st_mode), 0o700)
        with open(os.path.join(self.workdir, "args.seen")) as handle:
            seen = handle.read().split()
        self.assertEqual(seen[:4], ["--source", os.path.join(self.workdir, "src"), "--expect-head", self.head])

    def test_wrapper_hold_and_changed_state_survive_tee(self):
        for wrapper_code in (2, 3, 1):
            self.tearDown()
            self.setUp()
            code, lines = self.run_executor({"STUB_CODE": str(wrapper_code)})
            self.assertEqual(code, wrapper_code, lines)
            self.assertEqual(lines[-1], f"S5R3_EXEC_EXIT={wrapper_code}")

    def test_receipt_not_saved_is_non_zero(self):
        write_exe(os.path.join(self.bin, "tee"), "#!/bin/sh\ncat >/dev/null\nexit 1\n")
        code, lines = self.run_executor()
        self.assertEqual(code, 4, lines)
        self.assertIn("S5R3_EXEC_RESULT=HOLD_RECEIPT_NOT_SAVED", lines)

    def test_preparation_clone_checkout_and_hash_failures_hold_before_the_wrapper(self):
        os.mkdir(self.workdir)
        self.assertEqual(self.run_executor()[1][-1], "S5R3_EXEC_RESULT=HOLD_PREPARE_WORKDIR_EXISTS")
        cases = (
            (lambda: dict(workdir=os.path.join(self.tmp.name, "afile", "run")), {}, "PREPARE"),
            (dict, {"FAKE_GIT_FAIL_CLONE": "1"}, "CLONE"),
            (lambda: dict(head="1" * 40), {}, "CHECKOUT"),
            (lambda: dict(wrapper_sha="0" * 64), {}, "WRAPPER_SHA256"),
        )
        for kwargs, env, reason in cases:
            self.tearDown()
            self.setUp()   # a fresh fixture per case (paths are computed after it exists)
            with open(os.path.join(self.tmp.name, "afile"), "w"):
                pass
            code, lines = self.run_executor(env, **kwargs())
            self.assertEqual((code, lines[-1]), (2, f"S5R3_EXEC_RESULT=HOLD_{reason}"), reason)
            self.assertFalse([l for l in lines if l.startswith("S5R3_RUN_")], reason)

    def test_usage_and_source_binding(self):
        for wrapper_args in (["--source", "/x"], ["--expect-head", "0" * 40], ["--private-prestate", "/root/x"]):
            code, lines = self.run_executor(wrapper_args=wrapper_args)
            self.assertEqual(code, 2, wrapper_args)
            self.assertFalse(os.path.exists(self.workdir))
        code, lines = self.run_executor(workdir="relative/run")
        self.assertEqual((code, lines[-1]), (2, "S5R3_EXEC_RESULT=HOLD_USAGE"))

    def test_interruption_is_non_zero(self):
        argv = ["bash", EXECUTOR, "--workdir", self.workdir, "--expect-head", self.head, "--expect-wrapper-sha256",
                self.wrapper_sha, "--", "--gates-only"]
        process = subprocess.Popen(argv, stdout=subprocess.PIPE, text=True, env=dict(self.env, STUB_SLEEP="20"),
                                   start_new_session=True)
        deadline = time.time() + 30
        while not os.path.exists(os.path.join(self.workdir, "args.seen")) and time.time() < deadline:
            time.sleep(0.1)
        os.killpg(process.pid, signal.SIGTERM)
        out, _ = process.communicate(timeout=30)
        self.assertNotEqual(process.returncode, 0, out)


class OperatorCommandTests(ExecutorBase):
    """The documented one-line command (rendered from the template the docs use) keeps every failure non-zero."""

    def command(self, executor_sha=None):
        with open(TEMPLATE) as handle:
            text = handle.read().strip()
        text = text.replace("/root/s5r3-exec.", os.path.join(self.tmp.name, "s5r3-exec."))   # test-only location
        return (text.replace("@HEAD@", self.head).replace("@EXECUTOR_SHA256@", executor_sha or self.executor_sha)
                .replace("@WRAPPER_SHA256@", self.wrapper_sha).replace("@WRAPPER_ARGS@", "--gates-only"))

    def run_command(self, extra_env=None, executor_sha=None):
        result = subprocess.run(["bash", "-c", self.command(executor_sha)], capture_output=True, text=True,
                                env=dict(self.env, **(extra_env or {})), timeout=60)
        return result.returncode, result.stdout.splitlines()

    def test_template_is_a_single_line_with_exactly_the_documented_placeholders(self):
        with open(TEMPLATE) as handle:
            text = handle.read()
        self.assertEqual(text.count("\n"), 1)
        self.assertEqual(sorted(set(__import__("re").findall(r"@[A-Z0-9_]+@", text))),
                         ["@EXECUTOR_SHA256@", "@HEAD@", "@WRAPPER_ARGS@", "@WRAPPER_SHA256@"])
        # the last statement execs the executor: no trailing print, tee or cleanup can replace its status
        self.assertRegex(text.strip(), r"; exec bash \"\$d/executor\.sh\" [^;|&]*'$")

    def test_status_of_the_whole_command(self):
        self.assertEqual(self.run_command()[0], 0)
        self.assertEqual(self.run_command({"STUB_CODE": "2"})[0], 2)
        self.assertEqual(self.run_command({"STUB_CODE": "3"})[0], 3)
        self.assertNotEqual(self.run_command({"FAKE_CURL_FAIL": "1"})[0], 0)
        code, lines = self.run_command(executor_sha="0" * 64)
        self.assertNotEqual(code, 0)
        self.assertFalse([l for l in lines if l.startswith("S5R3_")])


if __name__ == "__main__":
    unittest.main()
