import { createHash } from "node:crypto"
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"

const expectedRuns = 20
const candidate = process.env.CANDIDATE_NAME
const sourceDirectory = process.env.SOURCE_DIR
const controlDirectory = process.env.CONTROL_DIR
const expectedSourceSha = process.env.SOURCE_SHA

if (!candidate || !sourceDirectory || !controlDirectory || !expectedSourceSha) {
  throw new Error("QA-001 diagnostic is missing its pinned candidate inputs")
}

const outputDirectory = path.join(controlDirectory, "diagnostic-output", candidate)
const testOutputDirectory = path.join(outputDirectory, "test-results")
const overlayPath = path.join(
  controlDirectory,
  "scripts/qa001-884-diagnostic/qa001-instrumentation.patch",
)

const mkdir = (directory) => mkdirSync(directory, { recursive: true })
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

const runText = (command, arguments_, cwd) => {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8" })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} failed: ${result.stderr || result.error}`)
  }
  return result.stdout.trim()
}

const collectFiles = (directory, baseDirectory = directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return collectFiles(absolutePath, baseDirectory)
      }
      return entry.isFile()
        ? [{ absolutePath, relativePath: path.relative(baseDirectory, absolutePath) }]
        : []
    })
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))

const digestDirectory = (directory) => {
  const digest = createHash("sha256")
  for (const file of collectFiles(directory)) {
    digest.update(file.relativePath)
    digest.update("\0")
    digest.update(readFileSync(file.absolutePath))
    digest.update("\0")
  }
  return digest.digest("hex")
}

const collectTestResults = (report) => {
  const results = []
  const visit = (value, inheritedTitle = "") => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inheritedTitle)
      return
    }
    if (!value || typeof value !== "object") return

    const title = typeof value.title === "string" ? value.title : inheritedTitle
    if (Array.isArray(value.results)) {
      for (const [index, result] of value.results.entries()) {
        if (typeof result.status === "string") {
          results.push({
            title,
            repeatEachIndex: value.repeatEachIndex ?? results.length + index,
            retry: result.retry ?? 0,
            status: result.status,
            durationMs: result.duration,
          })
        }
      }
    }

    for (const [key, nested] of Object.entries(value)) {
      if (key !== "results") visit(nested, title)
    }
  }
  visit(report)
  return results
}

const appendStepSummary = (summary) => {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) return
  const descriptor = openSync(target, "a")
  try {
    writeFileSync(descriptor, summary)
  } finally {
    closeSync(descriptor)
  }
}

mkdir(outputDirectory)
mkdir(testOutputDirectory)

const sourceSha = runText("git", ["rev-parse", "HEAD"], sourceDirectory)
const sourceTreeSha = runText("git", ["rev-parse", "HEAD^{tree}"], sourceDirectory)
const initialStatus = runText(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  sourceDirectory,
)
if (sourceSha !== expectedSourceSha || initialStatus !== "") {
  throw new Error("Exact source checkout preflight failed")
}

const pnpmLockSha256 = sha256(readFileSync(path.join(sourceDirectory, "pnpm-lock.yaml")))
const qa001SourceTestPath = path.join(sourceDirectory, "e2e/qa-001-reader-header.spec.js")
const qa001SourceTestSha256 = sha256(readFileSync(qa001SourceTestPath))
const nodeVersion = runText("node", ["--version"], sourceDirectory)
const pnpmVersion = runText("pnpm", ["--version"], sourceDirectory)
const playwrightVersion = runText("pnpm", ["exec", "playwright", "--version"], sourceDirectory)
const chromiumVersion = runText(
  "pnpm",
  [
    "exec",
    "node",
    "--input-type=module",
    "-e",
    'import { chromium } from "@playwright/test"; const browser = await chromium.launch({ headless: true }); console.log(browser.version()); await browser.close();',
  ],
  sourceDirectory,
)

const buildDirectory = path.join(sourceDirectory, "build")
if (!statSync(buildDirectory).isDirectory()) {
  throw new Error("Production build output is missing")
}

const provenance = {
  candidate,
  expectedSourceSha,
  actualSourceSha: sourceSha,
  sourceTreeSha,
  pnpmLockSha256,
  qa001SourceTestSha256,
  nodeVersion,
  pnpmVersion,
  playwrightVersion,
  chromiumVersion,
  buildSha256: digestDirectory(buildDirectory),
  instrumentationApplied: false,
}

