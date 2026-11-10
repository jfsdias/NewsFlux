/* eslint-disable import/extensions -- Node ESM requires exact file extensions in tests. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  buildContentFallbackReaderUrl,
  getContentFallbackReaderBasePath,
  isCurrentContentFallbackRequest,
  validateContentFallbackReaderResponse,
} from "./content-fallback-reader.js"

const validResponse = {
  status: "recovered",
  entry_id: 42,
  url_fingerprint: "a".repeat(64),
  content_html: "<p>Full text &amp; verified.</p><p>Second paragraph.</p>",
  content_origin: "wallhop",
  validation: { state: "SUFFICIENT" },
  provenance: { provider: "wallhop.io", fetched_at: "2026-11-01T12:00:00+00:00" },
}

test("accepts only an approved recovery for the current entry and source fingerprint", () => {
  assert.deepEqual(
    validateContentFallbackReaderResponse(validResponse, {
      entryId: 42,
      urlFingerprint: "a".repeat(64),
    }),
    {
      entryId: 42,
      urlFingerprint: "a".repeat(64),
      contentHtml: "<p>Full text &amp; verified.</p><p>Second paragraph.</p>",
      contentOrigin: "wallhop",
    },
  )
})

test("rejects another entry, URL fingerprint, unknown origin, and non-approved status", () => {
  for (const changes of [
    { entry_id: 43 },
    { url_fingerprint: "b".repeat(64) },
    { content_origin: "unknown" },
    { status: "incomplete" },
    { validation: { state: "TEASER" } },
  ]) {
    assert.equal(
      validateContentFallbackReaderResponse(
        { ...validResponse, ...changes },
        { entryId: 42, urlFingerprint: "a".repeat(64) },
      ),
      null,
    )
  }
})

test("rejects markup outside the paragraph-only sanitized service contract", () => {
  for (const contentHtml of [
    "<script>alert(1)</script>",
    '<p onclick="run()">text</p>',
    '<p><img src="https://tracker.example/pixel"></p>',
    "<p>unescaped < text</p>",
    '<p>one</p><iframe src="https://example.test"></iframe>',
    "",
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    assert.equal(
      validateContentFallbackReaderResponse(
        { ...validResponse, content_html: contentHtml },
        { entryId: 42, urlFingerprint: "a".repeat(64) },
      ),
      null,
      contentHtml.slice(0, 40),
    )
  }
})

test("fences responses to the captured article, route and session", () => {
  const request = {
    requestId: 3,
    sessionRevision: 8,
    entryId: 42,
    routeEntryId: "42",
  }
  assert.equal(
    isCurrentContentFallbackRequest(request, {
      requestId: 3,
      sessionRevision: 8,
      activeEntryId: 42,
      routeEntryId: "42",
    }),
    true,
  )
  for (const current of [
    { requestId: 4, sessionRevision: 8, activeEntryId: 42, routeEntryId: "42" },
    { requestId: 3, sessionRevision: 9, activeEntryId: 42, routeEntryId: "42" },
    { requestId: 3, sessionRevision: 8, activeEntryId: 43, routeEntryId: "43" },
    { requestId: 3, sessionRevision: 8, activeEntryId: 42, routeEntryId: "43" },
  ]) {
    assert.equal(isCurrentContentFallbackRequest(request, current), false)
  }
})

test("constructs only a same-origin relative bridge URL for a positive entry ID", () => {
  assert.equal(
    buildContentFallbackReaderUrl("/api/content-fallback", 42),
    "/api/content-fallback/reader/v1/entries/42/recover",
  )
  for (const basePath of [
    "https://attacker.example",
    "//attacker.example/path",
    "/x?token=y",
    "/x#y",
    "x",
  ]) {
    assert.equal(buildContentFallbackReaderUrl(basePath, 42), null)
  }
  assert.equal(buildContentFallbackReaderUrl("/api/content-fallback", 0), null)
})

test("hides the recovery action when the configured bridge path is unsafe", () => {
  for (const basePath of ["/api/../admin", "/api//fallback", "//attacker.example/path"]) {
    assert.equal(getContentFallbackReaderBasePath(basePath), null)
  }
  assert.equal(getContentFallbackReaderBasePath("/api/content-fallback"), "/api/content-fallback")
})
