import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import Polyglot from "node-polyglot"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

const root = fileURLToPath(new URL("../", import.meta.url))
const hmrServer = createHttpServer()
const vite = await createServer({
  appType: "custom",
  configFile: false,
  plugins: [react()],
  optimizeDeps: { entries: [], include: [], noDiscovery: true },
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(root, "src") }],
  },
  root,
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
const { default: CodeBlock } = await vite.ssrLoadModule("/src/components/Article/CodeBlock.jsx")
const { polyglotState } = await vite.ssrLoadModule("/src/hooks/useLanguage.js")
const englishPhrases = JSON.parse(
  readFileSync(path.resolve(root, "src/locales/en-US.json"), "utf8"),
)
polyglotState.set({ polyglot: new Polyglot({ locale: "en-US", phrases: englishPhrases }) })

after(async () => {
  await vite.close()
  hmrServer.close()
})

test("code block controls expose accessible state while highlighting is deferred", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CodeBlock,
      {
        inView: false,
        languageHint: "javascript",
      },
      "const value = 1",
    ),
  )

  assert.match(markup, /aria-label="Code language"/)
  assert.match(markup, /aria-label="Disable syntax highlighting"[^>]*aria-pressed="true"/)
  assert.match(markup, /aria-label="Line numbers"[^>]*aria-pressed="true"/)
  assert.match(markup, /aria-label="Code word wrap"[^>]*aria-pressed="false"/)
  assert.match(markup, /aria-label="Copy to clipboard"/)
})

test("plaintext hints suppress highlighting but retain the reader controls", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CodeBlock,
      {
        inView: false,
        languageHint: "plaintext",
      },
      "  literal text  ",
    ),
  )

  assert.match(
    markup,
    /aria-label="Enable syntax highlighting"[^>]*aria-pressed="false"[^>]*disabled/,
  )
  assert.match(markup, /aria-label="Line numbers"/)
  assert.match(markup, /aria-label="Code word wrap"/)
  assert.match(markup, /\u0020{2}literal text\u0020{2}/)
})

test("large hinted blocks start plain and keep the manual highlighting control available", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CodeBlock,
      {
        inView: false,
        languageHint: "javascript",
      },
      "x".repeat(50_001),
    ),
  )

  assert.match(markup, /aria-label="Enable syntax highlighting"[^>]*aria-pressed="false"/)
  assert.match(markup, /aria-label="Line numbers"/)
  assert.match(markup, /aria-label="Code word wrap"/)
})
