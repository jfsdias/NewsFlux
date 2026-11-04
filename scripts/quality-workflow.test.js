import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { parse } from "yaml"

const WORKFLOW_PATH = new URL("../.github/workflows/quality.yaml", import.meta.url)
const PACKAGE_PATH = new URL("../package.json", import.meta.url)
const PINNED_ACTION = /^[\w.-]+\/[\w.-]+@[\da-f]{40}$/
const SUPPORTED_NODE_VERSIONS = ["22", "24"]

const readWorkflow = () => {
  assert.ok(existsSync(WORKFLOW_PATH), ".github/workflows/quality.yaml must exist")
  const source = readFileSync(WORKFLOW_PATH, "utf8")
  return { source, workflow: parse(source) }
}

const stepsOf = (job) => job.steps ?? []
const runCommands = (job) => stepsOf(job).flatMap((step) => (step.run ? [step.run.trim()] : []))
const nodeVersionsOf = (job) => (job.strategy?.matrix?.["node-version"] ?? []).map(String)

test("the quality workflow runs on pull requests to main and on pushes to main", () => {
  const { workflow } = readWorkflow()

  assert.deepEqual(workflow.on.pull_request.branches, ["main"])
  assert.deepEqual(workflow.on.push.branches, ["main"])
})

test("the quality workflow is read-only and carries no secrets or repository guard", () => {
  const { source, workflow } = readWorkflow()

  assert.deepEqual(workflow.permissions, { contents: "read" })
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions, undefined, "jobs must not widen the read-only permissions")
    assert.equal(job["continue-on-error"], undefined, "jobs must not ignore failures")
    for (const step of stepsOf(job)) {
      assert.notEqual(step["continue-on-error"], true, "steps must not ignore failures")
    }
  }
  assert.doesNotMatch(source, /secrets\./, "the quality workflow must not use secrets")
  assert.doesNotMatch(source, /github\.repository\s*==/, "the workflow must run in forks")
})

test("every action is pinned to a full commit SHA", () => {
  const { workflow } = readWorkflow()
  const uses = Object.values(workflow.jobs).flatMap((job) =>
    stepsOf(job).flatMap((step) => (step.uses ? [step.uses.split(" ", 1)[0]] : [])),
  )

  assert.ok(uses.length > 0)
  for (const reference of uses) {
    assert.match(reference, PINNED_ACTION, `${reference} must be pinned by SHA`)
  }
})

test("static checks run ESLint and Prettier", () => {
  const { workflow } = readWorkflow()
  const commands = runCommands(workflow.jobs.static)

  assert.ok(commands.includes("pnpm lint"))
  assert.ok(commands.includes("pnpm format:check"))
})

test("source and script tests run on every supported Node version", () => {
  const { workflow } = readWorkflow()
  const job = workflow.jobs.test
  const commands = runCommands(job)

  assert.deepEqual(nodeVersionsOf(job), SUPPORTED_NODE_VERSIONS)
  assert.equal(job.strategy["fail-fast"], false)
  assert.ok(commands.includes("pnpm test:src"))
  assert.ok(commands.includes("pnpm test:scripts"))
})

test("the production build runs on every supported Node version", () => {
  const { workflow } = readWorkflow()
  const job = workflow.jobs.build

  assert.deepEqual(nodeVersionsOf(job), SUPPORTED_NODE_VERSIONS)
  assert.ok(runCommands(job).includes("pnpm run build"))
})

test("knip runs as a gate against the accepted baseline", () => {
  const { workflow } = readWorkflow()

  assert.ok(runCommands(workflow.jobs.knip).includes("pnpm knip:check"))
})

test("every job installs from the frozen lockfile", () => {
  const { workflow } = readWorkflow()

  for (const job of Object.values(workflow.jobs)) {
    assert.ok(
      runCommands(job).includes("pnpm install --frozen-lockfile"),
      "jobs must use pnpm install --frozen-lockfile",
    )
  }
})

test("package scripts cover every source and script test file", () => {
  const { scripts } = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"))

  assert.equal(scripts["test:src"], 'node --test "src/**/*.test.js"')
  assert.equal(scripts["test:scripts"], 'node --test "scripts/*.test.js"')
  assert.equal(scripts.test, "pnpm run test:src && pnpm run test:scripts")
  assert.equal(scripts["knip:check"], "node scripts/check-knip-baseline.js")
})
