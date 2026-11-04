import assert from "node:assert/strict"
import test from "node:test"

import { collectFindings, compareToBaseline } from "./knip-baseline.js"

const issue = (file, overrides = {}) => ({
  file,
  files: [],
  exports: [],
  duplicates: [],
  types: [],
  dependencies: [],
  devDependencies: [],
  unlisted: [],
  unresolved: [],
  binaries: [],
  ...overrides,
})

test("collectFindings turns exports and duplicates into stable sorted keys", () => {
  const findings = collectFindings({
    issues: [
      issue("src/b.js", { exports: [{ name: "zeta" }, { name: "alpha" }] }),
      issue("src/a.js", { duplicates: [[{ name: "foo" }, { name: "default" }]] }),
    ],
  })

  assert.deepEqual(findings.baselined, [
    "duplicates|src/a.js|default,foo",
    "exports|src/b.js|alpha",
    "exports|src/b.js|zeta",
  ])
  assert.deepEqual(findings.blocking, [])
})

test("files, dependencies and unresolved imports are never baselined", () => {
  const findings = collectFindings({
    issues: [
      issue("src/dead.js", { files: [{ name: "src/dead.js" }] }),
      issue("package.json", {
        dependencies: [{ name: "left-pad" }],
        unlisted: [{ name: "chalk" }],
      }),
      issue("scripts/x.js", { unresolved: [{ name: "./missing.js" }] }),
    ],
  })

  assert.deepEqual(findings.baselined, [])
  assert.deepEqual(findings.blocking, [
    "dependencies|package.json|left-pad",
    "files|src/dead.js|src/dead.js",
    "unlisted|package.json|chalk",
    "unresolved|scripts/x.js|./missing.js",
  ])
})

test("compareToBaseline reports new findings as failures", () => {
  const result = compareToBaseline(
    { baselined: ["exports|src/a.js|a", "exports|src/new.js|n"], blocking: [] },
    ["exports|src/a.js|a"],
  )

  assert.equal(result.ok, false)
  assert.deepEqual(result.added, ["exports|src/new.js|n"])
  assert.deepEqual(result.stale, [])
})

test("compareToBaseline reports stale baseline entries so the baseline can only shrink", () => {
  const result = compareToBaseline({ baselined: [], blocking: [] }, ["exports|src/gone.js|g"])

  assert.equal(result.ok, false)
  assert.deepEqual(result.stale, ["exports|src/gone.js|g"])
})

test("compareToBaseline fails on blocking findings even when the baseline matches", () => {
  const result = compareToBaseline(
    { baselined: ["exports|src/a.js|a"], blocking: ["files|src/dead.js|src/dead.js"] },
    ["exports|src/a.js|a"],
  )

  assert.equal(result.ok, false)
  assert.deepEqual(result.blocking, ["files|src/dead.js|src/dead.js"])
})

test("compareToBaseline passes when findings equal the accepted baseline", () => {
  const result = compareToBaseline({ baselined: ["exports|src/a.js|a"], blocking: [] }, [
    "exports|src/a.js|a",
  ])

  assert.equal(result.ok, true)
})
