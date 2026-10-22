import assert from "node:assert/strict"
import { test } from "node:test"

// Catches mutable All/Unread preferences leaking into Home's server query.
const { buildHomeEntryRequest } = await import(new URL("home-entry-request.js", import.meta.url))

const expected = {
  status: "unread",
  order: "published_at",
  direction: "desc",
  limit: 20,
  globally_visible: true,
}

test("builds unread published-at descending requests with inherited visibility", () => {
  assert.deepEqual(buildHomeEntryRequest({ pageSize: 20, showHiddenFeeds: false }), expected)
  assert.deepEqual(buildHomeEntryRequest({ pageSize: 20, showHiddenFeeds: true }), {
    ...expected,
    globally_visible: false,
  })
})

test("does not add Home search or date filters", () => {
  assert.deepEqual(
    buildHomeEntryRequest({
      pageSize: 20,
      showHiddenFeeds: false,
      search: "ignored",
      filterDate: "2026-10-10",
      showStatus: "starred",
      orderBy: "created_at",
      orderDirection: "asc",
    }),
    expected,
  )
})

test("preserves the single supplied cursor and page size", () => {
  assert.deepEqual(
    buildHomeEntryRequest({ pageSize: 37, showHiddenFeeds: false, cursor: 1_791_752_400 }),
    {
      ...expected,
      limit: 37,
      published_before: 1_791_752_400,
    },
  )
  assert.deepEqual(buildHomeEntryRequest({ pageSize: 20, showHiddenFeeds: false, cursor: 0 }), {
    ...expected,
    published_before: 0,
  })
})

test("uses a bounded ID-ordered query only while draining a Home timestamp tie", () => {
  assert.deepEqual(
    buildHomeEntryRequest({
      pageSize: 20,
      showHiddenFeeds: false,
      cursor: 1_791_752_400,
      tieDrain: { bucketSecond: 1_791_752_400, beforeEntryId: 11_020 },
    }),
    {
      status: "unread",
      order: "id",
      direction: "desc",
      limit: 20,
      globally_visible: true,
      published_after: 1_791_752_399,
      published_before: 1_791_752_401,
      before_entry_id: 11_020,
    },
  )
  assert.deepEqual(
    buildHomeEntryRequest({
      pageSize: 20,
      showHiddenFeeds: true,
      tieDrain: { bucketSecond: 1_791_752_400, beforeEntryId: null },
    }),
    {
      status: "unread",
      order: "id",
      direction: "desc",
      limit: 20,
      globally_visible: false,
      published_after: 1_791_752_399,
      published_before: 1_791_752_401,
    },
  )
})

test("uses the same query/visibility with pageSize=1 and no cursor for count reconciliation", () => {
  for (const showHiddenFeeds of [false, true]) {
    assert.deepEqual(buildHomeEntryRequest({ pageSize: 1, showHiddenFeeds }), {
      ...expected,
      limit: 1,
      globally_visible: !showHiddenFeeds,
    })
  }
})
