/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"

import ArticleDetail from "@/components/Article/ArticleDetail"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"

import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/App.css"
import "@/components/Article/ArticleDetail.css"
import "@/components/Article/ReaderStyles.css"
import "@/components/Article/littlefoot.css"

// UPSTREAM electh/ReactFlux 3b2b08fb "fix(article): render empty caption elements without children".
//
// Mounts the real ArticleDetail and inspects how `processFigcaptionContent` renders figcaptions.
//
//   ?content=control   captions without void elements (must pass before AND after the fix)
//   ?content=empty     captions with void/empty elements (<wbr>, <img>, <hr>, empty <span>)
//   ?content=all       both (default)
//   ?theme=light|dark
//
// Open /scripts/tests/article-empty-caption-01.html with `pnpm dev`; the result is rendered in
// [data-testid="report"] and mirrored on window.__articleCaptionReport.

const params = new URLSearchParams(location.search)
const contentMode = params.get("content") ?? "all"
const theme = params.get("theme") ?? "light"

document.body.setAttribute("arco-theme", theme)
polyglotState.set({ polyglot: new Polyglot({ phrases, locale: "en-US" }) })

const svgImage = (fill, width = 640, height = 360) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`,
  )}`

const INLINE_ICON = svgImage("#c2410c", 16, 16)

const paragraph = (index) =>
  `<p>Reader paragraph ${index}. The quick brown fox jumps over the lazy dog while the editorial column keeps a steady measure for long-form reading on every viewport.</p>`

const CONTROL_FIGURES = `
  <figure>
    <img src="${svgImage("#1d4ed8")}" alt="Plain figure" />
    <figcaption>Plain caption text</figcaption>
  </figure>
  ${paragraph(1)}
  <figure>
    <img src="${svgImage("#047857")}" alt="Nested figure" />
    <figcaption>Nested <b>bold <i>italic <u>deep</u></i></b> end</figcaption>
  </figure>
  ${paragraph(2)}
  <figure>
    <img src="${svgImage("#7c3aed")}" alt="Break figure" />
    <figcaption>line one<br>line two</figcaption>
  </figure>
`

const EMPTY_FIGURE = `
  <figure>
    <img src="${svgImage("#b91c1c")}" alt="Empty-element figure" />
    <figcaption>Before <wbr>after <img src="${INLINE_ICON}" alt="inline mark"> <hr> <span class="empty-marker"></span> tail</figcaption>
  </figure>
`

const LONG_TAIL = Array.from({ length: 24 }, (_, index) => paragraph(index + 3)).join("")

const buildContent = () => {
  const parts = [paragraph(0)]
  if (contentMode !== "empty") {
    parts.push(CONTROL_FIGURES)
  }
  if (contentMode !== "control") {
    parts.push(EMPTY_FIGURE)
  }
  parts.push(LONG_TAIL)
  return parts.join("\n")
}

const feed = {
  id: 12,
  title: "Example feed",
  icon: { icon_id: 1 },
  site_url: "https://example.com",
  feed_url: "https://example.com/feed.xml",
  category: { id: 4, title: "Example category" },
}
const TITLE = "Empty caption harness article"
const entry = {
  id: 501,
  title: TITLE,
  status: "unread",
  starred: false,
  feed,
  author: "Reporter",
  published_at: "2026-10-22T12:00:00.000Z",
  reading_time: 3,
  content: buildContent(),
  url: "https://example.com/story",
  attachments: { items: [], primaryMedia: null },
}

contentState.set({
  ...contentState.get(),
  activeContent: entry,
  entries: [entry],
  infoFrom: "category",
  infoId: feed.category.id,
})
dataState.set({ ...dataState.get(), categoriesData: [feed.category], feedsData: [feed] })

const stubReaderCommands = {
  canNavigateNext: false,
  canNavigatePrevious: false,
  exitDetailView: () => {},
  isResolving: false,
  navigateToNextArticle: () => {},
  navigateToPreviousArticle: () => {},
}

let renderError = null

class ReaderBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    renderError = String(error?.message ?? error)
  }

  render() {
    return this.state.failed ? (
      <p data-testid="render-failed">ArticleDetail failed to render</p>
    ) : (
      this.props.children
    )
  }
}

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

const waitFor = async (predicate, timeout = 5000) => {
  const started = performance.now()
  while (performance.now() - started < timeout) {
    if (predicate()) {
      return true
    }
    await sleep(25)
  }
  return false
}

const gates = {}
const setGate = (name, pass, detail = "") => {
  gates[name] = { pass: Boolean(pass), detail: String(detail) }
}

const captionOf = (marker) =>
  [...document.querySelectorAll(".article-body figure > figcaption")].find((caption) =>
    caption.textContent.includes(marker),
  )

const normalized = (node) => node?.textContent.replaceAll(/\s+/g, " ").trim()

