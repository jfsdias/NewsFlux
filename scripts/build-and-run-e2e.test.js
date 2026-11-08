import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import buildAndRunE2E from "./build-and-run-e2e.js"

const withCleanRepository = (action) => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "newsflux-e2e-build-runner-")))
  try {
    execFileSync("git", ["init", "--quiet", cwd])
    execFileSync("git", ["-C", cwd, "config", "user.name", "E2E Build Test"])
    execFileSync("git", ["-C", cwd, "config", "user.email", "e2e-build@example.invalid"])
    writeFileSync(path.join(cwd, ".gitignore"), "build/\ntest-results/\n")
    writeFileSync(path.join(cwd, "source.js"), "export const built = true\n")
    for (const directory of ["src", "scripts", "public", "docs", ".github"]) {
      mkdirSync(path.join(cwd, directory), { recursive: true })
      writeFileSync(path.join(cwd, directory, "sentinel.txt"), `${directory} sentinel\n`)
    }
    execFileSync("git", ["-C", cwd, "add", "."])
    execFileSync("git", ["-C", cwd, "commit", "--quiet", "-m", "clean source"])
    writeFileSync(path.join(cwd, ".git", "sentinel.txt"), "git sentinel\n")
    return action(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const successfulProcess = { status: 0, signal: null, error: undefined }

const buildFixture = (cwd, directory = path.join(cwd, "build")) => {
  mkdirSync(path.join(directory, "assets"), { recursive: true })
  writeFileSync(path.join(directory, "index.html"), '<script src="/assets/app.js"></script>\n')
  writeFileSync(path.join(directory, "assets", "app.js"), "window.builtFromCurrentCommit = true\n")
}

test("the wrapper builds a clean source, writes provenance, then runs the selected verified gate", () => {
  withCleanRepository((cwd) => {
    const calls = []
    const result = buildAndRunE2E({
      cwd,
      mode: "full",
      env: {},
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options })
        if (command === "pnpm") {
          buildFixture(cwd)
        }
        return successfulProcess
      },
      nodeCommand: "node-test-double",
    })

    assert.equal(result.exitCode, 0)
    assert.equal(result.stage, "e2e")
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].args, ["run", "build"])
    assert.equal(calls[0].options.env.SOURCE_COMMIT, result.sourceSha)
    assert.deepEqual(calls[1].args, ["scripts/run-verified-e2e.js"])
    assert.equal(calls[1].options.env.E2E_BUILD_DIR, path.join(cwd, "build"))
    assert.match(result.buildIntegrityDigest, /^sha256:[a-f\d]{64}$/)
  })
})

test("a failed build prevents the verified Playwright runner from starting", () => {
  withCleanRepository((cwd) => {
    const calls = []
    const result = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: (command, args) => {
        calls.push({ command, args })
        return { status: 1, signal: null }
      },
    })

    assert.equal(result.stage, "build")
    assert.equal(result.exitCode, 1)
    assert.equal(calls.length, 1)
    assert.equal(
      calls.some(({ args }) => args.includes("scripts/run-verified-e2e.js")),
      false,
    )
  })
})

test("a dirty source checkout is rejected before any build or browser process", () => {
  withCleanRepository((cwd) => {
    writeFileSync(path.join(cwd, "uncommitted.js"), "export const dirty = true\n")
    let processStarted = false

    const result = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: () => {
        processStarted = true
        return successfulProcess
      },
    })

    assert.equal(result.stage, "source-preflight")
    assert.equal(result.exitCode, 1)
    assert.equal(processStarted, false)
    assert.match(result.error, /clean Git working tree/)
  })
})

test("invalid build output prevents Playwright after a nominally successful build", () => {
  withCleanRepository((cwd) => {
    let runnerStarted = false
    const result = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: (command, args) => {
        if (command === "pnpm") {
          buildFixture(cwd)
          symlinkSync("index.html", path.join(cwd, "build", "assets", "mixed.js"))
        } else {
          runnerStarted = true
        }
        return successfulProcess
      },
    })

    assert.equal(result.stage, "build-provenance")
    assert.equal(result.exitCode, 1)
    assert.equal(runnerStarted, false)
    assert.match(result.error, /symbolic link/)
  })
})

test("a checkout changed while the build is running cannot receive a current-SHA receipt", () => {
  withCleanRepository((cwd) => {
    let runnerStarted = false
    const result = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: (command, args) => {
        if (command === "pnpm") {
          buildFixture(cwd)
          writeFileSync(path.join(cwd, "source.js"), "export const built = false\n")
        } else {
          runnerStarted = true
        }
        return successfulProcess
      },
    })

    assert.equal(result.stage, "build-provenance")
    assert.equal(result.exitCode, 1)
    assert.equal(runnerStarted, false)
    assert.match(result.error, /working tree must be clean/)
  })
})

