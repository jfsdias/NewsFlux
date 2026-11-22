import { defineConfig } from "@playwright/test"

// eslint-disable-next-line import/extensions -- Node ESM config import requires the extension.
import baseConfig from "./playwright.config.js"

// Non-inventory visual capture, using the same synthetic app and backend.
export default defineConfig({
  ...baseConfig,
  testDir: "./docs/qa",
  testMatch: "nf-qa01-visual-audit.spec.js",
  reporter: [["list"]],
  outputDir: "test-results/nf-qa01-visual",
})
