import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import test from "node:test"
import { fileURLToPath } from "node:url"

// eslint-disable-next-line import/no-relative-parent-imports -- these tests exercise E2E package modules through the import map.
import InventoryReporter from "#e2e/reporters/inventory-reporter.js"
// eslint-disable-next-line import/no-relative-parent-imports -- these tests exercise E2E package modules through the import map.
import { EXPECTED_SCENARIOS } from "#e2e/scenario-contract.js"

import { compareRuns, evaluateRuns, validateInventory } from "./e2e-stability.js"

const scenario = (id, state) => ({ id, state })
const SMALL_CONTRACT = [
  { id: "A", state: "PASSED" },
  { id: "B", state: "KNOWN_DEFECT" },
]
let inventorySequence = 0
const inventory = (scenarios, runId = `unit-run-${++inventorySequence}`) => {
  const rows = scenarios.map(({ id, state }) => ({
    id,
    title: `${id}: simulated scenario`,
    file: "simulated.spec.js",
    durationMs: 0,
    state,
    note: "",
  }))
  const counts = {}
  for (const { state } of rows) {
    counts[state] = (counts[state] ?? 0) + 1
  }
  return { version: 2, runId, counts, scenarios: rows, contractProblems: [] }
}
const run = (scenarios) => inventory(scenarios)
const completeSmallInventory = (runId) =>
  inventory([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")], runId)
const executionRun = (
  index,
  { runId = `run-${index}`, inventoryPath = `/tmp/${runId}.json`, exitCode = 0 } = {},
) => ({
  verified: true,
  runId,
  inventoryPath,
  exitCode,
  signal: null,
  spawnError: undefined,
  inventory: completeSmallInventory(runId),
})
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const withoutReporterOutput = (action) => {
  const { error, log } = console
  console.error = () => {}
  console.log = () => {}
  try {
    return action()
  } finally {
    console.error = error
    console.log = log
  }
}

test("identical runs without failures are stable", () => {
  const result = compareRuns(
    [
      run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
      run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
      run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
    ],
    SMALL_CONTRACT,
  )

  assert.equal(result.stable, true)
  assert.deepEqual(result.problems, [])
})

test("a scenario that changes state between runs is flaky", () => {
  const result = compareRuns(
    [
      run([scenario("A", "PASSED")]),
      run([scenario("A", "FAILED")]),
      run([scenario("A", "PASSED")]),
    ],
    [{ id: "A", state: "PASSED" }],
  )

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /A.*PASSED.*FAILED/)
})

test("a scenario that fails in every run is reported as failing, not stable", () => {
  const result = compareRuns(
    [
      run([scenario("A", "FAILED")]),
      run([scenario("A", "FAILED")]),
      run([scenario("A", "FAILED")]),
    ],
    [{ id: "A", state: "PASSED" }],
  )

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /A.*FAILED/)
})

test("a scenario missing from one run is reported", () => {
  const result = compareRuns(
    [
      run([scenario("A", "PASSED"), scenario("B", "PASSED")]),
      run([scenario("A", "PASSED")]),
      run([scenario("A", "PASSED"), scenario("B", "PASSED")]),
    ],
    [
      { id: "A", state: "PASSED" },
      { id: "B", state: "PASSED" },
    ],
  )

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /B.*missing/)
})

test("fewer than three runs cannot establish stability", () => {
  const result = compareRuns(
    [run([scenario("A", "PASSED")]), run([scenario("A", "PASSED")])],
    [{ id: "A", state: "PASSED" }],
  )

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /at least 3 runs/)
})

test("the frozen expected scenario contract contains the reviewed 46 unique identities", () => {
  assert.equal(EXPECTED_SCENARIOS.length, 46)
  assert.equal(new Set(EXPECTED_SCENARIOS.map(({ id }) => id)).size, 46)
  assert.ok(EXPECTED_SCENARIOS.every(({ id, state }) => id && state))
})

