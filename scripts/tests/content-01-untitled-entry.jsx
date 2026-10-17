/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"

import ArticleCard from "@/components/Article/ArticleCard"
import ArticleDetail from "@/components/Article/ArticleDetail"
import ArticleEntry from "@/components/Article/ArticleEntry"
import ArticleGridCard from "@/components/Article/ArticleGridCard"
import ArticleListItem from "@/components/Article/ArticleListItem"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import useDocumentTitle from "@/hooks/useDocumentTitle"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"

import "@/components/Article/ArticleDetail.css"
import "@/components/Article/ArticleEntry.css"
import "@/components/Article/ArticleCard.css"
import "@/components/Article/ArticleGridCard.css"
import "@/components/Article/ArticleListItem.css"
import "@/components/Article/ReaderStyles.css"
import "@/components/Article/littlefoot.css"

const FALLBACK_TITLE = phrases.article_card.untitled_article
const polyglot = new Polyglot({ phrases, locale: "en-US" })
polyglotState.set({ polyglot })

const feed = {
  id: 12,
  title: "Example feed",
  icon: { icon_id: 1 },
  site_url: "https://example.com",
  feed_url: "https://example.com/feed.xml",
  category: { id: 4, title: "Example category" },
}
const untitledUnreadEntry = {
  id: 101,
  title: " \n ",
  status: "unread",
  starred: false,
  feed,
  author: "Reporter",
  published_at: "2026-10-16T12:00:00.000Z",
  reading_time: 1,
  previewText: "",
  content: "<p>Reader body remains unchanged.</p>",
  url: "https://example.com/story",
  attachments: { items: [], primaryMedia: null },
  cardDeckCandidates: [],
  cardDeckFallback: null,
}
const untitledReadEntry = { ...untitledUnreadEntry, id: 102, title: null, status: "read" }
const titledEntry = {
  ...untitledUnreadEntry,
  id: 103,
  title: "OpenAI releases new model",
  status: "read",
}

contentState.set({
  ...contentState.get(),
  activeContent: untitledUnreadEntry,
  entries: [untitledUnreadEntry, untitledReadEntry, titledEntry],
  infoFrom: "category",
  infoId: feed.category.id,
})
dataState.set({
  ...dataState.get(),
  categoriesData: [feed.category],
  feedsData: [feed],
})

const articleActivation = {
  getPrimaryLinkProps: (entry) => ({ href: `/all/entry/${entry.id}` }),
  openInReactFlux: () => {},
  opensSourceOnCardClick: false,
}

const EntryFixture = ({ entry, layout, presenter: Presenter, testId }) => (
  <section data-testid={testId}>
    <ArticleEntry
      articleActivation={articleActivation}
      entry={entry}
      layout={layout}
      observeRead={() => {}}
      presenter={Presenter}
    />
  </section>
)

const DocumentTitleProbe = () => {
  const pageTitle = useDocumentTitle()
  return <output data-testid="content-01-page-title">{pageTitle}</output>
}

