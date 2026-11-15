/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
// Settings → Reading → Article intelligence inside the real settings modal (AccessibleModal +
// SettingsTabs + AdaptiveScrollArea), with a synthetic model catalog. Visual/UX gate only.
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

const model = (id, label, changes = {}) => ({
  id,
  label,
  provider: "LiteLLM",
  available: false,
  unavailable_reason: "INFERENCE_DISABLED",
  requires_paid_authorization: false,
  pricing: {
    status: "operator_declared_zero",
    input_usd_per_million: "0",
    output_usd_per_million: "0",
  },
  limits: {
    max_input_tokens: 4096,
    max_output_tokens: 2048,
    requests_per_minute: 5,
    timeout_seconds: 25,
  },
  notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_DECLARED_BY_OPERATOR"],
  ...changes,
})
const catalog = {
  schema_version: "1",
  default_model_id: null,
  profile_version: "summary-profile-v1",
  default_profile: {},
  models: [
    model("s5-free", "S5"),
    model("mistral-small", "Mistral Small", {
      unavailable_reason: "PAID_NOT_AUTHORIZED",
      requires_paid_authorization: true,
      pricing: {
        status: "operator_declared_paid",
        input_usd_per_million: "0.15",
        output_usd_per_million: "0.6",
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_DECLARED_BY_OPERATOR", "PAID_INFERENCE"],
    }),
  ],
}
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, options) =>
  String(url) === "/api/ai/v1/models"
    ? Promise.resolve(Response.json(catalog))
    : nativeFetch(url, options)

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
