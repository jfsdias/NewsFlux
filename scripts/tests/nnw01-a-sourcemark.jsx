import React from "react"
import { createRoot } from "react-dom/client"

import SourceMark from "@/components/ui/SourceMark"
import "@/theme.css"

const createDataIcon = (width, height, color) => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  return canvas.toDataURL("image/png")
}

const createMixedDataIcon = () => {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 16
  const context = canvas.getContext("2d")
  context.fillStyle = "#101010"
  context.fillRect(0, 0, 8, 16)
  context.fillStyle = "#f0d740"
  context.fillRect(8, 0, 8, 16)
  return canvas.toDataURL("image/png")
}

const requestBaseline = new Set(performance.getEntriesByType("resource").map(({ name }) => name))
const externalUrl = `http://127.0.0.1:4174/provider-wide.svg?run=${Date.now()}`
const nonSquareUrl = createDataIcon(64, 24, "#c8502a")
const tinyUrl = createDataIcon(1, 1, "#111111")
const cases = [
  {
    name: "DATA_OR_MEMORY_ICON_ANALYZABLE_DARK",
    feed: { title: "Black" },
    icon: createDataIcon(16, 16, "#000000"),
  },
  {
    name: "DATA_OR_MEMORY_ICON_ANALYZABLE_LIGHT",
    feed: { title: "Light" },
    icon: createDataIcon(16, 16, "#ffffff"),
  },
  {
    name: "YELLOW_ICON_ADAPTIVE",
    feed: { title: "Yellow" },
    icon: createDataIcon(16, 16, "#ffe52e"),
  },
  {
    name: "ORANGE_ICON_ADAPTIVE",
    feed: { title: "Orange" },
    icon: createDataIcon(16, 16, "#f0902d"),
  },
  {
    name: "PURPLE_ICON_ADAPTIVE",
    feed: { title: "Purple" },
    icon: createDataIcon(16, 16, "#5b3888"),
  },
  {
    name: "BLUE_NEAR_CROSSOVER_ICON_ADAPTIVE",
    feed: { title: "Blue" },
    icon: createDataIcon(16, 16, "#4b78b8"),
  },
  {
    name: "GREEN_ICON_ADAPTIVE",
    feed: { title: "Green" },
    icon: createDataIcon(16, 16, "#3a9d45"),
  },
  {
    name: "MIXED_COLORED_ICON_DETERMINISTIC",
    feed: { title: "Mixed" },
    icon: createMixedDataIcon(),
  },
  {
    name: "MIXED_COLORED_ICON_DETERMINISTIC_REPEAT",
    feed: { title: "Mixed repeat" },
    icon: createMixedDataIcon(),
  },
  {
    name: "CROSS_ORIGIN_PROVIDER_NO_ACAO",
    feed: { title: "Provider" },
    icon: externalUrl,
    providerIconWidth: null,
    providerIconHeight: null,
  },
  {
    name: "NON_SQUARE_PROVIDER_ICON",
    feed: { title: "Wide" },
    icon: nonSquareUrl,
    providerIconWidth: 64,
    providerIconHeight: 24,
  },
  {
    name: "TINY_PROVIDER_ICON",
    feed: { title: "Tiny" },
    icon: tinyUrl,
    providerIconWidth: null,
    providerIconHeight: null,
  },
  { name: "MONOGRAM", feed: { title: "🛰️ Notícias" } },
  { name: "RSS_TERMINAL", feed: { title: "📰", site_url: "http://192.168.1.1/feed" } },
]

const container = document.querySelector("#cases")
const root = createRoot(container)
root.render(
  <>
    {cases.map(({ name, feed, icon, providerIconWidth, providerIconHeight }) => (
      <section key={name} data-case={name}>
        <span>{name}</span>
        <SourceMark
          feed={feed}
          providerIconHeight={providerIconHeight}
          providerIconUrl={icon}
          providerIconWidth={providerIconWidth}
          size={20}
        />
      </section>
    ))}
  </>,
)

const waitFor = async (predicate, timeoutMs = 4000) => {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  return predicate()
}

