import assert from "node:assert/strict"
import test from "node:test"

import { compareRuns } from "./e2e-stability.js"

const run = (scenarios) => ({ scenarios })
const scenario = (id, state) => ({ id, state })

test("identical runs without failures are stable", () => {
  const result = compareRuns([
    run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
    run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
    run([scenario("A", "PASSED"), scenario("B", "KNOWN_DEFECT")]),
  ])

  assert.equal(result.stable, true)
  assert.deepEqual(result.problems, [])
})

test("a scenario that changes state between runs is flaky", () => {
  const result = compareRuns([
    run([scenario("A", "PASSED")]),
    run([scenario("A", "FAILED")]),
    run([scenario("A", "PASSED")]),
  ])

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /A.*PASSED.*FAILED/)
})

test("a scenario that fails in every run is reported as failing, not stable", () => {
  const result = compareRuns([
    run([scenario("A", "FAILED")]),
    run([scenario("A", "FAILED")]),
    run([scenario("A", "FAILED")]),
  ])

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /A.*FAILED/)
})

test("a scenario missing from one run is reported", () => {
  const result = compareRuns([
    run([scenario("A", "PASSED"), scenario("B", "PASSED")]),
    run([scenario("A", "PASSED")]),
    run([scenario("A", "PASSED"), scenario("B", "PASSED")]),
  ])

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /B.*missing/)
})

test("fewer than three runs cannot establish stability", () => {
  const result = compareRuns([run([scenario("A", "PASSED")]), run([scenario("A", "PASSED")])])

  assert.equal(result.stable, false)
  assert.match(result.problems.join("\n"), /at least 3 runs/)
})
