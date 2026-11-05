import { elementAtCenter, inspectPointerAtCenter } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"
import { assertQa001CenterHit } from "./support/qa001-hit-test.js"

/**
 * QA-001: with a coarse pointer the "Open sidebar" button can cover "Close article" in the reader
 * header. Viewports are ESTIMATES derived from the official physical resolutions and assumed device
 * pixel ratios (see docs/qa/FINDINGS_REGISTER.md); they are not device measurements.
 *
 * Widths inside 769-992 px reproduce the defect and are recorded as KNOWN_DEFECT; the other widths
 * are permanent guards. When the defect is fixed the known-defect cases start passing, which makes
 * them fail until their markers are removed.
 */
const VIEWPORTS = [
  { width: 466, height: 614, label: "Duo closed (DPR 3 estimate)", defect: false },
  { width: 597, height: 880, label: "Fold closed (DPR 2.09 estimate)", defect: false },
  { width: 704, height: 869, label: "Fold open (DPR 2.625 estimate)", defect: false },
  { width: 884, height: 1107, label: "Fold open / project critical viewport", defect: true },
  { width: 939, height: 1271, label: "Duo open (DPR 2 estimate)", defect: true },
  { width: 1024, height: 768, label: "tablet landscape", defect: false },
  { width: 1440, height: 900, label: "desktop with touch screen", defect: false },
]

test.describe("QA-001 Close article hit-testing with a coarse pointer", () => {
  for (const { width, height, label, defect } of VIEWPORTS) {
    test(`QA-001-${width}: [touch] Close article receives the pointer at ${width}x${height} (${label})`, async ({
      openApp,
    }) => {
      const { page } = await openApp({ path: "/all/entry/3", width, height, touch: true })
      const close = page.getByRole("button", { name: "Close article" })
      await expect(close).toBeVisible()

      const diagnostics = await inspectPointerAtCenter(close, "touch")
      await test.info().attach("qa001-center-hit.json", {
        body: Buffer.from(`${JSON.stringify(diagnostics, null, 2)}\n`),
        contentType: "application/json",
      })
      const result = assertQa001CenterHit(diagnostics, { knownDefectExpected: defect })
      if (result.state === "KNOWN_DEFECT") {
        test.info().annotations.push({ type: "known-defect", description: result.message })
      }
    })
  }

  test("QA-001-mouse: [mouse] Close article receives the pointer at 884x1107", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all/entry/3", width: 884, height: 1107 })
    const close = page.getByRole("button", { name: "Close article" })
    await expect(close).toBeVisible()

    expect(await elementAtCenter(close)).toBe("Close article")
  })
})
