import assert from "node:assert/strict"
import test from "node:test"

const codeBlockModule = await import(new URL("code-block.js", import.meta.url)).catch(() => null)

test("logical line count does not invent a line after a terminal newline", () => {
  assert.ok(codeBlockModule, "code-block utility should exist")

  const getCodeLineCount = codeBlockModule.default
  assert.equal(getCodeLineCount(""), 0)
  assert.equal(getCodeLineCount("one"), 1)
  assert.equal(getCodeLineCount("one\n"), 1)
  assert.equal(getCodeLineCount("one\n\n"), 2)
  assert.equal(getCodeLineCount("\none"), 2)
})

test("wrapped logical lines preserve every character and source line", () => {
  assert.ok(codeBlockModule, "code-block utility should exist")

  const { splitCodeIntoLogicalLines } = codeBlockModule
  const samples = [
    `https://example.com/${"segment".repeat(40)}`,
    "const value = `a very long string without whitespace`\t\t\n\nend\n",
    "\nfirst\n\nsecond",
    "line\n\n\n",
  ]

  for (const source of samples) {
    const logicalLines = splitCodeIntoLogicalLines(source)
    assert.equal(logicalLines.join(""), source)
    assert.equal(logicalLines.length, codeBlockModule.default(source))
  }
})

test("automatic highlighting and line number thresholds remain bounded", () => {
  assert.ok(codeBlockModule, "code-block utility should exist")

  const { isCodeBlockLarge, shouldShowCodeLineNumbers } = codeBlockModule
  assert.equal(isCodeBlockLarge("x".repeat(50_000)), false)
  assert.equal(isCodeBlockLarge("x".repeat(50_001)), true)
  assert.equal(isCodeBlockLarge(Array.from({ length: 1000 }, () => "x").join("\n")), false)
  assert.equal(isCodeBlockLarge(`${Array.from({ length: 1000 }, () => "x").join("\n")}\n`), true)
  assert.equal(isCodeBlockLarge(Array.from({ length: 1001 }, () => "x").join("\n")), true)
  assert.equal(shouldShowCodeLineNumbers(Array.from({ length: 500 }, () => "x").join("\n")), true)
  assert.equal(shouldShowCodeLineNumbers(Array.from({ length: 501 }, () => "x").join("\n")), false)
})
