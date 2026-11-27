import { atom, computed, map } from "nanostores"

import {
  dataState,
  feedsState,
  isEntryScopeFullyVisible,
  unreadTotalState,
  visibleFeedsState,
} from "./dataState"
import { settingsState } from "./settingsState"

import { reconcileArticleListFilterScope } from "@/utils/article-list-filter-scope"
import { hasArticleListFilters } from "@/utils/article-list-filters"
import createArticleListSnapshotIdentity from "@/utils/article-list-snapshot-identity"
import { extractHeadings } from "@/utils/dom"
import { projectDuplicates } from "@/utils/duplicate-projection"
import createSetter, { selectStore } from "@/utils/nanostores"

const defaultValue = {
  activeContent: null, // Article currently open in the reader
  articleListError: false,
  articleListErrorCategory: null,
  articleListRevision: 0,
  articleListSnapshotIdentity: null,
  articleListSnapshotRevision: 0,
  entries: [], // All articles returned by the API
  filterDate: null, // Search date
  filterString: "", // Search text
  homePaginationBoundary: null,
  infoFrom: "all", // all | today | starred | history | feed | category
  infoId: null, // Feed or category id
  isArticleListReady: false, // Whether the article list has finished loading
  isArticleLoading: false, // Whether an article is loading
  isOriginalContentFetched: false,
  originalContentRequestTokens: {},
  temporalPaginationState: null,
  loadMoreError: false,
  loadMoreVisible: false, // Visibility of the load-more element
  total: 0, // Raw total article count from the API, not limited by the returned data length
}

export const contentState = map(defaultValue)

export const activeContentState = selectStore(contentState, ({ activeContent }) => activeContent)
const activeContentIdState = selectStore(
  activeContentState,
  (activeContent) => activeContent?.id ?? null,
)
export const isOriginalContentLoadingState = selectStore(
  contentState,
  ({ activeContent, originalContentRequestTokens }) =>
    activeContent ? Object.hasOwn(originalContentRequestTokens, activeContent.id) : false,
)
export const createEntrySelectedState = (entryId) =>
  selectStore(activeContentIdState, (activeContentId) => activeContentId === entryId)

export const articleHeadingsState = selectStore(activeContentState, (activeContent) => {
  if (!activeContent) {
    return []
  }
  return activeContent.headings ?? extractHeadings(activeContent.content)
})

export const filteredEntriesState = computed(contentState, (content) => content.entries)

// Presentation state is shared by the list, relative actions and reader navigation.
export const duplicateViewState = atom({ scope: null, ids: new Set(), selectionMode: false })
export const duplicateProjectionState = computed(
  [contentState, settingsState, dataState, duplicateViewState],
  (content, settings, data, view) => {
    const identity = createArticleListSnapshotIdentity({
      content,
      settings,
      info: { from: content.infoFrom, id: content.infoId },
      sessionRevision: data.sessionRevision,
    })
    const scope = `${data.sessionRevision}:${identity}:${settings.removeDuplicates}`
    const ids = view.scope === scope ? view.ids : new Set()
    const option =
      view.selectionMode || ["starred", "history"].includes(content.infoFrom)
        ? "none"
        : settings.removeDuplicates
    return { ...projectDuplicates(content.entries, option, ids), scope, ids }
  },
)
export const displayedEntriesState = computed(
  duplicateProjectionState,
  (projection) => projection.entries,
)
export const toggleDuplicateGroup = (id) => {
  const { scope, ids } = duplicateProjectionState.get()
  const next = new Set(ids)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  duplicateViewState.set({ ...duplicateViewState.get(), scope, ids: next })
}
export const setDuplicateSelectionMode = (selectionMode) => {
  if (duplicateViewState.get().selectionMode !== selectionMode) {
    duplicateViewState.set({ ...duplicateViewState.get(), selectionMode })
  }
}

