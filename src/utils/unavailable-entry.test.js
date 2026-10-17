import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node's native ESM test runner requires explicit extensions.
import handleUnavailableEntry from "./unavailable-entry.js"

const runHandler = ({ pathname, error, isCurrentRequest = true }) => {
  let activeContent = { id: 404 }
  let feedbackCount = 0
  const navigations = []
  const events = []
  const handled = handleUnavailableEntry({
    pathname,
    error,
    isCurrentRequest: () => isCurrentRequest,
    clearActiveContent: () => {
      activeContent = null
      events.push("clear-active-content")
    },
    navigate: (...args) => {
      navigations.push(args)
      events.push("navigate")
    },
    notify: () => {
      feedbackCount += 1
      events.push("notify")
    },
  })

  return { activeContent, events, feedbackCount, handled, navigations }
}

const unavailableError = () => Object.assign(new Error("not found"), { status: 404 })

test("404 returns each detail scope to its originating list and clears stale article state", () => {
  const cases = [
    ["/entry/101", "/"],
    ["/all/entry/101", "/all"],
    ["/today/entry/101", "/today"],
    ["/starred/entry/101", "/starred"],
    ["/history/entry/101", "/history"],
    ["/feed/12/entry/101", "/feed/12"],
    ["/category/7/entry/101", "/category/7"],
  ]

  for (const [pathname, expectedPath] of cases) {
    const result = runHandler({ pathname, error: unavailableError() })

    assert.equal(result.handled, true, pathname)
    assert.equal(result.activeContent, null, pathname)
    assert.deepEqual(result.navigations, [[expectedPath, { replace: true }]], pathname)
    assert.equal(result.feedbackCount, 1, pathname)
    assert.deepEqual(result.events, ["clear-active-content", "navigate", "notify"], pathname)
  }
})

test("500, network and 401 failures keep the current route and leave auth handling alone", () => {
  const failures = [
    Object.assign(new Error("server error"), { status: 500 }),
    new TypeError("Failed to fetch"),
    Object.assign(new Error("unauthorized"), { status: 401 }),
  ]

  for (const error of failures) {
    const result = runHandler({ pathname: "/feed/12/entry/101", error })

    assert.equal(result.handled, false)
    assert.deepEqual(result.navigations, [])
    assert.equal(result.feedbackCount, 0)
    assert.deepEqual(result.events, [])
    assert.deepEqual(result.activeContent, { id: 404 })
  }
})

test("a stale 404 response does not navigate, clear newer content or notify", () => {
  const result = runHandler({
    pathname: "/category/7/entry/101",
    error: unavailableError(),
    isCurrentRequest: false,
  })

  assert.equal(result.handled, false)
  assert.deepEqual(result.navigations, [])
  assert.equal(result.feedbackCount, 0)
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.activeContent, { id: 404 })
})

test("a 404 outside an entry detail route does not change route or article state", () => {
  const result = runHandler({ pathname: "/feed/12", error: unavailableError() })

  assert.equal(result.handled, false)
  assert.deepEqual(result.navigations, [])
  assert.equal(result.feedbackCount, 0)
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.activeContent, { id: 404 })
})

const unavailableEntryPhrases = {
  "de-DE": "Dieser Artikel ist nicht mehr verfügbar.",
  "en-US": "This article is no longer available.",
  "es-ES": "Este artículo ya no está disponible.",
  "fr-FR": "Cet article n’est plus disponible.",
  "ja-JP": "この記事は利用できなくなりました。",
  "zh-CN": "这篇文章已无法访问。",
}

test("provides unavailable-article feedback in every shipped locale", () => {
  for (const [locale, expectedPhrase] of Object.entries(unavailableEntryPhrases)) {
    const phrases = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    )
    assert.equal(phrases.content.entry_unavailable, expectedPhrase, locale)
  }
})
