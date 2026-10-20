import assert from "node:assert/strict"
import test from "node:test"

const windowClassModule = await import(new URL("window-class.js", import.meta.url))
const { classifyWindowClass, isCompactClass, isDesktopClass, isMediumClass, WINDOW_CLASSES } =
  windowClassModule

test("WINDOW-CLASS: frozen constants integrity", () => {
  assert.equal(WINDOW_CLASSES.COMPACT, "COMPACT")
  assert.equal(WINDOW_CLASSES.MEDIUM, "MEDIUM")
  assert.equal(WINDOW_CLASSES.DESKTOP, "DESKTOP")
  assert.throws(() => {
    WINDOW_CLASSES.EXPANDED = "EXPANDED"
  })
})

test("WINDOW-CLASS: required boundary gates", () => {
  // 599x480 => COMPACT (width < 600 && height >= 480)
  assert.equal(classifyWindowClass(599, 480), WINDOW_CLASSES.COMPACT)
  assert.equal(classifyWindowClass({ width: 599, height: 480 }), WINDOW_CLASSES.COMPACT)

  // 599x479 => MEDIUM (width < 600 && height < 480)
  assert.equal(classifyWindowClass(599, 479), WINDOW_CLASSES.MEDIUM)
  assert.equal(classifyWindowClass({ width: 599, height: 479 }), WINDOW_CLASSES.MEDIUM)

  // 600x480 => MEDIUM (600 <= width < 993)
  assert.equal(classifyWindowClass(600, 480), WINDOW_CLASSES.MEDIUM)
  assert.equal(classifyWindowClass({ width: 600, height: 480 }), WINDOW_CLASSES.MEDIUM)

  // 992x1104 => MEDIUM (600 <= width < 993)
  assert.equal(classifyWindowClass(992, 1104), WINDOW_CLASSES.MEDIUM)
  assert.equal(classifyWindowClass({ width: 992, height: 1104 }), WINDOW_CLASSES.MEDIUM)

  // 993x1104 => DESKTOP (width >= 993)
  assert.equal(classifyWindowClass(993, 1104), WINDOW_CLASSES.DESKTOP)
  assert.equal(classifyWindowClass({ width: 993, height: 1104 }), WINDOW_CLASSES.DESKTOP)

  // 884x1104 => MEDIUM (Fold unfolded portrait)
  assert.equal(classifyWindowClass(884, 1104), WINDOW_CLASSES.MEDIUM)
  assert.equal(classifyWindowClass({ width: 884, height: 1104 }), WINDOW_CLASSES.MEDIUM)
})

test("WINDOW-CLASS: common device profiles matrix", () => {
  // 390x844 => COMPACT (standard mobile portrait)
  assert.equal(classifyWindowClass(390, 844), WINDOW_CLASSES.COMPACT)
  assert.ok(isCompactClass(classifyWindowClass(390, 844)))

  // 390x400 => MEDIUM (short height mobile landscape)
  assert.equal(classifyWindowClass(390, 400), WINDOW_CLASSES.MEDIUM)
  assert.ok(isMediumClass(classifyWindowClass(390, 400)))

  // 768x1024 => MEDIUM (tablet portrait)
  assert.equal(classifyWindowClass(768, 1024), WINDOW_CLASSES.MEDIUM)
  assert.ok(isMediumClass(classifyWindowClass(768, 1024)))

  // 900x900 => MEDIUM (square fold / small desktop window)
  assert.equal(classifyWindowClass(900, 900), WINDOW_CLASSES.MEDIUM)
  assert.ok(isMediumClass(classifyWindowClass(900, 900)))

  // 1280x800 => DESKTOP (laptop / monitor)
  assert.equal(classifyWindowClass(1280, 800), WINDOW_CLASSES.DESKTOP)
  assert.ok(isDesktopClass(classifyWindowClass(1280, 800)))
})
