#!/usr/bin/env python3
"""Test-only runner: loads the operator tool as a module, points it at the disposable topology,
answers terminal prompts from a file and injects faults by monkeypatching. The production tool
has no fault hooks and no environment overrides; nothing here is used on a real host.

usage: fault_runner.py TOOL FAULT ANSWERS_FILE MODE [ARGS...]
faults: none | hash_divergent | fsync_after_replace | fsync_after_replace_always | drift_env | restart_protected |
        inspect_fail:<container-name>
"""
import importlib.util
import os
import stat
import sys

tool_path, fault_spec, answers_path, *argv = sys.argv[1:]
H = os.environ["R44T_HOME"]
CONFIG = {
    "STATE_ROOT": os.path.join(H, "state"),
    "LOCK": os.path.join(H, "lock"),
    "HEALTH_TIMEOUT": 90.0,
}
# Older tool revisions read these from the environment at import time.
os.environ.update({"R44_STATE_DIR": CONFIG["STATE_ROOT"], "R44_RELEASE_LOCK": CONFIG["LOCK"],
                   "R44_HEALTH_TIMEOUT": "90"})

spec = importlib.util.spec_from_file_location("r44_tool_under_test", tool_path)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
for name, value in CONFIG.items():
    setattr(tool, name, value)

with open(answers_path, encoding="utf-8") as handle:
    answers = handle.read().splitlines()
asked = []


def fake_ask(prompt, secret):
    asked.append("secret" if secret else "plain")
    return answers.pop(0) if answers else ""


tool.ask = fake_ask

for fault in fault_spec.split("+"):  # faults combine with "+"
    if fault in ("fsync_after_replace", "fsync_after_replace_always"):
        real_replace, real_fsync = os.replace, os.fsync
        spec_always = fault.endswith("_always")
        state = {"armed": False, "fired": 0}

        def replace(src, dst, *a, **k):
            real_replace(src, dst, *a, **k)
            state["armed"] = True

        def fsync(fd):
            if state["armed"] and stat.S_ISDIR(os.fstat(fd).st_mode):
                state["armed"] = False
                if spec_always or state["fired"] == 0:
                    state["fired"] += 1
                    raise OSError(5, "injected directory fsync failure after replace")
            return real_fsync(fd)

        os.replace, os.fsync = replace, fsync
    elif fault in ("drift_env", "restart_protected"):
        real_wait, kind = tool.wait_healthy, fault
        fired = []

        def wait_healthy(*a, **k):
            doc = real_wait(*a, **k)
            if fired:  # inject once: the rollback's own wait must run unmodified
                return doc
            fired.append(1)
            if kind == "drift_env":
                raise tool.Stop("FAULT_INJECTED", "DRIFT_ENV")
            tool.subprocess.run(["docker", "restart", "npm"], capture_output=True, check=False)
            return doc

        tool.wait_healthy = wait_healthy
    elif fault == "hash_divergent":
        # Reproduces Compose versions whose `config --hash` differs from the label `up` writes (seen on 5.1.3):
        # forces the field-by-field equivalence path.
        tool.Project.config_hash = lambda self: "f" * 64
    elif fault.startswith("inspect_fail:"):
        target = "/" + fault.split(":", 1)[1]
        real_inspect = tool.inspect

        def inspect(ref):
            doc = real_inspect(ref)
            return None if doc is not None and doc.get("Name") == target else doc

        tool.inspect = inspect
    elif fault != "none":
        raise SystemExit(f"unknown fault {fault}")

try:
    rc = tool.main(["r44", *argv])
finally:
    report = f"TEST_ASK_CALLS={len(asked)}\nTEST_SECRET_ASKS={asked.count('secret')}\n"
    if os.environ.get("R44T_ASKLOG"):  # wrapper tests: keep the tool's stderr empty
        with open(os.environ["R44T_ASKLOG"], "a", encoding="utf-8") as handle:
            handle.write(report)
    else:
        sys.stderr.write(report)
sys.exit(rc)
