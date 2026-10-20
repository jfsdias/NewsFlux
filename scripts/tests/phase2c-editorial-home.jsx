// Local fixtures exercise production routes, Home/Content, reader, context, manager and brand.
import "@arco-design/web-react/es/_util/react-19-adapter"
import Polyglot from "node-polyglot"
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, Outlet, RouterProvider } from "react-router"

import {
  emptyHomeFixtures,
  fixtureFeed,
  highlightFixtures,
  paginationEntries,
  personalizationFixtures,
  phase2cEditorialHomeMatrix,
  primaryHierarchyFixtures,
  readerFixtures,
  readerTypographyFixtures,
  routeEntries,
} from "./fixtures/phase2c-editorial-home"

import apiClient from "@/apis/ofetch"
import { ContextProvider } from "@/components/Content/ContentContext"
import HomePageManager from "@/components/HomePageManager"
import Sidebar from "@/components/Sidebar/Sidebar"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import useContentContext from "@/hooks/useContentContext"
import useEntryActions, {
  markEntriesAsRead,
  updateEntriesStatusOptimistically,
} from "@/hooks/useEntryActions"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import productionRouter from "@/routes"
import "@/liquid-glass.css"
import { authState } from "@/store/authState"
import { contentState, resetContent } from "@/store/contentState"
import {
  commitIdentityData,
  dataState,
  resetData,
  setDataResourceLoadState,
} from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { setCurrentHomeTarget } from "@/store/homePageState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { subscribeEntryStatusMutationEvents } from "@/utils/entry-status-mutation-events"
import {
  createHomeEditorialSession,
  projectHomeSession,
  transitionHomeSession,
} from "@/utils/home-editorial-session"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "./phase2c-editorial-home.css"

// Reuse the registered production content routes, replacing only auth/app bootstrap boundaries.
const contentRoutes = productionRouter.routes[1].children.at(0).children
productionRouter.dispose()
const fixtureAuth = {
  server: "https://example.invalid",
  token: "fixture",
  username: "",
  password: "",
}
const requests = []
let fixtureEntries = routeEntries
let fixtureTotal = 2
let paginationPages = null
let strictHomePagination = false
let deferredPagination = null
let deferredArticleQuery = null
let failPagination = false
let emptyPagePagination = false
let initialHomeQueryServed = false
let starredProfileEntries = []
let starredProfileMode = "resolved"
let deferredStarredProfile = null
let failStatusMutation = false
let starMutationRequests = 0
let statusMutationRequests = 0
let deferredFirstStatusMutation = null
let rejectStatusMutationCall = null
let failCount = false
let deferredCount = null
let unloadedStatus = "read"
let articleFailure = false
let identityRetries = 0
let router
const tokens = new WeakMap()
let nextToken = 0
const instanceToken = (node) => {
  if (!tokens.has(node)) {
    tokens.set(node, ++nextToken)
  }
  return tokens.get(node)
}

apiClient.get = async (url) => {
  requests.push(url)
  if (url.startsWith("/v1/entries?")) {
    const params = new URL(url, "https://fixture.invalid").searchParams
    if (params.get("starred") === "true") {
      if (starredProfileMode === "failed") {
        throw new Error("Expected local starred-profile failure")
      }
      if (starredProfileMode === "deferred" && deferredStarredProfile) {
        return deferredStarredProfile.promise
      }
      return { entries: starredProfileEntries }
    }
    if (articleFailure) {
      throw new Error("Expected local article query failure")
    }
    if (params.get("limit") === "1" && failCount) {
      throw new Error("Expected local canonical count failure")
    }
    if (params.get("limit") === "1" && deferredCount) {
      return deferredCount.promise
    }
    const isEmptyHomePageAppend = emptyPagePagination && initialHomeQueryServed
    if (strictHomePagination && params.has("published_before")) {
      const cursor = Number(params.get("published_before"))
      const limit = Number(params.get("limit"))
      const entries = fixtureEntries
        .toSorted((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
        .filter((entry) => Date.parse(entry.published_at) / 1000 <= cursor)
        .slice(0, limit)
      return { entries, total: fixtureTotal }
    }
    if ((params.has("published_before") || isEmptyHomePageAppend) && paginationPages) {
      if (failPagination) {
        throw new Error("Expected local pagination failure")
      }
      if (deferredPagination) {
        await deferredPagination.promise
      }
      const page = paginationPages.shift()
      assert(page, "Unexpected extra Home page request")
      return { entries: page, total: fixtureTotal }
    }
    if (!params.has("published_before") && deferredArticleQuery) {
      await deferredArticleQuery.promise
      deferredArticleQuery = null
    }
    if (strictHomePagination) {
      const limit = Number(params.get("limit"))
      const entries = fixtureEntries
        .toSorted((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
        .slice(0, limit)
      return { entries, total: fixtureTotal }
    }
    if (emptyPagePagination) {
      initialHomeQueryServed = true
    }
    return { entries: fixtureEntries, total: fixtureTotal }
  }
  const id = Number(url.match(/^\/v1\/entries\/(\d+)$/)?.[1])
  const entry = fixtureEntries.find((candidate) => candidate.id === id)
  if (entry) {
    return entry
  }
  throw new Error(`Unexpected local fixture GET: ${url}`)
}
apiClient.put = async (url, body) => {
  if (url === "/v1/entries" && typeof body?.starred === "boolean") {
    starMutationRequests += 1
    fixtureEntries = fixtureEntries.map((entry) =>
      body.entry_ids.includes(entry.id) ? { ...entry, starred: body.starred } : entry,
    )
    return
  }
  if (url !== "/v1/entries" || !body?.status) {
    throw new Error("Unexpected mutation in routing fixture")
  }
  const mutationCall = ++statusMutationRequests
  if (mutationCall === 1 && deferredFirstStatusMutation) {
    await deferredFirstStatusMutation.promise
  }
  if (failStatusMutation || mutationCall === rejectStatusMutationCall) {
    throw new Error("Expected local status mutation failure")
  }
  for (const id of body.entry_ids) {
    const loaded = fixtureEntries.find((entry) => entry.id === id)
    const previous = loaded?.status ?? (id === 303 ? unloadedStatus : null)
    if (previous && previous !== body.status) {
      fixtureTotal += body.status === "unread" ? 1 : -1
    }
    if (loaded) {
      fixtureEntries = fixtureEntries.map((entry) =>
        entry.id === id ? { ...entry, status: body.status } : entry,
      )
    }
    if (id === 303) {
      unloadedStatus = body.status
    }
  }
}
polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
const appData = {
  refreshIdentity: async () => {
    identityRetries += 1
    commitIdentityData({ id: 1, username: "fixture" })
  },
  refreshFeedData: async () => {},
  refreshCounts: async () => {},
}

const FixtureReaderControls = () => {
  const { handleEntryClick } = useContentContext()
  const { handleToggleStatus } = useEntryActions()
  return (
    <>
      <button
        aria-label="Open local Home article"
        onClick={() => handleEntryClick(contentState.get().entries[0])}
      >
        Open fixture article
      </button>
      <button
        aria-label="Fixture card status action"
        onClick={() => handleToggleStatus(contentState.get().entries[0])}
      >
        Card status action
      </button>
      <button
        aria-label="Fixture scroll read action"
        onClick={() => markEntriesAsRead([contentState.get().entries[0]])}
      >
        Scroll read action
      </button>
    </>
  )
}

const FixtureFrame = () => (
  <AppDataContext.Provider value={appData}>
    <DesktopSidebarContext.Provider
      value={{
        isDesktopSidebarCollapsed: false,
        collapseButtonRef: { current: null },
        detailCloseButtonRef: { current: null },
        reopenButtonRef: { current: null },
        collapseDesktopSidebar: () => {},
        expandDesktopSidebar: () => {},
      }}
    >
      <HomePageManager />
      <div className="harness-stage">
        <Sidebar />
        <div className="harness-content">
          <ContextProvider>
            <div className="harness-fixture-controls">
              <FixtureReaderControls />
            </div>
            <Outlet />
          </ContextProvider>
        </div>
      </div>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>
)

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 70))
const createDeferred = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}
const resolveStarredProfile = (entries) => {
  assert(deferredStarredProfile, "No deferred starred-profile request is pending")
  deferredStarredProfile.resolve({ entries })
  deferredStarredProfile = null
}
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 70; attempt += 1) {
    if (predicate()) {
      return
    }
    await settle()
  }
  throw new Error(message)
}
const navigate = async (destination) => {
  await router.navigate(destination)
  await settle()
}
const homeRoot = () => document.querySelector(".home-editorial")
const readerIs = (id) =>
  contentState.get().activeContent?.id === id &&
  document.querySelector(".article-container .article-body")?.textContent.includes(`article ${id}`)
const clickLabel = (label) => {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
  )
  assert(button && !button.disabled, `Missing enabled ${label} action`)
  button.click()
}

const cards = () => [...document.querySelectorAll(".home-highlights .article-entry")]
const ids = () => cards().map((card) => Number(card.dataset.entryId))
const recentIds = () =>
  [...document.querySelectorAll(".home-recent .article-entry")].map((node) =>
    Number(node.dataset.entryId),
  )
const starredProfileRequests = () =>
  requests.filter(
    (url) => new URL(url, "https://fixture.invalid").searchParams.get("starred") === "true",
  )
const canonicalEntryRequests = () =>
  requests.filter(
    (url) =>
      url.startsWith("/v1/entries?") &&
      new URL(url, "https://fixture.invalid").searchParams.get("starred") !== "true",
  )
const listRequests = canonicalEntryRequests
const scrollRoot = () =>
  homeRoot()?.querySelector(".simplebar-content-wrapper, .adaptive-scroll-area-native")
const sentinels = () => [...document.querySelectorAll(".home-editorial .load-more-container")]
const measureHighlightSlot = (slot) => {
  const card = homeRoot().querySelector(`.home-highlight-slot-${slot} .article-entry`)
  if (!card) {
    return null
  }
  const cardRect = card.getBoundingClientRect()
  const title = card.querySelector(".grid-card-title")
  const deck = card.querySelector(".grid-card-summary:not(.grid-card-summary-measure-probe)")
  const media = card.querySelector(".grid-card-media")
  const mediaRect = media?.getBoundingClientRect()
  const contentInside = [
    ...card.querySelectorAll(
      ".grid-card-meta, .grid-card-title, .grid-card-summary:not(.grid-card-summary-measure-probe), .grid-card-footer, .grid-card-media",
    ),
  ].every((node) => {
    const rect = node.getBoundingClientRect()
    return (
      rect.left >= cardRect.left - 1 &&
      rect.right <= cardRect.right + 1 &&
      rect.top >= cardRect.top - 1 &&
      rect.bottom <= cardRect.bottom + 1
    )
  })
  return {
    id: Number(card.dataset.entryId),
    width: Math.round(cardRect.width),
    height: Math.round(cardRect.height),
    titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
    titleLines: Math.round(
      title.clientHeight / Number.parseFloat(getComputedStyle(title).lineHeight),
    ),
    titleClamped: title.scrollHeight > title.clientHeight + 1,
    deck: Boolean(deck),
    deckClamped: Boolean(deck && deck.scrollHeight > deck.clientHeight + 1),
    media: mediaRect
      ? { width: Math.round(mediaRect.width), height: Math.round(mediaRect.height) }
      : null,
    contentInside,
  }
}
const mountPrimaryHierarchyCase = async (mountHighlights, caseId) => {
  const entries = primaryHierarchyFixtures[caseId]
  await mountHighlights(entries)
  await waitFor(
    () =>
      [...homeRoot().querySelectorAll(".home-highlights .grid-card-cover")].every((image) =>
        image.classList.contains("grid-card-cover-ready"),
      ),
    `${caseId} Highlight images did not load`,
  )
  // Deck fitting runs after layout and font loading; let it settle before measuring.
  for (let frame = 0; frame < 5; frame += 1) {
    await settle()
  }
  return entries
}
const runPrimaryHierarchyCase = async (mountHighlights, caseId, covers) => {
  // Lets an external screenshot driver stage one HOME-VISUAL-01 case at a time.
  globalThis.__homeVisual01MountCase = (nextCaseId) =>
    mountPrimaryHierarchyCase(mountHighlights, nextCaseId)

  const entries = await mountPrimaryHierarchyCase(mountHighlights, caseId)
  const expectedIds = entries.slice(0, 3).map(({ id }) => id)
  assert(
    JSON.stringify(ids()) === JSON.stringify(expectedIds),
    `${caseId} changed Highlight selection: ${ids().join(",")}`,
  )
  const [primary, ...secondaries] = ["primary", "secondary-1", "secondary-2"].map((slot) =>
    measureHighlightSlot(slot),
  )
  assert(primary && secondaries.every(Boolean), `${caseId} is missing a Highlight slot`)
  for (const [index, slot] of [primary, ...secondaries].entries()) {
    assert(Boolean(slot.media) === covers[index], `${caseId} slot ${index} cover presence changed`)
  }
  const highlights = homeRoot().querySelector(".home-highlights").getBoundingClientRect()
  assert(
    Math.abs(primary.width - highlights.width) < 2,
    `${caseId} Primary does not span Highlights`,
  )
  assert(
    document.documentElement.scrollWidth <= window.innerWidth,
    `${caseId} overflowed horizontally`,
  )
  assert(
    [primary, ...secondaries].every(({ contentInside }) => contentInside),
    `${caseId} card content escaped its card`,
  )
  assert(
    secondaries.every(({ titleFontSize }) => primary.titleFontSize >= titleFontSize + 4),
    `${caseId} Primary headline (${primary.titleFontSize}px) is not clearly larger than Secondary headlines (${secondaries.map(({ titleFontSize }) => titleFontSize).join("/")}px)`,
  )
  assert(
    [primary, ...secondaries].every(({ deckClamped }) => !deckClamped),
    `${caseId} a Highlight deck was truncated`,
  )
  assert(
    secondaries.every(({ titleClamped }) => !titleClamped) &&
      (caseId === "caseD" || !primary.titleClamped),
    `${caseId} a Highlight headline was truncated`,
  )
  for (const secondary of secondaries.filter(({ media }) => media)) {
    assert(
      secondary.media.width <= secondary.width / 2 &&
        Math.abs(secondary.media.width / secondary.media.height - 4 / 3) < 0.03,
      `${caseId} Secondary image is not a 4:3 supporting thumbnail: ${secondary.media.width}x${secondary.media.height} in ${secondary.width}px card`,
    )
  }
  if (primary.media) {
    assert(
      Math.abs(primary.media.width / primary.media.height - 16 / 9) < 0.03,
      `${caseId} Primary image left the 16:9 editorial frame`,
    )
  }
  globalThis.__homeVisual01Geometry = {
    ...globalThis.__homeVisual01Geometry,
    [caseId]: {
      viewport: [window.innerWidth, window.innerHeight],
      highlightsWidth: Math.round(highlights.width),
      primary,
      secondaries,
    },
  }
}
// READER-VISUAL-01: reader geometry. The frame is the Article width setting (.article-body); prose is
// clamp(40ch, 75% of that setting, 58ch) since READER-MEASURE-01, never wider than the frame.
const readerMeasureCh = (articleWidth) => Math.min(58, Math.max(40, articleWidth * 0.75))
const readerScrollElement = (container) =>
  container.querySelector(".scroll-container .simplebar-content-wrapper") ??
  container.querySelector(".scroll-container")
const rectOf = (node) => node.getBoundingClientRect()
const isProseBlock = (node) =>
  !node.parentElement.closest("li, td, th, blockquote, figure, .article-table-scroll") &&
  !node.querySelector("img:not(.icon-image), iframe, video, .plyr")
