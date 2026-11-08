import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- test fixture must use the frozen inventory version.
import { E2E_SCENARIO_CONTRACT_VERSION } from "#e2e/scenario-contract.js"

// eslint-disable-next-line import/no-relative-parent-imports -- mutate the loaded config in a focused runtime gate test.
import playwrightConfig from "../playwright.config.js"

import {
  EXPECTED_INVENTORY_REPORTER_PATH,
  validateInventoryReporterBinding,
} from "./e2e-config-contract.js"
import { writeBuildProvenance } from "./e2e-provenance.js"
import runVerifiedE2E from "./verified-e2e.js"

const SCENARIOS = [
  { id: "A", state: "PASSED" },
  { id: "B", state: "KNOWN_DEFECT" },
]

const inventoryFor = (runId, scenarios = SCENARIOS) => {
  const rows = scenarios.map(({ id, state }) => ({
    id,
    title: `${id}: verified test`,
    file: "verified.spec.js",
    durationMs: 1,
    state,
    note: "",
  }))
  const counts = Object.groupBy(rows, ({ state }) => state)

  return {
    version: E2E_SCENARIO_CONTRACT_VERSION,
    runId,
    counts: Object.fromEntries(
      Object.entries(counts).map(([state, items]) => [state, items.length]),
    ),
    scenarios: rows,
    contractProblems: [],
  }
}

const withTemporaryRoot = (action) => {
  const root = mkdtempSync(path.join(tmpdir(), "newsflux-verified-e2e-"))
  try {
    execFileSync("git", ["init", "--quiet", root])
    execFileSync("git", ["-C", root, "config", "user.name", "Verified E2E Test"])
    execFileSync("git", ["-C", root, "config", "user.email", "verified-e2e@example.invalid"])
    writeFileSync(path.join(root, ".gitignore"), "build/\ntest-results/\n")
    writeFileSync(path.join(root, "source.js"), "export const source = true\n")
    execFileSync("git", ["-C", root, "add", "."])
    execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "test source"])
    mkdirSync(path.join(root, "build"), { recursive: true })
    writeFileSync(path.join(root, "build", "index.html"), "<main>verified</main>\n")
    writeBuildProvenance({ cwd: root, buildDir: path.join(root, "build") })
    return action(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const writeCurrentInventory = (env, makeInventory = (runId) => inventoryFor(runId)) => {
  mkdirSync(path.dirname(env.E2E_INVENTORY_PATH), { recursive: true })
  writeFileSync(env.E2E_INVENTORY_PATH, JSON.stringify(makeInventory(env.E2E_RUN_ID)))
}

const writeCurrentServerReceipt = (env) => {
  writeFileSync(
    env.E2E_SERVER_PROVENANCE_PATH,
    JSON.stringify({
      version: 1,
      runId: env.E2E_RUN_ID,
      verified: true,
      sourceSha: env.E2E_EXPECTED_BUILD_SOURCE_SHA,
      buildIntegrityDigest: env.E2E_EXPECTED_BUILD_INTEGRITY_DIGEST,
      buildFileCount: Number(env.E2E_EXPECTED_BUILD_FILE_COUNT),
    }),
  )
}

const makeSpawn =
  (action = writeCurrentInventory, result) =>
  (_command, _args, options) => {
    action(options.env)
    writeCurrentServerReceipt(options.env)
    return result ?? { status: 0, signal: null, error: undefined }
  }

const runTestVerifiedE2E = (options) =>
  runVerifiedE2E({
    ...options,
    runtimeMetadataImpl: () => ({
      nodeVersion: "v22.22.0",
      pnpmVersion: "11.21.0",
      playwrightVersion: "1.63.0",
      chromiumVersionOrRevision: "Chromium 153.0.8010.12",
      platform: "test",
    }),
  })

test("zero exit without current inventory cannot reuse a previous valid artifact", () => {
  withTemporaryRoot((root) => {
    const outputRoot = path.join(root, "test-results", "runs")
    mkdirSync(outputRoot, { recursive: true })
    writeFileSync(path.join(outputRoot, "run-1.json"), JSON.stringify(inventoryFor("old-run")))

    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(() => {}),
    })

    assert.equal(result.verified, false)
    assert.ok(result.problems.some((problem) => /current invocation.*inventory/i.test(problem)))
    assert.equal(result.inventory, undefined)
    assert.equal(existsSync(result.inventoryPath), false)
  })
})

