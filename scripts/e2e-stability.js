/**
 * Decides whether repeated, independent e2e runs agree. A browser gate is only considered stable
 * after at least three independent runs in which every scenario ends in the same state and none
 * ends in FAILED. Known defects and pending requirements count as stable states: they are the
 * expected, recorded outcome, not a pass.
 */

export const REQUIRED_RUNS = 3

export const compareRuns = (runs) => {
  const problems = []

  if (runs.length < REQUIRED_RUNS) {
    problems.push(`at least ${REQUIRED_RUNS} runs are required, got ${runs.length}`)
  }

  const ids = new Set(runs.flatMap(({ scenarios }) => scenarios.map(({ id }) => id)))

  for (const id of [...ids].toSorted()) {
    const states = runs.map(({ scenarios }) => scenarios.find((entry) => entry.id === id)?.state)

    if (states.includes(undefined)) {
      problems.push(`${id}: missing from at least one run (${states.map(String).join(" / ")})`)
    } else if (new Set(states).size > 1) {
      problems.push(`${id}: differs between runs (${states.join(" / ")})`)
    } else if (states[0] === "FAILED") {
      problems.push(`${id}: FAILED in every run`)
    }
  }

  return { stable: problems.length === 0, problems }
}
