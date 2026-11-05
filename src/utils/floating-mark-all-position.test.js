import assert from "node:assert/strict"
import test from "node:test"

const {
  clampFloatingPosition,
  createFloatingPositionBounds,
  denormalizeFloatingPosition,
  normalizeFloatingPosition,
  parseFloatingPositionPreference,
} = await import(new URL("floating-mark-all-position.js", import.meta.url))

test("floating Mark All bounds preserve safe areas and compact navigation clearance", () => {
  const bounds = createFloatingPositionBounds({
    viewportWidth: 390,
    viewportHeight: 844,
    controlWidth: 48,
    controlHeight: 48,
    safeArea: { top: 12, right: 10, bottom: 24, left: 8 },
    bottomReserved: 56,
  })

  assert.deepEqual(bounds, { maxX: 320, maxY: 704, minX: 20, minY: 24 })
})

test("floating Mark All clamps both axes after a drag or viewport resize", () => {
  const bounds = createFloatingPositionBounds({
    viewportWidth: 390,
    viewportHeight: 500,
    controlWidth: 48,
    controlHeight: 48,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    bottomReserved: 56,
  })

  assert.deepEqual(clampFloatingPosition({ x: 4000, y: 4000 }, bounds), {
    x: bounds.maxX,
    y: bounds.maxY,
  })
  assert.deepEqual(clampFloatingPosition({ x: -100, y: -100 }, bounds), {
    x: bounds.minX,
    y: bounds.minY,
  })
})

test("normalized floating Mark All positions survive viewport changes without escaping bounds", () => {
  const originalBounds = createFloatingPositionBounds({
    viewportWidth: 884,
    viewportHeight: 1107,
    controlWidth: 48,
    controlHeight: 48,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    bottomReserved: 0,
  })
  const position = { x: originalBounds.maxX, y: originalBounds.minY }
  const normalized = normalizeFloatingPosition(position, originalBounds)
  const resizedBounds = createFloatingPositionBounds({
    viewportWidth: 466,
    viewportHeight: 500,
    controlWidth: 48,
    controlHeight: 48,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    bottomReserved: 56,
  })

  assert.deepEqual(normalized, { x: 1, y: 0 })
  assert.deepEqual(denormalizeFloatingPosition(normalized, resizedBounds), {
    x: resizedBounds.maxX,
    y: resizedBounds.minY,
  })
})

test("normalized position conversion handles a viewport with no available travel", () => {
  const bounds = { maxX: 12, maxY: 12, minX: 12, minY: 12 }

  assert.deepEqual(normalizeFloatingPosition({ x: 40, y: -1 }, bounds), { x: 0, y: 0 })
  assert.deepEqual(denormalizeFloatingPosition({ x: 1, y: 1 }, bounds), { x: 12, y: 12 })
})

test("stored position preferences reject malformed or outdated values", () => {
  assert.equal(parseFloatingPositionPreference("not-json"), null)
  assert.equal(parseFloatingPositionPreference('{"version":2,"x":0.5,"y":0.5}'), null)
  assert.equal(parseFloatingPositionPreference('{"version":1,"x":"0.5","y":0.5}'), null)
  assert.deepEqual(parseFloatingPositionPreference('{"version":1,"x":2,"y":-1}'), {
    x: 1,
    y: 0,
  })
})
