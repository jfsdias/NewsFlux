import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

// eslint-disable-next-line import/no-relative-parent-imports -- E2E validation shares the frozen scenario contract through package imports.
import { EXPECTED_SCENARIOS } from "#e2e/scenario-contract.js"

// eslint-disable-next-line import/no-relative-parent-imports -- verify and explicitly pass the loaded Playwright config used by this executor.
import playwrightConfig, { PLAYWRIGHT_CONFIG_PATH } from "../playwright.config.js"

import {
  EXPECTED_INVENTORY_REPORTER_PATH,
  validateInventoryReporterBinding,
} from "./e2e-config-contract.js"
import { validateInventory } from "./e2e-stability.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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
} = {}) => {
  mkdirSync(outputRoot, { recursive: true })
  const outputDirectory = mkdtempSync(path.join(outputRoot, "run-"))
  const inventoryPath = path.join(outputDirectory, "inventory.json")
  const runId = randomUUID()
  const problems = validateInventoryReporterBinding(config, reporterPath)
  let result
  let spawnError

  if (problems.length === 0) {
    try {
      result = spawnImpl(command, args, {
        cwd,
        stdio: "inherit",
        env: {
          ...baseEnv,
          E2E_INVENTORY_PATH: inventoryPath,
          E2E_RUN_ID: runId,
          E2E_OUTPUT_DIR: path.join(outputDirectory, "artifacts"),
        },
      })
      if (result?.error) {
        spawnError = result.error.message
      }
      if (!result || typeof result !== "object") {
        problems.push("Playwright process invocation returned no result")
      }
    } catch (error) {
      spawnError = error.message
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

  let inventory
  if (problems.length === 0 || existsSync(inventoryPath)) {
    const parsed = parseInventory(inventoryPath)
    inventory = parsed.inventory
    problems.push(...parsed.problems)
  } else if (!existsSync(inventoryPath)) {
    problems.push("current invocation did not produce its inventory artifact")
  }

  if (inventory) {
    const validation = validateInventory(inventory, expectedScenarios, { expectedRunId: runId })
    problems.push(...validation.problems)
  }

  return {
    verified: problems.length === 0,
    runId,
    outputDirectory,
    inventoryPath,
    exitCode,
    signal,
    spawnError,
    inventory,
    problems,
  }
}

export default runVerifiedE2E
