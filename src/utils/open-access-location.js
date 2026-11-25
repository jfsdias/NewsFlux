// Metadata-only selection. Never retrieves article bodies or changes access controls.
const LICENSES = new Set([
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
])
const VERSIONS = new Set(["submittedVersion", "acceptedVersion", "publishedVersion"])
const HOST_TYPES = new Set(["publisher", "repository"])

export const selectOpenAccessLocation = (doi, record) => {
  if (typeof doi !== "string" || !/^10\.\d{4,9}\/\S+$/u.test(doi)) return null
  if (typeof record?.doi !== "string" || record.doi.toLowerCase() !== doi.toLowerCase() || record.is_oa !== true) return null
  const location = record.best_oa_location
  if (!LICENSES.has(location?.license) || !VERSIONS.has(location.version) || !HOST_TYPES.has(location.host_type)) return null
  if (typeof location.url_for_landing_page !== "string") return null
  try {
    const url = new URL(location.url_for_landing_page)
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null
    return {
      url: url.href,
      version: location.version,
      license: location.license,
      hostType: location.host_type,
    }
  } catch {
    return null
  }
}
