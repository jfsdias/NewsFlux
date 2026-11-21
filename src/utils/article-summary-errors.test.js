import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import summaryErrorMessageKey from "./article-summary-errors.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

test("error codes map to actionable messages; unknown codes keep the generic one", () => {
  assert.equal(summaryErrorMessageKey("NOT_AUTHORIZED"), "article_intelligence.error_session")
  assert.equal(summaryErrorMessageKey("SUMMARY_BUSY"), "article_intelligence.error_busy")
  assert.equal(summaryErrorMessageKey("NETWORK"), "article_intelligence.error_network")
  assert.equal(summaryErrorMessageKey("SOMETHING_NEW"), "article_intelligence.error")
  assert.equal(summaryErrorMessageKey(null), "article_intelligence.error")
})

test("every message key and the code line exist in every locale", async () => {
  const codes = [
    "NOT_AUTHORIZED",
    "SUMMARY_BUSY",
    "STALE_SNAPSHOT",
    "MODEL_OUTPUT_INVALID",
    "ENTRY_NOT_ACCESSIBLE",
    "MINIFLUX_UNAVAILABLE",
    "INVALID_REQUEST",
    "NETWORK",
    "CATALOG_UNAVAILABLE",
  ]
  const keys = new Set([
    ...codes.map((code) => summaryErrorMessageKey(code).split(".", 2)[1]),
    "error_code",
    "transfer_notice_auto",
    "auto_on_open_label",
    "auto_on_open_description",
  ])
  for (const locale of ["en-US"]) {
    const text = JSON.parse(await readFile(new URL(`../locales/${locale}.json`, import.meta.url)))
    for (const key of keys) {
      assert.ok(text.article_intelligence?.[key]?.trim(), `${locale} is missing ${key}`)
    }
    assert.ok(text.article_intelligence.error_code.includes("%{code}"), locale)
  }
})
