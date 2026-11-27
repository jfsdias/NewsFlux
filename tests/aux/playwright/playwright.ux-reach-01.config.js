import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

 
import baseConfig from "../../../playwright.config.js"

// Playwright resolves relative paths and web server commands against this config's directory.
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))
const uxReachReporterPath = path.join(repositoryRoot, "tests/aux/ux-reach-e2e/reporter.js")

export default defineConfig({
  ...baseConfig,
  outputDir: path.join(repositoryRoot, "test-results/ux-reach-01"),
  reporter: [["list"], [uxReachReporterPath, { outputDir: "test-results/ux-reach-01" }]],
  testDir: path.join(repositoryRoot, "tests/aux/ux-reach-e2e"),
  testMatch: "**/*.spec.js",
  webServer: baseConfig.webServer.map((server) => ({ ...server, cwd: repositoryRoot })),
  use: {
    ...baseConfig.use,
    ...(process.env.NEWSFLUX_CHROME_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.NEWSFLUX_CHROME_EXECUTABLE } }
      : {}),
  },
})
