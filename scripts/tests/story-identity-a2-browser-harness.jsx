import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/components/Article/ArticleList.css"
import "@/components/Article/ArticleEntry.css"

import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import HomeRecent from "@/components/Home/HomeRecent"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { commitIdentityData, dataState } from "@/store/dataState"
import { FixtureScoreProvider } from "@/utils/story-identity/fixture-score-provider"
import { NullScoreProvider } from "@/utils/story-identity/null-score-provider"
import {
  resetGlobalStoryIdentity,
  setGlobalStoryScoreProvider,
} from "@/utils/story-identity/request-controller"

// ---------------------------------------------------------------------------
// 1. Web Worker instrumentation (Section 11)
// ---------------------------------------------------------------------------
const workerTelemetry = {
  started: 0,
  resultReceived: 0,
  errorCount: 0,
  lastResult: null,
  activeInstances: [],
}

if (globalThis.Worker !== undefined) {
  const NativeWorker = globalThis.Worker
  globalThis.Worker = class InstrumentedWorker extends NativeWorker {
    constructor(scriptUrl, options) {
      super(scriptUrl, options)
      workerTelemetry.started += 1
      workerTelemetry.activeInstances.push(this)

      this.addEventListener("message", (event) => {
        if (event.data?.type === "STORY_PROJECTION_SUCCESS") {
          workerTelemetry.resultReceived += 1
          workerTelemetry.lastResult = event.data
        } else if (event.data?.type === "STORY_PROJECTION_ERROR") {
          workerTelemetry.errorCount += 1
        }
      })

      this.addEventListener("error", () => {
        workerTelemetry.errorCount += 1
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Base Fixture Data & AppContext
// ---------------------------------------------------------------------------
const polyglot = new Polyglot({
  phrases: englishPhrases,
  locale: "en-US",
})
polyglotState.set({ polyglot })

commitIdentityData({
  feeds: [
    { id: 1, title: "TechCrunch", category: { id: 1, title: "Tech" } },
    { id: 2, title: "The Verge", category: { id: 1, title: "Tech" } },
    { id: 3, title: "Ars Technica", category: { id: 1, title: "Tech" } },
  ],
})

const appData = {
  refreshIdentity: async () => {},
  refreshFeedData: async () => {},
  refreshCounts: async () => {},
}

const resetWorkerTelemetry = () => {
  workerTelemetry.started = 0
  workerTelemetry.resultReceived = 0
  workerTelemetry.errorCount = 0
  workerTelemetry.lastResult = null
}

const noop = () => {}
const noopObserveRead = () => noop

if (globalThis.process === undefined) {
  globalThis.process = { env: {} }
}

const setProcessEnvFlag = (enabled) => {
  if (globalThis.process === undefined) {
    globalThis.process = { env: {} }
  }
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = enabled ? "1" : "0"
}

const INITIAL_ARTICLES = [
  {
    id: 101,
    feed_id: 1,
    title: "Apple unveils new iPhone with advanced AI features",
    author: "Tech Reporter",
    published_at: "2026-10-26T12:00:00Z",
    status: "unread",
    starred: false,
    content: "<p>Apple today announced its next generation iPhone with deep AI integration.</p>",
  },
  {
    id: 102,
    feed_id: 2,
    title: "Google Pixel 10 launches with Tensor G5 and Gemini integration",
    author: "Android Editor",
    published_at: "2026-10-26T11:45:00Z",
    status: "unread",
    starred: false,
    content: "<p>Google introduced Pixel 10 powered by next-gen Gemini models.</p>",
  },
  {
    id: 103,
    feed_id: 3,
    title: "Hands-on with the new iPhone: Apple's AI leap examined",
    author: "Hardware Analyst",
    published_at: "2026-10-26T11:30:00Z",
    status: "unread",
    starred: false,
    content:
      "<p>We go hands-on with the new iPhone to evaluate Apple's machine learning claims.</p>",
  },
  {
    id: 104,
    feed_id: 1,
    title: "OpenAI announces developer tools roadmap",
    author: "AI Reporter",
    published_at: "2026-10-26T11:00:00Z",
    status: "unread",
    starred: false,
    content: "<p>OpenAI revealed updated API endpoints and developer tooling today.</p>",
  },
  {
    id: 105,
    feed_id: 2,
    title: "Anthropic updates Claude with enhanced computer use",
    author: "Safety Specialist",
    published_at: "2026-10-26T10:30:00Z",
    status: "unread",
    starred: false,
    content: "<p>Anthropic launched improved computer-use capabilities for Claude.</p>",
  },
]

const STANDARD_FIXTURE_PAIRS = [
  // Pair 101:103 - Cross-feed iPhone coverage within 30m, score 0.92 > 0.5 threshold
  { articleAId: 101, articleBId: 103, score: 0.92 },
]

// ---------------------------------------------------------------------------
// 3. Harness Component
// ---------------------------------------------------------------------------
export function StoryIdentityHarness() {
  const [articles, setArticles] = useState(INITIAL_ARTICLES)
  const [activeRoute, setActiveRoute] = useState("home") // "home" | "all" | "unread"
  const [clickedArticle, setClickedArticle] = useState(null)
  const [, setTick] = useState(0)
  const harnessRootRef = useRef(null)

  // Article activation contract for ArticleEntry
  const articleActivation = {
    getPrimaryLinkProps: (entry) => ({
      href: `/entry/${entry.id}`,
      onClick: (e) => {
        e.preventDefault()
        setClickedArticle(entry)
      },
    }),
    openInReactFlux: (entry) => setClickedArticle(entry),
    opensSourceOnCardClick: false,
  }

  // Exposed test control API
  const setFeatureFlag = useCallback((enabled) => {
    setProcessEnvFlag(enabled)
    dataState.setKey("sessionRevision", Date.now())
    setTick((t) => t + 1)
  }, [])

  const activateNullProvider = useCallback(() => {
    resetGlobalStoryIdentity()
    setGlobalStoryScoreProvider(new NullScoreProvider())
    dataState.setKey("sessionRevision", Date.now())
    setTick((t) => t + 1)
  }, [])

  const activateFixtureProvider = useCallback((pairs = STANDARD_FIXTURE_PAIRS, options = {}) => {
    resetGlobalStoryIdentity()
    const provider = new FixtureScoreProvider(pairs, options)
    setGlobalStoryScoreProvider(provider)
    dataState.setKey("sessionRevision", Date.now())
    setTick((t) => t + 1)
  }, [])

  const triggerArticleRead = useCallback((articleId) => {
    setArticles((prev) =>
      prev.map((a) =>
        a.id === articleId ? { ...a, status: a.status === "read" ? "unread" : "read" } : a,
      ),
    )
  }, [])

  const triggerArticleStarred = useCallback((articleId) => {
    setArticles((prev) => prev.map((a) => (a.id === articleId ? { ...a, starred: !a.starred } : a)))
  }, [])

  const resetAll = useCallback(() => {
    resetGlobalStoryIdentity()
    setProcessEnvFlag(false)
    setArticles(INITIAL_ARTICLES)
    setActiveRoute("home")
    setClickedArticle(null)
    dataState.setKey("sessionRevision", 1)
    resetWorkerTelemetry()
    setTick((t) => t + 1)
  }, [])

  // Stale Request Simulation (Section 16)
  const triggerStaleSimulation = useCallback(async () => {
    // Request A starts with a slow provider (300ms delay) grouping 101 & 103
    resetGlobalStoryIdentity()
    const slowProvider = new FixtureScoreProvider(STANDARD_FIXTURE_PAIRS, { delayMs: 300 })
    setGlobalStoryScoreProvider(slowProvider)

    // Bump session revision to trigger Request A
    dataState.setKey("sessionRevision", 100)

    // Wait 50ms (Request A is in flight)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Now inject fast provider grouping 104 & 105, and update session revision to trigger Request B
    const fastPairs = [{ articleAId: 104, articleBId: 105, score: 0.95 }]
    setGlobalStoryScoreProvider(new FixtureScoreProvider(fastPairs, { delayMs: 0 }))
    dataState.setKey("sessionRevision", 200)
  }, [])

  // Register harness globally for CDP automation
  useEffect(() => {
    globalThis.__storyHarness = {
      setFeatureFlag,
      activateNullProvider,
      activateFixtureProvider,
      triggerArticleRead,
      triggerArticleStarred,
      triggerStaleSimulation,
      setRoute: setActiveRoute,
      resetAll,
      getWorkerTelemetry: () => ({ ...workerTelemetry }),
      getClickedArticle: () => clickedArticle,
      getArticles: () => articles,
      getDOMSnapshot: () => {
        const root = harnessRootRef.current
        if (!root) {
          return { cards: [], stories: [] }
        }
        const cells = [...root.querySelectorAll(".article-card-grid-cell")]
        return {
          cardCount: cells.length,
          cards: cells.map((cell) => ({
            storyId: cell.dataset.storyId,
            memberCount: cell.dataset.storyMemberCount,
            text: cell.textContent.trim(),
            title: cell.querySelector("h2, h3, .article-card-title, .title, a")?.textContent.trim(),
            isRead: cell.querySelector(".read, [data-read='true'], .is-read") !== null,
          })),
          storyCells: cells
            .filter((c) => Boolean(c.dataset.storyId))
            .map((c) => ({
              storyId: c.dataset.storyId,
              memberCount: c.dataset.storyMemberCount,
            })),
        }
      },
    }
  }, [
    setFeatureFlag,
    activateNullProvider,
    activateFixtureProvider,
    triggerArticleRead,
    triggerArticleStarred,
    triggerStaleSimulation,
    resetAll,
    clickedArticle,
    articles,
  ])

  return (
    <AppDataContext.Provider value={appData}>
      <div
        ref={harnessRootRef}
        className="story-harness-root"
        style={{ padding: "16px", maxWidth: "1200px", margin: "0 auto" }}
      >
        <header
          className="story-harness-header"
          style={{
            marginBottom: "16px",
            borderBottom: "1px solid #e5e6eb",
            paddingBottom: "8px",
          }}
        >
          <h1 style={{ fontSize: "18px", margin: "0 0 8px" }}>
            STORY-02-A2 Real Browser Gate Test Harness
          </h1>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button data-testid="btn-flag-off" onClick={() => setFeatureFlag(false)}>
              Flag Off
            </button>
            <button data-testid="btn-flag-on" onClick={() => setFeatureFlag(true)}>
              Flag On
            </button>
            <button data-testid="btn-null-provider" onClick={activateNullProvider}>
              Null Provider
            </button>
            <button data-testid="btn-fixture-provider" onClick={() => activateFixtureProvider()}>
              Fixture Provider
            </button>
            <button
              data-testid="btn-failing-provider"
              onClick={() => activateFixtureProvider([], { shouldThrow: true })}
            >
              Failing Provider
            </button>
            <button data-testid="btn-toggle-read" onClick={() => triggerArticleRead(101)}>
              Toggle Read 101
            </button>
            <button data-testid="btn-toggle-star" onClick={() => triggerArticleStarred(101)}>
              Toggle Star 101
            </button>
            <button data-testid="btn-stale-test" onClick={triggerStaleSimulation}>
              Stale Simulation
            </button>
            <button data-testid="btn-route-home" onClick={() => setActiveRoute("home")}>
              Route Home
            </button>
            <button data-testid="btn-route-all" onClick={() => setActiveRoute("all")}>
              Route All
            </button>
            <button data-testid="btn-route-unread" onClick={() => setActiveRoute("unread")}>
              Route Unread
            </button>
            <button data-testid="btn-reset" onClick={resetAll}>
              Reset
            </button>
          </div>
        </header>

        {clickedArticle && (
          <aside
            data-testid="article-detail-mock"
            style={{
              background: "#f2f3f5",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <strong>Detail View:</strong> {clickedArticle.title} (ID: {clickedArticle.id})
          </aside>
        )}

        <main className="story-harness-content">
          {activeRoute === "home" && (
            <HomeRecent
              articleActivation={articleActivation}
              entries={articles}
              highlightIds={[]}
              observeRead={noopObserveRead}
              recentIds={articles.map((a) => a.id)}
              scrollRootRef={harnessRootRef}
            />
          )}

          {activeRoute === "all" && (
            <section className="all-articles-list" data-testid="all-articles-view">
              <h2>All Articles (Flat)</h2>
              <div role="list">
                {articles.map((entry) => (
                  <div
                    key={entry.id}
                    className="article-flat-card"
                    role="listitem"
                    style={{ padding: "8px 0" }}
                  >
                    <a
                      href={`/entry/${entry.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        setClickedArticle(entry)
                      }}
                    >
                      {entry.title}
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeRoute === "unread" && (
            <section className="unread-articles-list" data-testid="unread-articles-view">
              <h2>Unread Articles (Flat)</h2>
              <div role="list">
                {articles
                  .filter((a) => a.status === "unread")
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="article-flat-card"
                      role="listitem"
                      style={{ padding: "8px 0" }}
                    >
                      <a
                        href={`/entry/${entry.id}`}
                        onClick={(e) => {
                          e.preventDefault()
                          setClickedArticle(entry)
                        }}
                      >
                        {entry.title}
                      </a>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </AppDataContext.Provider>
  )
}

const rootElement = document.querySelector("#root")
if (rootElement) {
  createRoot(rootElement).render(<StoryIdentityHarness />)
}

export default StoryIdentityHarness
