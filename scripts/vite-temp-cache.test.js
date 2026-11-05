import assert from "node:assert/strict"
import { existsSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import createViteTempCache from "./vite-temp-cache.js"

test("Vite test caches use unique OS temp directories and clean only their own directory", () => {
  const first = createViteTempCache("newsflux-nnw01-a-vite-cache")
  const second = createViteTempCache("newsflux-nnw01-b-vite-cache")

  try {
    assert.notEqual(first.cacheDir, second.cacheDir)
    assert.equal(path.dirname(first.cacheDir), os.tmpdir())
    assert.equal(path.dirname(second.cacheDir), os.tmpdir())

    const firstMarker = path.join(first.cacheDir, "owned-marker")
    const secondMarker = path.join(second.cacheDir, "owned-marker")
    writeFileSync(firstMarker, "first")
    writeFileSync(secondMarker, "second")

    assert.equal(first.cleanup(), true)
    assert.equal(first.cleanup(), false, "cleanup is idempotent")
    assert.equal(existsSync(first.cacheDir), false)
    assert.equal(existsSync(secondMarker), true, "cleanup cannot remove another process cache")
  } finally {
    first.cleanup()
    second.cleanup()
  }
})
