/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"

import apiClient from "@/apis/ofetch"
import Main from "@/components/Main/Main"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import useModalToggle from "@/hooks/useModalToggle"
import phrases from "@/locales/en-US.json"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings } from "@/store/settingsState"

import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/App.css"

// ADD-FEED-DISCOVERY-UX-01
//
// Drives the production Main component (Add Feed + discovery dialogs) against a stubbed Miniflux
// client and reports the presentation, confirmation, stacking, dismissal and focus gates.
//
//   ?scenario=zero|one-distinct|one-no-title|one-equals-url|multi-mixed|multi-many|direct
//   ?exit=none|cancel|escape|close|confirm      (how the discovery dialog is left)
//   ?theme=light|dark
//   ?auto=0                                     (skip the scripted run; POSTs land in window.__addFeedDiscoveryCalls)
//
// Open /scripts/tests/add-feed-discovery-ux-01.html with `pnpm dev`; resize the window to 390x844 and
// 884x1104 for the viewport gates. The result is rendered in [data-testid="report"].

const params = new URLSearchParams(location.search)
const scenarioName = params.get("scenario") ?? "multi-mixed"
const exitMode = params.get("exit") ?? "none"
const theme = params.get("theme") ?? "light"

const LONG_URL =
  "https://a-very-long-publication-name.example.org/section/world/politics/2026/10/22/rss-feed-with-an-unreasonably-long-path.xml?format=atom&utm_source=newsflux"

const SCENARIOS = {
  zero: { candidates: [] },
  "one-distinct": {
    candidates: [
      {
        title: "Fixture Daily",
        url: "https://example.com/feed.xml",
        expect: { primary: "Fixture Daily", secondary: "https://example.com/feed.xml" },
      },
    ],
  },
  "one-no-title": {
    candidates: [
      {
        title: "",
        url: "https://example.com/atom.xml",
        expect: { primary: "https://example.com/atom.xml", secondary: null },
      },
    ],
  },
  "one-equals-url": {
    candidates: [
      {
        title: "https://example.com/rss.xml",
        url: "https://example.com/rss.xml",
        expect: { primary: "https://example.com/rss.xml", secondary: null },
      },
    ],
  },
  "multi-mixed": {
    candidates: [
      {
        title: "Fixture Daily",
        url: "https://example.com/feed.xml",
        expect: { primary: "Fixture Daily", secondary: "https://example.com/feed.xml" },
      },
      {
        title: "",
        url: "https://example.com/atom.xml",
        expect: { primary: "https://example.com/atom.xml", secondary: null },
      },
      {
        title: "https://example.com/rss.xml",
        url: "https://example.com/rss.xml",
        expect: { primary: "https://example.com/rss.xml", secondary: null },
      },
      {
        title: "  EXAMPLE.com/comments.xml/ ",
        url: "https://example.com/comments.xml",
        expect: { primary: "https://example.com/comments.xml", secondary: null },
      },
      {
        title: "Politics — world news, analysis and opinion from the editorial desk",
        url: LONG_URL,
        expect: {
          primary: "Politics — world news, analysis and opinion from the editorial desk",
          secondary: LONG_URL,
        },
      },
    ],
  },
  "multi-many": {
    candidates: Array.from({ length: 12 }, (_, index) => {
      const url = `https://example.com/feeds/topic-${index + 1}.xml`
      const hasTitle = index % 3 === 0
      return {
        title: hasTitle ? `Topic ${index + 1} headlines` : "",
        url,
        expect: {
          primary: hasTitle ? `Topic ${index + 1} headlines` : url,
          secondary: hasTitle ? url : null,
        },
      }
    }),
  },
  direct: { candidates: [] },
}

const scenario = SCENARIOS[scenarioName]
const SITE_URL = "https://example.com/"
const DIRECT_FEED_URL = "https://example.com/direct.xml"
const calls = []
const gates = {}
const log = []
const category = { id: 1, title: "Fixture category", hide_globally: false }

