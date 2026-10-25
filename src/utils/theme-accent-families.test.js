import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
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

const { accentFamilies, applyColor, colors, getAccentFamily, getColorValue, getDisplayColorValue } =
  await import("./colors")

// WCAG 2.1 relative luminance and contrast ratio helpers
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  return [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)]
}

function sRGBtoLin(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b)
}

function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1)
  const l2 = getRelativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const REQUIRED_COLOR_NAMES = ["Red", "Orange", "Yellow", "Green", "Blue", "Violet"]
const REQUIRED_TOKEN_KEYS = ["accent", "surface", "hover", "border", "onAccent"]

test("all six persisted color names resolve with complete semantic definitions", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    assert.ok(accentFamilies[name], `Expected accentFamily for ${name}`)
    assert.ok(colors[name], `Expected colors export entry for ${name}`)

    const family = getAccentFamily(name)
    assert.equal(family, accentFamilies[name])
    assert.ok(typeof family.name === "string" && family.name.length > 0)

    for (const mode of ["dark", "light"]) {
      assert.ok(family[mode], `Expected ${mode} mode definition for ${name}`)
      for (const token of REQUIRED_TOKEN_KEYS) {
        assert.ok(family[mode][token], `Expected token ${token} for ${name} in ${mode} mode`)
        assert.match(
          family[mode][token],
          /^#[0-9A-Fa-f]{6}$/,
          `Expected valid 6-char hex for ${name}.${mode}.${token}`,
        )
      }
    }
  }
})

test("unknown color fallback safely defaults to Blue", () => {
  const fallbackFamily = getAccentFamily("NonExistentColor")
  assert.equal(fallbackFamily, accentFamilies.Blue)
  assert.equal(fallbackFamily.name, "Editorial Blue")

  const displayColor = getDisplayColorValue("UnknownColor", true)
  assert.equal(displayColor, accentFamilies.Blue.dark.accent)
})

test("Editorial Gold semantic family resolves correctly", () => {
  const gold = getAccentFamily("Yellow")
  assert.equal(gold.name, "Editorial Gold")
  assert.equal(gold.dark.accent, "#E5B84B")
  assert.equal(gold.dark.surface, "#2A2314")
  assert.equal(gold.dark.onAccent, "#0B0D10")
})

test("Editorial Crimson semantic family resolves correctly", () => {
  const crimson = getAccentFamily("Red")
  assert.equal(crimson.name, "Editorial Crimson")
  assert.equal(crimson.dark.accent, "#F05257")
  assert.equal(crimson.dark.surface, "#271315")
  assert.equal(crimson.dark.onAccent, "#0B0D10")
})

test("getColorValue and getDisplayColorValue return valid hex for both modes", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    const darkVal = getColorValue(name, true)
    const lightVal = getColorValue(name, false)
    assert.equal(darkVal, accentFamilies[name].dark.accent)
    assert.equal(lightVal, accentFamilies[name].light.accent)

    const darkDisplay = getDisplayColorValue(name, true)
    const lightDisplay = getDisplayColorValue(name, false)
    assert.equal(darkDisplay, darkVal)
    assert.equal(lightDisplay, lightVal)
  }
})

test("applyColor applies both Arco --primary-* and NewsFlux --nf-accent* tokens to document", () => {
  const setProperties = new Map()
  let attributeName = null
  let attributeValue = null

  const mockDocument = {
    body: {
      style: {
        setProperty: (key, val) => {
          setProperties.set(key, val)
        },
      },
      setAttribute: (name, val) => {
        attributeName = name
        attributeValue = val
      },
    },
  }

  const prevDoc = globalThis.document
  try {
    globalThis.document = mockDocument

    applyColor("Yellow", true)

    // Verify Arco primary tokens 1 through 10
    for (let i = 1; i <= 10; i++) {
      assert.ok(setProperties.has(`--primary-${i}`), `Missing --primary-${i}`)
      assert.match(
        setProperties.get(`--primary-${i}`),
        /^\d+,\s*\d+,\s*\d+$/,
        `--primary-${i} should be RGB string`,
      )
    }

    // Verify semantic accent tokens
    assert.equal(setProperties.get("--nf-accent"), "#E5B84B")
    assert.equal(setProperties.get("--nf-accent-surface"), "#2A2314")
    assert.equal(setProperties.get("--nf-accent-hover"), "#3C321C")
    assert.equal(setProperties.get("--nf-accent-border"), "#5E4E25")
    assert.equal(setProperties.get("--nf-on-accent"), "#0B0D10")
    assert.equal(setProperties.get("--nf-accent-focus"), "#F6D37E")
    assert.equal(setProperties.get("--nf-accent-pressed"), "#4D4023")

    // Verify attribute
    assert.equal(attributeName, "color-name")
    assert.equal(attributeValue, "Yellow")
  } finally {
    globalThis.document = prevDoc
  }
})

