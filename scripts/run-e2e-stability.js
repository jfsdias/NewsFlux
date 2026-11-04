import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import process from "node:process"

import { compareRuns, REQUIRED_RUNS } from "./e2e-stability.js"

const OUTPUT_DIRECTORY = "test-results/stability"

const runOnce = (index) => {
  const inventory = `${OUTPUT_DIRECTORY}/run-${index}.json`
  const result = spawnSync("pnpm", ["exec", "playwright", "test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_INVENTORY_PATH: inventory,
      E2E_OUTPUT_DIR: `${OUTPUT_DIRECTORY}/artifacts-${index}`,
    },
  })

  return { exitCode: result.status, inventory: JSON.parse(readFileSync(inventory, "utf8")) }
}

const main = () => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true })

  // Each run is a fresh Playwright process with fresh servers: independent executions.
  const runs = Array.from({ length: REQUIRED_RUNS }, (_, index) => runOnce(index + 1))
  const comparison = compareRuns(runs.map(({ inventory }) => inventory))
  const exitCodes = runs.map(({ exitCode }) => exitCode)
  const stable = comparison.stable && exitCodes.every((code) => code === 0)
  const summary = {
    requiredRuns: REQUIRED_RUNS,
    exitCodes,
    counts: runs.map(({ inventory }) => inventory.counts),
    stable,
    problems: comparison.problems,
  }

  writeFileSync(`${OUTPUT_DIRECTORY}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\nStability summary: ${JSON.stringify(summary)}`)
  return stable ? 0 : 1
}

process.exitCode = main()
