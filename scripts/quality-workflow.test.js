import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { parse } from "yaml"

// eslint-disable-next-line import/no-relative-parent-imports -- verify the actual config object consumed by Playwright.
import playwrightConfig from "../playwright.config.js"

import {
  EXPECTED_INVENTORY_REPORTER_PATH,
  validateInventoryReporterBinding,
} from "./e2e-config-contract.js"
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

test("the Python suite runs independently on the supported interpreter", () => {
  const { workflow } = readWorkflow()
  const job = workflow.jobs.python
  const pythonSetups = stepsOf(job).filter((step) => step.uses?.startsWith("actions/setup-python@"))
  const nodeSetups = stepsOf(job).filter((step) => step.uses?.startsWith("actions/setup-node@"))

  assert.equal(job["runs-on"], "ubuntu-latest")
  assert.equal(pythonSetups.length, 1)
  assert.equal(String(pythonSetups[0].with["python-version"]), "3.12")
  assert.equal(nodeSetups.length, 0)
  assert.deepEqual(runCommands(job), [
    "python3 -m pip install --disable-pip-version-check --requirement services/article_intel_summary/requirements.txt",
    "PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/article_intel_auth/tests -p 'test_*.py' -v",
    "PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/article_intel_summary/tests -p 'test_*.py' -v",
    "PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/content_fallback/tests -p 'test_*.py' -v",
  ])
})

