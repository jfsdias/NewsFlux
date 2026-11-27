import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8")

test("Home tools disclosure is a transient, accessible button-controlled panel", () => {
  const tools = read("src/components/Home/HomeTools.jsx")
  const editorial = read("src/components/Home/HomeEditorial.jsx")

  assert.match(tools, /aria-expanded=\{open\}/)
  assert.match(tools, /aria-controls=\{HOME_TOOLS_PANEL_ID\}/)
  assert.match(tools, /event\.key === "Escape"/)
  assert.match(editorial, /const \[toolsOpen, setToolsOpen\] = useState\(false\)/)
  assert.match(editorial, /toolsTriggerRef\.current\?\.focus\(\)/)
  for (const source of [tools, editorial]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|updateSettings/u)
  }
})

test("Home tools styling keeps 44px targets, opaque content and a reserved lead cover cap", () => {
  const css = read("src/components/Home/HomeEditorial.css")
  const trigger = css.match(/\.home-tools-trigger \{[^}]*\}/u)[0]
  const panel = css.match(/\.home-tools-panel \{[^}]*\}/u)[0]

  assert.match(trigger, /min-height:\s*44px/)
  assert.match(trigger, /min-width:\s*44px/)
  assert.doesNotMatch(panel, /backdrop-filter|--nf-glass/)
  assert.match(
    css,
    /@media\s*\(max-width:\s*992px\)\s*\{\s*\.home-highlights \.home-highlight-primary \.grid-card-media\s*\{\s*max-height:\s*24vh;/u,
  )
})

test("Home tools copy lives in the English locale only", () => {
  const locale = JSON.parse(read("src/locales/en-US.json"))
  assert.equal(locale.home_page.tools, "Home tools")
})