export const dynamicCountState = computed(
  [contentState, dataState, unreadTotalState, settingsState, feedsState, visibleFeedsState],
  (content, data, unreadTotal, settings, feeds, visibleFeeds) => {
    const { infoFrom, total } = content
    const { showStatus } = settings

    // Search and non-"today" date filters use query totals, not unfiltered sidebar counts.
    if (hasArticleListFilters(content)) {
      return total
    }
    const { unreadStarredCount, unreadTodayCount, historyCount, starredCount } = data

    if (infoFrom === "starred") {
      return showStatus === "unread" ? unreadStarredCount : starredCount
    }

    if (infoFrom === "history") {
      return historyCount
    }

    if (showStatus === "unread") {
      switch (infoFrom) {
        case "all": {
          return unreadTotal
        }
        case "today": {
          return unreadTodayCount
        }
        case "feed": {
          const id = content.infoId
          if (id) {
            return feeds.find((feed) => feed.id === Number(id))?.unreadCount ?? 0
          }
          return total
        }
        case "category": {
          const id = content.infoId
          if (id) {
            const sourceFeeds = isEntryScopeFullyVisible("category", id) ? feeds : visibleFeeds
            const feedsInCategory = sourceFeeds.filter((feed) => feed.category.id === Number(id))
            return feedsInCategory.reduce((acc, feed) => acc + feed.unreadCount, 0)
          }
          return total
        }
      }
    }

    return total
  },
)

export const activeEntryIndexState = computed(
  [activeContentIdState, displayedEntriesState],
  (activeContentId, filteredEntries) => {
    if (activeContentId === null) {
      return -1
    }
    return filteredEntries.findIndex((entry) => entry.id === activeContentId)
  },
)

export const prevContentState = computed(
  [activeEntryIndexState, displayedEntriesState],
  (activeEntryIndex, filteredEntries) => {
    return filteredEntries[activeEntryIndex - 1]
  },
)

export const nextContentState = computed(
  [activeEntryIndexState, displayedEntriesState],
  (activeEntryIndex, filteredEntries) => {
    return filteredEntries[activeEntryIndex + 1]
  },
)

export const setActiveContent = (updater) => {
  const state = contentState.get()
  const nextActiveContent = typeof updater === "function" ? updater(state.activeContent) : updater
  if (Object.is(state.activeContent, nextActiveContent)) {
    return
  }

  const activeEntryChanged = state.activeContent?.id !== nextActiveContent?.id
  contentState.set({
    ...state,
    activeContent: nextActiveContent,
    isOriginalContentFetched: activeEntryChanged ? false : state.isOriginalContentFetched,
  })
}
export const setArticleListError = createSetter(contentState, "articleListError")
export const setArticleListErrorCategory = createSetter(contentState, "articleListErrorCategory")
export const incrementArticleListSnapshotRevision = () =>
  contentState.setKey(
    "articleListSnapshotRevision",
    (contentState.get().articleListSnapshotRevision ?? 0) + 1,
  )
