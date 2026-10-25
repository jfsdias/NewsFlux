import { Message, Modal, Notification } from "@arco-design/web-react"
import { useState } from "react"
import { useNavigate } from "react-router"

import { deleteFeed, getFeedEntries, refreshFeed } from "@/apis"
import { markFeedAsRead as markFeedAsReadAPI } from "@/apis/feeds"
import useAppData from "@/hooks/useAppData"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import { contentState, invalidateArticleList, setEntries } from "@/store/contentState"
import { dataState, getDataSessionRevision, setFeedsData, setUnreadInfo } from "@/store/dataState"
import {
  getCurrentHomePath,
  getCurrentHomeTarget,
  resetCurrentHomeTargetIfMatches,
} from "@/store/homePageState"
import { currentRoutePathState } from "@/store/locationState"
import { confirmDialogProps, destructiveConfirmButtonProps } from "@/utils/confirm-dialog"
import hasProviderReportedFeedError from "@/utils/feed-health"
import { createEntityHomeTarget, isSameHomeTarget } from "@/utils/home-page"

const feedHealthRetriesInFlight = new Set()

export const handleFeedRefresh = async (
  refreshFunc,
  refreshFeedData,
  displayMessage = true,
  useNotification = false,
  { reconcileProviderData = true } = {},
) => {
  const { polyglot } = polyglotState.get()

  const showMessage = (message, type = "success") => {
    if (useNotification) {
      Notification[type]({ title: message })
    } else {
      Message[type](message)
    }
  }

  const sessionRevision = getDataSessionRevision()
  const isCurrentSession = () => sessionRevision === getDataSessionRevision()

  try {
    const response = await refreshFunc()
    if (!isCurrentSession()) {
      return false
    }

    if (response.status !== 204) {
      throw new Error(`Unexpected refresh status: ${response.status}`)
    }

    if (reconcileProviderData) {
      await refreshFeedData({ force: true })
      if (!isCurrentSession()) {
        return false
      }
    }

    if (displayMessage) {
      showMessage(polyglot.t("feed_table.refresh_success"))
    }

    return true
  } catch (error) {
    if (!isCurrentSession()) {
      return false
    }

    console.error("Failed to refresh feed:", error)
    if (displayMessage) {
      showMessage(polyglot.t("feed_table.refresh_error"), "error")
    }
    return false
  }
}

export const handleBulkFeedRefresh = async ({
  feeds,
  refreshSingleFeed,
  refreshFeedData,
  waitBetweenRequests = async () => {},
}) => {
  const sessionRevision = getDataSessionRevision()
  const isCurrentSession = () => sessionRevision === getDataSessionRevision()
  let successCount = 0
  let failureCount = 0

  for (const feed of feeds) {
    if (!isCurrentSession()) {
      return { status: "stale-session", successCount, failureCount }
    }

    try {
      const isSuccessful = await refreshSingleFeed(feed, false, {
        reconcileProviderData: false,
      })
      isSuccessful ? successCount++ : failureCount++
    } catch {
      failureCount++
    }

    if (!isCurrentSession()) {
      return { status: "stale-session", successCount, failureCount }
    }

    await waitBetweenRequests()

    if (!isCurrentSession()) {
      return { status: "stale-session", successCount, failureCount }
    }
  }

  if (feeds.length === 0) {
    return { status: "completed", successCount, failureCount }
  }

  try {
    await refreshFeedData({ force: true })
  } catch (error) {
    if (!isCurrentSession()) {
      return { status: "stale-session", successCount, failureCount }
    }
    return { status: "metadata-reload-failure", successCount, failureCount, error }
  }

  if (!isCurrentSession()) {
    return { status: "stale-session", successCount, failureCount }
  }

  return { status: "completed", successCount, failureCount }
}

