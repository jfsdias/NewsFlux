/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useCallback } from "react"
import { createRoot } from "react-dom/client"
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
} from "react-router"

import Content from "@/components/Content/Content"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"

const unavailablePhrase = phrases.content.entry_unavailable
const polyglot = new Polyglot({ phrases, locale: "en-US" })
polyglotState.set({ polyglot })
authState.set({ server: "https://miniflux.example", token: "state-err-01-test" })

const originalFetch = globalThis.fetch

globalThis.fetch = async (request) => {
  const requestUrl = new URL(typeof request === "string" ? request : request.url)
  const entryMatch = requestUrl.pathname.match(/\/v1\/entries\/(\d+)$/)
  if (entryMatch) {
    const status = Number(entryMatch[1])
    return Response.json(
      { error_message: status === 404 ? "not found" : "server error" },
      {
        status,
        statusText: status === 404 ? "Not Found" : "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      },
    )
  }
  return Response.json({})
}

const FixtureList = () => <div data-testid="fixture-list">Fixture article list</div>

const ContentPage = ({ from }) => {
  const { id = "" } = useParams()
  const getEntries = useCallback(async () => ({ entries: [], total: 0 }), [])
  return <Content getEntries={getEntries} info={{ from, id }} listContent={FixtureList} />
}

const Controls = () => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { activeContent, isArticleLoading } = useStore(contentState)

  return (
    <header>
      <h1>STATE-ERR-01 unavailable article harness</h1>
      <p>
        Viewport: {window.innerWidth}×{window.innerHeight}
      </p>
      <button type="button" onClick={() => navigate("/feed/12/entry/404")}>
        Simulate HTTP 404
      </button>
      <button type="button" onClick={() => navigate("/category/7/entry/500")}>
        Simulate HTTP 500
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Back one route
      </button>
      <dl>
        <dt>Route</dt>
        <dd data-testid="route-path">{pathname}</dd>
        <dt>Active article</dt>
        <dd data-testid="active-article">{activeContent?.id ?? "none"}</dd>
        <dt>Loading</dt>
        <dd data-testid="loading-state">{isArticleLoading ? "yes" : "no"}</dd>
        <dt>Expected feedback</dt>
        <dd>{unavailablePhrase}</dd>
      </dl>
    </header>
  )
}

const Providers = () => (
  <AppDataContext.Provider value={{ refreshFeedData: async () => {} }}>
    <ContextProvider>
      <main style={{ fontFamily: "sans-serif", margin: "0 auto", maxWidth: 720, padding: 24 }}>
        <Controls />
        <Outlet />
      </main>
    </ContextProvider>
  </AppDataContext.Provider>
)

const router = createMemoryRouter(
  [
    {
      path: "/",
      element: <Providers />,
      children: [
        { path: "all", element: <ContentPage from="all" /> },
        { path: "feed/:id", element: <ContentPage from="feed" /> },
        { path: "feed/:id/entry/:entryId", element: <ContentPage from="feed" /> },
        { path: "category/:id", element: <ContentPage from="category" /> },
        { path: "category/:id/entry/:entryId", element: <ContentPage from="category" /> },
      ],
    },
  ],
  { initialEntries: ["/all"] },
)

const root = createRoot(document.querySelector("#root"))
root.render(<RouterProvider router={router} />)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    globalThis.fetch = originalFetch
    root.unmount()
  })
}