test("a fresh inventory correlated to its unique execution is accepted", () => {
  withTemporaryRoot((root) => {
    const outputRoot = path.join(root, "test-results", "runs")
    const first = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(),
    })
    const second = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(),
    })

    assert.equal(first.verified, true, first.problems.join("\n"))
    assert.equal(second.verified, true, second.problems.join("\n"))
    assert.notEqual(first.runId, second.runId)
    assert.notEqual(first.inventoryPath, second.inventoryPath)
    assert.equal(first.inventory.runId, first.runId)
    assert.equal(second.inventory.runId, second.runId)
    assert.ok(
      first.outputDirectory.startsWith(outputRoot) && second.outputDirectory.startsWith(outputRoot),
    )
    const summary = JSON.parse(readFileSync(first.summaryPath, "utf8"))
    assert.deepEqual(summary.artifacts, {
      inventory: "inventory.json",
      serverProvenance: "server-provenance.json",
      playwrightOutput: "artifacts/",
    })
    assert.equal(summary.provenance.testSourceSha, summary.provenance.sourceSha)
    assert.equal(summary.provenance.buildSourceSha, summary.provenance.sourceSha)
    assert.equal(summary.provenance.sourceDirtyStateAfter, "clean")
    assert.equal(summary.provenance.gate, "PASS")
  })
})

test("the verified runner applies provenance checks to E2E_BUILD_DIR", () => {
  withTemporaryRoot((root) => {
    const alternateBuildDir = path.join(root, "output", "e2e-candidate")
    mkdirSync(alternateBuildDir, { recursive: true })
    writeFileSync(path.join(alternateBuildDir, "index.html"), "<main>alternate build</main>\n")
    writeBuildProvenance({ cwd: root, buildDir: alternateBuildDir })
    let servedDirectory

    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      baseEnv: { E2E_BUILD_DIR: alternateBuildDir },
      spawnImpl: (_command, _args, options) => {
        servedDirectory = options.env.E2E_BUILD_DIR
        writeCurrentInventory(options.env)
        writeCurrentServerReceipt(options.env)
        return { status: 0, signal: null }
      },
    })

    assert.equal(result.verified, true, result.problems.join("\n"))
    assert.equal(result.provenance.buildSourceSha, result.provenance.testSourceSha)
    assert.equal(servedDirectory, alternateBuildDir)
  })
})

test("missing runtime version evidence prevents Playwright and fails the provenance gate", () => {
  withTemporaryRoot((root) => {
    let playwrightStarted = false
    const result = runVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      runtimeMetadataImpl: () => ({
        nodeVersion: process.version,
        pnpmVersion: "11.21.0",
        playwrightVersion: "1.63.0",
        chromiumVersionOrRevision: null,
        platform: process.platform,
      }),
      spawnImpl: () => {
        playwrightStarted = true
        return { status: 0, signal: null }
      },
    })

    const summary = JSON.parse(readFileSync(result.summaryPath, "utf8"))
    assert.equal(result.verified, false)
    assert.equal(playwrightStarted, false)
    assert.equal(summary.provenance.gate, "FAIL")
    assert.ok(
      summary.provenance.blockReasons.some((reason) => /chromiumVersionOrRevision/.test(reason)),
    )
  })
})

test("missing, malformed, wrong-run, incomplete, and skipped evidence fail closed", () => {
  withTemporaryRoot((root) => {
    const cases = [
      ["missing", () => {}, /current invocation.*inventory/i],
      ["malformed", (env) => writeFileSync(env.E2E_INVENTORY_PATH, "{"), /valid JSON/i],
      [
        "wrong run identifier",
        (env) => writeCurrentInventory(env, () => inventoryFor("stale-run")),
        /run identifier/i,
      ],
      [
        "incomplete scenario set",
        (env) => writeCurrentInventory(env, (runId) => inventoryFor(runId, SCENARIOS.slice(0, 1))),
        /missing expected scenario/i,
      ],
      [
        "all skipped",
        (env) =>
          writeCurrentInventory(env, (runId) =>
            inventoryFor(
              runId,
              SCENARIOS.map(({ id }) => ({ id, state: "SKIPPED" })),
            ),
          ),
        /SKIPPED/i,
      ],
      [
        "duplicate scenario identity",
        (env) =>
          writeCurrentInventory(env, (runId) =>
            inventoryFor(runId, [SCENARIOS[0], SCENARIOS[0], SCENARIOS[1]]),
          ),
        /duplicate scenario ID/i,
      ],
      [
        "wrong approved classification",
        (env) =>
          writeCurrentInventory(env, (runId) =>
            inventoryFor(runId, [SCENARIOS[0], { id: "B", state: "PASSED" }]),
          ),
        /expected KNOWN_DEFECT, got PASSED/i,
      ],
    ]

    for (const [label, writeEvidence, expectedProblem] of cases) {
      const result = runTestVerifiedE2E({
        cwd: root,
        outputRoot: path.join(root, "test-results", label.replaceAll(" ", "-")),
        expectedScenarios: SCENARIOS,
        spawnImpl: makeSpawn(writeEvidence),
      })
      assert.equal(result.verified, false, label)
      assert.match(result.problems.join("\n"), expectedProblem, label)
    }
  })
})

