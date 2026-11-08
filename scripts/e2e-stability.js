import path from "node:path"

// eslint-disable-next-line import/no-relative-parent-imports -- the shared scenario contract is exposed through the package import map.
import { E2E_SCENARIO_CONTRACT_VERSION, EXPECTED_SCENARIOS } from "#e2e/scenario-contract.js"

export const REQUIRED_RUNS = 3

const VALID_STATES = new Set(["PASSED", "KNOWN_DEFECT", "REQUIREMENT_PENDING", "FAILED", "SKIPPED"])
const INVENTORY_FIELDS = new Set(["version", "runId", "counts", "scenarios", "contractProblems"])
const SCENARIO_FIELDS = new Set(["id", "title", "file", "durationMs", "state", "note"])
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const exactKeys = (value, expected) => {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

const countStates = (scenarios) => {
  const counts = {}
  for (const scenario of scenarios) {
    const state = isRecord(scenario) ? scenario.state : "<invalid>"
    counts[state] = (counts[state] ?? 0) + 1
  }
  return counts
}

const sameRecord = (left, right) => {
  const leftEntries = Object.entries(left).toSorted(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).toSorted(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

/** Validates the reporter receipt against the exact frozen scenario and output schema. */
export const validateInventory = (
  inventory,
  expectedScenarios = EXPECTED_SCENARIOS,
  { expectedRunId } = {},
) => {
  const problems = []
  if (!isRecord(inventory)) {
    return { valid: false, problems: ["inventory must be an object"] }
  }

  for (const key of Object.keys(inventory)) {
    if (!INVENTORY_FIELDS.has(key)) {
      problems.push(`unknown inventory field ${key}`)
    }
  }
  for (const field of INVENTORY_FIELDS) {
    if (!(field in inventory)) {
      problems.push(`inventory is missing required field ${field}`)
    }
  }

  if (inventory.version !== E2E_SCENARIO_CONTRACT_VERSION) {
    problems.push(`inventory version must be ${E2E_SCENARIO_CONTRACT_VERSION}`)
  }
  if (typeof inventory.runId !== "string" || inventory.runId.trim() === "") {
    problems.push("inventory run identifier must be a non-empty string")
  } else if (expectedRunId !== undefined && inventory.runId !== expectedRunId) {
    problems.push(`inventory run identifier does not match current invocation ${expectedRunId}`)
  }
  if (!isRecord(inventory.counts)) {
    problems.push("inventory counts must be an object")
  }
  if (!Array.isArray(inventory.contractProblems)) {
    problems.push("inventory contractProblems must be an array")
  } else if (inventory.contractProblems.length > 0) {
    problems.push("reporter recorded contract validation problems")
  }
  if (!Array.isArray(inventory.scenarios)) {
    problems.push("inventory scenarios must be an array")
    return { valid: false, problems }
  }

  const expected = new Map(expectedScenarios.map(({ id, state }) => [id, state]))
  if (inventory.scenarios.length === 0) {
    problems.push("inventory contains no executed scenarios")
  }

  const seen = new Set()
  for (const scenario of inventory.scenarios) {
    if (!isRecord(scenario)) {
      problems.push("scenario entry must be an object")
      continue
    }
    if (!exactKeys(scenario, SCENARIO_FIELDS)) {
      problems.push("scenario entry has missing or unknown fields")
    }

    const { id, title, file, durationMs, state, note } = scenario
    if (typeof id !== "string" || id.trim() === "") {
      problems.push("scenario ID must be a non-empty string")
      continue
    }
    if (seen.has(id)) {
      problems.push(`duplicate scenario ID ${id}`)
      continue
    }
    seen.add(id)

    if (typeof title !== "string" || title.trim() === "") {
      problems.push(`${id}: title must be a non-empty string`)
    }
    if (typeof file !== "string" || file.trim() === "") {
      problems.push(`${id}: file must be a non-empty string`)
    }
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
      problems.push(`${id}: durationMs must be a finite non-negative number`)
    }
    if (typeof note !== "string") {
      problems.push(`${id}: note must be a string`)
    }

    if (!VALID_STATES.has(state)) {
      problems.push(`${id}: unrecognized state ${String(state)}`)
      continue
    }
    if (state === "SKIPPED") {
      problems.push(`${id}: SKIPPED is not an accepted outcome`)
    }
    if (state === "FAILED") {
      problems.push(`${id}: FAILED is not an accepted outcome`)
    }
    if (!expected.has(id)) {
      problems.push(`unexpected scenario ID ${id}`)
      continue
    }
    const expectedState = expected.get(id)
    if (state !== expectedState) {
      problems.push(`${id}: expected ${expectedState}, got ${state}`)
    }
  }

  for (const id of expected.keys()) {
    if (!seen.has(id)) {
      problems.push(`${id}: missing expected scenario`)
    }
  }

  if (
    isRecord(inventory.counts) &&
    Array.isArray(inventory.scenarios) &&
    !sameRecord(inventory.counts, countStates(inventory.scenarios))
  ) {
    problems.push("inventory counts do not match its scenario results")
  }

  return { valid: problems.length === 0, problems }
}

export const compareRuns = (runs, expectedScenarios = EXPECTED_SCENARIOS) => {
  const problems = []

  if (runs.length < REQUIRED_RUNS) {
    problems.push(`at least ${REQUIRED_RUNS} runs are required, got ${runs.length}`)
  }

  for (const [index, inventory] of runs.entries()) {
    const validation = validateInventory(inventory, expectedScenarios)
    for (const problem of validation.problems) {
      problems.push(`run ${index + 1}: ${problem}`)
    }
  }

  for (const { id } of expectedScenarios) {
    const states = runs.map(
      (inventory) => inventory?.scenarios?.find((entry) => entry?.id === id)?.state,
    )

    if (!states.includes(undefined) && new Set(states).size > 1) {
      problems.push(`${id}: differs between runs (${states.join(" / ")})`)
    }
  }

  return { stable: problems.length === 0, problems }
}

/** Validates independent execution receipts returned by runVerifiedE2E. */
export const evaluateRuns = (runs, expectedScenarios = EXPECTED_SCENARIOS) => {
  const problems = []
  if (runs.length !== REQUIRED_RUNS) {
    problems.push(`exactly ${REQUIRED_RUNS} verified runs are required, got ${runs.length}`)
  }

  const runIds = new Set()
  const inventoryPaths = new Set()
  const summaryPaths = new Set()
  let firstProvenance
  for (const [index, run] of runs.entries()) {
    if (!run || !isRecord(run)) {
      problems.push(`run ${index + 1}: execution receipt must be an object`)
      continue
    }
    if (run.verified !== true) {
      problems.push(`run ${index + 1}: verified execution receipt is required`)
    }
    if (Array.isArray(run.problems)) {
      for (const problem of run.problems) {
        problems.push(`run ${index + 1}: ${problem}`)
      }
    }
    if (run.spawnError) {
      problems.push(`run ${index + 1}: process spawn failed: ${run.spawnError}`)
    }
    if (run.exitCode !== 0) {
      problems.push(`run ${index + 1}: non-zero exit code ${String(run.exitCode)}`)
    }
    if (run.signal !== null && run.signal !== undefined) {
      problems.push(`run ${index + 1}: process ended by signal ${run.signal}`)
    }
    if (typeof run.runId !== "string" || run.runId.trim() === "") {
      problems.push(`run ${index + 1}: execution run identifier is missing`)
    } else {
      if (runIds.has(run.runId)) {
        problems.push(`run ${index + 1}: duplicate execution run identifier ${run.runId}`)
      }
      runIds.add(run.runId)
    }
    if (typeof run.inventoryPath !== "string" || run.inventoryPath.trim() === "") {
      problems.push(`run ${index + 1}: inventory artifact path is missing`)
    } else {
      const inventoryPath = path.resolve(run.inventoryPath)
      if (inventoryPaths.has(inventoryPath)) {
        problems.push(`run ${index + 1}: duplicate inventory artifact path ${run.inventoryPath}`)
      }
      inventoryPaths.add(inventoryPath)
    }
    if (!run.inventory || run.inventory.runId !== run.runId) {
      problems.push(`run ${index + 1}: inventory does not match its execution run identifier`)
    }

    const { provenance } = run
    if (!provenance || provenance.gate !== "PASS") {
      problems.push(`run ${index + 1}: verified source/build provenance is required`)
    } else {
      if (provenance.runId !== run.runId || provenance.appServer?.runId !== run.runId) {
        problems.push(
          `run ${index + 1}: provenance receipts do not match the execution run identifier`,
        )
      }
      if (
        provenance.appServer?.sourceSha !== provenance.sourceSha ||
        provenance.appServer?.buildIntegrityDigest !== provenance.buildIntegrityDigest
      ) {
        problems.push(`run ${index + 1}: app server receipt does not match its build provenance`)
      }
      if (firstProvenance) {
        for (const field of [
          "sourceSha",
          "sourceTreeSha",
          "testSourceSha",
          "buildSourceSha",
          "buildIntegrityDigest",
          "buildFileCount",
        ]) {
          if (provenance[field] !== firstProvenance[field]) {
            problems.push(`run ${index + 1}: ${field} differs across stability executions`)
          }
        }
        if (JSON.stringify(provenance.runtime) !== JSON.stringify(firstProvenance.runtime)) {
          problems.push(`run ${index + 1}: runtime versions differ across stability executions`)
        }
      } else {
        firstProvenance = provenance
      }
    }

    if (typeof run.summaryPath !== "string" || run.summaryPath.trim() === "") {
      problems.push(`run ${index + 1}: summary artifact path is missing`)
    } else {
      const summaryPath = path.resolve(run.summaryPath)
      if (summaryPaths.has(summaryPath)) {
        problems.push(`run ${index + 1}: duplicate summary artifact path ${run.summaryPath}`)
      }
      summaryPaths.add(summaryPath)
    }
  }

  const comparison = compareRuns(
    runs.map((run) => run?.inventory),
    expectedScenarios,
  )
  problems.push(...comparison.problems)

  return { stable: problems.length === 0, problems }
}
