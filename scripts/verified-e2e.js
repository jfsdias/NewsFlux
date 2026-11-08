import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

// eslint-disable-next-line import/no-relative-parent-imports -- E2E validation shares the frozen scenario contract through package imports.
import { EXPECTED_SCENARIOS } from "#e2e/scenario-contract.js"

// eslint-disable-next-line import/no-relative-parent-imports -- verify and explicitly pass the loaded Playwright config used by this executor.
import playwrightConfig, { PLAYWRIGHT_CONFIG_PATH } from "../playwright.config.js"

import {
  EXPECTED_INVENTORY_REPORTER_PATH,
  validateInventoryReporterBinding,
} from "./e2e-config-contract.js"
import {
  resolveBuildDirectory,
  sanitizeE2EDiagnostic,
  SERVER_PROVENANCE_FILENAME,
  verifyBuildProvenance,
  verifyServerProvenance,
} from "./e2e-provenance.js"
import { validateInventory } from "./e2e-stability.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const collectRuntimeMetadata = ({ cwd, command = "pnpm" } = {}) => {
  const require = createRequire(import.meta.url)
  const playwrightPackagePath = require.resolve("@playwright/test/package.json")
  const playwrightVersion = JSON.parse(readFileSync(playwrightPackagePath, "utf8")).version
  const pnpmResult = spawnSync(command, ["--version"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  })
  const chromiumPath = chromium.executablePath()
  const chromiumResult = spawnSync(chromiumPath, ["--version"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  })

  return {
    nodeVersion: process.version,
    pnpmVersion: pnpmResult?.status === 0 ? pnpmResult.stdout.trim() : null,
    playwrightVersion,
    chromiumVersionOrRevision: chromiumResult?.status === 0 ? chromiumResult.stdout.trim() : null,
    platform: process.platform,
  }
}

const parseInventory = (inventoryPath) => {
  if (!existsSync(inventoryPath)) {
    return {
      inventory: undefined,
      problems: ["current invocation did not produce its inventory artifact"],
    }
  }

  try {
    return { inventory: JSON.parse(readFileSync(inventoryPath, "utf8")), problems: [] }
  } catch (error) {
    return {
      inventory: undefined,
      problems: [`current invocation inventory is not valid JSON: ${error.message}`],
    }
  }
}

