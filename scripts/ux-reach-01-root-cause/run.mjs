import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const workspace = process.env.GITHUB_WORKSPACE
const outputRoot = process.env.UX_REACH_ROOT_CAUSE_OUTPUT
const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
assert.ok(workspace && outputRoot)

const expected = {
  main: process.env.MAIN_SHA,
  "pr219-head": process.env.PR219_HEAD,
  "pr219-merge": process.env.PR219_MERGE,
}
const candidates = Object.entries(expected).map(([name, sha]) => ({
  name,
  sha,
  root: path.join(workspace, "candidates", name),
}))
const observerSource = path.join(harnessRoot, "scripts/ux-reach-01-root-cause/observer.spec.js")
const summary = {
  node: process.version,
  pnpm: undefined,
  candidates: [],
  retries: 0,
  playwrightWorkers: 1,
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

async function captureCandidate(candidate) {
  const resultRoot = path.join(outputRoot, candidate.name)
  await mkdir(resultRoot, { recursive: true })
  const gitSha = run("git", ["-C", candidate.root, "rev-parse", "HEAD"], workspace)
  assert.equal(gitSha.exitCode, 0)
  assert.equal(gitSha.stdout.trim(), candidate.sha)

  const sourceHashes = {}
  for (const relativePath of [
    "ux-reach-e2e/mark-all-floating.spec.js",
    "playwright.ux-reach-01.config.js",
    "playwright.config.js",
    "src/components/Content/FooterPanel.css",
    "src/components/Article/ArticleEntry.css",
    "src/components/Article/ArticleList.css",
    "pnpm-lock.yaml",
  ]) {
    sourceHashes[relativePath] = sha256(await readFile(path.join(candidate.root, relativePath)))
  }

  const install = run("pnpm", ["install", "--frozen-lockfile"], candidate.root)
  await writeFile(path.join(resultRoot, "install.log"), install.stdout + install.stderr)
  assert.equal(install.exitCode, 0, `${candidate.name}: frozen dependency install failed`)

  const build = run("pnpm", ["build"], candidate.root)
  await writeFile(path.join(resultRoot, "build.log"), build.stdout + build.stderr)
  assert.equal(build.exitCode, 0, `${candidate.name}: production build failed`)

  const observerTarget = path.join(candidate.root, "ux-reach-e2e/root-cause-observer.spec.js")
  await copyFile(observerSource, observerTarget)
  try {
    const original = run(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config=playwright.ux-reach-01.config.js",
        "--grep",
        "coarse-pointer control stays reachable without blocking article hits or navigation",
        "--reporter=list",
      ],
      candidate.root,
    )
    await writeFile(path.join(resultRoot, "original-test.log"), original.stdout + original.stderr)
    await copyTestOutput(candidate.root, path.join(resultRoot, "original-playwright-files"))

    const observer = run(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config=playwright.ux-reach-01.config.js",
        "--grep",
        "UX-REACH-ROOT-CAUSE-DIAGNOSTIC",
        "--reporter=list",
      ],
      candidate.root,
      {
        ...process.env,
        UX_REACH_ROOT_CAUSE_CANDIDATE: candidate.name,
        UX_REACH_ROOT_CAUSE_OUTPUT: resultRoot,
      },
    )
    await writeFile(path.join(resultRoot, "observer-test.log"), observer.stdout + observer.stderr)
    await copyTestOutput(candidate.root, path.join(resultRoot, "observer-playwright-files"))

    return {
      name: candidate.name,
      expectedSha: candidate.sha,
      actualSha: gitSha.stdout.trim(),
      sourceHashes,
      originalTest: original.exitCode === 0 ? "PASS" : "FAIL",
      observerTest: observer.exitCode === 0 ? "RECORDED" : "HARNESS_ERROR",
      logs: ["install.log", "build.log", "original-test.log", "observer-test.log"],
    }
  } finally {
    await rm(observerTarget, { force: true })
  }
}

async function copyTestOutput(candidateRoot, resultRoot) {
  const testOutput = path.join(candidateRoot, "test-results/ux-reach-01")
  try {
    await access(testOutput)
    await mkdir(resultRoot, { recursive: true })
    await cp(testOutput, path.join(resultRoot, "files"), { recursive: true })
  } catch (error) {
    // Keep captured stdout as evidence if Playwright did not create an output directory.
    if (error.code !== "ENOENT") throw error
  }
}

try {
  summary.pnpm = run("pnpm", ["--version"], workspace).stdout.trim()
  for (const candidate of candidates) {
    summary.candidates.push(await captureCandidate(candidate))
  }
  await writeFile(
    path.join(outputRoot, "ab-summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
  const hashes = new Set(
    summary.candidates.map(
      (candidate) => candidate.sourceHashes["ux-reach-e2e/mark-all-floating.spec.js"],
    ),
  )
  const uiHashes = new Set(
    summary.candidates.map(
      (candidate) => candidate.sourceHashes["src/components/Content/FooterPanel.css"],
    ),
  )
  const allOriginalTestsFailed = summary.candidates.every(
    (candidate) => candidate.originalTest === "FAIL",
  )
  process.stdout.write(`MAIN_BASELINE_RESULT=${summary.candidates[0]?.originalTest}\n`)
  process.stdout.write(`PR219_RESULT=${summary.candidates[1]?.originalTest}\n`)
  process.stdout.write(`SYNTHETIC_MERGE_RESULT=${summary.candidates[2]?.originalTest}\n`)
  process.stdout.write(`TEST_SOURCE_PARITY=${hashes.size === 1 ? "PASS" : "FAIL"}\n`)
  process.stdout.write(`FOOTER_CSS_PARITY=${uiHashes.size === 1 ? "PASS" : "FAIL"}\n`)
  process.stdout.write(`ALL_CANDIDATES_FAILED=${allOriginalTestsFailed}\n`)
  process.stdout.write(`OUTPUT_ROOT=${outputRoot}\n`)
} catch (error) {
  summary.harnessError = String(error?.stack ?? error)
  await writeFile(
    path.join(outputRoot, "ab-summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
  process.stderr.write(`ROOT_CAUSE_HARNESS_ERROR=${error?.message ?? error}\n`)
  process.exitCode = 1
}
