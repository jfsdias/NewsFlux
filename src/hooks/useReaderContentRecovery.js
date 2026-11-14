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

const useReaderContentRecovery = ({
  activeContent,
  routeEntryId,
  routePath,
  onBeforeContentChange,
  onRecoveryStart,
}) => {
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
  const abortControllerRef = useRef(null)
  const [storedState, setStoredState] = useState(EMPTY_STATE)

  useLayoutEffect(() => {
    if (contextRef.current !== contextKey) {
      contextRef.current = contextKey
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      inFlightRef.current = false
      setStoredState(EMPTY_STATE)
    }

    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      inFlightRef.current = false
    }
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
  const hasRecovery = ["recovered", "original_restored"].includes(visibleState.status)

  const recover = async () => {
    if (!canRecover || inFlightRef.current || hasRecovery) {
      return
    }
    inFlightRef.current = true
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    abortControllerRef.current = controller
    onRecoveryStart?.()
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
        signal: controller.signal,
      })
      if (readContextIsCurrent({ contextRef, request, authKey: request.authKey })) {
        onBeforeContentChange?.()
        setStoredState({
          contextKey,
          status: "recovered",
          contentHtml: result.contentHtml,
          contentOrigin: result.contentOrigin,
        })
      }
    } catch {
      if (
        !controller.signal.aborted &&
        readContextIsCurrent({ contextRef, request, authKey: request.authKey })
      ) {
        setStoredState({ contextKey, status: "failed" })
      }
    } finally {
      if (requestIdRef.current === requestId) {
        inFlightRef.current = false
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  // Contextual consent: the reader is told that an external service is used before any request.
  const requestConsent = () => {
    if (!canRecover || inFlightRef.current || hasRecovery) {
      return
    }
    setStoredState({ contextKey, status: "confirming" })
  }

  const dismissConsent = () => {
    if (visibleState.status === "confirming") {
      setStoredState(EMPTY_STATE)
    }
  }

  const cancel = () => {
    if (visibleState.status !== "loading") {
      return
    }
    requestIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    inFlightRef.current = false
    setStoredState({ contextKey, status: "cancelled" })
  }

  const showOriginalContent = () => {
    if (visibleState.status !== "recovered") {
      return
    }
    onBeforeContentChange?.()
    setStoredState({ ...visibleState, status: "original_restored" })
  }

  const showRecoveredContent = () => {
    if (visibleState.status !== "original_restored") {
      return
    }
    onBeforeContentChange?.()
    setStoredState({ ...visibleState, status: "recovered" })
  }

  return {
    canRecover,
    contentHtml: visibleState.status === "recovered" ? visibleState.contentHtml : null,
    contentOrigin: hasRecovery ? visibleState.contentOrigin : null,
    recover,
    requestConsent,
    dismissConsent,
    cancel,
    hasRecovery,
    isOriginalShown: visibleState.status === "original_restored",
    showOriginalContent,
    showRecoveredContent,
    status: visibleState.status,
  }
}

export default useReaderContentRecovery
