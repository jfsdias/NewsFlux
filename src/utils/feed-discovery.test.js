import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const { discoverAndSubscribeFeed } = await import(new URL("feed-discovery.js", import.meta.url))

const candidate = (url, title = "") => ({ url, title, type: "rss" })

test("zero discovery candidates report empty and never subscribe", async () => {
  const calls = []
  const result = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 8,
    isFullText: false,
    discover: async (url) => {
      calls.push(["discover", url])
      return []
    },
    resolveCandidate: async () => {
      calls.push(["resolve"])
      return null
    },
    subscribe: async () => calls.push(["subscribe"]),
  })

  assert.deepEqual(result, { status: "empty" })
  assert.deepEqual(calls, [["discover", "https://publisher.example"]])
})

test("a single candidate requires confirmation before subscription", async () => {
  const calls = []
  const found = candidate("https://publisher.example/feed.xml", "Publisher")

  const cancelled = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 8,
    isFullText: true,
    discover: async () => [found],
    resolveCandidate: async (candidates) => {
      calls.push(["confirm", candidates[0].url])
      return null
    },
    subscribe: async (...args) => calls.push(["subscribe", ...args]),
  })

  assert.deepEqual(cancelled, { status: "cancelled" })
  assert.deepEqual(calls, [["confirm", found.url]])

  const confirmed = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 8,
    isFullText: true,
    discover: async () => [found],
    resolveCandidate: async () => found,
    subscribe: async (...args) => {
      calls.push(["subscribe", ...args])
      return { feed_id: 42 }
    },
  })

  assert.deepEqual(confirmed, {
    status: "subscribed",
    candidate: found,
    response: { feed_id: 42 },
  })
  assert.deepEqual(calls[1], ["subscribe", found.url, 8, true])
})

test("multiple candidates require an explicit selected candidate", async () => {
  const first = candidate("https://publisher.example/one.xml", "One")
  const second = candidate("https://publisher.example/two.xml", "Two")
  const calls = []

  const result = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 13,
    isFullText: false,
    discover: async () => [first, second],
    resolveCandidate: async (candidates) => {
      calls.push(["choose", candidates.map(({ url }) => url)])
      return second
    },
    subscribe: async (...args) => {
      calls.push(["subscribe", ...args])
      return { feed_id: 99 }
    },
  })

  assert.equal(result.status, "subscribed")
  assert.equal(result.candidate.url, second.url)
  assert.deepEqual(calls, [
    ["choose", [first.url, second.url]],
    ["subscribe", second.url, 13, false],
  ])
})

test("a multiple-candidate dialog cannot subscribe an unlisted URL", async () => {
  const calls = []
  const listed = candidate("https://publisher.example/feed.xml")

  const result = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 13,
    isFullText: false,
    discover: async () => [listed, candidate("https://publisher.example/other.xml")],
    resolveCandidate: async () => candidate("https://attacker.example/feed.xml"),
    subscribe: async (...args) => calls.push(args),
  })

  assert.deepEqual(result, { status: "cancelled" })
  assert.deepEqual(calls, [])
})

test("invalid discovery URLs are ignored and duplicate candidate URLs collapse", async () => {
  const repeated = candidate("https://publisher.example/feed.xml", "Publisher")

  const result = await discoverAndSubscribeFeed({
    url: "https://publisher.example",
    categoryId: 13,
    isFullText: false,
    discover: async () => [
      candidate("javascript:alert(1)", "Invalid"),
      repeated,
      candidate(repeated.url, "Duplicate"),
    ],
    resolveCandidate: async (candidates) => {
      assert.deepEqual(candidates, [repeated])
      return repeated
    },
    subscribe: async () => ({ feed_id: 1 }),
  })

  assert.equal(result.status, "subscribed")
})

test("feed discovery copy is present in every shipped locale", () => {
  const localeDirectory = fileURLToPath(new URL("../locales/", import.meta.url))
  const requiredKeys = [
    "add_feed_discover_button",
    "add_feed_discover_no_results",
    "add_feed_discover_error",
    "add_feed_discover_single_title",
    "add_feed_discover_single_description",
    "add_feed_discover_multiple_title",
    "add_feed_discover_multiple_description",
    "add_feed_discover_cancel",
    "add_feed_discover_subscribe",
  ]

  for (const fileName of readdirSync(localeDirectory).filter((name) => name.endsWith(".json"))) {
    const { main } = JSON.parse(readFileSync(path.join(localeDirectory, fileName), "utf8"))
    for (const key of requiredKeys) {
      assert.equal(typeof main[key], "string", `${fileName} is missing main.${key}`)
      assert.ok(main[key].trim(), `${fileName} has empty main.${key}`)
    }
  }
})