test("each Node job installs from the frozen lockfile", () => {
  const { workflow } = readWorkflow()

  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === "python") {
      continue
    }
    assert.ok(
      runCommands(job).includes("pnpm install --frozen-lockfile"),
      `Node job ${name} must use pnpm install --frozen-lockfile`,
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
    "test:e2e:run",
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

test("the e2e workflow installs the pinned browser and runs three verified stability passes", () => {
  const { workflow } = readE2eWorkflow()
  const commands = new Set(runCommands(workflow.jobs.e2e))

  assert.ok(commands.has("pnpm install --frozen-lockfile"))
  assert.ok(commands.has("pnpm exec playwright install --with-deps chromium"))
  assert.ok(commands.has("pnpm test:e2e:stability"))
  assert.ok(
    !commands.has("pnpm test:e2e"),
    "the CI gate must run three distinct verified inventories",
  )
})

test("the Article Intelligence Reader job builds both flag states before serving the production bundle", () => {
  const { workflow } = readE2eWorkflow()
  const steps = stepsOf(workflow.jobs.article_intelligence_reader)
  const defaultBuildIndex = steps.findIndex(
    (step) =>
      step.name === "Build Reader with AI disabled by default" && step.run?.trim() === "pnpm build",
  )
  const enabledBuildIndex = steps.findIndex(
    (step) =>
      step.name === "Build Reader with explicit AI enablement" && step.run?.trim() === "pnpm build",
  )
  const defaultTestIndex = steps.findIndex(
    (step) => step.name === "Run Article Intelligence Reader scenarios",
  )
  const enabledTestIndex = steps.findIndex(
    (step) => step.name === "Run AI-enabled Reader scenarios",
  )
  const integrationBuildIndex = steps.findIndex(
    (step) =>
      step.name === "Build Reader with recovery for cross-feature scenarios" &&
      step.run?.trim() === "pnpm build",
  )
  const integrationTestIndex = steps.findIndex(
    (step) => step.name === "Run recovery and summary cross-feature scenarios",
  )
  const playwrightConfig = readFileSync(
    new URL("../playwright.article-intelligence.config.js", import.meta.url),
    "utf8",
  )

  assert.notEqual(defaultBuildIndex, -1, "the default-off Reader bundle must be built")
  assert.notEqual(enabledBuildIndex, -1, "the explicitly enabled Reader bundle must be built")
  assert.notEqual(defaultTestIndex, -1, "the default-off Reader scenarios must run")
  assert.notEqual(enabledTestIndex, -1, "the AI-enabled Reader scenarios must run")
  assert.notEqual(
    integrationBuildIndex,
    -1,
    "the explicitly integrated Reader bundle must be built",
  )
  assert.notEqual(integrationTestIndex, -1, "the combined recovery and summary scenarios must run")
  assert.equal(steps[enabledBuildIndex].env?.VITE_ARTICLE_INTELLIGENCE_ENABLED, "1")
  assert.equal(steps[enabledTestIndex].env?.VITE_ARTICLE_INTELLIGENCE_ENABLED, "1")
  assert.equal(steps[defaultBuildIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH, undefined)
  assert.equal(steps[defaultTestIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH, undefined)
  assert.equal(steps[enabledBuildIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH, undefined)
  assert.equal(steps[enabledTestIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH, undefined)
  assert.equal(steps[integrationBuildIndex].env?.VITE_ARTICLE_INTELLIGENCE_ENABLED, "1")
  assert.equal(
    steps[integrationBuildIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH,
    "/api/content-fallback",
  )
  assert.equal(steps[integrationTestIndex].env?.VITE_ARTICLE_INTELLIGENCE_ENABLED, "1")
  assert.equal(
    steps[integrationTestIndex].env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH,
    "/api/content-fallback",
  )
  assert.match(steps[integrationTestIndex].run, /--grep AI_RECOVERY_CROSS/u)
  assert.ok(defaultBuildIndex < defaultTestIndex)
  assert.ok(defaultTestIndex < enabledBuildIndex)
  assert.ok(enabledBuildIndex < enabledTestIndex)
  assert.ok(enabledTestIndex < integrationBuildIndex)
  assert.ok(integrationBuildIndex < integrationTestIndex)
  assert.match(playwrightConfig, /pnpm exec vite --host 127\.0\.0\.1 --port/u)
  assert.doesNotMatch(playwrightConfig, /start-app-server\.js/u)
})

test("the blocking UX-REACH job builds and executes its isolated 11-test Playwright suite", () => {
  const { workflow } = readE2eWorkflow()
  const job = workflow.jobs.ux_reach
  assert.ok(job, "the dedicated UX-REACH job must exist")
  const commands = runCommands(job)

  assert.ok(commands.includes("pnpm install --frozen-lockfile"))
  assert.ok(commands.includes("pnpm exec playwright install --with-deps chromium"))
  assert.ok(commands.includes("pnpm build"))
  assert.ok(
    commands.includes("pnpm exec playwright test --config=playwright.ux-reach-01.config.js"),
  )

  const upload = stepsOf(job).find((step) => step.name === "Upload UX-REACH diagnostics")
  assert.ok(upload, "failed UX runs must preserve their diagnostics")
  assert.equal(upload.if, "${{ failure() }}")
  assert.equal(upload.uses, "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9")
  assert.deepEqual(upload.with, {
    name: "ux-reach-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}",
    path: "test-results/ux-reach-01/",
    "if-no-files-found": "warn",
    "retention-days": 3,
  })
})

test("failed E2E runs upload only their invocation-scoped diagnostics", () => {
  const { workflow } = readE2eWorkflow()
  const steps = stepsOf(workflow.jobs.e2e)
  const upload = steps.find((step) => step.name === "Upload synthetic E2E diagnostics")

  assert.ok(upload, "the failed run must preserve diagnostic evidence")
  assert.equal(upload.if, "${{ failure() }}")
  assert.equal(upload.uses, "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9")
  assert.deepEqual(upload.with, {
    name: "synthetic-e2e-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}",
    path: "test-results/verified-e2e/",
    "if-no-files-found": "ignore",
    "retention-days": 3,
  })
  assert.equal(upload["continue-on-error"], undefined)
})

test("the e2e scripts exist and Playwright stays pinned", () => {
  const { scripts, devDependencies } = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"))

  assert.equal(scripts["test:e2e"], "node scripts/build-and-run-e2e.js")
  assert.equal(scripts["test:e2e:run"], "node scripts/run-verified-e2e.js")
  assert.equal(scripts["test:e2e:stability"], "node scripts/build-and-run-e2e.js --stability")
  assert.match(devDependencies["@playwright/test"], /^\d+\.\d+\.\d+$/, "pin an exact version")
})

test("the loaded Playwright config binds the inventory reporter implementation exactly once", () => {
  assert.deepEqual(
    validateInventoryReporterBinding(playwrightConfig, EXPECTED_INVENTORY_REPORTER_PATH),
    [],
  )
})

test("disabling the active reporter is rejected even when its filename remains as a comment", () => {
  const withoutReporter = {
    ...playwrightConfig,
    reporter: playwrightConfig.reporter.filter((reporter) => {
      const target = Array.isArray(reporter) ? reporter[0] : reporter
      return target !== EXPECTED_INVENTORY_REPORTER_PATH
    }),
    comment: EXPECTED_INVENTORY_REPORTER_PATH,
  }

  assert.match(
    validateInventoryReporterBinding(withoutReporter, EXPECTED_INVENTORY_REPORTER_PATH).join("\n"),
    /bind the inventory reporter exactly once/,
  )
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
  test(`${file}: no gate can be skipped or ignored; only E2E diagnostics may be conditional`, () => {
    const { workflow } = read()

    for (const [where, node] of jobsAndSteps(workflow)) {
      const allowedDiagnosticUpload =
        file === ".github/workflows/e2e.yaml" &&
        [
          "Upload synthetic E2E diagnostics",
          "Upload UX-REACH diagnostics",
          "Upload Article Intelligence Reader diagnostics",
        ].includes(node.name)
      if (allowedDiagnosticUpload) {
        assert.equal(node.if, "${{ failure() }}", `${where} must upload only after a failure`)
      } else {
        assert.ok(!("if" in node), `${where} must not be conditional`)
      }
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
      if (name === "python") {
        assert.equal(setups.length, 0, "the Python job must not set up Node")
        continue
      }
      assert.equal(setups.length, 1, `job ${name} must set up Node once`)
      const expected = matrix ? "${{ matrix.node-version }}" : "22"
      assert.equal(String(setups[0].with["node-version"]), expected, `job ${name} Node version`)
    }
  })
}
