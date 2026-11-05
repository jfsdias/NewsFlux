import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- keep the generic fail-closed classifier matcher covered after QA-001 closes.
import { matchesFailureSignature } from "#e2e/support/classification.js"
// eslint-disable-next-line import/no-relative-parent-imports -- QA classification is shared with the E2E suite through the package import map.
import { assertQa001CenterHit, classifyQa001CenterHit } from "#e2e/support/qa001-hit-test.js"

const readerAndStateSource = readFileSync(
  new URL("../e2e/reader-and-state.spec.js", import.meta.url),
  "utf8",
)
const qa001Source = readFileSync(
  new URL("../e2e/qa-001-reader-header.spec.js", import.meta.url),
  "utf8",
)
const startupSource = readFileSync(
  new URL("../e2e/startup-and-feed.spec.js", import.meta.url),
  "utf8",
)
const appHelpersSource = readFileSync(new URL("../e2e/support/app.js", import.meta.url), "utf8")

const diagnostic = (overrides = {}) => ({
  viewport: { width: 884, height: 1107 },
  inputMode: "touch",
  closeButton: {
    accessibleName: "Close article",
    rect: { x: 4, y: 12, width: 48, height: 48 },
  },
  center: { x: 28, y: 36 },
  hitTarget: { tagName: "BUTTON", role: "button", accessibleName: "Open sidebar" },
  hitTargetIsCloseArticle: false,
  nearestInterceptingButton: {
    tagName: "BUTTON",
    role: "button",
    accessibleName: "Open sidebar",
  },
  elementsAtCenter: [
    { tagName: "BUTTON", role: "button", accessibleName: "Open sidebar", isCloseArticle: false },
    {
      tagName: "BUTTON",
      role: "button",
      accessibleName: "Close article",
      isCloseArticle: true,
    },
  ],
  ...overrides,
})

test("failure signatures distinguish the recorded defect from unrelated failures", () => {
  const qa001Signature = /hitTarget=Open sidebar ended at \/all\/entry\/\d+/

  assert.equal(
    matchesFailureSignature(
      new Error("QA-001 actual touch with hitTarget=Open sidebar ended at /all/entry/42"),
      qa001Signature,
    ),
    true,
  )
  assert.equal(
    matchesFailureSignature(
      new Error("QA-001 actual touch with hitTarget=Close article ended at /all/entry/42"),
      qa001Signature,
    ),
    false,
  )
})

test("QA-001 recognizes a demonstrated Open sidebar interception with structured evidence", () => {
  const result = classifyQa001CenterHit(diagnostic(), { knownDefectExpected: true })

  assert.equal(result.state, "KNOWN_DEFECT")
  assert.equal(result.evidence.hitTarget.accessibleName, "Open sidebar")
  assert.equal(result.evidence.nearestInterceptingButton.accessibleName, "Open sidebar")
  assert.ok(result.evidence.elementsAtCenter.some((element) => element.isCloseArticle))
})

test("a close-button center hit is a pass after the QA-001 marker is removed", () => {
  const resolved = diagnostic({
    hitTarget: { tagName: "BUTTON", role: "button", accessibleName: "Close article" },
    hitTargetIsCloseArticle: true,
    nearestInterceptingButton: {
      tagName: "BUTTON",
      role: "button",
      accessibleName: "Close article",
    },
    elementsAtCenter: [
      {
        tagName: "BUTTON",
        role: "button",
        accessibleName: "Close article",
        isCloseArticle: true,
      },
    ],
  })

  const result = classifyQa001CenterHit(resolved)

  assert.equal(result.state, "PASSED")
  assert.equal(result.message, "Close article received its center")
})

test("an unrelated element intercepting Close article remains an unexpected failure", () => {
  const unrelated = diagnostic({
    hitTarget: { tagName: "BUTTON", role: "button", accessibleName: "Refresh" },
    nearestInterceptingButton: {
      tagName: "BUTTON",
      role: "button",
      accessibleName: "Refresh",
    },
  })

  const result = classifyQa001CenterHit(unrelated, { knownDefectExpected: true })

  assert.equal(result.state, "FAILED")
  assert.match(result.message, /unexpected hit target/i)
  assert.match(result.message, /"Refresh"/)
})