export const useFeedOperations = (useNotification = false) => {
  const { polyglot } = polyglotState.get()
  const { infoFrom, infoId } = contentState.get()
  const { refreshFeedData } = useAppData()
  const refreshCounts = useRefreshCounts()
  const navigate = useNavigate()
  const [retryingFeedIds, setRetryingFeedIds] = useState(() => new Set())

  const showMessage = (message, type = "success") => {
    if (useNotification) {
      Notification[type]({ title: message })
    } else {
      Message[type](message)
    }
  }

  const refreshSingleFeed = async (feed, displayMessage = true, options = {}) => {
    const feedId = feed.id || feed.key
    return handleFeedRefresh(
      () => refreshFeed(feedId),
      refreshFeedData,
      displayMessage,
      useNotification,
      options,
    )
  }

  const retryFeedHealth = async (feed) => {
    const feedId = feed.id || feed.key
    const feedKey = String(feedId)

    if (feed.disabled === true || !hasProviderReportedFeedError(feed)) {
      return { status: "not-eligible" }
    }
    if (feedHealthRetriesInFlight.has(feedKey)) {
      return { status: "already-running" }
    }

    const sessionRevision = getDataSessionRevision()
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    feedHealthRetriesInFlight.add(feedKey)
    setRetryingFeedIds((currentIds) => new Set(currentIds).add(feedKey))

    const showRetryError = (error) => {
      console.error(`Failed to reconcile feed ${feedId} after retry:`, error)
      showMessage(polyglot.t("feed_table.refresh_error"), "error")
    }

    try {
      let response
      try {
        response = await refreshFeed(feedId)
      } catch (error) {
        if (!isCurrentSession()) {
          return { status: "stale-after-refresh" }
        }
        showRetryError(error)
        return { status: "request-failure", error }
      }

      if (!isCurrentSession()) {
        return { status: "stale-after-refresh" }
      }
      if (response.status !== 204) {
        const error = new Error(`Unexpected refresh status: ${response.status}`)
        showRetryError(error)
        return { status: "request-failure", error }
      }

      try {
        await refreshFeedData({ force: true })
      } catch (error) {
        if (!isCurrentSession()) {
          return { status: "stale-after-metadata-reload" }
        }
        showRetryError(error)
        return { status: "metadata-reload-failure", error }
      }

      if (!isCurrentSession()) {
        return { status: "stale-after-metadata-reload" }
      }

      const refreshedFeed = dataState
        .get()
        .feedsData.find((candidate) => String(candidate.id) === feedKey)

      if (!refreshedFeed) {
        return { status: "disappeared" }
      }
      if (refreshedFeed.disabled === true) {
        return { status: "disabled", feed: refreshedFeed }
      }
      if (Number(refreshedFeed.parsing_error_count ?? 0) === 0) {
        showMessage(polyglot.t("feed_table.refresh_success"))
        return { status: "recovered", feed: refreshedFeed }
      }

      return { status: "still-error", feed: refreshedFeed }
    } finally {
      feedHealthRetriesInFlight.delete(feedKey)
      if (isCurrentSession()) {
        setRetryingFeedIds((currentIds) => {
          const nextIds = new Set(currentIds)
          nextIds.delete(feedKey)
          return nextIds
        })
      }
    }
  }

  const deleteFeedDirectly = async (feed) => {
    try {
      const feedId = feed.id || feed.key
      const response = await deleteFeed(feedId)
      if (response.status !== 204) {
        throw new Error(`Unexpected status: ${response.status}`)
      }

      const feedTarget = createEntityHomeTarget("feed", feedId)
      const feedPath = `/feed/${feedId}`
      setFeedsData((feeds) => feeds.filter((candidate) => candidate.id !== feedId))

      const homePageWasReset = resetCurrentHomeTargetIfMatches(feedTarget)
      const currentPath = currentRoutePathState.get()
      if (currentPath === feedPath || currentPath.startsWith(`${feedPath}/`)) {
        navigate(getCurrentHomePath() ?? "/", { replace: true })
      }

      const successMessage = polyglot.t("feed_table.remove_feed_success", { title: feed.title })
      showMessage(successMessage)
      if (homePageWasReset) {
        showMessage(polyglot.t("home_page.fallback_notice"), "warning")
      }
      return true
    } catch (error) {
      console.error(`Failed to delete feed: ${feed.title}`, error)
      const errorMessage = polyglot.t("feed_table.remove_feed_error", { title: feed.title })
      showMessage(errorMessage, "error")
      return false
    }
  }

  const handleDeleteFeed = async (feed) => {
    try {
      const feedId = feed.id || feed.key
      const feedTarget = createEntityHomeTarget("feed", feedId)
      const isHomePage = isSameHomeTarget(getCurrentHomeTarget(), feedTarget)
      const homePageWarning = isHomePage ? ` ${polyglot.t("home_page.delete_warning")}` : ""
      const starredEntries = await getFeedEntries(feedId, null, true)
      const hasStarredEntries = starredEntries.total > 0
      const confirmTitle = polyglot.t("feed_table.remove_feed_confirm_title")
      const confirmContent = hasStarredEntries
        ? polyglot.t("feed_table.remove_feed_confirm_content", {
            count: starredEntries.total,
          })
        : polyglot.t("feed_table.table_feed_remove_confirm", { title: feed.title })

      Modal.confirm({
        ...confirmDialogProps,
        cancelText: polyglot.t("search.cancel"),
        content: `${confirmContent}${homePageWarning}`,
        okButtonProps: { ...destructiveConfirmButtonProps, status: "danger" },
        okText: polyglot.t("sidebar.context_menu.delete_feed"),
        title: confirmTitle,
        onOk: () => deleteFeedDirectly(feed),
      })
    } catch (error) {
      console.error("Failed to check starred entries:", error)
      const errorMessage = polyglot.t("feed_table.check_starred_error")
      showMessage(errorMessage, "error")
    }
  }

  const markFeedAsRead = async (feed) => {
    try {
      await markFeedAsReadAPI(feed.id)

      setUnreadInfo((prevUnreadInfo) => ({
        ...prevUnreadInfo,
        [feed.id]: 0,
      }))

      if (infoFrom === "feed" && feed.id === Number(infoId)) {
        setEntries((prev) => prev.map((entry) => ({ ...entry, status: "read" })))
      }

      invalidateArticleList()
      await refreshCounts({ force: true })

      const successMessage = polyglot.t("article_list.mark_all_as_read_success")
      showMessage(successMessage)
    } catch (error) {
      console.error("Failed to mark feed as read:", error)
      invalidateArticleList()
      await refreshCounts({ force: true })
      const errorMessage = polyglot.t("article_list.mark_all_as_read_error")
      showMessage(errorMessage, "error")
    }
  }

  return {
    refreshSingleFeed,
    retryFeedHealth,
    retryingFeedIds,
    deleteFeedDirectly,
    handleDeleteFeed,
    markFeedAsRead,
  }
}