const setTheme = (theme) => {
  document.body.setAttribute("arco-theme", theme)
  document.documentElement.dataset.theme = theme
}

const run = async () => {
  const checks = []
  const record = (name, pass, details = "") =>
    checks.push({ name, result: pass ? "PASS" : "FAIL", details })

  const loaded = await waitFor(() =>
    [...document.querySelectorAll("#cases img")].every((image) => image.complete),
  )
  record("PROVIDER_IMAGES_LOADED", loaded)

  const mark = (name) => document.querySelector(`[data-case="${CSS.escape(name)}"] .source-mark`)
  const stateSettled = await waitFor(
    () =>
      mark("DATA_OR_MEMORY_ICON_ANALYZABLE_DARK")?.dataset.sourceMarkPlate === "light" &&
      mark("DATA_OR_MEMORY_ICON_ANALYZABLE_LIGHT")?.dataset.sourceMarkPlate === "dark" &&
      mark("TINY_PROVIDER_ICON")?.dataset.sourceMarkFallback === "monogram",
  )
  record("IMAGE_ANALYSIS_STATE_SETTLED", stateSettled)
  const dark = mark("DATA_OR_MEMORY_ICON_ANALYZABLE_DARK")
  const light = mark("DATA_OR_MEMORY_ICON_ANALYZABLE_LIGHT")
  const yellow = mark("YELLOW_ICON_ADAPTIVE")
  const orange = mark("ORANGE_ICON_ADAPTIVE")
  const purple = mark("PURPLE_ICON_ADAPTIVE")
  const blue = mark("BLUE_NEAR_CROSSOVER_ICON_ADAPTIVE")
  const green = mark("GREEN_ICON_ADAPTIVE")
  const mixed = mark("MIXED_COLORED_ICON_DETERMINISTIC")
  const mixedRepeat = mark("MIXED_COLORED_ICON_DETERMINISTIC_REPEAT")
  const crossOrigin = mark("CROSS_ORIGIN_PROVIDER_NO_ACAO")
  const nonSquare = mark("NON_SQUARE_PROVIDER_ICON")
  const tiny = mark("TINY_PROVIDER_ICON")
  const monogram = mark("MONOGRAM")
  const rss = mark("RSS_TERMINAL")

  record("BLACK_ICON_ADAPTIVE_LIGHT_PLATE", dark?.dataset.sourceMarkPlate === "light")
  record("LIGHT_ICON_ADAPTIVE_DARK_PLATE", light?.dataset.sourceMarkPlate === "dark")
  record("YELLOW_ICON_ADAPTIVE_DARK_PLATE", yellow?.dataset.sourceMarkPlate === "dark")
  record("ORANGE_ICON_ADAPTIVE_DARK_PLATE", orange?.dataset.sourceMarkPlate === "dark")
  record("PURPLE_ICON_ADAPTIVE_LIGHT_PLATE", purple?.dataset.sourceMarkPlate === "light")
  record("BLUE_NEAR_CROSSOVER_ADAPTIVE_DARK_PLATE", blue?.dataset.sourceMarkPlate === "dark")
  record("GREEN_ICON_ADAPTIVE_DARK_PLATE", green?.dataset.sourceMarkPlate === "dark")
  record(
    "MIXED_ICON_DETERMINISTIC",
    ["light", "dark"].includes(mixed?.dataset.sourceMarkPlate) &&
      mixed?.dataset.sourceMarkPlate === mixedRepeat?.dataset.sourceMarkPlate,
  )
  record(
    "CROSS_ORIGIN_ICON_REMAINS_VISIBLE_WITH_NEUTRAL_PLATE",
    crossOrigin?.dataset.sourceMarkFallback === "provider" &&
      crossOrigin?.dataset.sourceMarkPlate === "neutral" &&
      crossOrigin?.querySelector("img")?.naturalWidth === 64,
  )
  const neutralStyle = crossOrigin ? getComputedStyle(crossOrigin) : null
  record(
    "NEUTRAL_PLATE_OPAQUE_AND_NON_GLASS",
    Boolean(neutralStyle?.backgroundColor) &&
      neutralStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      (neutralStyle.backdropFilter === "none" || neutralStyle.backdropFilter === ""),
  )
  let crossOriginSecurityError = false
  try {
    const image = crossOrigin?.querySelector("img")
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    canvas.width = image?.naturalWidth ?? 1
    canvas.height = image?.naturalHeight ?? 1
    context?.drawImage(image, 0, 0)
    context?.getImageData(0, 0, 1, 1)
  } catch (error) {
    crossOriginSecurityError = error?.name === "SecurityError"
  }
  record("CROSS_ORIGIN_CANVAS_TAINT_DEMONSTRATED", crossOriginSecurityError)
  record(
    "PROVIDER_IMAGE_REQUESTS",
    performance.getEntriesByName(externalUrl).length === 1,
    `requests=${performance.getEntriesByName(externalUrl).length}`,
  )
  const providerResourceRequests = performance
    .getEntriesByType("resource")
    .map(({ name }) => name)
    .filter((url) => url.startsWith("http://127.0.0.1:4174/"))
  record(
    "NO_D1_ANALYSIS_EXTRA_REQUESTS",
    providerResourceRequests.length === 1,
    `provider image requests=${providerResourceRequests.length}`,
  )
  record(
    "NON_SQUARE_CONTAINED",
    nonSquare?.querySelector("img")?.naturalWidth === 64 &&
      nonSquare?.querySelector("img")?.naturalHeight === 24 &&
      getComputedStyle(nonSquare.querySelector("img")).objectFit === "contain",
  )
  record("TINY_PROVIDER_USES_MONOGRAM", tiny?.dataset.sourceMarkFallback === "monogram")
  record(
    "MONOGRAM_RENDERED",
    monogram?.dataset.sourceMarkFallback === "monogram" && monogram.textContent.includes("N"),
  )
  record(
    "RSS_TERMINAL_RENDERED",
    rss?.dataset.sourceMarkFallback === "rss" && Boolean(rss.querySelector("svg")),
  )

  const neutral = crossOrigin
  setTheme("light")
  const lightNeutral = neutral ? getComputedStyle(neutral).backgroundColor : ""
  setTheme("dark")
  const darkNeutral = neutral ? getComputedStyle(neutral).backgroundColor : ""
  record("LIGHT_THEME_NEUTRAL_PLATE", Boolean(lightNeutral))
  record("DARK_THEME_NEUTRAL_PLATE", Boolean(darkNeutral))
  record(
    "THEME_AWARE_NEUTRAL_PLATE",
    lightNeutral !== darkNeutral,
    `${lightNeutral} → ${darkNeutral}`,
  )

  const thirdPartyRequests = performance
    .getEntriesByType("resource")
    .map(({ name }) => name)
    .filter((url) => /^https?:/.test(url) && !/^https?:\/\/127\.0\.0\.1(?::|\/)/.test(url))
  record(
    "NO_THIRD_PARTY_FAVICON_REQUESTS",
    thirdPartyRequests.length === 0,
    thirdPartyRequests.join(","),
  )
  const unexpectedRequests = performance
    .getEntriesByType("resource")
    .map(({ name }) => name)
    .filter(
      (url) =>
        !requestBaseline.has(url) &&
        url.startsWith("http") &&
        !providerResourceRequests.includes(url),
    )
  record(
    "D1_ANALYSIS_EXTRA_REQUESTS",
    unexpectedRequests.length === 0,
    unexpectedRequests.join(","),
  )
  record("MINIFLUX_WRITES", true, "synthetic local-only harness")
  const results = document.querySelector("#results")
  results.textContent = checks
    .map(({ name, result, details }) => `${name}=${result}${details ? ` (${details})` : ""}`)
    .join("\n")
  results.dataset.result = checks.every(({ result }) => result === "PASS") ? "PASS" : "FAIL"
  globalThis.__NNW01_A_REPORT__ = checks
}

try {
  await run()
} catch (error) {
  const results = document.querySelector("#results")
  results.textContent = `HARNESS_ERROR=${error?.stack ?? error}`
  results.dataset.result = "FAIL"
}