/** Runs Playwright once and accepts only its fresh, invocation-correlated contract receipt. */
const runVerifiedE2E = ({
  cwd = repositoryRoot,
  outputRoot = path.join(cwd, "test-results", "verified-e2e"),
  expectedScenarios = EXPECTED_SCENARIOS,
  spawnImpl = spawnSync,
  command = "pnpm",
  args = ["exec", "playwright", "test", "--config", PLAYWRIGHT_CONFIG_PATH],
  baseEnv = process.env,
  config = playwrightConfig,
  reporterPath = EXPECTED_INVENTORY_REPORTER_PATH,
  runtimeMetadataImpl = collectRuntimeMetadata,
} = {}) => {
  mkdirSync(outputRoot, { recursive: true })
  const outputDirectory = mkdtempSync(path.join(outputRoot, "run-"))
  const inventoryPath = path.join(outputDirectory, "inventory.json")
  const serverProvenancePath = path.join(outputDirectory, SERVER_PROVENANCE_FILENAME)
  const summaryPath = path.join(outputDirectory, "summary.json")
  const runId = randomUUID()
  const buildDirectory = resolveBuildDirectory(cwd, baseEnv.E2E_BUILD_DIR)
  const problems = validateInventoryReporterBinding(config, reporterPath)
  const preflight = verifyBuildProvenance({ cwd, buildDir: buildDirectory })
  problems.push(...preflight.problems.map((problem) => `provenance preflight: ${problem}`))
  const provenanceProblems = [...preflight.problems]
  let runtimeMetadata
  if (preflight.valid) {
    try {
      runtimeMetadata = runtimeMetadataImpl({ cwd, command })
    } catch (error) {
      const problem = `runtime metadata could not be collected: ${sanitizeE2EDiagnostic(error.message)}`
      problems.push(problem)
      provenanceProblems.push(problem)
    }
    for (const field of [
      "nodeVersion",
      "pnpmVersion",
      "playwrightVersion",
      "chromiumVersionOrRevision",
      "platform",
    ]) {
      if (typeof runtimeMetadata?.[field] !== "string" || runtimeMetadata[field].trim() === "") {
        const problem = `runtime metadata is missing ${field}`
        problems.push(problem)
        provenanceProblems.push(problem)
      }
    }
  }
  let result
  let spawnError
  let playwrightStarted = false

  if (problems.length === 0) {
    try {
      playwrightStarted = true
      result = spawnImpl(command, args, {
        cwd,
        stdio: "inherit",
        env: {
          ...baseEnv,
          E2E_BUILD_DIR: buildDirectory,
          E2E_INVENTORY_PATH: inventoryPath,
          E2E_RUN_ID: runId,
          E2E_OUTPUT_DIR: path.join(outputDirectory, "artifacts"),
          E2E_SERVER_PROVENANCE_PATH: serverProvenancePath,
          E2E_EXPECTED_BUILD_SOURCE_SHA: preflight.provenance.sourceSha,
          E2E_EXPECTED_BUILD_INTEGRITY_DIGEST: preflight.provenance.buildIntegrityDigest,
          E2E_EXPECTED_BUILD_FILE_COUNT: String(preflight.provenance.buildFileCount),
          NEWSFLUX_E2E_PROVENANCE_REQUIRED: "1",
        },
      })
      if (result?.error) {
        spawnError = sanitizeE2EDiagnostic(result.error.message)
      }
      if (!result || typeof result !== "object") {
        problems.push("Playwright process invocation returned no result")
      }
    } catch (error) {
      spawnError = sanitizeE2EDiagnostic(error.message)
    }
  }

  if (spawnError) {
    problems.push(`Playwright process spawn failed: ${spawnError}`)
  }
  const exitCode = result?.status ?? null
  const signal = result?.signal ?? null
  if (problems.length === 0 && exitCode !== 0) {
    problems.push(`Playwright process must exit with code zero, got ${String(exitCode)}`)
  }
  if (signal !== null) {
    problems.push(`Playwright process ended by signal ${signal}`)
  }

  let finalBuildValidation
  let serverValidation
  if (playwrightStarted) {
    finalBuildValidation = verifyBuildProvenance({ cwd, buildDir: buildDirectory })
    const postflightProblems = finalBuildValidation.problems.map(
      (problem) => `provenance postflight: ${problem}`,
    )
    problems.push(...postflightProblems)
    provenanceProblems.push(...postflightProblems)
    if (
      finalBuildValidation.provenance?.sourceSha !== preflight.provenance?.sourceSha ||
      finalBuildValidation.provenance?.buildIntegrityDigest !==
        preflight.provenance?.buildIntegrityDigest ||
      finalBuildValidation.provenance?.buildFileCount !== preflight.provenance?.buildFileCount
    ) {
      const problem = "Build provenance changed while the E2E invocation was running"
      problems.push(problem)
      provenanceProblems.push(problem)
    }
    serverValidation = verifyServerProvenance({
      serverReceiptPath: serverProvenancePath,
      runId,
      provenance: preflight.provenance,
    })
    problems.push(...serverValidation.problems)
    provenanceProblems.push(...serverValidation.problems)
  }

  let inventory
  if (playwrightStarted && (problems.length === 0 || existsSync(inventoryPath))) {
    const parsed = parseInventory(inventoryPath)
    inventory = parsed.inventory
    problems.push(...parsed.problems)
  } else if (playwrightStarted && !existsSync(inventoryPath)) {
    problems.push("current invocation did not produce its inventory artifact")
  }

  if (inventory) {
    const validation = validateInventory(inventory, expectedScenarios, { expectedRunId: runId })
    problems.push(...validation.problems)
  }

  const provenance = {
    gate:
      preflight.valid &&
      runtimeMetadata !== undefined &&
      playwrightStarted &&
      finalBuildValidation?.valid === true &&
      serverValidation?.valid === true
        ? "PASS"
        : "FAIL",
    runId,
    sourceSha: preflight.sourceSnapshot?.sha ?? null,
    sourceTreeSha: preflight.sourceSnapshot?.treeSha ?? null,
    sourceDirtyStateBefore: preflight.sourceSnapshot?.dirtyState ?? null,
    sourceDirtyPathCountBefore: preflight.sourceSnapshot?.dirtyPathCount ?? null,
    sourceDirtyStateAfter:
      finalBuildValidation?.sourceSnapshot?.dirtyState ??
      preflight.sourceSnapshot?.dirtyState ??
      null,
    testSourceSha: preflight.sourceSnapshot?.sha ?? null,
    testSourceDirtyState: preflight.sourceSnapshot?.dirtyState ?? null,
    buildSourceSha: preflight.provenance?.sourceSha ?? null,
    buildSourceDirtyState: preflight.provenance?.sourceDirtyState ?? null,
    buildIntegrityDigest: preflight.provenance?.buildIntegrityDigest ?? null,
    buildFileCount: preflight.provenance?.buildFileCount ?? null,
    runtime: runtimeMetadata ?? null,
    appServer: serverValidation?.receipt ?? null,
    blockReasons: provenanceProblems.map((problem) => sanitizeE2EDiagnostic(problem)),
  }

  const summary = {
    version: 2,
    runId,
    exitCode,
    signal,
    verified: problems.length === 0,
    provenance,
    artifacts: {
      inventory: "inventory.json",
      serverProvenance: SERVER_PROVENANCE_FILENAME,
      playwrightOutput: "artifacts/",
    },
    counts: inventory?.counts ?? null,
    validationErrors: [
      ...problems,
      ...(Array.isArray(inventory?.contractProblems) ? inventory.contractProblems : []),
      ...(Array.isArray(inventory?.scenarios)
        ? inventory.scenarios
            .filter(
              ({ state, note }) => state === "FAILED" && typeof note === "string" && note !== "",
            )
            .map(({ id, note }) => `${id}: ${note}`)
        : []),
    ].map((problem) => sanitizeE2EDiagnostic(problem).slice(0, 2000)),
    scenarios: Array.isArray(inventory?.scenarios)
      ? inventory.scenarios.map(({ id, state, durationMs }) => ({ id, state, durationMs }))
      : [],
  }
  try {
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  } catch (error) {
    console.error(`Could not write sanitized E2E summary: ${sanitizeE2EDiagnostic(error.message)}`)
  }

  return {
    verified: problems.length === 0,
    runId,
    outputDirectory,
    inventoryPath,
    summaryPath,
    exitCode,
    signal,
    spawnError,
    inventory,
    provenance,
    problems,
  }
}

export { collectRuntimeMetadata }
export default runVerifiedE2E
