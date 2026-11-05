import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

// eslint-disable-next-line import/no-relative-parent-imports -- the reporter consumes shared E2E contracts through the package import map.
import { E2E_SCENARIO_CONTRACT_VERSION } from "#e2e/scenario-contract.js"
// eslint-disable-next-line import/no-relative-parent-imports -- the reporter consumes the shared stability validator through the package import map.
import { validateInventory } from "#scripts/e2e-stability.js"

const CLASSIFICATIONS = {
  "known-defect": "KNOWN_DEFECT",
  "requirement-pending": "REQUIREMENT_PENDING",
}

const classify = (test, result) => {
  const annotation = test.annotations.find(({ type }) => type in CLASSIFICATIONS)
  const recorded = result.annotations?.find(({ type }) => type in CLASSIFICATIONS)
  const marker = recorded ?? annotation
  if (result.status === "passed" && marker) {
    return { state: CLASSIFICATIONS[marker.type], note: marker.description ?? "" }
  }
  if (result.status === "passed") {
    return { state: "PASSED", note: "" }
  }
  if (result.status === "skipped") {
    return { state: "SKIPPED", note: "" }
  }
  return { state: "FAILED", note: result.error?.message?.split("\n", 1)[0] ?? result.status }
}

/**
 * Prints and writes the scenario inventory. Known defects and pending requirements are listed
 * under their own state so a green run is never mistaken for "no known problems".
 */
export default class InventoryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile ?? process.env.E2E_INVENTORY_PATH
    this.runId = options.runId ?? process.env.E2E_RUN_ID ?? ""
    this.rows = []
  }

  onTestEnd(test, result) {
    const [id] = test.title.split(":", 1)
    this.rows.push({
      id,
      title: test.title,
      file: path.basename(test.location.file),
      durationMs: result.duration,
      ...classify(test, result),
    })
  }

  onEnd() {
    if (typeof this.outputFile !== "string" || this.outputFile.trim() === "") {
      console.error("Could not write the E2E scenario inventory: invocation output path is missing")
      return { status: "failed" }
    }

    const rows = this.rows.toSorted((left, right) => left.id.localeCompare(right.id))
    const counts = {}
    for (const { state } of rows) {
      counts[state] = (counts[state] ?? 0) + 1
    }
    const inventory = {
      version: E2E_SCENARIO_CONTRACT_VERSION,
      runId: this.runId,
      counts,
      scenarios: rows,
      contractProblems: [],
    }
    const validation = validateInventory(inventory)
    const receipt = { ...inventory, contractProblems: validation.problems }

    try {
      mkdirSync(path.dirname(this.outputFile), { recursive: true })
      writeFileSync(this.outputFile, `${JSON.stringify(receipt, null, 2)}\n`)
    } catch (error) {
      console.error(`Could not write the E2E scenario inventory: ${error.message}`)
      return { status: "failed" }
    }

    console.log("\nScenario inventory")
    for (const row of rows.filter(({ state }) => state !== "PASSED")) {
      console.log(`  ${row.state.padEnd(20)} ${row.id}  ${row.note}`)
    }
    console.log(`  Totals: ${JSON.stringify(counts)}`)
    for (const problem of validation.problems) {
      console.error(`  INVALID SCENARIO INVENTORY: ${problem}`)
    }
    if (counts.KNOWN_DEFECT || counts.REQUIREMENT_PENDING) {
      console.log(
        "  GREEN WITH KNOWN DEFECTS / PENDING REQUIREMENTS: see docs/qa/FINDINGS_REGISTER.md",
      )
    }

    return validation.valid ? undefined : { status: "failed" }
  }
}
