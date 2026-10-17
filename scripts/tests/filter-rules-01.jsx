/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
/* eslint-disable react-hooks/immutability, react-compiler/react-compiler -- Harness exposes state for browser automation. */
/* eslint-disable unicorn/prefer-global-this -- Browser-runner globals are part of the harness contract. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider, Form, Message } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { updateFeed } from "@/apis/feeds"
import apiClient from "@/apis/ofetch"
import EditFeedModal from "@/components/ui/EditFeedModal"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { commitCatalogData, commitIdentityData, dataState, resetData } from "@/store/dataState"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "./filter-rules-01.css"

const category = { id: 701, title: "Article filter fixture", hide_globally: false }
const startingFeed = {
  id: 701,
  title: "Filter rules fixture",
  category,
  site_url: "https://example.invalid",
  feed_url: "https://example.invalid/feed.xml",
  hide_globally: false,
  disabled: false,
  crawler: false,
  parsing_error_count: 2,
  parsing_error_message: "Provider error before filter save",
  blocklist_rules: String.raw`  ^old\.advertisement$  `,
  keeplist_rules: "^news$",
  block_filter_entry_rules: [{ type: "title", pattern: "advanced-preserved" }],
  keep_filter_entry_rules: [{ type: "title", pattern: "advanced-preserved" }],
}
const selectedFeedFixture = {
  ...startingFeed,
  key: startingFeed.id,
  hidden: startingFeed.hide_globally,
}

const fixture = {
  mode: "success",
  feed: { ...startingFeed },
  calls: [],
  messages: [],
}

const cloneFeed = (feed = fixture.feed) => ({ ...feed, category: { ...feed.category } })

const restoreFixture = () => {
  resetData()
  commitIdentityData({ id: 1, username: "filter-rules-fixture" })
  fixture.feed = cloneFeed(startingFeed)
  commitCatalogData({ feedsData: [cloneFeed()], categoriesData: [category] })
  fixture.mode = "success"
  fixture.calls = []
  fixture.messages = []
}

restoreFixture()
authState.set({
  server: "https://example.invalid",
  token: "fixture-token",
  username: "fixture",
  password: "",
})
polyglotState.set({ polyglot: new Polyglot({ phrases: englishPhrases, locale: "en-US" }) })

const updateFixtureFeed = (body) => {
  fixture.feed = {
    ...fixture.feed,
    category,
    ...body,
    parsing_error_count: 0,
    parsing_error_message: "",
  }
  return cloneFeed()
}

apiClient.put = async (...args) => {
  fixture.calls.push({ method: "put", args })
  const [url, body] = args
  if (url !== "/v1/feeds/701") {
    throw new Error(`Unexpected fixture API path: ${url}`)
  }

  if (fixture.mode === "stale-session") {
    resetData()
    return { ...cloneFeed(), ...body, parsing_error_count: 0, parsing_error_message: "" }
  }
  if (fixture.mode === "stale-reconciliation") {
    throw new Error("Network response was lost after the provider may have applied the update")
  }
  if (fixture.mode === "invalid-rule") {
    const error = new Error("Miniflux rejected the filter expression")
    error.status = 400
    throw error
  }
  if (fixture.mode === "missing-feed") {
    const error = new Error("Feed no longer exists")
    error.status = 404
    throw error
  }
  if (fixture.mode === "request-failure" || fixture.mode === "ambiguous-unapplied") {
    throw new Error("Network request failed")
  }

  if (fixture.mode === "provider-mismatch") {
    const providerFeed = updateFixtureFeed(body)
    fixture.feed = { ...providerFeed, blocklist_rules: "provider-canonical-value" }
    return cloneFeed()
  }

  const providerFeed = updateFixtureFeed(body)
  if (fixture.mode === "ambiguous-applied") {
    throw new Error("Network response was lost after the provider applied the update")
  }
  return providerFeed
}

apiClient.get = async (...args) => {
  fixture.calls.push({ method: "get", args })
  const [url] = args
  if (url === "/v1/feeds/701") {
    if (fixture.mode === "stale-reconciliation") {
      resetData()
      return cloneFeed()
    }
    return cloneFeed()
  }
  if (url === "/v1/feeds") {
    return fixture.mode === "missing-feed" ? [] : [cloneFeed()]
  }
  throw new Error(`Unexpected fixture API path: ${url}`)
}

for (const method of ["post", "delete"]) {
  apiClient[method] = async (...args) => {
    fixture.calls.push({ method, args })
    throw new Error(`Unexpected fixture API request: ${method}`)
  }
}

const originalMessageSuccess = Message.success.bind(Message)
Message.success = (...args) => {
  fixture.messages.push({ type: "success", args })
  return originalMessageSuccess(...args)
}

apiClient.raw = async (...args) => {
  fixture.calls.push({ method: "raw", args })
  throw new Error(`Unexpected fixture raw request: ${args[0]}`)
}

const waitFor = async (predicate, description) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 100))
const dialog = () => document.querySelector('[role="dialog"]')
const input = (testId) => dialog()?.querySelector(`[data-testid="${CSS.escape(testId)}"]`)
const setInputValue = (element, value) => {
  if (!element) {
    throw new Error("Expected editor field is not present")
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
  setter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}
const saveButton = () => document.querySelector(".edit-modal .arco-modal-footer .arco-btn-primary")
const cancelButton = () =>
  document.querySelector(".edit-modal .arco-modal-footer .arco-btn-secondary")
const gate = async (results, name, check) => {
  try {
    const detail = await check()
    results.push({ name, status: "PASS", ...(detail === undefined ? {} : { detail }) })
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error.message })
  }
}

const Harness = () => {
  const [feedForm] = Form.useForm()
  const [visible, setVisible] = useState(false)
  const [modalKey, setModalKey] = useState(0)
  const [summary, setSummary] = useState("Ready")
  const [results, setResults] = useState([])

  useEffect(() => {
    feedForm.setFieldsValue({
      categoryId: category.id,
      title: startingFeed.title,
      siteUrl: startingFeed.site_url,
      feedUrl: startingFeed.feed_url,
      hidden: startingFeed.hide_globally,
      disabled: startingFeed.disabled,
      crawler: startingFeed.crawler,
      blocklistRules: startingFeed.blocklist_rules,
      keeplistRules: startingFeed.keeplist_rules,
    })
  }, [feedForm])

  const open = async (mode = "success") => {
    setVisible(false)
    setModalKey((key) => key + 1)
    await tick()
    fixture.mode = mode
    document.querySelector('[data-testid="filter-rules-focus-fallback"]')?.focus()
    fixture.calls = []
    restoreFixture()
    fixture.mode = mode
    feedForm.setFieldsValue({
      categoryId: category.id,
      title: startingFeed.title,
      siteUrl: startingFeed.site_url,
      feedUrl: startingFeed.feed_url,
      hidden: startingFeed.hide_globally,
      disabled: startingFeed.disabled,
      crawler: startingFeed.crawler,
      blocklistRules: startingFeed.blocklist_rules,
      keeplistRules: startingFeed.keeplist_rules,
    })
    setVisible(true)
    await waitFor(() => dialog(), "edit feed dialog")
    await tick()
  }

  const closeCleanly = async () => {
    setVisible(false)
    await waitFor(() => !dialog(), "edit feed dialog to close")
    await tick()
  }

  const runSuite = async () => {
    const runResults = []
    setSummary("RUNNING")
    setResults([])

    await gate(runResults, "ARTICLE_FILTER_FIELDS_PRESENT", async () => {
      await open()
      if (!input("blocklist-rules-input") || !input("keeplist-rules-input")) {
        throw new Error("The blocklist and keeplist editors are not both rendered")
      }
      await closeCleanly()
    })

    await gate(runResults, "LEGACY_FEED_EDIT_WITHOUT_RULE_FIELDS", async () => {
      const request = await updateFeed(701, { title: "Legacy caller" })
      const payload = fixture.calls.at(-1)?.args?.[1]
      if (!request || Object.hasOwn(payload ?? {}, "blocklist_rules")) {
        throw new Error("Legacy update sent a blocklist default")
      }
      if (Object.hasOwn(payload ?? {}, "keeplist_rules")) {
        throw new Error("Legacy update sent a keeplist default")
      }
    })

    await gate(runResults, "FEED_ERROR_RESET_DISCLOSURE", async () => {
      await open()
      if (dialog()?.querySelector('[data-testid="feed-error-reset-warning"]')) {
        throw new Error("Feed error reset warning appeared before filtering rules became dirty")
      }
      setInputValue(input("blocklist-rules-input"), "^changed$ ")
      await tick()
      const disclosure = dialog()?.querySelector('[data-testid="feed-error-reset-warning"]')
      if (!disclosure) {
        throw new Error("Editing rules on an errored provider feed has no reset disclosure")
      }
      if (/feed fixed|feed healthy|refresh successful/i.test(disclosure.textContent)) {
        throw new Error("Disclosure makes a false feed-health claim")
      }
      await closeCleanly()
    })

    await gate(runResults, "BOTH_RULES_WARNING", async () => {
      await open()
      const warning = dialog()?.querySelector('[role="note"]')
      if (!warning || !/applied first|first/i.test(warning.textContent)) {
        throw new Error("Both non-empty rules do not explain their application order")
      }
      await closeCleanly()
    })

    await gate(runResults, "RAW_RULE_ROUND_TRIP_EXACT", async () => {
      await open()
      const rawValue = "  ^https://example\\.invalid/[a-z]+$\n  keep bytes  "
      setInputValue(input("blocklist-rules-input"), rawValue)
      await tick()
      saveButton()?.click()
      await waitFor(() => fixture.calls.length > 0, "filter update request")
      const request = fixture.calls.find((call) => call.method === "put")
      if (request?.args?.[1]?.blocklist_rules !== rawValue) {
        throw new Error("The raw blocklist value changed or was omitted in the provider payload")
      }
      if (Object.hasOwn(request?.args?.[1] ?? {}, "keeplist_rules")) {
        throw new Error("Unchanged keeplist rule was sent as an implicit default")
      }
      await waitFor(() => !dialog(), "successful save to close the dialog")
      if (!fixture.messages.some((message) => message.args.includes("Filtering rules saved"))) {
        throw new Error("Rule save did not use the dedicated success copy")
      }
    })

    await gate(runResults, "KEEP_ONLY_SAVE", async () => {
      await open()
      const rawValue = "  ^keep-this-only$  "
      setInputValue(input("keeplist-rules-input"), rawValue)
      await tick()
      saveButton()?.click()
      await waitFor(() => fixture.calls.some((call) => call.method === "put"), "keeplist update")
      const payload = fixture.calls.find((call) => call.method === "put")?.args?.[1]
      if (payload?.keeplist_rules !== rawValue || Object.hasOwn(payload, "blocklist_rules")) {
        throw new Error("Keep-only save changed its raw value or sent an unchanged blocklist")
      }
      await waitFor(() => !dialog(), "keep-only save to close")
    })

    await gate(runResults, "BOTH_RULES_SAVE", async () => {
      await open()
      const blocklistValue = "  ^blocked$  "
      const keeplistValue = "  ^kept$  "
      setInputValue(input("blocklist-rules-input"), blocklistValue)
      setInputValue(input("keeplist-rules-input"), keeplistValue)
      await tick()
      saveButton()?.click()
      await waitFor(() => fixture.calls.some((call) => call.method === "put"), "both-rule update")
      const payload = fixture.calls.find((call) => call.method === "put")?.args?.[1]
      if (
        payload?.blocklist_rules !== blocklistValue ||
        payload?.keeplist_rules !== keeplistValue
      ) {
        throw new Error("Both rule values were not sent exactly as entered")
      }
      await waitFor(() => !dialog(), "both-rule save to close")
    })

    await gate(runResults, "INVALID_RULE_DRAFT_PRESERVATION", async () => {
      await open("invalid-rule")
      const draft = "("
      setInputValue(input("blocklist-rules-input"), draft)
      await tick()
      saveButton()?.click()
      await waitFor(
        () => dialog()?.querySelector('[role="alert"]'),
        "accessible provider validation error",
      )
      if (!dialog() || input("blocklist-rules-input")?.value !== draft) {
        throw new Error("Invalid provider response closed the modal or lost the raw draft")
      }
      await closeCleanly()
    })

    await gate(runResults, "CLEAR_BLOCK_AND_KEEP_RULES", async () => {
      await open()
      setInputValue(input("blocklist-rules-input"), "")
      setInputValue(input("keeplist-rules-input"), "")
      await tick()
      saveButton()?.click()
      await waitFor(() => fixture.calls.some((call) => call.method === "put"), "clear request")
      const request = fixture.calls.find((call) => call.method === "put")
      if (request?.args?.[1]?.blocklist_rules !== "" || request?.args?.[1]?.keeplist_rules !== "") {
        throw new Error("Explicitly cleared rules were omitted or changed")
      }
      await waitFor(() => !dialog(), "clear save to close")
      if (fixture.feed.blocklist_rules !== "" || fixture.feed.keeplist_rules !== "") {
        throw new Error("Provider response did not confirm both cleared rules")
      }
    })

    await gate(runResults, "PROVIDER_RESPONSE_MISMATCH", async () => {
      await open("provider-mismatch")
      setInputValue(input("blocklist-rules-input"), "requested-rule")
      await tick()
      saveButton()?.click()
      await waitFor(() => dialog()?.querySelector('[role="alert"]'), "provider mismatch feedback")
      if (input("blocklist-rules-input")?.value !== "provider-canonical-value") {
        throw new Error("The UI did not reflect the provider's returned rule value")
      }
      if (fixture.messages.some((message) => message.type === "success")) {
        throw new Error("Provider mismatch produced a false success notification")
      }
      await closeCleanly()
    })

    await gate(runResults, "AMBIGUOUS_SAVE_PROVIDER_CONFIRMATION", async () => {
      await open("ambiguous-applied")
      const rawValue = "  applied-before-timeout  "
      setInputValue(input("blocklist-rules-input"), rawValue)
      await tick()
      saveButton()?.click()
      await waitFor(() => !dialog(), "provider-confirmed ambiguous save")
      const puts = fixture.calls.filter((call) => call.method === "put")
      if (puts.length !== 1 || fixture.feed.blocklist_rules !== rawValue) {
        throw new Error("Ambiguous save retried or did not reconcile the provider value")
      }
      if (!fixture.messages.some((message) => message.type === "success")) {
        throw new Error("A provider-confirmed save did not report success")
      }
    })

    await gate(runResults, "AMBIGUOUS_SAVE_NO_FALSE_SUCCESS", async () => {
      await open("ambiguous-unapplied")
      const rawValue = "not-applied"
      setInputValue(input("blocklist-rules-input"), rawValue)
      await tick()
      saveButton()?.click()
      await waitFor(() => dialog()?.querySelector('[role="alert"]'), "unconfirmed save feedback")
      if (!dialog() || fixture.messages.some((message) => message.type === "success")) {
        throw new Error("An unconfirmed save closed the editor or showed success")
      }
      if (!fixture.calls.some((call) => call.method === "get")) {
        throw new Error("The ambiguous update was not reconciled with a provider read")
      }
      await closeCleanly()
    })

    await gate(runResults, "FEED_DISAPPEARED_BOUNDED_RECONCILIATION", async () => {
      await open("missing-feed")
      setInputValue(input("blocklist-rules-input"), "changed-before-disappear")
      await tick()
      saveButton()?.click()
      await waitFor(() => dialog()?.querySelector('[role="alert"]'), "missing feed feedback")
      if (fixture.calls.filter((call) => call.method === "get").length !== 1) {
        throw new Error("Feed disappearance did not perform one bounded catalog reconciliation")
      }
      if (fixture.messages.some((message) => message.type === "success") || !dialog()) {
        throw new Error("A disappeared feed was reported as saved or caused implicit navigation")
      }
      if (dataState.get().feedsData.length > 0) {
        throw new Error("The provider's missing-feed catalog response was not reflected")
      }
    })

    await gate(runResults, "STALE_SESSION_UI_EFFECT", async () => {
      await open("stale-session")
      const title = dialog()?.querySelector('input[name="title"]')
      if (title) {
        title.value = "stale session edit"
        title.dispatchEvent(new Event("input", { bubbles: true }))
      }
      saveButton()?.click()
      await tick()
      if (!dialog()) {
        throw new Error("Modal closed after the data session changed during PUT")
      }
      if (dataState.get().feedsData.length > 0) {
        throw new Error("Stale provider response mutated the current-session catalog")
      }
      await closeCleanly()
    })

    await gate(runResults, "STALE_SESSION_AFTER_RECONCILIATION", async () => {
      await open("stale-reconciliation")
      setInputValue(input("blocklist-rules-input"), "stale-session-rule")
      await tick()
      saveButton()?.click()
      await waitFor(
        () => fixture.calls.some((call) => call.method === "get"),
        "provider reconciliation",
      )
      await tick()
      if (!dialog() || dataState.get().feedsData.length > 0) {
        throw new Error("Stale reconciliation closed the editor or changed current-session data")
      }
      if (fixture.messages.some((message) => message.type === "success")) {
        throw new Error("Stale reconciliation produced a success notification")
      }
      await closeCleanly()
    })

    await gate(runResults, "PROVIDER_ERROR_RESET_REFLECTED", async () => {
      await open()
      const updatedKeepRule = "^updated$\n"
      setInputValue(input("keeplist-rules-input"), updatedKeepRule)
      await tick()
      saveButton()?.click()
      await waitFor(() => !dialog(), "provider-backed filter save")
      const providerFeed = dataState.get().feedsData.find((feed) => feed.id === 701)
      const request = fixture.calls.find((call) => call.method === "put")
      if (providerFeed?.parsing_error_count !== 0 || providerFeed.parsing_error_message !== "") {
        throw new Error("Catalog did not reflect the full provider response after rule save")
      }
      if (
        providerFeed.keeplist_rules !== request?.args?.[1]?.keeplist_rules ||
        providerFeed.blocklist_rules !== startingFeed.blocklist_rules ||
        request?.args?.[1]?.keeplist_rules !== updatedKeepRule ||
        Object.hasOwn(request?.args?.[1] ?? {}, "blocklist_rules")
      ) {
        throw new Error("Catalog rule values do not match the provider response")
      }
    })

    await gate(runResults, "NO_AUTO_REFRESH_AFTER_SAVE", async () => {
      if (fixture.calls.some((call) => call.args?.[0]?.includes("/refresh"))) {
        throw new Error("Saving rules unexpectedly started a feed refresh")
      }
    })

    await gate(runResults, "LONG_RULE_AND_WARNING_WRAP_SAFE", async () => {
      await open()
      const longRule = `^${"verylongtoken".repeat(32)}$`
      setInputValue(input("blocklist-rules-input"), longRule)
      await tick()
      const modal = document.querySelector(".edit-modal")
      const textarea = input("blocklist-rules-input")
      const helper = modal?.querySelector("#feed-blocklist-rules-help")
      const warning = modal?.querySelector('[role="note"]')
      const footer = modal?.querySelector(".arco-modal-footer")?.getBoundingClientRect()
      const modalRect = modal?.getBoundingClientRect()
      const textareaRect = textarea?.getBoundingClientRect()
      const helperRect = helper?.getBoundingClientRect()
      const warningRect = warning?.getBoundingClientRect()
      const getTextRects = (element) => {
        if (!element) {
          return []
        }
        const range = document.createRange()
        range.selectNodeContents(element)
        return [...range.getClientRects()]
      }
      const helperTextRects = getTextRects(helper)
      const warningTextRects = getTextRects(warning)
      const overflowX = textarea ? getComputedStyle(textarea).overflowX : ""
      const metrics = {
        viewport: `${innerWidth}x${innerHeight}`,
        longRuleLength: longRule.length,
        textareaClientWidth: textarea?.clientWidth,
        textareaScrollWidth: textarea?.scrollWidth,
        textareaOverflowX: overflowX,
        warningScrollWidth: warning?.scrollWidth,
        warningClientWidth: warning?.clientWidth,
        helperWidth: helperRect?.width,
        helperTextLineCount: helperTextRects.length,
        warningWidth: warningRect?.width,
        warningTextLineCount: warningTextRects.length,
        footerVisible: Boolean(footer && footer.top >= 0 && footer.bottom <= innerHeight),
      }
      if (
        !modalRect ||
        modalRect.left < 0 ||
        modalRect.right > innerWidth ||
        document.documentElement.scrollWidth > innerWidth
      ) {
        throw new Error(`Long rule caused horizontal page overflow: ${JSON.stringify(metrics)}`)
      }
      if (
        !textareaRect ||
        textareaRect.left < modalRect.left ||
        textareaRect.right > modalRect.right ||
        !(
          textarea.scrollWidth <= textarea.clientWidth + 1 || ["auto", "scroll"].includes(overflowX)
        )
      ) {
        throw new Error(`Long rule is not safely contained: ${JSON.stringify(metrics)}`)
      }
      if (
        !helperRect ||
        helperRect.left < modalRect.left ||
        helperRect.right > modalRect.right ||
        helperTextRects.length === 0 ||
        helperTextRects.some(
          (rect) => rect.left < modalRect.left || rect.right > modalRect.right,
        ) ||
        !warningRect ||
        warningRect.left < modalRect.left ||
        warningRect.right > modalRect.right ||
        warning.scrollWidth > warning.clientWidth + 1 ||
        warningTextRects.length === 0 ||
        warningTextRects.some(
          (rect) => rect.left < modalRect.left || rect.right > modalRect.right,
        ) ||
        !metrics.footerVisible
      ) {
        throw new Error(`Help, warning or actions are clipped: ${JSON.stringify(metrics)}`)
      }
      await closeCleanly()
      return metrics
    })

    await gate(runResults, "RESPONSIVE_MODAL_GEOMETRY", async () => {
      await open()
      const modal = document.querySelector(".edit-modal")
      const modalRect = modal?.getBoundingClientRect()
      const { scrollWidth } = document.documentElement
      const geometry = {
        viewport: `${innerWidth}x${innerHeight}`,
        modal: modalRect && {
          left: Math.round(modalRect.left),
          right: Math.round(modalRect.right),
          top: Math.round(modalRect.top),
          bottom: Math.round(modalRect.bottom),
          width: Math.round(modalRect.width),
          height: Math.round(modalRect.height),
        },
        documentScrollWidth: scrollWidth,
      }
      const footer = modal?.querySelector(".arco-modal-footer")?.getBoundingClientRect()
      window.filterRulesHarnessGeometry = geometry
      if (
        !modalRect ||
        modalRect.left < 0 ||
        modalRect.right > innerWidth ||
        scrollWidth > innerWidth
      ) {
        throw new Error(`Modal clips or overflows at ${JSON.stringify(geometry)}`)
      }
      if (modalRect.height > innerHeight) {
        throw new Error(`Modal exceeds viewport height at ${geometry.viewport}`)
      }
      if (!footer || footer.top < 0 || footer.bottom > innerHeight) {
        throw new Error(`Modal actions are not reachable at ${geometry.viewport}`)
      }
      await closeCleanly()
      return geometry
    })

    await gate(runResults, "ACCESSIBLE_FIELDS_AND_FOCUS_RETURN", async () => {
      await open()
      const modal = dialog()
      const blocklist = input("blocklist-rules-input")
      const keeplist = input("keeplist-rules-input")
      if (!modal?.getAttribute("aria-label")) {
        throw new Error("Dialog has no accessible name")
      }
      if (
        !blocklist?.getAttribute("aria-describedby") ||
        !keeplist?.getAttribute("aria-describedby")
      ) {
        throw new Error("Filter textareas are missing their helper descriptions")
      }
      blocklist?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await waitFor(() => !dialog(), "clean Escape close")
      if (document.activeElement?.dataset.testid !== "filter-rules-focus-fallback") {
        throw new Error("Focus did not return to the editor trigger after close")
      }
    })

    await gate(runResults, "DIRTY_CLOSE_CANCEL_ESCAPE_AND_X", async () => {
      await open()
      setInputValue(input("blocklist-rules-input"), "unsaved-rule")
      await tick()
      cancelButton()?.click()
      await waitFor(
        () => document.querySelectorAll('[role="dialog"]').length > 1,
        "dirty cancel confirmation",
      )
      const keepEditing = [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Keep editing"),
      )
      keepEditing?.click()
      await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1, "keep editing")
      document.querySelector(".edit-modal .accessible-modal-close-button")?.click()
      await waitFor(
        () => document.querySelectorAll('[role="dialog"]').length > 1,
        "dirty X confirmation",
      )
      const keepEditingAgain = [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Keep editing"),
      )
      keepEditingAgain?.click()
      await waitFor(
        () => document.querySelectorAll('[role="dialog"]').length === 1,
        "keep editing after X",
      )
      input("blocklist-rules-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
      await waitFor(
        () => document.querySelectorAll('[role="dialog"]').length > 1,
        "dirty Escape confirmation",
      )
      const discard = [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Discard changes"),
      )
      discard?.click()
      await waitFor(() => !dialog(), "discard after dirty Escape")
      if (fixture.calls.some((call) => call.method === "put")) {
        throw new Error("Discarding a dirty editor changed provider state")
      }
      if (
        fixture.feed.blocklist_rules !== startingFeed.blocklist_rules ||
        fixture.feed.keeplist_rules !== startingFeed.keeplist_rules
      ) {
        throw new Error("Discard changed provider rule values")
      }
      if (document.activeElement?.dataset.testid !== "filter-rules-focus-fallback") {
        throw new Error("Focus did not return after confirming discard")
      }
    })

    setResults(runResults)
    setSummary(
      `${runResults.filter((result) => result.status === "PASS").length}/${runResults.length} PASS`,
    )
    document.querySelector('[data-testid="suite-results"]').textContent = JSON.stringify(
      runResults,
      null,
      2,
    )
  }

  window.filterRulesHarness = { open, runSuite }

  return (
    <AppDataContext.Provider value={{ refreshCounts: async () => ({ error: null }) }}>
      <ConfigProvider locale={enUS}>
        <main className="filter-rules-harness">
          <h1>FILTER-RULES-01 focused harness</h1>
          <div className="filter-rules-harness-controls">
            <Button data-testid="open-editor" onClick={() => open()}>
              Open feed editor fixture
            </Button>
            <Button data-testid="run-suite" type="primary" onClick={runSuite}>
              Run FILTER-RULES-01 gates
            </Button>
          </div>
          <p className="filter-rules-status" data-testid="suite-summary">
            {summary}
          </p>
          <pre className="filter-rules-results" data-testid="suite-results">
            {JSON.stringify(results, null, 2)}
          </pre>
          <Button
            data-feed-edit-id="701"
            data-testid="filter-rules-focus-fallback"
            onClick={() => open()}
          >
            Edit filter fixture
          </Button>
        </main>
        <EditFeedModal
          key={modalKey}
          fallbackFocusSelector='[data-testid="filter-rules-focus-fallback"]'
          feedForm={feedForm}
          selectedFeed={selectedFeedFixture}
          setVisible={setVisible}
          visible={visible}
        />
      </ConfigProvider>
    </AppDataContext.Provider>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)

if (new URLSearchParams(location.search).has("autostart")) {
  const startSuite = () => {
    const runButton = document.querySelector('[data-testid="run-suite"]')
    if (runButton) {
      runButton.click()
    } else {
      setTimeout(startSuite, 20)
    }
  }
  setTimeout(startSuite, 0)
}
