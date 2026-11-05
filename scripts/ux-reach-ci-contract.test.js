import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- exercise the gate's source contract.
import uxReachConfig from "../playwright.ux-reach-01.config.js"
// eslint-disable-next-line import/no-relative-parent-imports -- test the dedicated reporter's runtime behavior.
import UxReachFailClosedReporter from "../ux-reach-e2e/reporter.js"
// eslint-disable-next-line import/no-relative-parent-imports -- test the dedicated suite's frozen contract.
import { evaluateUxReachSuite, EXPECTED_UX_REACH_TESTS } from "../ux-reach-e2e/scenario-contract.js"

const completeRun = () => ({
  discoveredTitles: [...EXPECTED_UX_REACH_TESTS],
  results: EXPECTED_UX_REACH_TESTS.map((title) => ({ title, status: "passed" })),
})

test("UX-REACH CI contract freezes eleven unique dedicated scenario names", () => {
  assert.equal(EXPECTED_UX_REACH_TESTS.length, 11)
  assert.equal(new Set(EXPECTED_UX_REACH_TESTS).size, 11)
})

test("UX-REACH CI contract passes only the complete all-passed suite", () => {
  const result = evaluateUxReachSuite(completeRun())

  assert.equal(result.gate, "PASS")
  assert.equal(result.expectedCount, 11)
  assert.equal(result.discoveredCount, 11)
  assert.equal(result.executedCount, 11)
  assert.equal(result.passedCount, 11)
  assert.equal(result.failedCount, 0)
  assert.equal(result.skippedCount, 0)
  assert.deepEqual(result.missingTitles, [])
  assert.deepEqual(result.unexpectedTitles, [])
})

test("UX-REACH CI contract rejects missing, duplicate and unexpected scenarios", () => {
  const complete = completeRun()
  const missing = evaluateUxReachSuite({
    ...complete,
    discoveredTitles: complete.discoveredTitles.slice(1),
    results: complete.results.slice(1),
  })
  assert.equal(missing.gate, "FAIL")
  assert.deepEqual(missing.missingTitles, [EXPECTED_UX_REACH_TESTS[0]])

  const duplicate = evaluateUxReachSuite({
    ...complete,
    discoveredTitles: [...complete.discoveredTitles, EXPECTED_UX_REACH_TESTS[0]],
  })
  assert.equal(duplicate.gate, "FAIL")
  assert.deepEqual(duplicate.duplicateTitles, [EXPECTED_UX_REACH_TESTS[0]])

  const unexpected = evaluateUxReachSuite({
    ...complete,
    discoveredTitles: [...complete.discoveredTitles, "unreviewed extra scenario"],
  })
  assert.equal(unexpected.gate, "FAIL")
  assert.deepEqual(unexpected.unexpectedTitles, ["unreviewed extra scenario"])
})

test("UX-REACH CI contract rejects skipped, failed and incomplete execution", () => {
  const complete = completeRun()
  const skipped = evaluateUxReachSuite({
    ...complete,
    results: complete.results.map((result, index) =>
      index === 0 ? { ...result, status: "skipped" } : result,
    ),
  })
  assert.equal(skipped.gate, "FAIL")
  assert.equal(skipped.skippedCount, 1)

  const failed = evaluateUxReachSuite({
    ...complete,
    results: complete.results.map((result, index) =>
      index === 0 ? { ...result, status: "failed" } : result,
    ),
  })
  assert.equal(failed.gate, "FAIL")
  assert.equal(failed.failedCount, 1)

  const incomplete = evaluateUxReachSuite({
    ...complete,
    results: complete.results.slice(0, -1),
  })
  assert.equal(incomplete.gate, "FAIL")
  assert.equal(incomplete.executedCount, 10)
})

test("UX-REACH Playwright config uses the separate suite and fail-closed reporter", () => {
  assert.match(uxReachConfig.testDir, /ux-reach-e2e$/)
  assert.equal(uxReachConfig.testMatch, "**/*.spec.js")
  assert.equal(uxReachConfig.retries, 0)
  assert.equal(uxReachConfig.workers, 1)
  assert.ok(
    uxReachConfig.reporter.some((entry) =>
      (Array.isArray(entry) ? entry[0] : entry).endsWith("ux-reach-e2e/reporter.js"),
    ),
  )
  const failClosedReporter = uxReachConfig.reporter.find(
    (entry) => Array.isArray(entry) && entry[0].endsWith("ux-reach-e2e/reporter.js"),
  )
  assert.equal(failClosedReporter[1].outputDir, "test-results/ux-reach-01")
})

test("UX-REACH reporter writes a complete receipt when Playwright omits outputDir", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "ux-reach-reporter-"))

  try {
    const reporter = new UxReachFailClosedReporter({ outputDir })
    reporter.onBegin(
      { outputDir: undefined },
      { allTests: () => EXPECTED_UX_REACH_TESTS.map((title) => ({ title })) },
    )
    for (const title of EXPECTED_UX_REACH_TESTS) {
      reporter.onTestEnd({ title }, { status: "passed", duration: 1 })
    }
    reporter.onEnd({ status: "passed" })

    const receipt = JSON.parse(
      await readFile(path.join(outputDir, "ux-reach-summary.json"), "utf8"),
    )
    assert.equal(receipt.gate, "PASS")
    assert.equal(receipt.discoveredCount, 11)
    assert.equal(receipt.executedCount, 11)
    assert.equal(receipt.passedCount, 11)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test("UX-REACH reporter overrides a green Playwright status when the suite is incomplete", () => {
  const previousExitCode = process.exitCode
  const reporter = new UxReachFailClosedReporter({ outputDir: os.tmpdir() })

  try {
    reporter.onBegin({}, { allTests: () => [{ title: EXPECTED_UX_REACH_TESTS[0] }] })
    reporter.onTestEnd({ title: EXPECTED_UX_REACH_TESTS[0] }, { status: "passed", duration: 1 })

    assert.deepEqual(reporter.onEnd({ status: "passed" }), { status: "failed" })
  } finally {
    process.exitCode = previousExitCode
  }
})
