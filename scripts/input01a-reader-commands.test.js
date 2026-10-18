import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const readSource = (file) => readFile(path.join(root, file), "utf8")

const listSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(entryPath)
      }
      return /\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".test.js") ? [entryPath] : []
    }),
  )
  return nested.flat()
}

const productionUseKeyHandlersCallSites = async () => {
  const files = await listSourceFiles(path.join(root, "src"))
  const callSites = []

  for (const file of files) {
    const source = await readFile(file, "utf8")
    if (/\buseKeyHandlers\s*\(/.test(source)) {
      callSites.push(path.relative(root, file))
    }
  }

  return callSites.toSorted()
}

test("INPUT01A_SINGLE_READER_COMMAND_OWNER", async () => {
  assert.deepEqual(await productionUseKeyHandlersCallSites(), [
    "src/components/Content/Content.jsx",
  ])
})

test("INPUT01A_BUTTON_NEXT_USES_SHARED_COMMAND", async () => {
  const source = await readSource("src/components/Article/ActionButtons.jsx")

  assert.match(source, /useReaderCommands/)
  assert.doesNotMatch(source, /useKeyHandlers/)
  assert.match(source, /navigate:\s*navigateToNextArticle/)
})

test("INPUT01A_HOTKEY_NEXT_USES_SHARED_COMMAND", async () => {
  const source = await readSource("src/hooks/useContentHotkeys.js")

  assert.match(source, /useReaderCommands/)
  assert.doesNotMatch(source, /useKeyHandlers/)
  assert.match(
    source,
    /useHotkeys\(filteredHotkeys\.navigateToNextArticle,\s*\(\)\s*=>\s*navigateToNextArticle\(\)\)/,
  )
})

test("INPUT01A_SWIPE_NEXT_USES_SHARED_COMMAND", async () => {
  const source = await readSource("src/components/Content/Content.jsx")

  assert.match(source, /const readerCommandHandlers\s*=\s*useKeyHandlers\(/)
  assert.match(source, /\.\.\.readerCommandHandlers/)
  assert.match(
    source,
    /const \{ navigateToNextArticle, navigateToPreviousArticle \} = readerCommands/,
  )
  assert.match(source, /onSwipedLeft:[\s\S]*?handleSwipeLeft\(\)/)
  assert.match(source, /onSwipedRight:[\s\S]*?handleSwipeRight\(\)/)
})

test("INPUT01A_SHARED_BUSY_STATE_REACHES_ACTION_BUTTONS", async () => {
  const source = await readSource("src/components/Article/ActionButtons.jsx")

  assert.match(source, /useReaderCommands/)
  assert.match(source, /disabled=\{!leftNavigation\.content \|\| isResolving\}/)
  assert.match(source, /disabled=\{!rightNavigation\.content \|\| isResolving\}/)
  assert.match(source, /loading=\{isResolving\}/)
})

test("INPUT01A_RTL_PARITY", async () => {
  const source = await readSource("src/components/Content/Content.jsx")

  assert.match(
    source,
    /isBrowsingRightToLeft\s*\?\s*navigateToPreviousArticle\(\)\s*:\s*navigateToNextArticle\(\)/,
  )
  assert.match(
    source,
    /isBrowsingRightToLeft\s*\?\s*navigateToNextArticle\(\)\s*:\s*navigateToPreviousArticle\(\)/,
  )
})