const measureReader = (articleWidth) => {
  const container = document.querySelector(".article-container")
  const body = container?.querySelector(".article-body")
  assert(container && body, "Reader did not render")
  const bodyRect = body.getBoundingClientRect()
  const probe = document.createElement("span")
  probe.style.cssText = "position:absolute;visibility:hidden;width:1ch"
  body.append(probe)
  const chPx = probe.getBoundingClientRect().width
  probe.remove()
  const expectedProse = Math.min(bodyRect.width, readerMeasureCh(articleWidth) * chPx)
  const prose = [...body.querySelectorAll("p, ul, ol, blockquote, h2, h3")]
    .filter((node) => isProseBlock(node))
    .map((node) => ({ tag: node.tagName, rect: rectOf(node) }))
  const scrollElement = readerScrollElement(container)
  const content = container.querySelector(".article-content")
  const title = container.querySelector(".article-title")
  const header = container.querySelector(".article-header")
  const background = getComputedStyle(container).backgroundColor
  return {
    viewport: [window.innerWidth, window.innerHeight],
    articleWidth,
    chPx: Number(chPx.toFixed(2)),
    contentWidth: Math.round(content.clientWidth),
    frame: { left: bodyRect.left, width: bodyRect.width },
    expectedProse,
    prose,
    header: rectOf(header),
    titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
    titleRect: rectOf(title),
    proseFontSize: Number.parseFloat(getComputedStyle(body).fontSize),
    sourceH2FontSize: (() => {
      const heading = [...body.querySelectorAll("h2")].find((node) => isProseBlock(node))
      return heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : null
    })(),
    proseLineHeight: getComputedStyle(body.querySelector("p")).lineHeight,
    media: [
      ...body.querySelectorAll(
        "pre, .article-table-scroll, iframe, img:not(.icon-image), figure, figcaption",
      ),
    ].map((node) => ({
      tag: node.tagName,
      className: node.className,
      rect: rectOf(node),
      declaredWidth: Number(node.getAttribute("width")) || Number.POSITIVE_INFINITY,
    })),
    scrollElement,
    // User-visible overflow only: the transparent zoom overlay is absolutely positioned
    // and pre-existingly oversized at <= 768px, but the reader clips it (overflow-x: hidden).
    overflow:
      document.documentElement.scrollWidth > window.innerWidth ||
      [
        ...body.querySelectorAll(
          "p, ul, ol, blockquote, h2, h3, pre, .article-table-scroll, iframe, img, figure",
        ),
      ].some((node) => {
        const rect = rectOf(node)
        return (
          rect.left < scrollElement.getBoundingClientRect().left - 1 ||
          rect.right > scrollElement.getBoundingClientRect().right + 1
        )
      }),
    containerRect: rectOf(container),
    opaque: !background.startsWith("rgba") || background.endsWith(", 1)"),
    listInert: Boolean(document.querySelector(".entry-col[inert]")),
  }
}
const mountReaderCase = async (
  mount,
  caseId,
  articleWidth = 75,
  { fixtures = readerFixtures, fontSize, waitForImages = true } = {},
) => {
  const entry = fixtures[caseId]
  await mount(`/all/entry/${entry.id}`, {
    entries: [entry],
    total: 1,
    showStatus: "all",
    articleWidth,
    fontSize,
  })
  await waitFor(
    () =>
      contentState.get().activeContent?.id === entry.id &&
      document.querySelector(".article-container .article-body p") &&
      (!waitForImages ||
        [...document.querySelectorAll(".article-container .article-body img")].every(
          (image) => image.complete,
        )),
    `${caseId} reader did not render`,
  )
  for (let frame = 0; frame < 4; frame += 1) {
    await settle()
  }
  return entry
}
const assertReaderLayout = (caseId, metrics) => {
  const { frame, expectedProse, prose } = metrics
  assert(!metrics.overflow, `${caseId} reader overflowed horizontally`)
  assert(metrics.opaque, `${caseId} reader surface is not opaque`)
  assert(metrics.listInert, `${caseId} reader is not the single active pane`)
  assert(prose.length > 0, `${caseId} has no prose blocks`)
  const proseLeft = frame.left + (frame.width - expectedProse) / 2
  for (const { tag, rect } of prose) {
    assert(
      Math.abs(rect.width - expectedProse) < 2 && Math.abs(rect.left - proseLeft) < 2,
      `${caseId} ${tag} is ${rect.width.toFixed(1)}px at ${rect.left.toFixed(1)}; expected ${expectedProse.toFixed(1)}px at ${proseLeft.toFixed(1)}`,
    )
  }
  for (const { tag, rect } of metrics.media) {
    // Iframes keep the browser's default 2px border on top of width: 100% (pre-existing).
    const tolerance = tag === "IFRAME" ? 5 : 1
    assert(
      rect.left >= frame.left - tolerance && rect.right <= frame.left + frame.width + tolerance,
      `${caseId} ${tag} escaped the reader frame`,
    )
  }
  const headerAxis = metrics.header.left + metrics.header.width / 2
  const proseAxis = proseLeft + expectedProse / 2
  assert(
    Math.abs(headerAxis - proseAxis) < 2,
    `${caseId} title axis ${headerAxis.toFixed(1)} is not aligned with the prose axis ${proseAxis.toFixed(1)}`,
  )
  const [floor, step, cap] =
    metrics.contentWidth >= 960
      ? [1.6, 2.2, 2.9]
      : metrics.contentWidth >= 600
        ? [1.5, 2, 2.6]
        : [1.25, 1.55, 2]
  const expectedTitle = Math.max(
    metrics.proseFontSize * floor,
    Math.min(metrics.proseFontSize * step, cap * 16),
  )
  assert(
    Math.abs(metrics.titleFontSize - expectedTitle) < 0.05,
    `${caseId} title is ${metrics.titleFontSize}px; expected ${expectedTitle.toFixed(2)}px for a ${metrics.contentWidth}px reader`,
  )
  assert(
    metrics.sourceH2FontSize === null || metrics.titleFontSize >= 1.1 * metrics.sourceH2FontSize,
    `${caseId} title ${metrics.titleFontSize}px does not outrank source h2 ${metrics.sourceH2FontSize}px`,
  )
  assert(metrics.proseLineHeight !== "normal", `${caseId} prose line height missing`)
}
const recordReaderMetrics = (key, metrics) => {
  const { scrollElement: _scrollElement, ...serializable } = metrics
  globalThis.__readerVisual01Geometry = {
    ...globalThis.__readerVisual01Geometry,
    [key]: serializable,
  }
}
const runReaderCase = async (mount, caseId) => {
  // Lets an external screenshot driver stage one READER-VISUAL-01 case at a time.
  globalThis.__readerVisual01MountCase = (nextCaseId, articleWidth) =>
    mountReaderCase(mount, nextCaseId, articleWidth)
  await mountReaderCase(mount, caseId)
  const metrics = measureReader(75)
  assertReaderLayout(caseId, metrics)
  const frameWidth = metrics.frame.width
  const byClass = (predicate) => metrics.media.filter((node) => predicate(node))
  if (caseId === "longForm") {
    for (const surface of byClass(
      ({ tag, className }) =>
        ["PRE", "IFRAME"].includes(tag) || String(className).includes("article-table-scroll"),
    )) {
      assert(
        Math.abs(surface.rect.width - frameWidth) < (surface.tag === "IFRAME" ? 5 : 2),
        `${caseId} ${surface.tag} was narrowed to ${surface.rect.width.toFixed(1)}px (frame ${frameWidth.toFixed(1)}px)`,
      )
    }
  }
  if (caseId === "wideImage") {
    for (const image of byClass(({ tag }) => tag === "IMG")) {
      assert(
        Math.abs(image.rect.width - Math.min(frameWidth, image.declaredWidth)) < 2,
        `${caseId} wide image is ${image.rect.width.toFixed(1)}px; expected the frame ${frameWidth.toFixed(1)}px`,
      )
    }
    const caption = byClass(({ tag }) => tag === "FIGCAPTION")[0]
    const figure = byClass(({ tag }) => tag === "FIGURE")[0]
    assert(
      caption && figure && Math.abs(caption.rect.width - figure.rect.width) < 2,
      `${caseId} figcaption does not follow its figure`,
    )
  }
  if (caseId === "portraitImage") {
    const image = byClass(({ tag }) => tag === "IMG")[0]
    assert(
      image && image.rect.height <= window.innerHeight * 0.8 + 1,
      `${caseId} portrait image is ${image?.rect.height.toFixed(1)}px tall; cap is 80vh`,
    )
  }
  recordReaderMetrics(caseId, metrics)
}
const runReaderWidthControl = async (mount) => {
  const results = []
  for (const articleWidth of [50, 75, 100]) {
    await mountReaderCase(mount, "noImage", articleWidth)
    const metrics = measureReader(articleWidth)
    assertReaderLayout(`width ${articleWidth}`, metrics)
    results.push({
      articleWidth,
      frame: metrics.frame.width,
      prose: metrics.prose[0].rect.width,
      expected: metrics.expectedProse,
    })
    recordReaderMetrics(`width${articleWidth}`, metrics)
  }
  for (let index = 1; index < results.length; index += 1) {
    const [previous, current] = [results[index - 1], results[index]]
    assert(
      current.frame >= previous.frame - 1 && current.prose >= previous.prose - 1,
      `Article width is not monotonic: ${JSON.stringify(results)}`,
    )
    assert(
      current.expected - previous.expected < 1 || current.prose > previous.prose + 1,
      `Article width ${current.articleWidth} did not widen prose: ${JSON.stringify(results)}`,
    )
  }
}
// READER-VISUAL-02A1: editorial typography foundation. Every size is measured twice, with and without the
// ReaderStyles.css <style> element (Vite dev), so protected surfaces and prose geometry are compared with the
// real pre-change baseline instead of frozen numbers.
const READER_TYPOGRAPHY_SIZES = [1, 1.05, 1.5]
const READER_SURFACE_PROPS = [
  "fontSize",
  "fontWeight",
  "lineHeight",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "color",
  "backgroundColor",
  "borderTopWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopColor",
  "borderRadius",
  "fontFamily",
  "letterSpacing",
  "textDecorationLine",
  "transitionDuration",
  "transitionProperty",
  "animationName",
]
// The prose paragraph changes leading by design; every other protected surface must stay identical.
const READER_PROTECTED_SURFACES = {
  pre: ["pre", READER_SURFACE_PROPS],
  preCode: ["pre code", READER_SURFACE_PROPS],
  tableScroll: [".article-table-scroll", READER_SURFACE_PROPS],
  th: ["th", READER_SURFACE_PROPS],
  td: ["td", READER_SURFACE_PROPS],
  figure: ["figure", READER_SURFACE_PROPS],
  figcaption: ["figcaption", READER_SURFACE_PROPS],
  figureImage: ["figure img", READER_SURFACE_PROPS],
  linkTag: ["a.link-tag", READER_SURFACE_PROPS],
  header: [".article-header", READER_SURFACE_PROPS],
  meta: [".article-meta", READER_SURFACE_PROPS],
  date: [".article-date", READER_SURFACE_PROPS],
  divider: [".article-header .arco-divider", READER_SURFACE_PROPS],
  // Inline elements inside prose inherit the new prose leading; only their typeface properties are protected.
  strong: ["strong", ["fontSize", "fontWeight"]],
  sup: ["sup", ["fontSize", "verticalAlign"]],
  body: [".article-body", READER_SURFACE_PROPS],
  article: [".article-content", ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"]],
  paragraph: [
    ".article-body > p",
    READER_SURFACE_PROPS.filter((property) => property !== "lineHeight"),
  ],
}
// These keep every computed style, but their geometry can change without a typography regression: table cell
// link margins reflow tables, code depends on async highlighting, and 02A2 intentionally aligns metadata/divider
// inside the narrower editorial header column.
const READER_GEOMETRY_EXEMPT = new Set(["th", "td", "sup", "preCode", "meta", "divider"])
const readerStyleElement = () => {
  const styles = [...document.querySelectorAll("style[data-vite-dev-id]")].filter((style) =>
    style.dataset.viteDevId.endsWith("/ReaderStyles.css"),
  )
  assert(
    styles.length === 1,
    `expected one ReaderStyles.css <style> element, found ${styles.length}`,
  )
  return styles[0]
}
const measureWithoutReaderStyles = async (measure) => {
  const { sheet } = readerStyleElement()
  sheet.disabled = true
  try {
    await settle()
    return measure()
  } finally {
    sheet.disabled = false
    await settle()
  }
}
let readerColorContext = null
const readerColor = (value) => {
  readerColorContext ??= Object.assign(document.createElement("canvas"), {
    width: 1,
    height: 1,
  }).getContext("2d", { willReadFrequently: true })
  readerColorContext.clearRect(0, 0, 1, 1)
  readerColorContext.fillStyle = "#000"
  readerColorContext.fillStyle = value
  readerColorContext.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = readerColorContext.getImageData(0, 0, 1, 1).data
  return [red, green, blue, alpha / 255]
}
const readerBackground = (node) => {
  for (let element = node; element; element = element.parentElement) {
    const color = readerColor(getComputedStyle(element).backgroundColor)
    if (color[3] > 0.99) {
      return color
    }
  }
  return [255, 255, 255, 1]
}
const srgbChannel = (value) => {
  const unit = value / 255
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
}
const relativeLuminance = ([red, green, blue]) =>
  0.2126 * srgbChannel(red) + 0.7152 * srgbChannel(green) + 0.0722 * srgbChannel(blue)
const readerContrast = (node, surface = node) => {
  const foreground = readerColor(getComputedStyle(node).color)
  const background = readerBackground(surface)
  const blended =
    foreground[3] < 1
      ? foreground
          .slice(0, 3)
          .map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]))
      : foreground
  const [lighter, darker] = [relativeLuminance(blended), relativeLuminance(background)].toSorted(
    (a, b) => b - a,
  )
  return (lighter + 0.05) / (darker + 0.05)
}
const readerNestedContext = "li, td, th, blockquote, figure"
const readerStyle = (node) => getComputedStyle(node)
const readerPx = (node, property) => Number.parseFloat(readerStyle(node)[property])
const readerHeadingMetrics = (node) => ({
  tag: node.tagName,
  fontSize: readerPx(node, "fontSize"),
  fontWeight: readerStyle(node).fontWeight,
  synthesis: readerStyle(node).fontSynthesisWeight,
  parentFontSize: readerPx(node.parentElement, "fontSize"),
})
const measureReaderTypography = () => {
  const container = document.querySelector(".article-container")
  const content = container?.querySelector(".article-content")
  const body = container?.querySelector(".article-body")
  const title = container?.querySelector(".article-title")
  assert(content && body && title, "Reader did not render")
  const fontSize = readerPx(body, "fontSize")
  const containerWidth =
    content.clientWidth - readerPx(content, "paddingLeft") - readerPx(content, "paddingRight")
  const headings = [...body.querySelectorAll("h1, h2, h3, h4, h5, h6")]
  const links = [...body.querySelectorAll("a:not(.link-tag)")].map((link) => ({
    marginLeft: readerStyle(link).marginLeft,
    marginRight: readerStyle(link).marginRight,
    borderBottomWidth: readerStyle(link).borderBottomWidth,
    underline: readerStyle(link).textDecorationLine.includes("underline"),
    thickness: readerStyle(link).textDecorationThickness,
    color: readerStyle(link).color,
    contrast: readerContrast(link, body),
  }))
  const prose = [...body.querySelectorAll("p, ul, ol, blockquote, h2, h3")]
    .filter((node) => isProseBlock(node))
    .map((node) => ({
      key: `${node.tagName}:${rectOf(node).width.toFixed(1)}@${rectOf(node).left.toFixed(1)}`,
    }))
  const firstProse = body.querySelector(":scope > p")
  const blockquote = body.querySelector("blockquote")
  const inlineCode = [...body.querySelectorAll("code")].filter((code) => !code.closest("pre"))
  const meta = container.querySelector(".article-date, .article-meta")
  const caption = body.querySelector("figcaption")
  const listItem = body.querySelector("li")
  const surfaces = Object.fromEntries(
    Object.entries(READER_PROTECTED_SURFACES).map(([name, [selector, properties]]) => {
      const node = container.querySelector(selector)
      return [
        name,
        node
          ? {
              style: Object.fromEntries(
                properties.map((property) => [property, readerStyle(node)[property]]),
              ),
              width: Number(rectOf(node).width.toFixed(1)),
              left: Number(rectOf(node).left.toFixed(1)),
            }
          : null,
      ]
    }),
  )
  const linkTag = body.querySelector("a.link-tag")
  return {
    fontSize,
    containerWidth,
    forcedColors: globalThis.matchMedia("(forced-colors: active)").matches,
    title: { ...readerHeadingMetrics(title), contrast: readerContrast(title, body) },
    sourceH1Count: body.querySelectorAll("h1").length,
    headings: headings
      .filter((node) => !node.closest(readerNestedContext))
      .map((node) => ({ ...readerHeadingMetrics(node), contrast: readerContrast(node, body) })),
    nestedHeadings: headings
      .filter((node) => node.closest(readerNestedContext))
      .map((node) => readerHeadingMetrics(node)),
    leading: [...body.querySelectorAll("p, li, dd, dt, blockquote")]
      .filter((node) => !node.closest("figure, figcaption, table, pre, .footnotes"))
      .map((node) => readerPx(node, "lineHeight") / readerPx(node, "fontSize")),
    bodyContrast: firstProse ? readerContrast(firstProse, body) : null,
    links,
    linkTagCount: body.querySelectorAll("a.link-tag").length,
    linkTagMargins: linkTag
      ? [readerStyle(linkTag).marginLeft, readerStyle(linkTag).marginRight]
      : null,
    blockquote: blockquote
      ? {
          borderWidth: readerStyle(blockquote).borderInlineStartWidth,
          borderStyle: readerStyle(blockquote).borderInlineStartStyle,
          marginTop: readerPx(blockquote, "marginTop"),
          paragraphMargin: readerPx(blockquote.querySelector("p"), "marginTop"),
          contrast: readerContrast(blockquote.querySelector("p"), body),
        }
      : null,
    listItemMargin: listItem
      ? { top: readerPx(listItem, "marginTop"), bottom: readerPx(listItem, "marginBottom") }
      : null,
    inlineCode: inlineCode.map((code) => ({
      ratio: readerPx(code, "fontSize") / readerPx(code.parentElement, "fontSize"),
      borderWidth: readerStyle(code).borderTopWidth,
      borderStyle: readerStyle(code).borderTopStyle,
      contrast: readerContrast(code),
    })),
    metaContrast: meta ? readerContrast(meta, body) : null,
    captionContrast: caption ? readerContrast(caption, body) : null,
    prose: prose.map(({ key }) => key),
    surfaces,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    offscreen: [
      ...container.querySelectorAll(
        ".article-header *, .article-body p, .article-body li, .article-body h1, .article-body h2, .article-body h3, .article-body h4, .article-body h5, .article-body h6, .article-body a, .article-body code, .article-body blockquote",
      ),
    ]
      .filter((node) => {
        const rect = rectOf(node)
        return (
          rect.width > 0 &&
          !node.closest(".article-table-scroll, pre, .code-block-container") &&
          (rect.right > window.innerWidth + 1 || rect.left < -1)
        )
      })
      .map((node) => `${node.tagName}.${node.className}`),
  }
}
const assertReaderTypography = (label, after, before) => {
  const near = (actual, expected, tolerance = 0.05) => Math.abs(actual - expected) <= tolerance
  const clamp = (floor, step, cap) => Math.max(floor, Math.min(step, cap))
  const size = after.fontSize
  const wide = after.containerWidth >= 600
  const expectedTitle =
    after.containerWidth >= 960
      ? clamp(1.6 * size, 2.2 * size, 2.9 * 16)
      : wide
        ? clamp(1.5 * size, 2 * size, 2.6 * 16)
        : clamp(1.25 * size, 1.55 * size, 2 * 16)
  assert(
    near(after.title.fontSize, expectedTitle),
    `${label} title is ${after.title.fontSize}px; expected ${expectedTitle.toFixed(2)}px`,
  )
  assert(
    after.title.fontWeight === "650" && after.title.synthesis === "none",
    `${label} title weight/synthesis is ${after.title.fontWeight}/${after.title.synthesis}`,
  )
  assert(after.sourceH1Count === 0, `${label} a source h1 reached the reader unnormalized`)
  const expectedH2 = clamp(1.08 * size, (wide ? 1.4 : 1.32) * size, (wide ? 1.75 : 1.6) * 16)
  const expectedH3 = clamp(size, 1.15 * size, 1.35 * 16)
  for (const heading of after.headings) {
    const expected = { H2: expectedH2, H3: expectedH3 }[heading.tag] ?? size
    assert(
      near(heading.fontSize, expected),
      `${label} ${heading.tag} is ${heading.fontSize}px; expected ${expected.toFixed(2)}px`,
    )
    assert(
      heading.fontWeight === "600" && heading.synthesis === "none",
      `${label} ${heading.tag} weight/synthesis is ${heading.fontWeight}/${heading.synthesis}`,
    )
    assert(heading.fontSize >= size - 0.01, `${label} ${heading.tag} is smaller than the body`)
    assert(heading.contrast >= 7, `${label} ${heading.tag} contrast ${heading.contrast.toFixed(2)}`)
  }
  assert(
    after.nestedHeadings.length === before.nestedHeadings.length,
    `${label} nested heading count changed`,
  )
  for (const [index, heading] of after.nestedHeadings.entries()) {
    if (["H1", "H2"].includes(heading.tag)) {
      assert(
        near(heading.fontSize, 1.17 * heading.parentFontSize, 0.06),
        `${label} nested ${heading.tag} is ${heading.fontSize}px; cap is 1.17em of ${heading.parentFontSize}px`,
      )
    } else {
      assert(
        heading.fontSize === before.nestedHeadings[index].fontSize,
        `${label} nested ${heading.tag} changed size`,
      )
    }
  }
  const largestHeading = Math.max(
    0,
    ...after.headings.map(({ fontSize }) => fontSize),
    ...after.nestedHeadings.map(({ fontSize }) => fontSize),
  )
  assert(
    after.title.fontSize >= 1.1 * largestHeading - 0.01,
    `${label} title ${after.title.fontSize}px does not outrank the largest internal heading ${largestHeading}px`,
  )
  const expectedLeading = after.containerWidth < 600 ? 1.62 : 1.7
  assert(
    after.leading.length > 0 && after.leading.every((ratio) => near(ratio, expectedLeading, 0.005)),
    `${label} prose leading ${[...new Set(after.leading.map((ratio) => ratio.toFixed(3)))]}; expected ${expectedLeading}`,
  )
  assert(after.bodyContrast >= 7, `${label} body contrast ${after.bodyContrast?.toFixed(2)}`)
  assert(after.title.contrast >= 7, `${label} title contrast ${after.title.contrast.toFixed(2)}`)
  assert(after.links.length > 0, `${label} has no inline links to measure`)
  for (const link of after.links) {
    assert(
      link.marginLeft === "0px" && link.marginRight === "0px",
      `${label} inline link margin ${link.marginLeft}/${link.marginRight}`,
    )
    assert(
      link.borderBottomWidth === "0px" && link.underline && link.thickness === "1px",
      `${label} inline link is not a 1px underline`,
    )
    assert(link.contrast >= 4.5, `${label} link contrast ${link.contrast.toFixed(2)}`)
  }
  assert(
    after.linkTagCount === before.linkTagCount &&
      JSON.stringify(after.linkTagMargins) === JSON.stringify(before.linkTagMargins),
    `${label} a.link-tag was changed`,
  )
  if (after.blockquote) {
    assert(
      after.blockquote.borderWidth === "2px" && after.blockquote.borderStyle === "solid",
      `${label} blockquote rule is ${after.blockquote.borderWidth} ${after.blockquote.borderStyle}`,
    )
    assert(
      near(after.blockquote.marginTop, 1.6 * size, 0.1) &&
        near(after.blockquote.paragraphMargin, 0.5 * size, 0.1),
      `${label} blockquote rhythm ${after.blockquote.marginTop}/${after.blockquote.paragraphMargin}`,
    )
    assert(
      after.blockquote.contrast >= 7,
      `${label} blockquote contrast ${after.blockquote.contrast.toFixed(2)}`,
    )
  }
  if (after.listItemMargin) {
    assert(
      near(after.listItemMargin.top, 0.4 * size, 0.1) &&
        near(after.listItemMargin.bottom, 0.4 * size, 0.1),
      `${label} list item margin ${after.listItemMargin.top}/${after.listItemMargin.bottom}`,
    )
  }
  for (const code of after.inlineCode) {
    assert(
      near(code.ratio, 0.88, 0.005) && code.borderWidth === "1px" && code.contrast >= 4.5,
      `${label} inline code ratio ${code.ratio.toFixed(3)} border ${code.borderWidth} contrast ${code.contrast.toFixed(2)}`,
    )
  }
  for (const [name, contrast] of [
    ["meta", after.metaContrast],
    ["caption", after.captionContrast],
  ]) {
    assert(contrast === null || contrast >= 4.5, `${label} ${name} contrast ${contrast}`)
  }
  assert(after.overflow <= 0, `${label} overflowed horizontally by ${after.overflow}px`)
  assert(after.offscreen.length === 0, `${label} content left the viewport: ${after.offscreen}`)
  assert(
    JSON.stringify(after.prose) === JSON.stringify(before.prose),
    `${label} prose geometry changed: ${before.prose.slice(0, 4)} -> ${after.prose.slice(0, 4)}`,
  )
  for (const name of Object.keys(READER_PROTECTED_SURFACES)) {
    const [now, then] = [after.surfaces[name], before.surfaces[name]]
    assert(Boolean(now) === Boolean(then), `${label} protected surface ${name} presence changed`)
    if (now) {
      const changed = Object.keys(now.style).filter(
        (property) => now.style[property] !== then.style[property],
      )
      assert(
        changed.length === 0,
        `${label} protected surface ${name} changed: ${changed.map((property) => `${property} ${then.style[property]} -> ${now.style[property]}`)}`,
      )
      assert(
        READER_GEOMETRY_EXEMPT.has(name) ||
          (Math.abs(now.width - then.width) < 0.6 && Math.abs(now.left - then.left) < 0.6),
        `${label} protected surface ${name} moved: ${then.width}@${then.left} -> ${now.width}@${now.left}`,
      )
    }
  }
  if (after.forcedColors) {
    assert(
      after.blockquote === null || after.blockquote.borderStyle === "solid",
      `${label} forced-colors blockquote rule is not visible`,
    )
    assert(
      after.links.every((link) => link.underline),
      `${label} forced-colors links lost their underline`,
    )
    assert(
      after.inlineCode.every((code) => code.borderStyle === "solid"),
      `${label} forced-colors inline code lost its border`,
    )
  }
}
const runReaderTypographyCase = async (mount, caseId) => {
  // Lets an external screenshot driver stage one READER-VISUAL-02A1 case at a time.
  globalThis.__readerVisual02a1MountCase = (nextCaseId, fontSize) =>
    mountReaderCase(mount, nextCaseId, 75, {
      fixtures: readerTypographyFixtures,
      fontSize,
      waitForImages: nextCaseId !== "typographyTechnical",
    })
  const sizes = []
  for (const fontSize of READER_TYPOGRAPHY_SIZES) {
    const label = `${caseId}@${fontSize}rem`
    await mountReaderCase(mount, caseId, 75, {
      fixtures: readerTypographyFixtures,
      fontSize,
      waitForImages: caseId !== "typographyTechnical",
    })
    if (caseId === "typographyTechnical") {
      document.querySelector(".deferred-code-block, .code-block-container")?.scrollIntoView()
      await waitFor(
        () => document.querySelector(".code-block-container .code-block-header"),
        `${label} CodeBlock did not mount`,
      )
    }
    assertReaderLayout(label, measureReader(75))
    const after = measureReaderTypography()
    const before = await measureWithoutReaderStyles(measureReaderTypography)
    assertReaderTypography(label, after, before)
    const largestHeading = Math.max(
      ...after.headings.map(({ fontSize: size }) => size),
      ...after.nestedHeadings.map(({ fontSize: size }) => size),
    )
    sizes.push({
      fontSize,
      viewport: [window.innerWidth, window.innerHeight],
      containerWidth: after.containerWidth,
      forcedColors: after.forcedColors,
      title: after.title.fontSize,
      largestHeading,
      titleRatio: Number((after.title.fontSize / largestHeading).toFixed(3)),
      bodyContrast: Number(after.bodyContrast.toFixed(2)),
      linkContrast: Number(Math.min(...after.links.map(({ contrast }) => contrast)).toFixed(2)),
    })
  }
  globalThis.__readerVisual02a1Metrics = {
    ...globalThis.__readerVisual02a1Metrics,
    [caseId]: sizes,
  }
}

// READER-MEASURE-01: prose measure. The "Article width" setting stays the only width control; prose reads at
// clamp(40ch, articleWidth * 0.75ch, 58ch) and never wider than the frame, while media, tables and code keep the
// frame. The rule is toggled through the CSSOM, so every comparison uses the same page and the same stylesheets
// minus the rule (the promoted READER-VISUAL-01 + 02A1 behavior), never frozen numbers.
const READER_MEASURE_FORMULA = "clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)"
const READER_MEASURE_LEGACY_FORMULA = "calc(var(--article-width) * 0.75ch)"
const READER_MEASURE_SELECTORS = [
  ".article-content .article-body",
  ".article-content .article-header .article-header-column",
]
const READER_MEASURE_CPL_LIMIT = 74
const READER_MEASURE_TOLERANCE = 0.5
const READER_MEASURE_WIDTHS = [
  ...Array.from({ length: 51 }, (_, index) => 50 + index),
  77.33,
  77.34,
].toSorted((a, b) => a - b)
const READER_MEASURE_CPL_WIDTHS = [75, 80, 90, 100]
const READER_MEASURE_PROTECTED_WIDTHS = [50, 75, 100]
const READER_MEASURE_HEADER_WIDTHS = [50, 60, 75, 90, 100]
const READER_MEASURE_PARITY_CASES = [
  [readerFixtures, "short"],
  [readerFixtures, "longForm"],
  [readerFixtures, "longHeadline"],
  [readerFixtures, "wideImage"],
  [readerFixtures, "portraitImage"],
  [readerFixtures, "noImage"],
  [readerTypographyFixtures, "typographyNormal"],
  [readerTypographyFixtures, "typographyStress"],
]
const READER_MEASURE_MEDIA = "img:not(.icon-image), figure, figcaption, iframe, video, audio, .plyr"
const READER_MEASURE_TABLE = ".article-table-scroll, table"
const READER_MEASURE_CODE = "pre, .code-block-container"
const READER_MEASURE_BLOCKS =
  "p, ul, ol, dl, blockquote, h1, h2, h3, h4, h5, h6, hr, li, pre, figure, figcaption, img, iframe, .article-table-scroll, table"
