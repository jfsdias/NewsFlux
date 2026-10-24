import { persistentAtom } from "@nanostores/persistent"

export const normalizeApiKeyId = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null
  }
  const numericValue = Number(value)
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null
}

const defaultValue = {
  server: "",
  token: "",
  apiKeyId: null,
  username: "",
  password: "",
}

export const normalizeAuthValue = (value = {}) => {
  const candidate = value && typeof value === "object" ? value : {}
  return {
    server: typeof candidate.server === "string" ? candidate.server : "",
    token: typeof candidate.token === "string" ? candidate.token : "",
    apiKeyId: normalizeApiKeyId(candidate.apiKeyId),
    username: typeof candidate.username === "string" ? candidate.username : "",
    password: typeof candidate.password === "string" ? candidate.password : "",
  }
}

export const authState = persistentAtom("auth", defaultValue, {
  encode: (value) => JSON.stringify(normalizeAuthValue(value)),
  decode: (str) => {
    try {
      const storedValue = JSON.parse(str)
      return normalizeAuthValue({ ...defaultValue, ...storedValue })
    } catch {
      return { ...defaultValue }
    }
  },
})

const rawSetAuthState = authState.set.bind(authState)
authState.set = (authChanges) => rawSetAuthState(normalizeAuthValue(authChanges))

export const setAuth = (authChanges) => authState.set(authChanges)

export const resetAuth = () => setAuth(defaultValue)
