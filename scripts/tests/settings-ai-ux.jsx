/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
// Settings → Reading → Article intelligence inside the real settings modal (AccessibleModal +
// SettingsTabs + AdaptiveScrollArea), with a synthetic catalog v2 (dynamic models, primary + optional fallback). Visual/UX gate only:
// the AI controls are exercised as they are, never changed.
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import { useState } from "react"
import { createRoot } from "react-dom/client"

import SettingsTabs from "@/components/Settings/SettingsTabs"
import AccessibleModal from "@/components/ui/AccessibleModal"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { updateSettings } from "@/store/settingsState"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/App.css"
import "@/components/Main/Main.css"

const params = new URLSearchParams(location.search)
const polyglot = new Polyglot({ phrases, locale: "en-US" })
polyglotState.set({ polyglot })
if (params.get("theme") === "dark") {
  document.body.setAttribute("arco-theme", "dark")
}
authState.set({
  server: "https://miniflux.example",
  token: "synthetic-miniflux-key",
  apiKeyId: 9,
  username: "synthetic-user",
  password: "",
})

// Catalog schema v2 (dynamic catalog, #248), shaped like the live server's: two available models
// from different providers (one paid) plus one model still awaiting operator approval.
const checks = (changes = {}) => ({
  discovered: true,
  compatible: true,
  operator_approved: true,
  pricing_verified: true,
  paid_authorized: false,
  transfer_authorized: true,
  ...changes,
})
const model = (id, label, changes = {}) => ({
  id,
  label,
  provider: "LiteLLM",
  status: "AVAILABLE",
  available: true,
  unavailable_reason: null,
  requires_paid_authorization: false,
  checks: checks(),
  pricing: { status: "verified_zero", input_usd_per_million: "0", output_usd_per_million: "0" },
  limits: {
    max_input_tokens: 4096,
    max_output_tokens: 2048,
    requests_per_minute: 5,
    timeout_seconds: 25,
  },
  notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_VERIFIED_BY_GATEWAY"],
  ...changes,
})
const catalog = {
  schema_version: "2",
  default_model_id: "s5-free",
  profile_version: "summary-profile-v1",
  default_profile: {},
  discovery: { status: "OK" },
  policy: { status: "CONFIGURED" },
  models: [
    model("s5-free", "S5"),
    model("mistral-small", "Mistral Small", {
      provider: "Mistral",
      requires_paid_authorization: true,
      checks: checks({ paid_authorized: true }),
      pricing: {
        status: "verified_paid",
        input_usd_per_million: "0.15",
        output_usd_per_million: "0.6",
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_VERIFIED_BY_GATEWAY", "PAID_INFERENCE"],
    }),
    model("gw-synthetic-long-model", "synthetic-long-model-name-from-gateway", {
      status: "OPERATOR_APPROVAL_REQUIRED",
      available: false,
      unavailable_reason: "OPERATOR_APPROVAL_REQUIRED",
      checks: checks({
        operator_approved: false,
        pricing_verified: false,
        transfer_authorized: false,
      }),
      pricing: {
        status: "not_verified",
        input_usd_per_million: null,
        output_usd_per_million: null,
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
    }),
  ],
}
// ?catalog=inert: every model listed but none runnable (LEGACY with inference OFF).
if (params.get("catalog") === "inert") {
  // As served by the API: no runnable default and the legacy policy.
  catalog.default_model_id = null
  catalog.policy = { status: "LEGACY" }
  catalog.models = catalog.models.map((entry) => ({
    ...entry,
    status: "DISABLED",
    available: false,
    unavailable_reason: "INFERENCE_DISABLED",
  }))
}
// ?catalog=d1: D1 key authority, shaped like production — every model the LiteLLM virtual key
// lists (gw-<hash> IDs, gateway-governed cost, no price shown), one still unverified.
if (params.get("catalog") === "d1") {
  const aliases = [
    ["gpt-4o-mini", "openai"],
    ["gpt-4o", "openai"],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", "openrouter"],
    ["mistral-small-latest", "mistral"],
    ["mistral-medium-latest", "mistral"],
    ["claude-haiku", "anthropic"],
    ["gemini-2.5-flash", "gemini"],
    ["gemini-2.5-pro", "gemini"],
    ["llama-3.3-70b", "groq"],
    ["qwen3-32b", "groq"],
    ["deepseek-chat", "deepseek"],
    ["command-r", "cohere"],
    ["grok-3-mini", "xai"],
    ["sonar", "perplexity"],
    ["gemma3-local", "ollama"],
    ["phi4-local", "ollama"],
    ["kimi-k2", "moonshot"],
  ]
  catalog.policy = { status: "KEY_AUTHORITY" }
  catalog.models = aliases.map(([alias, provider], index) =>
    model(`gw-d1${String(index).padStart(9, "0")}`, alias, {
      provider,
      checks: checks({ pricing_verified: false }),
      pricing: {
        status: "gateway_governed",
        input_usd_per_million: null,
        output_usd_per_million: null,
      },
      limits: {
        max_input_tokens: 16_000,
        max_output_tokens: 4096,
        requests_per_minute: 30,
        timeout_seconds: 25,
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
      ...(alias === "kimi-k2"
        ? {
            status: "UNVERIFIED",
            available: false,
            unavailable_reason: "COMPATIBILITY_UNVERIFIED",
            checks: checks({ compatible: null, pricing_verified: false }),
          }
        : {}),
    }),
  )
  catalog.default_model_id = catalog.models[0].id
}
// ?fallback=<id> starts with that fallback enabled; default: fallback off.
// ?primary=<id> sets the saved primary (default S5); it may name a model not in the catalog.
const fallback = params.get("fallback")
const primary = params.get("primary") ?? "s5-free"
updateSettings(
  fallback
    ? {
        aiSummaryModel: primary,
        aiSummaryFallbackEnabled: true,
        aiSummaryFallbackModel: fallback,
      }
    : { aiSummaryModel: primary, aiSummaryFallbackEnabled: false },
)
// Every request the settings page makes, for "no summary / no admin request" assertions.
globalThis.__aiRequests = []
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, options) => {
  if (String(url).startsWith("/api/ai/")) {
    globalThis.__aiRequests.push(String(url))
  }
  return String(url) === "/api/ai/v1/models"
    ? Promise.resolve(Response.json(catalog))
    : nativeFetch(url, options)
}

const Harness = () => {
  const [tab, setTab] = useState("reading")
  return (
    <AccessibleModal
      visible
      className="settings-modal"
      closeLabel="Close settings"
      dialogLabel="Settings"
      footer={null}
      title={null}
      wrapClassName="settings-modal-wrapper"
    >
      <SettingsTabs activeTab={tab} onTabChange={setTab} />
    </AccessibleModal>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
