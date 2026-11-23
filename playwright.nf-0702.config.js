import { defineConfig } from "@playwright/test"

// eslint-disable-next-line import/extensions -- Node ESM requires the explicit config extension.
import base from "./playwright.config.js"

export default defineConfig({
  ...base,
  testMatch: "**/nf-0702-source-review.synthetic.js",
  reporter: [["list"]],
  outputDir: "test-results/nf-0702",
})
