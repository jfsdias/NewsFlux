import process from "node:process"

import { defineConfig } from "@playwright/test"

const apiPort = Number(process.env.E2E_API_PORT ?? 8081)
const appPort = Number(process.env.E2E_APP_PORT ?? 4175)

export default defineConfig({
  testDir: "./reader-ai-e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "line",
  outputDir: "test-results/article-intelligence-reader/",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/start-mock-server.js",
      url: `http://127.0.0.1:${apiPort}/v1/version`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node e2e/support/start-app-server.js",
      url: `http://127.0.0.1:${appPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
