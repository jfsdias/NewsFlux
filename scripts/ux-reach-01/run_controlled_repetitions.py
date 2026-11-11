from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DIAGNOSTIC_TEST = ROOT / "scripts" / "ux-reach-01" / "pen-drag-diagnostic.spec.js"
DIAGNOSTIC_CONFIG = ROOT / "scripts" / "ux-reach-01" / "diagnostic-playwright.config.js"
UX_SUITE_TEST = ROOT / "ux-reach-e2e" / "mark-all-floating.spec.js"
DIAGNOSTIC_TITLE = "R8-D4D PEN DIAGNOSTIC"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_repeat_count(value: str | int) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("repeat count must be an integer") from exc
    if not 1 <= count <= 10:
        raise ValueError("repeat count must be between 1 and 10")
    return count


def isolated_command(output_dir: Path, repeat_count: int) -> list[str]:
    return [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config=r8-d4d-playwright.config.js",
        "--grep",
        DIAGNOSTIC_TITLE,
        "--reporter=line",
        f"--repeat-each={validate_repeat_count(repeat_count)}",
        "--retries=0",
        "--workers=1",
        f"--output={output_dir}",
    ]


def suite_command(output_dir: Path) -> list[str]:
    return [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config=playwright.ux-reach-01.config.js",
        "--retries=0",
        "--workers=1",
        f"--output={output_dir}",
    ]


def command_output(args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, check=False, capture_output=True, text=True)


def stream_command(args: list[str], *, cwd: Path) -> int:
    with subprocess.Popen(
        args,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    ) as process:
        if process.stdout is not None:
            for line in process.stdout:
                print(line, end="", flush=True)
        return process.wait()


def command_sha(source: Path) -> str:
    result = command_output(["git", "rev-parse", "HEAD"], cwd=source)
    if result.returncode != 0:
        raise RuntimeError(f"Could not read source SHA from {source.name}")
    return result.stdout.strip()


def is_ancestor(base_sha: str, source: Path) -> bool:
    return command_output(["git", "merge-base", "--is-ancestor", base_sha, "HEAD"], cwd=source).returncode == 0


def source_is_clean(source: Path) -> bool:
    result = command_output(["git", "status", "--porcelain"], cwd=source)
    return result.returncode == 0 and not result.stdout.strip()


def print_run(label: str, args: list[str], cwd: Path, results: list[dict[str, Any]]) -> int:
    print(f"R8D4D_RUN_START={label}", flush=True)
    print("R8D4D_COMMAND=" + json.dumps(args), flush=True)
    returncode = stream_command(args, cwd=cwd)
    record = {"label": label, "returncode": returncode, "command": args}
    results.append(record)
    print(f"R8D4D_RUN_RESULT={json.dumps(record, sort_keys=True)}", flush=True)
    return returncode


