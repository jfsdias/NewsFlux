import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"

import HomeHighlights from "./HomeHighlights"
import HomeRecent from "./HomeRecent"
import HomeStates from "./HomeStates"

import { getStarredEntries } from "@/apis"
import LoadMoreSentinel from "@/components/Article/LoadMoreSentinel"
import SearchAndSortBar from "@/components/Article/SearchAndSortBar"
import AdaptiveScrollArea from "@/components/ui/AdaptiveScrollArea"
import useArticleCardActivation from "@/hooks/useArticleCardActivation"
import useReadOnScroll from "@/hooks/useReadOnScroll"
import { contentState } from "@/store/contentState"
import { dataState, getDataSessionRevision, globallyHiddenFeedIdsState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState } from "@/store/settingsState"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { subscribeEntryStatusMutationEvents } from "@/utils/entry-status-mutation-events"
import {
  appendHomeSessionEntries,
  createHomeEditorialSession,
  createHomeSessionKey,
  projectHomeSession,
  transitionHomeSession,
} from "@/utils/home-editorial-session"
import { getHomeIdentityKey } from "@/utils/home-page"
import {
  HOME_PERSONALIZATION_FRESHNESS_WINDOW,
  HOME_STARRED_PROFILE_LIMIT,
} from "@/utils/home-personalization-constants"
import {
  commitHomePersonalizationSnapshot,
  createHomePersonalizationGeneration,
  failHomePersonalizationProfile,
  failHomePersonalizationSnapshot,
  invalidateHomePersonalizationGeneration,
  resolveHomePersonalizationProfile,
} from "@/utils/home-personalization-generation"
import { createHomePersonalizationProfile } from "@/utils/home-personalization-profile"
import { projectHomePersonalization } from "@/utils/home-personalization-projection"

import "./HomeEditorial.css"

const currentHomeSessionKey = () => {
  const { pageSize, showHiddenFeeds } = settingsState.get()
  return createHomeSessionKey({
    identityKey: getHomeIdentityKey(homeIdentityState.get()),
    pageSize,
    showHiddenFeeds,
    sessionRevision: getDataSessionRevision(),
  })
}

const HOME_RESUME_COALESCE_MS = 250
const HOME_RESUME_DUPLICATE_WINDOW_MS = 1200

