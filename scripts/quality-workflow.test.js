import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { parse } from "yaml"

import validatePackageScripts from "./package-script-contract.js"

const WORKFLOW_PATH = new URL("../.github/workflows/quality.yaml", import.meta.url)
const E2E_WORKFLOW_PATH = new URL("../.github/workflows/e2e.yaml", import.meta.url)
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

test("package scripts invoked by CI retain effective verification commands", () => {
  const { scripts } = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"))
  assert.deepEqual(validatePackageScripts(scripts), [])
})

test("no-op and swallowed-error package script mutations are rejected", () => {
  const { scripts } = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"))
  const gatedScripts = [
    "lint",
    "format:check",
    "test:src",
    "test:scripts",
    "build",
    "knip:check",
    "test:e2e",
  ]

  for (const name of gatedScripts) {
    const noOp = { ...scripts, [name]: "echo fake" }
    assert.ok(
      validatePackageScripts(noOp).some((problem) => problem.includes(name)),
      `${name} no-op must be rejected`,
    )
  }

  assert.ok(
    validatePackageScripts({ ...scripts, "test:src": "node --test src/**/*.test.js" }).some(
      (problem) => problem.includes("test:src"),
    ),
    "source test globs must stay quoted so the shell cannot expand them before Node",
  )

  for (const [name, bypass] of [
    ["lint", "eslint || true"],
    ["format:check", "prettier --check .; exit 0"],
    ["build", "vite build >/dev/null || true"],
    ["test:e2e", "pnpm run build && playwright test || true"],
  ]) {
    const mutated = { ...scripts, [name]: bypass }
    assert.ok(
      validatePackageScripts(mutated).some((problem) => problem.includes(name)),
      `${name} bypass must be rejected`,
    )
  }
})

const readE2eWorkflow = () => {
  assert.ok(existsSync(E2E_WORKFLOW_PATH), ".github/workflows/e2e.yaml must exist")
  const source = readFileSync(E2E_WORKFLOW_PATH, "utf8")
  return { source, workflow: parse(source) }
}

test("the e2e workflow is read-only, runs in forks and pins its actions", () => {
  const { source, workflow } = readE2eWorkflow()

  assert.deepEqual(workflow.on.pull_request.branches, ["main"])
  assert.deepEqual(workflow.permissions, { contents: "read" })
  assert.doesNotMatch(source, /secrets\./)
  assert.doesNotMatch(source, /github\.repository\s*==/)
  assert.doesNotMatch(source, /continue-on-error/)
  for (const job of Object.values(workflow.jobs)) {
    for (const step of stepsOf(job)) {
      if (step.uses) {
        assert.match(step.uses.split(" ", 1)[0], PINNED_ACTION)
      }
    }
  }
})

test("the e2e workflow installs the pinned browser and runs the Playwright suite", () => {
  const { workflow } = readE2eWorkflow()
  const commands = new Set(Object.values(workflow.jobs).flatMap((job) => runCommands(job)))

  assert.ok(commands.has("pnpm install --frozen-lockfile"))
  assert.ok(commands.has("pnpm exec playwright install --with-deps chromium"))
  assert.ok(commands.has("pnpm test:e2e"))
})

test("the e2e scripts exist and Playwright stays pinned", () => {
  const { scripts, devDependencies } = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"))

  assert.equal(scripts["test:e2e"], "pnpm run build && playwright test")
  assert.equal(scripts["test:e2e:stability"], "pnpm run build && node scripts/run-e2e-stability.js")
  assert.match(devDependencies["@playwright/test"], /^\d+\.\d+\.\d+$/, "pin an exact version")
})

test("the e2e workflow uses the scenario-inventory reporter that can fail the run", () => {
  const config = readFileSync(new URL("../playwright.config.js", import.meta.url), "utf8")
  assert.match(config, /inventory-reporter\.js/)
})

const WORKFLOW_FILES = [
  [".github/workflows/quality.yaml", readWorkflow],
  [".github/workflows/e2e.yaml", readE2eWorkflow],
]
const ALLOWED_TRIGGERS = new Set(["pull_request", "push"])
const FORBIDDEN_TRIGGER_FILTERS = [
  "paths",
  "paths-ignore",
  "branches-ignore",
  "tags",
  "tags-ignore",
]
const FORBIDDEN_COMMAND_PATTERNS = [/\|\|\s*true/, /;\s*true\b/, /set\s+\+e/, /\bexit\s+0\b/]
const FORBIDDEN_SOURCE_PATTERNS = [
  [/\bsecrets\b/, "secrets"],
  [/github\.repository/, "a repository guard or repository context"],
  [/pull_request_target/, "pull_request_target"],
]

const withoutComments = (source) => source.replaceAll(/(^|\s)#.*$/gm, "")

const jobsAndSteps = (workflow) =>
  Object.entries(workflow.jobs).flatMap(([name, job]) => [
    [`job ${name}`, job],
    ...stepsOf(job).map((step, index) => [`job ${name} step ${index + 1}`, step]),
  ])

for (const [file, read] of WORKFLOW_FILES) {
  test(`${file}: no gate can be skipped, ignored or made conditional`, () => {
    const { workflow } = read()

    for (const [where, node] of jobsAndSteps(workflow)) {
      assert.ok(!("if" in node), `${where} must not be conditional`)
      assert.ok(!("continue-on-error" in node), `${where} must not set continue-on-error`)
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.ok(!("needs" in job), `job ${name} must not depend on another job`)
      for (const command of runCommands(job)) {
        for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
          assert.doesNotMatch(command, pattern, `job ${name} must not swallow failures`)
        }
      }
    }
  })

  test(`${file}: only pull request and push triggers, without path or tag filters`, () => {
    const { workflow } = read()

    for (const trigger of Object.keys(workflow.on)) {
      assert.ok(ALLOWED_TRIGGERS.has(trigger), `unexpected trigger ${trigger}`)
      for (const filter of FORBIDDEN_TRIGGER_FILTERS) {
        assert.ok(!(filter in (workflow.on[trigger] ?? {})), `${trigger} must not use ${filter}`)
      }
    }
  })

  test(`${file}: no secrets, repository guards or privileged triggers anywhere in the source`, () => {
    const code = withoutComments(read().source)

    for (const [pattern, label] of FORBIDDEN_SOURCE_PATTERNS) {
      assert.doesNotMatch(code, pattern, `the workflow must not reference ${label}`)
    }
  })

  test(`${file}: the Node version of every job is the one that is declared`, () => {
    const { workflow } = read()

    for (const [name, job] of Object.entries(workflow.jobs)) {
      const matrix = job.strategy?.matrix
      if (matrix) {
        assert.deepEqual(Object.keys(matrix), ["node-version"], `job ${name}: no exclude/include`)
      }
      const setups = stepsOf(job).filter((step) => step.uses?.startsWith("actions/setup-node@"))
      assert.equal(setups.length, 1, `job ${name} must set up Node once`)
      const expected = matrix ? "${{ matrix.node-version }}" : "22"
      assert.equal(String(setups[0].with["node-version"]), expected, `job ${name} Node version`)
    }
  })
}