test("runtime rejects a removed reporter even when its filename remains in comments", () => {
  withTemporaryRoot((root) => {
    const config = {
      ...playwrightConfig,
      reporter: playwrightConfig.reporter.filter((reporter) => {
        const target = Array.isArray(reporter) ? reporter[0] : reporter
        return target !== EXPECTED_INVENTORY_REPORTER_PATH
      }),
      comment: EXPECTED_INVENTORY_REPORTER_PATH,
    }
    let spawnInvoked = false
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      config,
      spawnImpl: () => {
        spawnInvoked = true
        return { status: 0, signal: null }
      },
    })

    assert.deepEqual(
      validateInventoryReporterBinding(config, EXPECTED_INVENTORY_REPORTER_PATH).length > 0,
      true,
    )
    assert.equal(spawnInvoked, false)
    assert.equal(result.verified, false)
    assert.match(result.problems.join("\n"), /bind the inventory reporter exactly once/)
  })
})

test("spawn failures, interrupted work, and nonzero exits cannot validate stale evidence", () => {
  withTemporaryRoot((root) => {
    const outputRoot = path.join(root, "test-results", "runs")
    const stalePath = path.join(outputRoot, "run-1.json")
    mkdirSync(outputRoot, { recursive: true })
    writeFileSync(stalePath, JSON.stringify(inventoryFor("old-run")))

    const spawnFailure = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: () => ({ error: new Error("spawn failed"), status: null, signal: null }),
    })
    const interrupted = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(writeCurrentInventory, { status: null, signal: "SIGTERM" }),
    })
    const partial = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn((env) => writeFileSync(env.E2E_INVENTORY_PATH, "{partial"), {
        status: null,
        signal: "SIGINT",
      }),
    })
    const nonzero = runTestVerifiedE2E({
      cwd: root,
      outputRoot,
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(writeCurrentInventory, { status: 1, signal: null }),
    })

    assert.equal(spawnFailure.verified, false)
    assert.match(spawnFailure.problems.join("\n"), /spawn/i)
    assert.equal(interrupted.verified, false)
    assert.match(interrupted.problems.join("\n"), /SIGTERM|exit code/i)
    assert.equal(partial.verified, false)
    assert.match(partial.problems.join("\n"), /SIGINT/)
    assert.match(partial.problems.join("\n"), /not valid JSON/i)
    assert.equal(nonzero.verified, false)
    assert.match(nonzero.problems.join("\n"), /got 1/i)
    assert.ok(existsSync(stalePath), "old artifacts remain irrelevant to every unique run")
  })
})

test("a server receipt from another E2E invocation cannot validate the current run", () => {
  withTemporaryRoot((root) => {
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      spawnImpl: (_command, _args, options) => {
        writeCurrentInventory(options.env)
        writeFileSync(
          options.env.E2E_SERVER_PROVENANCE_PATH,
          JSON.stringify({
            version: 1,
            runId: "previous-run",
            verified: true,
            sourceSha: options.env.E2E_EXPECTED_BUILD_SOURCE_SHA,
            buildIntegrityDigest: options.env.E2E_EXPECTED_BUILD_INTEGRITY_DIGEST,
            buildFileCount: Number(options.env.E2E_EXPECTED_BUILD_FILE_COUNT),
          }),
        )
        return { status: 0, signal: null }
      },
    })

    assert.equal(result.verified, false)
    assert.match(result.problems.join("\n"), /server provenance receipt run ID/)
    assert.equal(result.provenance.gate, "FAIL")
  })
})

