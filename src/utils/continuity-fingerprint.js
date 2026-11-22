// Never persist query or article text. Disable continuity when Web Crypto is unavailable.
export const continuityFingerprint = async (value) => {
  if (typeof value !== "string" || !globalThis.crypto?.subtle) {
    return null
  }
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
