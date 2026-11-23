import { defineConfig } from "@playwright/test"

// eslint-disable-next-line import/extensions -- Node ESM needs the extension.
import base from "./playwright.config.js"
export default defineConfig({
  ...base,
  testMatch: "**/nf-discovery-v1.synthetic.js",
  reporter: [["list"]],
  outputDir: "test-results/nf-discovery-v1",
})
