import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"

import { collectFindings, compareToBaseline } from "./knip-baseline.js"

const BASELINE_PATH = new URL("../knip-baseline.json", import.meta.url)

const printAll = (prefix, keys) => {
  for (const key of keys) {
    console.error(`${prefix}: ${key}`)
  }
}

const runKnip = () => {
  const run = spawnSync("pnpm", ["exec", "knip", "--reporter", "json", "--no-exit-code"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || "knip did not run")
  }

  return collectFindings(JSON.parse(run.stdout))
}

const updateBaseline = (findings) => {
  if (findings.blocking.length > 0) {
    printAll("BLOCKING (never accepted)", findings.blocking)
    console.error("Refusing to record a baseline while blocking findings exist.")
    return 1
  }

  writeFileSync(BASELINE_PATH, `${JSON.stringify({ accepted: findings.baselined }, null, 2)}\n`)
  console.log(`Recorded ${findings.baselined.length} accepted knip findings.`)
  return 0
}

const checkBaseline = (findings) => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).accepted
  const result = compareToBaseline(findings, baseline)

  if (result.ok) {
    console.log(`knip: ${findings.baselined.length} accepted findings, none new, none stale.`)
    return 0
  }

  printAll("BLOCKING (never accepted)", result.blocking)
  printAll("NEW finding not in knip-baseline.json", result.added)
  printAll("STALE baseline entry (no longer reported, remove it)", result.stale)
  console.error(
    "Fix the finding, or review it and run: node scripts/check-knip-baseline.js --update",
  )
  return 1
}

const main = () => {
  const findings = runKnip()
  return process.argv.includes("--update") ? updateBaseline(findings) : checkBaseline(findings)
}

process.exitCode = main()
