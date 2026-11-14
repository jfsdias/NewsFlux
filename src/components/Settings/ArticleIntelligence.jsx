import { Button, Checkbox, Radio, Select, Typography } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useState } from "react"

import SettingItem from "./SettingItem"
import SettingSection from "./SettingSection"

import { fetchModelCatalog } from "@/apis/article-intelligence"
import { polyglotState } from "@/hooks/useLanguage"
import { authState } from "@/store/authState"
import { settingsState, updateSettings } from "@/store/settingsState"
import isArticleIntelligenceEnabled from "@/utils/article-intelligence-feature"
import {
  sanitizeSummaryFocus,
  sanitizeSummarySections,
  SUMMARY_FOCUSES,
  SUMMARY_LANGUAGES,
  SUMMARY_LENGTHS,
  SUMMARY_MODEL_AUTO,
  SUMMARY_SECTIONS,
} from "@/utils/article-intelligence-profile"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

import "./ArticleIntelligence.css"

const formatPrice = (polyglot, pricing) => {
  if (pricing.status === "not_verified") {
    return polyglot.t("article_intelligence.price_not_verified")
  }
  return polyglot.t(
    pricing.status === "operator_declared_zero"
      ? "article_intelligence.price_declared_zero"
      : "article_intelligence.price_declared_paid",
    { input: pricing.input_usd_per_million, output: pricing.output_usd_per_million },
  )
}

const ModelDetails = ({ model, polyglot }) => (
  <span className="ai-model-option__details">
    <span>
      {model.provider} ·{" "}
      {model.available
        ? polyglot.t("article_intelligence.model_available")
        : polyglot.t(`article_intelligence.reason_${model.unavailableReason}`)}
    </span>
    <span>{formatPrice(polyglot, model.pricing)}</span>
    {model.limits.max_output_tokens !== null && (
      <span>
        {polyglot.t("article_intelligence.model_limits", {
          input: model.limits.max_input_tokens,
          output: model.limits.max_output_tokens,
          rpm: model.limits.requests_per_minute,
        })}
      </span>
    )}
    {model.notices.includes("ARTICLE_SENT_TO_MODEL_PROVIDER") && (
      <span>{polyglot.t("article_intelligence.notice_article_sent")}</span>
    )}
    {model.requiresPaidAuthorization && (
      <span>{polyglot.t("article_intelligence.notice_paid")}</span>
    )}
  </span>
)