const runSuite = (variant, instrumented) => {
  const variantDirectory = path.join(outputDirectory, variant)
  const variantTestOutputDirectory = path.join(testOutputDirectory, variant)
  mkdir(variantDirectory)
  mkdir(variantTestOutputDirectory)

  const jsonPath = path.join(variantDirectory, "playwright-results.json")
  const logPath = path.join(variantDirectory, "playwright.log")
  const logDescriptor = openSync(logPath, "w")
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "e2e/qa-001-reader-header.spec.js",
      "--project=chromium",
      "--grep",
      "QA-001-884:",
      `--repeat-each=${expectedRuns}`,
      "--reporter=line,json",
    ],
    {
      cwd: sourceDirectory,
      env: {
        ...process.env,
        E2E_OUTPUT_DIR: variantTestOutputDirectory,
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath,
        ...(instrumented ? { QA001_DIAGNOSTIC_INSTRUMENTATION: "1" } : {}),
      },
      stdio: ["ignore", logDescriptor, logDescriptor],
    },
  )
  closeSync(logDescriptor)

  let report
  try {
    report = JSON.parse(readFileSync(jsonPath, "utf8"))
  } catch {
    throw new Error(`${variant} did not produce a readable Playwright JSON report`)
  }

  const runs = collectTestResults(report)
  const pass = runs.filter((run) => run.status === "passed").length
  const fail = runs.filter((run) => run.status !== "passed").length
  const summary = {
    variant,
    instrumentation: instrumented ? "APPLIED" : "NONE",
    expectedRuns,
    observedRuns: runs.length,
    pass,
    fail,
    processExitCode: result.status ?? "no-exit-code",
    processError: result.error?.message ?? "none",
    runs,
  }
  writeFileSync(
    path.join(variantDirectory, "summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
  return summary
}

const baseline = runSuite("baseline", false)
const patchBytes = readFileSync(overlayPath)
const patchText = patchBytes.toString("utf8")
for (const requiredSnippet of [
  "const qa001DiagnosticEnabled =",
  "const installQa001EventCapture =",
  "const attachQa001Diagnostic =",
  "touchstart",
  "pointerdown",
  "composedPath()",
  "elementsFromPoint(",
  "immediately-before-final-touch",
]) {
  if (!patchText.includes(requiredSnippet)) {
    throw new Error("Harness-only instrumentation overlay is incomplete")
  }
}
const applyResult = spawnSync("git", ["apply", "--unidiff-zero", overlayPath], {
  cwd: sourceDirectory,
  encoding: "utf8",
})
if (applyResult.error || applyResult.status !== 0) {
  throw new Error(`Harness-only instrumentation overlay failed to apply: ${applyResult.stderr}`)
}

const changedPaths = runText("git", ["diff", "--name-only"], sourceDirectory)
if (changedPaths !== "e2e/qa-001-reader-header.spec.js") {
  throw new Error(`Unexpected diagnostic overlay scope: ${changedPaths || "none"}`)
}
const instrumentedTest = readFileSync(qa001SourceTestPath, "utf8")
for (const requiredSnippet of [
  "const installQa001EventCapture =",
  "const attachQa001Diagnostic =",
  "immediately-before-final-touch",
]) {
  if (!instrumentedTest.includes(requiredSnippet)) {
    throw new Error("Harness-only instrumentation was not present in the test overlay")
  }
}

provenance.instrumentationApplied = true
provenance.overlayPatchSha256 = sha256(patchBytes)
provenance.instrumentedTestFileSha256 = sha256(instrumentedTest)

const instrumented = runSuite("instrumented", true)
const finalStatus = runText(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  sourceDirectory,
)
if (finalStatus !== "M e2e/qa-001-reader-header.spec.js") {
  throw new Error(`Instrumented source diff exceeded the test-only overlay: ${finalStatus}`)
}

const complete =
  baseline.observedRuns === expectedRuns && instrumented.observedRuns === expectedRuns
const resultDocument = {
  ...provenance,
  linuxRunner: process.env.RUNNER_OS ?? "unknown",
  runnerImage: process.env.ImageOS ?? process.env.ImageVersion ?? "ubuntu-latest",
  baseline,
  instrumented,
  diagnosticComplete: complete,
  interpretation: "Job success means observations were collected, not that QA-001-884 passed.",
}
writeFileSync(
  path.join(outputDirectory, "provenance-and-results.json"),
  `${JSON.stringify(resultDocument, undefined, 2)}\n`,
)

const formatRuns = (results) =>
  results.runs.map((run, index) => `${index + 1}:${run.status}`).join(", ")
const markdown = [
  `## QA-001-884 diagnostic — ${candidate}`,
  "",
  `- Exact source SHA: \`${sourceSha}\` (tree \`${sourceTreeSha}\`)`,
  `- Runtime: Node ${nodeVersion}; pnpm ${pnpmVersion}; Playwright ${playwrightVersion}; Chromium ${chromiumVersion}`,
  `- Build SHA-256: \`${provenance.buildSha256}\``,
  `- Baseline, no instrumentation: ${baseline.pass}/${baseline.observedRuns} passed; ${baseline.fail} failed; process exit ${baseline.processExitCode}`,
  `- Instrumented harness: ${instrumented.pass}/${instrumented.observedRuns} passed; ${instrumented.fail} failed; process exit ${instrumented.processExitCode}`,
  `- Overlay SHA-256: \`${provenance.overlayPatchSha256}\``,
  "- Individual results are preserved in the uploaded JSON reports and logs.",
  "- This diagnostic job records outcomes; its success is not an acceptance PASS.",
  "",
  `Baseline run statuses: ${formatRuns(baseline)}`,
  "",
  `Instrumented run statuses: ${formatRuns(instrumented)}`,
  "",
].join("\n")
appendStepSummary(markdown)

if (!complete) {
  throw new Error("The diagnostic did not collect all 20 baseline and 20 instrumented results")
}
