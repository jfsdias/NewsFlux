import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const workspace = process.env.GITHUB_WORKSPACE
const diagnosticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outputRoot = process.env.UX_REACH_R5_DIAGNOSTIC_OUTPUT
assert.ok(workspace && outputRoot)

const candidates = [
  {
    name: "main",
    sha: process.env.EXPECTED_MAIN_SHA,
    root: path.join(workspace, "candidates/main"),
  },
  {
    name: "pr225-candidate",
    sha: process.env.EXPECTED_PR225_MERGE_SHA,
    root: path.join(workspace, "candidates/pr225-candidate"),
  },
]
const relevantPaths = [
  "src/components/Content/FooterPanel.jsx",
  "src/components/Content/FooterPanel.css",
  "ux-reach-e2e/mark-all-floating.spec.js",
  "playwright.ux-reach-01.config.js",
  "playwright.config.js",
  "pnpm-lock.yaml",
]
const summary = {
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  environment: {},
  protocol: {
    uninstrumentedRepeatsPerTree: 20,
    instrumentedRepeatsPerTree: 20,
    retries: 0,
    workers: 1,
    originalAssertionPreserved: true,
  },
  candidates: [],
}

await mkdir(outputRoot, { recursive: true })

function run(command, arguments_, cwd, environment = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex")
}

function collectResults(report) {
  const results = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const testCase of spec.tests ?? []) {
        for (const result of testCase.results ?? []) {
          results.push({
            title: spec.title,
            repeatEachIndex: testCase.repeatEachIndex,
            retry: result.retry ?? 0,
            status: result.status ?? "unknown",
            durationMs: result.duration,
            error: result.error?.message,
          })
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites ?? []) visit(suite)
  return results
}

function parsePlaywrightJson(stdout) {
  const start = stdout.indexOf('{\n  "config"')
  if (start === -1) throw new Error("Playwright JSON report was not found in stdout")
  return JSON.parse(stdout.slice(start))
}

async function captureHashes(candidate) {
  const values = {}
  for (const relativePath of relevantPaths) {
    values[relativePath] = sha256(await readFile(path.join(candidate.root, relativePath)))
  }
  return values
}

async function runScenario(candidate, resultRoot, kind) {
  const grep =
    kind === "original"
      ? "UX-REACH-01: fine-pointer desktop retains the existing conventional FooterPanel control"
      : "UX-REACH-R5-DIAGNOSTIC: fine-pointer desktop records CDP pen drag events and geometry"
  const repeatCount = 20
  const runResult = run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config=playwright.ux-reach-01.config.js",
      "--grep",
      grep,
      `--repeat-each=${repeatCount}`,
      "--workers=1",
      "--retries=0",
      "--reporter=json",
      `--output=${path.relative(candidate.root, resultRoot)}/${kind}-playwright-files`,
    ],
    candidate.root,
    {
      ...process.env,
      CI: "true",
      UX_REACH_R5_CANDIDATE: candidate.name,
      UX_REACH_R5_DIAGNOSTIC_OUTPUT: resultRoot,
    },
  )
  await writeFile(path.join(resultRoot, `${kind}-playwright.stdout.json`), runResult.stdout)
  await writeFile(path.join(resultRoot, `${kind}-playwright.stderr.log`), runResult.stderr)
  const report = parsePlaywrightJson(runResult.stdout)
  const results = collectResults(report)
  await writeFile(
    path.join(resultRoot, `${kind}-individual-results.json`),
    `${JSON.stringify(results, undefined, 2)}\n`,
  )
  return {
    expectedCount: repeatCount,
    observedCount: results.length,
    results,
    runnerExitCode: runResult.exitCode,
    reportStats: report.stats,
    complete: results.length === repeatCount,
  }
}

async function captureCandidate(candidate) {
  const resultRoot = path.join(outputRoot, candidate.name)
  await mkdir(resultRoot, { recursive: true })
  const sourceSha = run("git", ["rev-parse", "HEAD"], candidate.root)
  assert.equal(sourceSha.exitCode, 0)
  assert.equal(sourceSha.stdout.trim(), candidate.sha)

  const install = run("pnpm", ["install", "--frozen-lockfile"], candidate.root)
  await writeFile(path.join(resultRoot, "install.log"), install.stdout + install.stderr)
  assert.equal(install.exitCode, 0, `${candidate.name}: frozen dependency installation failed`)

  const build = run("pnpm", ["build"], candidate.root)
  await writeFile(path.join(resultRoot, "build.log"), build.stdout + build.stderr)
  assert.equal(build.exitCode, 0, `${candidate.name}: production build failed`)

  const hashes = await captureHashes(candidate)
  const observerSource = path.join(
    diagnosticRoot,
    "scripts/ux-reach-r5-diagnostic/pen-drag-observer.spec.js",
  )
  const observerTarget = path.join(candidate.root, "ux-reach-e2e/r5-pen-drag-observer.spec.js")
  await writeFile(
    path.join(resultRoot, "source-hashes.json"),
    `${JSON.stringify(hashes, undefined, 2)}\n`,
  )
  try {
    const original = await runScenario(candidate, resultRoot, "original")
    await writeFile(observerTarget, await readFile(observerSource))
    const instrumented = await runScenario(candidate, resultRoot, "instrumented")
    return {
      name: candidate.name,
      expectedSha: candidate.sha,
      actualSha: sourceSha.stdout.trim(),
      sourceHashes: hashes,
      original,
      instrumented,
    }
  } finally {
    await rm(observerTarget, { force: true })
  }
}

try {
  const mainRoot = candidates[0].root
  summary.environment = {
    runner: process.env.RUNNER_OS ?? "unknown",
    node: process.version,
    pnpm: run("pnpm", ["--version"], mainRoot).stdout.trim(),
    playwright: run("pnpm", ["exec", "playwright", "--version"], mainRoot).stdout.trim(),
    kernel: run("uname", ["-srmo"], mainRoot).stdout.trim(),
  }
  for (const candidate of candidates) {
    summary.candidates.push(await captureCandidate(candidate))
  }

  const pathsToCompare = relevantPaths
  const sourceParity = pathsToCompare.every(
    (relativePath) =>
      summary.candidates[0].sourceHashes[relativePath] ===
      summary.candidates[1].sourceHashes[relativePath],
  )
  summary.sourceParity = Object.fromEntries(
    pathsToCompare.map((relativePath) => [
      relativePath,
      summary.candidates[0].sourceHashes[relativePath] ===
        summary.candidates[1].sourceHashes[relativePath],
    ]),
  )
  summary.sourceParityAll = sourceParity
  await writeFile(
    path.join(outputRoot, "ab-summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
  for (const candidate of summary.candidates) {
    for (const kind of ["original", "instrumented"]) {
      const result = candidate[kind]
      const pass = result.results.filter(({ status }) => status === "passed").length
      const fail = result.results.filter(({ status }) => status === "failed").length
      const skip = result.results.filter(({ status }) => status === "skipped").length
      process.stdout.write(
        `${candidate.name.toUpperCase()}_${kind.toUpperCase()}_RUNS=${result.observedCount} PASS=${pass} FAIL=${fail} SKIP=${skip}\n`,
      )
    }
  }
  process.stdout.write(`RELEVANT_SOURCE_PARITY=${sourceParity ? "PASS" : "FAIL"}\n`)
} catch (error) {
  summary.harnessError = error?.message ?? String(error)
  await writeFile(
    path.join(outputRoot, "ab-summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
  process.stderr.write(`DIAGNOSTIC_HARNESS_ERROR=${summary.harnessError}\n`)
  process.exitCode = 1
}
