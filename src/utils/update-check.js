const GITHUB_COMPARE_FILE_CAP = 300

export const shouldNotifyProductUpdate = ({ status, ahead_by: aheadBy, files }) => {
  if (status !== "ahead" || !Number.isFinite(aheadBy) || aheadBy <= 0) {
    return false
  }

  if (!Array.isArray(files) || files.length === 0 || files.length >= GITHUB_COMPARE_FILE_CAP) {
    return true
  }

  return files.some(({ filename }) => typeof filename !== "string" || !filename.startsWith("docs/"))
}
