import { IconLeft, IconRight } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import classNames from "classnames"
import { AnimatePresence } from "framer-motion"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router"
import { useSwipeable } from "react-swipeable"

import FooterPanel from "./FooterPanel"

import { getEntry } from "@/apis"
import ArticleList from "@/components/Article/ArticleList"
import SearchAndSortBar from "@/components/Article/SearchAndSortBar"
import FadeTransition from "@/components/ui/FadeTransition"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import useAppData from "@/hooks/useAppData"
import useArticleList from "@/hooks/useArticleList"
import useArticleSelection from "@/hooks/useArticleSelection"
import useContentContext from "@/hooks/useContentContext"
import useContentHotkeys from "@/hooks/useContentHotkeys"
import useDocumentTitle from "@/hooks/useDocumentTitle"
import useKeyHandlers from "@/hooks/useKeyHandlers"
import useMarkSelectedRead from "@/hooks/useMarkSelectedRead"
import useReaderNavigation from "@/hooks/useReaderNavigation"
import useScreenWidth from "@/hooks/useScreenWidth"
import {
  contentState,
  setActiveContent,
  setArticleListSource,
  setIsArticleLoading,
} from "@/store/contentState"
import { dataState } from "@/store/dataState"
import {
  articleListLayoutState,
  articleListRequestSettingsState,
  contentGestureSettingsState,
} from "@/store/settingsState"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { isRightToLeftBrowsing } from "@/utils/content-browsing-direction"
import prepareEntry from "@/utils/entry-presentation"

import "./Content.css"

const ArticleDetail = lazy(() => import("@/components/Article/ArticleDetail"))

const ContentHotkeyRegistration = ({ handleRefreshArticleList }) => {
  useContentHotkeys({ handleRefreshArticleList })
  return null
}

const isInHorizontalScrollable = (element) => {
  let el = element
  while (el && el !== document.body) {
    const { overflowX } = globalThis.getComputedStyle(el)
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) {
      return true
    }
    el = el.parentElement
  }
  return false
}

const shouldIgnoreSwipe = (element) =>
  isInHorizontalScrollable(element) || Boolean(element?.closest?.(".plyr, audio, video"))