test("applyColor falls back gracefully for unknown color names", () => {
  const setProperties = new Map()
  let attributeValue = null

  const mockDocument = {
    body: {
      style: {
        setProperty: (key, val) => {
          setProperties.set(key, val)
        },
      },
      setAttribute: (name, val) => {
        if (name === "color-name") {
          attributeValue = val
        }
      },
    },
  }

  const prevDoc = globalThis.document
  try {
    globalThis.document = mockDocument
    applyColor("InvalidPaletteColor", true)

    assert.equal(setProperties.get("--nf-accent"), accentFamilies.Blue.dark.accent)
    assert.equal(attributeValue, "Blue")
  } finally {
    globalThis.document = prevDoc
  }
})

test("deterministic contrast: all dark theme accent text on surface exceeds 4.5:1", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    const family = accentFamilies[name]
    const cr = getContrastRatio(family.dark.accent, family.dark.surface)
    assert.ok(
      cr >= 4.5,
      `Expected ${family.name} dark accent text on surface to achieve >=4.5:1, got ${cr.toFixed(2)}:1`,
    )
  }
})

test("deterministic contrast: all dark theme on-accent text on accent exceeds 4.5:1", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    const family = accentFamilies[name]
    const cr = getContrastRatio(family.dark.onAccent, family.dark.accent)
    assert.ok(
      cr >= 4.5,
      `Expected ${family.name} dark on-accent text on accent to achieve >=4.5:1, got ${cr.toFixed(2)}:1`,
    )
  }
})

test("deterministic contrast: all dark theme accent text on OLED canvas (#0B0D10) exceeds 4.5:1", () => {
  const canvas = "#0B0D10"
  for (const name of REQUIRED_COLOR_NAMES) {
    const family = accentFamilies[name]
    const cr = getContrastRatio(family.dark.accent, canvas)
    assert.ok(
      cr >= 4.5,
      `Expected ${family.name} dark accent text on OLED canvas to achieve >=4.5:1, got ${cr.toFixed(2)}:1`,
    )
  }
})

test("deterministic contrast: all light theme accent text on surface exceeds 4.5:1", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    const family = accentFamilies[name]
    const cr = getContrastRatio(family.light.accent, family.light.surface)
    assert.ok(
      cr >= 4.5,
      `Expected ${family.name} light accent text on surface to achieve >=4.5:1, got ${cr.toFixed(2)}:1`,
    )
  }
})

test("deterministic contrast: all light theme on-accent text on accent exceeds 4.5:1", () => {
  for (const name of REQUIRED_COLOR_NAMES) {
    const family = accentFamilies[name]
    const cr = getContrastRatio(family.light.onAccent, family.light.accent)
    assert.ok(
      cr >= 4.5,
      `Expected ${family.name} light on-accent text on accent to achieve >=4.5:1, got ${cr.toFixed(2)}:1`,
    )
  }
})

test("deterministic contrast: resolves A11Y_CONTRAST_COMPACT_NAV_01 with safe margin", () => {
  // Baseline finding: badge ≈ 3.68:1 (white on Blue), selected label ≈ 3.77:1
  // Target: >= 4.5:1 with safety margin above 4.50
  const blueDark = accentFamilies.Blue.dark
  const goldDark = accentFamilies.Yellow.dark
  const crimsonDark = accentFamilies.Red.dark

  // Badge text (onAccent on accent)
  const blueBadgeContrast = getContrastRatio(blueDark.onAccent, blueDark.accent)
  const goldBadgeContrast = getContrastRatio(goldDark.onAccent, goldDark.accent)
  const crimsonBadgeContrast = getContrastRatio(crimsonDark.onAccent, crimsonDark.accent)

  assert.ok(
    blueBadgeContrast >= 5,
    `Blue badge contrast ${blueBadgeContrast.toFixed(2)}:1 >= 5.0:1`,
  )
  assert.ok(
    goldBadgeContrast >= 10,
    `Gold badge contrast ${goldBadgeContrast.toFixed(2)}:1 >= 10.0:1`,
  )
  assert.ok(
    crimsonBadgeContrast >= 5,
    `Crimson badge contrast ${crimsonBadgeContrast.toFixed(2)}:1 >= 5.0:1`,
  )

  // Compact nav selected label (accent on surface or canvas)
  const blueLabelContrast = getContrastRatio(blueDark.accent, blueDark.surface)
  const goldLabelContrast = getContrastRatio(goldDark.accent, goldDark.surface)
  const crimsonLabelContrast = getContrastRatio(crimsonDark.accent, crimsonDark.surface)

  assert.ok(
    blueLabelContrast >= 5,
    `Blue label contrast ${blueLabelContrast.toFixed(2)}:1 >= 5.0:1`,
  )
  assert.ok(
    goldLabelContrast >= 8,
    `Gold label contrast ${goldLabelContrast.toFixed(2)}:1 >= 8.0:1`,
  )
  assert.ok(
    crimsonLabelContrast >= 5,
    `Crimson label contrast ${crimsonLabelContrast.toFixed(2)}:1 >= 5.0:1`,
  )
})
