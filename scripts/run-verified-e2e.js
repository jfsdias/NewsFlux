import process from "node:process"

import runVerifiedE2E from "./verified-e2e.js"

const result = runVerifiedE2E()

console.log(
  `\nVerified E2E run: ${JSON.stringify({
    runId: result.runId,
    inventoryPath: result.inventoryPath,
    exitCode: result.exitCode,
    counts: result.inventory?.counts ?? null,
    verified: result.verified,
    problems: result.problems,
  })}`,
)

process.exitCode = result.verified ? 0 : 1
