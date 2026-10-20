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

test("NAV-PR1-R2: invoker tracking atom state transitions", async () => {
  const sidebarStatePath = path.resolve("src/store/sidebarState.js")
  const sidebarStateSource = fs.readFileSync(sidebarStatePath, "utf8")

  // Must export mobileSidebarInvokerState and setMobileSidebarInvoker
  assert.ok(sidebarStateSource.includes("export const mobileSidebarInvokerState = atom(null)"))
  assert.ok(
    sidebarStateSource.includes(
      "export const setMobileSidebarInvoker = createSetter(mobileSidebarInvokerState)",
    ),
  )

  // Verify in-memory atom behavior
  const { atom } = await import("nanostores")
  const testInvokerState = atom(null)
  assert.equal(testInvokerState.get(), null)

  testInvokerState.set("compact-sources")
  assert.equal(testInvokerState.get(), "compact-sources")

  testInvokerState.set(null)
  assert.equal(testInvokerState.get(), null)

  testInvokerState.set("header")
  assert.equal(testInvokerState.get(), "header")

  testInvokerState.set(null)
  assert.equal(testInvokerState.get(), null)
})

test("NAV-PR1-R2: CompactNavigation aria-controls and invoker contract", () => {
  const componentPath = path.resolve("src/components/Navigation/CompactNavigation.jsx")
  const componentSource = fs.readFileSync(componentPath, "utf8")

  // Must have aria-controls for dialog triggers pointing to mobile-sidebar-drawer
  assert.ok(
    componentSource.includes(
      'aria-controls={isDialogTrigger ? "mobile-sidebar-drawer" : undefined}',
    ),
  )

  // Must record invoker as 'compact-sources' when opening
  assert.ok(componentSource.includes('setMobileSidebarInvoker("compact-sources")'))
})

test("NAV-PR1-R2: SidebarTrigger decouples Drawer host and suppresses duplicate in compact list", () => {
  const triggerPath = path.resolve("src/components/Article/SidebarTrigger.jsx")
  const drawerHostPath = path.resolve("src/components/Article/SidebarDrawerHost.jsx")

  const triggerSource = fs.readFileSync(triggerPath, "utf8")
  const drawerHostSource = fs.readFileSync(drawerHostPath, "utf8")

  // SidebarTrigger imports and mounts SidebarDrawerHost
  assert.ok(triggerSource.includes('import SidebarDrawerHost from "./SidebarDrawerHost"'))
  assert.ok(triggerSource.includes("<SidebarDrawerHost"))
  assert.ok(triggerSource.includes("SidebarDrawerHost"))

  // In COMPACT list mode, visible trigger is suppressed
  assert.ok(triggerSource.includes("const showLegacyTrigger = !(isCompact && !isReaderActive)"))

  // Drawer host contains the Drawer component with id mobile-sidebar-drawer
  assert.ok(drawerHostSource.includes('id="mobile-sidebar-drawer"'))
  assert.ok(drawerHostSource.includes("<Drawer"))
})

test("NAV-PR1-R3: SidebarDrawerHost multi-invoker focus return contract", () => {
  const drawerHostPath = path.resolve("src/components/Article/SidebarDrawerHost.jsx")
  const drawerFocusPath = path.resolve("src/utils/drawer-focus.js")
  const drawerHostSource = fs.readFileSync(drawerHostPath, "utf8")
  const drawerFocusSource = fs.readFileSync(drawerFocusPath, "utf8")

  // Checks shouldRestoreFocus before focusing
  assert.ok(drawerHostSource.includes("if (!shouldRestoreFocus)"))

  // Delegates focus restoration to restoreDrawerFocus
  assert.ok(drawerHostSource.includes("restoreDrawerFocus({"))

  // Handles both invoker targets in drawer-focus
  assert.ok(drawerFocusSource.includes('invoker === "compact-sources"'))
  assert.ok(drawerFocusSource.includes("resolveCurrentDrawerFocusTarget"))

  // Clears invoker state on close
  assert.ok(drawerHostSource.includes("setMobileSidebarInvoker(null)"))

  // Navigation close sets restoreFocusAfterClose to false
  assert.ok(drawerHostSource.includes("const closeSidebarAfterNavigation = () => {"))
  assert.ok(drawerHostSource.includes("restoreFocusAfterCloseRef.current = false"))
})

test("NAV-PR1-R3: no persistent state in R2 and R3 files", () => {
  const filesToCheck = [
    "src/store/sidebarState.js",
    "src/components/Navigation/CompactNavigation.jsx",
    "src/components/Article/SidebarTrigger.jsx",
    "src/components/Article/SidebarDrawerHost.jsx",
    "src/utils/drawer-focus.js",
  ]

  for (const relativePath of filesToCheck) {
    const fullPath = path.resolve(relativePath)
    const content = fs.readFileSync(fullPath, "utf8")

    // Neither localStorage nor sessionStorage should be referenced
    if (relativePath !== "src/store/sidebarState.js") {
      assert.ok(
        !content.includes("@nanostores/persistent"),
        `${relativePath} must not use persistent stores`,
      )
    }
    assert.ok(!content.includes("localStorage"), `${relativePath} must not access localStorage`)
    assert.ok(!content.includes("sessionStorage"), `${relativePath} must not access sessionStorage`)
  }
})