const runContent01Checks = () => {
  const byTestId = (name) => document.querySelector(`[data-testid="${CSS.escape(name)}"]`)
  const visibleTitle = (name, selector) => byTestId(name)?.querySelector(selector)?.textContent
  const results = {
    COLUMN_TITLE: visibleTitle("column-unread", ".card-title") === FALLBACK_TITLE,
    CARD_TITLE: visibleTitle("card-title", ".card-title") === FALLBACK_TITLE,
    GRID_TITLE: visibleTitle("grid-unread", ".grid-card-title") === FALLBACK_TITLE,
    LIST_TITLE: visibleTitle("list-unread", ".list-entry-title") === FALLBACK_TITLE,
    READER_H1:
      document.querySelector(".article-title")?.tagName === "H1" &&
      document.querySelector(".article-title")?.textContent.trim() === FALLBACK_TITLE,
    READER_LINKED_H1:
      document.querySelector(".article-title a")?.textContent.trim() === FALLBACK_TITLE,
    DOCUMENT_TITLE:
      document.title === `${FALLBACK_TITLE} - NewsFlux` && feed.category.title !== FALLBACK_TITLE,
    UNREAD_ARIA_LABEL_NONEMPTY:
      Boolean(
        byTestId("column-unread")?.querySelector(".article-entry")?.getAttribute("aria-label"),
      ) &&
      byTestId("column-unread")?.querySelector(".article-entry")?.getAttribute("aria-label") ===
        "Untitled article, unread",
    READ_ARIA_LABEL_NONEMPTY:
      byTestId("read-entry")?.querySelector(".article-entry")?.getAttribute("aria-label") ===
      FALLBACK_TITLE,
    VALID_TITLE_PRESERVED:
      visibleTitle("valid-title", ".card-title") === "OpenAI releases new model",
    UNREAD_CUE_PRESERVED: byTestId("column-unread")
      ?.querySelector(".article-entry")
      ?.classList.contains("unread"),
    READER_BODY_PRESERVED: document
      .querySelector(".article-content")
      ?.textContent.includes("Reader body remains unchanged."),
    NO_EMPTY_HEADINGS: [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].every(
      (heading) => heading.textContent.trim().length > 0,
    ),
    NO_EMPTY_ENTRY_NAMES: [...document.querySelectorAll(".article-entry")].every(
      (entry) => (entry.getAttribute("aria-label") ?? "").trim().length > 0,
    ),
    FALLBACK_NOT_HIDDEN:
      byTestId("column-unread")?.querySelector(".card-title")?.closest('[aria-hidden="true"]') ===
      null,
  }

  for (const [name, passed] of Object.entries(results)) {
    const output = byTestId(name.toLowerCase().replaceAll("_", "-"))
    if (output) {
      output.textContent = passed ? "PASS" : "FAIL"
      output.dataset.status = passed ? "pass" : "fail"
    }
  }

  const passedCount = Object.values(results).filter(Boolean).length
  const summary = byTestId("content-01-summary")
  summary.textContent = `${passedCount}/${Object.keys(results).length} PASS`
  summary.dataset.status = passedCount === Object.keys(results).length ? "pass" : "fail"
  globalThis.content01Results = results
}

const AccessibilityStatus = () => {
  React.useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(runContent01Checks, 250)))
  }, [])

  const resultNames = [
    "COLUMN_TITLE",
    "CARD_TITLE",
    "GRID_TITLE",
    "LIST_TITLE",
    "READER_H1",
    "READER_LINKED_H1",
    "DOCUMENT_TITLE",
    "UNREAD_ARIA_LABEL_NONEMPTY",
    "READ_ARIA_LABEL_NONEMPTY",
    "VALID_TITLE_PRESERVED",
    "UNREAD_CUE_PRESERVED",
    "READER_BODY_PRESERVED",
    "NO_EMPTY_HEADINGS",
    "NO_EMPTY_ENTRY_NAMES",
    "FALLBACK_NOT_HIDDEN",
  ]

  return (
    <aside aria-label="CONTENT-01 browser gate">
      <h2>CONTENT-01 checks</h2>
      <output data-testid="content-01-summary">RUNNING</output>
      <button data-testid="run-content-01-checks" type="button" onClick={runContent01Checks}>
        Re-run checks
      </button>
      <ul>
        {resultNames.map((name) => (
          <li key={name}>
            {name}: <output data-testid={name.toLowerCase().replaceAll("_", "-")}>RUNNING</output>
          </li>
        ))}
      </ul>
    </aside>
  )
}

const HarnessPage = () => (
  <AppDataContext.Provider
    value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
  >
    <DesktopSidebarContext.Provider value={{ detailCloseButtonRef: { current: null } }}>
      <ContextProvider>
        <main
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          }}
        >
          <DocumentTitleProbe />
          <EntryFixture
            entry={untitledUnreadEntry}
            layout="column"
            presenter={ArticleCard}
            testId="column-unread"
          />
          <section data-testid="card-title">
            <ArticleCard displayTitle={FALLBACK_TITLE} entry={untitledUnreadEntry} />
          </section>
          <EntryFixture
            entry={untitledUnreadEntry}
            layout="card"
            presenter={ArticleGridCard}
            testId="grid-unread"
          />
          <EntryFixture
            entry={untitledUnreadEntry}
            layout="list"
            presenter={ArticleListItem}
            testId="list-unread"
          />
          <EntryFixture
            entry={untitledReadEntry}
            layout="column"
            presenter={ArticleCard}
            testId="read-entry"
          />
          <EntryFixture
            entry={titledEntry}
            layout="column"
            presenter={ArticleCard}
            testId="valid-title"
          />
          <ArticleDetail />
          <AccessibilityStatus />
        </main>
      </ContextProvider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>
)

const root = createRoot(document.querySelector("#root"))
root.render(
  <MemoryRouter initialEntries={["/category/4"]}>
    <Routes>
      <Route element={<HarnessPage />} path="/category/:id" />
    </Routes>
  </MemoryRouter>,
)