def read_ux_report(output_dir: Path) -> dict[str, Any] | None:
    report = output_dir / "ux-reach-summary.json"
    if not report.is_file():
        return None
    try:
        return json.loads(report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_summary(path: Path, summary: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


def prepare_source(
    *,
    label: str,
    source: Path,
    expected_sha: str,
    base_sha: str,
    repeat_count: int,
    results: list[dict[str, Any]],
    summary: dict[str, Any],
    summary_path: Path,
) -> bool:
    if not SHA_PATTERN.fullmatch(expected_sha) or command_sha(source) != expected_sha:
        print(f"R8D4D_SOURCE_SHA_GATE=FAIL:{label}", flush=True)
        return False
    if not is_ancestor(base_sha, source):
        print(f"R8D4D_ANCESTRY_GATE=FAIL:{label}", flush=True)
        return False
    if not source_is_clean(source):
        print(f"R8D4D_CLEAN_CHECKOUT_GATE=FAIL:{label}", flush=True)
        return False

    source_node_modules = source / "node_modules"
    if source_node_modules.exists() or source_node_modules.is_symlink():
        print(f"R8D4D_NODE_MODULES_GATE=FAIL:{label}", flush=True)
        return False

    source_node_modules.symlink_to(ROOT / "node_modules", target_is_directory=True)
    diagnostic_dir = source / "r8-d4d-ux-reach-diagnostic"
    copied_test = diagnostic_dir / "pen-drag-diagnostic.spec.js"
    copied_config = source / "r8-d4d-playwright.config.js"
    ux_test = source / "ux-reach-e2e" / "mark-all-floating.spec.js"
    original_ux_test = ux_test.read_bytes()
    record: dict[str, Any] = {
        "label": label,
        "source_sha": expected_sha,
        "package_json_sha256": sha256_file(source / "package.json"),
        "lockfile_sha256": sha256_file(source / "pnpm-lock.yaml"),
        "build_returncode": None,
        "isolated_runs": [],
        "full_suite_runs": [],
    }
    summary["sources"].append(record)
    success = True
    try:
        record["build_returncode"] = stream_command(["pnpm", "run", "build"], cwd=source)
        print(f"R8D4D_BUILD_SOURCE={label}:{expected_sha}", flush=True)
        if record["build_returncode"] != 0:
            success = False
        else:
            diagnostic_dir.mkdir()
            shutil.copy2(DIAGNOSTIC_TEST, copied_test)
            shutil.copy2(DIAGNOSTIC_CONFIG, copied_config)
            shutil.copy2(UX_SUITE_TEST, ux_test)
            isolated_dir = source / "test-results" / "ux-reach-d4d" / label / "isolated-pen-drag"
            isolated_rc = print_run(
                f"{label}-isolated-pen-drag",
                isolated_command(isolated_dir, repeat_count),
                source,
                results,
            )
            record["isolated_runs"].append({"returncode": isolated_rc, "repeat_count": repeat_count})
            success = success and isolated_rc == 0

            for run_number in range(1, 4):
                run_label = f"{label}-ux-suite-{run_number}"
                output_dir = source / "test-results" / "ux-reach-d4d" / label / f"suite-{run_number}"
                suite_rc = print_run(run_label, suite_command(output_dir), source, results)
                reporter_summary = read_ux_report(output_dir)
                record["full_suite_runs"].append(
                    {"run": run_number, "returncode": suite_rc, "report": reporter_summary}
                )
                success = success and suite_rc == 0
                save_summary(summary_path, summary)
    finally:
        if diagnostic_dir.exists():
            shutil.rmtree(diagnostic_dir)
        if copied_config.exists():
            copied_config.unlink()
        if copied_test.exists():
            copied_test.unlink()
        if ux_test.read_bytes() != original_ux_test:
            ux_test.write_bytes(original_ux_test)
        if source_node_modules.is_symlink():
            source_node_modules.unlink()
        if not source_is_clean(source):
            print(f"R8D4D_POST_CLEAN_CHECK=FAIL:{label}", flush=True)
            success = False
        save_summary(summary_path, summary)
    return success


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-base-sha", required=True)
    parser.add_argument("--baseline-sha", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--repeat-count", required=True)
    args = parser.parse_args()
    try:
        repeat_count = validate_repeat_count(args.repeat_count)
    except ValueError as exc:
        parser.error(str(exc))

    for sha in (args.expected_base_sha, args.baseline_sha, args.candidate_sha):
        if not SHA_PATTERN.fullmatch(sha):
            parser.error("all source SHAs must be full lowercase 40-character commits")
    if args.baseline_sha != args.expected_base_sha:
        parser.error("baseline_sha must equal expected_base_sha")

    baseline_dir = ROOT / "baseline"
    candidate_dir = ROOT / "candidate"
    if not baseline_dir.is_dir() or not candidate_dir.is_dir():
        parser.error("exact baseline and candidate checkouts are required")
    if (ROOT / "package.json").read_bytes() != (baseline_dir / "package.json").read_bytes():
        parser.error("harness and baseline package manifests differ")
    if (ROOT / "pnpm-lock.yaml").read_bytes() != (baseline_dir / "pnpm-lock.yaml").read_bytes():
        parser.error("harness and baseline lockfiles differ")
    if (baseline_dir / "package.json").read_bytes() != (candidate_dir / "package.json").read_bytes():
        parser.error("baseline and candidate package manifests differ")
    if (baseline_dir / "pnpm-lock.yaml").read_bytes() != (candidate_dir / "pnpm-lock.yaml").read_bytes():
        parser.error("baseline and candidate lockfiles differ")

    summary_path = ROOT / "test-results" / "ux-reach-d4d" / "controlled-run-summary.json"
    summary: dict[str, Any] = {
        "harness_sha": command_sha(ROOT),
        "expected_base_sha": args.expected_base_sha,
        "baseline_sha": args.baseline_sha,
        "candidate_sha": args.candidate_sha,
        "repeat_count": repeat_count,
        "playwright_version": "1.63.0",
        "sources": [],
        "runs": [],
    }
    save_summary(summary_path, summary)

    outcomes = []
    for label, source, sha in (
        ("baseline", baseline_dir, args.baseline_sha),
        ("candidate", candidate_dir, args.candidate_sha),
    ):
        outcomes.append(
            prepare_source(
                label=label,
                source=source,
                expected_sha=sha,
                base_sha=args.expected_base_sha,
                repeat_count=repeat_count,
                results=summary["runs"],
                summary=summary,
                summary_path=summary_path,
            )
        )
        save_summary(summary_path, summary)

    summary["final"] = "PASS" if outcomes == [True, True] else "FAIL"
    save_summary(summary_path, summary)
    print(f"R8D4D_FINAL={summary['final']}", flush=True)
    return 0 if summary["final"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