test("unsafe build destinations block before processes and preserve all sentinel files", () => {
  withCleanRepository((cwd) => {
    const safeOutputRoot = path.join(cwd, "test-results", "e2e-builds")
    mkdirSync(safeOutputRoot, { recursive: true })

    const externalDirectory = path.join(path.dirname(cwd), `${path.basename(cwd)}-external`)
    mkdirSync(externalDirectory, { recursive: true })
    const externalSentinel = path.join(externalDirectory, "sentinel.txt")
    writeFileSync(externalSentinel, "external sentinel\n")

    const parentSentinel = path.join(path.dirname(cwd), `${path.basename(cwd)}-parent-sentinel.txt`)
    writeFileSync(parentSentinel, "parent sentinel\n")

    const symlinkToRoot = path.join(safeOutputRoot, "root-link")
    const symlinkToExternal = path.join(safeOutputRoot, "external-link")
    symlinkSync(cwd, symlinkToRoot, "dir")
    symlinkSync(externalDirectory, symlinkToExternal, "dir")

    const unknownOutput = path.join(safeOutputRoot, "unrecognized")
    mkdirSync(unknownOutput, { recursive: true })
    const unknownSentinel = path.join(unknownOutput, "keep-me.txt")
    writeFileSync(unknownSentinel, "unrecognized output sentinel\n")

    const protectedSentinels = [
      path.join(cwd, "source.js"),
      path.join(cwd, "src", "sentinel.txt"),
      path.join(cwd, "scripts", "sentinel.txt"),
      path.join(cwd, "public", "sentinel.txt"),
      path.join(cwd, "docs", "sentinel.txt"),
      path.join(cwd, ".github", "sentinel.txt"),
      path.join(cwd, ".git", "sentinel.txt"),
      externalSentinel,
      parentSentinel,
      unknownSentinel,
    ]
    const before = new Map(protectedSentinels.map((file) => [file, readFileSync(file)]))
    const invalidDestinations = [
      ["repository root", cwd],
      ["repository parent", path.dirname(cwd)],
      ["source directory", path.join(cwd, "src")],
      ["scripts directory", path.join(cwd, "scripts")],
      ["public directory", path.join(cwd, "public")],
      ["Git directory", path.join(cwd, ".git")],
      ["documentation directory", path.join(cwd, "docs")],
      ["configuration directory", path.join(cwd, ".github")],
      ["absolute external directory", externalDirectory],
      ["symlink to repository root", symlinkToRoot],
      ["symlink to external directory", symlinkToExternal],
      ["traversal to protected source", "test-results/e2e-builds/../../src"],
      ["output containing unrecognized files", unknownOutput],
    ]

    try {
      for (const [label, destination] of invalidDestinations) {
        let processStarts = 0
        const result = buildAndRunE2E({
          cwd,
          env: { E2E_BUILD_DIR: destination },
          spawnImpl: () => {
            processStarts += 1
            return { status: 1, signal: null }
          },
        })

        assert.equal(result.exitCode, 1, label)
        assert.equal(result.stage, "output-directory", label)
        assert.equal(processStarts, 0, label)
        assert.match(result.error, /output directory|build directory/i, label)
        for (const [file, contents] of before) {
          assert.deepEqual(readFileSync(file), contents, `${label}: ${file} changed`)
        }
      }
    } finally {
      rmSync(externalDirectory, { recursive: true, force: true })
      rmSync(parentSentinel, { force: true })
    }
  })
})

test("an alternate E2E_BUILD_DIR is built and receipted under the same source contract", () => {
  withCleanRepository((cwd) => {
    const alternate = path.join(cwd, "test-results", "e2e-builds", "candidate")
    mkdirSync(alternate, { recursive: true })
    const calls = []
    const result = buildAndRunE2E({
      cwd,
      env: { E2E_BUILD_DIR: alternate },
      mode: "stability",
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options })
        if (args.includes("vite")) {
          buildFixture(cwd, alternate)
        }
        return successfulProcess
      },
      nodeCommand: "node-test-double",
    })

    assert.equal(result.exitCode, 0)
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[0].args, ["run", "prebuild"])
    assert.equal(calls[0].options.env.SOURCE_COMMIT, result.sourceSha)
    assert.equal(calls[1].args[0], "exec")
    assert.equal(calls[1].args[1], "vite")
    assert.deepEqual(calls[1].args.slice(2), ["build", "--emptyOutDir", "--outDir", alternate])
    assert.deepEqual(calls[2].args, ["scripts/run-e2e-stability.js"])
    assert.equal(calls[2].options.env.E2E_BUILD_DIR, alternate)

    const repeatCalls = []
    const repeated = buildAndRunE2E({
      cwd,
      env: { E2E_BUILD_DIR: alternate },
      mode: "full",
      spawnImpl: (command, args, options) => {
        repeatCalls.push({ command, args, options })
        if (args.includes("vite")) {
          buildFixture(cwd, alternate)
        }
        return successfulProcess
      },
      nodeCommand: "node-test-double",
    })
    assert.equal(repeated.exitCode, 0)
    assert.equal(repeatCalls.length, 3)
    assert.deepEqual(repeatCalls[2].args, ["scripts/run-verified-e2e.js"])
  })
})

test("modified files in a previously receipted build block replacement before any process", () => {
  withCleanRepository((cwd) => {
    const initialBuild = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: (command) => {
        if (command === "pnpm") {
          buildFixture(cwd)
        }
        return successfulProcess
      },
      nodeCommand: "node-test-double",
    })
    assert.equal(initialBuild.exitCode, 0)

    const sentinel = path.join(cwd, "build", "unexpected-user-data.txt")
    writeFileSync(sentinel, "do not clear\n")
    let processStarts = 0
    const result = buildAndRunE2E({
      cwd,
      env: {},
      spawnImpl: () => {
        processStarts += 1
        return successfulProcess
      },
    })

    assert.equal(result.exitCode, 1)
    assert.equal(result.stage, "output-directory")
    assert.equal(processStarts, 0)
    assert.equal(readFileSync(sentinel, "utf8"), "do not clear\n")
    assert.match(result.error, /output directory gate/i)
  })
})
