import { useStore } from "@nanostores/react"
import { useLayoutEffect, useRef, useState } from "react"

import { requestReaderContentRecovery } from "@/apis/content-fallback-reader"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { dataState, getDataSessionRevision } from "@/store/dataState"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"
import {
  getContentFallbackReaderBasePath,
  isCurrentContentFallbackRequest,
} from "@/utils/content-fallback-reader"

const EMPTY_STATE = Object.freeze({ status: "idle" })

const readContextIsCurrent = ({ contextRef, request, authKey }) => {
  const activeEntryId = contentState.get().activeContent?.id
  return (
    request.contextKey === contextRef.current &&
    request.authKey === authKey &&
    getAuthSessionKey(authState.get()) === authKey &&
    isCurrentContentFallbackRequest(request, {
      requestId: request.requestId,
      sessionRevision: getDataSessionRevision(),
      activeEntryId,
      routeEntryId: request.routeEntryId,
    })
  )
}

const useReaderContentRecovery = ({ activeContent, routeEntryId, routePath }) => {
  const auth = useStore(authState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const contextKey = JSON.stringify([
    activeContent?.id ?? null,
    activeContent?.url ?? "",
    routeEntryId ?? "",
    routePath ?? "",
    sessionRevision,
    getAuthSessionKey(auth),
  ])
  const contextRef = useRef(contextKey)
  const requestIdRef = useRef(0)
  const inFlightRef = useRef(false)
  const [storedState, setStoredState] = useState(EMPTY_STATE)

  useLayoutEffect(() => {
    if (contextRef.current === contextKey) {
      return
    }
    contextRef.current = contextKey
    requestIdRef.current += 1
    inFlightRef.current = false
    setStoredState(EMPTY_STATE)
  }, [contextKey])

  const numericEntryId = Number(activeContent?.id)
  const canRecover = Boolean(
    getContentFallbackReaderBasePath() &&
    hasProvisionedApiKey(auth) &&
    Number.isSafeInteger(numericEntryId) &&
    numericEntryId > 0 &&
    Number(routeEntryId) === numericEntryId &&
    typeof activeContent?.url === "string" &&
    activeContent.url.length > 0,
  )
  const visibleState = storedState.contextKey === contextKey ? storedState : EMPTY_STATE

  const recover = async () => {
    if (!canRecover || inFlightRef.current || visibleState.status === "recovered") {
      return
    }
    inFlightRef.current = true
    const requestId = ++requestIdRef.current
    const request = {
      requestId,
      entryId: numericEntryId,
      routeEntryId: String(routeEntryId),
      sessionRevision,
      contextKey,
      authKey: getAuthSessionKey(auth),
    }
    setStoredState({ contextKey, status: "loading" })
    try {
      const result = await requestReaderContentRecovery({
        entryId: numericEntryId,
        url: activeContent.url,
      })
      if (readContextIsCurrent({ contextRef, request, authKey: request.authKey })) {
        setStoredState({
          contextKey,
          status: "recovered",
          contentHtml: result.contentHtml,
          contentOrigin: result.contentOrigin,
        })
      }
    } catch {
      if (readContextIsCurrent({ contextRef, request, authKey: request.authKey })) {
        setStoredState({ contextKey, status: "failed" })
      }
    } finally {
      if (requestIdRef.current === requestId) {
        inFlightRef.current = false
      }
    }
  }

  return {
    canRecover,
    contentHtml: visibleState.status === "recovered" ? visibleState.contentHtml : null,
    contentOrigin: visibleState.status === "recovered" ? visibleState.contentOrigin : null,
    recover,
    status: visibleState.status,
  }
}

export default useReaderContentRecovery
