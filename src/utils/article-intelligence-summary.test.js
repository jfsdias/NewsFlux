/* eslint import/extensions: off -- Native node:test ESM requires explicit extensions. */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildArticleSummaryPath,
  isCurrentArticleSummaryRequest,
  validateArticleSummaryError,
  validateArticleSummaryResponse,
} from "./article-intelligence-summary.js"

const requestId = "123e4567-e89b-42d3-a456-426614174000"
const validPayload = (changes = {}) => ({
  schema_version: "1",
  request_id: requestId,
  entry_id: 42,
  status: "partial",
  content_scope: "unknown",
  summary: "A grounded summary.",
  summary_paragraph_ids: ["p1"],
  key_points: [{ text: "A supported point.", paragraph_ids: ["p1"] }],
  action_points: [],
  limitations: ["The source may contain only partial article text."],
  provenance: {
    content_origin: "miniflux",
    content_fingerprint: "a".repeat(64),
    provider_id: "litellm",
    deployment_id: "s5-free",
    effective_model_id: "newsflux-s5-free",
    prompt_version: "summary-v1",
  },
  ...changes,
})

test("summary path accepts only a positive integer entry id", () => {
  assert.equal(buildArticleSummaryPath(42), "/api/ai/v1/entries/42/summary")
  for (const value of [0, -1, "42/other", "NaN", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(buildArticleSummaryPath(value), null)
  }
})

test("valid partial summaries preserve schema, request, entry and provenance identity", () => {
  assert.deepEqual(
    validateArticleSummaryResponse(validPayload(), {
      entryId: 42,
      requestId,
    }),
    validPayload(),
  )
})

test("summary responses reject mismatched request or entry identity", () => {
  assert.equal(validateArticleSummaryResponse(validPayload(), { entryId: 43, requestId }), null)
  assert.deepEqual(
    validateArticleSummaryResponse(validPayload(), {
      entryId: 42,
      requestId: "123e4567-e89b-42d3-a456-426614174001",
    }),
    null,
  )
})

test("complete summaries require full content scope and well-formed paragraph references", () => {
  assert.equal(
    validateArticleSummaryResponse(validPayload({ status: "complete", content_scope: "partial" }), {
      entryId: 42,
      requestId,
    }),
    null,
  )
  assert.equal(
    validateArticleSummaryResponse(validPayload({ summary_paragraph_ids: [] }), {
      entryId: 42,
      requestId,
    }),
    null,
  )
  assert.deepEqual(
    validateArticleSummaryResponse(
      validPayload({ key_points: [{ text: "Unsupported.", paragraph_ids: ["p999"] }] }),
      { entryId: 42, requestId },
    ),
    validPayload({ key_points: [{ text: "Unsupported.", paragraph_ids: ["p999"] }] }),
  )
  assert.equal(
    validateArticleSummaryResponse(
      validPayload({ key_points: [{ text: "Malformed.", paragraph_ids: ["p0"] }] }),
      { entryId: 42, requestId },
    ),
    null,
  )
})

test("insufficient and unavailable responses contain no generated summary text", () => {
  const insufficient = validPayload({
    status: "insufficient",
    summary: "",
    summary_paragraph_ids: [],
    key_points: [],
    action_points: [],
  })
  assert.ok(validateArticleSummaryResponse(insufficient, { entryId: 42, requestId }))
  assert.equal(
    validateArticleSummaryResponse(
      { ...insufficient, summary: "Unexpected text" },
      {
        entryId: 42,
        requestId,
      },
    ),
    null,
  )
})

test("malformed summaries and unsafe error payloads are rejected", () => {
  assert.equal(
    validateArticleSummaryResponse(validPayload({ unexpected: "field" }), {
      entryId: 42,
      requestId,
    }),
    null,
  )
  assert.deepEqual(
    validateArticleSummaryError(
      {
        schema_version: "1",
        request_id: requestId,
        error: { code: "SUMMARY_BUSY", retryable: true },
      },
      { requestId },
    ),
    { code: "SUMMARY_BUSY", retryable: true },
  )
  assert.equal(
    validateArticleSummaryError(
      {
        schema_version: "1",
        request_id: requestId,
        error: { code: "provider-secret-leak", retryable: true },
      },
      { requestId },
    ),
    null,
  )
})

test("current-request guard rejects route, account, article and data-session changes", () => {
  const request = {
    requestId,
    entryId: 42,
    sessionRevision: 3,
    authSessionKey: "account-a",
  }
  const current = {
    requestId,
    entryId: 42,
    activeEntryId: 42,
    routeEntryId: "42",
    sessionRevision: 3,
    authSessionKey: "account-a",
  }
  assert.equal(isCurrentArticleSummaryRequest(request, current), true)
  assert.equal(isCurrentArticleSummaryRequest(request, { ...current, routeEntryId: "43" }), false)
  assert.equal(isCurrentArticleSummaryRequest(request, { ...current, activeEntryId: 43 }), false)
  assert.equal(isCurrentArticleSummaryRequest(request, { ...current, sessionRevision: 4 }), false)
  assert.equal(
    isCurrentArticleSummaryRequest(request, { ...current, authSessionKey: "account-b" }),
    false,
  )
})
