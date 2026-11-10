/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import { isArticleIntelligenceEnabled } from "./article-intelligence-feature.js"

test("Article Intelligence UI requires an explicit enablement flag", () => {
  for (const value of [undefined, null, "", false, 0, "0", "false", "true", "yes"]) {
    assert.equal(isArticleIntelligenceEnabled(value), false)
  }

  assert.equal(isArticleIntelligenceEnabled("1"), true)
})

test("Article Intelligence UI reads only an explicit build environment value", () => {
  const original = globalThis.process?.env?.VITE_ARTICLE_INTELLIGENCE_ENABLED
  if (!globalThis.process?.env) {
    return
  }

  globalThis.process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED = "1"
  assert.equal(isArticleIntelligenceEnabled(), true)
  globalThis.process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED = "true"
  assert.equal(isArticleIntelligenceEnabled(), false)

  if (original === undefined) {
    delete globalThis.process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED
  } else {
    globalThis.process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED = original
  }
})
