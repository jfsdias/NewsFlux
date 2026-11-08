import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

export const BUILD_PROVENANCE_FILENAME = "e2e-build-provenance.json"
export const SERVER_PROVENANCE_FILENAME = "server-provenance.json"

export const sanitizeE2EDiagnostic = (value) =>
  String(value)
    .replaceAll(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replaceAll(
      /((?:"?(?:access[_-]?token|refresh[_-]?token|token|password|api[_-]?key|authorization|cookie|set-cookie|session|secret)"?)\s*[:=]\s*["']?)[^"'&;,\s}]+/gi,
      "$1[REDACTED]",
    )

export const resolveBuildDirectory = (cwd, configuredBuildDir) =>
  path.resolve(cwd, configuredBuildDir?.trim() || "build")

const FULL_SHA_PATTERN = /^[a-f\d]{40}$/i
const DIGEST_PATTERN = /^sha256:[a-f\d]{64}$/i

const gitOutput = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()

const isWithinPath = (parent, candidate) => {
  const relative = path.relative(parent, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}

const statusPaths = (statusOutput) => {
  const records = statusOutput.split("\0").filter(Boolean)
  const paths = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const status = record.slice(0, 2)
    paths.push({ status, path: record.slice(3) })
    if (status.includes("R") || status.includes("C")) {
      index += 1
    }
  }

  return paths
}

/** Captures commit and working-tree identity without returning changed file names. */
export const readSourceSnapshot = (cwd, { buildDir } = {}) => {
  const repositoryRoot = gitOutput(cwd, ["rev-parse", "--show-toplevel"])
  const sourceSha = gitOutput(repositoryRoot, ["rev-parse", "HEAD"])
  const sourceTreeSha = gitOutput(repositoryRoot, ["rev-parse", "HEAD^{tree}"])
  const rawStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  )
  const resolvedBuildDir =
    buildDir && existsSync(buildDir) ? realpathSync(path.resolve(buildDir)) : null
  const relevantChanges = statusPaths(rawStatus).filter(({ status, path: relativePath }) => {
    if (!resolvedBuildDir || !status.startsWith("??")) {
      return true
    }
    const absolutePath = path.resolve(repositoryRoot, relativePath)
    return !isWithinPath(resolvedBuildDir, absolutePath)
  })

  if (!FULL_SHA_PATTERN.test(sourceSha) || !FULL_SHA_PATTERN.test(sourceTreeSha)) {
    throw new Error("Git did not provide a full source commit and tree SHA")
  }

  return {
    repositoryRoot,
    sha: sourceSha,
    treeSha: sourceTreeSha,
    dirtyState: relevantChanges.length === 0 ? "clean" : "dirty",
    dirtyPathCount: relevantChanges.length,
  }
}

const collectBuildFiles = (buildDir, relativeDirectory = "") => {
  const directory = path.join(buildDir, relativeDirectory)
  const entries = readdirSync(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = path.posix.join(
      relativeDirectory.split(path.sep).join(path.posix.sep),
      entry.name,
    )
    const absolutePath = path.join(buildDir, relativePath)

    if (entry.isSymbolicLink()) {
      throw new Error("Build contains a symbolic link; provenance cannot be verified")
    }
    if (entry.isDirectory()) {
      files.push(...collectBuildFiles(buildDir, relativePath))
      continue
    }
    if (!entry.isFile()) {
      throw new Error("Build contains a non-regular file; provenance cannot be verified")
    }
    if (relativePath === BUILD_PROVENANCE_FILENAME) {
      continue
    }

    files.push({ path: relativePath.split(path.sep).join(path.posix.sep), absolutePath })
  }

  return files
}

/** Hashes every regular file served from a build directory in stable path order. */
export const calculateBuildIntegrity = (buildDir) => {
  const configuredBuildDir = path.resolve(buildDir)
  if (!existsSync(configuredBuildDir) || !lstatSync(configuredBuildDir).isDirectory()) {
    throw new Error("E2E build directory is missing or is not a directory")
  }
  if (lstatSync(configuredBuildDir).isSymbolicLink()) {
    throw new Error("E2E build directory cannot be a symbolic link")
  }
  const resolvedBuildDir = realpathSync(configuredBuildDir)

  const files = collectBuildFiles(resolvedBuildDir).toSorted(({ path: left }, { path: right }) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  if (files.length === 0) {
    throw new Error("E2E build directory contains no files")
  }

  const hash = createHash("sha256")
  for (const file of files) {
    const contents = readFileSync(file.absolutePath)
    hash.update(file.path)
    hash.update("\0")
    hash.update(String(contents.length))
    hash.update("\0")
    hash.update(contents)
    hash.update("\0")
  }

  return { algorithm: "sha256", digest: `sha256:${hash.digest("hex")}`, fileCount: files.length }
}

const assertCleanSnapshot = (snapshot) => {
  if (snapshot.dirtyState !== "clean") {
    throw new Error(
      `Git working tree must be clean for a verified E2E build; found ${snapshot.dirtyPathCount} changed paths outside the build directory. Commit the intended test state or clean the checkout first.`,
    )
  }
}

const sameSourceSnapshot = (actual, expected) =>
  actual.sha === expected.sha &&
  actual.treeSha === expected.treeSha &&
  actual.dirtyState === "clean"

/** Writes an additive receipt only after a successful build and unchanged clean source. */
export const writeBuildProvenance = ({ cwd, buildDir, expectedSourceSnapshot } = {}) => {
  const resolvedBuildDir = path.resolve(buildDir ?? path.join(cwd, "build"))
  const source = readSourceSnapshot(cwd, { buildDir: resolvedBuildDir })
  assertCleanSnapshot(source)

  if (expectedSourceSnapshot && !sameSourceSnapshot(source, expectedSourceSnapshot)) {
    throw new Error("Source checkout changed between E2E build start and build receipt creation")
  }

  const integrity = calculateBuildIntegrity(resolvedBuildDir)
  const receipt = {
    version: 1,
    source: { sha: source.sha, treeSha: source.treeSha, dirtyState: "clean" },
    build: {
      integrityAlgorithm: integrity.algorithm,
      integrityDigest: integrity.digest,
      fileCount: integrity.fileCount,
    },
  }
  const receiptPath = path.join(resolvedBuildDir, BUILD_PROVENANCE_FILENAME)
  const temporaryPath = `${receiptPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "w" })
  renameSync(temporaryPath, receiptPath)
  return receipt
}

const validateReceiptShape = (receipt) => {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return "Build receipt must be an object"
  }
  if (receipt.version !== 1) {
    return "Build receipt version is unsupported"
  }
  if (!receipt.source || typeof receipt.source !== "object" || Array.isArray(receipt.source)) {
    return "Build receipt source identity is missing"
  }
  if (!FULL_SHA_PATTERN.test(receipt.source.sha ?? "")) {
    return "Build receipt source SHA is invalid"
  }
  if (!FULL_SHA_PATTERN.test(receipt.source.treeSha ?? "")) {
    return "Build receipt source tree SHA is invalid"
  }
  if (receipt.source.dirtyState !== "clean") {
    return "Build receipt must identify a clean source checkout"
  }
  if (!receipt.build || typeof receipt.build !== "object" || Array.isArray(receipt.build)) {
    return "Build receipt integrity data is missing"
  }
  if (
    receipt.build.integrityAlgorithm !== "sha256" ||
    !DIGEST_PATTERN.test(receipt.build.integrityDigest ?? "")
  ) {
    return "Build receipt integrity digest is invalid"
  }
  if (!Number.isInteger(receipt.build.fileCount) || receipt.build.fileCount < 1) {
    return "Build receipt file count is invalid"
  }
  return null
}

/** Validates the current checkout and all files in the selected build directory. */
export const verifyBuildProvenance = ({ cwd, buildDir } = {}) => {
  const resolvedBuildDir = path.resolve(buildDir ?? path.join(cwd, "build"))
  const problems = []
  let sourceSnapshot
  let receipt
  let integrity

  try {
    sourceSnapshot = readSourceSnapshot(cwd, { buildDir: resolvedBuildDir })
  } catch {
    return {
      valid: false,
      problems: ["Could not identify the current Git source checkout"],
      provenance: null,
      sourceSnapshot: null,
    }
  }

  if (sourceSnapshot.dirtyState !== "clean") {
    problems.push(
      `Git working tree must be clean before verified E2E; found ${sourceSnapshot.dirtyPathCount} changed paths outside the build directory`,
    )
  }

  const receiptPath = path.join(resolvedBuildDir, BUILD_PROVENANCE_FILENAME)
  if (existsSync(receiptPath)) {
    try {
      receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
      const shapeProblem = validateReceiptShape(receipt)
      if (shapeProblem) {
        problems.push(shapeProblem)
      }
    } catch {
      problems.push("E2E build provenance receipt is not valid JSON")
    }
  } else {
    problems.push("E2E build provenance receipt is missing")
  }

  if (receipt && validateReceiptShape(receipt) === null) {
    if (receipt.source.sha !== sourceSnapshot.sha) {
      problems.push("Build source SHA does not match the current checkout")
    }
    if (receipt.source.treeSha !== sourceSnapshot.treeSha) {
      problems.push("Build source tree SHA does not match the current checkout")
    }

    try {
      integrity = calculateBuildIntegrity(resolvedBuildDir)
      if (receipt.build.integrityDigest !== integrity.digest) {
        problems.push("E2E build integrity digest does not match the files currently served")
      }
      if (receipt.build.fileCount !== integrity.fileCount) {
        problems.push("E2E build file count does not match the files currently served")
      }
    } catch (error) {
      problems.push(error.message)
    }
  }

  const provenance = receipt
    ? {
        sourceSha: receipt.source?.sha ?? null,
        sourceTreeSha: receipt.source?.treeSha ?? null,
        sourceDirtyState: receipt.source?.dirtyState ?? null,
        buildIntegrityDigest: receipt.build?.integrityDigest ?? null,
        buildFileCount: receipt.build?.fileCount ?? null,
      }
    : null

  return { valid: problems.length === 0, problems, provenance, sourceSnapshot, receipt, integrity }
}

/** Reads a run-scoped server receipt and binds it to the current invocation. */
export const verifyServerProvenance = ({ serverReceiptPath, runId, provenance } = {}) => {
  if (!serverReceiptPath || !existsSync(serverReceiptPath)) {
    return {
      valid: false,
      problems: ["The app server did not write a current provenance receipt"],
      receipt: null,
    }
  }

  let receipt
  try {
    receipt = JSON.parse(readFileSync(serverReceiptPath, "utf8"))
  } catch {
    return {
      valid: false,
      problems: ["The app server provenance receipt is not valid JSON"],
      receipt: null,
    }
  }

  const problems = []
  if (receipt.version !== 1) {
    problems.push("The app server provenance receipt version is unsupported")
  }
  if (receipt.runId !== runId) {
    problems.push("The app server provenance receipt run ID does not match this invocation")
  }
  if (receipt.verified !== true) {
    problems.push("The app server did not confirm a verified build")
  }
  if (receipt.sourceSha !== provenance?.sourceSha) {
    problems.push("The app server source SHA does not match the verified checkout")
  }
  if (receipt.buildIntegrityDigest !== provenance?.buildIntegrityDigest) {
    problems.push("The app server build digest does not match the verified build")
  }
  if (receipt.buildFileCount !== provenance?.buildFileCount) {
    problems.push("The app server file count does not match the verified build")
  }

  return { valid: problems.length === 0, problems, receipt }
}

/** Writes a server receipt after independently checking the exact directory it will serve. */
export const writeServerProvenance = ({
  cwd,
  buildDir,
  runId,
  serverReceiptPath,
  expected,
} = {}) => {
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new Error("E2E run ID is required to start the verified app server")
  }
  if (!serverReceiptPath) {
    throw new Error("E2E server provenance receipt path is required")
  }

  const validation = verifyBuildProvenance({ cwd, buildDir })
  if (!validation.valid) {
    throw new Error(validation.problems.join("; "))
  }
  if (
    expected &&
    (validation.provenance.sourceSha !== expected.sourceSha ||
      validation.provenance.buildIntegrityDigest !== expected.buildIntegrityDigest ||
      validation.provenance.buildFileCount !== expected.buildFileCount)
  ) {
    throw new Error("App server build does not match the provenance verified by the runner")
  }

  const receipt = {
    version: 1,
    runId,
    verified: true,
    sourceSha: validation.provenance.sourceSha,
    buildIntegrityDigest: validation.provenance.buildIntegrityDigest,
    buildFileCount: validation.provenance.buildFileCount,
  }
  mkdirSync(path.dirname(serverReceiptPath), { recursive: true })
  writeFileSync(serverReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}
