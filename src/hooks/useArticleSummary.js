import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import requestArticleSummary, { fetchModelCatalog } from "@/apis/article-intelligence"
import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import isArticleIntelligenceEnabled from "@/utils/article-intelligence-feature"
import { buildSummaryProfile, resolveSummaryRouting } from "@/utils/article-intelligence-profile"
import { isCurrentArticleSummaryRequest } from "@/utils/article-intelligence-summary"
import {
  peekCachedSummary,
  storeCachedSummary,
  SUMMARY_SETTING_KEYS,
  summaryCacheKey,
} from "@/utils/article-summary-cache"
import { automaticSummaryEnabled } from "@/utils/article-summary-consent"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

// Opening an article summarizes it after this dwell time, so skimming quickly through
// several articles does not spend the model's rate limit.
const AUTO_SUMMARY_DELAY_MS = 1500

// A thrown request: an HTTP status from the model catalog names the cause; anything else is
// the network (fetch itself failed) or an unreadable catalog.
const catchErrorCode = (error) => {
  if (error?.status === 401 || error?.status === 403) {
    return "UNAUTHENTICATED"
  }
  if (Number.isInteger(error?.status)) {
    return "CATALOG_UNAVAILABLE"
  }
  return error?.name === "TypeError" && error?.message !== "Model catalog is unavailable"
    ? "NETWORK"
    : "CATALOG_UNAVAILABLE"
}

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
    keys: [...SUMMARY_SETTING_KEYS, "aiSummaryAutoOnOpen", "aiSummaryAutoConsent"],
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
  const cacheKey = summaryCacheKey({
    authSessionKey,
    sessionRevision,
    entryId,
    entryVersion: activeContent?.changed_at ?? activeContent?.hash,
    settings,
  })

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
      const selection = resolveSummaryRouting(settings, catalog)
      if (!selection.modelId) {
        setModelUnavailable()
        return
      }
      const profile = buildSummaryProfile(settings)
      const result = await requestArticleSummary({
        entryId,
        signal: controller.signal,
        modelId: selection.modelId,
        fallbackModelId: selection.fallbackModelId,
        consent: selection.consent,
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
        const finished = {
          status: result.summary.status,
          summary: result.summary,
          modelLabel: selection.entry.label,
          // Labels for verifiable primary/fallback provenance (catalog IDs -> display labels).
          modelLabels: Object.fromEntries(catalog.models.map((model) => [model.id, model.label])),
        }
        storeCachedSummary(cacheKey, finished)
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          ...finished,
        })
      } else if (result.kind === "error") {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: result.error.retryable,
          errorCode: result.error.code,
        })
      } else {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: false,
          errorCode: "INVALID_RESPONSE",
        })
      }
    } catch (error) {
      if (isCurrent()) {
        setState({
          entryId,
          authSessionKey,
          sessionRevision: request.sessionRevision,
          status: "error",
          summary: null,
          retryable: true,
          errorCode: catchErrorCode(error),
        })
      }
    }
  }, [authSessionKey, cacheKey, canSummarize, entryId, settings])

  // Opening an article: show this tab's cached summary at once; otherwise, with automatic
  // summaries on, request one after a short dwell. Errors are never retried automatically.
  const autoOnOpen = automaticSummaryEnabled(settings)
  useEffect(() => {
    if (!canSummarize) {
      return
    }
    if (peekCachedSummary(cacheKey)) {
      return
    }
    if (!autoOnOpen) {
      return
    }
    const timer = setTimeout(() => void summarize(), AUTO_SUMMARY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [authSessionKey, autoOnOpen, cacheKey, canSummarize, entryId, sessionRevision, summarize])

  const stateIsCurrent =
    state.entryId === entryId &&
    state.authSessionKey === authSessionKey &&
    state.sessionRevision === sessionRevision

  // A summary already created in this tab for the same entry and settings is shown at once,
  // until the user asks for a new one.
  const cached =
    canSummarize && (!stateIsCurrent || state.status === "idle")
      ? peekCachedSummary(cacheKey)
      : null
  const view = cached ?? (stateIsCurrent ? state : null)

  return {
    canSummarize,
    summarize,
    status: view?.status ?? "idle",
    summary: view?.summary ?? null,
    retryable: Boolean(view?.retryable),
    errorCode: view?.errorCode ?? null,
    autoOnOpen: Boolean(autoOnOpen),
    modelLabels: view?.modelLabels ?? null,
    modelLabel: view?.modelLabel ?? null,
  }
}

export default useArticleSummary