document.body.setAttribute("arco-theme", theme)
polyglotState.setKey("polyglot", new Polyglot({ phrases, locale: "en-US" }))
replaceSettings({ ...getDefaultSettings() })
dataState.set({
  ...dataState.get(),
  feedsData: [],
  categoriesData: [category],
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})

apiClient.post = async (url, body) => {
  calls.push({ url, body })
  if (url === "/v1/discover") {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
    return scenario.candidates.map(({ title, url: feedUrl }) => ({
      title,
      url: feedUrl,
      type: "rss",
    }))
  }
  if (url === "/v1/feeds") {
    return { feed_id: 77 }
  }
  throw new Error(`Unexpected POST ${url}`)
}

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

const waitFor = async (predicate, description, timeout = 4000) => {
  const started = performance.now()
  while (performance.now() - started < timeout) {
    const value = predicate()
    if (value) {
      return value
    }
    await sleep(20)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const isShown = (element) =>
  Boolean(element) &&
  element.isConnected &&
  element.getClientRects().length > 0 &&
  getComputedStyle(element).visibility !== "hidden"

const parentModal = () => document.querySelector(".add-feed-modal")
const childModal = () => document.querySelector(".add-feed-discovery-modal")
const trigger = () => document.querySelector(".add-feed-discover-trigger")
const childContent = () => childModal()?.querySelector(".arco-modal-content")
const childButton = (type) =>
  childModal()?.querySelector(`.arco-modal-footer .arco-btn${type === "primary" ? "-primary" : ""}`)
const childCancelButton = () =>
  [...(childModal()?.querySelectorAll(".arco-modal-footer .arco-btn") ?? [])].find(
    (button) => !button.classList.contains("arco-btn-primary"),
  )

const setGate = (name, pass, detail = "") => {
  gates[name] = { pass: Boolean(pass), detail: String(detail) }
}

const typeInto = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const parseColor = (value) => {
  const rgb = value.match(/rgba?\(([^)]+)\)/)
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    return { r, g, b, a }
  }
  const srgb = value.match(/color\(srgb ([^)]+)\)/)
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1]
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number)
    return { r: r * 255, g: g * 255, b: b * 255, a }
  }
  return null
}

const toLinear = (value) => {
  const unit = value / 255
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
}

const luminance = ({ r, g, b }) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

const contrast = (foreground, background) => {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const opaqueBackground = (element) => {
  for (let node = element; node; node = node.parentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor)
    if (color && color.a === 1) {
      return color
    }
  }
  return { r: 255, g: 255, b: 255, a: 1 }
}

const occurrences = (text, needle) => text.split(needle).length - 1

const candidateRows = () => [...childModal().querySelectorAll(".add-feed-discovery-candidate")]