test("source changes during the browser run fail postflight even with complete run receipts", () => {
  withTemporaryRoot((root) => {
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn((env) => {
        writeCurrentInventory(env)
        writeFileSync(path.join(root, "source.js"), "export const source = false\n")
      }),
    })

    assert.equal(result.verified, false)
    assert.match(result.problems.join("\n"), /provenance postflight.*working tree must be clean/i)
    assert.equal(result.provenance.sourceDirtyStateAfter, "dirty")
  })
})

test("every invocation writes a correlated sanitized summary even when validation fails", () => {
  withTemporaryRoot((root) => {
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn(
        (env) => {
          writeCurrentInventory(env, (runId) => ({
            ...inventoryFor(runId),
            scenarios: inventoryFor(runId).scenarios.map((scenario) => ({
              ...scenario,
              title: "Private title must not be copied",
              note: "secret session cookie must not be copied",
            })),
            contractProblems: ["observed assertion mismatch"],
          }))
        },
        { status: 1, signal: null },
      ),
    })

    const summaryPath = path.join(result.outputDirectory, "summary.json")
    assert.equal(existsSync(summaryPath), true)
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"))
    assert.equal(summary.runId, result.runId)
    assert.equal(summary.exitCode, 1)
    assert.equal(summary.verified, false)
    assert.equal(summary.provenance.gate, "PASS")
    assert.equal(summary.provenance.runId, summary.runId)
    assert.equal(summary.provenance.sourceSha, summary.provenance.buildSourceSha)
    assert.equal(summary.provenance.sourceSha, summary.provenance.testSourceSha)
    assert.equal(summary.provenance.appServer.runId, summary.runId)
    assert.match(summary.provenance.buildIntegrityDigest, /^sha256:/)
    assert.equal(summary.provenance.runtime.nodeVersion, "v22.22.0")
    assert.equal(summary.counts.PASSED, 1)
    assert.equal(summary.counts.KNOWN_DEFECT, 1)
    assert.ok(
      summary.validationErrors.some((problem) => problem.includes("observed assertion mismatch")),
    )
    assert.deepEqual(summary.scenarios, [
      { id: "A", state: "PASSED", durationMs: 1 },
      { id: "B", state: "KNOWN_DEFECT", durationMs: 1 },
    ])
    assert.doesNotMatch(JSON.stringify(summary), /Private title|secret session cookie/)
  })
})

test("spawn failure still writes a summary without leaking error details", () => {
  withTemporaryRoot((root) => {
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      spawnImpl: () => ({
        error: new Error("spawn failed with token=do-not-copy"),
        status: null,
        signal: null,
      }),
    })
    const summary = JSON.parse(
      readFileSync(path.join(result.outputDirectory, "summary.json"), "utf8"),
    )

    assert.equal(summary.runId, result.runId)
    assert.equal(summary.exitCode, null)
    assert.equal(summary.verified, false)
    assert.ok(summary.validationErrors.some((problem) => /spawn failed/.test(problem)))
    assert.doesNotMatch(JSON.stringify(summary), /do-not-copy/)
  })
})

test("summary retains sanitized first-line scenario failures", () => {
  withTemporaryRoot((root) => {
    const result = runTestVerifiedE2E({
      cwd: root,
      outputRoot: path.join(root, "test-results", "runs"),
      expectedScenarios: SCENARIOS,
      spawnImpl: makeSpawn((env) => {
        writeCurrentInventory(env, (runId) => ({
          ...inventoryFor(runId, [
            { id: "A", state: "FAILED" },
            { id: "B", state: "FAILED" },
          ]),
          scenarios: [
            {
              id: "A",
              title: "A: private article title",
              file: "verified.spec.js",
              durationMs: 2,
              state: "FAILED",
              note: "Assertion failed for token=private-value",
            },
            {
              id: "B",
              title: "B: private article title",
              file: "verified.spec.js",
              durationMs: 3,
              state: "FAILED",
              note: "Unexpected status",
            },
          ],
        }))
      }),
    })
    const summary = JSON.parse(
      readFileSync(path.join(result.outputDirectory, "summary.json"), "utf8"),
    )

    assert.ok(summary.validationErrors.includes("A: Assertion failed for token=[REDACTED]"))
    assert.ok(summary.validationErrors.includes("B: Unexpected status"))
    assert.doesNotMatch(JSON.stringify(summary), /private-value|private article title/)
  })
})
