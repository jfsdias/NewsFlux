import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: ["pilot.spec.js", "compose.spec.js"],
  workers: 1,
  retries: 0,
  outputDir: process.env.PILOT_PLAYWRIGHT_OUTPUT_DIR || "/artifacts",
  use: {
    baseURL: process.env.PILOT_BASE_URL || "https://newsflux.example",
    browserName: "chromium",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
})
