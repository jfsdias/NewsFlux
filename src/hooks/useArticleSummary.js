import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import requestArticleSummary from "@/apis/article-intelligence"
import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import { isCurrentArticleSummaryRequest } from "@/utils/article-intelligence-summary"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

const idleState = (entryId, authSessionKey, sessionRevision) => ({
  entryId,
  authSessionKey,
  sessionRevision,
  status: "idle",
  summary: null,
})

const useArticleSummary = ({ activeContent, routeEntryId, sessionRevision }) => {
  const auth = useStore(authState)
  const authSessionKey = getAuthSessionKey(auth)
  const [state, setState] = useState(() =>
    idleState(activeContent?.id ?? null, authSessionKey, sessionRevision),
  )
  const requestRef = useRef(null)
  const currentRef = useRef({
    activeEntryId: activeContent?.id ?? null,
    routeEntryId,
  })
  useLayoutEffect(() => {
    currentRef.current = {
      activeEntryId: activeContent?.id ?? null,
      routeEntryId,
    }
  }, [activeContent?.id, routeEntryId])

  const entryId = Number(activeContent?.id)
  const canSummarize =
    Number.isSafeInteger(entryId) &&
    entryId > 0 &&
    Number(routeEntryId) === entryId &&
    hasProvisionedApiKey(auth)

  useEffect(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    return () => {
      requestRef.current?.controller.abort()
      requestRef.current = null
    }
  }, [activeContent?.id, authSessionKey, routeEntryId, sessionRevision])

  const summarize = useCallback(async () => {
    if (!canSummarize) {
      return
    }
    requestRef.current?.controller.abort()
    const controller = new AbortController()
    const request = {
      authSessionKey,
      controller,
      entryId,
      requestId: globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`,
      sessionRevision: getDataSessionRevision(),
    }
    requestRef.current = request
    const isCurrent = () => {
      const currentAuth = authState.get()
      const activeRequest = requestRef.current
      return (
        isCurrentArticleSummaryRequest(request, {
          requestId: activeRequest?.requestId,
          entryId,
          activeEntryId: currentRef.current.activeEntryId,
          routeEntryId: currentRef.current.routeEntryId,
          authSessionKey: getAuthSessionKey(currentAuth),
          sessionRevision: getDataSessionRevision(),
        }) && !controller.signal.aborted
      )
    }
    setState({
      entryId,
      authSessionKey,
      sessionRevision: request.sessionRevision,
      status: "loading",
      summary: null,
    })

    try {
      const result = await requestArticleSummary({ entryId, signal: controller.signal })
      if (!result || !isCurrent()) {
        return
      }
      if (result.kind === "summary") {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: result.summary.status,
          summary: result.summary,
        })
      } else if (result.kind === "error") {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: result.error.retryable,
        })
      } else {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: false,
        })
      }
    } catch {
      if (isCurrent()) {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: true,
        })
      }
    }
  }, [authSessionKey, canSummarize, entryId])

  const stateIsCurrent =
    state.entryId === entryId &&
    state.authSessionKey === authSessionKey &&
    state.sessionRevision === sessionRevision

  return {
    canSummarize,
    summarize,
    status: stateIsCurrent ? state.status : "idle",
    summary: stateIsCurrent ? state.summary : null,
    retryable: stateIsCurrent ? Boolean(state.retryable) : false,
  }
}

export default useArticleSummary