test("missing or invalid hit-target evidence cannot be classified as a known defect", () => {
  for (const missing of [
    diagnostic({ hitTarget: null }),
    diagnostic({ center: { x: Number.NaN, y: 36 } }),
    diagnostic({ elementsAtCenter: [] }),
  ]) {
    const result = classifyQa001CenterHit(missing, { knownDefectExpected: true })

    assert.equal(result.state, "FAILED")
    assert.match(result.message, /missing or invalid hit-test evidence/i)
  }
})

test("QA-001 failure classifications are thrown to Playwright rather than swallowed", () => {
  const unrelated = diagnostic({
    hitTarget: { tagName: "BUTTON", role: "button", accessibleName: "Refresh" },
    nearestInterceptingButton: {
      tagName: "BUTTON",
      role: "button",
      accessibleName: "Refresh",
    },
  })

  assert.throws(
    () => assertQa001CenterHit(unrelated, { knownDefectExpected: true }),
    /unexpected hit target.*Refresh/i,
  )
})

test("QA-001 browser scenarios attach structured hit-test evidence from the DOM", () => {
  assert.match(qa001Source, /inspectPointerAtCenter\(close, "touch"\)/)
  assert.match(qa001Source, /assertQa001CenterHit\(diagnostics/)
  assert.match(qa001Source, /test\.info\(\)\.attach\("qa001-center-hit\.json"/)
  assert.match(appHelpersSource, /document\.elementFromPoint\(/)
  assert.match(appHelpersSource, /document\.elementsFromPoint\(/)
  const coarsePointerStart = qa001Source.indexOf('test.describe("QA-001 Close')
  const mouseGuardStart = qa001Source.indexOf('test("QA-001-mouse:')
  const coarsePointerCases = qa001Source.slice(coarsePointerStart, mouseGuardStart)
  assert.doesNotMatch(coarsePointerCases, /knownDefect\(/)
  assert.match(coarsePointerCases, /page\.touchscreen\.tap\(x, y\)/)
  assert.match(coarsePointerCases, /await expect\(page\)\.toHaveURL\(\/\\\/all\$\//)
})

test("QA-001 touch scenarios assert the corrected route without expected-failure markers", () => {
  const f02 = startupSource.split('test("F02-2:', 2)[1]?.split('test("F02-3:', 2)[0] ?? ""
  const f04 =
    readerAndStateSource
      .split('test.describe("F04 Opening', 2)[1]
      ?.split('test.describe("F05', 2)[0] ?? ""

  assert.doesNotMatch(f02, /knownDefect\(/)
  assert.match(f02, /page\.touchscreen\.tap\(closeCenter\.x, closeCenter\.y\)/)
  assert.match(f02, /toHaveURL\(\/\\\/all\$\//)
  assert.doesNotMatch(f04, /knownDefect\(/)
  assert.match(f04, /page\.touchscreen\.tap\(closeCenter\.x, closeCenter\.y\)/)
  assert.match(f04, /page\.touchscreen\.tap\(x, y\)/)
})

test("F04-3 records the center hit and observes the actual touch result", () => {
  const f04 =
    readerAndStateSource.split('test("F04-3:', 2)[1]?.split('test.describe("F05', 2)[0] ?? ""
  const hitTargetMeasurement = f04.indexOf("const hitTarget = await elementAtCenter")
  const action = f04.indexOf("const tapCenterAndVerifyClose = async")
  const touch = f04.indexOf("page.touchscreen.tap(x, y)")
  const routeObservation = f04.indexOf("routeAfterTouch")
  const readerObservation = f04.indexOf("readerStillVisible")

  assert.ok(hitTargetMeasurement !== -1, "F04-3 must record the intercepting hit target")
  assert.ok(action > hitTargetMeasurement, "the hit target must precede the touch action")
  assert.ok(touch > action, "F04-3 must execute a real touchscreen tap")
  assert.ok(routeObservation > touch, "the actual route after touch must be observed")
  assert.ok(readerObservation > touch, "the reader state after touch must be observed")
  assert.match(f04, /expect\(hitTarget\)\.toBe\("Close article"\)/)
  assert.doesNotMatch(f04, /knownDefect\(/)
})