const checkControlCaptions = () => {
  const plain = captionOf("Plain caption text")
  setGate(
    "NORMAL_CAPTION",
    normalized(plain) === "Plain caption text" && plain.children.length === 0,
    plain ? normalized(plain) : "caption missing",
  )

  const nested = captionOf("Nested")
  const nestedOk =
    Boolean(nested?.querySelector(":scope > b > i > u")) &&
    normalized(nested) === "Nested bold italic deep end"
  setGate(
    "NESTED_CAPTION",
    nestedOk,
    nested ? `${nested.innerHTML} | ${normalized(nested)}` : "caption missing",
  )

  const broken = captionOf("line one")
  setGate(
    "BR_SUPPRESSION",
    Boolean(broken) && !broken.querySelector("br") && broken.textContent === "line oneline two",
    broken ? broken.innerHTML : "caption missing",
  )

  const figures = [...document.querySelectorAll(".article-body figure")]
  const controlFigures = figures.filter(
    (figure) => !figure.querySelector("figcaption .empty-marker"),
  )
  const problems = []
  if (controlFigures.length !== 3) {
    problems.push(`expected 3 control figures, found ${controlFigures.length}`)
  }
  for (const figure of controlFigures) {
    const [first, second, ...rest] = figure.children
    const image = first?.querySelector("img")
    if (
      first?.tagName !== "DIV" ||
      !image?.getAttribute("src") ||
      second?.tagName !== "FIGCAPTION"
    ) {
      problems.push(
        `figure shape is ${[...figure.children].map((child) => child.tagName).join(">")}`,
      )
    }
    if (rest.length > 0) {
      problems.push("figure has unexpected extra children")
    }
  }
  setGate(
    "FIGURE_IMAGE",
    problems.length === 0,
    problems.join("; ") || "3 figures: div>img + figcaption",
  )
}

const checkEmptyCaption = () => {
  const caption = captionOf("tail")
  const problems = []
  if (caption) {
    for (const selector of ["wbr", 'img[alt="inline mark"]', "hr", "span.empty-marker"]) {
      const element = caption.querySelector(selector)
      if (!element) {
        problems.push(`${selector} was dropped`)
      } else if (element.childNodes.length > 0) {
        problems.push(`${selector} gained children`)
      }
    }
    if (normalized(caption) !== "Before after tail") {
      problems.push(`caption text is "${normalized(caption)}"`)
    }
  } else {
    problems.push("figcaption missing")
  }
  setGate(
    "EMPTY_CAPTION",
    problems.length === 0,
    problems.join("; ") || "wbr, img, hr and empty span preserved without children",
  )
}

const checkReader = async () => {
  const article = document.querySelector("article.article-content")
  const heading = document.querySelector("h1.article-title")
  const body = document.querySelector(".article-body")
  const scrollElement =
    document.querySelector(".scroll-container .simplebar-content-wrapper") ??
    document.querySelector(".scroll-container[data-native-scroll]")
  const problems = []

  if (!article || !body) {
    problems.push("article reader did not render")
  }
  if (heading?.textContent.trim() !== TITLE) {
    problems.push("title heading missing")
  }
  if (!body?.textContent.includes("Reader paragraph 0")) {
    problems.push("article body text missing")
  }
  if (scrollElement) {
    if (scrollElement.scrollHeight <= scrollElement.clientHeight) {
      problems.push("article is not scrollable")
    }
    const before = scrollElement.scrollTop
    scrollElement.scrollTop = 400
    await sleep(100)
    if (scrollElement.scrollTop <= before) {
      problems.push("scrollTop did not advance")
    }
    scrollElement.scrollTop = 0
  } else {
    problems.push("no scroll element")
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
    problems.push("document scrolls horizontally")
  }
  setGate(
    "ARTICLE_READER",
    problems.length === 0,
    problems.join("; ") || "renders, scrolls, no overflow",
  )
}

const publish = () => {
  const failed = Object.values(gates).some(({ pass }) => !pass) || Boolean(renderError)
  const report = {
    content: contentMode,
    theme,
    viewport: `${innerWidth}x${innerHeight}`,
    status: failed ? "FAIL" : "PASS",
    renderError,
    gates,
  }
  globalThis.__articleCaptionReport = report
  const output = document.querySelector('[data-testid="report"]')
  output.dataset.status = report.status
  output.textContent = JSON.stringify(report, null, 1)
}

const run = async () => {
  await waitFor(
    () =>
      renderError ||
      (document.querySelector(".article-body") &&
        !document.querySelector(".article-body[aria-busy]") &&
        document.querySelector(".article-body")?.children.length > 0),
  )
  await sleep(300)

  if (renderError) {
    for (const name of [
      "NORMAL_CAPTION",
      "NESTED_CAPTION",
      "BR_SUPPRESSION",
      "FIGURE_IMAGE",
      "ARTICLE_READER",
    ]) {
      if (contentMode !== "empty" || name === "ARTICLE_READER") {
        setGate(name, false, `ArticleDetail threw: ${renderError}`)
      }
    }
    if (contentMode !== "control") {
      setGate("EMPTY_CAPTION", false, `ArticleDetail threw: ${renderError}`)
    }
    return
  }

  if (contentMode !== "empty") {
    checkControlCaptions()
  }
  if (contentMode !== "control") {
    checkEmptyCaption()
  }
  await checkReader()
}

const HarnessPage = () => (
  <AppDataContext.Provider
    value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
  >
    <DesktopSidebarContext.Provider value={{ detailCloseButtonRef: { current: null } }}>
      <ReaderCommandsContext.Provider value={stubReaderCommands}>
        <ContextProvider>
          <div style={{ display: "flex", height: "100%" }}>
            <ReaderBoundary>
              <ArticleDetail />
            </ReaderBoundary>
          </div>
          <output data-status="WAITING" data-testid="report" />
        </ContextProvider>
      </ReaderCommandsContext.Provider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>
)

createRoot(document.querySelector("#root")).render(
  <MemoryRouter initialEntries={["/category/4"]}>
    <Routes>
      <Route element={<HarnessPage />} path="/category/:id" />
    </Routes>
  </MemoryRouter>,
)

try {
  await run()
} catch (error) {
  renderError ??= String(error?.message ?? error)
}
publish()
