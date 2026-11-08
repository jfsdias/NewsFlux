import { writeFileSync } from "node:fs"
import path from "node:path"

import prettier from "prettier"

import buildPersonalizationRelevanceGateReport from "./tests/personalization-relevance-gate-01.js"
import { EVALUATION_SCENARIOS, runEvaluationReport } from "./tests/personalization-v2-eval-01.js"

const baseSha = process.argv[2]
if (!/^[0-9a-f]{40}$/.test(baseSha ?? "")) {
  throw new Error(
    "Usage: node scripts/personalization-relevance-gate-01-report.js <40-character-base-sha>",
  )
}

const report = buildPersonalizationRelevanceGateReport({
  evaluationReport: runEvaluationReport(),
  scenarios: EVALUATION_SCENARIOS,
  baseSha,
})
const outputPath = path.resolve("scripts/tests/reports/personalization-relevance-gate-01.json")
const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {}
const formattedReport = await prettier.format(JSON.stringify(report), {
  ...prettierConfig,
  filepath: outputPath,
})
writeFileSync(outputPath, formattedReport)
console.log(`Wrote deterministic synthetic metrics receipt: ${outputPath}`)
console.log(JSON.stringify(report.summary, null, 2))
