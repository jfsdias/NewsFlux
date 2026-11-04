// eslint-disable-next-line import/no-relative-parent-imports -- the shared E2E contract is exposed through the package import map.
import { E2E_SCENARIO_CONTRACT_VERSION, EXPECTED_SCENARIOS } from "#e2e/scenario-contract.js"

/**
 * Decides whether repeated, independent e2e runs agree. A browser gate is only considered stable
 * after at least three independent runs match the reviewed scenario inventory and every scenario
 * has its exact approved outcome. Known defects and pending requirements are explicit outcomes,
 * not passes.
 */

export const REQUIRED_RUNS = 3
const VALID_STATES = new Set(["PASSED", "KNOWN_DEFECT", "REQUIREMENT_PENDING", "FAILED", "SKIPPED"])

export const validateInventory = (inventory, expectedScenarios = EXPECTED_SCENARIOS) => {
  const problems = []
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    return { valid: false, problems: ["inventory must be an object"] }
  }
  if (inventory.version !== E2E_SCENARIO_CONTRACT_VERSION) {
    problems.push(`inventory version must be ${E2E_SCENARIO_CONTRACT_VERSION}`)
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
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      problems.push("scenario entry must be an object")
      continue
    }
    const { id, state } = scenario
    if (typeof id !== "string" || id.trim() === "") {
      problems.push("scenario ID must be a non-empty string")
      continue
    }
    if (seen.has(id)) {
      problems.push(`duplicate scenario ID ${id}`)
      continue
    }
    seen.add(id)

    if (!VALID_STATES.has(state)) {
      problems.push(`${id}: unrecognized state ${String(state)}`)
      continue
    }
    if (state === "SKIPPED") {
      problems.push(`${id}: SKIPPED is not an accepted outcome`)
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
      ({ scenarios = [] }) => scenarios.find((entry) => entry?.id === id)?.state,
    )

    if (!states.includes(undefined) && new Set(states).size > 1) {
      problems.push(`${id}: differs between runs (${states.join(" / ")})`)
    }
  }

  return { stable: problems.length === 0, problems }
}

export const evaluateRuns = (runs, expectedScenarios = EXPECTED_SCENARIOS) => {
  const comparison = compareRuns(
    runs.map(({ inventory }) => inventory),
    expectedScenarios,
  )
  const problems = [...comparison.problems]

  for (const [index, { exitCode }] of runs.entries()) {
    if (exitCode !== 0) {
      problems.push(`run ${index + 1}: non-zero exit code ${String(exitCode)}`)
    }
  }

  return { stable: problems.length === 0, problems }
}