const checkPresentation = () => {
  const content = childContent().textContent
  const rows = candidateRows()
  const duplicates = scenario.candidates.filter(({ url }) => occurrences(content, url) !== 1)
  setGate(
    "DUPLICATE_URL_TEXT",
    duplicates.length === 0,
    duplicates.length === 0
      ? "each candidate URL is rendered exactly once"
      : `rendered more than once or not at all: ${duplicates.map(({ url }) => url).join(" | ")}`,
  )

  const mismatches = []
  if (rows.length !== scenario.candidates.length) {
    mismatches.push(`rows=${rows.length} expected=${scenario.candidates.length}`)
  }
  for (const [index, { expect }] of scenario.candidates.entries()) {
    const row = rows[index]
    const primary = row?.querySelector(".add-feed-discovery-candidate-title")?.textContent
    const secondary = row?.querySelector(".add-feed-discovery-candidate-url")?.textContent ?? null
    if (primary !== expect.primary || secondary !== expect.secondary) {
      mismatches.push(
        `#${index} got ${JSON.stringify({ primary, secondary })} want ${JSON.stringify(expect)}`,
      )
    }
    // Secondary text sits under the primary line, left-aligned with it, never beside it.
    const titleElement = row?.querySelector(".add-feed-discovery-candidate-title")
    const urlElement = row?.querySelector(".add-feed-discovery-candidate-url")
    if (titleElement && urlElement) {
      const titleRect = titleElement.getBoundingClientRect()
      const urlRect = urlElement.getBoundingClientRect()
      if (urlRect.top < titleRect.bottom - 1 || Math.abs(urlRect.left - titleRect.left) > 1) {
        mismatches.push(`#${index} URL is not stacked under its title`)
      }
    }
    // A radio indicator leads the text on the same side of the row.
    const indicator = row?.querySelector(".arco-radio-mask")
    if (indicator && titleElement) {
      const indicatorRect = indicator.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      if (
        indicatorRect.right > titleElement.getBoundingClientRect().left ||
        indicatorRect.top < rowRect.top ||
        indicatorRect.bottom > rowRect.bottom
      ) {
        mismatches.push(`#${index} radio indicator is not beside the text`)
      }
    }
  }
  setGate("PRESENTATION", mismatches.length === 0, mismatches.join("; ") || "primary/secondary ok")

  const visualProblems = []
  for (const [index, row] of rows.entries()) {
    const styles = getComputedStyle(row)
    const background = parseColor(styles.backgroundColor)
    if (!background || background.a !== 1) {
      visualProblems.push(`#${index} row background is not opaque (${styles.backgroundColor})`)
    }
    if (styles.backdropFilter !== "none" && styles.backdropFilter !== "") {
      visualProblems.push(`#${index} row uses backdrop-filter`)
    }
    const surface = opaqueBackground(row)
    for (const selector of [
      ".add-feed-discovery-candidate-title",
      ".add-feed-discovery-candidate-url",
    ]) {
      const element = row.querySelector(selector)
      const color = element && parseColor(getComputedStyle(element).color)
      if (color && contrast(color, surface) < 4.5) {
        visualProblems.push(
          `#${index} ${selector} contrast ${contrast(color, surface).toFixed(2)} < 4.5`,
        )
      }
    }
  }
  setGate(
    "OPAQUE_READABLE_CONTENT",
    rows.length > 0 && visualProblems.length === 0,
    visualProblems.join("; ") || `${rows.length} rows opaque, AA contrast`,
  )
}

const checkLayout = () => {
  const modal = childModal()
  const modalRect = modal.getBoundingClientRect()
  const content = childContent()
  const footerButtons = [...modal.querySelectorAll(".arco-modal-footer .arco-btn")]
  const problems = []

  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
    problems.push("document scrolls horizontally")
  }
  if (
    modalRect.left < 0 ||
    modalRect.right > innerWidth + 0.5 ||
    modalRect.top < 0 ||
    modalRect.bottom > innerHeight + 0.5
  ) {
    problems.push(`dialog leaves the viewport ${JSON.stringify(modalRect)}`)
  }
  if (content.scrollWidth > content.clientWidth + 1) {
    problems.push(`content overflows horizontally ${content.scrollWidth}>${content.clientWidth}`)
  }
  for (const button of footerButtons) {
    const rect = button.getBoundingClientRect()
    if (rect.bottom > innerHeight || rect.right > innerWidth || rect.height < 32) {
      problems.push(`footer button out of reach ${JSON.stringify(rect)}`)
    }
  }
  for (const row of candidateRows()) {
    const rect = row.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    if (rect.left < contentRect.left - 1 || rect.right > contentRect.right + 1) {
      problems.push(`row escapes the dialog body ${JSON.stringify(rect)}`)
    }
  }
  const list = modal.querySelector(".add-feed-discovery-candidates")
  if (list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY !== "auto") {
    problems.push("a long candidate list is not scrollable inside the dialog")
  }
  setGate(`VIEWPORT_${innerWidth}x${innerHeight}`, problems.length === 0, problems.join("; "))
}

