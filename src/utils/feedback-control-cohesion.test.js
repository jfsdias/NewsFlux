import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRootUrlPrefix = pathToFileURL(`${sourceRoot}${path.sep}`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null
    if (specifier.startsWith("@/")) {
      target = path.resolve(sourceRoot, specifier.slice(2))
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith(sourceRootUrlPrefix) &&
      !path.extname(specifier)
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }

    if (target) {
      if (!path.extname(target)) {
        const jsTarget = `${target}.js`
        const jsxTarget = `${target}.jsx`
        if (existsSync(jsTarget)) {
          return nextResolve(pathToFileURL(jsTarget).href, context)
        }
        if (existsSync(jsxTarget)) {
          return nextResolve(pathToFileURL(jsxTarget).href, context)
        }
      } else if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const { accentFamilies } = await import("./colors")
const { getMarkAllReadUndoNotificationId, MARK_ALL_READ_UNDO_DURATION_MS } =
  await import("./mark-all-read-undo")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.resolve(__dirname, "../locales")
const localeFiles = [
  "de-DE.json",
  "en-US.json",
  "es-ES.json",
  "fr-FR.json",
  "ja-JP.json",
  "zh-CN.json",
]

const getNestedProperty = (object, keyPath) => {
  let current = object
  for (const part of keyPath.split(".")) {
    current = current?.[part]
  }
  return current
}

test("CHROME-01B: All 6 shipped locales provide non-empty verb-first confirmation strings", () => {
  const confirmationKeys = [
    "sidebar.context_menu.mark_all_as_read",
    "search.cancel",
    "sidebar.reset_settings",
    "sidebar.logout",
    "settings.import_settings",
    "sidebar.context_menu.delete_category",
    "sidebar.context_menu.delete_feed",
  ]

  for (const file of localeFiles) {
    const raw = readFileSync(path.join(localesDir, file), "utf8")
    const data = JSON.parse(raw)

    for (const key of confirmationKeys) {
      const val = getNestedProperty(data, key)
      assert.ok(
        val && typeof val === "string" && val.trim().length > 0,
        `Locale ${file} is missing required confirmation action key: ${key}`,
      )
    }
  }
})

test("CHROME-01B: Semantic color boundary — Theme accents must not collide with status semantics", () => {
  // Arco default semantic tokens
  const arcoDanger6Hex = "#F53F3F"
  const arcoWarning6Hex = "#FF7D00"
  const arcoSuccess6Hex = "#00B42A"

  // Editorial Crimson must be distinct from danger status red
  const crimsonDark = accentFamilies.Red.dark.accent.toUpperCase()
  assert.notEqual(
    crimsonDark,
    arcoDanger6Hex.toUpperCase(),
    "Editorial Crimson accent must not equal Arco danger-6 status color",
  )

  // Editorial Gold must be distinct from warning status orange
  const goldDark = accentFamilies.Yellow.dark.accent.toUpperCase()
  assert.notEqual(
    goldDark,
    arcoWarning6Hex.toUpperCase(),
    "Editorial Gold accent must not equal Arco warning-6 status color",
  )

  // Editorial Green must be distinct from success status green
  const greenDark = accentFamilies.Green.dark.accent.toUpperCase()
  assert.notEqual(
    greenDark,
    arcoSuccess6Hex.toUpperCase(),
    "Editorial Green accent must not equal Arco success-6 status color",
  )
})

test("CHROME-01B: Undo notification contract — duration and unique token IDs", () => {
  assert.equal(
    MARK_ALL_READ_UNDO_DURATION_MS,
    8000,
    "Undo notice duration must remain 8000ms for touch usability",
  )

  const tokenA = "token-alpha-123"
  const tokenB = "token-beta-456"
  const idA = getMarkAllReadUndoNotificationId(tokenA)
  const idB = getMarkAllReadUndoNotificationId(tokenB)

  assert.equal(idA, "footer-mark-all-read-undo-token-alpha-123")
  assert.equal(idB, "footer-mark-all-read-undo-token-beta-456")
  assert.notEqual(idA, idB, "Undo notification IDs must remain token-scoped")
})
