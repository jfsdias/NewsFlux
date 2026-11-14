import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import requestArticleSummary, { fetchModelCatalog } from "@/apis/article-intelligence"
import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import isArticleIntelligenceEnabled from "@/utils/article-intelligence-feature"
import { buildSummaryProfile, resolveSummaryModel } from "@/utils/article-intelligence-profile"
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
  const settings = useStore(settingsState, {
    keys: [
      "aiSummaryModel",
      "aiSummaryLength",
      "aiSummaryFocus",
      "aiSummarySections",
      "aiSummaryLanguage",
    ],
  })
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
    isArticleIntelligenceEnabled() &&
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

    const setModelUnavailable = () =>
      setState({
        entryId,
        authSessionKey,
        sessionRevision: request.sessionRevision,
        status: "model_unavailable",
        summary: null,
        retryable: false,
      })

    try {
      // The catalog is revalidated on every explicit action; a stored choice is never
      // silently replaced by another model.
      const catalog = await fetchModelCatalog({ signal: controller.signal })
      if (!catalog || !isCurrent()) {
        return
      }
      const selection = resolveSummaryModel(settings.aiSummaryModel, catalog)
      if (!selection.modelId) {
        setModelUnavailable()
        return
      }
      const profile = buildSummaryProfile(settings)
      const result = await requestArticleSummary({
        entryId,
        signal: controller.signal,
        modelId: selection.modelId,
        profile,
      })
      if (!result || !isCurrent()) {
        return
      }
      if (result.kind === "error" && result.error.code.startsWith("MODEL_NOT_")) {
        setModelUnavailable()
        return
      }
      if (result.kind === "summary") {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: result.summary.status,
          summary: result.summary,
          modelLabel: selection.entry.label,
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
  }, [authSessionKey, canSummarize, entryId, settings])

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
    modelLabel: stateIsCurrent ? (state.modelLabel ?? null) : null,
  }
}

export default useArticleSummary
