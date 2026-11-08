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
const E2E = read("docs/qa/E2E.md")
const FULL_SHA = /^[\da-f]{40}$/

const walkSources = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) {
      return walkSources(relative)
    }
    return /\.(?:js|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.js") ? [relative] : []
  })

const markdownH2Sections = (document) => [...document.matchAll(/^## (.+)$/gm)]

const uniqueH2Section = (document, predicate, label) => {
  const headings = markdownH2Sections(document)
  const matches = headings.filter((heading) => predicate(heading[1]))

  assert.equal(matches.length, 1, `${label} must have exactly one authoritative section`)

  const heading = matches[0]
  const next = headings.find((candidate) => candidate.index > heading.index)
  return {
    title: heading[1],
    text: document.slice(heading.index, next?.index ?? document.length),
  }
}

const tableCells = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim())

const markdownTableValue = (section, field, label) => {
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => tableCells(line))
    .filter((cells) => cells[0] === `\`${field}\``)

  assert.equal(rows.length, 1, `${label} must contain exactly one \`${field}\` row`)
  assert.ok(rows[0].length >= 2, `${label} \`${field}\` row must have a value`)
  return rows[0][1].replace(/^`([^`]*)`$/, "$1")
}

const assertTablesWellFormed = (section, label) => {
  let expectedCells = 0
  let tableCount = 0

  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) {
      expectedCells = 0
      continue
    }

    const cells = line.split(/(?<!\\)\|/).length
    if (expectedCells === 0) {
      expectedCells = cells
      tableCount += 1
      continue
    }

    assert.equal(
      cells,
      expectedCells,
      `${label} has a malformed Markdown table row: ${line.slice(0, 100)}`,
    )
  }

  assert.ok(tableCount > 0, `${label} must contain its expected Markdown table`)
}

const getCurrentSnapshots = ({ projectState, roadmap, pwa, e2e }) => {
  const project = uniqueH2Section(
    projectState,
    (title) => title.startsWith("Current state (verified GitHub main "),
    "Project State current snapshot",
  )
  const roadmapSnapshot = uniqueH2Section(
    roadmap,
    (title) => title.startsWith("Current canonical state (verified "),
    "Roadmap current snapshot",
  )
  const pwaSnapshot = uniqueH2Section(
    pwa,
    (title) => title.startsWith("17. Current implementation at the audited commit ("),
    "PWA dated implementation snapshot",
  )

  assertTablesWellFormed(project.text, "Project State current snapshot")
  assertTablesWellFormed(roadmapSnapshot.text, "Roadmap current snapshot")
  assertTablesWellFormed(pwaSnapshot.text, "PWA §17 dated snapshot")

  const projectSha = markdownTableValue(project.text, "CURRENT_MAIN_SHA", "Project State")
  const roadmapSha = markdownTableValue(roadmapSnapshot.text, "CURRENT_MAIN_SHA", "Roadmap")
  assert.match(projectSha, FULL_SHA, "Project State CURRENT_MAIN_SHA must be a full lowercase SHA")
  assert.match(roadmapSha, FULL_SHA, "Roadmap CURRENT_MAIN_SHA must be a full lowercase SHA")
  assert.equal(roadmapSha, projectSha, "Project State and Roadmap current SHAs must agree")

  const projectHeading = project.title.match(
    /^Current state \(verified GitHub main `([\da-f]{40})`, post-PR #193, (\d{4}-\d{2}-\d{2})\)$/,
  )
  assert.ok(
    projectHeading,
    "Project State heading must identify its verified main SHA and snapshot date",
  )
  assert.equal(
    projectHeading[1],
    projectSha,
    "Project State heading SHA must match its current-state table",
  )

  const roadmapHeading = roadmapSnapshot.title.match(
    /^Current canonical state \(verified (\d{4}-\d{2}-\d{2}); post-PR #193\)$/,
  )
  assert.ok(roadmapHeading, "Roadmap current heading must identify its verification date")

  const verifiedState = markdownTableValue(
    project.text,
    "LAST_VERIFIED_GITHUB_STATE",
    "Project State",
  )
  const projectDate = verifiedState.match(
    /^(\d{4}-\d{2}-\d{2}); GitHub API and fetched `origin\/main`$/,
  )
  assert.ok(
    projectDate,
    "Project State must record the date and source of its live GitHub verification",
  )
  assert.equal(
    projectDate[1],
    projectHeading[2],
    "Project State heading and verification dates must agree",
  )
  assert.equal(
    roadmapHeading[1],
    projectDate[1],
    "Roadmap and Project State snapshot dates must agree",
  )

  const roadmapIntro = roadmap.slice(0, roadmap.search(/^## 1\./m))
  const section24Headings = roadmap.match(/^## 24\..*$/gm) ?? []
  assert.equal(
    section24Headings.length,
    1,
    "Roadmap must preserve one Section 24 historical snapshot",
  )
  assert.ok(
    /^## 24\. Historical snapshot:/.test(section24Headings[0]),
    "Roadmap must preserve Section 24 as a historical snapshot",
  )
  assert.match(
    roadmapSnapshot.text,
    /Section 24 remains intact as the 2026-11-06 historical record\./,
    "Roadmap current snapshot must explicitly identify Section 24 as historical",
  )
  assert.match(roadmapIntro, /Section 24 is retained as a historical snapshot\./)
  assert.doesNotMatch(roadmapIntro, /Section 24 is authoritative/)

  for (const [label, section] of [
    ["Project State", project.text],
    ["Roadmap", roadmapSnapshot.text],
  ]) {
    assert.equal(
      markdownTableValue(section, "PRODUCTION_SHA_VERIFIED", label),
      "UNKNOWN_IN_THIS_AUDIT",
      `${label} must not imply a production SHA was verified in this audit`,
    )
    assert.equal(
      markdownTableValue(section, "MAIN_PRODUCTION_PARITY", label),
      "NOT_VERIFIED",
      `${label} must not claim main/production parity without evidence`,
    )
  }

  assert.match(project.text, /Miniflux remains the source of truth/)
  assert.match(project.text, /All\/Unread remain chronological/)
  assert.match(project.text, /PR #190 remains OPEN\/DRAFT/)
  assert.match(project.text, /V2 remains on hold/)

  const pwaPreamble = pwa.slice(0, pwa.search(/^## 1\./m))
  const pwaAudit = pwaPreamble.match(
    /^- \*\*Last reconciled:\*\* (\d{4}-\d{2}-\d{2}), against audited commit `([\da-f]{40})`;/m,
  )
  assert.ok(pwaAudit, "PWA document must retain its explicitly dated audited-commit snapshot")
  assert.match(pwaAudit[2], FULL_SHA, "PWA historical audited commit must be a full lowercase SHA")
  assert.ok(
    pwaAudit[1] < projectDate[1],
    "PWA snapshot must remain temporally distinct from current project state",
  )
  assert.ok(
    pwaSnapshot.title.endsWith(`(${pwaAudit[1]})`),
    "PWA section date must match its reconciliation date",
  )
  assert.equal(
    pwaSnapshot.text.match(/^LAST_USER_VALIDATED_PRODUCTION_SHA=([\da-f]{40})$/m)?.[1],
    pwaAudit[2],
    "PWA §17 production receipt must remain tied to its dated historical SHA",
  )
  assert.match(
    pwaPreamble,
    /No live host inspection was performed during this reconciliation; direct main\/production parity is not asserted\./,
  )
  assert.match(pwaSnapshot.text, /^LIVE_HOST_INSPECTION_IN_THIS_RUN=NO$/m)
  assert.match(pwaSnapshot.text, /^DIRECT_MAIN_PRODUCTION_PARITY=NOT_VERIFIED$/m)

  const pr193 = project.text.match(/- \*\*PR #193:\*\*([\s\S]*?)(?=\n- \*\*Production:\*\*)/)?.[1]
  assert.ok(pr193, "current Project State must include the PR #193 evidence boundary")
  assert.match(pr193, /owner-reported physical harness matrix/)
  assert.match(pr193, /This result is limited to the PR #193 harness/)
  assert.match(
    pr193,
    /does not establish general Safari, installed-PWA, Service Worker, or production-component validation/,
  )
  assert.match(
    e2e,
    /For PR #193, the owner reported PASS for the harness in four physical conditions/,
  )
  assert.match(
    e2e,
    /This covers only that harness, not general production Safari, installed-PWA, Service Worker, or application-component validation/,
  )

  return {
    project,
    roadmap: roadmapSnapshot,
    pwa: pwaSnapshot,
    currentMainSha: projectSha,
    pwaAuditSha: pwaAudit[2],
  }
}

const currentDocuments = () => ({
  projectState: PROJECT_STATE,
  roadmap: ROADMAP,
  pwa: PWA,
  e2e: E2E,
})

// History checks need a full clone. A shallow checkout or source archive cannot resolve older
// commits, so the contract still validates SHA format and reports the skipped ancestry check.
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

const assertRelevantCommitInHistory = (sha) =>
  execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: root })

test("current project and roadmap snapshots identify one matching GitHub main SHA", () => {
  const snapshots = getCurrentSnapshots(currentDocuments())
  assert.equal(snapshots.currentMainSha, "e949fdd5fd1975cd3437d3981232b0dbe18a74e5")
})

test("current and historical SHAs are full and belong to checkout history when available", (context) => {
  const snapshots = getCurrentSnapshots(currentDocuments())
  assert.match(snapshots.currentMainSha, FULL_SHA)
  assert.match(snapshots.pwaAuditSha, FULL_SHA)

  if (!canResolveHistory()) {
    context.diagnostic(
      `Shallow checkout: ancestry was not checked for current main ${snapshots.currentMainSha} or PWA snapshot ${snapshots.pwaAuditSha}.`,
    )
    return
  }

  assert.doesNotThrow(() => assertRelevantCommitInHistory(snapshots.currentMainSha))
  assert.doesNotThrow(() => assertRelevantCommitInHistory(snapshots.pwaAuditSha))
})

test("missing canonical roadmap snapshot is rejected", () => {
  const documents = currentDocuments()
  documents.roadmap = documents.roadmap.replaceAll(/^## Current canonical state[^\n]*\n/gm, "")
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Roadmap current snapshot must have exactly one authoritative section/,
  )
})

test("duplicate Project State current authorities are rejected", () => {
  const documents = currentDocuments()
  documents.projectState += `\n${getCurrentSnapshots(documents).project.text}`
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Project State current snapshot must have exactly one authoritative section/,
  )
})

test("competing current roadmap authorities are rejected", () => {
  const documents = currentDocuments()
  const section = getCurrentSnapshots(documents).roadmap.text
  documents.roadmap += `\n${section}`
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Roadmap current snapshot must have exactly one authoritative section/,
  )
})

test("different current SHAs across Project State and Roadmap are rejected", () => {
  const documents = currentDocuments()
  documents.roadmap = documents.roadmap.replace(
    "| `CURRENT_MAIN_SHA`         | `e949fdd5fd1975cd3437d3981232b0dbe18a74e5`",
    "| `CURRENT_MAIN_SHA`         | `1111111111111111111111111111111111111111`",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Project State and Roadmap current SHAs must agree/,
  )
})

test("truncated current SHA is rejected", () => {
  const documents = currentDocuments()
  documents.projectState = documents.projectState.replace(
    "| `CURRENT_MAIN_SHA`           | `e949fdd5fd1975cd3437d3981232b0dbe18a74e5`",
    "| `CURRENT_MAIN_SHA`           | `e949fdd5fd1975cd3437d3981232b0dbe18a74e`",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Project State CURRENT_MAIN_SHA must be a full lowercase SHA/,
  )
})

test("Section 24 presented as current instead of historical is rejected", () => {
  const documents = currentDocuments()
  documents.roadmap = documents.roadmap.replace(
    "## 24. Historical snapshot:",
    "## 24. Current canonical state:",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Roadmap must preserve Section 24 as a historical snapshot/,
  )
})

test("PWA dated snapshot presented as current runtime evidence is rejected", () => {
  const documents = currentDocuments()
  documents.pwa = documents.pwa.replace(
    "**Last reconciled:** 2026-11-06, against audited commit `fbbd2357caaa2d9d4a0a6b4cf3ed1bc2e8f71063`",
    "**Last reconciled:** 2026-11-08, against current main `e949fdd5fd1975cd3437d3981232b0dbe18a74e5`",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /PWA document must retain its explicitly dated audited-commit snapshot/,
  )
})

test("malformed current roadmap table is rejected", () => {
  const documents = currentDocuments()
  documents.roadmap = documents.roadmap.replace(
    "| `LAST_MERGED_PR`           | #193, squash merge `e949fdd5fd1975cd3437d3981232b0dbe18a74e5`                                                                      |",
    "| `LAST_MERGED_PR`           | #193, squash merge `e949fdd5fd1975cd3437d3981232b0dbe18a74e5` | unexpected |",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Roadmap current snapshot has a malformed Markdown table row/,
  )
})

test("unsupported production parity claim is rejected", () => {
  const documents = currentDocuments()
  documents.projectState = documents.projectState.replace(
    /(\| `MAIN_PRODUCTION_PARITY`\s*\| )`NOT_VERIFIED`/,
    "$1`YES`",
  )
  assert.throws(
    () => getCurrentSnapshots(documents),
    /Project State must not claim main\/production parity without evidence/,
  )
})

test("physical harness result overstated as general PWA validation is rejected", () => {
  const projectDocuments = currentDocuments()
  projectDocuments.projectState = projectDocuments.projectState.replace(
    "This result is limited to the PR #193 harness; it does not establish general Safari, installed-PWA, Service Worker, or production-component validation.",
    "This result validates general Safari, installed-PWA, Service Worker, and production-component behavior.",
  )
  assert.throws(
    () => getCurrentSnapshots(projectDocuments),
    /This result is limited to the PR #193 harness/,
  )

  const e2eDocuments = currentDocuments()
  e2eDocuments.e2e = e2eDocuments.e2e.replace(
    "This covers only that harness, not general production Safari, installed-PWA, Service Worker, or application-component validation.",
    "This verifies general production Safari, installed-PWA, Service Worker, and application-component behavior.",
  )
  assert.throws(() => getCurrentSnapshots(e2eDocuments), /This covers only that harness/)
})

test("current snapshot tables are well formed and Section 24 is explicitly historical", () => {
  const snapshots = getCurrentSnapshots(currentDocuments())
  assert.match(
    snapshots.roadmap.text,
    /Section 24 remains intact as the 2026-11-06 historical record/,
  )
})

test("every build-time flag used by the source is documented in Project State", () => {
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

test("the PWA architecture snapshot matches the facts in vite.config.js", () => {
  const { pwa } = getCurrentSnapshots(currentDocuments())
  const config = read("vite.config.js")

  assert.match(config, /registerType: "prompt"/)
  assert.match(pwa.text, /registerType: "prompt"/)
  assert.match(config, /purpose: "maskable"/)
  assert.match(pwa.text, /maskable/)
  for (const color of config.match(/#[\dA-F]{6}/g)) {
    assert.ok(pwa.text.includes(color), `PWA §17 must mention the theme color ${color}`)
  }
  assert.match(config, /cacheName: RUNTIME_BUILD_ASSET_CACHE_NAME/)
  assert.match(PWA, /runtime-build-assets-v2/)
})

test("the current Project State separates product, research, held work, and unverified runtime evidence", () => {
  const { project } = getCurrentSnapshots(currentDocuments())

  assert.match(project.text, /### Current product, QA, and evidence boundaries/)
  assert.match(project.text, /All\/Unread remain chronological/)
  assert.match(project.text, /Miniflux remains the source of truth/)
  assert.match(project.text, /PR #190 remains OPEN\/DRAFT/)
  assert.match(project.text, /research finding, not proof of a general product defect/)
  assert.match(project.text, /V2 remains on hold/)
})