const normalizeSpace = (text) => text.replaceAll(/\s+/gu, " ").trim()
let readerMeasureSweepCache = null
const readerBody = () => document.querySelector(".article-container .article-body")
const readerContent = () => document.querySelector(".article-container .article-content")
const readerChPx = (node) => {
  // 1ch is snapped to the 1/64px layout grid; measuring 100ch keeps the ratio exact enough for 0.005ch tolerances.
  const probe = document.createElement("span")
  probe.style.cssText = "position:absolute;visibility:hidden;width:100ch"
  node.append(probe)
  const { width } = probe.getBoundingClientRect()
  probe.remove()
  return width / 100
}
const readerMeasureToken = (node) =>
  Number.parseFloat(getComputedStyle(node).getPropertyValue("--reader-prose-measure"))
const readerMeasureRules = () => {
  const found = []
  const visit = (rules, container) => {
    for (const [index, rule] of [...rules].entries()) {
      if (rule.style?.getPropertyValue("--reader-prose-measure")) {
        found.push({ container, index, rule })
      }
      if (rule.cssRules?.length) {
        visit(rule.cssRules, rule)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules, sheet)
    } catch {
      // Cross-origin sheets are not part of the Reader.
    }
  }
  return found
}
const readerMeasureDeclared = (rule) =>
  normalizeSpace(rule.style.getPropertyValue("--reader-prose-measure"))
const readerMeasureContractRules = () =>
  readerMeasureRules().filter(({ rule }) => readerMeasureDeclared(rule) === READER_MEASURE_FORMULA)
const withReaderMeasureRuleDisabled = async (measure) => {
  const targets = readerMeasureContractRules()
  assert(
    targets.length === 1,
    `expected one READER-MEASURE-01 rule in the CSSOM, found ${targets.length}`,
  )
  const [{ container, index, rule }] = targets
  const { cssText } = rule
  container.deleteRule(index)
  try {
    await settle()
    return await measure()
  } finally {
    container.insertRule(cssText, index)
    await settle()
  }
}
const setReaderArticleWidth = async (articleWidth) => {
  settingsState.set({ ...settingsState.get(), articleWidth })
  await waitFor(
    () => readerContent()?.style.getPropertyValue("--article-width") === String(articleWidth),
    `article width ${articleWidth} did not reach the reader`,
  )
  await settle()
}
const sampleReaderMeasure = (articleWidth) => {
  const body = readerBody()
  assert(body, "Reader did not render")
  const tokenPx = readerMeasureToken(body)
  const chPx = readerChPx(body)
  const frame = body.getBoundingClientRect().width
  const prose = [...body.querySelectorAll("p, ul, ol, blockquote, h2, h3")]
    .filter((node) => isProseBlock(node))
    .map((node) => node.getBoundingClientRect().width)
  assert(prose.length > 0, "Reader has no prose blocks to measure")
  return {
    articleWidth,
    tokenPx,
    chPx,
    tokenCh: tokenPx / chPx,
    expectedCh: readerMeasureCh(articleWidth),
    frame,
    prose,
  }
}
const readerMeasureSweep = async (mount) => {
  readerMeasureSweepCache ??= await (async () => {
    await mountReaderCase(mount, "noImage", 75)
    const samples = []
    for (const articleWidth of READER_MEASURE_WIDTHS) {
      await setReaderArticleWidth(articleWidth)
      samples.push(sampleReaderMeasure(articleWidth))
    }
    await setReaderArticleWidth(75)
    return samples
  })()
  return readerMeasureSweepCache
}
const recordReaderMeasure = (key, value) => {
  globalThis.__readerMeasure01Metrics = { ...globalThis.__readerMeasure01Metrics, [key]: value }
}
const exposeReaderMeasureHooks = (mount) => {
  // Lets an external driver stage one READER-MEASURE-01 case at a time.
  globalThis.__readerMeasure01MountCase = async (
    caseId,
    articleWidth = 75,
    typography = false,
    fontSize,
  ) => {
    await mountReaderCase(mount, caseId, articleWidth, {
      fixtures: typography ? readerTypographyFixtures : readerFixtures,
      fontSize,
    })
  }
  globalThis.__readerMeasure01SetWidth = setReaderArticleWidth
}
const runReaderMeasureFormula = async (mount) => {
  exposeReaderMeasureHooks(mount)
  readerMeasureSweepCache = null
  globalThis.__readerMeasure01Metrics = {}
  await mountReaderCase(mount, "noImage", 75)
  const declared = readerMeasureRules().map(({ rule }) => ({
    selector: normalizeSpace(rule.selectorText),
    value: readerMeasureDeclared(rule),
  }))
  const contract = readerMeasureContractRules()
  assert(
    contract.length === 1,
    `expected exactly one rule declaring ${READER_MEASURE_FORMULA}; declarations: ${JSON.stringify(declared)}`,
  )
  const selectors = contract[0].rule.selectorText
    .split(",")
    .map((selector) => normalizeSpace(selector))
    .toSorted()
  assert(
    JSON.stringify(selectors) === JSON.stringify([...READER_MEASURE_SELECTORS].toSorted()),
    `the measure rule must target exactly ${READER_MEASURE_SELECTORS.join(" | ")}; found ${selectors.join(" | ")}`,
  )
  assert(
    contract[0].rule.parentStyleSheet === readerStyleElement().sheet,
    "the measure rule must ship in ReaderStyles.css (via ReaderTypography.css)",
  )
  const others = declared.filter(({ value }) => value !== READER_MEASURE_FORMULA)
  assert(
    others.every(({ value }) => value === READER_MEASURE_LEGACY_FORMULA),
    `unexpected --reader-prose-measure declarations: ${JSON.stringify(others)}`,
  )
  // The registered <length> token must resolve through the contract rule, not the legacy calc, at the cap.
  await setReaderArticleWidth(100)
  const capped = sampleReaderMeasure(100)
  assert(
    Math.abs(capped.tokenCh - 58) < 0.01,
    `at Article width 100 the token is ${capped.tokenCh.toFixed(3)}ch; the contract formula gives 58ch (legacy would give 75ch)`,
  )
  await setReaderArticleWidth(75)
  recordReaderMeasure("formula", { declared, selectors })
}
const runReaderMeasureWidth50Floor = async (mount) => {
  const [first] = await readerMeasureSweep(mount)
  assert(first.articleWidth === 50, "sweep did not start at Article width 50")
  assert(
    Math.abs(first.tokenCh - 40) < 0.005,
    `Article width 50 resolves to ${first.tokenCh.toFixed(3)}ch; the floor is 40ch (50 * 0.75 = 37.5ch)`,
  )
  const proseExpected = Math.min(first.frame, first.tokenPx)
  for (const width of first.prose) {
    assert(
      Math.abs(width - proseExpected) < 1,
      `Article width 50 prose is ${width.toFixed(1)}px; expected ${proseExpected.toFixed(1)}px`,
    )
  }
  recordReaderMeasure("width50", { tokenCh: first.tokenCh, chPx: first.chPx, frame: first.frame })
}
const runReaderMeasureMonotonicity = async (mount) => {
  const sweep = await readerMeasureSweep(mount)
  for (const sample of sweep) {
    const expectedPx = Math.min(sample.frame, sample.tokenPx)
    for (const width of sample.prose) {
      assert(
        Math.abs(width - expectedPx) < 1,
        `Article width ${sample.articleWidth}: a prose block is ${width.toFixed(1)}px, expected min(frame, measure) ${expectedPx.toFixed(1)}px`,
      )
    }
    assert(
      Math.abs(sample.tokenCh - sample.expectedCh) < 0.005,
      `Article width ${sample.articleWidth}: token ${sample.tokenCh.toFixed(3)}ch, contract ${sample.expectedCh.toFixed(3)}ch`,
    )
  }
  for (let index = 1; index < sweep.length; index += 1) {
    const [previous, current] = [sweep[index - 1], sweep[index]]
    assert(
      current.tokenPx >= previous.tokenPx - 0.01,
      `measure decreased from ${previous.tokenPx.toFixed(2)}px at ${previous.articleWidth} to ${current.tokenPx.toFixed(2)}px at ${current.articleWidth}`,
    )
    assert(
      current.prose[0] >= previous.prose[0] - READER_MEASURE_TOLERANCE,
      `prose narrowed from ${previous.prose[0].toFixed(1)}px at ${previous.articleWidth} to ${current.prose[0].toFixed(1)}px at ${current.articleWidth}`,
    )
  }
  const point = (width) => sweep.find(({ articleWidth }) => articleWidth === width)
  assert(
    point(55).tokenPx > point(50).tokenPx - 0.01 && point(75).tokenPx > point(60).tokenPx,
    "measure is not rising across the 50-75 range",
  )
  recordReaderMeasure(
    "sweep",
    sweep.map(({ articleWidth, tokenCh, frame }) => ({
      articleWidth,
      tokenCh: Number(tokenCh.toFixed(3)),
      frame: Number(frame.toFixed(1)),
    })),
  )
}
const runReaderMeasureMinBound = async (mount) => {
  const sweep = await readerMeasureSweep(mount)
  for (const sample of sweep) {
    assert(
      sample.tokenPx >= 40 * sample.chPx - 0.01,
      `Article width ${sample.articleWidth}: measure ${sample.tokenCh.toFixed(3)}ch is below the 40ch floor`,
    )
    for (const width of sample.prose) {
      assert(
        width >= Math.min(sample.frame, 40 * sample.chPx) - READER_MEASURE_TOLERANCE,
        `Article width ${sample.articleWidth}: a prose block is ${width.toFixed(1)}px, below min(frame, 40ch)`,
      )
    }
  }
}
const runReaderMeasureMaxBound = async (mount) => {
  const sweep = await readerMeasureSweep(mount)
  for (const sample of sweep) {
    assert(
      sample.tokenPx <= 58 * sample.chPx + 0.01,
      `Article width ${sample.articleWidth}: measure ${sample.tokenCh.toFixed(3)}ch is above the 58ch cap`,
    )
    for (const width of sample.prose) {
      assert(
        width <= 58 * sample.chPx + READER_MEASURE_TOLERANCE,
        `Article width ${sample.articleWidth}: a prose block is ${width.toFixed(1)}px, above the 58ch cap`,
      )
    }
  }
  const capped = sweep.filter(({ articleWidth }) => articleWidth >= 77.34)
  assert(
    capped.every(({ tokenCh }) => Math.abs(tokenCh - 58) < 0.005),
    "the cap does not hold from Article width 77.34 upwards",
  )
}
const readerGeometry = (body) =>
  [...body.querySelectorAll(READER_MEASURE_BLOCKS)].map((node) => {
    const rect = node.getBoundingClientRect()
    return { tag: node.tagName, left: rect.left, width: rect.width, height: rect.height }
  })
const runReaderMeasureDefault75Parity = async (mount) => {
  const checked = []
  for (const [fixtures, caseId] of READER_MEASURE_PARITY_CASES) {
    await mountReaderCase(mount, caseId, 75, { fixtures })
    // Absolute default: 56.25ch centered in the frame, exactly what the promoted READER-VISUAL-01 baseline gives.
    assertReaderLayout(`${caseId}@75`, measureReader(75))
    const body = readerBody()
    const withRule = { geometry: readerGeometry(body), token: readerMeasureToken(body) }
    const withoutRule = await withReaderMeasureRuleDisabled(() => ({
      geometry: readerGeometry(readerBody()),
      token: readerMeasureToken(readerBody()),
    }))
    assert(
      Math.abs(withRule.token - withoutRule.token) < 0.01,
      `${caseId}: the default-width token moved from ${withoutRule.token.toFixed(2)}px to ${withRule.token.toFixed(2)}px`,
    )
    assert(
      withRule.geometry.length === withoutRule.geometry.length,
      `${caseId}: block count changed with the rule`,
    )
    for (const [index, block] of withRule.geometry.entries()) {
      const reference = withoutRule.geometry[index]
      for (const key of ["left", "width", "height"]) {
        assert(
          Math.abs(block[key] - reference[key]) <= READER_MEASURE_TOLERANCE,
          `${caseId}: ${block.tag}#${index} ${key} is ${block[key].toFixed(1)}px with the rule and ${reference[key].toFixed(1)}px without it at Article width 75`,
        )
      }
    }
    checked.push({ caseId, blocks: withRule.geometry.length })
  }
  // The A/B must be able to see the rule at all: the cap has to change the measure.
  await mountReaderCase(mount, "noImage", 100)
  const capped = readerMeasureToken(readerBody())
  const legacy = await withReaderMeasureRuleDisabled(() => readerMeasureToken(readerBody()))
  assert(
    capped < legacy - 1,
    `the rule toggle is ineffective: ${capped.toFixed(1)}px with, ${legacy.toFixed(1)}px without at Article width 100`,
  )
  recordReaderMeasure("parity75", checked)
}
const readerLineLengths = (paragraph) => {
  const range = document.createRange()
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  const lines = []
  let previousCenter = null
  const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight) || 24
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let offset = 0
    for (const character of node.textContent) {
      range.setStart(node, offset)
      range.setEnd(node, offset + character.length)
      offset += character.length
      const [rect] = range.getClientRects()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        continue
      }
      const center = rect.top + rect.height / 2
      if (previousCenter === null || center - previousCenter > lineHeight * 0.6) {
        lines.push("")
      }
      lines[lines.length - 1] += character
      previousCenter = center
    }
  }
  return lines.map((line) => line.trimEnd().length)
}
const runReaderMeasureCpl = async (mount) => {
  const cases = [
    [readerFixtures, "noImage"],
    [readerFixtures, "longForm"],
    [readerTypographyFixtures, "typographyNormal"],
  ]
  const report = []
  for (const [fixtures, caseId] of cases) {
    await mountReaderCase(mount, caseId, 75, { fixtures })
    for (const articleWidth of READER_MEASURE_CPL_WIDTHS) {
      await setReaderArticleWidth(articleWidth)
      const body = readerBody()
      const sample = sampleReaderMeasure(articleWidth)
      const paragraphs = [...body.querySelectorAll("p")].filter((node) => isProseBlock(node))
      const lengths = paragraphs.flatMap((node) => readerLineLengths(node))
      assert(
        lengths.length >= 4,
        `${caseId}@${articleWidth} produced ${lengths.length} measurable lines`,
      )
      const longest = Math.max(...lengths)
      assert(
        longest <= READER_MEASURE_CPL_LIMIT,
        `${caseId}@${articleWidth}: ${longest} characters on one line; the limit is ${READER_MEASURE_CPL_LIMIT}`,
      )
      if (sample.frame >= sample.tokenPx) {
        // Not vacuous: when the column is free to reach its measure, lines really fill it.
        assert(
          longest >= 40,
          `${caseId}@${articleWidth}: longest line is only ${longest} characters; the CPL probe is not measuring a full column`,
        )
      }
      report.push({
        caseId,
        articleWidth,
        longest,
        lines: lengths.length,
        chPx: Number(sample.chPx.toFixed(2)),
        measureCh: Number(sample.tokenCh.toFixed(2)),
      })
    }
  }
  await setReaderArticleWidth(75)
  recordReaderMeasure("cpl", report)
}
// READER-VISUAL-02A2 checks the production header column against the first real prose block at each
// Article width setting; neither a detached probe nor the broader header frame can satisfy this gate.
const runReaderMeasureHeaderBodyAlignment = async (mount) => {
  await mountReaderCase(mount, "longHeadline", 75)
  const header = document.querySelector(".article-container .article-header")
  assert(header, "Reader header missing")
  const headerColumn = header.querySelector(":scope > .article-header-column")
  assert(headerColumn, "Production article header column missing")
  const body = readerBody()
  assert(body, "Reader body missing")
  const report = []
  for (const articleWidth of READER_MEASURE_HEADER_WIDTHS) {
    await setReaderArticleWidth(articleWidth)
    const bodyToken = readerMeasureToken(body)
    const headerToken = readerMeasureToken(headerColumn)
    const bodyCh = bodyToken / readerChPx(body)
    const headerCh = headerToken / readerChPx(headerColumn)
    assert(
      Math.abs(headerCh - bodyCh) < 0.005 &&
        Math.abs(headerCh - readerMeasureCh(articleWidth)) < 0.005,
      `Article width ${articleWidth}: production header column ${headerCh.toFixed(3)}ch, body ${bodyCh.toFixed(3)}ch, contract ${readerMeasureCh(articleWidth).toFixed(3)}ch`,
    )
    assert(
      Math.abs(headerToken - bodyToken) < 0.05,
      `Article width ${articleWidth}: production header measure ${headerToken.toFixed(2)}px does not match body measure ${bodyToken.toFixed(2)}px`,
    )

    const firstProse = [...body.querySelectorAll("p")].find((node) => isProseBlock(node))
    assert(firstProse, `Article width ${articleWidth}: reader has no prose paragraph to align`)
    const headerFrameRect = header.getBoundingClientRect()
    const headerColumnRect = headerColumn.getBoundingClientRect()
    const bodyFrameRect = body.getBoundingClientRect()
    const proseRect = firstProse.getBoundingClientRect()
    const leftDelta = headerColumnRect.left - proseRect.left
    const rightDelta = headerColumnRect.right - (proseRect.left + proseRect.width)
    assert(
      Math.abs(leftDelta) < 2 && Math.abs(rightDelta) < 2,
      `Article width ${articleWidth}: header/prose edges differ by ${leftDelta.toFixed(2)}px left and ${rightDelta.toFixed(2)}px right`,
    )

    const headerStyle = getComputedStyle(headerColumn)
    const title = headerColumn.querySelector(".article-title")
    const sourceLink = headerColumn.querySelector(".article-source a[href^='/feed/']")
    const metadata = headerColumn.querySelector(".article-meta")
    const dates = headerColumn.querySelectorAll(".article-date")
    assert(title, "Reader title missing from header column")
    assert(
      title.scrollWidth <= title.clientWidth + 1,
      `Article width ${articleWidth}: long title overflows its column (${title.scrollWidth}px > ${title.clientWidth}px)`,
    )
    assert(sourceLink, "Reader source link missing from editorial header")
    assert(metadata && dates.length === 2, "Reader author/category/date metadata changed")
    assert(
      Boolean(sourceLink.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(title.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(metadata.compareDocumentPosition(dates[0]) & Node.DOCUMENT_POSITION_FOLLOWING),
      "Reader editorial order must be source, title, author/category metadata, then dates",
    )
    assert(
      readerContent().querySelectorAll("h1").length === 1,
      "Reader must keep exactly one top-level article title",
    )
    assert(
      header.style.textAlign === settingsState.get().titleAlignment,
      `Article width ${articleWidth}: header no longer follows the saved title alignment`,
    )
    assert(
      getComputedStyle(title).textAlign === getComputedStyle(header).textAlign,
      `Article width ${articleWidth}: title alignment no longer follows the saved setting`,
    )
    assert(
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      `Article width ${articleWidth}: reader introduced horizontal overflow`,
    )
    report.push({
      articleWidth,
      headerFrameWidth: Number(headerFrameRect.width.toFixed(2)),
      headerColumnWidth: Number(headerColumnRect.width.toFixed(2)),
      bodyFrameWidth: Number(bodyFrameRect.width.toFixed(2)),
      proseWidth: Number(proseRect.width.toFixed(2)),
      proseMeasure: Number(headerToken.toFixed(2)),
      headerBodyLeftEdgeDelta: Number(leftDelta.toFixed(2)),
      headerBodyRightEdgeDelta: Number(rightDelta.toFixed(2)),
      titleAlignment: headerStyle.textAlign,
    })
  }
  const savedAlignment = settingsState.get().titleAlignment
  const alignmentSettings = []
  try {
    for (const titleAlignment of ["left", "center"]) {
      settingsState.set({ ...settingsState.get(), titleAlignment })
      await waitFor(
        () => readerContent()?.querySelector(".article-header")?.style.textAlign === titleAlignment,
        `saved title alignment ${titleAlignment} did not reach the Reader`,
      )
      const currentHeader = readerContent().querySelector(".article-header")
      const currentTitle = currentHeader.querySelector(".article-title")
      assert(
        getComputedStyle(currentTitle).textAlign === getComputedStyle(currentHeader).textAlign,
        `Title alignment ${titleAlignment} did not pass through the header column`,
      )
      alignmentSettings.push({
        setting: titleAlignment,
        computed: getComputedStyle(currentTitle).textAlign,
      })
    }
  } finally {
    settingsState.set({ ...settingsState.get(), titleAlignment: savedAlignment })
    await waitFor(
      () => readerContent()?.querySelector(".article-header")?.style.textAlign === savedAlignment,
      "saved title alignment was not restored after the harness case",
    )
  }
  await setReaderArticleWidth(75)
  recordReaderMeasure("headerBodyAlignment", {
    productionHeaderColumnPresent: Boolean(
      document.querySelector(".article-header-column:not([data-measure-probe])"),
    ),
    alignmentSettings,
    report,
  })
}
const readerSurfaces = (body, selector) =>
  [...body.querySelectorAll(selector)].map((node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      tag: node.tagName,
      className: String(node.className),
      left: rect.left,
      width: rect.width,
      height: rect.height,
      overflowX: style.overflowX,
      whiteSpace: style.whiteSpace,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }
  })
const assertSameSurfaces = (label, withRule, withoutRule) => {
  assert(
    withRule.length === withoutRule.length,
    `${label}: ${withRule.length} surfaces with the rule, ${withoutRule.length} without`,
  )
  for (const [index, surface] of withRule.entries()) {
    const reference = withoutRule[index]
    for (const key of ["left", "width", "height"]) {
      assert(
        Math.abs(surface[key] - reference[key]) <= READER_MEASURE_TOLERANCE,
        `${label}: ${surface.tag}.${surface.className} ${key} is ${surface[key].toFixed(1)}px with the rule and ${reference[key].toFixed(1)}px without it`,
      )
    }
    for (const key of ["overflowX", "whiteSpace", "scrollWidth", "clientWidth"]) {
      assert(
        surface[key] === reference[key],
        `${label}: ${surface.tag}.${surface.className} ${key} is ${surface[key]} with the rule and ${reference[key]} without it`,
      )
    }
  }
}
const runReaderMeasureProtection = async (mount, { name, caseIds, selector, absolute }) => {
  const report = []
  for (const caseId of caseIds) {
    await mountReaderCase(mount, caseId, 75)
    for (const articleWidth of READER_MEASURE_PROTECTED_WIDTHS) {
      await setReaderArticleWidth(articleWidth)
      const label = `${name} ${caseId}@${articleWidth}`
      const sample = sampleReaderMeasure(articleWidth)
      const withRule = readerSurfaces(readerBody(), selector)
      assert(withRule.length > 0, `${label} has no protected surfaces`)
      const withoutRule = await withReaderMeasureRuleDisabled(() =>
        readerSurfaces(readerBody(), selector),
      )
      assertSameSurfaces(label, withRule, withoutRule)
      absolute({ label, caseId, articleWidth, sample, surfaces: withRule })
      report.push({ caseId, articleWidth, surfaces: withRule.length })
    }
  }
  await setReaderArticleWidth(75)
  recordReaderMeasure(name, report)
}
const runReaderMeasureMediaProtection = (mount) =>
  runReaderMeasureProtection(mount, {
    name: "media",
    caseIds: ["wideImage", "portraitImage", "longForm"],
    selector: READER_MEASURE_MEDIA,
    absolute: ({ label, caseId, sample, surfaces }) => {
      for (const surface of surfaces) {
        const right = surface.left + surface.width
        const bodyLeft = readerBody().getBoundingClientRect().left
        const tolerance = surface.tag === "IFRAME" ? 5 : 1
        assert(
          surface.left >= bodyLeft - tolerance && right <= bodyLeft + sample.frame + tolerance,
          `${label}: ${surface.tag} escaped the reader frame`,
        )
      }
      if (caseId === "wideImage") {
        for (const image of surfaces.filter(({ tag }) => tag === "IMG")) {
          assert(
            Math.abs(image.width - Math.min(sample.frame, 1600)) < 2,
            `${label}: wide image is ${image.width.toFixed(1)}px; expected the frame ${sample.frame.toFixed(1)}px, not the ${sample.tokenPx.toFixed(1)}px prose measure`,
          )
        }
      }
    },
  })
const runReaderMeasureTableProtection = (mount) =>
  runReaderMeasureProtection(mount, {
    name: "table",
    caseIds: ["longForm"],
    selector: READER_MEASURE_TABLE,
    absolute: ({ label, sample, surfaces }) => {
      const wrapper = surfaces.find(({ className }) => className.includes("article-table-scroll"))
      assert(wrapper, `${label} has no table scroll wrapper`)
      assert(
        Math.abs(wrapper.width - sample.frame) < 2,
        `${label}: table wrapper is ${wrapper.width.toFixed(1)}px; expected the frame ${sample.frame.toFixed(1)}px`,
      )
      assert(
        ["auto", "scroll"].includes(wrapper.overflowX),
        `${label}: table wrapper lost its horizontal overflow (${wrapper.overflowX})`,
      )
    },
  })
const runReaderMeasurePreCodeProtection = (mount) =>
  runReaderMeasureProtection(mount, {
    name: "preCode",
    caseIds: ["longForm"],
    selector: READER_MEASURE_CODE,
    absolute: ({ label, sample, surfaces }) => {
      const pre = surfaces.find(({ tag }) => tag === "PRE")
      assert(pre, `${label} has no pre surface`)
      assert(
        Math.abs(pre.width - sample.frame) < 2,
        `${label}: pre is ${pre.width.toFixed(1)}px; expected the frame ${sample.frame.toFixed(1)}px`,
      )
      assert(
        ["auto", "scroll"].includes(pre.overflowX) && pre.whiteSpace.startsWith("pre"),
        `${label}: pre lost its overflow or white-space behavior (${pre.overflowX}, ${pre.whiteSpace})`,
      )
    },
  })

const runReaderScrollUnderGlass = async (mount) => {
  await mountReaderCase(mount, "longForm")
  const container = document.querySelector(".article-container")
  const scrollElement = readerScrollElement(container)
  const chrome = container.querySelector(".action-buttons")
  assert(chrome, "Reader chrome missing")
  const before = chrome.getBoundingClientRect()
  scrollElement.scrollTop = 900
  await settle()
  const after = chrome.getBoundingClientRect()
  assert(scrollElement.scrollTop > 0, "Reader did not scroll")
  assert(Math.abs(after.top - before.top) < 2, "Reader chrome did not stay pinned while scrolling")
  const underneath = [...container.querySelectorAll(".article-body p")].some((node) => {
    const rect = node.getBoundingClientRect()
    return rect.top < after.bottom && rect.bottom > after.top
  })
  assert(underneath, "Article content does not pass under the reader chrome")
  assert(
    Boolean(chrome.querySelector(".nf-glass-group, .nf-glass-control")),
    "Reader chrome lost its glass treatment",
  )
}
const MATRIX_RUNS_STORAGE_KEY = "phase2c-editorial-home-task10-matrix-runs-v1"
const matrixPairId = (viewport, theme) => `${viewport.width}x${viewport.height}:${theme}`
const readMatrixRuns = () => {
  try {
    return JSON.parse(sessionStorage.getItem(MATRIX_RUNS_STORAGE_KEY) ?? "{}")
  } catch {
    return {}
  }
}
const resetHarness = () => {
  globalThis.sessionStorage.removeItem(MATRIX_RUNS_STORAGE_KEY)
  globalThis.location.reload()
}
const captureHomeHarnessMetrics = (theme) => {
  const state = contentState.get()
  const home = homeRoot()
  const root = scrollRoot()
  const renderedEntryIds = [...document.querySelectorAll(".article-entry[data-entry-id]")].map(
    (node) => Number(node.dataset.entryId),
  )
  const countQueries = listRequests()
    .map((request) => Object.fromEntries(new URL(request, "https://fixture.invalid").searchParams))
    .filter((params) => params.limit === "1")
  const recentRows = [...document.querySelectorAll(".home-recent .article-card-grid-row")]
  const recentColumns = recentRows.map((row) => {
    const value = Number.parseInt(row.style.getPropertyValue("--article-card-grid-columns"), 10)
    return Number.isFinite(value)
      ? value
      : getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length
  })
  const scrollRect = root?.getBoundingClientRect()
  return {
    viewport: { width: innerWidth, height: innerHeight },
    theme,
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    },
    sectionOrder: [...(home?.querySelectorAll("section[aria-label]") ?? [])].map((section) =>
      section.getAttribute("aria-label"),
    ),
    duplicateEntryIds: renderedEntryIds.length - new Set(renderedEntryIds).size,
    domCounts: {
      highlights: cards().length,
      recent: recentIds().length,
      entries: renderedEntryIds.length,
      sentinels: sentinels().length,
    },
    recentColumns,
    countQueryVisibility: countQueries,
    canonicalEntryQueryCount: canonicalEntryRequests().length,
    starredProfileQueryCount: starredProfileRequests().length,
    loadedEligibleUnreadIds: new Set(
      state.entries.filter((entry) => entry.status === "unread").map((entry) => entry.id),
    ).size,
    pageSize: settingsState.get().pageSize,
    loadMoreVisible: state.loadMoreVisible,
    listState: { total: state.total, isArticleListReady: state.isArticleListReady },
    scrollRoot: root
      ? {
          clientWidth: root.clientWidth,
          clientHeight: root.clientHeight,
          scrollWidth: root.scrollWidth,
          scrollHeight: root.scrollHeight,
          scrollTop: Math.round(root.scrollTop),
          bounds: scrollRect
            ? {
                x: Math.round(scrollRect.x),
                y: Math.round(scrollRect.y),
                width: Math.round(scrollRect.width),
                height: Math.round(scrollRect.height),
              }
            : null,
        }
      : null,
    firstSectionClearance: (() => {
      const chrome = home?.querySelector(".search-and-sort-bar-home")
      const heading = home?.querySelector(".home-highlights .home-section-heading")
      if (!chrome || !heading) {
        return null
      }
      const chromeRect = chrome.getBoundingClientRect()
      const headingRect = heading.getBoundingClientRect()
      return {
        chromeBottom: Math.round(chromeRect.bottom * 100) / 100,
        headingTop: Math.round(headingRect.top * 100) / 100,
        gap: Math.round((headingRect.top - chromeRect.bottom) * 100) / 100,
      }
    })(),
  }
}
const loadNextPage = async (loadedCount) => {
  const root = scrollRoot()
  assert(root && sentinels().length === 1, "Expected one Home pagination sentinel")
  root.scrollTop = root.scrollHeight
  sentinels()[0].scrollIntoView({ block: "end" })
  deferredPagination?.resolve()
  deferredPagination = null
  root.dispatchEvent(new Event("scroll"))
  await waitFor(
    () => contentState.get().entries.length > loadedCount,
    "Home sentinel did not append the next page",
  )
  await settle()
}
const clickMenu = (label) => {
  const item = [...document.querySelectorAll('.mobile-action-menu [role="menuitem"]')].find(
    (node) => node.textContent.includes(label),
  )
  assert(item, `Missing existing menu action ${label}`)
  item.click()
}

