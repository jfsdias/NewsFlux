import { authState, normalizeAuthValue, resetAuth, setAuth } from "@/store/authState"
import { resetContent } from "@/store/contentState"
import { commitIdentityData, resetData, setVerifiedServer } from "@/store/dataState"
import { resetFeedIcons } from "@/store/feedIconsState"
import { getAuthSessionKey } from "@/utils/auth"
import { logoutWithKeyRevocation } from "@/utils/auth-apikey"

export const resetSessionData = () => {
  resetContent()
  resetData()
  resetFeedIcons()
}

export const clearSession = () => {
  resetAuth()
  resetSessionData()
}

export const startSession = (auth, serverVersion, currentUser) => {
  const normalizedAuth = normalizeAuthValue(auth)
  setAuth(normalizedAuth)
  resetSessionData()
  if (currentUser) {
    commitIdentityData(currentUser)
  }
  if (serverVersion) {
    setVerifiedServer({
      authSessionKey: getAuthSessionKey(normalizedAuth),
      version: serverVersion,
    })
  }
}

export const logoutSession = (options = {}) =>
  logoutWithKeyRevocation({
    auth: authState.get(),
    onClearSession: clearSession,
    ...options,
  })