test("empty, skipped, missing, duplicate, unexpected and misclassified scenarios fail closed", () => {
  const cases = [
    ["empty", inventory([]), /missing expected scenario/],
    [
      "all skipped",
      inventory([scenario("A", "SKIPPED"), scenario("B", "SKIPPED")]),
      /unexpected state|SKIPPED/,
    ],
    ["missing", inventory([scenario("A", "PASSED")]), /B.*missing/],
    [
      "duplicate",
      inventory([scenario("A", "PASSED"), scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
      /duplicate scenario ID A/,
    ],
    [
      "unexpected identity",
      inventory([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT"), scenario("X", "PASSED")]),
      /unexpected scenario ID X/,
    ],
    [
      "unrecognized classification",
      inventory([scenario("A", "PASSED"), scenario("B", "MAYBE")]),
      /unrecognized state MAYBE/,
    ],
    [
      "incorrect known-defect classification",
      inventory([scenario("A", "KNOWN_DEFECT"), scenario("B", "KNOWN_DEFECT")]),
      /A.*expected PASSED.*got KNOWN_DEFECT/,
    ],
    [
      "incorrect pending classification",
      inventory([scenario("A", "PASSED"), scenario("B", "REQUIREMENT_PENDING")]),
      /B.*expected KNOWN_DEFECT.*got REQUIREMENT_PENDING/,
    ],
  ]

  for (const [label, result, expectedProblem] of cases) {
    const validation = validateInventory(result, SMALL_CONTRACT)
    assert.ok(
      validation.problems.some((problem) => expectedProblem.test(problem)),
      label,
    )
    assert.equal(
      compareRuns(
        [run(result.scenarios), run(result.scenarios), run(result.scenarios)],
        SMALL_CONTRACT,
      ).stable,
      false,
      `${label} stability`,
    )
  }
})

test("three complete identical runs are eligible for PASS", () => {
  const valid = completeSmallInventory()
  const result = compareRuns(
    [run(valid.scenarios), run(valid.scenarios), run(valid.scenarios)],
    SMALL_CONTRACT,
  )

  assert.equal(result.stable, true)
  assert.deepEqual(result.problems, [])
})

test("non-zero Playwright exit codes prevent a stability PASS", () => {
  const result = evaluateRuns(
    [executionRun(1), executionRun(2), executionRun(3, { exitCode: 1 })],
    SMALL_CONTRACT,
  )

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /non-zero exit code 1/)
})

test("three-run stability rejects reused execution identifiers or artifacts", () => {
  const duplicateRunId = evaluateRuns(
    [executionRun(1), executionRun(2, { runId: "run-1" }), executionRun(3)],
    SMALL_CONTRACT,
  )
  const duplicateArtifact = evaluateRuns(
    [executionRun(1), executionRun(2, { inventoryPath: "/tmp/run-1.json" }), executionRun(3)],
    SMALL_CONTRACT,
  )

  assert.equal(duplicateRunId.stable, false)
  assert.match(duplicateRunId.problems.join("\n"), /duplicate execution run identifier/)
  assert.equal(duplicateArtifact.stable, false)
  assert.match(duplicateArtifact.problems.join("\n"), /duplicate inventory artifact path/)
})

test("the actual Playwright reporter fails the run when zero scenarios execute", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-empty-"))
  const outputFile = path.join(directory, "inventory.json")

  try {
    const reporter = new InventoryReporter({ outputFile, runId: "empty-run" })
    const result = withoutReporterOutput(() => reporter.onEnd({ status: "passed" }))
    const recorded = JSON.parse(readFileSync(outputFile, "utf8"))

    assert.deepEqual(result, { status: "failed" })
    assert.equal(recorded.scenarios.length, 0)
    assert.ok(recorded.contractProblems.length > 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the actual Playwright reporter returns failed when it cannot publish inventory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-reporter-write-failure-"))
  const blockingFile = path.join(directory, "not-a-directory")

  try {
    writeFileSync(blockingFile, "file")
    const reporter = new InventoryReporter({
      outputFile: path.join(blockingFile, "inventory.json"),
      runId: "write-failure-run",
    })
    const result = withoutReporterOutput(() => reporter.onEnd())

    assert.deepEqual(result, { status: "failed" })
    assert.equal(existsSync(path.join(blockingFile, "inventory.json")), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the actual Playwright reporter fails when invoked without a fresh output contract", () => {
  const reporter = new InventoryReporter({})
  const result = withoutReporterOutput(() => reporter.onEnd())

  assert.deepEqual(result, { status: "failed" })
})

test("the actual Playwright reporter rejects an all-skipped scenario run", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-skipped-"))
  const outputFile = path.join(directory, "inventory.json")

  try {
    const reporter = new InventoryReporter({ outputFile, runId: "skipped-run" })
    for (const { id } of EXPECTED_SCENARIOS) {
      reporter.onTestEnd(
        {
          title: `${id}: simulated scenario`,
          location: { file: "e2e/simulated.spec.js" },
          annotations: [],
        },
        { status: "skipped", duration: 0 },
      )
    }
    const result = withoutReporterOutput(() => reporter.onEnd({ status: "passed" }))

    assert.deepEqual(result, { status: "failed" })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the actual Playwright reporter accepts the complete reviewed scenario contract", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-complete-"))
  const outputFile = path.join(directory, "inventory.json")

  try {
    const reporter = new InventoryReporter({ outputFile, runId: "complete-run" })
    for (const { id, state } of EXPECTED_SCENARIOS) {
      const annotations =
        state === "KNOWN_DEFECT"
          ? [{ type: "known-defect", description: `${id}: reviewed known defect` }]
          : state === "REQUIREMENT_PENDING"
            ? [{ type: "requirement-pending", description: `${id}: pending requirement` }]
            : []
      reporter.onTestEnd(
        {
          title: `${id}: simulated scenario`,
          location: { file: "e2e/simulated.spec.js" },
          annotations: [],
        },
        { status: "passed", duration: 0, annotations },
      )
    }
    const result = withoutReporterOutput(() => reporter.onEnd({ status: "passed" }))
    const recorded = JSON.parse(readFileSync(outputFile, "utf8"))

    assert.equal(result, undefined)
    assert.equal(recorded.scenarios.length, 46)
    assert.deepEqual(recorded.contractProblems, [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Playwright exits non-zero when its complete run is replaced by skipped work", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-playwright-skipped-"))
  const testsDirectory = path.join(directory, "tests")
  const outputFile = path.join(directory, "inventory.json")
  const reporterPath = path.join(repositoryRoot, "e2e/reporters/inventory-reporter.js")
  const playwrightCli = realpathSync(
    path.join(repositoryRoot, "node_modules/@playwright/test/cli.js"),
  )
  const configPath = path.join(directory, "playwright.config.mjs")

  try {
    mkdirSync(testsDirectory, { recursive: true })
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }))
    symlinkSync(
      path.join(repositoryRoot, "node_modules"),
      path.join(directory, "node_modules"),
      "dir",
    )
    writeFileSync(
      configPath,
      `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ${JSON.stringify(testsDirectory)}, reporter: [[${JSON.stringify(reporterPath)}, { outputFile: ${JSON.stringify(outputFile)} }]] });\n`,
    )
    const testPath = path.join(testsDirectory, "only-skipped.spec.js")
    writeFileSync(
      testPath,
      'import { test } from "@playwright/test";\ntest.skip("F01-1: intentionally skipped counterexample", () => {});\n',
    )

    const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", configPath], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
    })

    assert.equal(result.error, undefined, result.error?.message)
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.ok(existsSync(outputFile), `${result.stdout}\n${result.stderr}`)
    const recorded = JSON.parse(readFileSync(outputFile, "utf8"))
    assert.deepEqual(recorded.counts, { SKIPPED: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the frozen scenario inventory exactly matches discovered Playwright test identities", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-discovery-"))
  const inventoryPath = path.join(directory, "inventory.json")
  const playwrightCli = realpathSync(
    path.join(repositoryRoot, "node_modules/@playwright/test/cli.js"),
  )
  const configPath = path.join(repositoryRoot, "playwright.config.js")

  try {
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", "--list", "--config", configPath],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          E2E_INVENTORY_PATH: inventoryPath,
          E2E_RUN_ID: "all-skipped-playwright-run",
        },
        timeout: 30_000,
      },
    )
    const discoveredIds = result.stdout
      .split("\n")
      .filter((line) => /^\s*\[chromium\].*\.spec\.js:\d+:\d+/.test(line))
      .map((line) => line.split("›").at(-1).trim().split(":", 1)[0])
      .toSorted()
    const expectedIds = EXPECTED_SCENARIOS.map(({ id }) => id).toSorted()

    assert.equal(result.error, undefined, result.error?.message)
    assert.notEqual(result.status, 0, "list-only runs execute no scenario and must not be green")
    assert.deepEqual(discoveredIds, expectedIds)
    assert.equal(new Set(discoveredIds).size, expectedIds.length)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
