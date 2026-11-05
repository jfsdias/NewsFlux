/**
 * Pure helpers for the knip baseline gate.
 *
 * Unused exports and duplicate exports are accepted debt recorded in `knip-baseline.json`; the
 * gate fails when a finding appears that is not in the baseline, or when a baseline entry no longer
 * reproduces (so the baseline can only shrink). Every other finding type (unused files,
 * dependencies, unlisted dependencies, unresolved imports, binaries, types...) is never accepted.
 */

const BASELINED_KINDS = new Set(["exports", "duplicates"])
const FINDING_KINDS = [
  "binaries",
  "catalog",
  "catalogReferences",
  "dependencies",
  "devDependencies",
  "duplicates",
  "enumMembers",
  "exports",
  "files",
  "namespaceMembers",
  "optionalPeerDependencies",
  "types",
  "unlisted",
  "unresolved",
]
const REPORT_FIELDS = new Set(["issues"])
const ISSUE_METADATA_FIELDS = new Set(["file"])
const KNIP_STATES = new Set([...FINDING_KINDS, ...ISSUE_METADATA_FIELDS])

const sortedUnique = (values) => [...new Set(values)].toSorted()
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const assertNamedEntry = (kind, entry) => {
  if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") {
    throw new TypeError(`${kind} entries must include a non-empty name`)
  }
}

const validateIssue = (issue, index) => {
  if (!isRecord(issue)) {
    throw new TypeError(`issue ${index} must be an object`)
  }
  if (typeof issue.file !== "string" || issue.file.trim() === "") {
    throw new TypeError(`issue ${index} file must be a non-empty string`)
  }

  for (const field of Object.keys(issue)) {
    if (!KNIP_STATES.has(field)) {
      throw new TypeError(`issue ${index} has unknown issue category or metadata field ${field}`)
    }
  }

  for (const kind of FINDING_KINDS) {
    if (!(kind in issue)) {
      throw new TypeError(`issue ${index} is missing issue category ${kind}`)
    }
    if (!Array.isArray(issue[kind])) {
      throw new TypeError(`issue ${index} ${kind} must be an array`)
    }
    for (const entry of issue[kind]) {
      if (kind === "duplicates") {
        if (!Array.isArray(entry) || entry.length < 2) {
          throw new TypeError("duplicates entries must contain at least two named exports")
        }
        for (const duplicate of entry) {
          assertNamedEntry(kind, duplicate)
        }
      } else {
        assertNamedEntry(kind, entry)
      }
    }
  }
}

const describeEntry = (kind, entry) =>
  kind === "duplicates" ? [entry.map(({ name }) => name).toSorted()] : [entry.name]

export const collectFindings = (report) => {
  const baselined = []
  const blocking = []

  if (!isRecord(report)) {
    throw new TypeError("Knip report must be an object")
  }
  for (const field of Object.keys(report)) {
    if (!REPORT_FIELDS.has(field)) {
      throw new TypeError(`Knip report has unknown top-level field ${field}`)
    }
  }
  if (!Array.isArray(report.issues)) {
    throw new TypeError("Knip report issues must be an array")
  }

  for (const [index, issue] of report.issues.entries()) {
    validateIssue(issue, index)
    for (const kind of FINDING_KINDS) {
      for (const entry of issue[kind]) {
        const key = `${kind}|${issue.file}|${describeEntry(kind, entry).join(",")}`
        if (BASELINED_KINDS.has(kind)) {
          baselined.push(key)
        } else {
          blocking.push(key)
        }
      }
    }
  }

  return { baselined: sortedUnique(baselined), blocking: sortedUnique(blocking) }
}

export const compareToBaseline = (findings, baseline) => {
  const accepted = new Set(baseline)
  const current = new Set(findings.baselined)
  const added = findings.baselined.filter((key) => !accepted.has(key))
  const stale = [...accepted].filter((key) => !current.has(key)).toSorted()
  const { blocking } = findings

  return {
    ok: added.length === 0 && stale.length === 0 && blocking.length === 0,
    added,
    stale,
    blocking,
  }
}