const checkStacking = () => {
  const child = childModal()
  const parent = parentModal()
  const childWrapper = child.closest(".arco-modal-wrapper")
  const parentWrapper = parent.closest(".arco-modal-wrapper")
  const childContainer = childWrapper.parentElement
  const parentContainer = parentWrapper.parentElement
  const confirm = childButton("primary")
  const confirmRect = confirm.getBoundingClientRect()
  const topAtConfirm = document.elementFromPoint(
    confirmRect.left + confirmRect.width / 2,
    confirmRect.top + confirmRect.height / 2,
  )
  const topAtCorner = document.elementFromPoint(2, 2)
  const childZ = Number(getComputedStyle(childWrapper).zIndex)
  const parentZ = Number(getComputedStyle(parentWrapper).zIndex)
  const problems = []
  if (!child.contains(topAtConfirm)) {
    problems.push("child Subscribe button is covered")
  }
  if (!childContainer.contains(topAtCorner) || parentContainer.contains(topAtCorner)) {
    problems.push("parent chrome is hit-testable through the child mask")
  }
  if (!(childZ > parentZ)) {
    problems.push(`child z-index ${childZ} <= parent ${parentZ}`)
  }
  if (!isShown(parent)) {
    problems.push("parent Add Feed modal is no longer visible")
  }
  setGate(
    "STACKING",
    problems.length === 0,
    problems.join("; ") || `child ${childZ} > parent ${parentZ}`,
  )
}

const feedPosts = () => calls.filter(({ url }) => url === "/v1/feeds")

const checkConfirmationRequired = () => {
  const subscribe = childButton("primary")
  const single = scenario.candidates.length === 1
  const disabledNow = subscribe.disabled || subscribe.classList.contains("arco-btn-disabled")
  const problems = []
  if (feedPosts().length > 0) {
    problems.push("POST /v1/feeds happened before confirmation")
  }
  if (single && disabledNow) {
    problems.push("single candidate cannot be confirmed")
  }
  if (!single && !disabledNow) {
    problems.push("multiple candidates: Subscribe is enabled before a selection")
  }
  if (!single && childModal().querySelectorAll('input[type="radio"]:checked').length > 0) {
    problems.push("multiple candidates: a radio is preselected")
  }
  setGate(
    single ? "ONE_RESULT_CONFIRMATION" : "MULTI_RESULT_SELECTION",
    problems.length === 0,
    problems.join("; ") || (single ? "explicit confirm required" : "explicit selection required"),
  )
}

const dismissed = async (label) => {
  await waitFor(() => !isShown(childModal()), `${label}: discovery dialog to close`)
  await sleep(120)
  const problems = []
  if (!isShown(parentModal())) {
    problems.push("parent Add Feed modal closed")
  }
  if (feedPosts().length > 0) {
    problems.push("POST /v1/feeds happened while dismissing")
  }
  setGate(
    `${label}_DISMISS`,
    problems.length === 0,
    problems.join("; ") || "child closed, parent open, no POST",
  )
  setGate(
    "FOCUS_RETURN",
    document.activeElement === trigger(),
    `activeElement=${document.activeElement?.className || document.activeElement?.tagName}`,
  )
  const parentAfter = isShown(parentModal())
  setGate(
    "STACKING_AFTER_CLOSE",
    parentAfter && parentModal().contains(document.activeElement),
    "parent modal still owns focus",
  )
}

const pressEscape = () => {
  const target = document.activeElement ?? document.body
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        code: "Escape",
        key: "Escape",
        keyCode: 27,
        which: 27,
      }),
    )
  }
}

