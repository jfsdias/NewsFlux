/* eslint-disable import/no-relative-parent-imports -- Reuse the app's real Vite config for this isolated build fixture. */
import path from "node:path"
import { fileURLToPath } from "node:url"

import { mergeConfig } from "vite"

import baseConfig from "../../vite.config.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default mergeConfig(baseConfig({ mode: "production" }), {
  base: "/pilot-test/",
  build: {
    outDir: process.env.PILOT_HARNESS_BUILD_DIR || "/tmp/newsflux-pilot-reader-harness",
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(root, "scripts/tests/content-fallback-reader.html"),
    },
  },
})
