import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  sanitizeE2EDiagnostic,
  verifyBuildProvenance,
  writeBuildProvenance,
} from "./e2e-provenance.js"
import runVerifiedE2E from "./verified-e2e.js"

const withGitRepository = (action) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "newsflux-e2e-provenance-"))
  const buildDir = path.join(cwd, "build")

  try {
    execFileSync("git", ["init", "--quiet", cwd])
    execFileSync("git", ["-C", cwd, "config", "user.name", "E2E Provenance Test"])
    execFileSync("git", ["-C", cwd, "config", "user.email", "e2e-provenance@example.invalid"])
    writeFileSync(path.join(cwd, ".gitignore"), "build/\ntest-results/\n")
    writeFileSync(path.join(cwd, "source.js"), "export const revision = 1\n")
    execFileSync("git", ["-C", cwd, "add", "."])
    execFileSync("git", ["-C", cwd, "commit", "--quiet", "-m", "baseline"])
    mkdirSync(path.join(buildDir, "assets"), { recursive: true })
    writeFileSync(path.join(buildDir, "index.html"), '<script src="/assets/app.js"></script>\n')
    writeFileSync(path.join(buildDir, "assets", "app.js"), "console.log('one')\n")
    return action({ cwd, buildDir })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const makeFreshBuildReceipt = ({ cwd, buildDir }) => writeBuildProvenance({ cwd, buildDir })

test("diagnostic summaries redact authorization, cookie, and credential values", () => {
  const diagnostic = sanitizeE2EDiagnostic(
    'Authorization: Bearer bearer-secret; Cookie: session=cookie-secret; {"apiKey":"key-secret","password":"password-secret"} token=query-secret',
  )

  assert.doesNotMatch(
    diagnostic,
    /bearer-secret|cookie-secret|key-secret|password-secret|query-secret/,
  )
  assert.ok((diagnostic.match(/\[REDACTED\]/g) ?? []).length >= 5)
})

test("a clean committed source and every build file are bound by a deterministic receipt", () => {
  withGitRepository(({ cwd, buildDir }) => {
    const firstReceipt = makeFreshBuildReceipt({ cwd, buildDir })
    const firstValidation = verifyBuildProvenance({ cwd, buildDir })

    assert.equal(firstValidation.valid, true, firstValidation.problems.join("\n"))
    assert.equal(
      firstReceipt.source.sha,
      execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    )
    assert.equal(firstReceipt.source.dirtyState, "clean")
    assert.equal(firstReceipt.build.fileCount, 2)
    assert.match(firstReceipt.build.integrityDigest, /^sha256:[a-f\d]{64}$/)

    const secondValidation = verifyBuildProvenance({ cwd, buildDir })
    assert.deepEqual(secondValidation.provenance, firstValidation.provenance)
  })
})

test("a build from an older source SHA is blocked", () => {
  withGitRepository(({ cwd, buildDir }) => {
    makeFreshBuildReceipt({ cwd, buildDir })
    writeFileSync(path.join(cwd, "source.js"), "export const revision = 2\n")
    execFileSync("git", ["-C", cwd, "add", "source.js"])
    execFileSync("git", ["-C", cwd, "commit", "--quiet", "-m", "new source"])

    const validation = verifyBuildProvenance({ cwd, buildDir })

    assert.equal(validation.valid, false)
    assert.match(validation.problems.join("\n"), /source SHA/i)
  })
})

test("an asset changed after the receipt is blocked by the whole-build digest", () => {
  withGitRepository(({ cwd, buildDir }) => {
    makeFreshBuildReceipt({ cwd, buildDir })
    writeFileSync(path.join(buildDir, "assets", "app.js"), "console.log('changed')\n")

    const validation = verifyBuildProvenance({ cwd, buildDir })

    assert.equal(validation.valid, false)
    assert.match(validation.problems.join("\n"), /integrity digest/i)
  })
})

test("a mixed build containing a file from another revision is blocked", () => {
  withGitRepository(({ cwd, buildDir }) => {
    makeFreshBuildReceipt({ cwd, buildDir })
    writeFileSync(path.join(buildDir, "assets", "stale-chunk.js"), "window.oldBuild = true\n")

    const validation = verifyBuildProvenance({ cwd, buildDir })

    assert.equal(validation.valid, false)
    assert.match(validation.problems.join("\n"), /integrity digest|file count/i)
  })
})

test("missing and malformed receipts fail closed", () => {
  withGitRepository(({ cwd, buildDir }) => {
    const missing = verifyBuildProvenance({ cwd, buildDir })
    assert.equal(missing.valid, false)
    assert.match(missing.problems.join("\n"), /receipt.*missing/i)

    writeFileSync(path.join(buildDir, "e2e-build-provenance.json"), "{not-json")
    const malformed = verifyBuildProvenance({ cwd, buildDir })
    assert.equal(malformed.valid, false)
    assert.match(malformed.problems.join("\n"), /receipt.*valid JSON/i)
  })
})

test("dirty source cannot receive a receipt or validate an older one", () => {
  withGitRepository(({ cwd, buildDir }) => {
    makeFreshBuildReceipt({ cwd, buildDir })
    writeFileSync(path.join(cwd, "source.js"), "export const revision = 2\n")

    const validation = verifyBuildProvenance({ cwd, buildDir })

    assert.equal(validation.valid, false)
    assert.match(validation.problems.join("\n"), /working tree.*clean/i)
    assert.throws(() => writeBuildProvenance({ cwd, buildDir }), /working tree.*clean/i)
  })
})

test("E2E_BUILD_DIR uses the same receipt and integrity rules", () => {
  withGitRepository(({ cwd, buildDir }) => {
    const alternateBuildDir = path.join(cwd, "out", "candidate")
    mkdirSync(path.join(alternateBuildDir, "assets"), { recursive: true })
    writeFileSync(path.join(alternateBuildDir, "index.html"), "<main>candidate</main>\n")
    writeFileSync(path.join(alternateBuildDir, "assets", "app.js"), "window.candidate = true\n")
    makeFreshBuildReceipt({ cwd, buildDir: alternateBuildDir })

    const valid = verifyBuildProvenance({ cwd, buildDir: alternateBuildDir })
    assert.equal(valid.valid, true, valid.problems.join("\n"))

    writeFileSync(path.join(alternateBuildDir, "assets", "app.js"), "window.candidate = false\n")
    const invalid = verifyBuildProvenance({ cwd, buildDir: alternateBuildDir })
    assert.equal(invalid.valid, false)
    assert.match(invalid.problems.join("\n"), /integrity digest/i)
  })
})

test("the verified executor never starts Playwright when the build receipt is absent", () => {
  withGitRepository(({ cwd }) => {
    const outputRoot = path.join(cwd, "test-results", "verified-e2e")
    let playwrightStarted = false

    const result = runVerifiedE2E({
      cwd,
      outputRoot,
      expectedScenarios: [{ id: "A", state: "PASSED" }],
      spawnImpl: () => {
        playwrightStarted = true
        return { status: 0, signal: null }
      },
    })

    assert.equal(playwrightStarted, false)
    assert.equal(result.verified, false)
    assert.match(result.problems.join("\n"), /provenance|receipt/i)
    assert.ok(existsSync(path.join(result.outputDirectory, "summary.json")))
    assert.equal(
      JSON.parse(readFileSync(path.join(result.outputDirectory, "summary.json"), "utf8")).verified,
      false,
    )
  })
})

test("the verified executor never starts for stale, altered, mixed, malformed, or dirty provenance", () => {
  const invalidStates = [
    [
      "old source SHA",
      ({ cwd }) => {
        writeFileSync(path.join(cwd, "source.js"), "export const revision = 2\n")
        execFileSync("git", ["-C", cwd, "add", "source.js"])
        execFileSync("git", ["-C", cwd, "commit", "--quiet", "-m", "next source"])
      },
    ],
    [
      "altered asset",
      ({ buildDir }) => {
        writeFileSync(path.join(buildDir, "assets", "app.js"), "console.log('tampered')\n")
      },
    ],
    [
      "mixed asset set",
      ({ buildDir }) => {
        writeFileSync(path.join(buildDir, "assets", "other-build.js"), "window.otherBuild = true\n")
      },
    ],
    [
      "malformed receipt",
      ({ buildDir }) => {
        writeFileSync(path.join(buildDir, "e2e-build-provenance.json"), "not json")
      },
    ],
    [
      "dirty checkout",
      ({ cwd }) => {
        writeFileSync(path.join(cwd, "uncommitted.js"), "export const local = true\n")
      },
    ],
  ]

  for (const [label, invalidate] of invalidStates) {
    withGitRepository(({ cwd, buildDir }) => {
      makeFreshBuildReceipt({ cwd, buildDir })
      invalidate({ cwd, buildDir })
      let playwrightStarted = false
      const result = runVerifiedE2E({
        cwd,
        outputRoot: path.join(cwd, "test-results", "verified-e2e"),
        expectedScenarios: [{ id: "A", state: "PASSED" }],
        runtimeMetadataImpl: () => ({
          nodeVersion: "v22.22.0",
          pnpmVersion: "11.21.0",
          playwrightVersion: "1.63.0",
          chromiumVersionOrRevision: "Chromium test",
          platform: "test",
        }),
        spawnImpl: () => {
          playwrightStarted = true
          return { status: 0, signal: null }
        },
      })

      assert.equal(playwrightStarted, false, label)
      assert.equal(result.verified, false, label)
      assert.match(result.problems.join("\n"), /provenance preflight/i, label)
    })
  }
})
