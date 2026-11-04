import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/** Creates a process-owned Vite cache beneath the current platform's temp directory. */
const createViteTempCache = (prefix) => {
  if (typeof prefix !== "string" || !/^[a-z0-9-]+$/i.test(prefix)) {
    throw new TypeError(
      "Vite temporary cache prefix must contain only letters, digits, and hyphens",
    )
  }

  const cacheDir = mkdtempSync(path.join(tmpdir(), `${prefix}-`))
  let cleaned = false

  return {
    cacheDir,
    cleanup() {
      if (cleaned) {
        return false
      }
      rmSync(cacheDir, { recursive: true, force: true })
      cleaned = true
      return true
    },
  }
}

export default createViteTempCache
