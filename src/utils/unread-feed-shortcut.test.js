import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

// eslint-disable-next-line import/extensions -- Node's native ESM test runner requires the extension.
import getUnreadShortcutFeeds from "./unread-feed-shortcut.js"

const catalogFeeds = [
  { id: 42, title: "Zulu", unreadCount: 1 },
  { id: 9, title: "Alpha", unreadCount: 90 },
  { id: 3, title: "Beta", unreadCount: 0 },
  { id: 11, title: "Delta", unreadCount: 4 },
]

test("shortcut contains visible unread feeds in catalog order, without ranking", () => {
  assert.deepEqual(getUnreadShortcutFeeds(catalogFeeds, false), [
    catalogFeeds[0],
    catalogFeeds[1],
    catalogFeeds[3],
  ])
})

test("shortcut is omitted when showUnreadFeedsOnly already filters the hierarchy", () => {
  assert.deepEqual(getUnreadShortcutFeeds(catalogFeeds, true), [])
})

test("shortcut is omitted when no visible feed has unread items", () => {
  assert.deepEqual(getUnreadShortcutFeeds([catalogFeeds[2]], false), [])
})

test("every supported locale provides a label for unread sources", async () => {
  for (const locale of ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]) {
    const phrases = JSON.parse(
      await readFile(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    )
    assert.ok(phrases.sidebar.unread_sources, `${locale} is missing the unread source label`)
  }
})
