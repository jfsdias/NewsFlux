/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React from "react"
import { createRoot } from "react-dom/client"

import ArticleIntelligence from "@/components/Settings/ArticleIntelligence"
import { polyglotState } from "@/hooks/useLanguage"
import { authState } from "@/store/authState"

// Synthetic NEWSFLUX-AI-SETTINGS-01 harness: real Settings components against the
// real Summary admin API (scripts/pilot-e2e/admin_backend.py). No real credentials.
const parameters = new URLSearchParams(globalThis.location.search)
const role = parameters.get("role") === "reader" ? "reader" : "admin"
const locale = parameters.get("locale") ?? "en-US"
const locales = import.meta.glob("/src/locales/*.json", { eager: true, import: "default" })
const phrases = locales[`/src/locales/${locale}.json`] ?? locales["/src/locales/en-US.json"]

if (parameters.get("theme") === "dark") {
  document.body.setAttribute("arco-theme", "dark")
  document.body.style.background = "#000"
  document.body.style.color = "#fff"
}

polyglotState.setKey("polyglot", new Polyglot({ locale, phrases }))
authState.set({
  server: "https://miniflux.example",
  token: role === "admin" ? "synthetic-admin-miniflux-key" : "synthetic-reader-miniflux-key",
  apiKeyId: 9,
  username: "",
  password: "",
})

const Harness = () => (
  <main className="settings-harness" style={{ maxWidth: 760, margin: "0 auto", padding: 12 }}>
    <ArticleIntelligence />
  </main>
)

createRoot(document.querySelector("#root")).render(<Harness />)
