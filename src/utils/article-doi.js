// Bibliographic identity from an explicit canonical source URL only.
// No DOI inference, alternate-location selection, network or access assertion.
const getExplicitArticleDoi = (sourceUrl) => {
  if (typeof sourceUrl !== "string") {
    return null
  }
  const match = /^https:\/\/doi\.org\/(10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+)$/u.exec(sourceUrl)
  if (!match) {
    return null
  }

  try {
    const url = new URL(sourceUrl)
    if (url.href !== sourceUrl || url.origin !== "https://doi.org") {
      return null
    }
    return match[1]
  } catch {
    return null
  }
}

export default getExplicitArticleDoi
