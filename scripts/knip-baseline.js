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

const sortedUnique = (values) => [...new Set(values)].toSorted()

const describeEntry = (kind, entry) =>
  kind === "duplicates" ? [entry.map(({ name }) => name).toSorted()] : [entry.name]

export const collectFindings = (report) => {
  const baselined = []
  const blocking = []

  for (const issue of report?.issues ?? []) {
    for (const kind of FINDING_KINDS) {
      for (const entry of issue[kind] ?? []) {
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
