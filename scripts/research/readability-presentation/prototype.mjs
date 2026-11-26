// Research-only prototype: fixed authored fixtures, no URL or arbitrary input interface.
import assert from "node:assert/strict"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

const body = [
  "The community garden reopened this morning after a long period of preparation.",
  "Volunteers will host weekly workshops on gardening, composting and seasonal vegetables.",
  "The local association published a schedule of activities for neighborhood families.",
]
const prose = body.map((text) => `<p>${text}</p>`).join("")
const fixtures = [
  { id: "plain", article: prose },
  { id: "with-chrome", article: prose, chrome: true },
  {
    id: "structured",
    article: `<h2>Community garden</h2>${prose}<ul><li>Monday workshop</li><li>Friday market</li></ul><blockquote>Everyone is welcome.</blockquote>`,
  },
  { id: "short", article: `<p>${body[0]}</p>` },
  { id: "inline", article: `<p>Read <strong>this</strong> sentence carefully.</p>${prose}` },
  { id: "media", article: `${prose}<figure><figcaption>Garden photograph</figcaption></figure>` },
  { id: "table", article: `${prose}<table><tr><td>Saturday</td><td>Market</td></tr></table>` },
]

const semantic = new Set(["p", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "br"])
const wrappers = new Set(["div", "article", "section"])

// Compare the exact ordered semantic projection of the authored article, ignoring only
// structural wrappers. Unsupported structures are deliberately not eligible for a preview.
function project(node) {
  if (node.nodeType === 3) {
    const text = node.textContent
    return text ? [{ text }] : []
  }
  if (node.nodeType !== 1) return []
  const tag = node.localName
  if (!semantic.has(tag) && !wrappers.has(tag)) {
    throw new Error("unsupported-structure")
  }
  const children = [...node.childNodes].flatMap(project)
  if (wrappers.has(tag)) return children
  return [{ tag, children }]
}

function renderProjection(document, rows) {
  const parent = document.createElement("article")
  function append(target, row) {
    if ("text" in row) {
      target.append(document.createTextNode(row.text))
      return
    }
    assert.ok(semantic.has(row.tag))
    const element = document.createElement(row.tag)
    row.children.forEach((child) => append(element, child))
    target.append(element)
  }
  rows.forEach((row) => append(parent, row))
  return parent
}

function evaluateFixture(fixture) {
  const dom = new JSDOM(
    `<main>${fixture.chrome ? "<nav>Menu directory</nav>" : ""}<article>${fixture.article}</article>${fixture.chrome ? "<aside>Advertisement</aside>" : ""}</main>`,
  )
  const original = dom.window.document.querySelector("article")
  const originalMarkup = original.outerHTML
  try {
    const originalProjection = project(original)
    const clonedDocument = dom.window.document.cloneNode(true)
    const candidate = new Readability(clonedDocument, { disableJSONLD: true }).parse()
    if (!candidate?.content) return { id: fixture.id, decision: "ORIGINAL", reason: "empty" }
    const parsed = new JSDOM(candidate.content)
    try {
      const projection = [...parsed.window.document.body.childNodes].flatMap(project)
      if (JSON.stringify(projection) !== JSON.stringify(originalProjection)) {
        return { id: fixture.id, decision: "ORIGINAL", reason: "semantic-difference" }
      }
      const preview = renderProjection(dom.window.document, projection)
      assert.deepEqual(project(preview), originalProjection)
      assert.equal(preview.textContent, original.textContent)
      assert.equal(preview.querySelector("[src], [href], [style], [id], [class]"), null)
      return { id: fixture.id, decision: "PREVIEW", preview: preview.outerHTML }
    } finally {
      parsed.window.close()
    }
  } catch (error) {
    if (error.message !== "unsupported-structure") throw error
    return { id: fixture.id, decision: "ORIGINAL", reason: "unsupported-structure" }
  } finally {
    assert.equal(original.outerHTML, originalMarkup)
    dom.window.close()
  }
}

const rows = fixtures.map(evaluateFixture)
assert.deepEqual(fixtures.map(evaluateFixture), rows)
assert.equal(rows.find((row) => row.id === "plain").decision, "PREVIEW")
assert.equal(rows.find((row) => row.id === "with-chrome").decision, "PREVIEW")
assert.equal(rows.find((row) => row.id === "media").decision, "ORIGINAL")
assert.equal(rows.find((row) => row.id === "table").decision, "ORIGINAL")
assert.ok(rows.every((row) => ["PREVIEW", "ORIGINAL"].includes(row.decision)))
console.log(JSON.stringify({ scope: "synthetic author-provided visible content only", rows }, null, 2))
