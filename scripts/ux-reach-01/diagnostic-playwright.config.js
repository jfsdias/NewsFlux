import process from "node:process"

import { defineConfig } from "@playwright/test"

// This temporary configuration keeps the forensic case outside the frozen 11-scenario suite.
export default defineConfig({
  testDir: "./r8-d4d-ux-reach-diagnostic",
  testMatch: "**/*.spec.js",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: process.env.R8D4D_DIAGNOSTIC_OUTPUT ?? "test-results/r8-d4d-pen-diagnostic",
  use: {
    baseURL: "http://localhost:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/support/start-mock-server.js",
      url: "http://127.0.0.1:8081/v1/version",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node e2e/support/start-app-server.js",
      url: "http://localhost:4173/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
