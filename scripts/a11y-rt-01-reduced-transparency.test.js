import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import postcss from "postcss"

const themeCss = postcss.parse(readFileSync(new URL("../src/theme.css", import.meta.url), "utf8"))

test("reduced transparency overrides the dark theme glass tokens", () => {
  const reducedTransparency = themeCss.nodes.find(
    (node) =>
      node.type === "atrule" &&
      node.name === "media" &&
      node.params.includes("prefers-reduced-transparency: reduce"),
  )

  assert.ok(reducedTransparency, "the reduced-transparency media query exists")

  const darkThemeOverride = reducedTransparency.nodes.find(
    (node) => node.type === "rule" && node.selector.includes('body[arco-theme="dark"]'),
  )

  assert.ok(
    darkThemeOverride,
    "the dark-theme selector must override its higher-specificity base tokens",
  )

  for (const property of [
    "--nf-glass-fill",
    "--nf-glass-border",
    "--nf-glass-highlight",
    "--nf-glass-shadow",
    "--nf-glass-blur",
  ]) {
    assert.ok(
      darkThemeOverride.nodes.some((node) => node.type === "decl" && node.prop === property),
      `${property} is overridden for dark theme with reduced transparency`,
    )
  }
})
