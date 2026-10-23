const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])

export const getSafeExternalUrl = (url) => {
  if (typeof url !== "string" || url.trim() === "") {
    return null
  }

  try {
    const parsedUrl = new URL(url)
    return SAFE_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol) ? parsedUrl.href : null
  } catch {
    return null
  }
}

export const openExternalUrl = (url) => {
  const safeUrl = getSafeExternalUrl(url)
  if (!safeUrl) {
    return false
  }

  globalThis.open(safeUrl, "_blank", "noopener")
  return true
}

export const extractBasePath = (pathname) => {
  return pathname.replace(/\/entry\/\d+$/, "") || "/"
}

export const buildEntryDetailPath = (basePath, entryId) => {
  return `${basePath === "/" ? "" : basePath}/entry/${entryId}`
}

export const isEntryDetailPath = (pathname) => {
  return /\/entry\/\d+$/.test(pathname)
}

const extractEntryIdFromPath = (pathname) => {
  const match = pathname.match(/\/entry\/(\d+)$/)
  return match ? match[1] : null
}
