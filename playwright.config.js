import process from "node:process"

import { defineConfig } from "@playwright/test"

const apiPort = Number(process.env.E2E_API_PORT ?? 8081)
const appPort = Number(process.env.E2E_APP_PORT ?? 4173)

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  // One worker, no retries: the scenarios share one synthetic backend and retries would hide
  // flakiness. A scenario must pass or fail the same way on every run.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["./e2e/reporters/inventory-reporter.js"]],
  outputDir: process.env.E2E_OUTPUT_DIR ?? "test-results/artifacts",
  use: {
    baseURL: `http://localhost:${appPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/support/start-mock-server.js",
      url: `http://127.0.0.1:${apiPort}/v1/version`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node e2e/support/start-app-server.js",
      url: `http://localhost:${appPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