const openMenu = async (id) => {
  const card = cards().find((node) => Number(node.dataset.entryId) === id)
  assert(card, `Missing Highlight ${id}`)
  card.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 350,
      clientY: 250,
    }),
  )
  await waitFor(
    () => document.querySelector(".mobile-action-menu"),
    "Existing ArticleEntry menu did not open",
  )
}

const Harness = () => {
  const [probe, setProbe] = useState(null)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])
  const [selectedTheme, setSelectedTheme] = useState(() =>
    new URLSearchParams(globalThis.location.search).get("theme") === "dark" ? "dark" : "light",
  )
  const [matrixRuns, setMatrixRuns] = useState(readMatrixRuns)
  const mount = async (
    path = "/",
    {
      identity = "ready",
      queryError = false,
      catalogError = false,
      entries = routeEntries,
      total = 2,
      markReadBy = "manually",
      pageSize = getDefaultSettings().pageSize,
      showStatus = getDefaultSettings().showStatus,
      pages = null,
      strictHomePagination: useStrictHomePagination = false,
      deferInitial = false,
      emptyPagePagination: nextEmptyPagePagination = false,
      layout = getDefaultSettings().articleListLayout,
      enableSwipeGesture = getDefaultSettings().enableSwipeGesture,
      orderBy = getDefaultSettings().orderBy,
      orderDirection = getDefaultSettings().orderDirection,
      personalization = null,
      articleWidth = getDefaultSettings().articleWidth,
      fontSize = getDefaultSettings().fontSize,
    } = {},
  ) => {
    setProbe(null)
    await settle()
    router?.dispose()
    resetContent()
    resetData()
    requests.length = 0
    identityRetries = 0
    articleFailure = queryError
    fixtureEntries = entries.map((entry) => ({ ...entry }))
    fixtureTotal = total
    paginationPages = pages?.map((page) => page.map((entry) => ({ ...entry }))) ?? null
    strictHomePagination = useStrictHomePagination
    deferredPagination = pages?.length
      ? (() => {
          let release
          const promise = new Promise((resolve) => {
            release = resolve
          })
          return { promise, resolve: release }
        })()
      : null
    deferredArticleQuery = deferInitial ? createDeferred() : null
    starredProfileEntries = (personalization?.entries ?? []).map((entry) => ({ ...entry }))
    starredProfileMode = personalization?.mode ?? "resolved"
    deferredStarredProfile = starredProfileMode === "deferred" ? createDeferred() : null
    failPagination = false
    emptyPagePagination = nextEmptyPagePagination
    initialHomeQueryServed = false
    failStatusMutation = false
    starMutationRequests = 0
    statusMutationRequests = 0
    deferredFirstStatusMutation = null
    rejectStatusMutationCall = null
    failCount = false
    deferredCount = null
    unloadedStatus = "read"
    authState.set(fixtureAuth)
    settingsState.set({
      ...getDefaultSettings(),
      markReadBy,
      pageSize,
      showStatus,
      articleListLayout: layout,
      orderBy,
      orderDirection,
      removeDuplicates: "none",
      enableContextMenu: true,
      showFeedIcon: true,
      enableSwipeGesture,
      articleWidth,
      fontSize,
    })
    if (identity === "ready") {
      commitIdentityData({ id: 1, username: "fixture" })
    } else {
      setDataResourceLoadState("identity", {
        activity: identity === "loading" ? "loading" : "idle",
        error: identity === "error" ? new Error("Expected local identity failure") : null,
      })
    }
    feedIconsState.setKey(991, {
      height: 16,
      width: 16,
      url: `${globalThis.location.origin}/default-feed-icon.png`,
    })
    const hiddenProfileFeed = personalization?.hiddenFeedId
      ? {
          ...fixtureFeed,
          id: personalization.hiddenFeedId,
          title: `Hidden profile source ${personalization.hiddenFeedId}`,
          hide_globally: true,
          category: {
            id: personalization.hiddenFeedId,
            title: `Hidden profile category ${personalization.hiddenFeedId}`,
          },
        }
      : null
    const fixtureFeeds = [fixtureFeed, ...(hiddenProfileFeed ? [hiddenProfileFeed] : [])]
    dataState.setKey("feedsData", fixtureFeeds)
    dataState.setKey(
      "categoriesData",
      fixtureFeeds.map(({ category }) => category),
    )
    setDataResourceLoadState("catalog", {
      error: catalogError ? new Error("Expected local catalog failure") : null,
    })
    router = createMemoryRouter(
      [
        { Component: FixtureFrame, children: contentRoutes },
        { path: "/login", element: <p>Local login destination</p> },
      ],
      { initialEntries: [path] },
    )
    setProbe({ router, key: performance.now() })
    await waitFor(() => router.state.initialized, "Content route did not initialize")
    await settle()
  }
  const scenarios = [
    [
      "HOME_ROUTE_ROOT_AND_READER_RETURN",
      async () => {
        await mount()
        assert(router.state.location.pathname === "/" && homeRoot(), "Root did not render Home")
        await waitFor(() => contentState.get().isArticleListReady, "Home list did not load")
        clickLabel("Open local Home article")
        await waitFor(() => readerIs(101), "Root reader 101 did not render")
        assert(
          router.state.location.pathname === "/entry/101",
          "Home open action joined the wrong reader URL",
        )
        clickLabel(englishPhrases.article_card.close_tooltip)
        await waitFor(
          () =>
            router.state.location.pathname === "/" &&
            !contentState.get().activeContent &&
            !document.querySelector(".article-container"),
          "Reader close did not return to slash",
        )
        await navigate(-1)
        await waitFor(() => readerIs(101), "History Back did not reopen 101")
        await navigate(1)
        assert(
          router.state.location.pathname === "/" && !contentState.get().activeContent,
          "History Forward did not close reader",
        )
      },
    ],
    [
      "HOME_SESSION_STABLE_AFTER_READER_READ",
      async () => {
        const entries = highlightFixtures.image.filter(
          (entry, index, all) => all.findIndex(({ id }) => id === entry.id) === index,
        )
        const unreadTotal = entries.filter(({ status }) => status === "unread").length
        await mount("/", { entries, total: unreadTotal, markReadBy: "view" })
        await waitFor(
          () => homeRoot()?.getAttribute("aria-busy") === "false",
          "Home did not commit",
        )
        const homeBeforeReaderIds = ids()
        const homeBeforeReader = homeBeforeReaderIds.join(",")
        assert(homeBeforeReader === "101,202,303", `Unexpected committed Home: ${homeBeforeReader}`)
        await waitFor(
          () => starredProfileRequests().length === 1,
          "Initial profile request missing",
        )
        const profileRequestsBeforeReader = starredProfileRequests().length

        cards()[0].click()
        await waitFor(() => readerIs(101), "Committed Primary reader did not open")
        await waitFor(
          () =>
            statusMutationRequests === 1 &&
            contentState.get().entries.find(({ id }) => id === 101)?.status === "read",
          "Reader open did not settle the normal mark-as-read behavior",
        )
        clickLabel(englishPhrases.article_card.close_tooltip)
        await waitFor(
          () =>
            router.state.location.pathname === "/" &&
            !contentState.get().activeContent &&
            ids().join(",") === homeBeforeReader,
          "Reader did not close to the committed Home session",
        )

        const homeAfterReaderIds = ids()
        const homeAfterReader = homeAfterReaderIds.join(",")
        const readPrimary = contentState.get().entries.find(({ id }) => id === 101)
        const otherEntryIdsReordered =
          homeBeforeReaderIds.filter((id) => id !== 101).join(",") !==
          homeAfterReaderIds.filter((id) => id !== 101).join(",")
        globalThis.__phase2dReaderReturnStability = {
          homeBeforeReader,
          homeAfterReader,
          readStatus: readPrimary?.status,
          membershipChanged:
            [...homeBeforeReaderIds].toSorted().join(",") !==
            [...homeAfterReaderIds].toSorted().join(","),
          otherEntryIdsReordered,
          rankingRecomposed: starredProfileRequests().length !== profileRequestsBeforeReader,
        }
        assert(
          homeAfterReader === homeBeforeReader,
          "Reader return changed committed Home IDs/order",
        )
        assert(
          readPrimary?.status === "read",
          "Committed Primary did not expose its updated read state",
        )
        assert(ids().includes(101), "Read Primary disappeared from committed Home")
        assert(
          starredProfileRequests().length === profileRequestsBeforeReader,
          "Reader read/close requested another profile or recomposed ranking",
        )
        assert(
          !otherEntryIdsReordered,
          "Reader read changed the relative order of other Home entries",
        )
      },
    ],
    [
      "HOME_READER_PARAM_BRIDGE",
      async () => {
        await mount("/entry/101", { enableSwipeGesture: false })
        await waitFor(() => readerIs(101), "Home parent did not forward child ID 101 into Content")
        await waitFor(() => contentState.get().isArticleListReady, "Reader list did not load")
        clickLabel(englishPhrases.article_card.next_tooltip)
        await waitFor(() => readerIs(202), "Next reader action did not display 202")
        assert(
          router.state.location.pathname === "/entry/202",
          "Next reader action lost Home origin",
        )
        clickLabel(englishPhrases.article_card.previous_tooltip)
        await waitFor(() => readerIs(101), "Previous reader action did not display 101")
        assert(
          router.state.location.pathname === "/entry/101",
          "Previous reader action lost Home origin",
        )
        await mount("/entry/202", { enableSwipeGesture: false })
        await waitFor(() => readerIs(202), "Direct root reader 202 did not render")
        assert(router.state.location.pathname === "/entry/202", "Direct reader URL changed")
      },
    ],
    [
      "HOME_PARENT_MOUNT_PRESERVATION",
      async () => {
        await mount()
        const parent = homeRoot()
        assert(parent, "Home session parent missing")
        const token = instanceToken(parent)
        await waitFor(
          () => contentState.get().isArticleListReady,
          "Home initial query did not complete",
        )
        const initialQueries = requests.filter((url) => url.startsWith("/v1/entries?")).length
        const scrollRoot = parent.querySelector(".simplebar-content-wrapper, [data-native-scroll]")
        assert(scrollRoot, "Home scroll root missing")
        await navigate("/entry/101")
        await waitFor(() => readerIs(101), "Mounted Home reader did not render")
        assert(
          homeRoot() === parent && instanceToken(homeRoot()) === token,
          "Reader navigation replaced Home session instance",
        )
        await navigate("/")
        assert(
          homeRoot() === parent && instanceToken(homeRoot()) === token,
          "Return replaced Home session instance",
        )
        assert(
          parent.querySelector(".simplebar-content-wrapper, [data-native-scroll]") === scrollRoot,
          "Return replaced Home scroll root",
        )
        assert(
          requests.filter((url) => url.startsWith("/v1/entries?")).length === initialQueries,
          "Reader visit implicitly refreshed the Home query",
        )
      },
    ],
    [
      "HOME_LOGO_ROOT",
      async () => {
        await mount("/entry/101")
        setCurrentHomeTarget({ type: "view", id: "today" })
        await settle()
        const brand = document.querySelector(".home-brand")
        assert(brand && !brand.disabled, "Home brand unavailable")
        brand.click()
        await waitFor(
          () => router.state.location.pathname === "/",
          "Home brand followed post-login preference instead of root",
        )
      },
    ],
    [
      "HOME_IDENTITY_FAILURE_RECOVERY",
      async () => {
        await mount("/", { identity: "loading" })
        assert(
          document.querySelector(".route-loading-state"),
          "Home identity loading state missing",
        )
        assert(requests.length === 0, "Home queried before identity readiness")
        for (const path of ["/", "/entry/202"]) {
          await mount(path, { identity: "error" })
          assert(
            router.state.location.pathname === path,
            "Identity failure redirected direct route",
          )
          assert(requests.length === 0 && !homeRoot(), "Identity failure started Home query")
          clickLabel(englishPhrases.actions.retry)
          await waitFor(
            () => identityRetries === 1 && homeRoot(),
            "Identity retry did not recover Home",
          )
          await mount(path, { identity: "error" })
          clickLabel(englishPhrases.sidebar.logout)
          await waitFor(
            () => router.state.location.pathname === "/login",
            "Identity logout unavailable",
          )
          assert(router.state.location.state?.from === path, "Logout lost Home login return path")
          assert(
            authState.get().server === "" && dataState.get().currentUser === null,
            "Logout did not clear session",
          )
        }
        await mount("/entry/202", { queryError: true, catalogError: true })
        await waitFor(() => contentState.get().articleListError, "Article-query failure missing")
        assert(
          router.state.location.pathname === "/entry/202",
          "Article-query error changed direct route",
        )
        assert(
          !document.querySelector(".home-identity-notice"),
          "Article-query error became identity recovery",
        )
        assert(
          homeRoot() && requests.some((url) => url.startsWith("/v1/entries?")),
          "Catalog failure blocked canonical Home query",
        )
      },
    ],
    [
      "HOME_LAST_READ_TRANSITIONS_TO_TUDO_EM_DIA",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(
          () => contentState.get().total === 0,
          "Confirmed last read did not reconcile canonical zero",
        )
        assert(contentState.get().loadMoreVisible === false, "Zero total retained pagination")
        assert(
          ids().join(",") === "101" && !cards()[0]?.classList.contains("unread"),
          "Zero unread replaced the committed Home projection instead of retaining its read card",
        )
        assert(
          requests.some(
            (url) => new URL(url, "https://fixture.invalid").searchParams.get("limit") === "1",
          ),
          "Canonical count request missing",
        )
      },
    ],
    [
      "HOME_READ_FAILURE_DOES_NOT_ZERO_TOTAL",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        failStatusMutation = true
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(
          () => contentState.get().entries[0]?.status === "unread",
          "Rejected read did not roll back",
        )
        await new Promise((resolve) => setTimeout(resolve, 220))
        assert(contentState.get().total === 1, "Rejected read replaced valid total")
        assert(
          !requests.some(
            (url) => new URL(url, "https://fixture.invalid").searchParams.get("limit") === "1",
          ),
          "Rejected read issued canonical count",
        )
      },
    ],
    [
      "HOME_COUNT_FAILURE_PRESERVES_TOTAL_AND_PAGINATION",
      async () => {
        await mount("/", { entries: paginationEntries(20), total: 21, pageSize: 20 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        assert(contentState.get().loadMoreVisible, "Fixture did not start with pagination")
        const initialRequests = listRequests().length
        failCount = true
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(() => listRequests().length > initialRequests, "Failed count request missing")
        await settle()
        assert(
          contentState.get().total === 21 && contentState.get().loadMoreVisible,
          "Failed count replaced valid total or pagination",
        )
      },
    ],
    [
      "HOME_MARK_UNREAD_RECONCILES_TOTAL",
      async () => {
        await mount()
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(() => contentState.get().total === 1, "Read did not settle")
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "unread")
        await waitFor(() => contentState.get().total === 2, "Unread did not reconcile total")
      },
    ],
    [
      "HOME_REJECTED_UNREAD_REVERSAL_RECONCILES_CONFIRMED_READ",
      async () => {
        const entries = [
          routeEntries[0],
          routeEntries[1],
          { ...routeEntries[0], id: 303, title: "Third loaded article" },
          { ...routeEntries[0], id: 404, title: "Loaded Recent article" },
        ]
        await mount("/", { entries, total: 4 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        let releaseFirstMutation
        deferredFirstStatusMutation = {
          promise: new Promise((resolve) => {
            releaseFirstMutation = resolve
          }),
        }
        rejectStatusMutationCall = 2
        let observedSession = createHomeEditorialSession({
          requestKey: "fixture",
          sessionRevision: dataState.get().sessionRevision,
          entries: contentState.get().entries,
        })
        const unsubscribe = subscribeEntryStatusMutationEvents((statusEvent) => {
          observedSession = transitionHomeSession(
            observedSession,
            statusEvent,
            contentState.get().entries,
          )
        })
        try {
          updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
          await waitFor(() => statusMutationRequests === 1, "Read request did not start")
          updateEntriesStatusOptimistically([contentState.get().entries[0]], "unread")
          assert(
            JSON.stringify(
              projectHomeSession(observedSession, contentState.get().entries).highlightIds,
            ) === JSON.stringify([101, 202, 303]),
            "Queued reversal changed Highlight placement before settlement",
          )
          releaseFirstMutation()
          await waitFor(() => statusMutationRequests === 2, "Queued unread request did not start")
          await waitFor(
            () =>
              contentState.get().total === 3 &&
              contentState.get().entries.find(({ id }) => id === 101)?.status === "read" &&
              observedSession.highlightIds[0] === 101,
            "Rejected reversal did not reconcile the confirmed read",
          )
          assert(
            JSON.stringify(
              projectHomeSession(observedSession, contentState.get().entries).highlightIds,
            ) === JSON.stringify([101, 202, 303]),
            "Confirmed read changed the committed Highlight membership/order",
          )
          assert(
            Object.keys(observedSession.pendingStatusById).length === 0 &&
              fixtureEntries.find(({ id }) => id === 101).status === "read" &&
              fixtureTotal === 3,
            "Rejected unread status or pending mutation survived",
          )
        } finally {
          unsubscribe()
          releaseFirstMutation()
        }
      },
    ],
    [
      "HOME_UNLOADED_MARK_UNREAD_REENABLES_PAGINATION",
      async () => {
        await mount("/", { entries: paginationEntries(20), total: 20, pageSize: 20 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        const ids = contentState.get().entries.map(({ id }) => id)
        const requestCount = requests.length
        updateEntriesStatusOptimistically(
          [{ ...routeEntries[0], id: 303, status: "read" }],
          "unread",
        )
        await waitFor(
          () => contentState.get().total === 21,
          `Unread count did not grow: total=${contentState.get().total}, entries=${contentState.get().entries.length}, pageSize=${settingsState.get().pageSize}, requests=${requests.length}`,
        )
        assert(
          JSON.stringify(contentState.get().entries.map(({ id }) => id)) === JSON.stringify(ids),
          "Unloaded record was inserted",
        )
        assert(contentState.get().loadMoreVisible, "Unread count growth did not expose pagination")
        assert(
          requests.length === requestCount + 1 &&
            requests.every((url) => !url.includes("/v1/entries/303")),
          "Unloaded unread triggered an entry fetch",
        )
      },
    ],
    [
      "HOME_TOTAL_RECONCILIATION_STALE_SESSION_PROTECTED",
      async () => {
        await mount("/", { entries: paginationEntries(20), total: 20, pageSize: 20 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        const initialRequests = listRequests().length
        let resolveCount
        deferredCount = {
          promise: new Promise((resolve) => {
            resolveCount = resolve
          }),
        }
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(() => listRequests().length > initialRequests, "Deferred count did not start")
        fixtureTotal = 30
        settingsState.set({ ...settingsState.get(), showHiddenFeeds: true })
        await waitFor(
          () => contentState.get().isArticleListReady && contentState.get().total === 30,
          `New Home session did not commit: total=${contentState.get().total}, entries=${contentState.get().entries.length}, pageSize=${settingsState.get().pageSize}, ready=${contentState.get().isArticleListReady}, requests=${listRequests().length}`,
        )
        resolveCount({ entries: [], total: 0 })
        await settle()
        assert(
          contentState.get().total === 30 && contentState.get().loadMoreVisible,
          "Old count mutated newer Home session",
        )
      },
    ],
    [
      "HOME_READ_ON_VIEW_STATUS_PATH",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1, markReadBy: "view" })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        clickLabel("Open local Home article")
        await waitFor(
          () => contentState.get().total === 0,
          "Read-on-view did not use Home count path",
        )
      },
    ],
    [
      "HOME_READER_STATUS_ACTION_PATH",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        clickLabel("Open local Home article")
        await waitFor(() => readerIs(101), "Reader did not open")
        clickLabel(englishPhrases.article_card.mark_as_read_tooltip)
        await waitFor(
          () => contentState.get().total === 0,
          "Reader status action did not use Home count path",
        )
      },
    ],
    [
      "HOME_CARD_STATUS_ACTION_PATH",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        clickLabel("Fixture card status action")
        await waitFor(
          () => contentState.get().total === 0,
          "Card action path did not reconcile total",
        )
      },
    ],
    [
      "HOME_MARK_READ_ON_SCROLL_STATUS_PATH",
      async () => {
        await mount("/", { entries: routeEntries.slice(0, 1), total: 1 })
        await waitFor(() => contentState.get().isArticleListReady, "Initial Home page missing")
        clickLabel("Fixture scroll read action")
        await waitFor(
          () => contentState.get().total === 0,
          "Scroll read helper did not reconcile total",
        )
      },
    ],
  ]
  const mountHighlights = async (entries) => {
    await mount("/", {
      entries,
      total: new Set(entries.filter((entry) => entry.status === "unread").map((entry) => entry.id))
        .size,
    })
    await waitFor(
      () => homeRoot()?.getAttribute("aria-busy") === "false",
      "Home session did not become ready",
    )
  }
  const highlightScenarios = [
    [
      "HOME_PRIMARY_NEWEST",
      async () => {
        for (const entries of [highlightFixtures.image, highlightFixtures.textOnly]) {
          await mountHighlights(entries)
          assert(
            cards()[0]?.classList.contains("home-highlight-primary") && ids()[0] === 101,
            "Newest unread entry is not Primary",
          )
          if (entries === highlightFixtures.image) {
            assert(
              cards()[0].querySelector(".grid-card-cover"),
              "Image Primary lost the existing Grid media presenter",
            )
          }
        }
      },
    ],
    [
      "HOME_MAX_THREE_HIGHLIGHTS",
      async () => {
        for (const [entries, count] of [
          [highlightFixtures.image, 3],
          [highlightFixtures.two, 2],
          [highlightFixtures.one, 1],
        ]) {
          await mountHighlights(entries)
          assert(cards().length === count, `Expected ${count} real ArticleEntry Highlights`)
        }
      },
    ],
    [
      "HOME_PRIMARY_TEXT_ONLY",
      async () => {
        await mountHighlights(highlightFixtures.textOnly)
        const primary = cards()[0]
        assert(primary?.classList.contains("home-highlight-primary"), "Text-only Primary missing")
        assert(
          primary.querySelector(".grid-card-content-no-cover") &&
            !primary.querySelector(".grid-card-media, .grid-card-cover"),
          "Text-only Primary reserved empty media",
        )
        assert(
          primary.querySelector(".grid-card-copy")?.textContent.includes("Highlight article 101"),
          "Text-only Primary copy missing",
        )
      },
    ],
    [
      "HOME_SECONDARIES_BALANCED_ORDER",
      async () => {
        for (const entries of [highlightFixtures.image, highlightFixtures.shared]) {
          await mountHighlights(entries)
          assert(
            JSON.stringify(ids()) === "[101,202,303]",
            "Highlights lost deterministic slot order",
          )
          const [first, second] = cards().slice(1)
          assert(
            first.classList.contains("home-highlight-secondary-1") &&
              second.classList.contains("home-highlight-secondary-2"),
            "Secondary slot identities missing",
          )
          assert(
            first.closest(".home-highlight-secondaries") ===
              second.closest(".home-highlight-secondaries") &&
              Math.abs(first.getBoundingClientRect().width - second.getBoundingClientRect().width) <
                1,
            "Secondaries are not equivalent siblings",
          )
        }
        // No Recent candidate remains: Primary and then Secondary 1 must stay vacant.
        await mountHighlights(highlightFixtures.textOnly)
        const committedIds = ids().join(",")
        await openMenu(101)
        clickMenu(englishPhrases.article_card.mark_as_read_tooltip)
        await waitFor(
          () => statusMutationRequests === 1 && contentState.get().total === 2,
          "Primary read did not settle",
        )
        await settle()
        assert(
          ids().join(",") === committedIds &&
            cards()[0]?.classList.contains("home-highlight-primary") &&
            !cards()[0]?.classList.contains("unread"),
          "Confirmed Primary read changed its committed slot or failed to update read styling",
        )
        await openMenu(202)
        clickMenu(englishPhrases.article_card.mark_as_read_tooltip)
        await waitFor(
          () => statusMutationRequests === 2 && contentState.get().total === 1,
          "Secondary read did not settle",
        )
        await settle()
        assert(
          ids().join(",") === committedIds &&
            cards()[1]?.classList.contains("home-highlight-secondary-1") &&
            !cards()[1]?.classList.contains("unread"),
          "Confirmed Secondary read changed its committed slot or failed to update read styling",
        )
      },
    ],
    [
      "HOME_HIGHLIGHT_ACTIONS",
      async () => {
        await mountHighlights(highlightFixtures.textOnly)
        const before = ids().join(",")
        assert(
          cards()[0]?.classList.contains("unread") &&
            cards()[1]?.querySelector(".grid-card-star")?.style.opacity === "1",
          "Existing unread/starred presentation missing",
        )
        cards()[0].focus()
        assert(document.activeElement === cards()[0], "Highlight is not keyboard focusable")
        await openMenu(101)
        clickMenu(englishPhrases.article_card.star_tooltip)
        await waitFor(
          () =>
            starMutationRequests === 1 &&
            contentState.get().entries.find((entry) => entry.id === 101)?.starred,
          "Highlight star action did not use existing mutation",
        )
        await settle()
        assert(
          ids().join(",") === before &&
            cards()[0]?.querySelector(".grid-card-star")?.style.opacity === "1",
          "Star recomposed Highlights or lost presenter status",
        )
        await openMenu(101)
        clickMenu(englishPhrases.article_card.unstar_tooltip)
        await waitFor(
          () =>
            starMutationRequests === 2 &&
            !contentState.get().entries.find((entry) => entry.id === 101)?.starred,
          "Highlight unstar action did not use existing mutation",
        )
        await settle()
        assert(
          ids().join(",") === before &&
            cards()[0]?.querySelector(".grid-card-star")?.style.opacity === "0",
          "Unstar recomposed Highlights or lost presenter status",
        )
        cards()[0].click()
        await waitFor(() => readerIs(101), "Actual Highlight activation did not open reader")
        assert(
          router.state.location.pathname === "/entry/101" &&
            cards()[0]?.classList.contains("selected"),
          "Existing Highlight selection/origin missing",
        )
        clickLabel(englishPhrases.article_card.close_tooltip)
        await waitFor(
          () => router.state.location.pathname === "/",
          "Highlight reader did not close to Home",
        )
        await openMenu(101)
        clickMenu(englishPhrases.article_card.mark_as_read_tooltip)
        await waitFor(
          () => contentState.get().total === 2,
          "Highlight read action did not use existing status mutation",
        )
        await settle()
        assert(
          ids().includes(101) && !cards()[0]?.classList.contains("unread"),
          "Confirmed Highlight read removed the committed card or failed to update read styling",
        )
        await mountHighlights(highlightFixtures.image)
        const stage = document.querySelector(".harness-stage")
        const scrollSpacer = document.createElement("div")
        scrollSpacer.style.height = `${globalThis.innerHeight}px`
        document.body.append(scrollSpacer)
        stage.scrollIntoView({ block: "start" })
        stage.style.height = "320px"
        stage.style.minHeight = "0px"
        settingsState.set({ ...settingsState.get(), markReadOnScroll: true })
        try {
          await settle()
          const scrollRoot = homeRoot().querySelector(
            ".simplebar-content-wrapper, .adaptive-scroll-area-native",
          )
          assert(
            scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight,
            `Highlight scroll root missing: ${scrollRoot?.scrollHeight ?? "none"}/${scrollRoot?.clientHeight ?? "none"}`,
          )
          const primaryRect = homeRoot()
            .querySelector(".home-highlight-slot-primary")
            .getBoundingClientRect()
          const scrollRootRect = scrollRoot.getBoundingClientRect()
          const initiallyVisibleHeight = Math.max(
            0,
            Math.min(primaryRect.bottom, scrollRootRect.bottom, globalThis.innerHeight) -
              Math.max(primaryRect.top, scrollRootRect.top, 0),
          )
          assert(
            initiallyVisibleHeight / primaryRect.height >= 0.2,
            "Primary Highlight must be visible at the read observer threshold before scroll",
          )
          scrollRoot.scrollTop = scrollRoot.scrollHeight
          await waitFor(
            () =>
              statusMutationRequests > 0 &&
              contentState.get().entries.find(({ id }) => id === 101)?.status === "read",
            "Mounted Highlight read-on-scroll did not use existing observer/mutation",
          )
          assert(ids().includes(101), "Read-on-scroll removed a committed Highlight")
        } finally {
          settingsState.set({ ...settingsState.get(), markReadOnScroll: false })
          stage.style.height = ""
          stage.style.minHeight = ""
          scrollSpacer.remove()
        }
      },
    ],
    [
      "HOME_DEDUPE_BY_ENTRY_ID",
      async () => {
        await mountHighlights(highlightFixtures.image)
        assert(
          cards().length === 3 &&
            new Set(ids()).size === cards().length &&
            ids().join(",") === "101,202,303",
          "Duplicate ID rendered or an eligible Highlight was missing",
        )
        await mountHighlights(highlightFixtures.shared)
        assert(
          ids().join(",") === "101,202,303",
          "Shared feed/category incorrectly deduped distinct IDs",
        )
      },
    ],
  ]
  const mountPagination = async (count, { total = count + 1000, pages = [] } = {}) => {
    await mount("/", { entries: paginationEntries(count), total, pageSize: count, pages })
    await waitFor(
      () => homeRoot()?.getAttribute("aria-busy") === "false",
      "Home pagination session did not become ready",
    )
  }
  const recentScenarios = [
    [
      "HOME_RECENT_GRID",
      async () => {
        for (const count of [3, 20, 250]) {
          await mountPagination(count)
          assert(ids().join(",") === "10000,10001,10002", "Initial Highlights changed")
          assert(
            recentIds().join(",") ===
              paginationEntries(count)
                .slice(3)
                .map(({ id }) => id)
                .join(","),
            `Recent lost canonical order at ${count} loaded records`,
          )
          assert(sentinels().length === 1, "Home composition must own one sentinel")
          assert(
            [...document.querySelectorAll(".home-recent .article-entry")].every((node) =>
              node.classList.contains("grid-card-wrapper"),
            ),
            "Recent did not reuse the existing Grid card presenter",
          )
          const recent = homeRoot().querySelector(".home-recent")
          assert(
            homeRoot().querySelector(".home-highlights").compareDocumentPosition(sentinels()[0]) &
              Node.DOCUMENT_POSITION_FOLLOWING &&
              (!recent ||
                recent.compareDocumentPosition(sentinels()[0]) & Node.DOCUMENT_POSITION_FOLLOWING),
            "Sentinel did not follow Highlights and Recent",
          )
          assert(Boolean(recent) === count > 3, "Empty Recent section was rendered")
          assert(
            sentinels()[0]
              .closest(".simplebar-content, .adaptive-scroll-area-native")
              ?.contains(homeRoot().querySelector(".home-highlights")),
            "Sentinel is outside the persistent composition scroll root",
          )
        }
      },
    ],
    [
      "HOME_DEDUPE_BY_ENTRY_ID",
      async () => {
        const entries = paginationEntries(20)
        await mount("/", { entries: [...entries.toReversed(), entries[0], entries[6]], total: 20 })
        await waitFor(() => ids().length === 3, "Highlights missing")
        const rendered = [...ids(), ...recentIds()]
        assert(
          rendered.length === 20 && new Set(rendered).size === 20,
          "Home deduped distinct records by shared title/hash/URL or repeated entry IDs",
        )
        assert(
          recentIds().join(",") ===
            entries
              .slice(3)
              .map(({ id }) => id)
              .join(","),
          "Recent order did not follow published_at descending",
        )
      },
    ],
    [
      "HOME_LOAD_MORE_STABLE",
      async () => {
        await mountPagination(20, { pages: [paginationEntries(20, 18)] })
        const highlights = cards()
        const root = scrollRoot()
        await loadNextPage(20)
        assert(ids().join(",") === "10000,10001,10002", "Append changed Highlight slots/order")
        assert(
          cards().every((node, index) => node === highlights[index]),
          "Append remounted Highlights",
        )
        assert(scrollRoot() === root, "Append replaced the persistent scroll root")
        assert(
          recentIds().join(",") ===
            paginationEntries(38)
              .slice(3)
              .map(({ id }) => id)
              .join(","),
          "Page overlap was not appended by ID to Recent",
        )
        assert(sentinels().length === 1, "Append duplicated the sentinel")
      },
    ],
    [
      "HOME_ONE_CURSOR",
      async () => {
        await mountPagination(20, {
          pages: [paginationEntries(20, 18), paginationEntries(20, 36)],
        })
        await loadNextPage(20)
        await loadNextPage(38)
        const queries = listRequests().map(
          (url) => new URL(url, "https://fixture.invalid").searchParams,
        )
        assert(queries.length === 3, "Home created a second query/pagination chain")
        assert(
          queries.every(
            (query) =>
              query.get("status") === "unread" &&
              query.get("limit") === "20" &&
              query.get("order") === "published_at" &&
              query.get("direction") === "desc",
          ),
          "Pagination did not reuse canonical Home query policy",
        )
        const cursor = (index) =>
          String(Date.parse(paginationEntries(index + 1)[index].published_at) / 1000)
        assert(
          !queries[0].has("published_before") &&
            queries[1].get("published_before") === cursor(18) &&
            queries[2].get("published_before") === cursor(36),
          "Home cursor sequence did not advance once per page",
        )
      },
    ],
    [
      "HOME_REFRESH_AFTER_PAGINATION_DOES_NOT_SKIP_NEW_CANONICAL_GAP",
      async () => {
        const oldEntries = paginationEntries(40)
        await mount("/", {
          entries: oldEntries,
          total: oldEntries.length,
          pageSize: 20,
          strictHomePagination: true,
        })
        await waitFor(
          () => contentState.get().isArticleListReady && contentState.get().entries.length === 20,
          "Initial canonical Home page did not load",
        )
        await loadNextPage(20)
        assert(contentState.get().entries.length === 38, "Second Home page did not load")

        const committedHighlights = ids()
        const committedRecent = recentIds()
        const newerEntries = paginationEntries(30, -30)
        fixtureEntries = [...newerEntries, ...oldEntries].toSorted(
          (left, right) => Date.parse(right.published_at) - Date.parse(left.published_at),
        )
        fixtureTotal = fixtureEntries.length
        deferredArticleQuery = createDeferred()
        const previousSnapshotRevision = contentState.get().articleListSnapshotRevision
        const previousRequestCount = listRequests().length
        document.body.focus()
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "KeyR",
            key: "r",
            keyCode: 82,
            which: 82,
          }),
        )
        await waitFor(
          () => listRequests().length === previousRequestCount + 1,
          "HOME-01 refresh did not issue one canonical first-page request",
        )
        await waitFor(
          () => !contentState.get().isArticleListReady,
          "Refresh did not become pending",
        )
        deferredArticleQuery.resolve()
        await waitFor(
          () =>
            contentState.get().isArticleListReady &&
            contentState.get().articleListSnapshotRevision === previousSnapshotRevision + 1,
          "Canonical refreshed page did not commit",
        )

        assert(ids().join(",") === committedHighlights.join(","), "Refresh promoted new Highlights")
        assert(
          recentIds().slice(0, committedRecent.length).join(",") === committedRecent.join(","),
          "Refresh reordered already committed Recent cards",
        )
        assert(
          newerEntries.slice(0, 20).every(({ id }) => recentIds().includes(id)) &&
            newerEntries.every(({ id }) => !ids().includes(id)),
          "Refreshed canonical page was not appended to Recent without promoting Highlights",
        )

        const loadedAfterRefresh = contentState.get().entries.length
        await loadNextPage(loadedAfterRefresh)
        const nextRequest = new URL(listRequests().at(-1), "https://fixture.invalid").searchParams
        const expectedBoundary = String(Date.parse(newerEntries[18].published_at) / 1000)
        assert(
          nextRequest.get("published_before") === expectedBoundary,
          `Load More used retained-session cursor ${nextRequest.get("published_before")} instead of canonical refreshed boundary ${expectedBoundary}`,
        )
        assert(
          newerEntries.slice(20).every(({ id }) => recentIds().includes(id)),
          "Load More skipped the unread entries in the post-refresh canonical gap",
        )
        const loadedIds = contentState.get().entries.map(({ id }) => id)
        assert(
          new Set(loadedIds).size === loadedIds.length,
          "Refresh pagination created duplicate entries",
        )
        assert(
          ids().join(",") === committedHighlights.join(",") &&
            newerEntries.every(({ id }) => !ids().includes(id)),
          "Gap fill promoted canonical page entries into Highlights",
        )
      },
    ],
    [
      "HOME_EMPTY_RECENT_SENTINEL",
      async () => {
        for (const count of [1, 2, 3]) {
          await mountPagination(count, { pages: [paginationEntries(count, count)] })
          assert(
            recentIds().length === 0 && !homeRoot().querySelector(".home-recent"),
            "Recent should be absent",
          )
          assert(
            sentinels().length === 1 && contentState.get().loadMoreVisible,
            "Empty Recent lost pagination",
          )
          const initialIds = ids().join(",")
          await loadNextPage(count)
          assert(ids().join(",") === initialIds, "Pagination filled or reordered Highlight slots")
          assert(recentIds().length === count, "Empty Recent did not receive appended records")
        }
      },
    ],
    [
      "HOME_NO_EXTRA_HIGHLIGHT_FETCH",
      async () => {
        await mountPagination(20)
        await settle()
        assert(
          listRequests().length === 1 &&
            starredProfileRequests().length === 1 &&
            requests.length === 2,
          "Home issued an extra canonical or profile fetch",
        )
        assert(
          contentState.get().entries.length === 20 && recentIds().length === 17,
          "Highlights exceeded the page budget",
        )
      },
    ],
    [
      "HOME_LARGE_PAGE_APPEND",
      async () => {
        await mountPagination(250, { pages: [paginationEntries(250, 248)] })
        await loadNextPage(250)
        assert(contentState.get().entries.length === 498, "Large page append lost ID deduplication")
        assert(ids().join(",") === "10000,10001,10002", "Large append reordered Highlights")
        assert(
          recentIds().join(",") ===
            paginationEntries(498)
              .slice(3)
              .map(({ id }) => id)
              .join(","),
          "Large page Recent order/append is incomplete",
        )
        assert(
          sentinels().length === 1 && listRequests().length === 2,
          "Large append created extra pagination owners",
        )
      },
    ],
  ]
  const listSentinelScenarios = [
    [
      "LIST_VIRTUALIZED_SHARED_SENTINEL_APPEND",
      async () => {
        await mount("/all", {
          entries: paginationEntries(250),
          total: 1000,
          pageSize: 250,
          layout: "card",
          orderBy: "published_at",
          orderDirection: "desc",
          pages: [paginationEntries(250, 248)],
        })
        await waitFor(
          () => document.querySelector(".article-card-grid-row"),
          "Virtualized Grid missing",
        )
        const root = document.querySelector(
          ".entry-list .simplebar-content-wrapper, .entry-list.adaptive-scroll-area-native",
        )
        const sentinel = document.querySelector(".entry-list .load-more-container")
        assert(
          root && sentinel && document.querySelectorAll(".load-more-container").length === 1,
          "Ordinary ArticleList lost the shared sentinel",
        )
        assert(
          document.querySelectorAll(".entry-list .article-entry").length < 250,
          "Ordinary Grid no longer virtualizes loaded records",
        )
        root.scrollTop = root.scrollHeight
        sentinel.scrollIntoView({ block: "end" })
        deferredPagination?.resolve()
        deferredPagination = null
        root.dispatchEvent(new Event("scroll"))
        await waitFor(
          () => contentState.get().entries.length === 498,
          "Virtualized sentinel failed to append",
        )
        assert(listRequests().length === 2, "Ordinary list started extra requests")
        assert(
          document.querySelectorAll(".load-more-container").length === 1,
          "Virtualized append duplicated the sentinel",
        )
        assert(
          document.querySelector(
            ".entry-list .simplebar-content-wrapper, .entry-list.adaptive-scroll-area-native",
          ) === root,
          "Virtualized append replaced the scroll root",
        )
      },
    ],
  ]
  const stateScenarios = [
    [
      "HOME_LOADING",
      async () => {
        await mount("/", { deferInitial: true, entries: [], total: 0 })
        assert(
          document.querySelector(".home-state-loading[aria-busy='true']"),
          "Initial canonical query did not render the Home editorial skeleton",
        )
        assert(
          !document.querySelector(".home-state-zero-unread"),
          "Pending query was presented as global zero unread",
        )
        deferredArticleQuery?.resolve()
        deferredArticleQuery = null
        await waitFor(
          () => document.querySelector(".home-state-zero-unread"),
          "Successful zero result did not replace initial loading",
        )
      },
    ],
    [
      "HOME_LOW_UNREAD_COUNTS",
      async () => {
        for (const [entries, expected] of [
          [highlightFixtures.one, 1],
          [highlightFixtures.two, 2],
        ]) {
          await mountHighlights(entries)
          assert(cards().length === expected, `Expected exactly ${expected} loaded Highlights`)
          assert(
            !document.querySelector(".home-highlight-slot-placeholder"),
            "A filler card rendered",
          )
          assert(!document.querySelector(".home-recent"), "Empty Recent section rendered")
        }
      },
    ],
    [
      "HOME_EMPTY_RECENT",
      async () => {
        await mount("/", {
          entries: emptyHomeFixtures.emptyPageWithMore.entries,
          total: emptyHomeFixtures.emptyPageWithMore.total,
          pageSize: 20,
          pages: [emptyHomeFixtures.emptyPageWithMore.nextPage],
          emptyPagePagination: true,
        })
        await waitFor(
          () => homeRoot()?.getAttribute("aria-busy") === "false",
          "Empty Home query did not become ready",
        )
        assert(cards().length === 0 && recentIds().length === 0, "Empty loaded page rendered cards")
        assert(!document.querySelector(".home-recent"), "Empty Recent section rendered")
        assert(
          !document.querySelector(".home-state-zero-unread"),
          "Positive total rendered zero state",
        )
        assert(
          sentinels().length === 1,
          `Empty loaded page lost its shared sentinel (ready=${contentState.get().isArticleListReady}, total=${contentState.get().total}, loadMore=${contentState.get().loadMoreVisible}, session=${homeRoot()?.getAttribute("aria-busy")})`,
        )
        assert(contentState.get().loadMoreVisible, "Positive total did not preserve pagination")
        deferredPagination?.resolve()
        deferredPagination = null
        await waitFor(
          () => contentState.get().entries.length === 12,
          "Empty page sentinel did not append",
        )
      },
    ],
    [
      "HOME_ZERO_UNREAD",
      async () => {
        await mount("/", emptyHomeFixtures.zeroUnread)
        await waitFor(
          () => document.querySelector(".home-state-zero-unread"),
          "Successful canonical zero did not render the calm Home state",
        )
        assert(
          document
            .querySelector(".home-state-zero-unread")
            ?.textContent.includes(englishPhrases.article_list.no_unread_articles),
          "Global zero state did not use the existing localized no-unread message",
        )

        await mount("/", { entries: routeEntries.slice(0, 1), total: 2 })
        await waitFor(() => contentState.get().isArticleListReady, "Home query did not load")
        failCount = true
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(
          () =>
            requests.some(
              (url) => new URL(url, "https://fixture.invalid").searchParams.get("limit") === "1",
            ),
          "Failed guarded count reconciliation was not requested",
        )
        await settle()
        assert(
          !document.querySelector(".home-state-zero-unread") && contentState.get().total === 2,
          "Failed count reconciliation produced a false zero-unread state",
        )
      },
    ],
    [
      "HOME_ZERO_UNREAD_REFRESH_ERROR_RETRY",
      async () => {
        await mount("/", emptyHomeFixtures.zeroUnread)
        await waitFor(
          () => document.querySelector(".home-state-zero-unread"),
          "Successful canonical zero did not render before refresh",
        )
        const initialRequests = listRequests().length
        articleFailure = true
        document.body.focus()
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "KeyR",
            key: "r",
            keyCode: 82,
            which: 82,
          }),
        )
        await waitFor(
          () => contentState.get().articleListError,
          "Zero-session explicit refresh rejection missing",
        )
        assert(
          document.querySelector(".home-state-zero-unread"),
          "Failed refresh replaced the valid zero-unread state",
        )
        assert(
          document.querySelector(".home-state-refresh-error[role='alert'] button"),
          "Zero-unread refresh failure did not expose retry",
        )
        const priorSnapshotRevision = contentState.get().articleListSnapshotRevision
        articleFailure = false
        deferredArticleQuery = (() => {
          let release
          const promise = new Promise((resolve) => {
            release = resolve
          })
          return { promise, resolve: release }
        })()
        clickLabel(englishPhrases.actions.retry)
        await waitFor(
          () => listRequests().length === initialRequests + 2,
          "Zero-session retry request did not start",
        )
        const retryCompleted = () =>
          contentState.get().isArticleListReady &&
          !contentState.get().articleListError &&
          contentState.get().articleListSnapshotRevision > priorSnapshotRevision
        assert(
          contentState.get().articleListSnapshotRevision === priorSnapshotRevision &&
            !contentState.get().isArticleListReady,
          "Zero-session retry committed before its response was released",
        )
        assert(!retryCompleted(), "Zero-session retry completed without a response")
        deferredArticleQuery.resolve()
        deferredArticleQuery = null
        await waitFor(retryCompleted, "Zero-session refresh retry did not complete")
        assert(
          document.querySelector(".home-state-zero-unread") &&
            !document.querySelector(".home-state-refresh-error"),
          "Successful zero-session retry did not restore the calm zero state",
        )
        assert(
          listRequests().length === initialRequests + 2,
          "Zero-session refresh/retry started unexpected requests",
        )
      },
    ],
    [
      "HOME_INITIAL_ERROR",
      async () => {
        await mount("/", { queryError: true })
        await waitFor(() => contentState.get().articleListError, "Initial query rejection missing")
        assert(
          document.querySelector(".home-state-initial-error[role='alert']"),
          "Initial article-query failure did not render an in-surface Home error",
        )
        assert(
          !document.querySelector(".home-state-zero-unread"),
          "Failed initial query was presented as global zero unread",
        )
        articleFailure = false
        clickLabel(englishPhrases.actions.retry)
        await waitFor(
          () => homeRoot()?.getAttribute("aria-busy") === "false",
          "Retry did not recover Home",
        )
        assert(
          homeRoot().querySelector(".home-state-initial-error") === null,
          "Retry left initial error visible",
        )
        assert(listRequests().length === 2, "Retry did not use the existing canonical query")
      },
    ],
    [
      "HOME_REFRESH_ERROR_WITH_CONTENT",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const originalCards = cards()
        const initialRequests = listRequests().length
        articleFailure = true
        document.body.focus()
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "KeyR",
            key: "r",
            keyCode: 82,
            which: 82,
          }),
        )
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "KeyR",
            key: "r",
            keyCode: 82,
            which: 82,
          }),
        )
        await waitFor(
          () => contentState.get().articleListError,
          "Explicit refresh rejection missing",
        )
        assert(
          listRequests().length === initialRequests + 1,
          "Repeated refresh started overlapping canonical requests",
        )
        assert(
          document.querySelector(".home-state-refresh-error[role='alert']"),
          "Refresh rejection did not render its distinct in-surface error",
        )
        assert(
          originalCards.length === cards().length &&
            originalCards.every((card, index) => card === cards()[index]),
          "Failed refresh replaced the exact valid Home projection",
        )
        assert(
          !document.querySelector(".home-state-initial-error"),
          "Refresh used initial-error state",
        )
        articleFailure = false
        clickLabel(englishPhrases.actions.retry)
        await waitFor(
          () =>
            homeRoot()?.getAttribute("aria-busy") === "false" &&
            !contentState.get().articleListError,
          "Refresh retry did not complete",
        )
        assert(
          listRequests().length === initialRequests + 2,
          "Refresh/retry started unexpected requests",
        )
      },
    ],
    [
      "HOME_LOAD_MORE_ERROR",
      async () => {
        await mountPagination(20, { pages: [paginationEntries(20, 18)] })
        const originalCards = cards()
        failPagination = true
        const root = scrollRoot()
        root.scrollTop = root.scrollHeight
        sentinels()[0].scrollIntoView({ block: "end" })
        root.dispatchEvent(new Event("scroll"))
        await waitFor(() => contentState.get().loadMoreError, "Load-more rejection missing")
        assert(
          originalCards.every((card, index) => card === cards()[index]),
          "Load-more failure replaced Home Highlights",
        )
        assert(
          document.querySelectorAll(".home-editorial .load-more-container").length === 1 &&
            sentinels()[0].querySelector("button"),
          "Load-more retry was not local to the sole shared sentinel",
        )
        assert(
          !document.querySelector(".home-state-refresh-error, .home-state-initial-error"),
          "Page error duplicated sentinel error",
        )
        failPagination = false
        deferredPagination?.resolve()
        deferredPagination = null
        sentinels()[0].querySelector("button").click()
        await waitFor(
          () => contentState.get().entries.length > 20,
          "Sentinel retry did not append page",
        )
        assert(contentState.get().loadMoreError === false, "Sentinel retry left error state active")
      },
    ],
  ]
  // HOME-VISUAL-01: expected cover presence per Highlight slot (Primary, Secondary 1, Secondary 2).
  const primaryHierarchyScenarios = [
    [
      "HOME_VISUAL_01_CASE_A_TEXT_PRIMARY_IMAGE_SECONDARIES",
      () => runPrimaryHierarchyCase(mountHighlights, "caseA", [false, true, true]),
    ],
    [
      "HOME_VISUAL_01_CASE_B_ALL_IMAGES",
      () => runPrimaryHierarchyCase(mountHighlights, "caseB", [true, true, true]),
    ],
    [
      "HOME_VISUAL_01_CASE_C_ALL_TEXT",
      () => runPrimaryHierarchyCase(mountHighlights, "caseC", [false, false, false]),
    ],
    [
      "HOME_VISUAL_01_CASE_D_LONG_PRIMARY_TITLE",
      () => runPrimaryHierarchyCase(mountHighlights, "caseD", [false, true, true]),
    ],
    [
      "HOME_VISUAL_01_CASE_E_SHORT_PRIMARY_STRONG_SECONDARIES",
      () => runPrimaryHierarchyCase(mountHighlights, "caseE", [false, true, true]),
    ],
  ]
  // READER-VISUAL-01: reader ergonomics cases (Article width 75 unless stated).
  const readerScenarios = [
    ["READER_VISUAL_01_SHORT", () => runReaderCase(mount, "short")],
    ["READER_VISUAL_01_LONG_FORM_TECHNICAL_SURFACES", () => runReaderCase(mount, "longForm")],
    ["READER_VISUAL_01_LONG_HEADLINE", () => runReaderCase(mount, "longHeadline")],
    ["READER_VISUAL_01_WIDE_IMAGE", () => runReaderCase(mount, "wideImage")],
    ["READER_VISUAL_01_PORTRAIT_IMAGE", () => runReaderCase(mount, "portraitImage")],
    ["READER_VISUAL_01_NO_IMAGE", () => runReaderCase(mount, "noImage")],
    ["READER_VISUAL_01_ARTICLE_WIDTH_50_75_100", () => runReaderWidthControl(mount)],
    ["READER_VISUAL_01_SCROLL_UNDER_GLASS", () => runReaderScrollUnderGlass(mount)],
  ]
  const readerTypographyScenarios = [
    ["READER_VISUAL_02A1_NORMAL", () => runReaderTypographyCase(mount, "typographyNormal")],
    ["READER_VISUAL_02A1_STRESS", () => runReaderTypographyCase(mount, "typographyStress")],
    ["READER_VISUAL_02A1_TECHNICAL", () => runReaderTypographyCase(mount, "typographyTechnical")],
  ]
  const readerMeasureScenarios = [
    ["READER_MEASURE_01_PROSE_MEASURE_FORMULA", () => runReaderMeasureFormula(mount)],
    ["READER_MEASURE_01_WIDTH_50_FLOOR", () => runReaderMeasureWidth50Floor(mount)],
    ["READER_MEASURE_01_WIDTH_MONOTONICITY", () => runReaderMeasureMonotonicity(mount)],
    ["READER_MEASURE_01_MIN_BOUND", () => runReaderMeasureMinBound(mount)],
    ["READER_MEASURE_01_MAX_BOUND", () => runReaderMeasureMaxBound(mount)],
    ["READER_MEASURE_01_DEFAULT_75_PARITY", () => runReaderMeasureDefault75Parity(mount)],
    ["READER_MEASURE_01_CPL", () => runReaderMeasureCpl(mount)],
    ["READER_MEASURE_01_HEADER_BODY_ALIGNMENT", () => runReaderMeasureHeaderBodyAlignment(mount)],
    ["READER_MEASURE_01_MEDIA_PROTECTION", () => runReaderMeasureMediaProtection(mount)],
    ["READER_MEASURE_01_TABLE_PROTECTION", () => runReaderMeasureTableProtection(mount)],
    ["READER_MEASURE_01_PRE_CODE_PROTECTION", () => runReaderMeasurePreCodeProtection(mount)],
  ]
  const readerVisual02a2Scenarios = [
    ["READER_VISUAL_02A2_HEADER_PROSE_ALIGNMENT", () => runReaderMeasureHeaderBodyAlignment(mount)],
  ]
  const responsiveScenarios = [
    [
      "HOME_RESPONSIVE_VIEWPORT_STAGE",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const stage = document.querySelector(".harness-stage")
        const stageRect = stage?.getBoundingClientRect()
        assert(
          stageRect && Math.abs(stageRect.top) < 1 && Math.abs(stageRect.height - innerHeight) < 1,
          `Responsive fixture did not use the exact viewport height: top=${stageRect?.top}, height=${stageRect?.height}, viewport=${innerHeight}`,
        )
        assert(
          getComputedStyle(document.querySelector(".harness-controls")).display === "none" &&
            getComputedStyle(document.querySelector(".harness-fixture-controls")).display ===
              "none",
          "Harness controls reduced the Home viewport during the responsive matrix",
        )
      },
    ],
    [
      "HOME_FIRST_SECTION_CLEAR_OF_CHROME",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const chrome = homeRoot().querySelector(".search-and-sort-bar-home")
        const heading = homeRoot().querySelector(".home-highlights .home-section-heading")
        const root = scrollRoot()
        assert(chrome && heading && root, "Home chrome, Highlights heading, or scroll root missing")
        assert(
          root.scrollTop === 0,
          `Home did not start at its initial scroll position: ${root.scrollTop}`,
        )
        const chromeRect = chrome.getBoundingClientRect()
        const headingRect = heading.getBoundingClientRect()
        const gap = headingRect.top - chromeRect.bottom
        const intendedClearance = 24
        const tolerance = 1
        assert(
          gap + tolerance >= intendedClearance && headingRect.top >= chromeRect.bottom - tolerance,
          `Highlights heading clearance was ${gap.toFixed(2)}px; expected at least ${intendedClearance - tolerance}px below chrome`,
        )
      },
    ],
    [
      "HOME_NO_OVERFLOW",
      async () => {
        await mountHighlights(highlightFixtures.image)
        assert(
          document.documentElement.scrollWidth <= window.innerWidth,
          `Home overflowed: ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`,
        )
      },
    ],
    [
      "HOME_SECTION_HIERARCHY",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const headings = [...homeRoot().querySelectorAll(".home-section-heading")].map((node) =>
          node.textContent.trim(),
        )
        assert(
          JSON.stringify(headings) === JSON.stringify(["Highlights", "Latest"]),
          `Expected editorial section hierarchy; found ${headings.join(" / ")}`,
        )
        const sections = [...homeRoot().querySelectorAll("section[aria-label]")].map((node) =>
          node.getAttribute("aria-label"),
        )
        assert(
          sections.indexOf("Highlights") < sections.indexOf("Latest"),
          "Home section DOM order is not Highlights then Recent",
        )
      },
    ],
    [
      "HOME_SECONDARY_LAYOUT",
      async () => {
        await mountPagination(12)
        const primary = homeRoot().querySelector(".home-highlight-slot-primary")
        const secondaries = [
          ...homeRoot().querySelectorAll(".home-highlight-secondaries .article-entry"),
        ]
        assert(primary && secondaries.length === 2, "Primary or both Secondary cards are missing")
        const primaryRect = primary.getBoundingClientRect()
        const secondaryRects = secondaries.map((node) => node.getBoundingClientRect())
        const expectedWide = window.innerWidth >= 700
        assert(
          expectedWide
            ? Math.abs(secondaryRects[0].top - secondaryRects[1].top) < 2
            : secondaryRects[1].top > secondaryRects[0].top,
          `Secondary layout did not match ${window.innerWidth}px viewport`,
        )
        if (window.innerWidth >= 884) {
          const highlightsRect = homeRoot()
            .querySelector(".home-highlights")
            .getBoundingClientRect()
          assert(
            Math.abs(primaryRect.width - highlightsRect.width) < 2,
            `At 884px and wider, Primary (${primaryRect.width}px) does not span Highlights (${highlightsRect.width}px)`,
          )
        }
        globalThis.__phase2cHomeResponsive = {
          viewport: [window.innerWidth, window.innerHeight],
          contentWidth: homeRoot().querySelector(".home-editorial-content").clientWidth,
          primaryWidth: Math.round(primaryRect.width),
          highlightsWidth: Math.round(homeRoot().querySelector(".home-highlights").clientWidth),
          secondaryWidths: secondaryRects.map((rect) => Math.round(rect.width)),
          secondaryColumns: expectedWide ? 2 : 1,
          recentTop: Math.round(
            homeRoot().querySelector(".home-recent").getBoundingClientRect().top,
          ),
          appHeight: document.querySelector(".harness-stage").clientHeight,
        }
      },
    ],
    [
      "HOME_RECENT_GRID",
      async () => {
        await mountPagination(12)
        const row = homeRoot().querySelector(".home-recent .article-card-grid-row")
        assert(row, "Recent Grid row missing")
        const cells = [...row.children]
        const viewportWidth = window.innerWidth
        const availableWidth = homeRoot().querySelector(".home-editorial-content").clientWidth
        const expectedColumns = Math.max(1, Math.min(3, Math.floor((availableWidth + 12) / 312)))
        assert(
          cells.length === expectedColumns,
          `Recent Grid columns were ${cells.length}; expected ${expectedColumns} from ${availableWidth}px at ${viewportWidth}px`,
        )
        assert(
          [...homeRoot().querySelectorAll(".home-recent .article-card-grid-row")].every(
            (node) => Number(node.style.getPropertyValue("--article-card-grid-columns")) <= 3,
          ),
          "Recent exceeded the existing three-column Grid maximum",
        )
        const widths = cells.map((cell) => Math.round(cell.getBoundingClientRect().width))
        let density = null
        if (viewportWidth === 1024 && window.innerHeight === 768) {
          const scrollRoot = homeRoot().querySelector(
            ".simplebar-content-wrapper, .adaptive-scroll-area-native",
          )
          const recent = homeRoot().querySelector(".home-recent")
          const heading = recent?.querySelector(".home-section-heading")
          assert(scrollRoot && recent && heading, "1024×768 Home density elements are missing")
          assert(
            scrollRoot.scrollHeight > scrollRoot.clientHeight,
            "Recent is not reachable inside the Home scroll area at 1024×768",
          )
          const rootRect = scrollRoot.getBoundingClientRect()
          const recentRect = recent.getBoundingClientRect()
          const headingHeight = heading.getBoundingClientRect().height
          const recentOffset = scrollRoot.scrollTop + recentRect.top - rootRect.top
          const desiredScroll = Math.min(
            Math.max(0, recentOffset + headingHeight + 12 - scrollRoot.clientHeight),
            scrollRoot.scrollHeight - scrollRoot.clientHeight,
          )
          scrollRoot.scrollTop = desiredScroll
          await settle()
          const updatedRootRect = scrollRoot.getBoundingClientRect()
          const updatedHeadingRect = heading.getBoundingClientRect()
          const headingVisible =
            updatedHeadingRect.top < updatedRootRect.bottom &&
            updatedHeadingRect.bottom > updatedRootRect.top
          assert(headingVisible, "Recent heading is not discoverable by scrolling at 1024×768")
          density = {
            scrollClientHeight: scrollRoot.clientHeight,
            scrollHeight: scrollRoot.scrollHeight,
            scrollTop: Math.round(scrollRoot.scrollTop),
            recentHeadingVisibleAfterScroll: headingVisible,
            recentColumns: cells.length,
            recentCardWidths: widths,
          }
        }
        globalThis.__phase2cHomeResponsive = {
          ...globalThis.__phase2cHomeResponsive,
          recentColumns: cells.length,
          recentCardWidths: widths,
          recentGridWidth: Math.round(row.getBoundingClientRect().width),
          ...(density ? { density } : {}),
        }
      },
    ],
    [
      "HOME_SEARCH_ONLY",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const controls = [...document.querySelectorAll(".home-editorial .search-and-sort-bar")]
        assert(controls.length === 1, "Home search control missing")
        const buttons = [...controls[0].querySelectorAll(".button-group button")]
        assert(buttons.length === 1, `Home exposed ${buttons.length} search/filter controls`)
        assert(
          !controls[0].querySelector(".arco-picker, [aria-label*='Sort'], .status-filter"),
          "Date, sort, or status control leaked onto Home",
        )
      },
    ],
    [
      "HOME_SEARCH_ROUTES_TO_ALL",
      async () => {
        await mountHighlights(highlightFixtures.image)
        const searchButton = document.querySelector(".home-editorial .button-group button")
        assert(searchButton, "Home search button missing")
        searchButton.click()
        await waitFor(() => document.querySelector(".search-modal input"), "Search modal missing")
        const input = document.querySelector(".search-modal input")
        const inputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set
        inputValueSetter.call(input, "editorial fixture query")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        await settle()
        clickLabel(englishPhrases.search.confirm)
        await waitFor(
          () => router.state.location.pathname === "/all",
          "Home search did not route to /all",
        )
        assert(
          contentState.get().filterString === "editorial fixture query",
          "Home search did not reuse the existing query state",
        )
      },
    ],
    [
      "LIST_SEARCH_DATE_SORT_PRESERVED",
      async () => {
        await mount("/all")
        const bar = document.querySelector(".entry-col .search-and-sort-bar")
        const searchButton = bar?.querySelector(".arco-icon-search")?.closest("button")
        const dateButton = bar?.querySelector(".arco-icon-calendar")?.closest("button")
        const sortButton = bar
          ?.querySelector(".arco-icon-sort-descending, .arco-icon-sort-ascending")
          ?.closest("button")
        assert(searchButton && dateButton && sortButton, "Ordinary list lost Search, Date, or Sort")
        const initialDirection = settingsState.get().orderDirection
        sortButton.click()
        await waitFor(
          () => settingsState.get().orderDirection !== initialDirection,
          "Ordinary Sort no longer updates the existing order preference",
        )
        assert(router.state.location.pathname === "/all", "Ordinary Sort changed routes")

        searchButton.click()
        await waitFor(
          () => document.querySelector(".search-modal input"),
          "List Search modal missing",
        )
        const input = document.querySelector(".search-modal input")
        const inputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set
        inputValueSetter.call(input, "ordinary list query")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        await settle()
        clickLabel(englishPhrases.search.confirm)
        await waitFor(
          () => contentState.get().filterString === "ordinary list query",
          "Ordinary Search did not update its existing query state",
        )
        assert(router.state.location.pathname === "/all", "Ordinary Search added Home navigation")

        assert(dateButton, "Ordinary Date control missing")
        dateButton.click()
        await waitFor(
          () => document.querySelector(".arco-picker-container"),
          "Ordinary Date control did not open the existing calendar",
        )
        const clearDateButton = [...document.querySelectorAll(".calendar-actions button")].find(
          (button) => button.textContent.trim() === englishPhrases.search.clear_date,
        )
        assert(clearDateButton, "Ordinary Date clear action missing")
        clearDateButton.click()
        assert(contentState.get().filterDate === null, "Ordinary Date clear did not preserve state")
        assert(router.state.location.pathname === "/all", "Ordinary Date changed routes")
      },
    ],
    [
      "HOME_LIGHT",
      async () => {
        await mountHighlights(highlightFixtures.image)
        document.body.removeAttribute("arco-theme")
        await new Promise((resolve) => setTimeout(resolve, 240))
        const card = homeRoot().querySelector(".grid-card-wrapper")
        const control = homeRoot().querySelector(".nf-glass-control")
        const cardStyle = card && getComputedStyle(card)
        const controlStyle = control && getComputedStyle(control)
        const contentToken = getComputedStyle(document.body)
          .getPropertyValue("--nf-surface-content")
          .trim()
        assert(
          cardStyle &&
            cardStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            cardStyle.backdropFilter === "none",
          "Light Home content surface is not opaque",
        )
        assert(
          controlStyle && controlStyle.backdropFilter !== "none",
          "Light Home chrome is not Liquid Glass",
        )
        globalThis.__phase2cHomeThemeMetrics = {
          ...globalThis.__phase2cHomeThemeMetrics,
          light: {
            card: cardStyle.backgroundColor,
            contentToken,
            chromeBlur: controlStyle.backdropFilter,
          },
        }
      },
    ],
    [
      "HOME_DARK",
      async () => {
        await mountHighlights(highlightFixtures.image)
        document.body.setAttribute("arco-theme", "dark")
        await new Promise((resolve) => setTimeout(resolve, 240))
        const card = homeRoot().querySelector(".grid-card-wrapper")
        const control = homeRoot().querySelector(".nf-glass-control")
        const cardStyle = card && getComputedStyle(card)
        const controlStyle = control && getComputedStyle(control)
        const contentToken = getComputedStyle(document.body)
          .getPropertyValue("--nf-surface-content")
          .trim()
        assert(
          cardStyle &&
            cardStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            cardStyle.backdropFilter === "none",
          "Dark Home content surface is not opaque",
        )
        assert(
          document.body.getAttribute("arco-theme") === "dark" &&
            contentToken === "#101317" &&
            cardStyle.backgroundColor === "rgb(16, 19, 23)",
          `Dark content surface did not apply: body=${contentToken}, computed=${cardStyle.backgroundColor}`,
        )
        assert(
          controlStyle && controlStyle.backdropFilter !== "none",
          "Dark Home chrome is not Liquid Glass",
        )
        globalThis.__phase2cHomeThemeMetrics = {
          ...globalThis.__phase2cHomeThemeMetrics,
          dark: {
            card: cardStyle.backgroundColor,
            contentToken,
            chromeBlur: controlStyle.backdropFilter,
          },
        }
      },
    ],
  ]
  const personalizationScenarios = [
    [
      "PHASE2D_CURRENT_ITEM_STAR_OUTSIDE_PROFILE_SAMPLE",
      async () => {
        await mount("/", {
          deferInitial: true,
          entries: personalizationFixtures.directStarOutsideSampleHome,
          total: personalizationFixtures.directStarOutsideSampleHome.length,
          personalization: { entries: [] },
        })
        await waitFor(
          () => starredProfileRequests().length === 1,
          "Direct-star auxiliary profile query did not start",
        )
        await settle()
        assert(
          !contentState.get().isArticleListReady,
          "Direct-star canonical snapshot was not held until the profile resolved",
        )
        deferredArticleQuery.resolve()
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Direct-star Home did not reach its canonical snapshot",
        )

        assert(
          personalizationFixtures.directStarOutsideSampleHome[3].starred === true &&
            !starredProfileEntries.some(({ id }) => id === 604),
          "The canonical starred candidate was unexpectedly present in the auxiliary profile",
        )
        assert(
          contentState.get().entries.find(({ id }) => id === 604)?.starred === true,
          "Canonical Home snapshot did not preserve the candidate's starred state",
        )
        assert(
          ids().join(",") === "601,604,603" && recentIds().join(",") === "602",
          `Canonical direct star did not influence an eligible Secondary: ${ids().join(",")}`,
        )
        assert(
          canonicalEntryRequests().length === 1 && starredProfileRequests().length === 1,
          "Direct-star projection changed candidate or auxiliary query counts",
        )
        assert(
          homeRoot().querySelector(".home-personalization-info-button"),
          "Direct-star order change did not expose its truthful explanation",
        )
      },
    ],
    [
      "PHASE2D_PROFILE_MEMBERSHIP_DOES_NOT_FAKE_DIRECT_STAR",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { entries: personalizationFixtures.unchangedProfile },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Inverse direct-star Home did not reach its canonical snapshot",
        )

        assert(
          personalizationFixtures.home[1].starred !== true &&
            personalizationFixtures.unchangedProfile.some(({ id }) => id === 602 && id != null),
          "Inverse fixture did not separate canonical star state from profile membership",
        )
        assert(
          ids().join(",") === "601,602,603" &&
            !homeRoot().querySelector(".home-personalization-info-button"),
          "Profile-only membership created a direct-star treatment or order change",
        )
      },
    ],
    [
      "CANONICAL_HOME_QUERY_UNCHANGED",
      async () => {
        await mount("/", {
          deferInitial: true,
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { entries: personalizationFixtures.preferredProfile },
        })
        await waitFor(
          () => starredProfileRequests().length === 1,
          "Initial starred-profile query did not start",
        )
        await settle()
        assert(
          !contentState.get().isArticleListReady,
          "Canonical Home snapshot was not held for the profile-before-snapshot fixture",
        )
        deferredArticleQuery.resolve()
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length > 0,
          "Personalized Home did not reach its canonical snapshot",
        )
        const profileRequests = requests.filter((url) => {
          const params = new URL(url, "https://fixture.invalid").searchParams
          return params.get("starred") === "true"
        })
        const canonicalRequests = requests.filter((url) => {
          const params = new URL(url, "https://fixture.invalid").searchParams
          return url.startsWith("/v1/entries?") && params.get("starred") !== "true"
        })
        assert(profileRequests.length === 1, "Expected one auxiliary starred-profile request")
        const profileParams = new URL(profileRequests[0], "https://fixture.invalid").searchParams
        assert(
          profileParams.get("limit") === "75" &&
            profileParams.get("direction") === "desc" &&
            !profileParams.has("published_after") &&
            !profileParams.has("published_before"),
          "Profile query did not use the bounded, date-independent starred corpus",
        )
        assert(canonicalRequests.length === 1, "Expected one canonical Home candidate request")
        const canonical = new URL(canonicalRequests[0], "https://fixture.invalid").searchParams
        assert(
          canonical.get("status") === "unread" &&
            canonical.get("order") === "published_at" &&
            canonical.get("direction") === "desc" &&
            canonical.get("limit") === String(settingsState.get().pageSize) &&
            !canonical.has("starred"),
          "Personalization changed the canonical Home request policy",
        )
        assert(
          ids().join(",") === "601,603,602",
          `Starred source did not influence a same-freshness Secondary: ${ids().join(",")}`,
        )
        assert(
          !contentState.get().entries.some(({ id }) => id === 999) &&
            ![...document.querySelectorAll(".article-entry[data-entry-id]")].some(
              (entry) => Number(entry.dataset.entryId) === 999,
            ),
          "A profile-only starred entry became a Home candidate",
        )
        const button = homeRoot().querySelector(".home-personalization-info-button")
        assert(
          button && button.getAttribute("aria-expanded") === "false",
          "Truthful explanation affordance missing",
        )
        const heading = homeRoot().querySelector(".home-section-heading")
        const headingRow = heading?.parentElement
        assert(
          heading &&
            headingRow &&
            Math.abs(
              heading.getBoundingClientRect().width - headingRow.getBoundingClientRect().width,
            ) < 1,
          "Information control shrank the Highlights heading",
        )
        button.focus()
        button.click()
        await waitFor(
          () => button.getAttribute("aria-expanded") === "true",
          "Personalization explanation did not open",
        )
        const disclosure = homeRoot().querySelector("#home-highlights-personalization-explanation")
        const disclosureStyle = disclosure && getComputedStyle(disclosure)
        assert(
          button.getAttribute("aria-expanded") === "true" &&
            disclosure?.textContent.includes("Starred sources") &&
            disclosureStyle?.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            disclosureStyle?.backdropFilter === "none",
          "Personalization explanation is not visible, localized, and opaque",
        )
        await settle()
        globalThis.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        )
        await waitFor(
          () =>
            button.getAttribute("aria-expanded") === "false" && document.activeElement === button,
          "Escape did not close the explanation and restore focus",
        )
        assert(
          button.getAttribute("aria-expanded") === "false" && document.activeElement === button,
          "Escape did not close the explanation and restore focus",
        )
        assert(
          cards()[0].classList.contains("grid-card-wrapper") &&
            !cards()[0].closest(".nf-glass-control, .nf-glass-surface"),
          "Explanation changed the existing opaque card treatment",
        )
      },
    ],
    [
      "NO_SECOND_CANDIDATE_STREAM",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { entries: personalizationFixtures.preferredProfile },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Home did not load for candidate-stream verification",
        )
        assert(
          canonicalEntryRequests().length === 1 &&
            starredProfileRequests().length === 1 &&
            !contentState.get().entries.some(({ id }) => id === 999),
          "Profile request created a second candidate stream or inserted a profile-only entry",
        )
      },
    ],
    [
      "PERSONALIZATION_EXPLAINER_TRUTHFUL",
      async () => {
        const cases = [
          { entries: [], mode: "resolved" },
          { entries: personalizationFixtures.noMatchProfile, mode: "resolved" },
          {
            entries: personalizationFixtures.hiddenOnlyProfile,
            mode: "resolved",
            hiddenFeedId: 99,
          },
          { entries: personalizationFixtures.unchangedProfile, mode: "resolved" },
          { entries: [], mode: "failed" },
        ]
        for (const personalization of cases) {
          await mount("/", {
            entries: personalizationFixtures.home,
            total: personalizationFixtures.home.length,
            personalization,
          })
          await waitFor(
            () => contentState.get().isArticleListReady && cards().length === 3,
            "Fallback Home did not reach its canonical snapshot",
          )
          assert(
            ids().join(",") === "601,602,603" &&
              recentIds().join(",") === "604" &&
              !homeRoot().querySelector(".home-personalization-info-button"),
            `Unavailable, hidden-only, or no-effect profile did not preserve Phase 2C: ${ids().join(",")}`,
          )
        }
      },
    ],
    [
      "PROFILE_DEADLINE_FALLBACK_NO_RECOMPOSE",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { mode: "deferred" },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Deferred-profile Home did not reach its canonical snapshot",
        )
        const baselineIds = ids().join(",")
        const originalCards = cards()
        assert(baselineIds === "601,602,603", "Pending profile did not use exact Phase 2C order")
        assert(starredProfileRequests().length === 1, "Expected one deferred profile request")
        assert(
          !homeRoot().querySelector(".home-personalization-info-button"),
          "Deadline fallback displayed a personalization explanation",
        )
        resolveStarredProfile(personalizationFixtures.preferredProfile)
        await settle()
        assert(
          ids().join(",") === baselineIds &&
            originalCards.every((card, index) => card === cards()[index]) &&
            !homeRoot().querySelector(".home-personalization-info-button"),
          "Late profile recomposed, reordered, or explained the already-committed Home",
        )
      },
    ],
    [
      "HOME_STALE_SESSION_CANNOT_COMMIT",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { mode: "deferred" },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Initial stale-profile Home did not load",
        )
        const firstDeferred = deferredStarredProfile
        const initialRevision = dataState.get().sessionRevision
        const initialSnapshotRevision = contentState.get().articleListSnapshotRevision
        dataState.setKey("sessionRevision", initialRevision + 1)
        await waitFor(
          () =>
            contentState.get().isArticleListReady &&
            contentState.get().articleListSnapshotRevision > initialSnapshotRevision &&
            starredProfileRequests().length === 2,
          "New session did not create its own canonical/profile generation",
        )
        firstDeferred.resolve({ entries: personalizationFixtures.preferredProfile })
        await settle()
        assert(
          ids().join(",") === "601,602,603" &&
            !homeRoot().querySelector(".home-personalization-info-button"),
          "Prior-session profile affected the new Home generation",
        )
      },
    ],
    [
      "HOME_REQUEST_KEY_CHANGE_CREATES_NEW_SESSION",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
          personalization: { entries: personalizationFixtures.preferredProfile },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Initial Home request-key session did not commit",
        )
        const initialRequestCount = listRequests().length
        const initialProfileCount = starredProfileRequests().length
        settingsState.set({ ...settingsState.get(), showHiddenFeeds: true })
        await waitFor(
          () =>
            contentState.get().isArticleListReady &&
            listRequests().length === initialRequestCount + 1 &&
            starredProfileRequests().length === initialProfileCount + 1,
          "Existing request-key boundary did not create a fresh Home session",
        )
        assert(
          contentState.get().entries.length === personalizationFixtures.home.length,
          "New request-key session did not commit canonical entries",
        )
      },
    ],
    [
      "HOME_MANUAL_REFRESH_PRESERVES_SESSION",
      async () => {
        const initialEntries = [
          ...personalizationFixtures.home,
          ...Array.from({ length: 20 }, (_, index) => {
            const id = 700 + index
            return {
              ...personalizationFixtures.home[3],
              id,
              title: `Older Home story ${id}`,
              published_at: new Date(Date.UTC(2026, 9, 12, 10, 59 - index)).toISOString(),
              url: `https://example.invalid/${id}`,
            }
          }),
        ]
        await mount("/", {
          deferInitial: true,
          entries: initialEntries,
          total: initialEntries.length,
          personalization: { entries: personalizationFixtures.preferredProfile },
        })
        await waitFor(
          () => starredProfileRequests().length === 1,
          "Initial profile query did not start before refresh setup",
        )
        await settle()
        deferredArticleQuery.resolve()
        await waitFor(
          () => contentState.get().isArticleListReady && ids().join(",") === "601,603,602",
          "Initial personalized order did not commit",
        )
        const oldCards = cards()
        const oldRecentIds = recentIds()
        const oldCardNodes = new Map(
          [...homeRoot().querySelectorAll(".article-entry[data-entry-id]")].map((node) => [
            Number(node.dataset.entryId),
            node,
          ]),
        )
        const root = scrollRoot()
        assert(root && root.scrollHeight > root.clientHeight, "Home scroll root is not scrollable")
        root.scrollTop = Math.round((root.scrollHeight - root.clientHeight) / 2)
        root.dispatchEvent(new Event("scroll"))
        await settle()
        const rootBounds = root.getBoundingClientRect()
        const visibleAnchor = [
          ...homeRoot().querySelectorAll(".article-entry[data-entry-id]"),
        ].find((node) => {
          const bounds = node.getBoundingClientRect()
          return bounds.bottom > rootBounds.top && bounds.top < rootBounds.bottom
        })
        assert(visibleAnchor, "Home has no visible card anchor before refresh")
        const previousAnchorTop = visibleAnchor.getBoundingClientRect().top
        const focusedCard = oldCards.find((node) => Number(node.dataset.entryId) === 601)
        assert(focusedCard, "Expected Primary card to focus before refresh")
        focusedCard.focus({ preventScroll: true })
        assert(document.activeElement === focusedCard, "Primary card did not receive focus")
        const previousSnapshotRevision = contentState.get().articleListSnapshotRevision
        const refreshedEntries = [
          ...initialEntries.map((entry) => ({
            ...entry,
            ...(entry.id === 601 ? { title: "Updated Primary title", status: "read" } : {}),
          })),
          {
            ...personalizationFixtures.home[0],
            id: 605,
            title: "Newly discovered unread story",
            published_at: "2026-10-12T12:05:00Z",
            url: "https://example.invalid/605",
          },
        ]
        fixtureEntries = refreshedEntries
        fixtureTotal = refreshedEntries.filter(({ status }) => status === "unread").length
        starredProfileEntries = [{ ...personalizationFixtures.home[3], starred: true }]
        deferredArticleQuery = createDeferred()
        const refreshEvent = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "KeyR",
          key: "r",
          keyCode: 82,
          which: 82,
        })
        document.body.focus()
        document.body.dispatchEvent(refreshEvent)
        document.body.dispatchEvent(refreshEvent)
        await waitFor(
          () => listRequests().length === 2,
          "Explicit refresh did not start one canonical request",
        )
        await waitFor(
          () => !contentState.get().isArticleListReady,
          "Explicit refresh did not enter the existing pending state",
        )
        assert(
          ids().join(",") === "601,603,602" &&
            contentState.get().articleListSnapshotRevision === previousSnapshotRevision &&
            oldCards.every((card, index) => card === cards()[index]),
          "Refresh replaced the prior projection before canonical readiness",
        )
        deferredArticleQuery.resolve()
        await waitFor(
          () =>
            contentState.get().isArticleListReady &&
            contentState.get().articleListSnapshotRevision === previousSnapshotRevision + 1,
          "Explicit refresh did not commit exactly one canonical snapshot",
        )
        assert(
          starredProfileRequests().length === 1,
          "Manual refresh started another personalization profile request",
        )
        assert(
          ids().join(",") === "601,603,602",
          `Manual refresh changed committed Highlights: ${ids().join(",")}`,
        )
        assert(
          recentIds().slice(0, oldRecentIds.length).join(",") === oldRecentIds.join(",") &&
            recentIds().at(-1) === 605 &&
            !ids().includes(605),
          "New unread entry was not appended to the existing Recent tail",
        )
        assert(
          contentState.get().entries.find(({ id }) => id === 601)?.status === "read" &&
            homeRoot().querySelector('[data-entry-id="601"] .grid-card-title')?.textContent ===
              "Updated Primary title",
          "Canonical refresh data did not update a live committed entry",
        )
        assert(
          [...oldCardNodes].every(
            ([id, node]) =>
              [...homeRoot().querySelectorAll(".article-entry[data-entry-id]")].find(
                (entry) => Number(entry.dataset.entryId) === id,
              ) === node,
          ),
          "Manual refresh replaced a committed Home card node",
        )
        assert(
          root === scrollRoot() &&
            visibleAnchor.isConnected &&
            Math.abs(visibleAnchor.getBoundingClientRect().top - previousAnchorTop) < 1,
          "Manual refresh replaced the scroll root or moved the visible card anchor",
        )
        assert(
          document.activeElement === focusedCard,
          "Manual refresh stole focus from the active Home card",
        )
        assert(
          listRequests().length === 2 && starredProfileRequests().length === 1,
          "Manual refresh started an extra candidate or profile stream",
        )
      },
    ],
    [
      "HOME_REFRESH_FAILURE_PRESERVES_COMMITTED_SESSION",
      async () => {
        const entries = [
          ...personalizationFixtures.home,
          ...Array.from({ length: 20 }, (_, index) => ({
            ...personalizationFixtures.home[3],
            id: 760 + index,
            title: `Older failure story ${760 + index}`,
            published_at: new Date(Date.UTC(2026, 9, 12, 10, 59 - index)).toISOString(),
            url: `https://example.invalid/${760 + index}`,
          })),
        ]
        await mount("/", {
          entries,
          total: entries.length,
          personalization: { entries: personalizationFixtures.preferredProfile },
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Home session did not commit before failed refresh",
        )
        const committedIds = ids().join(",")
        const committedCards = cards()
        const committedNodes = [...homeRoot().querySelectorAll(".article-entry[data-entry-id]")]
        const root = scrollRoot()
        root.scrollTop = Math.round((root.scrollHeight - root.clientHeight) / 2)
        root.dispatchEvent(new Event("scroll"))
        await settle()
        const previousScrollTop = root.scrollTop
        const focusedCard = committedCards[0]
        focusedCard.focus({ preventScroll: true })
        articleFailure = true
        document.body.focus()
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "KeyR",
            key: "r",
            keyCode: 82,
            which: 82,
          }),
        )
        await waitFor(
          () => contentState.get().articleListError,
          "Failed refresh did not expose its existing error state",
        )
        assert(
          ids().join(",") === committedIds &&
            committedCards.every((card, index) => card === cards()[index]) &&
            committedNodes.every((node) => homeRoot().contains(node)),
          "Failed refresh changed committed Home membership or card nodes",
        )
        assert(
          root === scrollRoot() && Math.abs(root.scrollTop - previousScrollTop) < 1,
          "Failed refresh replaced the Home scroll root or reset its position",
        )
        assert(document.activeElement === focusedCard, "Failed refresh stole Home keyboard focus")
      },
    ],
    [
      "HOME_RESUME_TRIGGERS_REFRESH",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
        })
        await waitFor(
          () => contentState.get().isArticleListReady,
          "Home did not load before resume refresh",
        )
        const initialRequestCount = listRequests().length
        const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState")
        let visibility = "visible"
        try {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => visibility,
          })
          globalThis.dispatchEvent(new Event("blur"))
          visibility = "hidden"
          document.dispatchEvent(new Event("visibilitychange"))
          visibility = "visible"
          document.dispatchEvent(new Event("visibilitychange"))
          globalThis.dispatchEvent(new Event("focus"))
          await waitFor(
            () => listRequests().length > initialRequestCount,
            "Returning from hidden/blurred state did not refresh Home",
          )
          await new Promise((resolve) => setTimeout(resolve, 400))
          assert(
            listRequests().length === initialRequestCount + 1,
            "Visibility and focus started more than one Home refresh",
          )
        } finally {
          if (originalVisibility) {
            Object.defineProperty(document, "visibilityState", originalVisibility)
          } else {
            delete document.visibilityState
          }
        }
      },
    ],
    [
      "HOME_RECONNECT_TRIGGERS_REFRESH",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
        })
        await waitFor(
          () => contentState.get().isArticleListReady,
          "Home did not load before reconnect refresh",
        )
        const initialRequestCount = listRequests().length
        const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine")
        let online = true
        try {
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => online,
          })
          online = false
          globalThis.dispatchEvent(new Event("offline"))
          online = true
          globalThis.dispatchEvent(new Event("online"))
          await waitFor(
            () => listRequests().length > initialRequestCount,
            "Offline-to-online recovery did not refresh Home",
          )
          await new Promise((resolve) => setTimeout(resolve, 400))
          assert(
            listRequests().length === initialRequestCount + 1,
            "Reconnect started more than one Home refresh",
          )
        } finally {
          if (originalOnline) {
            Object.defineProperty(navigator, "onLine", originalOnline)
          } else {
            delete navigator.onLine
          }
        }
      },
    ],
    [
      "HOME_RESUME_RECONNECT_EVENTS_COALESCE",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Home did not load before lifecycle refresh checks",
        )
        const initialRequestCount = listRequests().length
        const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState")
        const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine")
        let visibility = "visible"
        let online = true
        try {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => visibility,
          })
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => online,
          })

          online = false
          globalThis.dispatchEvent(new Event("offline"))
          globalThis.dispatchEvent(new Event("blur"))
          visibility = "hidden"
          document.dispatchEvent(new Event("visibilitychange"))

          visibility = "visible"
          document.dispatchEvent(new Event("visibilitychange"))
          online = true
          globalThis.dispatchEvent(new Event("online"))
          globalThis.dispatchEvent(new Event("focus"))

          await waitFor(
            () => listRequests().length > initialRequestCount,
            "Resume/reconnect did not refresh the Home list",
          )
          await new Promise((resolve) => setTimeout(resolve, 400))
          assert(
            listRequests().length === initialRequestCount + 1,
            `Resume and reconnect started ${listRequests().length - initialRequestCount} refresh requests`,
          )
          assert(
            starredProfileRequests().length === 1,
            "Resume/reconnect started another personalization profile request",
          )
        } finally {
          if (originalVisibility) {
            Object.defineProperty(document, "visibilityState", originalVisibility)
          } else {
            delete document.visibilityState
          }
          if (originalOnline) {
            Object.defineProperty(navigator, "onLine", originalOnline)
          } else {
            delete navigator.onLine
          }
        }
      },
    ],
    [
      "HOME_RESUME_WHILE_OFFLINE_WAITS_FOR_RECONNECT",
      async () => {
        await mount("/", {
          entries: personalizationFixtures.home,
          total: personalizationFixtures.home.length,
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Home did not commit before offline resume test",
        )
        const committedHighlights = ids()
        const committedRecent = recentIds()
        const initialRequestCount = listRequests().length
        const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState")
        const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine")
        let visibility = "visible"
        let online = true
        try {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => visibility,
          })
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => online,
          })

          online = false
          globalThis.dispatchEvent(new Event("offline"))
          globalThis.dispatchEvent(new Event("blur"))
          visibility = "hidden"
          document.dispatchEvent(new Event("visibilitychange"))
          articleFailure = true
          visibility = "visible"
          document.dispatchEvent(new Event("visibilitychange"))
          globalThis.dispatchEvent(new Event("focus"))
          await new Promise((resolve) => setTimeout(resolve, 350))
          const offlineRefreshCount = listRequests().length - initialRequestCount

          articleFailure = false
          online = true
          globalThis.dispatchEvent(new Event("online"))
          await new Promise((resolve) => setTimeout(resolve, 400))
          const reconnectRefreshCount =
            listRequests().length - initialRequestCount - offlineRefreshCount

          assert(
            offlineRefreshCount === 0 && reconnectRefreshCount === 1,
            `Offline resume consumed the lifecycle refresh opportunity (offline=${offlineRefreshCount}, reconnect=${reconnectRefreshCount})`,
          )
          assert(
            contentState.get().isArticleListReady &&
              !contentState.get().articleListError &&
              ids().join(",") === committedHighlights.join(",") &&
              recentIds().join(",") === committedRecent.join(","),
            "Reconnect did not recover the committed Home projection cleanly",
          )
        } finally {
          articleFailure = false
          if (originalVisibility) {
            Object.defineProperty(document, "visibilityState", originalVisibility)
          } else {
            delete document.visibilityState
          }
          if (originalOnline) {
            Object.defineProperty(navigator, "onLine", originalOnline)
          } else {
            delete navigator.onLine
          }
        }
      },
    ],
    [
      "ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION",
      async () => {
        await mount("/", {
          entries: paginationEntries(20),
          total: 40,
          pages: [paginationEntries(20, 18)],
        })
        await waitFor(
          () => contentState.get().isArticleListReady && cards().length === 3,
          "Home session did not load before request-count checks",
        )
        assert(
          starredProfileRequests().length === 1,
          "Initial Home profile query count was not one",
        )
        await loadNextPage(20)
        await settle()
        assert(starredProfileRequests().length === 1, "Load-more re-requested the profile")
        const highlightId = Number(cards()[0].dataset.entryId)
        await openMenu(highlightId)
        clickMenu(englishPhrases.article_card.star_tooltip)
        await waitFor(() => starMutationRequests === 1, "Existing star mutation did not settle")
        await openMenu(highlightId)
        clickMenu(englishPhrases.article_card.unstar_tooltip)
        await waitFor(() => starMutationRequests === 2, "Existing unstar mutation did not settle")
        updateEntriesStatusOptimistically([contentState.get().entries[0]], "read")
        await waitFor(() => statusMutationRequests === 1, "Existing read mutation did not settle")
        await settle()
        await navigate(`/entry/${highlightId}`)
        await waitFor(() => readerIs(highlightId), "Reader did not open from Home")
        await navigate(-1)
        await waitFor(
          () => router.state.location.pathname === "/" && !contentState.get().activeContent,
          "Browser Back did not return from the reader to Home",
        )
        assert(
          starredProfileRequests().length === 1,
          "Load-more, star/unstar, status settlement, or reader return re-requested the profile",
        )
      },
    ],
    [
      "ALL_UNREAD_UNCHANGED",
      async () => {
        await mount("/all", { showStatus: "all" })
        await waitFor(() => contentState.get().isArticleListReady, "All list did not load")
        assert(starredProfileRequests().length === 0, "All started a Home-only profile request")
        const allRequest = new URL(listRequests()[0], "https://fixture.invalid").searchParams
        assert(!allRequest.has("status"), "All request acquired an unread-only filter")
        settingsState.set({ ...settingsState.get(), showStatus: "unread" })
        await waitFor(
          () => contentState.get().isArticleListReady && listRequests().length === 2,
          "Unread did not use the existing list request lifecycle",
        )
        const unreadRequest = new URL(listRequests()[1], "https://fixture.invalid").searchParams
        assert(
          unreadRequest.get("status") === "unread" && starredProfileRequests().length === 0,
          "Unread request or Home-only profile boundary changed",
        )
        assert(
          contentState
            .get()
            .entries.map(({ id }) => id)
            .join(",") === "101,202",
          "All/Unread changed canonical candidate order",
        )
      },
    ],
  ]
  const matrixScenarios = [
    [
      "HARNESS_SCENARIO_MATRIX_COMPLETE",
      async () => {
        const requiredViewports = [
          "390x844",
          "768x1024",
          "884x1104",
          "1024x768",
          "1280x800",
          "1440x900",
        ]
        const requiredThemes = ["light", "dark"]
        const requiredGates = [
          "HOME_FIRST_SECTION_CLEAR_OF_CHROME",
          "HOME_SESSION_STABLE_AFTER_READER_READ",
          "HOME_NO_OVERFLOW",
          "HOME_SECTION_HIERARCHY",
          "HOME_PRIMARY_TEXT_ONLY",
          "HOME_SECONDARY_LAYOUT",
          "HOME_RECENT_GRID",
          "HOME_EMPTY_RECENT",
          "HOME_LOADING",
          "HOME_REFRESH_ERROR_WITH_CONTENT",
          "HOME_LIGHT",
          "HOME_DARK",
          "HOME_IDENTITY_FAILURE_RECOVERY",
          "HOME_LAST_READ_TRANSITIONS_TO_TUDO_EM_DIA",
          "HOME_READ_FAILURE_DOES_NOT_ZERO_TOTAL",
          "HOME_MARK_UNREAD_RECONCILES_TOTAL",
          "HOME_UNLOADED_MARK_UNREAD_REENABLES_PAGINATION",
          "HOME_TOTAL_RECONCILIATION_STALE_SESSION_PROTECTED",
          "CANONICAL_HOME_QUERY_UNCHANGED",
          "NO_SECOND_CANDIDATE_STREAM",
          "PERSONALIZATION_EXPLAINER_TRUTHFUL",
          "PROFILE_DEADLINE_FALLBACK_NO_RECOMPOSE",
          "HOME_STALE_SESSION_CANNOT_COMMIT",
          "HOME_REQUEST_KEY_CHANGE_CREATES_NEW_SESSION",
          "HOME_MANUAL_REFRESH_PRESERVES_SESSION",
          "HOME_REFRESH_FAILURE_PRESERVES_COMMITTED_SESSION",
          "HOME_RESUME_TRIGGERS_REFRESH",
          "HOME_RECONNECT_TRIGGERS_REFRESH",
          "HOME_RESUME_RECONNECT_EVENTS_COALESCE",
          "HOME_RESUME_WHILE_OFFLINE_WAITS_FOR_RECONNECT",
          "HOME_REFRESH_AFTER_PAGINATION_DOES_NOT_SKIP_NEW_CANONICAL_GAP",
          "ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION",
          "ALL_UNREAD_UNCHANGED",
        ]
        const requiredProductScenarios = [
          "THREE_PLUS_UNREAD_WITH_IMAGE_PRIMARY",
          "THREE_PLUS_UNREAD_WITH_TEXT_ONLY_PRIMARY",
          "TWO_UNREAD",
          "ONE_UNREAD",
          "ZERO_UNREAD",
          "MIXED_IMAGE_AND_TEXT_ONLY",
          "DIVERSE_SOURCE_AND_CATEGORY",
          "SAME_SOURCE_AND_CATEGORY",
          "LOADING",
          "INITIAL_ERROR",
          "REFRESH_ERROR_RETAINS_CONTENT",
          "LOAD_MORE_ERROR",
          "AFTER_CONFIRMED_READ_STABLE_SESSION",
          "AFTER_MARK_UNREAD",
          "AFTER_STAR_AND_UNSTAR",
          "PHASE2D_PERSONALIZED_PROJECTION",
          "PHASE2D_TRUTHFUL_EXPLAINER_AND_FALLBACKS",
          "PHASE2D_DEADLINE_AND_STALE_PROFILE",
          "PHASE2D_EXPLICIT_REFRESH",
          "PHASE2D_QUERY_SCOPE_AND_SESSION",
          "PHASE2D_SESSION_STABILITY",
          "PHASE2D_NON_HOME_LISTS",
        ]
        const requiredManualGates = [
          "EDITORIAL_HIERARCHY_CLEAR",
          "PRIMARY_NOT_OVERSIZED",
          "SECONDARIES_BALANCED",
          "RECENT_VISIBLE_AS_CONTINUATION",
          "TEXT_ONLY_PRIMARY_FEELS_INTENTIONAL",
          "NO_GLASS_CONTENT_SURFACES",
          "OLED_SURFACE_SEPARATION",
          "NO_LAYOUT_JUMP_ON_READER_RETURN",
          "NO_UNEXPECTED_RECOMPOSE",
          "TOUCH_TARGETS_USABLE",
          "MOBILE_SINGLE_PANE",
        ]
        const allScenarios = [
          ...scenarios,
          ...highlightScenarios,
          ...recentScenarios,
          ...listSentinelScenarios,
          ...stateScenarios,
          ...responsiveScenarios,
          ...personalizationScenarios,
          ...primaryHierarchyScenarios,
          ...readerScenarios,
          ...readerTypographyScenarios,
          ...readerMeasureScenarios,
          ...matrixScenarios,
        ]
        const gateNames = new Set(allScenarios.map(([name]) => name))
        const matrix = phase2cEditorialHomeMatrix
        const viewportIds = matrix.viewports.map(({ width, height }) => `${width}x${height}`)
        const productScenarioIds = new Set(matrix.scenarios.map(({ id }) => id))
        const manualGateIds = matrix.manualGates.map(({ name }) => name)
        const missing = {
          viewports: requiredViewports.filter((viewport) => !viewportIds.includes(viewport)),
          unexpectedViewports: viewportIds.filter(
            (viewport) => !requiredViewports.includes(viewport),
          ),
          themes: requiredThemes.filter((theme) => !matrix.themes.includes(theme)),
          unexpectedThemes: matrix.themes.filter((theme) => !requiredThemes.includes(theme)),
          gates: [...new Set([...requiredGates, ...matrix.automatedGates])].filter(
            (gate) => !matrix.automatedGates.includes(gate) || !gateNames.has(gate),
          ),
          productScenarios: requiredProductScenarios.filter(
            (scenario) => !productScenarioIds.has(scenario),
          ),
          scenarios: matrix.scenarios
            .filter(
              ({ id, covers, fixtures }) =>
                !id ||
                covers.length === 0 ||
                fixtures.length === 0 ||
                covers.some((gate) => !gateNames.has(gate)),
            )
            .map(({ id, covers, fixtures }) => {
              const missingCoverage = covers.filter((gate) => !gateNames.has(gate))
              return `${id || "UNNAMED"}${missingCoverage.length > 0 ? ` missing gates ${missingCoverage.join(",")}` : " missing fixture/coverage"}`
            }),
          manualGates: matrix.manualGates
            .filter(({ name, status }) => !name || status !== "MANUAL_REQUIRED")
            .map(({ name }) => name || "UNNAMED"),
          unexpectedManualGates: manualGateIds.filter(
            (gate) => !requiredManualGates.includes(gate),
          ),
          missingManualGates: requiredManualGates.filter((gate) => !manualGateIds.includes(gate)),
        }
        const missingSummary = Object.entries(missing)
          .filter(([, values]) => values.length)
          .map(([type, values]) => `${type}=[${values.join(", ")}]`)
          .join("; ")
        assert(!missingSummary, `Harness scenario matrix is incomplete: ${missingSummary}`)
      },
    ],
  ]
  const scenarioSuites = [
    { name: "routes", scenarios },
    { name: "highlights", scenarios: highlightScenarios },
    { name: "recent", scenarios: recentScenarios },
    { name: "list-sentinel-regression", scenarios: listSentinelScenarios },
    { name: "states-and-recovery", scenarios: stateScenarios },
    { name: "responsive-visual", scenarios: responsiveScenarios },
    { name: "personalization", scenarios: personalizationScenarios },
    { name: "home-visual-01-primary-hierarchy", scenarios: primaryHierarchyScenarios },
    { name: "reader-visual-01-reading-ergonomics", scenarios: readerScenarios },
    { name: "reader-visual-02a1-editorial-typography", scenarios: readerTypographyScenarios },
    { name: "reader-measure-01-prose-measure", scenarios: readerMeasureScenarios },
    { name: "reader-visual-02a2-editorial-header-column", scenarios: readerVisual02a2Scenarios },
    { name: "matrix-completeness", scenarios: matrixScenarios },
  ]
  const runSuites = async (selectedSuites, { recordViewportTheme = false } = {}) => {
    setRunning(true)
    setResults([])
    const next = []
    try {
      for (const { name: suite, scenarios: selectedScenarios } of selectedSuites) {
        const responsiveMode = [
          responsiveScenarios,
          primaryHierarchyScenarios,
          readerScenarios,
          readerTypographyScenarios,
          readerMeasureScenarios,
          readerVisual02a2Scenarios,
        ].includes(selectedScenarios)
        if (responsiveMode) {
          document.body.classList.add("phase2c-responsive-running")
          await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          })
        }
        try {
          for (const [name, scenario] of selectedScenarios) {
            if (selectedTheme === "dark") {
              document.body.setAttribute("arco-theme", "dark")
            } else {
              document.body.removeAttribute("arco-theme")
            }
            try {
              await scenario()
              next.push({
                suite,
                name,
                status: "PASS",
                gateClass: "AUTOMATED",
                metrics: captureHomeHarnessMetrics(selectedTheme),
                ...(name === "HOME_SECONDARY_LAYOUT" || name === "HOME_RECENT_GRID"
                  ? { responsive: globalThis.__phase2cHomeResponsive }
                  : {}),
                ...(name === "HOME_LIGHT" || name === "HOME_DARK"
                  ? { themes: globalThis.__phase2cHomeThemeMetrics }
                  : {}),
                ...(name === "HOME_SESSION_STABLE_AFTER_READER_READ"
                  ? { readerReturn: globalThis.__phase2dReaderReturnStability }
                  : {}),
                ...(name === "READER_MEASURE_01_HEADER_BODY_ALIGNMENT" ||
                name === "READER_VISUAL_02A2_HEADER_PROSE_ALIGNMENT"
                  ? {
                      readerHeaderBodyAlignment:
                        globalThis.__readerMeasure01Metrics?.headerBodyAlignment,
                    }
                  : {}),
              })
            } catch (error) {
              next.push({
                suite,
                name,
                status: "FAIL",
                gateClass: "AUTOMATED",
                error: error.message,
                path: router?.state.location.pathname,
                activeId: contentState.get().activeContent?.id,
                readerText: document.querySelector(".article-body")?.textContent,
                metrics: captureHomeHarnessMetrics(selectedTheme),
              })
            }
            setResults([...next])
          }
        } finally {
          if (responsiveMode) {
            document.body.classList.remove("phase2c-responsive-running")
          }
        }
      }
      if (recordViewportTheme) {
        const viewport = phase2cEditorialHomeMatrix.viewports.find(
          ({ width, height }) => width === innerWidth && height === innerHeight,
        )
        if (viewport) {
          const id = matrixPairId(viewport, selectedTheme)
          const run = {
            viewport: id.split(":", 1)[0],
            theme: selectedTheme,
            passed: next.filter(({ status }) => status === "PASS").length,
            total: next.length,
            status: next.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
            completedAt: new Date().toISOString(),
          }
          const records = { ...readMatrixRuns(), [id]: run }
          sessionStorage.setItem(MATRIX_RUNS_STORAGE_KEY, JSON.stringify(records))
          setMatrixRuns(records)
        }
      }
    } finally {
      document.body.classList.remove("phase2c-responsive-running")
      setRunning(false)
    }
  }
  const run = async (selectedScenarios = scenarios) => {
    const suite = scenarioSuites.find(({ scenarios: candidate }) => candidate === selectedScenarios)
    return runSuites([{ name: suite?.name ?? "selected", scenarios: selectedScenarios }])
  }
  const runCompleteMatrix = () => runSuites(scenarioSuites, { recordViewportTheme: true })
  return (
    <main>
      <div className="harness-controls">
        <h1>Phase 2C editorial Home harness</h1>
        <p>Local deterministic network fixtures, production route and reader lifecycle.</p>
        <label htmlFor="phase2c-harness-theme">Run theme</label>
        <select
          data-testid="harness-theme"
          disabled={running}
          id="phase2c-harness-theme"
          value={selectedTheme}
          onChange={(event) => setSelectedTheme(event.target.value)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark / OLED</option>
        </select>
        <button disabled={running} onClick={() => void run(scenarios)}>
          Run route scenario
        </button>
        <button disabled={running} onClick={() => void run(highlightScenarios)}>
          Run Highlights scenario
        </button>
        <button disabled={running} onClick={() => void run(recentScenarios)}>
          Run Recent pagination scenario
        </button>
        <button disabled={running} onClick={() => void run(listSentinelScenarios)}>
          Run shared list sentinel regression
        </button>
        <button disabled={running} onClick={() => void run(stateScenarios)}>
          Run Home loading and recovery scenario
        </button>
        <button disabled={running} onClick={() => void run(responsiveScenarios)}>
          Run Home responsive visual gates
        </button>
        <button disabled={running} onClick={() => void run(personalizationScenarios)}>
          Run Phase 2D personalization scenario
        </button>
        <button disabled={running} onClick={() => void run(primaryHierarchyScenarios)}>
          Run HOME-VISUAL-01 Primary hierarchy cases
        </button>
        <button disabled={running} onClick={() => void run(readerScenarios)}>
          Run READER-VISUAL-01 reading ergonomics cases
        </button>
        <button disabled={running} onClick={() => void run(readerTypographyScenarios)}>
          Run READER-VISUAL-02A1 editorial typography cases
        </button>
        <button disabled={running} onClick={() => void run(readerMeasureScenarios)}>
          Run READER-MEASURE-01 prose measure cases
        </button>
        <button disabled={running} onClick={() => void run(readerVisual02a2Scenarios)}>
          Run READER-VISUAL-02A2 header-column alignment gate
        </button>
        <button disabled={running} onClick={() => void run(matrixScenarios)}>
          Run scenario matrix completeness gate
        </button>
        <button disabled={running} onClick={() => void runCompleteMatrix()}>
          Run all scenarios at this viewport and theme
        </button>
        <button data-testid="reset-harness" disabled={running} onClick={resetHarness}>
          Reset harness session
        </button>
        <p data-testid="suite-summary">
          {running
            ? "RUNNING"
            : `${results.filter(({ status }) => status === "PASS").length}/${results.length} automated gates PASS`}
        </p>
        <section aria-labelledby="harness-matrix-heading" className="harness-matrix-report">
          <h2 id="harness-matrix-heading">Viewport and theme matrix</h2>
          <p data-testid="matrix-coverage-summary">
            {Object.values(matrixRuns).filter(({ status }) => status === "PASS").length}/
            {phase2cEditorialHomeMatrix.viewports.length * phase2cEditorialHomeMatrix.themes.length}{" "}
            viewport/theme pairs PASS
          </p>
          <pre data-testid="matrix-coverage">{JSON.stringify(matrixRuns, null, 2)}</pre>
        </section>
        <section aria-labelledby="harness-manual-heading" className="harness-manual-report">
          <h2 id="harness-manual-heading">Perceptual device gates</h2>
          <p>
            These checks require human review on the deployed device and are not automated PASS
            results.
          </p>
          <ul data-testid="manual-gates">
            {phase2cEditorialHomeMatrix.manualGates.map(({ name, status }) => (
              <li key={name}>
                <code>{name}</code>: <strong>{status}</strong>
              </li>
            ))}
          </ul>
        </section>
        <pre data-testid="suite-results">{JSON.stringify(results, null, 2)}</pre>
      </div>
      {probe && <RouterProvider key={probe.key} router={probe.router} />}
    </main>
  )
}

const root =
  globalThis.__phase2cHomeRoot ??
  (globalThis.__phase2cHomeRoot = createRoot(document.querySelector("#root")))
root.render(<Harness />)

export default Harness
