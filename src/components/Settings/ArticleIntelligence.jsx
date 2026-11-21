import { Button, Checkbox, Radio, Select, Switch, Typography } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"

import LiteLlmAdminSettings from "./LiteLlmAdminSettings"
import LiteLlmPolicyMigration from "./LiteLlmPolicyMigration"
import ModelCombobox from "./ModelCombobox"
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
import { automaticSummaryChoice, automaticSummaryEnabled } from "@/utils/article-summary-consent"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"
import { buildFallbackModelOptions, buildPrimaryModelOptions } from "@/utils/summary-model-options"
import {
  describeFallbackPreference,
  describePrimaryPreference,
} from "@/utils/summary-model-preference"

import "./ArticleIntelligence.css"

const LANGUAGE_REFOCUS_WINDOW_MS = 600

// Closed mapping from catalog price states to messages; unknown states never show a price.
const PRICE_MESSAGES = {
  verified_zero: "article_intelligence.price_verified_zero",
  verified_paid: "article_intelligence.price_verified_paid",
  operator_declared_zero: "article_intelligence.price_declared_zero",
  operator_declared_paid: "article_intelligence.price_declared_paid",
  gateway_published_only: "article_intelligence.price_gateway_only",
}

const formatPrice = (polyglot, pricing) => {
  if (pricing.status === "mismatch") {
    return polyglot.t("article_intelligence.price_mismatch")
  }
  const key = PRICE_MESSAGES[pricing.status]
  if (!key || pricing.input_usd_per_million === null || pricing.output_usd_per_million === null) {
    return polyglot.t("article_intelligence.price_not_verified")
  }
  return polyglot.t(key, {
    input: pricing.input_usd_per_million,
    output: pricing.output_usd_per_million,
  })
}

const availabilityLine = (polyglot, model) =>
  `${model.provider} · ${
    model.available
      ? polyglot.t("article_intelligence.model_available")
      : polyglot.t(`article_intelligence.reason_${model.unavailableReason}`)
  }`

const optionLabel = (polyglot, option) => {
  switch (option.type) {
    case "auto": {
      return polyglot.t("article_intelligence.model_auto", { model: option.model?.label ?? "—" })
    }
    case "none": {
      return polyglot.t("article_intelligence.fallback_none")
    }
    case "missing": {
      return polyglot.t("article_intelligence.preference_saved_missing", { model: option.value })
    }
    default: {
      return option.model.label
    }
  }
}