const ArticleIntelligence = () => {
  const { polyglot } = useStore(polyglotState)
  const auth = useStore(authState)
  const authSessionKey = getAuthSessionKey(auth)
  const { aiSummaryFocus, aiSummaryLanguage, aiSummaryLength, aiSummaryModel, aiSummarySections } =
    useStore(settingsState, {
      keys: [
        "aiSummaryFocus",
        "aiSummaryLanguage",
        "aiSummaryLength",
        "aiSummaryModel",
        "aiSummarySections",
      ],
    })
  const [reloadCount, setReloadCount] = useState(0)
  const [loaded, setLoaded] = useState({ key: null, status: "loading", catalog: null })
  const requestKey = `${authSessionKey}:${reloadCount}`

  const enabled = isArticleIntelligenceEnabled() && hasProvisionedApiKey(auth)
  useEffect(() => {
    if (!enabled) {
      return
    }
    const controller = new AbortController()
    const load = async () => {
      let next
      try {
        const catalog = await fetchModelCatalog({ signal: controller.signal })
        next = catalog ? { status: "ready", catalog } : { status: "error", catalog: null }
      } catch {
        next = { status: "error", catalog: null }
      }
      if (!controller.signal.aborted) {
        setLoaded({ key: requestKey, ...next })
      }
    }
    void load()
    return () => controller.abort()
  }, [enabled, requestKey])

  if (!enabled) {
    return null
  }

  const catalogState =
    loaded.key === requestKey ? loaded : { key: requestKey, status: "loading", catalog: null }
  const { catalog } = catalogState
  const defaultModel = catalog?.models.find((model) => model.id === catalog.default_model_id)
  const selectedIsUnavailable =
    catalog &&
    aiSummaryModel !== SUMMARY_MODEL_AUTO &&
    !catalog.models.find((model) => model.id === aiSummaryModel)?.available

  return (
    <SettingSection title={polyglot.t("article_intelligence.settings_section")}>
      <SettingItem
        description={polyglot.t("article_intelligence.model_description")}
        title={polyglot.t("article_intelligence.model_label")}
      >
        {catalogState.status === "loading" && (
          <Typography.Text role="status">
            {polyglot.t("article_intelligence.catalog_loading")}
          </Typography.Text>
        )}
        {catalogState.status === "error" && (
          <div className="ai-model-catalog__error" role="status">
            <Typography.Text type="error">
              {polyglot.t("article_intelligence.catalog_error")}
            </Typography.Text>
            <Button size="small" onClick={() => setReloadCount((count) => count + 1)}>
              {polyglot.t("article_intelligence.retry")}
            </Button>
          </div>
        )}
        {catalog && (
          <Radio.Group
            aria-label={polyglot.t("article_intelligence.model_label")}
            className="ai-model-catalog"
            direction="vertical"
            value={aiSummaryModel}
            onChange={(value) => updateSettings({ aiSummaryModel: value })}
          >
            <Radio disabled={!defaultModel?.available} value={SUMMARY_MODEL_AUTO}>
              <span className="ai-model-option__title">
                {polyglot.t("article_intelligence.model_auto", {
                  model: defaultModel?.label ?? "—",
                })}
              </span>
            </Radio>
            {catalog.models.map((model) => (
              <Radio key={model.id} disabled={!model.available} value={model.id}>
                <span className="ai-model-option__title">{model.label}</span>
                <ModelDetails model={model} polyglot={polyglot} />
              </Radio>
            ))}
          </Radio.Group>
        )}
        {selectedIsUnavailable && (
          <Typography.Text role="status" type="warning">
            {polyglot.t("article_intelligence.model_selection_unavailable")}
          </Typography.Text>
        )}
      </SettingItem>
      <SettingItem
        description={polyglot.t("article_intelligence.length_description")}
        title={polyglot.t("article_intelligence.length_label")}
      >
        <Radio.Group
          aria-label={polyglot.t("article_intelligence.length_label")}
          type="button"
          value={aiSummaryLength}
          onChange={(value) => updateSettings({ aiSummaryLength: value })}
        >
          {SUMMARY_LENGTHS.map((length) => (
            <Radio key={length} value={length}>
              {polyglot.t(`article_intelligence.length_${length}`)}
            </Radio>
          ))}
        </Radio.Group>
      </SettingItem>
      <SettingItem
        description={polyglot.t("article_intelligence.focus_description")}
        title={polyglot.t("article_intelligence.focus_label")}
      >
        <Checkbox.Group
          aria-label={polyglot.t("article_intelligence.focus_label")}
          className="ai-checkbox-list"
          direction="vertical"
          value={aiSummaryFocus}
          onChange={(value) =>
            updateSettings({ aiSummaryFocus: sanitizeSummaryFocus(value, aiSummaryFocus) })
          }
        >
          {SUMMARY_FOCUSES.map((focus) => (
            <Checkbox
              key={focus}
              disabled={aiSummaryFocus.length === 1 && aiSummaryFocus[0] === focus}
              value={focus}
            >
              {polyglot.t(`article_intelligence.focus_${focus}`)}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </SettingItem>
      <SettingItem
        description={polyglot.t("article_intelligence.sections_description")}
        title={polyglot.t("article_intelligence.sections_label")}
      >
        <Checkbox.Group
          aria-label={polyglot.t("article_intelligence.sections_label")}
          className="ai-checkbox-list"
          direction="vertical"
          value={aiSummarySections}
          onChange={(value) =>
            updateSettings({
              aiSummarySections: sanitizeSummarySections(value, aiSummarySections),
            })
          }
        >
          {SUMMARY_SECTIONS.map((section) => (
            <Checkbox key={section} disabled={section === "summary"} value={section}>
              {polyglot.t(`article_intelligence.section_${section}`)}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </SettingItem>
      <SettingItem
        description={polyglot.t("article_intelligence.language_description")}
        title={polyglot.t("article_intelligence.language_label")}
      >
        <Select
          className="input-select"
          value={aiSummaryLanguage}
          onChange={(value) => updateSettings({ aiSummaryLanguage: value })}
        >
          {SUMMARY_LANGUAGES.map((language) => (
            <Select.Option key={language} value={language}>
              {polyglot.t(`article_intelligence.language_${language.replace("-", "_")}`)}
            </Select.Option>
          ))}
        </Select>
      </SettingItem>
    </SettingSection>
  )
}

export default ArticleIntelligence
