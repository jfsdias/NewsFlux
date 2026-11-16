import assert from "node:assert/strict"
import test from "node:test"
import { buildWallhopExternalUrl } from "./wallhop-external.js"

test("public HTTPS article creates an explicit third-party WallHop URL", () => {
  assert.equal(
    buildWallhopExternalUrl("https://example.com/news/42?lang=pt#section"),
    "https://wallhop.io/https://example.com/news/42?lang=pt",
  )
})

test("never forwards private, credentialed, non-HTTPS or local URLs", () => {
  const refused = [
    "javascript:alert(1)",
    "http://example.com/article",
    "https://u:secret@example.com/a",
    "https://localhost/a",
    "https://internal.home/a",
    "https://192.168.1.1/",
    "https://[::1]/",
    "https://127.0.0.1/",
    "https://example.com:444/a",
    "https://example.com@127.0.0.1/a",
    "",
    null,
  ]
  for (const url of refused) {
    assert.equal(buildWallhopExternalUrl(url), null, String(url))
  }
})

test("long and malformed sources are blocked before opening an external service", () => {
  assert.equal(buildWallhopExternalUrl(`https://example.com/${"a".repeat(8192)}`), null)
  assert.equal(buildWallhopExternalUrl("https://"), null)
})