const ModelDetails = ({ model, polyglot, showId = false }) => (
  <span className="ai-model-option__details">
    <span>
      {availabilityLine(polyglot, model)}
      {showId ? ` · ${model.id}` : ""}
    </span>
    {model.pricing.status !== "gateway_governed" && (
      <span>{formatPrice(polyglot, model.pricing)}</span>
    )}
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
  const {
    aiSummaryAutoOnOpen,
    aiSummaryAutoConsent,
    aiSummaryFallbackAllowCrossProvider,
    aiSummaryFallbackAllowPaid,
    aiSummaryFallbackEnabled,
    aiSummaryFallbackModel,
    aiSummaryFocus,
    aiSummaryLanguage,
    aiSummaryLength,
    aiSummaryModel,
    aiSummarySections,
  } = useStore(settingsState, {
    keys: [
      "aiSummaryAutoOnOpen",
      "aiSummaryAutoConsent",
      "aiSummaryFallbackAllowCrossProvider",
      "aiSummaryFallbackAllowPaid",
      "aiSummaryFallbackEnabled",
      "aiSummaryFallbackModel",
      "aiSummaryFocus",
      "aiSummaryLanguage",
      "aiSummaryLength",
      "aiSummaryModel",
      "aiSummarySections",
    ],
  })
  const [reloadCount, setReloadCount] = useState(0)
  // Bumped after a policy migration so the admin panels re-read the new revision.
  const [adminGeneration, setAdminGeneration] = useState(0)
  const languageSelectRef = useRef(null)
  const languageClosedAtRef = useRef(Number.NEGATIVE_INFINITY)
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
  const primaryId =
    aiSummaryModel === SUMMARY_MODEL_AUTO ? catalog?.default_model_id : aiSummaryModel
  const primaryEntry = catalog?.models.find((model) => model.id === primaryId)
  const fallbackEntry = catalog?.models.find((model) => model.id === aiSummaryFallbackModel)
  // Saved preferences are kept as they are and described; only the server decides what runs.
  const primaryPreference = describePrimaryPreference(aiSummaryModel, catalog)
  const fallbackPreference = describeFallbackPreference(
    { aiSummaryModel, aiSummaryFallbackEnabled, aiSummaryFallbackModel },
    catalog,
  )
  const withTexts = (option) => ({
    ...option,
    label: optionLabel(polyglot, option),
    // Two entries with the same name are different models to the server: show their IDs.
    description:
      option.type === "model"
        ? `${availabilityLine(polyglot, option.model)}${option.sameLabel ? ` · ${option.value}` : ""}`
        : null,
  })
  const primaryOptions = buildPrimaryModelOptions(catalog, aiSummaryModel).map((option) =>
    withTexts(option),
  )
  const fallbackOptions = buildFallbackModelOptions(catalog, primaryId, aiSummaryFallbackModel).map(
    (option) => withTexts(option),
  )
  // Provider, availability, price, limits and notices: for the chosen model only.
  const primaryDetails = primaryEntry ? (
    <ModelDetails
      model={primaryEntry}
      polyglot={polyglot}
      showId={primaryOptions.some((option) => option.value === primaryEntry.id && option.sameLabel)}
    />
  ) : null
  const fallbackDetails =
    fallbackEntry && fallbackEntry.id !== primaryId ? (
      <ModelDetails
        model={fallbackEntry}
        polyglot={polyglot}
        showId={fallbackOptions.some(
          (option) => option.value === fallbackEntry.id && option.sameLabel,
        )}
      />
    ) : null
  const adminKey = `${authSessionKey}:${adminGeneration}`

  return (
    <>
      <LiteLlmPolicyMigration
        key={`migration:${adminKey}`}
        onMigrated={() => {
          setAdminGeneration((count) => count + 1)
          setReloadCount((count) => count + 1)
        }}
      />
      <LiteLlmAdminSettings
        key={adminKey}
        onPolicyChanged={() => setReloadCount((count) => count + 1)}
      />
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
            <ModelCombobox
              details={primaryDetails}
              label={polyglot.t("article_intelligence.model_label")}
              noResults={polyglot.t("article_intelligence.model_search_no_results")}
              options={primaryOptions}
              placeholder={polyglot.t("article_intelligence.litellm_search")}
              value={aiSummaryModel}
              onChange={(value) => updateSettings({ aiSummaryModel: value })}
            />
          )}
          {(primaryPreference.state === "saved_unavailable" ||
            primaryPreference.state === "saved_missing") && (
            <Typography.Text className="ai-preference-status" role="status" type="warning">
              {polyglot.t("article_intelligence.model_selection_unavailable")}{" "}
              {polyglot.t("article_intelligence.preference_inert")}
            </Typography.Text>
          )}
        </SettingItem>
        <SettingItem
          description={polyglot.t("article_intelligence.auto_on_open_description")}
          title={polyglot.t("article_intelligence.auto_on_open_label")}
        >
          <Switch
            aria-label={polyglot.t("article_intelligence.auto_on_open_label")}
            checked={automaticSummaryEnabled({ aiSummaryAutoOnOpen, aiSummaryAutoConsent })}
            onChange={(value) => updateSettings(automaticSummaryChoice(value))}
          />
        </SettingItem>
        {catalog && (
          <SettingItem
            description={polyglot.t("article_intelligence.fallback_description")}
            title={polyglot.t("article_intelligence.fallback_label")}
          >
            <div className="ai-fallback-control">
              <Switch
                aria-label={polyglot.t("article_intelligence.fallback_label")}
                checked={aiSummaryFallbackEnabled}
                onChange={(value) => updateSettings({ aiSummaryFallbackEnabled: value })}
              />
              {aiSummaryFallbackEnabled && (
                <>
                  <ModelCombobox
                    details={fallbackDetails}
                    label={polyglot.t("article_intelligence.fallback_label")}
                    noResults={polyglot.t("article_intelligence.model_search_no_results")}
                    options={fallbackOptions}
                    placeholder={polyglot.t("article_intelligence.litellm_search")}
                    value={aiSummaryFallbackModel}
                    onChange={(value) => updateSettings({ aiSummaryFallbackModel: value })}
                  />
                  {fallbackEntry?.requiresPaidAuthorization && (
                    <Checkbox
                      checked={aiSummaryFallbackAllowPaid}
                      className="ai-fallback-consent"
                      onChange={(value) => updateSettings({ aiSummaryFallbackAllowPaid: value })}
                    >
                      {polyglot.t("article_intelligence.fallback_allow_paid")}
                    </Checkbox>
                  )}
                  {fallbackEntry &&
                    primaryEntry &&
                    fallbackEntry.provider !== primaryEntry.provider && (
                      <Checkbox
                        checked={aiSummaryFallbackAllowCrossProvider}
                        className="ai-fallback-consent"
                        onChange={(value) =>
                          updateSettings({ aiSummaryFallbackAllowCrossProvider: value })
                        }
                      >
                        {polyglot.t("article_intelligence.fallback_allow_cross_provider", {
                          primary: primaryEntry.provider,
                          fallback: fallbackEntry.provider,
                        })}
                      </Checkbox>
                    )}
                  {(fallbackPreference.state === "saved_unavailable" ||
                    fallbackPreference.state === "saved_missing") && (
                    <Typography.Text className="ai-preference-status" role="status" type="warning">
                      {polyglot.t("article_intelligence.fallback_selection_unavailable")}{" "}
                      {polyglot.t("article_intelligence.preference_inert")}
                    </Typography.Text>
                  )}
                  {fallbackPreference.state === "same_as_primary" && (
                    <Typography.Text className="ai-preference-status" role="status" type="warning">
                      {polyglot.t("article_intelligence.fallback_same_as_primary")}
                    </Typography.Text>
                  )}
                  {fallbackPreference.state === "saved_waiting_for_primary" && (
                    <Typography.Text
                      className="ai-preference-status"
                      role="status"
                      type="secondary"
                    >
                      {polyglot.t("article_intelligence.fallback_waiting_for_primary")}
                    </Typography.Text>
                  )}
                  <Typography.Text className="ai-preference-status" type="secondary">
                    {polyglot.t("article_intelligence.preference_note")}
                  </Typography.Text>
                </>
              )}
            </div>
          </SettingItem>
        )}
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
          {/*
          The list is rendered in <body>, like the sidebar and footer pickers: the settings modal
          and its scroll area clip overflowing children, which cut it at the modal's bottom edge.
          Arco blurs the select when its list closes; if that happens right after closing and
          focus went nowhere, focus returns to the select so keyboard users are not dropped on
          <body> inside the open modal.
        */}
          <Select
            ref={languageSelectRef}
            className="input-select ai-language-select"
            getPopupContainer={() => document.body}
            value={aiSummaryLanguage}
            triggerProps={{
              autoAlignPopupWidth: false,
              autoAlignPopupMinWidth: true,
              className: "ai-language-select-popup",
            }}
            onChange={(value) => updateSettings({ aiSummaryLanguage: value })}
            onBlur={(event) => {
              if (
                !event.relatedTarget &&
                performance.now() - languageClosedAtRef.current < LANGUAGE_REFOCUS_WINDOW_MS
              ) {
                globalThis.setTimeout(() => {
                  if (document.activeElement === document.body) {
                    languageSelectRef.current?.focus()
                  }
                }, 0)
              }
            }}
            onVisibleChange={(visible) => {
              if (!visible) {
                languageClosedAtRef.current = performance.now()
              }
            }}
          >
            {SUMMARY_LANGUAGES.map((language) => (
              <Select.Option key={language} value={language}>
                {polyglot.t(`article_intelligence.language_${language.replace("-", "_")}`)}
              </Select.Option>
            ))}
          </Select>
        </SettingItem>
      </SettingSection>
    </>
  )
}

export default ArticleIntelligence
