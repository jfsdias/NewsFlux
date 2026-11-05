import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import runStabilityChecks from "./run-e2e-stability.js"
import runVerifiedE2E from "./verified-e2e.js"

const SCENARIOS = [
  { id: "A", state: "PASSED" },
  { id: "B", state: "KNOWN_DEFECT" },
]

const previousInventory = (runId) => ({
  version: 2,
  runId,
  counts: { PASSED: 1, KNOWN_DEFECT: 1 },
  scenarios: [
    {
      id: "A",
      title: "A: prior pass",
      file: "prior.spec.js",
      durationMs: 1,
      state: "PASSED",
      note: "",
    },
    {
      id: "B",
      title: "B: prior known defect",
      file: "prior.spec.js",
      durationMs: 1,
      state: "KNOWN_DEFECT",
      note: "prior result",
    },
  ],
  contractProblems: [],
})

test("stability checker rejects three stale inventories after zero-exit runs write no evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-stability-stale-"))
  const legacyDirectory = path.join(root, "test-results", "stability")
  const outputRoot = path.join(root, "test-results", "verified-e2e")

  try {
    mkdirSync(legacyDirectory, { recursive: true })
    for (let index = 1; index <= 3; index += 1) {
      writeFileSync(
        path.join(legacyDirectory, `run-${index}.json`),
        JSON.stringify(previousInventory(`old-run-${index}`)),
      )
    }

    const { runs, evaluation } = runStabilityChecks({
      run: () =>
        runVerifiedE2E({
          cwd: root,
          outputRoot,
          expectedScenarios: SCENARIOS,
          spawnImpl: () => ({ status: 0, signal: null }),
        }),
    })

    assert.equal(runs.length, 3)
    assert.equal(new Set(runs.map(({ runId }) => runId)).size, 3)
    assert.equal(
      runs.every(({ verified, inventory }) => !verified && inventory === undefined),
      true,
    )
    assert.equal(evaluation.stable, false)
    assert.match(evaluation.problems.join("\n"), /current invocation did not produce/i)
    assert.equal(
      readFileSync(path.join(legacyDirectory, "run-1.json"), "utf8"),
      JSON.stringify(previousInventory("old-run-1")),
      "legacy artifacts remain untouched and are never consumed",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
