import assert from "node:assert/strict"
import test from "node:test"

const {
  analyzeImageData,
  analyzeLoadedImage,
  getSafeHostname,
  getSourceDisplayName,
  getSourceMonogram,
  isProviderIconUsable,
  resolveAdaptivePlate,
} = await import(new URL("source-identity.js", import.meta.url))

const makeDocument = (error) => ({
  createElement: () => ({
    getContext: () => ({
      drawImage() {},
      getImageData() {
        throw error
      },
    }),
  }),
})

test("source display name prefers a feed title and uses only safe parsed hostnames", () => {
  assert.equal(
    getSourceDisplayName({
      title: "  Daily News  ",
      site_url: "https://reader:secret@example.test:8443/private/path?q=secret#fragment",
      feed_url: "https://feed.example.test/rss",
    }),
    "Daily News",
  )
  assert.equal(
    getSourceDisplayName({
      title: " ".repeat(1),
      site_url: "https://reader:secret@example.test:8443/private/path?q=secret#fragment",
      feed_url: "https://feed.example.test/rss",
    }),
    "example.test",
  )
  assert.equal(
    getSafeHostname("https://user:pass@feeds.example.test:9443/rss?x=1#top"),
    "feeds.example.test",
  )
  assert.equal(
    getSourceDisplayName({ site_url: "invalid", feed_url: "https://fallback.example.test/rss" }),
    "fallback.example.test",
  )
  assert.equal(getSourceDisplayName({ title: "", site_url: "bad", feed_url: "also bad" }), "Source")
})

test("source monogram normalizes one textual grapheme across supported scripts", () => {
  assert.equal(getSourceMonogram({ title: "  Ciência" }), "C")
  assert.equal(getSourceMonogram({ title: "Época" }), "É")
  assert.equal(getSourceMonogram({ title: "e\u0301poca" }), "É")
  assert.equal(getSourceMonogram({ title: "東京新聞" }), "東")
  assert.equal(getSourceMonogram({ title: "العربية" }), "ا")
  assert.equal(getSourceMonogram({ title: "новости" }), "Н")
  assert.equal(getSourceMonogram({ title: "🛰️ Notícias" }), "N")
  assert.equal(getSourceMonogram({ title: "📰" }), null)
})

test("source monogram uses a safe hostname, excludes IP literals, and handles local or malformed sources", () => {
  assert.equal(getSourceMonogram({ site_url: "https://news.example.test/path" }), "N")
  assert.equal(getSourceMonogram({ site_url: "http://localhost:8080/rss" }), "L")
  assert.equal(getSourceMonogram({ site_url: "http://192.168.1.10/feed" }), null)
  assert.equal(getSourceMonogram({ site_url: "http://[2001:db8::1]/feed" }), null)
  assert.equal(
    getSourceMonogram({ title: " ".repeat(3), site_url: "not a URL", feed_url: "" }),
    null,
  )
})

test("provider icon validity depends on minimum dimensions, not aspect ratio", () => {
  assert.equal(isProviderIconUsable(1, 1), false)
  assert.equal(isProviderIconUsable(7, 24), false)
  assert.equal(isProviderIconUsable(24, 7), false)
  assert.equal(isProviderIconUsable(0, 20), false)
  assert.equal(isProviderIconUsable(Number.NaN, 20), false)
  assert.equal(isProviderIconUsable(8, 64), true)
  assert.equal(isProviderIconUsable(64, 8), true)
  assert.equal(isProviderIconUsable(64, 24), true)
})

test("adaptive plate analysis selects a contrasting neutral plate deterministically", () => {
  const image = (r, g, b) => ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 })

  assert.equal(analyzeImageData(image(0, 0, 0)), "dark")
  assert.equal(resolveAdaptivePlate(analyzeImageData(image(0, 0, 0))), "light")
  assert.equal(analyzeImageData(image(255, 255, 255)), "light")
  assert.equal(resolveAdaptivePlate(analyzeImageData(image(255, 255, 255))), "dark")
  assert.equal(analyzeImageData(image(255, 220, 40)), "light")
  assert.equal(resolveAdaptivePlate(analyzeImageData(image(255, 220, 40))), "dark")
  const mixed = image(100, 60, 180)
  assert.equal(analyzeImageData(mixed), "dark")
  assert.equal(analyzeImageData({ ...mixed, data: new Uint8ClampedArray(mixed.data) }), "dark")
  assert.equal(
    analyzeImageData({ data: new Uint8ClampedArray([0, 0, 0, 0]), width: 1, height: 1 }),
    null,
  )
})

test("unreadable or unexpectedly failing canvas analysis stays unavailable without throwing", () => {
  const image = { naturalWidth: 32, naturalHeight: 32 }
  assert.equal(
    analyzeLoadedImage(image, makeDocument(new DOMException("tainted", "SecurityError"))),
    null,
  )
  assert.equal(
    analyzeLoadedImage(image, makeDocument(new Error("unexpected analysis failure"))),
    null,
  )
  assert.equal(analyzeLoadedImage(image, null), null)
})
