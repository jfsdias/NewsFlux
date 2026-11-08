import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { evaluateRuns, REQUIRED_RUNS } from "./e2e-stability.js"
import runVerifiedE2E from "./verified-e2e.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = path.join(repositoryRoot, "test-results", "stability")

const runStabilityChecks = ({ run = runVerifiedE2E } = {}) => {
  const runs = Array.from({ length: REQUIRED_RUNS }, () => run())
  const evaluation = evaluateRuns(runs)
  return { runs, evaluation }
}

export default runStabilityChecks

const main = () => {
  mkdirSync(outputDirectory, { recursive: true })
  const { runs, evaluation } = runStabilityChecks()
  const summary = {
    version: 2,
    requiredRuns: REQUIRED_RUNS,
    runs: runs.map(
      ({
        runId,
        inventoryPath,
        summaryPath,
        exitCode,
        signal,
        spawnError,
        verified,
        problems,
        inventory,
        provenance,
      }) => ({
        runId,
        inventoryPath,
        summaryPath,
        exitCode,
        signal,
        spawnError: spawnError ?? null,
        verified,
        counts: inventory?.counts ?? null,
        problems,
        provenance: provenance ?? null,
      }),
    ),
    stable: evaluation.stable,
    problems: evaluation.problems,
  }

  writeFileSync(`${outputDirectory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\nStability summary: ${JSON.stringify(summary)}`)
  return evaluation.stable ? 0 : 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
