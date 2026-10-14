const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 884, height: 1104 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]
const THEMES = ["light", "dark"]
const RUN_TIMEOUT_MS = 120_000
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const waitForRun = async (frame, label) => {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  let started = false
  let initialSummary
  while (Date.now() < deadline) {
    const document = frame.contentDocument
    const button = [...(document?.querySelectorAll("button") ?? [])].find((candidate) =>
      candidate.textContent.includes(label),
    )
    const summary = document?.querySelector('[data-testid="suite-summary"]')?.textContent
    if (!button) {
      await sleep(50)
      continue
    }
    if (!started) {
      initialSummary = summary
      button.click()
      started = true
      await sleep(50)
      continue
    }
    if (summary && summary !== "RUNNING" && summary !== initialSummary && summary.includes("/")) {
      const results = JSON.parse(
        document.querySelector('[data-testid="suite-results"]')?.textContent ?? "[]",
      )
      if (results.length > 0) {
        return { results, summary }
      }
    }
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${frame.title}`)
}

const runPair = async (viewport, theme) => {
  const frame = document.createElement("iframe")
  frame.title = `Home session ${viewport.width}x${viewport.height} ${theme}`
  frame.width = String(viewport.width)
  frame.height = String(viewport.height)
  frame.style.width = `${viewport.width}px`
  frame.style.height = `${viewport.height}px`
  frame.style.transform = `scale(${Math.min(1, innerWidth / viewport.width, innerHeight / viewport.height)})`
  frame.src = `/scripts/tests/phase2c-editorial-home.html?theme=${theme}`
  document.querySelector("#runs").replaceChildren(frame)
  const routeRun = await waitForRun(frame, "Run route scenario")
  const highlightRun = await waitForRun(frame, "Run Highlights scenario")
  const visualRun = await waitForRun(frame, "Run Home responsive visual gates")
  const routeFailures = routeRun.results.filter(({ status }) => status !== "PASS")
  const highlightFailures = highlightRun.results.filter(({ status }) => status !== "PASS")
  const visualFailures = visualRun.results.filter(({ status }) => status !== "PASS")
  const stability = routeRun.results.find(
    ({ name }) => name === "HOME_SESSION_STABLE_AFTER_READER_READ",
  )
  const responsive = visualRun.results.find(({ name }) => name === "HOME_RESPONSIVE_VIEWPORT_STAGE")
  const requiredVisualGates = [
    "HOME_FIRST_SECTION_CLEAR_OF_CHROME",
    "HOME_NO_OVERFLOW",
    "HOME_SECTION_HIERARCHY",
    "HOME_SECONDARY_LAYOUT",
    "HOME_RECENT_GRID",
    "HOME_LIGHT",
    "HOME_DARK",
  ]
  const missingVisualGates = requiredVisualGates.filter(
    (name) => !visualRun.results.some((result) => result.name === name),
  )
  const requiredHighlightGates = ["HOME_PRIMARY_TEXT_ONLY", "HOME_SECONDARIES_BALANCED_ORDER"]
  const missingHighlightGates = requiredHighlightGates.filter(
    (name) => !highlightRun.results.some((result) => result.name === name),
  )
  const viewportMatches =
    responsive?.metrics?.viewport?.width === viewport.width &&
    responsive?.metrics?.viewport?.height === viewport.height
  const stabilityPassed =
    stability?.readerReturn?.membershipChanged === false &&
    stability?.readerReturn?.otherEntryIdsReordered === false &&
    stability?.readerReturn?.rankingRecomposed === false &&
    stability?.readerReturn?.homeBeforeReader === stability?.readerReturn?.homeAfterReader
  return {
    viewport: `${viewport.width}x${viewport.height}`,
    theme,
    routeSummary: routeRun.summary,
    visualSummary: visualRun.summary,
    passed:
      routeFailures.length === 0 &&
      highlightFailures.length === 0 &&
      visualFailures.length === 0 &&
      missingVisualGates.length === 0 &&
      missingHighlightGates.length === 0 &&
      viewportMatches &&
      stabilityPassed,
    failed: [...routeFailures, ...highlightFailures, ...visualFailures].map(({ name, error }) => ({
      name,
      error,
    })),
    missingGates: [...missingVisualGates, ...missingHighlightGates],
    viewportMatches,
    readerReturnStable: stabilityPassed,
    readerReturn: stability?.readerReturn ?? null,
    firstSectionGap:
      visualRun.results.find(({ name }) => name === "HOME_FIRST_SECTION_CLEAR_OF_CHROME")?.metrics
        ?.firstSectionClearance?.gap ?? null,
  }
}

const results = []
try {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const result = await runPair(viewport, theme)
      results.push(result)
      document.querySelector("#matrix-status").textContent =
        `${results.length}/12 complete — ${result.viewport} ${theme}: ${result.passed ? "PASS" : "FAIL"}`
      document.querySelector("#matrix-report").textContent = JSON.stringify(results, null, 2)
    }
  }
  const failCount = results.filter(({ passed }) => !passed).length
  document.querySelector("#matrix-status").textContent =
    `EMULATED_VIEWPORT_GATE=${failCount === 0 ? "PASS" : "FAIL"} (${12 - failCount}/12)`
} catch (error) {
  document.querySelector("#matrix-status").textContent =
    `EMULATED_VIEWPORT_GATE=ERROR: ${error.message}`
}
