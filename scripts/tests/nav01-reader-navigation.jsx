/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button } from "@arco-design/web-react"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { contentState, setEntries } from "@/store/contentState"
import prepareEntry from "@/utils/entry-presentation"
import {
  appendReaderPageEntries,
  buildReaderPageRequest,
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
  removeDuplicates = "none",
  showStatus = "all",
  nextSources = [],
  fetchSourceEntries = async () => ({ entries: [] }),
  prepareTargetEntry,
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
    get entries() {
      return currentEntries
    },
    get sequenceIds() {
      return sequenceIds
    },
    run: () =>
      resolveReaderNavigation({
        activeEntryId: activeId,
        direction,
        mode,
        source,
        showStatus,
        prepareTargetEntry,
        getEntries: () => currentEntries,
        getSequenceIds: () => sequenceIds,
        canContinue: () => pageQueue.length > 0,
        fetchPage: async (request) => {
          fetches.push(request)
          return pageQueue.shift()
        },
        appendPage: ({
          entries: pageEntries,
          direction: pageDirection,
          sequenceIds: currentIds,
        }) => {
          appended.push(pageEntries.map(({ id }) => id))
          const appendedPage = appendReaderPageEntries({
            currentEntries,
            pageEntries,
            sequenceIds: currentIds,
            direction: pageDirection,
            source: source.from,
            removeDuplicates,
          })
          currentEntries = appendedPage.entries
          sequenceIds = appendedPage.sequenceIds
          return appendedPage
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
    "EQUAL_TIMESTAMP_CURSOR_BOUNDARIES_OVERLAP",
    async () => {
      const cases = [
        ["published_at", "desc", "published_before"],
        ["published_at", "asc", "published_after"],
        ["changed_at", "desc", "changed_before"],
        ["changed_at", "asc", "changed_after"],
      ]
      for (const [property, direction, cursor] of cases) {
        const values =
          direction === "desc"
            ? ["12:05", "12:04", "12:03", "12:03", "12:02"]
            : ["12:00", "12:01", "12:02", "12:02", "12:03"]
        const entries = values.map((time, index) => ({
          ...entry(index + 1),
          [property]: `2026-10-18T${time}:00Z`,
        }))
        const request = buildReaderPageRequest({
          source: { from: "feed", id: 10 },
          content: {},
          settings: { orderBy: property, orderDirection: direction, pageSize: 5 },
          entries,
          direction: "next",
        })
        const boundary = Math.floor(Date.parse(entries[2][property]) / 1000)
        assert(
          request.filterParams[cursor] === boundary &&
            entries[2][property] === entries[3][property],
          `${property} ${direction} cursor did not overlap its equal-timestamp boundary`,
        )
      }
    },
  ],
  [
    "READER_APPEND_MATCHES_PRESENTATION_DEDUP",
    async () => {
      const navigation = makeNavigation({
        entries: [{ ...entry(1), hash: "same", title: "existing", url: "/one" }],
        pages: [
          {
            entries: [
              { ...entry(2), hash: "same", title: "duplicate", url: "/two" },
              { ...entry(3), hash: "unique", title: "next", url: "/three" },
            ],
            total: 3,
          },
        ],
        removeDuplicates: "hash",
      })
      const result = await navigation.run()
      assert(result.entry.id === 3, "Navigation selected a presentation duplicate")
      assert(
        navigation.entries.map(({ id }) => id).join(",") === "1,3" &&
          navigation.sequenceIds.join(",") === "1,3",
        "Reader close would leave list membership inconsistent with presentation dedup",
      )
    },
  ],
  [
    "READER_CLOSE_RETAINS_SHARED_LIST_MEMBERSHIP",
    async () => {
      const originalContent = contentState.get()
      const currentEntries = [{ ...entry(1), hash: "same", title: "existing", url: "/one" }]
      try {
        contentState.set({
          ...originalContent,
          infoFrom: "feed",
          entries: currentEntries,
          activeContent: { id: 1 },
        })
        const appendedPage = appendReaderPageEntries({
          currentEntries: contentState.get().entries,
          pageEntries: [
            { ...entry(2), hash: "same", title: "duplicate", url: "/two" },
            { ...entry(3), hash: "unique", title: "next", url: "/three" },
          ],
          sequenceIds: [1],
          direction: "next",
          source: "feed",
          removeDuplicates: "hash",
        })
        setEntries(appendedPage.entries)
        contentState.setKey("activeContent", null)
        assert(
          contentState
            .get()
            .entries.map(({ id }) => id)
            .join(",") === "1,3" && appendedPage.sequenceIds.join(",") === "1,3",
          "Closing the reader left shared content state inconsistent with list presentation",
        )
      } finally {
        contentState.set(originalContent)
      }
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
    "SOURCE_HOP_TARGET_IS_PREPARED",
    async () => {
      const rawTarget = {
        ...entry(20),
        feed: { id: 11 },
        content: "",
        enclosures: [
          {
            url: "https://example.test/audio/episode.mp3",
            mime_type: "audio/mpeg",
            size: 1024,
          },
        ],
      }
      const navigation = makeNavigation({
        mode: "unread",
        nextSources: [{ type: "feed", id: 11 }],
        fetchSourceEntries: async () => ({ entries: [rawTarget] }),
        prepareTargetEntry: prepareEntry,
      })
      const result = await navigation.run()
      assert(
        result.entry.attachments?.primaryMedia?.canPlay === true &&
          result.entry.attachments.items[0].displayName === "episode.mp3",
        "Source-hop target did not receive normal attachment presentation metadata",
      )
      assert(result.entry.status === "unread", "Preparation changed the provider read status")
    },
  ],
  [
    "SOURCE_HOP_STARRED_REQUIRES_UNREAD_STARRED_AND_SKIPS_STALE_SOURCE",
    async () => {
      const queriedSources = []
      const navigation = makeNavigation({
        showStatus: "starred",
        mode: "unread",
        nextSources: [
          { type: "feed", id: 11 },
          { type: "feed", id: 12 },
        ],
        fetchSourceEntries: async (targetSource) => {
          queriedSources.push(targetSource.id)
          return {
            entries:
              targetSource.id === 11
                ? [{ ...entry(30), starred: false, feed: { id: 11 } }]
                : [{ ...entry(31), starred: true, feed: { id: 12 } }],
          }
        },
      })
      const result = await navigation.run()
      assert(
        queriedSources.join(",") === "11,12" &&
          result.targetSource.id === 12 &&
          result.entry.status === "unread" &&
          result.entry.starred === true,
        "Starred source-hop selected an entry outside the destination Starred list",
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