const run = async () => {
  await waitFor(() => isShown(parentModal()), "Add Feed modal")
  await waitFor(() => parentModal().contains(document.activeElement), "focus inside Add Feed modal")
  setGate("PARENT_OPEN", true, "Add Feed modal visible")

  typeInto(
    parentModal().querySelector("input.arco-input"),
    scenarioName === "direct" ? DIRECT_FEED_URL : SITE_URL,
  )
  parentModal().querySelector(".arco-select-view").click()
  const option = await waitFor(
    () => document.querySelector(".add-feed-category-select-popup .arco-select-option"),
    "category option",
  )
  option.click()
  await waitFor(
    () => parentModal().querySelector(".arco-select-view-value")?.textContent === category.title,
    "category selection",
  )

  if (scenarioName === "direct") {
    parentModal().querySelector(".arco-modal-footer .arco-btn-primary").click()
    await waitFor(() => feedPosts().length > 0, "direct POST /v1/feeds")
    const [post] = feedPosts()
    setGate(
      "DIRECT_FEED_UNCHANGED",
      post.body.feed_url === DIRECT_FEED_URL &&
        post.body.category_id === category.id &&
        calls.every(({ url }) => url !== "/v1/discover") &&
        !childModal(),
      JSON.stringify(calls),
    )
    return
  }

  trigger().click()
  await waitFor(() => calls.some(({ url }) => url === "/v1/discover"), "POST /v1/discover")

  if (scenario.candidates.length === 0) {
    const toast = await waitFor(
      () =>
        [...document.querySelectorAll(".arco-message")].find((node) =>
          node.textContent.includes(phrases.main.add_feed_discover_no_results),
        ),
      "no-result message",
    )
    setGate(
      "ZERO_RESULT",
      Boolean(toast) && !isShown(childModal()) && feedPosts().length === 0,
      "explicit no-result message, no dialog, no POST /v1/feeds",
    )
    return
  }

  await waitFor(() => isShown(childModal()), "discovery dialog")
  await sleep(300)
  checkPresentation()
  checkLayout()
  checkStacking()
  checkConfirmationRequired()

  switch (exitMode) {
    case "cancel": {
      childCancelButton().click()
      await dismissed("CANCEL")
      break
    }
    case "close": {
      childModal().querySelector(".accessible-modal-close-button").click()
      await dismissed("CLOSE")
      break
    }
    case "escape": {
      pressEscape()
      await dismissed("ESCAPE")
      break
    }
    case "confirm": {
      const index = scenario.candidates.length - 1
      if (scenario.candidates.length > 1) {
        childModal().querySelectorAll('input[type="radio"]')[index].click()
        await waitFor(() => !childButton("primary").disabled, "Subscribe enabled after selection")
      }
      childButton("primary").click()
      await waitFor(() => feedPosts().length > 0, "POST /v1/feeds after confirmation")
      const [post] = feedPosts()
      setGate(
        "CONFIRM_SUBSCRIBES_SELECTED",
        post.body.feed_url === scenario.candidates[index].url && feedPosts().length === 1,
        JSON.stringify(post),
      )
      break
    }
    default: {
      break
    }
  }
}

const Fixture = () => {
  const { setAddFeedModalVisible } = useModalToggle()
  useEffect(() => {
    setAddFeedModalVisible(true)
  }, [setAddFeedModalVisible])
  return <p style={{ padding: 16 }}>NewsFlux fixture page behind the dialogs.</p>
}

const Harness = () => (
  <ConfigProvider locale={enUS}>
    <AppDataContext.Provider
      value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
    >
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Main />} path="/">
            <Route index element={<Fixture />} />
            <Route element={<Fixture />} path="*" />
          </Route>
        </Routes>
      </MemoryRouter>
      <output data-status="WAITING" data-testid="report" />
    </AppDataContext.Provider>
  </ConfigProvider>
)

createRoot(document.querySelector("#root")).render(<Harness />)

const publish = (error) => {
  const failed = Object.entries(gates).filter(([, { pass }]) => !pass)
  const status = error || failed.length > 0 ? "FAIL" : "PASS"
  const report = {
    scenario: scenarioName,
    exit: exitMode,
    theme,
    viewport: `${innerWidth}x${innerHeight}`,
    status,
    error: error ? String(error.message ?? error) : undefined,
    gates,
    posts: feedPosts().length,
    log,
  }
  globalThis.__addFeedDiscoveryReport = report
  const output = document.querySelector('[data-testid="report"]')
  output.dataset.status = status
  output.textContent = JSON.stringify(report, null, 1)
}

// ?auto=0 leaves the page untouched so a person (or real-input automation) can drive it.
if (params.get("auto") === "0") {
  globalThis.__addFeedDiscoveryCalls = calls
} else {
  try {
    await run()
    publish()
  } catch (error) {
    publish(error)
  }
}