const Content = ({ info, getEntries, listContent: ListContent, entryIdOverride }) => {
  const { from: source, id: sourceId } = info
  const contentSnapshot = useStore(contentState, {
    keys: [
      "activeContent",
      "articleListRevision",
      "filterDate",
      "filterString",
      "infoFrom",
      "infoId",
      "isArticleLoading",
    ],
  })
  const { activeContent, isArticleLoading } = contentSnapshot
  const requestSettings = useStore(articleListRequestSettingsState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const [markAllReadJumpRequestKey, setMarkAllReadJumpRequestKey] = useState(null)
  const { contentBrowsingDirection, enableSwipeGesture, swipeSensitivity } = useStore(
    contentGestureSettingsState,
  )
  const articleListLayout = useStore(articleListLayoutState)
  const isBrowsingRightToLeft = isRightToLeftBrowsing(contentBrowsingDirection)
  const isFullWidthLayout = articleListLayout === "card" || articleListLayout === "list"

  const [isSwipingLeft, setIsSwipingLeft] = useState(false)
  const [isSwipingRight, setIsSwipingRight] = useState(false)
  const cardsRef = useRef(null)
  const entryRequestIdRef = useRef(0)
  const ignoreSwipeRef = useRef(false)
  const swipeDirectionRef = useRef(null)

  const { entryId: routeEntryId } = useParams()
  const entryId = entryIdOverride ?? routeEntryId

  const pageTitle = useDocumentTitle()

  const {
    entryDetailRef,
    entryListRef,
    handleEntryClick,
    handleEntryUnavailable,
    restoreEntryListFocus,
  } = useContentContext()
  const [homeProjection, setHomeProjection] = useState(null)
  const handleHomeProjectionChange = useCallback((projection) => {
    setHomeProjection((previous) => {
      if (
        previous?.requestKey === projection?.requestKey &&
        previous?.sessionRevision === projection?.sessionRevision &&
        previous?.highlightIds?.join(",") === projection?.highlightIds?.join(",") &&
        previous?.recentIds?.join(",") === projection?.recentIds?.join(",")
      ) {
        return previous
      }
      return projection
    })
  }, [])
  const readerNavigation = useReaderNavigation({
    source,
    sourceId,
    getEntries,
    homeProjection,
  })
  const readerCommandHandlers = useKeyHandlers({ readerNavigation })
  const readerCommands = {
    ...readerCommandHandlers,
    canNavigateNext: readerNavigation.canNavigateNext,
    canNavigatePrevious: readerNavigation.canNavigatePrevious,
    isResolving: readerNavigation.isResolving,
  }
  const { navigateToNextArticle, navigateToPreviousArticle } = readerCommands

  const { refreshFeedData } = useAppData()
  const { isBelowMedium } = useScreenWidth()
  const currentArticleListRequestKey = createArticleListRequestKey({
    content: contentSnapshot,
    settings: requestSettings,
    info: { from: source, id: sourceId },
    sessionRevision,
  })
  const isMarkAllReadJumpPending = markAllReadJumpRequestKey === currentArticleListRequestKey

  const selection = useArticleSelection({
    from: source,
    id: sourceId,
    homeMode: Boolean(ListContent),
  })
  const { isBusy: isMarkingSelectedRead, markSelectedRead } = useMarkSelectedRead(selection)

  useEffect(() => {
    const { activeContent: storedActiveContent, infoFrom, infoId } = contentState.get()
    const sourceChanged = infoFrom !== source || String(infoId ?? "") !== String(sourceId ?? "")

    setArticleListSource({ from: source, id: sourceId })
    if (sourceChanged) {
      setIsArticleLoading(false)
      if (storedActiveContent) {
        setActiveContent(null)
      }
    }

    return () => {
      entryRequestIdRef.current += 1
    }
  }, [source, sourceId])

  const { fetchArticleList } = useArticleList(source, sourceId, getEntries)

  const fetchArticleListWithRelatedData = useCallback(
    () => Promise.allSettled([fetchArticleList(), refreshFeedData()]),
    [fetchArticleList, refreshFeedData],
  )

  const fetchSingleEntry = useCallback(
    async (entryId) => {
      const requestId = ++entryRequestIdRef.current
      const isCurrentRequest = () => entryRequestIdRef.current === requestId
      const numericEntryId = Number(entryId)
      const existingEntry = contentState.get().entries.find((entry) => entry.id === numericEntryId)

      if (existingEntry) {
        setIsArticleLoading(false)
        setActiveContent(existingEntry)
        return
      }

      try {
        setIsArticleLoading(true)
        const entry = await getEntry(entryId)
        if (isCurrentRequest()) {
          setActiveContent(prepareEntry(entry))
        }
      } catch (error) {
        if (isCurrentRequest()) {
          console.error("Failed to fetch entry:", error)
          handleEntryUnavailable(error, isCurrentRequest)
        }
      } finally {
        if (isCurrentRequest()) {
          setIsArticleLoading(false)
        }
      }
    },
    [handleEntryUnavailable],
  )

  const handleSwiping = (eventData) => {
    if (swipeDirectionRef.current === eventData.dir) {
      return
    }

    swipeDirectionRef.current = eventData.dir
    setIsSwipingLeft(eventData.dir === "Left")
    setIsSwipingRight(eventData.dir === "Right")
  }

  const handleSwiped = () => {
    swipeDirectionRef.current = null
    setIsSwipingLeft(false)
    setIsSwipingRight(false)
  }

  const handleSwipeLeft = useCallback(
    () => (isBrowsingRightToLeft ? navigateToPreviousArticle() : navigateToNextArticle()),
    [isBrowsingRightToLeft, navigateToNextArticle, navigateToPreviousArticle],
  )

  const handleSwipeRight = useCallback(
    () => (isBrowsingRightToLeft ? navigateToNextArticle() : navigateToPreviousArticle()),
    [isBrowsingRightToLeft, navigateToNextArticle, navigateToPreviousArticle],
  )

  const handlers = useSwipeable({
    delta: 50 / swipeSensitivity,
    onTouchStartOrOnMouseDown: enableSwipeGesture
      ? ({ event }) => {
          ignoreSwipeRef.current =
            Boolean(globalThis.getSelection()?.toString()) || shouldIgnoreSwipe(event.target)
        }
      : undefined,
    onSwiping: enableSwipeGesture
      ? (eventData) => {
          if (!ignoreSwipeRef.current) {
            handleSwiping(eventData)
          }
        }
      : undefined,
    onSwiped: enableSwipeGesture ? handleSwiped : undefined,
    onSwipedLeft: enableSwipeGesture
      ? () => {
          if (!ignoreSwipeRef.current) {
            handleSwipeLeft()
          }
        }
      : undefined,
    onSwipedRight: enableSwipeGesture
      ? () => {
          if (!ignoreSwipeRef.current) {
            handleSwipeRight()
          }
        }
      : undefined,
    onTouchEndOrOnMouseUp: enableSwipeGesture
      ? () => {
          ignoreSwipeRef.current = false
          swipeDirectionRef.current = null
        }
      : undefined,
  })

  useEffect(() => {
    if (source === "category") {
      refreshFeedData().catch((error) => {
        console.error("Failed to refresh category feed data:", error)
      })
    }
  }, [refreshFeedData, source, sourceId])

  useEffect(() => {
    const currentActiveContent = contentState.get().activeContent

    if (entryId) {
      if (currentActiveContent?.id !== Number(entryId)) {
        fetchSingleEntry(entryId)
      }
    } else {
      entryRequestIdRef.current += 1
      if (currentActiveContent) {
        setActiveContent(null)
        restoreEntryListFocus(currentActiveContent.id)
      }
      setIsArticleLoading(false)
    }
  }, [entryId, fetchSingleEntry, restoreEntryListFocus, source, sourceId])

  const isDetailLayerActive = Boolean(activeContent)
  const isEntryColFullWidth = isFullWidthLayout || !isDetailLayerActive

  return (
    <ReaderCommandsContext.Provider value={readerCommands}>
      <>
        <ContentHotkeyRegistration handleRefreshArticleList={fetchArticleListWithRelatedData} />
        {!activeContent && <h1 className="a11y-visually-hidden">{pageTitle}</h1>}
        <div
          aria-hidden={isDetailLayerActive || undefined}
          className={classNames("entry-col", { "entry-col-full-width": isEntryColFullWidth })}
          inert={isDetailLayerActive || undefined}
          style={{
            opacity: isBelowMedium && isArticleLoading ? 0 : 1,
          }}
        >
          {ListContent ? (
            <ListContent
              cardsRef={cardsRef}
              entryListRef={entryListRef}
              getEntries={getEntries}
              handleEntryClick={handleEntryClick}
              refreshArticleList={fetchArticleListWithRelatedData}
              retryArticleList={fetchArticleList}
              onReaderProjectionChange={handleHomeProjectionChange}
            />
          ) : (
            <>
              <SearchAndSortBar
                fullWidth={isFullWidthLayout}
                selectedCount={selection.selectedCount}
                selectionAvailable={selection.isAvailable}
                selectionBusy={isMarkingSelectedRead}
                selectionMode={selection.isSelectionMode}
                selectionTriggerRef={selection.selectionTriggerRef}
                onCancelSelection={selection.exitSelectionMode}
                onEnterSelectionMode={selection.enterSelectionMode}
                onMarkSelectedRead={markSelectedRead}
              />
              <ArticleList
                ref={entryListRef}
                cardsRef={cardsRef}
                getEntries={getEntries}
                handleEntryClick={handleEntryClick}
                retryArticleList={fetchArticleList}
                selectedEntryIds={selection.selectedIds}
                selectionBusy={isMarkingSelectedRead}
                selectionMode={selection.isSelectionMode}
                suppressEmptyState={isMarkAllReadJumpPending}
                onSelectionCheckboxFocus={selection.noteCheckboxFocus}
                onToggleSelection={selection.toggleEntry}
              />
              <FooterPanel
                bulkOperationsDisabled={isMarkingSelectedRead}
                getEntries={getEntries}
                info={info}
                refreshArticleList={fetchArticleListWithRelatedData}
                onMarkAllReadJumpPendingChange={setMarkAllReadJumpRequestKey}
              />
            </>
          )}
        </div>
        {activeContent ? (
          <div
            className="article-container article-container-full-size content-wrapper"
            {...handlers}
          >
            {isArticleLoading ? (
              <div style={{ flex: 1 }} />
            ) : (
              <>
                <AnimatePresence>
                  {isSwipingRight && (
                    <FadeTransition key="swipe-hint-left" className="swipe-hint left">
                      <IconLeft style={{ fontSize: 24 }} />
                    </FadeTransition>
                  )}
                  {isSwipingLeft && (
                    <FadeTransition key="swipe-hint-right" className="swipe-hint right">
                      <IconRight style={{ fontSize: 24 }} />
                    </FadeTransition>
                  )}
                </AnimatePresence>
                <Suspense fallback={<div aria-busy="true" style={{ flex: 1 }} />}>
                  <ArticleDetail ref={entryDetailRef} />
                </Suspense>
              </>
            )}
          </div>
        ) : null}
      </>
    </ReaderCommandsContext.Provider>
  )
}

export default Content
