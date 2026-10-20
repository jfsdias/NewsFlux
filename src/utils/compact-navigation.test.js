import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const compactNavModule = await import(new URL("compact-navigation.js", import.meta.url))
const { COMPACT_NAV_DESTINATIONS, resolveCompactNavActiveKey, shouldRenderCompactNavigation } =
  compactNavModule

test("COMPACT-NAV: destination keys integrity", () => {
  assert.equal(COMPACT_NAV_DESTINATIONS.HOME, "home")
  assert.equal(COMPACT_NAV_DESTINATIONS.ALL, "all")
  assert.equal(COMPACT_NAV_DESTINATIONS.TODAY, "today")
  assert.equal(COMPACT_NAV_DESTINATIONS.STARRED, "starred")
  assert.equal(COMPACT_NAV_DESTINATIONS.SOURCES, "sources")
})

test("COMPACT-NAV: active key resolution across routes", () => {
  // Home root and home article
  assert.equal(resolveCompactNavActiveKey("/"), COMPACT_NAV_DESTINATIONS.HOME)
  assert.equal(resolveCompactNavActiveKey("/entry/123"), COMPACT_NAV_DESTINATIONS.HOME)

  // All and All article
  assert.equal(resolveCompactNavActiveKey("/all"), COMPACT_NAV_DESTINATIONS.ALL)
  assert.equal(resolveCompactNavActiveKey("/all/entry/456"), COMPACT_NAV_DESTINATIONS.ALL)

  // Today and Today article
  assert.equal(resolveCompactNavActiveKey("/today"), COMPACT_NAV_DESTINATIONS.TODAY)
  assert.equal(resolveCompactNavActiveKey("/today/entry/789"), COMPACT_NAV_DESTINATIONS.TODAY)

  // Starred and Starred article
  assert.equal(resolveCompactNavActiveKey("/starred"), COMPACT_NAV_DESTINATIONS.STARRED)
  assert.equal(resolveCompactNavActiveKey("/starred/entry/101"), COMPACT_NAV_DESTINATIONS.STARRED)

  // Feed and Feed article -> Sources
  assert.equal(resolveCompactNavActiveKey("/feed/42"), COMPACT_NAV_DESTINATIONS.SOURCES)
  assert.equal(resolveCompactNavActiveKey("/feed/42/entry/102"), COMPACT_NAV_DESTINATIONS.SOURCES)

  // Category and Category article -> Sources
  assert.equal(resolveCompactNavActiveKey("/category/7"), COMPACT_NAV_DESTINATIONS.SOURCES)
  assert.equal(
    resolveCompactNavActiveKey("/category/7/entry/103"),
    COMPACT_NAV_DESTINATIONS.SOURCES,
  )

  // History and other unmapped routes
  assert.equal(resolveCompactNavActiveKey("/history"), null)
  assert.equal(resolveCompactNavActiveKey("/settings"), null)
  assert.equal(resolveCompactNavActiveKey(""), null)
  assert.equal(resolveCompactNavActiveKey(null), null)
})

test("COMPACT-NAV: visibility condition rules", () => {
  // Only visible when COMPACT and NOT in reader
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "COMPACT", isReaderActive: false }),
    true,
  )

  // Suppressed during reader even in COMPACT (Option B)
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "COMPACT", isReaderActive: true }),
    false,
  )

  // Never visible in MEDIUM
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "MEDIUM", isReaderActive: false }),
    false,
  )
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "MEDIUM", isReaderActive: true }),
    false,
  )

  // Never visible in DESKTOP
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "DESKTOP", isReaderActive: false }),
    false,
  )
  assert.equal(
    shouldRenderCompactNavigation({ windowClass: "DESKTOP", isReaderActive: true }),
    false,
  )
})

test("COMPACT-NAV: destination keys contract and immutability", () => {
  assert.throws(() => {
    COMPACT_NAV_DESTINATIONS.EXTRA = "extra"
  })
  const expectedKeys = ["HOME", "ALL", "TODAY", "STARRED", "SOURCES"]
  assert.deepEqual(Object.keys(COMPACT_NAV_DESTINATIONS).toSorted(), expectedKeys.toSorted())
})

test("COMPACT-NAV: no persistent state contract", () => {
  const componentPath = path.resolve("src/components/Navigation/CompactNavigation.jsx")
  const utilsPath = path.resolve("src/utils/compact-navigation.js")

  const componentSource = fs.readFileSync(componentPath, "utf8")
  const utilsSource = fs.readFileSync(utilsPath, "utf8")

  // Must not import persistent stores or access Web Storage
  assert.ok(!componentSource.includes("@nanostores/persistent"))
  assert.ok(!utilsSource.includes("@nanostores/persistent"))
  assert.ok(!componentSource.includes("localStorage"))
  assert.ok(!utilsSource.includes("localStorage"))
  assert.ok(!componentSource.includes("sessionStorage"))
  assert.ok(!utilsSource.includes("sessionStorage"))
})

test("COMPACT-NAV: safe area contract and css rules", () => {
  const cssPath = path.resolve("src/components/Navigation/CompactNavigation.css")
  const cssSource = fs.readFileSync(cssPath, "utf8")

  // Safe area must use env() with a 0px fallback
  assert.ok(cssSource.includes("env(safe-area-inset-bottom, 0px)"))

  // Target size contract: height at least 48px (>= 44px)
  assert.ok(cssSource.includes("height: 48px"))
  assert.ok(cssSource.includes("min-width: 48px"))

  // Inert gap: gap: 4px between items
  assert.ok(cssSource.includes("gap: 4px"))
})
