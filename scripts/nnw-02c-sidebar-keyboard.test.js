import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sidebar = readFileSync(
  new URL("../src/components/Sidebar/Sidebar.jsx", import.meta.url),
  "utf8",
)
const drawer = readFileSync(
  new URL("../src/components/Article/SidebarDrawerHost.jsx", import.meta.url),
  "utf8",
)
const compactNavigation = readFileSync(
  new URL("../src/components/Navigation/CompactNavigation.jsx", import.meta.url),
  "utf8",
)
const mediumNavigation = readFileSync(
  new URL("../src/components/Navigation/MediumNavigation.jsx", import.meta.url),
  "utf8",
)

const componentSource = (name, nextName) => {
  const start = sidebar.indexOf(`const ${name} =`)
  const end = nextName ? sidebar.indexOf(`const ${nextName} =`, start + 1) : sidebar.length
  assert.notEqual(start, -1, `${name} component is present`)
  return sidebar.slice(start, end === -1 ? sidebar.length : end)
}

test("Sidebar Tab and Shift+Tab use native focus order", () => {
  assert.doesNotMatch(sidebar, /event\.key\s*===?\s*["']Tab["']/)
  assert.doesNotMatch(sidebar, /event\.shiftKey[\s\S]{0,80}Tab/)
})

test("Sidebar destination arrows do not implement custom focus navigation", () => {
  const category = componentSource("CategoryTitle", "CountDisplay")
  const modeControls = componentSource("SourceNavigationControls", "CustomMenuItem")
  assert.doesNotMatch(category, /Arrow(?:Up|Down|Left|Right)/)
  assert.doesNotMatch(modeControls, /Arrow(?:Up|Down|Left|Right)/)
})

test("article-list destinations are native links activated by Enter", () => {
  const destination = componentSource("CustomMenuItem", "SidebarMenuItems")
  const feed = componentSource("FeedMenuItem", "FeedMenuGroup")
  const feedLink = feed.slice(feed.indexOf("<Link"), feed.indexOf("</Link>") + "</Link>".length)
  assert.match(destination, /<Link\b[\s\S]*?to=\{path\}/)
  assert.match(feedLink, /to=\{`\/feed\/\$\{feed\.id\}`\}/)
  assert.doesNotMatch(destination + feedLink, /onKeyDown/)
})

test("Space does not add custom activation to category or feed links", () => {
  const category = componentSource("CategoryTitle", "CountDisplay")
  const feed = componentSource("FeedMenuItem", "FeedMenuGroup")
  const feedLink = feed.slice(feed.indexOf("<Link"), feed.indexOf("</Link>") + "</Link>".length)
  assert.doesNotMatch(category + feedLink, /event\.key\s*===?\s*["'] ["']/)
  assert.doesNotMatch(category + feedLink, /e\.key\s*===?\s*["'] ["']/)
})

test("category disclosure is a native button with expanded state and controlled content", () => {
  const categoryGroup = componentSource("CategoryGroup", "MoreOptionsDropdown")
  assert.match(categoryGroup, /<button\b[\s\S]*?aria-expanded=\{[^}]+\}/)
  assert.match(categoryGroup, /aria-controls=\{[^}]+\}/)
  assert.match(categoryGroup, /type="button"/)
  assert.doesNotMatch(categoryGroup, /<Collapse\.Item\b/)
})

test("navigation destinations are not exposed as an ARIA menu or tree composite", () => {
  const destination = componentSource("CustomMenuItem", "SidebarMenuItems")
  const feed = componentSource("FeedMenuItem", "FeedMenuGroup")
  const category = componentSource("CategoryGroup", "MoreOptionsDropdown")
  assert.match(destination, /<Link\b/)
  assert.match(feed, /<Link\b[\s\S]*?className=\{classNames\("arco-menu-item feed-menu-item"/)
  assert.match(sidebar, /<Menu hasCollapseButton=\{false\} role="none"/)
  assert.doesNotMatch(category, /<Collapse\.Item\b|role="button"/)
  assert.doesNotMatch(destination + feed + category, /role="menuitem"|role="treeitem"/)
  assert.doesNotMatch(
    destination + feed + category,
    /tabIndex=\{(?:index|activeIndex|[a-zA-Z]+Index)/,
  )
})

test("Drawer Escape is handled by its local close path and restores its invoker", () => {
  assert.match(drawer, /onCancel=\{closeSidebar\}/)
  assert.match(drawer, /restoreFocusAfterCloseRef\.current = true/)
  assert.match(drawer, /restoreDrawerFocus\(/)
  assert.doesNotMatch(drawer, /document\.addEventListener\(["']keydown/)
})

test("Compact and Medium navigation retain native button and link controls", () => {
  assert.match(compactNavigation, /<button\b[\s\S]*?type="button"/)
  assert.match(mediumNavigation, /<Link\b[\s\S]*?to=\{item\.to\}/)
  assert.match(mediumNavigation, /<button\b[\s\S]*?aria-haspopup="dialog"/)
})
