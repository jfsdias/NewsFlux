import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/components/Main/Main.jsx", import.meta.url), "utf8")
const mainCss = readFileSync(new URL("../src/components/Main/Main.css", import.meta.url), "utf8")
const cssRules = mainCss.replaceAll(/\/\*[\s\S]*?\*\//g, "")

const getRules = (selectorPattern) =>
  [...cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selectorPattern.test(selector))
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))

test("discovery candidates render their URL once through one shared label", () => {
  assert.doesNotMatch(
    source,
    /candidate\.title\s*\|\|\s*candidate\.url/,
    "a missing title must not fall back to the URL while the URL is also rendered as metadata",
  )
  assert.doesNotMatch(
    source,
    />\s*\{candidate\.url\}\s*</,
    "candidate.url is only rendered by the shared label, never as a second raw line",
  )
  assert.equal(
    source.match(/<DiscoveryCandidateLabel candidate=\{candidate\} \/>/g)?.length,
    2,
    "the confirm card and the choice rows share the same label",
  )
  assert.match(
    source,
    /secondary:\s*null/,
    "the label helper drops the secondary line when the title is missing or repeats the URL",
  )
})

test("discovery candidate rows are opaque reading surfaces", () => {
  const candidateRules = getRules(/add-feed-discovery-candidate/)
  assert.ok(candidateRules.length > 0, "candidate rows are styled")

  for (const { selector, body } of candidateRules) {
    assert.doesNotMatch(body, /backdrop-filter|--nf-glass/, `${selector} must not use glass chrome`)
  }

  const row = candidateRules.find(
    ({ selector }) => selector === ".add-feed-discovery-candidates .add-feed-discovery-candidate",
  )
  assert.ok(row, "the shared row rule exists")
  assert.match(row.body, /background-color:\s*var\(--nf-surface-raised\)/)
})

test("long discovery URLs wrap inside the dialog instead of overflowing", () => {
  const textRule = getRules(/^\s*\.add-feed-discovery-candidate-title,/)[0]
  assert.ok(textRule, "title and URL share a wrapping rule")
  assert.match(textRule.body, /overflow-wrap:\s*anywhere/)
  assert.match(textRule.body, /min-width:\s*0/)

  const list = getRules(/^\s*\.add-feed-discovery-candidates\s*$/)[0]
  assert.ok(list, "the candidate list rule exists")
  assert.match(list.body, /overflow-y:\s*auto/, "a long candidate list scrolls inside the dialog")
})
