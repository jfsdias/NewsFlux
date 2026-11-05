export const EXPECTED_UX_REACH_TESTS = Object.freeze([
  "UX-REACH-01: coarse-pointer control stays reachable without blocking article hits or navigation",
  "UX-REACH-01: dragging moves the control but emits no bulk mutation or confirmation",
  "UX-REACH-01: a real touch drag on the grip never activates Mark All",
  "UX-REACH-01: pointer cancellation restores the origin and suppresses activation",
  "UX-REACH-01: ordinary scrolling and a touch tap preserve the existing confirmation flow",
  "UX-REACH-01: keyboard can reposition and reset without losing action activation",
  "UX-REACH-01: skip-confirmation still executes once, and Undo restores the synthetic unread state",
  "UX-REACH-01: a failed bulk request leaves the list unchanged and the action retryable",
  "UX-REACH-01: the floating action preserves its disabled and loading states",
  "UX-REACH-01: resize clamps and restores the local position; History keeps Mark All hidden",
  "UX-REACH-01: fine-pointer desktop retains the existing conventional FooterPanel control",
])

const countDuplicates = (values) => {
  const seen = new Set()
  const duplicates = new Set()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }

  return [...duplicates].toSorted()
}

const difference = (values, expected) => {
  const expectedSet = new Set(expected)
  return [...new Set(values)].filter((value) => !expectedSet.has(value)).toSorted()
}

export const evaluateUxReachSuite = ({ discoveredTitles = [], results = [] } = {}) => {
  const expectedTitles = [...EXPECTED_UX_REACH_TESTS]
  const missingTitles = difference(expectedTitles, discoveredTitles)
  const unexpectedTitles = difference(discoveredTitles, expectedTitles)
  const duplicateTitles = countDuplicates(discoveredTitles)
  const resultTitles = results.map(({ title }) => title)
  const duplicateResultTitles = countDuplicates(resultTitles)
  const unexpectedResultTitles = difference(resultTitles, expectedTitles)
  const completedCounts = new Map()

  for (const title of resultTitles) {
    completedCounts.set(title, (completedCounts.get(title) ?? 0) + 1)
  }

  const incompleteTitles = expectedTitles.filter((title) => completedCounts.get(title) !== 1)
  const passedCount = results.filter(({ status }) => status === "passed").length
  const skippedCount = results.filter(({ status }) => status === "skipped").length
  const failedCount = results.filter(
    ({ status }) => status !== "passed" && status !== "skipped",
  ).length
  const gate =
    discoveredTitles.length === expectedTitles.length &&
    results.length === expectedTitles.length &&
    missingTitles.length === 0 &&
    unexpectedTitles.length === 0 &&
    duplicateTitles.length === 0 &&
    duplicateResultTitles.length === 0 &&
    unexpectedResultTitles.length === 0 &&
    incompleteTitles.length === 0 &&
    passedCount === expectedTitles.length &&
    skippedCount === 0 &&
    failedCount === 0
      ? "PASS"
      : "FAIL"

  return {
    gate,
    expectedCount: expectedTitles.length,
    discoveredCount: discoveredTitles.length,
    executedCount: results.length,
    passedCount,
    failedCount,
    skippedCount,
    missingTitles,
    unexpectedTitles,
    duplicateTitles,
    unexpectedResultTitles,
    duplicateResultTitles,
    incompleteTitles,
    scenarios: expectedTitles.map((title) => ({
      title,
      status: results.find((result) => result.title === title)?.status ?? "not-executed",
    })),
  }
}
