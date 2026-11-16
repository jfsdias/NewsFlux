/** Build a user-initiated third-party link; never accept internal or credentialed article URLs. */
export const buildWallhopExternalUrl = (articleUrl) => {
  if (typeof articleUrl !== "string" || articleUrl.length > 8192 || articleUrl.trim() !== articleUrl) {
    return null
  }
  try {
    const url = new URL(articleUrl)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !host.includes(".") ||
      host.endsWith(".") ||
      /^\[|:/.test(host) ||
      /^[0-9.]+$/.test(host) ||
      /\.(?:home|internal|local|lan|localhost|invalid|test|example)$/.test(host) ||
      /(?:^|[?&])(?:token|api[_-]?key|secret|session|password|auth|code)=/i.test(url.search)
    ) {
      return null
    }
    url.hash = ""
    return `https://wallhop.io/${url.href}`
  } catch {
    return null
  }
}