export const commitArticleListSnapshot = ({
  entries: nextEntries,
  loadMoreVisible,
  snapshotIdentity,
  temporalPaginationState,
  total,
}) => {
  const current = contentState.get()

  contentState.set({
    ...current,
    articleListSnapshotIdentity: snapshotIdentity,
    articleListSnapshotRevision: (current.articleListSnapshotRevision ?? 0) + 1,
    entries: nextEntries,
    loadMoreVisible,
    temporalPaginationState,
    total,
  })
}
export const clearArticleListSnapshot = () => {
  const current = contentState.get()
  contentState.set({
    ...current,
    articleListSnapshotIdentity: null,
    entries: [],
    loadMoreVisible: false,
    temporalPaginationState: null,
    total: 0,
  })
}
export const setEntries = createSetter(contentState, "entries")
export const setHomePaginationBoundary = createSetter(contentState, "homePaginationBoundary")
export const setTemporalPaginationState = createSetter(contentState, "temporalPaginationState")
export const reconcileArticleListFilters = ({ filterDate, filterString }) => {
  const current = contentState.get()
  const nextFilterDate = filterDate ?? null
  const nextFilterString = filterString ?? ""
  if (current.filterDate === nextFilterDate && current.filterString === nextFilterString) {
    return false
  }

  contentState.set({
    ...current,
    filterDate: nextFilterDate,
    filterString: nextFilterString,
  })
  return true
}
export const setFilterDate = (filterDate) => {
  const { infoFrom } = contentState.get()
  contentState.setKey(
    "filterDate",
    ["home", "today"].includes(infoFrom) ? null : (filterDate ?? null),
  )
}
export const setFilterString = createSetter(contentState, "filterString")
export const setArticleListSource = ({ from, id }) => {
  const current = contentState.get()
  const nextScope = {
    from: from ?? "all",
    id: id ?? null,
    showStatus: settingsState.get().showStatus,
  }
  const previousScope = {
    from: current.infoFrom,
    id: current.infoId,
    showStatus: settingsState.get().showStatus,
  }
  const filters = reconcileArticleListFilterScope({
    previousScope,
    nextScope,
    filterDate: current.filterDate,
    filterString: current.filterString,
  })

  if (
    current.infoFrom === nextScope.from &&
    String(current.infoId ?? "") === String(nextScope.id ?? "") &&
    current.filterDate === filters.filterDate &&
    current.filterString === filters.filterString
  ) {
    return false
  }

  contentState.set({
    ...current,
    infoFrom: nextScope.from,
    infoId: nextScope.id,
    homePaginationBoundary:
      current.infoFrom === "home" && nextScope.from === "home"
        ? current.homePaginationBoundary
        : null,
    temporalPaginationState: null,
    filterDate: filters.filterDate,
    filterString: filters.filterString,
  })
  return true
}
export const setIsArticleListReady = createSetter(contentState, "isArticleListReady")
export const setIsArticleLoading = createSetter(contentState, "isArticleLoading")
const setOriginalContentRequestTokens = createSetter(contentState, "originalContentRequestTokens")

export const markOriginalContentFetched = (entryId) => {
  const { activeContent, isOriginalContentFetched } = contentState.get()
  if (activeContent?.id !== entryId || isOriginalContentFetched) {
    return false
  }

  contentState.setKey("isOriginalContentFetched", true)
  return true
}

export const acquireOriginalContentRequest = (entryId) => {
  const { originalContentRequestTokens: requestTokens } = contentState.get()
  if (Object.hasOwn(requestTokens, entryId)) {
    return null
  }

  const requestToken = Symbol()
  setOriginalContentRequestTokens({ ...requestTokens, [entryId]: requestToken })
  return requestToken
}

export const isOriginalContentRequestCurrent = (entryId, requestToken) => {
  const { originalContentRequestTokens: requestTokens } = contentState.get()
  return Object.hasOwn(requestTokens, entryId) && requestTokens[entryId] === requestToken
}

export const releaseOriginalContentRequest = (entryId, requestToken) => {
  const { originalContentRequestTokens: requestTokens } = contentState.get()
  if (!Object.hasOwn(requestTokens, entryId) || requestTokens[entryId] !== requestToken) {
    return
  }

  const remainingRequestTokens = { ...requestTokens }
  delete remainingRequestTokens[entryId]
  setOriginalContentRequestTokens(remainingRequestTokens)
}

export const setLoadMoreError = createSetter(contentState, "loadMoreError")
export const setLoadMoreVisible = createSetter(contentState, "loadMoreVisible")
export const setTotal = createSetter(contentState, "total")
export const resetContent = () => contentState.set(defaultValue)

const isFeedInCurrentArticleList = (feed, { infoFrom, infoId }) => {
  switch (infoFrom) {
    case "all":
    case "today": {
      return true
    }
    case "feed": {
      return Number(feed.id ?? feed.key) === Number(infoId)
    }
    case "category": {
      return Number(feed.category?.id) === Number(infoId)
    }
    default: {
      return false
    }
  }
}

export const invalidateArticleList = () => {
  const { articleListRevision } = contentState.get()
  contentState.setKey("articleListRevision", (articleListRevision ?? 0) + 1)
}

export const invalidateArticleListForFeed = (feed) => {
  if (isFeedInCurrentArticleList(feed, contentState.get())) {
    invalidateArticleList()
  }
}