const HomeEditorial = ({
  cardsRef,
  entryListRef,
  getEntries,
  handleEntryClick,
  refreshArticleList,
  retryArticleList,
}) => {
  const { articleListError, entries, isArticleListReady, loadMoreVisible, total } = useStore(
    contentState,
    { keys: ["articleListError", "entries", "isArticleListReady", "loadMoreVisible", "total"] },
  )
  const articleActivation = useArticleCardActivation(handleEntryClick)
  const observeRead = useReadOnScroll(cardsRef)
  const identity = useStore(homeIdentityState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const { pageSize, showHiddenFeeds } = useStore(settingsState, {
    keys: ["pageSize", "showHiddenFeeds"],
  })
  const requestKey = createHomeSessionKey({
    identityKey: getHomeIdentityKey(identity),
    pageSize,
    showHiddenFeeds,
    sessionRevision,
  })
  const [session, setSession] = useState(null)
  const generationRef = useRef(null)
  const generationIdRef = useRef(0)
  const committedProjectionRef = useRef(null)

  useEffect(() => {
    let disposed = false
    const getCanonicalRequestKey = () =>
      createArticleListRequestKey({
        content: contentState.get(),
        settings: settingsState.get(),
        info: { from: "home", id: "" },
        sessionRevision: getDataSessionRevision(),
      })
    const currentContext = (generation) => ({
      generationId: generation.generationId,
      requestKey: generation.requestKey,
      canonicalRequestKey: generation.canonicalRequestKey,
      identityKey: generation.identityKey,
      sessionRevision: generation.sessionRevision,
    })
    const isCurrentGeneration = (generation) =>
      !disposed &&
      generationRef.current?.generationId === generation.generationId &&
      generation.requestKey === currentHomeSessionKey() &&
      generation.canonicalRequestKey === getCanonicalRequestKey() &&
      generation.identityKey === getHomeIdentityKey(homeIdentityState.get()) &&
      generation.sessionRevision === getDataSessionRevision()

    const startGeneration = (content, canonicalRequestKey) => {
      const identityKey = getHomeIdentityKey(homeIdentityState.get())
      const sessionRevision = getDataSessionRevision()
      const generation = createHomePersonalizationGeneration({
        generationId: ++generationIdRef.current,
        requestKey,
        canonicalRequestKey,
        identityKey,
        sessionRevision,
        targetSnapshotRevision: content.isArticleListReady
          ? content.articleListSnapshotRevision
          : content.articleListSnapshotRevision + 1,
        previousProjection: committedProjectionRef.current,
      })
      generationRef.current = generation

      getStarredEntries(null, {
        limit: HOME_STARRED_PROFILE_LIMIT,
        direction: "desc",
        filterDate: null,
      })
        .then((response) => {
          if (!isCurrentGeneration(generation) || !Array.isArray(response?.entries)) {
            return null
          }
          const { current } = generationRef
          const { entries: starredEntries } = response
          const nextGeneration = resolveHomePersonalizationProfile(current, {
            ...currentContext(current),
            profile: createHomePersonalizationProfile({
              entries: starredEntries,
              hiddenFeedIds: globallyHiddenFeedIdsState.get(),
            }),
          })
          generationRef.current = nextGeneration
          return nextGeneration
        })
        .catch(() => {
          if (!isCurrentGeneration(generation)) {
            return null
          }
          const { current } = generationRef
          const failedGeneration = failHomePersonalizationProfile(current, currentContext(current))
          generationRef.current = failedGeneration
          return failedGeneration
        })

      return generation
    }

    const commitSnapshot = (generation, content) => {
      if (
        !isCurrentGeneration(generation) ||
        content.articleListSnapshotRevision !== generation.targetSnapshotRevision
      ) {
        return
      }

      const baselineSession = createHomeEditorialSession({
        requestKey,
        sessionRevision: generation.sessionRevision,
        entries: content.entries,
        scrollRoot: entryListRef.current?.contentWrapperEl ?? entryListRef.current?.el ?? null,
      })
      const baselineProjection = projectHomeSession(baselineSession, content.entries)
      const personalizedProjection =
        generationRef.current.profileStatus === "ready"
          ? projectHomePersonalization({
              entries: content.entries,
              baselineHighlightIds: baselineProjection.highlightIds,
              baselineRecentIds: baselineProjection.recentIds,
              profile: generationRef.current.profile,
              freshnessWindow: HOME_PERSONALIZATION_FRESHNESS_WINDOW,
            })
          : baselineProjection
      const committed = commitHomePersonalizationSnapshot(generationRef.current, {
        ...currentContext(generation),
        baselineProjection,
        personalizedProjection,
      })
      if (!committed.committed) {
        return
      }

      generationRef.current = committed.generation
      committedProjectionRef.current = committed.projection
      setSession({
        ...createHomeEditorialSession({
          requestKey,
          sessionRevision: generation.sessionRevision,
          entries: content.entries,
          initialProjection: committed.generation.personalizationApplied
            ? committed.projection
            : undefined,
          scrollRoot: entryListRef.current?.contentWrapperEl ?? entryListRef.current?.el ?? null,
        }),
        snapshotRevision: content.articleListSnapshotRevision,
        personalizationApplied: committed.generation.personalizationApplied,
      })
    }

    const refreshSession = () => {
      if (disposed || requestKey !== currentHomeSessionKey()) {
        return
      }
      const content = contentState.get()
      if (content.infoFrom !== "home") {
        return
      }
      setSession((previous) => {
        if (previous?.requestKey !== requestKey) {
          return previous
        }
        if (previous.snapshotRevision !== content.articleListSnapshotRevision) {
          if (!content.isArticleListReady || content.articleListError) {
            return previous
          }
          return {
            ...appendHomeSessionEntries(previous, content.entries),
            snapshotRevision: content.articleListSnapshotRevision,
          }
        }
        return appendHomeSessionEntries(previous, content.entries)
      })

      const canonicalRequestKey = getCanonicalRequestKey()
      let generation = generationRef.current
      const requestChanged =
        generation?.status === "pending" && generation.canonicalRequestKey !== canonicalRequestKey

      if (requestChanged) {
        generationRef.current = invalidateHomePersonalizationGeneration(generation)
        generation = generationRef.current
      }

      const generationMatchesSession =
        generation?.requestKey === requestKey &&
        generation.canonicalRequestKey === canonicalRequestKey &&
        generation.identityKey === getHomeIdentityKey(homeIdentityState.get()) &&
        generation.sessionRevision === getDataSessionRevision()
      const hasCommittedHomeSession =
        generationMatchesSession &&
        generation.status === "committed" &&
        committedProjectionRef.current != null

      if (
        !content.isArticleListReady &&
        (!generation ||
          (generation.status !== "pending" && !hasCommittedHomeSession) ||
          requestChanged)
      ) {
        generation = startGeneration(content, canonicalRequestKey)
      } else if (
        content.isArticleListReady &&
        !content.articleListError &&
        content.articleListSnapshotRevision > 0 &&
        (!generation || (generation.status !== "pending" && !generationMatchesSession))
      ) {
        generation = startGeneration(content, canonicalRequestKey)
      }

      if (!generation || generation.status !== "pending") {
        return
      }
      if (content.isArticleListReady && content.articleListError) {
        generationRef.current = failHomePersonalizationSnapshot(
          generation,
          currentContext(generation),
        )
        return
      }
      if (content.isArticleListReady) {
        commitSnapshot(generation, content)
      }
    }
    const unsubscribe = contentState.listen(refreshSession)
    queueMicrotask(refreshSession)
    return () => {
      disposed = true
      unsubscribe()
      if (generationRef.current?.status === "pending") {
        generationRef.current = invalidateHomePersonalizationGeneration(generationRef.current)
      }
    }
  }, [entryListRef, requestKey])

  useEffect(() => {
    let wasBlurred = false
    let wasHidden = document.visibilityState === "hidden"
    let wasOffline = navigator.onLine === false
    let refreshTimer = null
    let lastRefreshAt = Number.NEGATIVE_INFINITY

    const canRefreshHome = () => {
      const content = contentState.get()
      return content.infoFrom === "home" && !content.activeContent && content.isArticleListReady
    }
    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        globalThis.clearTimeout(refreshTimer)
      }
      refreshTimer = globalThis.setTimeout(() => {
        refreshTimer = null
        const now = Date.now()
        if (!canRefreshHome() || now - lastRefreshAt < HOME_RESUME_DUPLICATE_WINDOW_MS) {
          return
        }
        lastRefreshAt = now
        void refreshArticleList?.()
      }, HOME_RESUME_COALESCE_MS)
    }
    const handleResume = () => {
      if (document.visibilityState === "hidden" || (!wasBlurred && !wasHidden)) {
        return
      }
      wasBlurred = false
      wasHidden = false
      scheduleRefresh()
    }
    const handleBlur = () => {
      wasBlurred = true
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true
        return
      }
      handleResume()
    }
    const handleOffline = () => {
      wasOffline = true
    }
    const handleOnline = () => {
      if (!wasOffline) {
        return
      }
      wasOffline = false
      scheduleRefresh()
    }

    globalThis.addEventListener("blur", handleBlur)
    globalThis.addEventListener("focus", handleResume)
    globalThis.addEventListener("offline", handleOffline)
    globalThis.addEventListener("online", handleOnline)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (refreshTimer !== null) {
        globalThis.clearTimeout(refreshTimer)
      }
      globalThis.removeEventListener("blur", handleBlur)
      globalThis.removeEventListener("focus", handleResume)
      globalThis.removeEventListener("offline", handleOffline)
      globalThis.removeEventListener("online", handleOnline)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [refreshArticleList])

  useEffect(
    () =>
      subscribeEntryStatusMutationEvents((event) => {
        if (requestKey !== currentHomeSessionKey()) {
          return
        }
        setSession((previous) => {
          if (previous?.requestKey !== requestKey) {
            return previous
          }
          return transitionHomeSession(previous, event, contentState.get().entries)
        })
      }),
    [requestKey],
  )

  const activeSession = session?.requestKey === requestKey ? session : null
  const projection = activeSession ? projectHomeSession(activeSession, entries) : null
  const hasProjectedEntries =
    projection?.highlightIds.some((id) => id != null) || projection?.recentIds.length > 0
  const isZeroUnread = Boolean(activeSession && total === 0 && !hasProjectedEntries)
  const isInitialLoading = !activeSession && !isArticleListReady && !articleListError
  const isInitialError = !activeSession && isArticleListReady && articleListError
  return (
    <div aria-busy={isInitialLoading} className="home-editorial">
      <SearchAndSortBar fullWidth homeMode />
      <AdaptiveScrollArea
        ref={entryListRef}
        className="home-editorial-scroll"
        scrollableNodeProps={{ ref: cardsRef, tabIndex: -1 }}
        style={{ height: "100%" }}
      >
        <div className="home-editorial-content">
          {isInitialLoading && <HomeStates.Loading />}
          {isInitialError && <HomeStates initialError retryArticleList={retryArticleList} />}
          {projection && !isZeroUnread && (
            <>
              <HomeHighlights
                articleActivation={articleActivation}
                entries={entries}
                highlightIds={projection.highlightIds}
                observeRead={observeRead}
                personalizationApplied={Boolean(activeSession.personalizationApplied)}
              />
              <HomeRecent
                articleActivation={articleActivation}
                entries={entries}
                highlightIds={projection.highlightIds}
                observeRead={observeRead}
                recentIds={projection.recentIds}
                scrollRootRef={cardsRef}
              />
              <LoadMoreSentinel getEntries={getEntries} scrollRootRef={cardsRef} />
            </>
          )}
          {isZeroUnread && <HomeStates isZeroUnread />}
          {projection && (
            <HomeStates
              refreshError={Boolean(articleListError)}
              retryArticleList={retryArticleList}
            />
          )}
          {projection && isZeroUnread && loadMoreVisible && (
            <LoadMoreSentinel getEntries={getEntries} scrollRootRef={cardsRef} />
          )}
        </div>
      </AdaptiveScrollArea>
    </div>
  )
}

export default HomeEditorial
