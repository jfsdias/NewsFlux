import process from "node:process"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

// eslint-disable-next-line import/extensions -- Node ESM requires the exact config filename.
import baseConfig from "./playwright.config.js"

const uxReachReporterPath = fileURLToPath(new URL("ux-reach-e2e/reporter.js", import.meta.url))

export default defineConfig({
  ...baseConfig,
  outputDir: "test-results/ux-reach-01",
  reporter: [["list"], [uxReachReporterPath, { outputDir: "test-results/ux-reach-01" }]],
  testDir: "./ux-reach-e2e",
  testMatch: "**/*.spec.js",
  use: {
    ...baseConfig.use,
    ...(process.env.NEWSFLUX_CHROME_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.NEWSFLUX_CHROME_EXECUTABLE } }
      : {}),
  },
})
