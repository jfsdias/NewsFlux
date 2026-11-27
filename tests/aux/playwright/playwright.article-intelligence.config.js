import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

const apiPort = Number(process.env.E2E_API_PORT ?? 8081)
const appPort = Number(process.env.E2E_APP_PORT ?? 4175)
// Playwright resolves relative paths and web server commands against this config's directory.
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

export default defineConfig({
  testDir: path.join(repositoryRoot, "tests/aux/reader-ai-e2e"),
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "line",
  outputDir: path.join(repositoryRoot, "test-results/article-intelligence-reader/"),
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/start-mock-server.js",
      cwd: repositoryRoot,
      url: `http://127.0.0.1:${apiPort}/v1/version`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${appPort} --strictPort`,
      cwd: repositoryRoot,
      url: `http://127.0.0.1:${appPort}/scripts/tests/content-fallback-reader.html?mode=disabled`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
