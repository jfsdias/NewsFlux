import { defineConfig } from "@playwright/test"

import base from "./playwright.config.js" // eslint-disable-line import/extensions -- Node ESM needs the extension.
export default defineConfig({
  ...base,
  testMatch: "**/nf-discovery-v2.synthetic.js",
  reporter: [["list"]],
  outputDir: "test-results/nf-discovery-v2",
})
