import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8")

const PROJECT_STATE = read("docs/NEWSFLUX_PROJECT_STATE.md")
const ROADMAP = read("docs/NEWSFLUX_ROADMAP.md")
const PWA = read("docs/PWA_ARCHITECTURE.md")
const AUDITED_COMMIT = /audited commit `([\da-f]{40})`/

const auditedCommitOf = (document) => document.match(AUDITED_COMMIT)?.[1]

const walkSources = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) {
      return walkSources(relative)
    }
    return /\.(?:js|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.js") ? [relative] : []
  })

// History checks need a full clone. A shallow checkout (the default for CI checkouts) or a source
// archive cannot resolve older commits, so only the format is verified there.
const canResolveHistory = () => {
  try {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root,
      encoding: "utf8",
    })
    return shallow.trim() === "false"
  } catch {
    return false
  }
}

test("the current-state documents name the same audited commit, and it is in the repository history", () => {
  const commits = [PROJECT_STATE, ROADMAP, PWA].map((document) => auditedCommitOf(document))

  assert.ok(commits.every(Boolean), "every document must state an audited commit")
  assert.equal(new Set(commits).size, 1, "documents must agree on the audited commit")
  assert.match(commits[0], /^[\da-f]{40}$/)
  if (canResolveHistory()) {
    assert.doesNotThrow(() =>
      execFileSync("git", ["merge-base", "--is-ancestor", commits[0], "HEAD"], { cwd: root }),
    )
  }
})

const currentSection = (document, headingPattern) => {
  const start = document.search(headingPattern)
  assert.ok(start >= 0, `missing section ${headingPattern}`)
  const rest = document.slice(start + 1)
  const next = rest.search(/^## /m)
  return next === -1 ? rest : rest.slice(0, next)
}

test("the tables of the current-state sections are well formed", () => {
  const sections = [
    currentSection(PROJECT_STATE, /^## Current state/m),
    currentSection(ROADMAP, /^## 24\. Current canonical state/m),
    currentSection(PWA, /^## 17\. Current implementation/m),
  ]

  for (const section of sections) {
    const lines = section.split("\n")
    let columns = 0
    for (const line of lines) {
      if (!line.startsWith("|")) {
        columns = 0
        continue
      }
      const count = line.split(/(?<!\\)\|/).length
      if (columns === 0) {
        columns = count
      }
      assert.equal(count, columns, `unescaped pipe or ragged row in a table: ${line.slice(0, 80)}`)
    }
  }
})

test("each document declares exactly one current state and points to it", () => {
  const projectStateHeadings = PROJECT_STATE.match(/^## Current state/gm) ?? []

  assert.equal(projectStateHeadings.length, 1)
  assert.match(ROADMAP, /Section 24 is authoritative/)
  assert.match(ROADMAP, /^## 24\. Current canonical state:/m)
  assert.doesNotMatch(ROADMAP, /^## 23\. Current canonical state/m)
  assert.match(PWA, /^## 17\. Current implementation at the audited commit/m)
})

test("every build-time flag used by the source is documented in the project state", () => {
  const flags = new Set(
    walkSources("src").flatMap((file) => read(file).match(/\bVITE_[A-Z_]+\b/g) ?? []),
  )
  flags.delete("VITE_BASE_PATH")

  assert.ok(flags.size > 0)
  for (const flag of flags) {
    assert.ok(
      PROJECT_STATE.includes(flag),
      `${flag} must be documented in NEWSFLUX_PROJECT_STATE.md`,
    )
  }
})

test("the PWA architecture document matches the facts in vite.config.js", () => {
  const config = read("vite.config.js")

  assert.match(config, /registerType: "prompt"/)
  assert.match(PWA, /registerType: "prompt"/)
  assert.match(config, /purpose: "maskable"/)
  assert.match(PWA, /maskable/)
  for (const color of config.match(/#[\dA-F]{6}/g)) {
    assert.ok(PWA.includes(color), `PWA_ARCHITECTURE.md must mention the theme color ${color}`)
  }
  assert.match(config, /cacheName: RUNTIME_BUILD_ASSET_CACHE_NAME/)
  assert.match(PWA, /runtime-build-assets-v2/)
})

test("the project state separates product, research, planned and held work and states what is unverified", () => {
  for (const heading of [
    "### Product functionality at the audited commit",
    "### Experimental research (not product functionality)",
    "### Planned and on hold",
    "### PR ledger after PR #129 (verified)",
  ]) {
    assert.ok(PROJECT_STATE.includes(heading), `missing "${heading}"`)
  }
  assert.match(PROJECT_STATE, /Main\/production parity is unknown/)
  assert.match(PROJECT_STATE, /Nothing has been verified on a physical device/)
})
