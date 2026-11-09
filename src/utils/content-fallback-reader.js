const MAX_RECOVERED_HTML_LENGTH = 2 * 1024 * 1024
const SAFE_PARAGRAPHS = /^(?:<p>(?:[^<&]|&(?:amp|lt|gt);)*<\/p>)+$/u
const SAFE_BASE_PATH = /^\/(?:[A-Za-z0-9._~/-]*)$/u

export const buildContentFallbackReaderUrl = (basePath, entryId) => {
  if (
    typeof basePath !== "string" ||
    !SAFE_BASE_PATH.test(basePath) ||
    basePath.startsWith("//") ||
    basePath.includes("\\") ||
    basePath.includes("//") ||
    basePath.split("/").some((segment) => segment === "." || segment === "..") ||
    !Number.isSafeInteger(Number(entryId)) ||
    Number(entryId) <= 0
  ) {
    return null
  }

  const normalizedBase = basePath.replace(/\/$/u, "")
  return `${normalizedBase}/reader/v1/entries/${Number(entryId)}/recover`
}

export const validateContentFallbackReaderResponse = (response, { entryId, urlFingerprint }) => {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null
  }
  if (
    response.status !== "recovered" ||
    response.entry_id !== Number(entryId) ||
    typeof urlFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(urlFingerprint) ||
    response.url_fingerprint !== urlFingerprint ||
    !["wallhop", "miniflux_scraper"].includes(response.content_origin) ||
    !response.validation ||
    response.validation.state !== "SUFFICIENT" ||
    !response.provenance ||
    response.provenance.provider !==
      (response.content_origin === "wallhop" ? "wallhop.io" : "miniflux") ||
    typeof response.provenance.fetched_at !== "string" ||
    response.provenance.fetched_at.length > 64 ||
    typeof response.content_html !== "string" ||
    response.content_html.length === 0 ||
    response.content_html.length > MAX_RECOVERED_HTML_LENGTH ||
    !SAFE_PARAGRAPHS.test(response.content_html)
  ) {
    return null
  }

  return {
    entryId: Number(entryId),
    urlFingerprint,
    contentHtml: response.content_html,
    contentOrigin: response.content_origin,
  }
}

export const isCurrentContentFallbackRequest = (
  request,
  { requestId, sessionRevision, activeEntryId, routeEntryId },
) =>
  Boolean(
    request &&
    request.requestId === requestId &&
    request.sessionRevision === sessionRevision &&
    request.entryId === activeEntryId &&
    Number(routeEntryId) === request.entryId,
  )

export const getContentFallbackReaderBasePath = (
  configured = import.meta.env?.VITE_CONTENT_FALLBACK_READER_BASE_PATH,
) => {
  if (typeof configured !== "string" || !configured) {
    return null
  }
  // A same-origin relative path prevents the Miniflux API key being sent to an
  // arbitrary host. Reuse the endpoint builder so unsafe traversal is hidden
  // before the user is offered an action that cannot succeed.
  return buildContentFallbackReaderUrl(configured, 1) ? configured : null
}
