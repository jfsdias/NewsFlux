import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  readSourceSnapshot,
  resolveBuildDirectory,
  sanitizeE2EDiagnostic,
  verifyBuildProvenance,
  writeBuildProvenance,
} from "./e2e-provenance.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const processSucceeded = (result) =>
  result && !result.error && result.status === 0 && result.signal === null

/** Builds from a clean source snapshot, writes its receipt, then invokes one verified E2E runner. */
const buildAndRunE2E = ({
  cwd = repositoryRoot,
  env = process.env,
  mode = "full",
  spawnImpl = spawnSync,
  packageManagerCommand = "pnpm",
  nodeCommand = process.execPath,
} = {}) => {
  if (mode !== "full" && mode !== "stability") {
    return { exitCode: 1, stage: "arguments", error: "E2E mode must be full or stability" }
  }

  const buildDirectory = resolveBuildDirectory(cwd, env.E2E_BUILD_DIR)
  let initialSource
  try {
    initialSource = readSourceSnapshot(cwd, { buildDir: buildDirectory })
  } catch {
    return {
      exitCode: 1,
      stage: "source-preflight",
      error: "Could not identify the Git source checkout",
    }
  }
  if (initialSource.dirtyState !== "clean") {
    return {
      exitCode: 1,
      stage: "source-preflight",
      error: `Verified E2E requires a clean Git working tree; found ${initialSource.dirtyPathCount} changed paths outside the build directory. Commit the intended test state or clean the checkout first.`,
    }
  }

  const buildEnv = { ...env, SOURCE_COMMIT: initialSource.sha }
  const buildResult = env.E2E_BUILD_DIR
    ? (() => {
        const prebuild = spawnImpl(packageManagerCommand, ["run", "prebuild"], {
          cwd,
          stdio: "inherit",
          env: buildEnv,
        })
        if (!processSucceeded(prebuild)) {
          return prebuild
        }
        return spawnImpl(
          packageManagerCommand,
          ["exec", "vite", "build", "--emptyOutDir", "--outDir", buildDirectory],
          { cwd, stdio: "inherit", env: buildEnv },
        )
      })()
    : spawnImpl(packageManagerCommand, ["run", "build"], {
        cwd,
        stdio: "inherit",
        env: buildEnv,
      })

  if (!processSucceeded(buildResult)) {
    return {
      exitCode: buildResult?.status ?? 1,
      stage: "build",
      error: sanitizeE2EDiagnostic(
        buildResult?.error?.message ??
          `E2E build failed with exit code ${String(buildResult?.status)}`,
      ),
    }
  }

  let buildReceipt
  try {
    buildReceipt = writeBuildProvenance({
      cwd,
      buildDir: buildDirectory,
      expectedSourceSnapshot: initialSource,
    })
  } catch (error) {
    return { exitCode: 1, stage: "build-provenance", error: sanitizeE2EDiagnostic(error.message) }
  }

  const validation = verifyBuildProvenance({ cwd, buildDir: buildDirectory })
  if (!validation.valid) {
    return {
      exitCode: 1,
      stage: "build-provenance",
      error: sanitizeE2EDiagnostic(validation.problems.join("; ")),
    }
  }
  if (
    validation.provenance.sourceSha !== initialSource.sha ||
    validation.provenance.buildIntegrityDigest !== buildReceipt.build.integrityDigest
  ) {
    return {
      exitCode: 1,
      stage: "build-provenance",
      error: "The build receipt does not match the source snapshot and output just built",
    }
  }

  const runner =
    mode === "stability" ? "scripts/run-e2e-stability.js" : "scripts/run-verified-e2e.js"
  const runResult = spawnImpl(nodeCommand, [runner], {
    cwd,
    stdio: "inherit",
    env: { ...env, E2E_BUILD_DIR: buildDirectory },
  })

  return {
    exitCode: runResult?.status ?? 1,
    stage: "e2e",
    error: runResult?.error?.message ? sanitizeE2EDiagnostic(runResult.error.message) : null,
    sourceSha: initialSource.sha,
    buildIntegrityDigest: buildReceipt.build.integrityDigest,
    buildFileCount: buildReceipt.build.fileCount,
  }
}

export default buildAndRunE2E

const main = () => {
  const mode = process.argv.includes("--stability") ? "stability" : "full"
  const result = buildAndRunE2E({ mode })
  if (result.error) {
    console.error(`E2E ${result.stage} gate blocked: ${result.error}`)
  }
  if (result.sourceSha) {
    console.log(
      `E2E build provenance: ${JSON.stringify({
        sourceSha: result.sourceSha,
        buildIntegrityDigest: result.buildIntegrityDigest,
        buildFileCount: result.buildFileCount,
      })}`,
    )
  }
  return result.exitCode
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
