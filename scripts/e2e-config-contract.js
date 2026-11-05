import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const EXPECTED_INVENTORY_REPORTER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../e2e/reporters/inventory-reporter.js",
)

/** Checks the loaded Playwright config, not source text or comments. */
export const validateInventoryReporterBinding = (
  config,
  expectedReporterPath = EXPECTED_INVENTORY_REPORTER_PATH,
) => {
  if (!config || typeof config !== "object" || !Array.isArray(config.reporter)) {
    return ["effective Playwright config must define a reporter array"]
  }

  if (typeof expectedReporterPath !== "string" || !existsSync(expectedReporterPath)) {
    return ["expected inventory reporter implementation must exist"]
  }

  const expectedRealPath = realpathSync(expectedReporterPath)
  const configuredPaths = config.reporter.flatMap((entry) => {
    const configuredPath = Array.isArray(entry) ? entry[0] : entry
    return typeof configuredPath === "string" ? [configuredPath] : []
  })
  const matchingPaths = configuredPaths.filter((configuredPath) => {
    const resolvedPath = path.resolve(configuredPath)
    return existsSync(resolvedPath) && realpathSync(resolvedPath) === expectedRealPath
  })

  if (matchingPaths.length !== 1) {
    return [
      `effective Playwright config must bind the inventory reporter exactly once, got ${matchingPaths.length}`,
    ]
  }

  return []
}
