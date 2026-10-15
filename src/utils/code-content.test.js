import assert from "node:assert/strict"
import test from "node:test"

const codeContentModule = await import(new URL("code-content.js", import.meta.url)).catch(
  () => null,
)

test("code extraction preserves source whitespace and parser-decoded text exactly", () => {
  assert.ok(codeContentModule, "code-content utility should exist")

  const extractCodeContent = codeContentModule.default
  const parsedCode = {
    children: [
      { data: "\n  const value = '&amp;';  \t\n\n" },
      { type: "tag", name: "br" },
      { type: "tag", name: "strong", children: [{ data: "  return value  " }] },
    ],
  }

  assert.equal(
    extractCodeContent(parsedCode),
    "\n  const value = '&amp;';  \t\n\n\n  return value  ",
  )
})

test("code extraction adds separators between paragraph-shaped source lines", () => {
  assert.ok(codeContentModule, "code-content utility should exist")

  const extractCodeContent = codeContentModule.default
  const parsedCode = {
    children: [
      { type: "tag", name: "p", children: [{ data: "first" }] },
      {
        type: "tag",
        name: "p",
        children: [{ type: "tag", name: "span", children: [{ data: "second" }] }],
      },
    ],
  }

  assert.equal(extractCodeContent(parsedCode), "first\nsecond\n")
})

test("code extraction never decodes already-parsed entity text a second time", () => {
  assert.ok(codeContentModule, "code-content utility should exist")

  const extractCodeContent = codeContentModule.default
  const parsedCode = {
    children: [{ data: "&amp; &lt; &gt; &quot; &#39; | & < > \" '" }],
  }

  assert.equal(extractCodeContent(parsedCode), "&amp; &lt; &gt; &quot; &#39; | & < > \" '")
})
