import { defineConfig } from "@playwright/test"

// eslint-disable-next-line import/extensions -- Node ESM requires the explicit config extension.
import base from "./playwright.config.js"

export default defineConfig({
  ...base,
  testMatch: "**/nf-0701-feed-health.synthetic.js",
  reporter: [["list"]],
  outputDir: "test-results/nf-0701",
})
