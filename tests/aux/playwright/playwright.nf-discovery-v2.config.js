import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

 
import base from "../../../playwright.config.js"

// Playwright resolves relative paths and web server commands against this config's directory.
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

export default defineConfig({
  ...base,
  testDir: path.join(repositoryRoot, "tests/aux/synthetic"),
  testMatch: "**/nf-discovery-v2.synthetic.js",
  reporter: [["list"]],
  outputDir: path.join(repositoryRoot, "test-results/nf-discovery-v2"),
  webServer: base.webServer.map((server) => ({ ...server, cwd: repositoryRoot })),
})
