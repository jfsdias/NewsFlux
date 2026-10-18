/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button } from "@arco-design/web-react"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import {
  createReaderNavigationOperationGate,
  resolveReaderNavigation,
} from "@/utils/reader-navigation"
import "@arco-design/web-react/dist/css/arco.css"
import "./nav01-reader-navigation.css"

const entry = (id, status = "unread") => ({
  id,
  status,
  published_at: new Date(Date.UTC(2026, 9, 18, 12, id)).toISOString(),
})

const makeNavigation = ({
  entries = [entry(1), entry(2)],
  ids = entries.map(({ id }) => id),
  activeId = entries.at(-1)?.id,
  direction = "next",
  mode = "article",
  source = { from: "feed", id: 10 },
  pages = [],
  nextSources = [],
  fetchSourceEntries = async () => ({ entries: [] }),
  isCurrent = () => true,
} = {}) => {
  let currentEntries = entries
  let sequenceIds = ids
  const pageQueue = [...pages]
  const fetches = []
  const sourceFetches = []
  const appended = []
  return {
    fetches,
    sourceFetches,
    appended,
    run: () =>
      resolveReaderNavigation({
        activeEntryId: activeId,
        direction,
        mode,
        source,
        getEntries: () => currentEntries,
        getSequenceIds: () => sequenceIds,
        canContinue: () => pageQueue.length > 0,
        fetchPage: async (request) => {
          fetches.push(request)
          return pageQueue.shift()
        },
        appendPage: ({ entries: pageEntries, direction: pageDirection }) => {
          appended.push(pageEntries.map(({ id }) => id))
          const known = new Set(currentEntries.map(({ id }) => String(id)))
          const unique = pageEntries.filter(({ id }) => !known.has(String(id)))
          currentEntries =
            pageDirection === "previous"
              ? [...unique, ...currentEntries]
              : [...currentEntries, ...unique]
          sequenceIds =
            pageDirection === "previous"
              ? [...unique.map(({ id }) => id), ...sequenceIds]
              : [...sequenceIds, ...unique.map(({ id }) => id)]
          return { entries: currentEntries, sequenceIds }
        },
        isCurrent,
        getNextSources: () => nextSources,
        fetchSourceEntries: async (candidate) => {
          sourceFetches.push(candidate)
          return fetchSourceEntries(candidate)
        },
      }),
  }
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const cases = [
  [
    "LOADED_PREVIOUS_NEXT_NEIGHBORS",
    async () => {
      const previous = await makeNavigation({
        entries: [entry(1), entry(2), entry(3)],
        activeId: 2,
        direction: "previous",
      }).run()
      const next = await makeNavigation({
        entries: [entry(1), entry(2), entry(3)],
        activeId: 2,
      }).run()
      assert(previous.entry.id === 1 && next.entry.id === 3, "Loaded neighbor sequence changed")
    },
  ],
  [
    "BOUNDARY_CONTINUATION_APPENDS_AND_OPENS",
    async () => {
      const navigation = makeNavigation({
        entries: [entry(1), entry(2)],
        pages: [{ entries: [entry(3)], total: 3 }],
      })
      const result = await navigation.run()
      assert(result.entry.id === 3, "Continuation did not open the next canonical entry")
      assert(
        navigation.appended.length === 1 && navigation.appended[0][0] === 3,
        "Page was not appended once",
      )
    },
  ],
  [
    "NEXT_UNREAD_SKIPS_READ_ENTRIES",
    async () => {
      const navigation = makeNavigation({
        entries: [entry(1), entry(2, "read")],
        activeId: 1,
        mode: "unread",
        pages: [{ entries: [entry(3, "read"), entry(4)], total: 4 }],
      })
      const result = await navigation.run()
      assert(result.entry.id === 4, "Next Unread selected a read entry")
    },
  ],
  [
    "NEXT_UNREAD_SOURCE_HOP_OPENS_FIRST_UNREAD",
    async () => {
      const navigation = makeNavigation({
        mode: "unread",
        pages: [{ entries: [], total: 2 }],
        nextSources: [{ type: "feed", id: 11 }],
        fetchSourceEntries: async () => ({ entries: [entry(20), entry(21)] }),
      })
      const result = await navigation.run()
      assert(
        result.targetSource.id === 11 && result.entry.id === 20,
        "Source hop did not open its first unread entry",
      )
    },
  ],
  [
    "STALE_SESSION_CANNOT_NAVIGATE_OR_APPEND",
    async () => {
      let current = true
      const navigation = makeNavigation({
        pages: [{ entries: [entry(3)], total: 3 }],
        isCurrent: () => current,
      })
      const result = await resolveReaderNavigation({
        activeEntryId: 2,
        direction: "next",
        source: { from: "feed", id: 10 },
        getEntries: () => [entry(1), entry(2)],
        getSequenceIds: () => [1, 2],
        canContinue: () => true,
        fetchPage: async () => {
          current = false
          return { entries: [entry(3)], total: 3 }
        },
        appendPage: () => assert(false, "Stale page appended"),
        isCurrent: () => current,
      })
      assert(result.status === "stale", "Stale response was not fenced")
    },
  ],
  [
    "DOUBLE_ACTION_GUARDED",
    async () => {
      const gate = createReaderNavigationOperationGate()
      let release
      const wait = new Promise((resolve) => {
        release = resolve
      })
      const first = gate.run(async () => {
        await wait
        return true
      })
      const second = await gate.run(async () => false)
      release()
      const firstResult = await first
      assert(
        firstResult.value === true && second.status === "busy",
        "Duplicate operation was not guarded",
      )
    },
  ],
]

const Harness = () => {
  const [summary, setSummary] = useState("READY")
  const [results, setResults] = useState([])
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight })

  useEffect(() => {
    const updateViewport = () => setViewport({ width: innerWidth, height: innerHeight })
    globalThis.addEventListener("resize", updateViewport)
    return () => globalThis.removeEventListener("resize", updateViewport)
  }, [])

  const runSuite = async () => {
    setSummary("RUNNING")
    setResults([])
    const collected = []
    for (const [name, run] of cases) {
      try {
        await run()
        collected.push({ name, status: "PASS" })
      } catch (error) {
        collected.push({ name, status: "FAIL", detail: error.message })
      }
    }
    const failed = collected.filter(({ status }) => status === "FAIL").length
    setResults(collected)
    setSummary(
      failed === 0
        ? `PASS ${collected.length}/${collected.length}`
        : `FAIL ${failed}/${collected.length}`,
    )
  }

  const viewportLabel = `${viewport.width}x${viewport.height}`
  const overflow = document.documentElement.scrollWidth > innerWidth

  return (
    <main className="nav01-harness">
      <h1>NAV01 Reader Navigation</h1>
      <p>
        Deterministic interaction harness. Resize the browser to 390×844, 884×1104, and 1280×800
        before checking viewport smoke.
      </p>
      <Button data-testid="run-nav01-suite" type="primary" onClick={runSuite}>
        Run NAV01 interaction cases
      </Button>
      <output data-testid="suite-summary">{summary}</output>
      <output data-testid="viewport-summary">
        {viewportLabel} · {overflow ? "OVERFLOW" : "NO_OVERFLOW"}
      </output>
      <ol data-testid="suite-results">
        {results.map(({ name, status, detail }) => (
          <li key={name} data-status={status}>
            <strong>{name}</strong>: {status}
            {detail ? ` — ${detail}` : ""}
          </li>
        ))}
      </ol>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
