import {
  Button,
  Divider,
  Dropdown,
  Form,
  Menu,
  Modal,
  Notification,
  Popover,
  Skeleton,
  Typography,
} from "@arco-design/web-react"
import {
  IconCalendar,
  IconDelete,
  IconDownload,
  IconEdit,
  IconExclamationCircle,
  IconEye,
  IconEyeInvisible,
  IconHistory,
  IconHome,
  IconMinusCircle,
  IconMoreVertical,
  IconRefresh,
  IconRight,
  IconStar,
  IconUnorderedList,
  IconUpload,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import classNames from "classnames"
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { Virtualizer } from "virtua"

const SidebarNavigationContext = createContext(null)

import AddFeed from "./AddFeed.jsx"
import Profile from "./Profile.jsx"

import {
  exportOPML,
  getCategoryEntries,
  getFeedEntries,
  importOPML,
  markEntriesAsReadInBatches,
  updateEntriesStatusInBatches,
} from "@/apis"
import { refreshCategoryFeed } from "@/apis/categories"
import AdaptiveScrollArea from "@/components/ui/AdaptiveScrollArea"
import CustomTooltip from "@/components/ui/CustomTooltip"
import EditCategoryModal from "@/components/ui/EditCategoryModal"
import EditFeedModal from "@/components/ui/EditFeedModal"
import FeedSourceMark from "@/components/ui/FeedSourceMark"
import useAppData from "@/hooks/useAppData"
import useCategoryOperations from "@/hooks/useCategoryOperations"
import { useFeedOperations } from "@/hooks/useFeedOperations"
import useHomePage from "@/hooks/useHomePage"
import { polyglotState } from "@/hooks/useLanguage"
import useLongPressContextMenu from "@/hooks/useLongPressContextMenu"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import useScreenWidth from "@/hooks/useScreenWidth"
import {
  contentState,
  invalidateArticleList,
  invalidateArticleListForFeed,
  setActiveContent,
  setEntries,
} from "@/store/contentState"
import {
  dataState,
  feedsGroupedByIdState,
  getDataSessionRevision,
  isEntryScopeFullyVisible,
  unreadTotalState,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState, updateSettings } from "@/store/settingsState"
import { expandedCategoriesState, setExpandedCategories } from "@/store/sidebarState"
import { confirmDialogProps } from "@/utils/confirm-dialog"
import { PRODUCT_NAME } from "@/utils/constants"
import { generateReadableDate } from "@/utils/date"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import hasProviderReportedFeedError from "@/utils/feed-health"
import { downloadFile, readFileAsText } from "@/utils/file"
import { createEntityHomeTarget, isSameHomeTarget } from "@/utils/home-page"
import {
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  markAllReadOperationCoordinator,
  markAllReadUndoActions,
  performCoordinatedMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import {
  isSidebarSourceListAffected,
  markSidebarSourceEntriesAsRead,
  requestSidebarMarkAllRead,
} from "@/utils/sidebar-mark-all-read"
import {
  getCurrentZeroUnreadSource,
  getMatchingCategories,
  getSearchExpandedCategoryKeys,
  getUnreadNavigationFeeds,
  getVisibleFeedSearchMatches,
} from "@/utils/source-navigation"

import "./Sidebar.css"

const LOGO_URL = `${import.meta.env.BASE_URL}logo192.png`
const MenuItem = Menu.Item

const CategoryTitle = ({
  category,
  path,
  homePageReady,
  homeTarget,
  onDeleteCategory,
  onEditCategory,
  onMarkAllAsRead,
  onRefreshCategory,
  onSetHomePage,
}) => {
  const feedsGroupedById = useStore(feedsGroupedByIdState)
  const unreadCount = feedsGroupedById[category.id]?.reduce(
    (acc, feed) => acc + feed.unreadCount,
    0,
  )

  const { isBelowMedium } = useScreenWidth()
  const { polyglot } = useStore(polyglotState)

  const onNavigate = useContext(SidebarNavigationContext)
  const { dropdownProps, longPressProps } = useLongPressContextMenu()

  const canDelete = !feedsGroupedById[category.id] || feedsGroupedById[category.id].length === 0
  const categoryTarget = createEntityHomeTarget("category", category.id)
  const isHomePage = isSameHomeTarget(homeTarget, categoryTarget)
  const categoryPath = `/category/${category.id}`
  const isCategoryActive = path === categoryPath || path.startsWith(`${categoryPath}/`)
  const categoryClassName = classNames("category-title", {
    "submenu-active": isCategoryActive,
    "submenu-inactive": !isCategoryActive,
  })

  return (
    <Dropdown
      {...dropdownProps}
      position="bl"
      trigger="contextMenu"
      droplist={
        <Menu className="mobile-action-menu">
          <MenuItem key="edit-category" onClick={() => onEditCategory(category)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.edit_category")}</span>
              <IconEdit />
            </div>
          </MenuItem>

          <MenuItem key="refresh-category" onClick={() => onRefreshCategory(category)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.refresh_category")}</span>
              <IconRefresh />
            </div>
          </MenuItem>

          <MenuItem key="mark-all-as-read" onClick={() => onMarkAllAsRead(category)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.mark_all_as_read")}</span>
              <IconMinusCircle />
            </div>
          </MenuItem>

          {canDelete && (
            <>
              <Divider style={{ margin: "4px 0" }} />

              <MenuItem key="delete-category" onClick={() => onDeleteCategory(category)}>
                <div className="settings-menu-item">
                  <span style={{ color: "var(--color-danger-light-4)" }}>
                    {polyglot.t("sidebar.context_menu.delete_category")}
                  </span>
                  <IconDelete style={{ color: "var(--color-danger-light-4)" }} />
                </div>
              </MenuItem>
            </>
          )}

          <Divider style={{ margin: "4px 0" }} />

          <MenuItem
            key="set-home-page"
            disabled={!homePageReady || isHomePage}
            onClick={() => onSetHomePage(categoryTarget, category.title)}
          >
            <div className="settings-menu-item">
              <span>
                {polyglot.t(
                  isHomePage
                    ? "sidebar.context_menu.current_home_page"
                    : "sidebar.context_menu.set_as_home_page",
                )}
              </span>
              <IconHome aria-hidden="true" />
            </div>
          </MenuItem>
        </Menu>
      }
    >
      <Link
        {...longPressProps}
        aria-current={isCategoryActive ? "page" : undefined}
        className={categoryClassName}
        data-category-edit-id={category.id}
        id={`category-link-${category.id}`}
        style={{ cursor: "pointer" }}
        to={categoryPath}
        onClick={() => {
          setActiveContent(null)
          onNavigate?.()
        }}
      >
        <Typography.Ellipsis
          expandable={false}
          showTooltip={!isBelowMedium}
          style={{
            width: unreadCount ? "80%" : "100%",
            fontWeight: 500,
          }}
        >
          {category.title}
        </Typography.Ellipsis>
        {unreadCount > 0 && (
          <Typography.Ellipsis
            className="unread-count"
            expandable={false}
            style={{ fontWeight: 500 }}
          >
            {unreadCount}
          </Typography.Ellipsis>
        )}
      </Link>
    </Dropdown>
  )
}

const CountDisplay = ({ count }) => {
  return (
    <Typography.Ellipsis className="item-count" expandable={false}>
      {count || ""}
    </Typography.Ellipsis>
  )
}

const SourceNavigationControls = ({
  escapeClearsQuery = true,
  polyglot,
  query,
  setQuery,
  showUnreadFeedsOnly,
}) => {
  return (
    <div className="source-navigation-controls">
      <fieldset
        aria-label={polyglot.t("sidebar.source_navigation_mode")}
        className="source-mode-selector"
        role="radiogroup"
      >
        <legend className="source-navigation-visually-hidden">
          {polyglot.t("sidebar.source_navigation_mode")}
        </legend>
        <label
          className={classNames("source-mode-option", {
            "source-mode-option-selected": showUnreadFeedsOnly,
          })}
        >
          <input
            checked={showUnreadFeedsOnly}
            data-testid="mode-unread"
            name="source-navigation-mode"
            tabIndex={showUnreadFeedsOnly ? 0 : -1}
            type="radio"
            value="unread"
            onChange={() => updateSettings({ showUnreadFeedsOnly: true })}
          />
          <span>{polyglot.t("sidebar.unread_mode")}</span>
        </label>
        <label
          className={classNames("source-mode-option", {
            "source-mode-option-selected": !showUnreadFeedsOnly,
          })}
        >
          <input
            checked={!showUnreadFeedsOnly}
            data-testid="mode-all"
            name="source-navigation-mode"
            tabIndex={showUnreadFeedsOnly ? -1 : 0}
            type="radio"
            value="all"
            onChange={() => updateSettings({ showUnreadFeedsOnly: false })}
          />
          <span>{polyglot.t("sidebar.all_mode")}</span>
        </label>
      </fieldset>
      <div className="source-filter">
        <label className="source-filter-label" htmlFor="source-navigation-filter">
          {polyglot.t("sidebar.source_filter")}
        </label>
        <div className="source-filter-input-row">
          <input
            aria-label={polyglot.t("sidebar.source_filter")}
            autoComplete="off"
            className="source-filter-input"
            data-testid="source-search"
            id="source-navigation-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (escapeClearsQuery && event.key === "Escape" && query) {
                event.preventDefault()
                event.stopPropagation()
                setQuery("")
              }
            }}
          />
          {query && (
            <Button
              aria-label={polyglot.t("sidebar.clear_source_filter")}
              className="source-filter-clear"
              data-testid="clear-source-search"
              size="small"
              type="button"
              onClick={() => setQuery("")}
            >
              <span aria-hidden="true">×</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const CustomMenuItem = ({ path, Icon, label, count }) => {
  const location = useLocation()
  const onNavigate = useContext(SidebarNavigationContext)
  const isSelected = location.pathname === path || location.pathname.startsWith(`${path}/`)

  return (
    <Link
      aria-current={isSelected ? "page" : undefined}
      to={path}
      className={classNames("arco-menu-item custom-menu-link", {
        "arco-menu-selected": isSelected,
      })}
      onClick={() => {
        setActiveContent(null)
        onNavigate?.()
      }}
    >
      <div className="custom-menu-item">
        <span>
          <Icon aria-hidden="true" />
          {label}
        </span>
        <CountDisplay count={count} />
      </div>
    </Link>
  )
}

const SidebarMenuItems = () => {
  const { infoFrom } = useStore(contentState, { keys: ["infoFrom"] })
  const { historyCount, starredCount, unreadTodayCount } = useStore(dataState, {
    keys: ["historyCount", "starredCount", "unreadTodayCount"],
  })
  const { polyglot } = useStore(polyglotState)
  const unreadTotal = useStore(unreadTotalState)

  return (
    <>
      <CustomMenuItem
        Icon={IconUnorderedList}
        count={unreadTotal}
        label={polyglot.t("sidebar.all")}
        path="/all"
      />
      <CustomMenuItem
        Icon={IconCalendar}
        count={unreadTodayCount}
        label={polyglot.t("sidebar.today")}
        path="/today"
      />
      <CustomMenuItem
        Icon={IconStar}
        count={infoFrom === "starred" ? starredCount : 0}
        label={polyglot.t("sidebar.starred")}
        path="/starred"
      />
      <CustomMenuItem
        Icon={IconHistory}
        count={infoFrom === "history" ? historyCount : 0}
        label={polyglot.t("sidebar.history")}
        path="/history"
      />
    </>
  )
}

const FeedMenuItem = ({
  feed,
  homePageReady,
  homeTarget,
  onDeleteFeed,
  onEditFeed,
  onMarkAllAsRead,
  onRefreshFeed,
  onRetryFeedHealth,
  retryingFeedIds,
  onSetHomePage,
  showZeroCount = false,
  className,
}) => {
  const { showFeedIcon } = useStore(settingsState, { keys: ["showFeedIcon"] })
  const { polyglot } = useStore(polyglotState)

  const { isBelowMedium } = useScreenWidth()

  const onNavigate = useContext(SidebarNavigationContext)
  const location = useLocation()
  const { dropdownProps, longPressProps } = useLongPressContextMenu()
  const navigationRef = useRef(null)
  const healthTriggerRef = useRef(null)
  const [detailsVisible, setDetailsVisible] = useState(false)
  const isSelected =
    location.pathname === `/feed/${feed.id}` || location.pathname.startsWith(`/feed/${feed.id}/`)
  const feedTarget = createEntityHomeTarget("feed", feed.id)
  const isHomePage = isSameHomeTarget(homeTarget, feedTarget)
  const hasFeedHealthError = hasProviderReportedFeedError(feed)
  const retrying = retryingFeedIds?.has(String(feed.id)) ?? false
  const detailsId = `feed-health-details-${feed.id}`
  const detailsLabel = polyglot.t("sidebar.feed_update_error")

  useEffect(() => {
    if (!hasFeedHealthError && detailsVisible) {
      globalThis.requestAnimationFrame(() => {
        setDetailsVisible(false)
        navigationRef.current?.focus({ preventScroll: true })
      })
    }
  }, [detailsVisible, hasFeedHealthError])

  const handleDetailsVisibilityChange = (visible) => {
    setDetailsVisible(visible)
    globalThis.requestAnimationFrame(() => {
      const focusTarget = hasFeedHealthError ? healthTriggerRef.current : navigationRef.current
      focusTarget?.focus({ preventScroll: true })
    })
  }

  const handleDetailsPanelKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      handleDetailsVisibilityChange(false)
    }
  }

  return (
    <Dropdown
      {...dropdownProps}
      position="bl"
      trigger="contextMenu"
      droplist={
        <Menu className="mobile-action-menu">
          <MenuItem key="edit-feed" onClick={() => onEditFeed(feed)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.edit_feed")}</span>
              <IconEdit />
            </div>
          </MenuItem>

          <MenuItem key="refresh-feed" onClick={() => onRefreshFeed(feed)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.refresh_feed")}</span>
              <IconRefresh />
            </div>
          </MenuItem>

          <MenuItem key="mark-all-as-read" onClick={() => onMarkAllAsRead(feed)}>
            <div className="settings-menu-item">
              <span>{polyglot.t("sidebar.context_menu.mark_all_as_read")}</span>
              <IconMinusCircle />
            </div>
          </MenuItem>

          <Divider style={{ margin: "4px 0" }} />

          <MenuItem key="delete-feed" onClick={() => onDeleteFeed(feed)}>
            <div className="settings-menu-item">
              <span style={{ color: "var(--color-danger-light-4)" }}>
                {polyglot.t("sidebar.context_menu.delete_feed")}
              </span>
              <IconDelete style={{ color: "var(--color-danger-light-4)" }} />
            </div>
          </MenuItem>

          <Divider style={{ margin: "4px 0" }} />

          <MenuItem
            key="set-home-page"
            disabled={!homePageReady || isHomePage}
            onClick={() => onSetHomePage(feedTarget, feed.title)}
          >
            <div className="settings-menu-item">
              <span>
                {polyglot.t(
                  isHomePage
                    ? "sidebar.context_menu.current_home_page"
                    : "sidebar.context_menu.set_as_home_page",
                )}
              </span>
              <IconHome aria-hidden="true" />
            </div>
          </MenuItem>
        </Menu>
      }
    >
      <div className="feed-menu-item-row">
        <Link
          ref={navigationRef}
          {...longPressProps}
          aria-current={isSelected ? "page" : undefined}
          data-feed-edit-id={feed.id}
          to={`/feed/${feed.id}`}
          className={classNames("arco-menu-item feed-menu-item", className, {
            "arco-menu-selected": isSelected,
          })}
          onClick={(e) => {
            e.stopPropagation()
            setActiveContent(null)
            onNavigate?.()
          }}
        >
          <div className="custom-menu-item">
            <Typography.Ellipsis
              expandable={false}
              showTooltip={!isBelowMedium}
              style={{
                width: feed.unreadCount ? "80%" : "100%",
                paddingLeft: "20px",
                boxSizing: "border-box",
              }}
            >
              {showFeedIcon && (
                <FeedSourceMark className="feed-icon-sidebar" feed={feed} size={16} />
              )}
              {hasFeedHealthError && (
                <span aria-hidden="true" className="feed-health-indicator">
                  <IconExclamationCircle />
                </span>
              )}
              {feed.title}
            </Typography.Ellipsis>
            {(feed.unreadCount !== 0 || showZeroCount) && (
              <Typography.Ellipsis className="item-count" expandable={false}>
                {feed.unreadCount}
              </Typography.Ellipsis>
            )}
          </div>
        </Link>
        {hasFeedHealthError && (
          <Popover
            className="feed-health-popover"
            escToClose={false}
            getPopupContainer={() => document.body}
            popupVisible={detailsVisible}
            position={isBelowMedium ? "bottom" : "rt"}
            trigger="click"
            content={
              <div
                aria-label={`${detailsLabel}: ${feed.title}`}
                className="feed-health-details"
                data-testid={detailsId}
                id={detailsId}
                role="dialog"
                onKeyDownCapture={handleDetailsPanelKeyDown}
              >
                <div className="feed-health-details-title">{detailsLabel}</div>
                <div className="feed-health-error-message">{feed.parsing_error_message}</div>
                {feed.checked_at && (
                  <div className="feed-health-checked-at">
                    <span>{polyglot.t("feed_table.table_checked_at")}</span>
                    <time dateTime={feed.checked_at}>{generateReadableDate(feed.checked_at)}</time>
                  </div>
                )}
                <Button
                  className="feed-health-retry"
                  disabled={retrying}
                  loading={retrying}
                  type="button"
                  onClick={() => onRetryFeedHealth?.(feed)}
                >
                  {polyglot.t("sidebar.context_menu.refresh_feed")}
                </Button>
              </div>
            }
            onVisibleChange={handleDetailsVisibilityChange}
          >
            <Button
              ref={healthTriggerRef}
              aria-controls={detailsId}
              aria-expanded={detailsVisible}
              aria-haspopup="dialog"
              className="feed-health-trigger"
              data-feed-health-trigger={feed.id}
              icon={<IconExclamationCircle aria-hidden="true" />}
              type="button"
              aria-label={polyglot.t("sidebar.feed_update_error_for_feed", {
                feed: feed.title,
              })}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape" && detailsVisible) {
                  event.preventDefault()
                  event.stopPropagation()
                  handleDetailsVisibilityChange(false)
                }
              }}
            />
          </Popover>
        )}
      </div>
    </Dropdown>
  )
}

const FeedMenuGroup = ({
  categoryId,
  sourceQuery,
  homePageReady,
  homeTarget,
  onDeleteFeed,
  onEditFeed,
  onMarkAllAsRead,
  onRefreshFeed,
  onRetryFeedHealth,
  retryingFeedIds,
  onSetHomePage,
}) => {
  const { compactSidebarGroups } = useStore(settingsState, {
    keys: ["compactSidebarGroups"],
  })
  const feedsGroupedById = useStore(feedsGroupedByIdState)

  const parentRef = useRef(null)
  const scrollableNodeRef = useRef(null)

  const filteredFeeds = useMemo(
    () => getVisibleFeedSearchMatches(feedsGroupedById[categoryId] || [], sourceQuery),
    [feedsGroupedById, categoryId, sourceQuery],
  )

  return (
    <AdaptiveScrollArea
      ref={parentRef}
      style={compactSidebarGroups ? { maxHeight: 400 } : {}}
      scrollableNodeProps={{
        ref: scrollableNodeRef,
        style: { minHeight: "40px" },
      }}
    >
      <Virtualizer bufferSize={200} data={filteredFeeds} scrollRef={scrollableNodeRef}>
        {(feed) => (
          <FeedMenuItem
            key={feed.id}
            feed={feed}
            homePageReady={homePageReady}
            homeTarget={homeTarget}
            retryingFeedIds={retryingFeedIds}
            onDeleteFeed={onDeleteFeed}
            onEditFeed={onEditFeed}
            onMarkAllAsRead={onMarkAllAsRead}
            onRefreshFeed={onRefreshFeed}
            onRetryFeedHealth={onRetryFeedHealth}
            onSetHomePage={onSetHomePage}
          />
        )}
      </Virtualizer>
    </AdaptiveScrollArea>
  )
}

const CategoryGroup = ({
  displayedExpandedCategories,
  sourceQuery,
  homePageReady,
  homeTarget,
  onDeleteCategory,
  onDeleteFeed,
  onEditCategory,
  onEditFeed,
  onMarkAllAsReadCategory,
  onMarkAllAsReadFeed,
  onRefreshCategory,
  onRefreshFeed,
  onRetryFeedHealth,
  retryingFeedIds,
  onSetHomePage,
  onToggleCategory,
}) => {
  const feedsGroupedById = useStore(feedsGroupedByIdState)
  const categories = useStore(visibleCategoriesState)

  const location = useLocation()
  const currentPath = location.pathname

  return getMatchingCategories(categories, feedsGroupedById, sourceQuery).map((category) => {
    const categoryPath = `/category/${category.id}`
    const contentId = `category-feeds-${category.id}`
    const isExpanded = displayedExpandedCategories.includes(categoryPath)

    return (
      <div
        key={category.id}
        style={{ position: "relative", overflow: "hidden" }}
        className={classNames("arco-collapse-item", {
          "arco-collapse-item-active": isExpanded,
        })}
      >
        <div className="arco-collapse-item-header category-disclosure-header">
          <button
            aria-controls={contentId}
            aria-expanded={isExpanded}
            aria-label={category.title}
            className="arco-collapse-item-icon-hover category-disclosure-button"
            data-category-disclosure={category.id}
            type="button"
            onClick={() => onToggleCategory(categoryPath)}
          >
            <span
              aria-hidden="true"
              className={classNames("arco-collapse-item-header-icon", {
                "arco-collapse-item-header-icon-down": isExpanded,
              })}
            >
              <IconRight />
            </span>
          </button>
          <div className="arco-collapse-item-header-title">
            <CategoryTitle
              category={category}
              homePageReady={homePageReady}
              homeTarget={homeTarget}
              path={currentPath}
              onDeleteCategory={onDeleteCategory}
              onEditCategory={onEditCategory}
              onMarkAllAsRead={onMarkAllAsReadCategory}
              onRefreshCategory={onRefreshCategory}
              onSetHomePage={onSetHomePage}
            />
          </div>
        </div>
        <div
          aria-labelledby={`category-link-${category.id}`}
          hidden={!isExpanded}
          id={contentId}
          className={classNames("arco-collapse-item-content", {
            "arco-collapse-item-content-expanded": isExpanded,
          })}
        >
          <div className="arco-collapse-item-content-box">
            <FeedMenuGroup
              categoryId={category.id}
              homePageReady={homePageReady}
              homeTarget={homeTarget}
              retryingFeedIds={retryingFeedIds}
              sourceQuery={sourceQuery}
              onDeleteFeed={onDeleteFeed}
              onEditFeed={onEditFeed}
              onMarkAllAsRead={onMarkAllAsReadFeed}
              onRefreshFeed={onRefreshFeed}
              onRetryFeedHealth={onRetryFeedHealth}
              onSetHomePage={onSetHomePage}
            />
          </div>
        </div>
      </div>
    )
  })
}

const MoreOptionsDropdown = () => {
  const { showHiddenFeeds } = useStore(settingsState, {
    keys: ["showHiddenFeeds"],
  })
  const { polyglot } = useStore(polyglotState)
  const [menuVisible, setMenuVisible] = useState(false)

  const { refreshFeedData } = useAppData()
  const refreshCounts = useRefreshCounts()

  const handleToggleFeedsVisibility = () => {
    updateSettings({ showHiddenFeeds: !showHiddenFeeds })
    void refreshCounts({ force: true })
  }

  const handleImportOPML = async (e) => {
    const file = e.target.files[0]
    if (!file) {
      return
    }

    try {
      const fileContent = await readFileAsText(file)
      const response = await importOPML(fileContent)

      if (response.status === 201) {
        Notification.success({
          title: polyglot.t("sidebar.import_opml_success"),
        })
        await refreshFeedData({ force: true }).catch((error) => {
          console.error("Failed to refresh data after OPML import:", error)
        })
      } else {
        Notification.error({
          title: polyglot.t("sidebar.import_opml_error"),
        })
      }
    } catch (error) {
      Notification.error({
        title: polyglot.t("sidebar.import_opml_error"),
        content: error.message,
      })
    }
  }

  const handleExportOPML = async () => {
    try {
      const opmlContent = await exportOPML()
      downloadFile(opmlContent, "feeds.opml", "text/xml")
      Notification.success({
        title: polyglot.t("sidebar.export_opml_success"),
      })
    } catch (error) {
      Notification.error({
        title: polyglot.t("sidebar.export_opml_error"),
        content: error.message,
      })
    }
  }

  return (
    <>
      <Dropdown
        popupVisible={menuVisible}
        position="br"
        trigger="click"
        droplist={
          <Menu className="mobile-action-menu">
            <MenuItem key="1" onClick={handleToggleFeedsVisibility}>
              {showHiddenFeeds ? (
                <IconEyeInvisible className="icon-right" />
              ) : (
                <IconEye className="icon-right" />
              )}
              {showHiddenFeeds
                ? polyglot.t("sidebar.hide_hidden_sources")
                : polyglot.t("sidebar.show_hidden_sources")}
            </MenuItem>
            <Divider style={{ margin: "4px 0" }} />
            <MenuItem key="2" onClick={() => document.querySelector("#opmlInput").click()}>
              <IconUpload className="icon-right" />
              {polyglot.t("sidebar.import_opml")}
            </MenuItem>
            <MenuItem key="3" onClick={handleExportOPML}>
              <IconDownload className="icon-right" />
              {polyglot.t("sidebar.export_opml")}
            </MenuItem>
          </Menu>
        }
        onVisibleChange={setMenuVisible}
      >
        <Button
          aria-expanded={menuVisible}
          aria-haspopup="menu"
          aria-label={polyglot.t("sidebar.more_options")}
          className="sidebar-section-action"
          icon={<IconMoreVertical aria-hidden="true" />}
          shape="circle"
          size="small"
          style={{ marginTop: "1em", marginBottom: "0.5em" }}
        />
      </Dropdown>
      <input
        accept=".opml,.xml"
        id="opmlInput"
        style={{ display: "none" }}
        type="file"
        onChange={handleImportOPML}
      />
    </>
  )
}

const updateEntriesAsRead = (entryIds) => {
  const { activeContent } = contentState.get()
  const { showStatus } = settingsState.get()
  const markedEntryIds = new Set(entryIds)
  if (activeContent && markedEntryIds.has(activeContent.id)) {
    setActiveContent({ ...activeContent, status: "read" })
  }
  setEntries((previous) => reconcileEntriesAfterMarkRead(previous, markedEntryIds, showStatus))
}

const Sidebar = ({ headerAction, isDrawer = false, onNavigate }) => {
  const { catalog: catalogLoadState } = useStore(dataState, { keys: ["loadState"] }).loadState
  const { polyglot } = useStore(polyglotState)
  const expandedCategories = useStore(expandedCategoriesState)
  const { showUnreadFeedsOnly } = useStore(settingsState, { keys: ["showUnreadFeedsOnly"] })
  const visibleFeeds = useStore(visibleFeedsState)
  const visibleCategories = useStore(visibleCategoriesState)
  const feedsGroupedById = useStore(feedsGroupedByIdState)

  const [sourceQuery, setSourceQuery] = useState("")
  const [categoryModalVisible, setCategoryModalVisible] = useState(false)
  const [feedModalVisible, setFeedModalVisible] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedFeed, setSelectedFeed] = useState(null)
  const [categoryForm] = Form.useForm()
  const [feedForm] = Form.useForm()

  const { refreshSingleFeed, retryFeedHealth, retryingFeedIds, handleDeleteFeed } =
    useFeedOperations(true)
  const { handleDeleteCategory } = useCategoryOperations(true)

  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname
  const currentFeedRouteMatch = currentPath.match(/^\/feed\/([^/]+)(?:\/|$)/)
  const currentFeedId = currentFeedRouteMatch?.[1] ?? null
  const currentFeed = visibleFeeds.find((feed) => String(feed.id) === currentFeedId)
  const currentFeedUnreadCount = currentFeed?.unreadCount
  const [currentFeedContextState, setCurrentFeedContextState] = useState(() => ({
    feedId: currentFeedId,
    unreadCount: currentFeedUnreadCount,
    showUnreadFeedsOnly,
    retainedFeedId: null,
  }))
  let nextCurrentFeedContextState = currentFeedContextState

  if (currentFeedContextState.feedId !== currentFeedId) {
    nextCurrentFeedContextState = {
      feedId: currentFeedId,
      unreadCount: currentFeedUnreadCount,
      showUnreadFeedsOnly,
      retainedFeedId: null,
    }
  } else if (
    currentFeedContextState.showUnreadFeedsOnly &&
    showUnreadFeedsOnly &&
    currentFeedContextState.unreadCount > 0 &&
    currentFeedUnreadCount === 0
  ) {
    nextCurrentFeedContextState = {
      feedId: currentFeedId,
      unreadCount: currentFeedUnreadCount,
      showUnreadFeedsOnly,
      retainedFeedId: currentFeedId,
    }
  } else if (currentFeedContextState.retainedFeedId !== null && currentFeedUnreadCount > 0) {
    nextCurrentFeedContextState = {
      feedId: currentFeedId,
      unreadCount: currentFeedUnreadCount,
      showUnreadFeedsOnly,
      retainedFeedId: null,
    }
  } else if (
    currentFeedContextState.unreadCount !== currentFeedUnreadCount ||
    currentFeedContextState.showUnreadFeedsOnly !== showUnreadFeedsOnly
  ) {
    nextCurrentFeedContextState = {
      ...currentFeedContextState,
      unreadCount: currentFeedUnreadCount,
      showUnreadFeedsOnly,
    }
  }

  if (nextCurrentFeedContextState !== currentFeedContextState) {
    setCurrentFeedContextState(nextCurrentFeedContextState)
  }

  const currentZeroUnreadSource = getCurrentZeroUnreadSource(
    visibleFeeds,
    currentFeedId,
    showUnreadFeedsOnly,
    nextCurrentFeedContextState.retainedFeedId,
  )
  const unreadNavigationFeeds = useMemo(
    () => getUnreadNavigationFeeds(visibleFeeds, sourceQuery),
    [visibleFeeds, sourceQuery],
  )
  const hasVisibleUnreadFeeds = visibleFeeds.some((feed) => feed.unreadCount > 0)
  const searchMatchingCategoryKeys = useMemo(
    () =>
      getMatchingCategories(visibleCategories, feedsGroupedById, sourceQuery).map(
        (category) => `/category/${category.id}`,
      ),
    [visibleCategories, feedsGroupedById, sourceQuery],
  )
  const displayedExpandedCategories = useMemo(
    () =>
      getSearchExpandedCategoryKeys(expandedCategories, searchMatchingCategoryKeys, sourceQuery),
    [expandedCategories, searchMatchingCategoryKeys, sourceQuery],
  )

  const { refreshFeedData } = useAppData()
  const refreshCounts = useRefreshCounts()
  const {
    identityReady: homeIdentityReady,
    setTarget: setHomePageTarget,
    target: homeTarget,
    visibilityReady: homeVisibilityReady,
  } = useHomePage()
  const homePageReady = homeIdentityReady && homeVisibilityReady

  const isCurrentListAffected = (scope, sourceId) => {
    const { infoFrom, infoId } = contentState.get()
    return isSidebarSourceListAffected({
      scope,
      sourceId,
      infoFrom,
      infoId,
      feedsByCategory: feedsGroupedByIdState.get(),
    })
  }

  const handleUndoMarkAllRead = async (token) => {
    await performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onConsume: (consumedToken) =>
        Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
      onError: (error) => {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
          content: error.message,
        })
      },
    })
  }

  const performSidebarMarkAllAsRead = async (scope, source) => {
    const sourceId = source.id
    const sessionRevision = getDataSessionRevision()
    const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
    if (operationLease === null) {
      return
    }

    const markedEntryIds = new Set()
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()

    try {
      await runEntryMutation(() =>
        markSidebarSourceEntriesAsRead({
          scope,
          sourceId,
          isEntryScopeFullyVisible,
          getFeedEntries,
          getCategoryEntries,
          markEntriesAsReadInBatches,
          onBatchMarkedRead: (entryIds) => {
            for (const entryId of entryIds) {
              markedEntryIds.add(entryId)
            }
            if (isCurrentSession() && isCurrentListAffected(scope, sourceId)) {
              updateEntriesAsRead(entryIds)
            }
          },
        }),
      )

      if (!isCurrentSession()) {
        return
      }

      invalidateArticleList()
      await refreshCounts({ force: true })
      if (!isCurrentSession()) {
        return
      }

      const previousUndoToken = markAllReadUndoActions.getCurrentToken()
      markAllReadUndoActions.clear()
      if (previousUndoToken !== null) {
        Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
      }

      const entryIds = [...markedEntryIds]
      if (entryIds.length > 0) {
        let token
        token = markAllReadUndoActions.replace(
          { entryIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
          },
        )
        Notification.success({
          id: getMarkAllReadUndoNotificationId(token),
          title: polyglot.t("article_list.mark_all_as_read_success"),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoMarkAllRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => markAllReadUndoActions.clear(token),
        })
      } else {
        Notification.success({
          title: polyglot.t("article_list.mark_all_as_read_success"),
        })
      }
    } catch (error) {
      if (!isCurrentSession()) {
        return
      }
      console.error(`Failed to mark Sidebar ${scope} entries as read:`, error)
      invalidateArticleList()
      await refreshCounts({ force: true })
      if (isCurrentSession()) {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
          content: error.message,
        })
      }
    } finally {
      markAllReadOperationCoordinator.release(operationLease)
    }
  }

  const requestSidebarMarkAllAsRead = (scope, source) =>
    requestSidebarMarkAllRead({
      scope,
      skipConfirmation: settingsState.get().skipMarkAllReadConfirmation,
      confirm: (onConfirm) =>
        Modal.confirm({
          ...confirmDialogProps,
          title: polyglot.t("article_list.mark_all_as_read_confirm"),
          onOk: onConfirm,
        }),
      onConfirm: () => performSidebarMarkAllAsRead(scope, source),
    })

  const handleEditCategory = (category) => {
    setSelectedCategory(category)
    setCategoryModalVisible(true)
    categoryForm.setFieldsValue({
      title: category.title,
      hidden: category.hide_globally,
    })
  }

  const handleRefreshCategory = async (category) => {
    try {
      await refreshCategoryFeed(category.id)
      Notification.success({
        title: polyglot.t("sidebar.refresh_category_success"),
      })
      await refreshFeedData({ force: true }).catch((error) => {
        console.error("Failed to refresh data after category refresh:", error)
      })
    } catch {
      Notification.error({
        title: polyglot.t("sidebar.refresh_category_error"),
      })
    }
  }

  const handleMarkAllAsReadCategory = (category) =>
    requestSidebarMarkAllAsRead("category", category)

  const handleEditFeed = (feed) => {
    setSelectedFeed(feed)
    setFeedModalVisible(true)
    feedForm.setFieldsValue({
      title: feed.title,
      categoryId: feed.category.id,
      siteUrl: feed.site_url,
      feedUrl: feed.feed_url,
      hidden: feed.hide_globally,
      disabled: feed.disabled,
      crawler: feed.crawler,
    })
  }

  const handleRefreshFeed = async (feed) => {
    if (!(await refreshSingleFeed(feed))) {
      return
    }

    invalidateArticleListForFeed(feed)
    await refreshCounts({ force: true })
  }

  const handleMarkAllAsReadFeed = (feed) => requestSidebarMarkAllAsRead("feed", feed)

  const handleSetHomePage = (target, name) => {
    if (setHomePageTarget(target)) {
      Notification.success({
        title: polyglot.t("home_page.set_success", { name }),
      })
    }
  }

  const homePageActionLabel = polyglot.t("home_page.go_to", {
    name: polyglot.t("settings.post_login_page_option_home"),
  })

  const handleHomeNavigation = () => {
    navigate("/")
    setActiveContent(null)
    onNavigate?.()
  }

  return (
    <SidebarNavigationContext.Provider value={onNavigate}>
      <nav aria-label={PRODUCT_NAME} className="sidebar-container">
        <AdaptiveScrollArea style={{ maxHeight: "100%" }}>
          <Menu hasCollapseButton={false} role="none">
            <div className="menu-header">
              <CustomTooltip content={homePageActionLabel} position="bottom">
                <span className="home-brand-tooltip-anchor">
                  <button
                    aria-label={homePageActionLabel}
                    className="home-brand"
                    type="button"
                    onClick={handleHomeNavigation}
                  >
                    <img
                      alt=""
                      className="home-brand-logo"
                      decoding="async"
                      height="32"
                      src={LOGO_URL}
                      width="32"
                    />
                    <span className="home-brand-title">{PRODUCT_NAME}</span>
                  </button>
                </span>
              </CustomTooltip>
              <div className="menu-header-actions">
                <Profile />
                {headerAction}
              </div>
            </div>
            <Typography.Title className="section-title" heading={6} style={{ paddingLeft: "12px" }}>
              {polyglot.t("sidebar.articles")}
            </Typography.Title>
            <SidebarMenuItems />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography.Title
                className="section-title"
                heading={6}
                style={{ paddingLeft: "12px" }}
              >
                {polyglot.t("sidebar.feeds")}
              </Typography.Title>
              <div style={{ display: "flex", gap: "8px", marginRight: "8px" }}>
                <AddFeed />
                <MoreOptionsDropdown />
              </div>
            </div>
            <SourceNavigationControls
              escapeClearsQuery={!isDrawer}
              polyglot={polyglot}
              query={sourceQuery}
              setQuery={setSourceQuery}
              showUnreadFeedsOnly={showUnreadFeedsOnly}
            />
            <Skeleton
              animation
              loading={!catalogLoadState.hasSnapshot && !catalogLoadState.error}
              text={{ rows: 6 }}
            />
            {!catalogLoadState.hasSnapshot && catalogLoadState.error && (
              <div className="sidebar-load-error" role="alert">
                <Typography.Text>{polyglot.t("sidebar.load_error")}</Typography.Text>
                <Button
                  icon={<IconRefresh aria-hidden="true" />}
                  size="small"
                  onClick={() => refreshFeedData().catch(() => null)}
                >
                  {polyglot.t("actions.retry")}
                </Button>
              </div>
            )}
            {catalogLoadState.hasSnapshot &&
              (showUnreadFeedsOnly ? (
                <div aria-busy={catalogLoadState.activity === "refreshing"}>
                  {unreadNavigationFeeds.length > 0 ? (
                    <section
                      aria-label={polyglot.t("sidebar.unread_sources")}
                      className="source-navigation-list"
                    >
                      <Typography.Title className="section-title source-list-title" heading={6}>
                        {polyglot.t("sidebar.unread_sources")}
                      </Typography.Title>
                      {unreadNavigationFeeds.map((feed) => (
                        <FeedMenuItem
                          key={feed.id}
                          feed={feed}
                          homePageReady={homePageReady}
                          homeTarget={homeTarget}
                          retryingFeedIds={retryingFeedIds}
                          onDeleteFeed={handleDeleteFeed}
                          onEditFeed={handleEditFeed}
                          onMarkAllAsRead={handleMarkAllAsReadFeed}
                          onRefreshFeed={handleRefreshFeed}
                          onRetryFeedHealth={retryFeedHealth}
                          onSetHomePage={handleSetHomePage}
                        />
                      ))}
                    </section>
                  ) : (
                    <div className="source-navigation-empty" role="status">
                      {polyglot.t(
                        hasVisibleUnreadFeeds
                          ? "sidebar.no_matching_sources"
                          : "sidebar.no_unread_sources",
                      )}
                    </div>
                  )}
                  {currentZeroUnreadSource && (
                    <section
                      aria-label={polyglot.t("sidebar.current_source")}
                      className="current-source-section"
                    >
                      <Typography.Title className="section-title source-list-title" heading={6}>
                        {polyglot.t("sidebar.current_source")}
                      </Typography.Title>
                      <FeedMenuItem
                        showZeroCount
                        className="current-source-feed"
                        feed={currentZeroUnreadSource}
                        homePageReady={homePageReady}
                        homeTarget={homeTarget}
                        retryingFeedIds={retryingFeedIds}
                        onDeleteFeed={handleDeleteFeed}
                        onEditFeed={handleEditFeed}
                        onMarkAllAsRead={handleMarkAllAsReadFeed}
                        onRefreshFeed={handleRefreshFeed}
                        onRetryFeedHealth={retryFeedHealth}
                        onSetHomePage={handleSetHomePage}
                      />
                    </section>
                  )}
                </div>
              ) : (
                <div aria-busy={catalogLoadState.activity === "refreshing"}>
                  <div className="arco-collapse arco-collapse-borderless">
                    <CategoryGroup
                      displayedExpandedCategories={displayedExpandedCategories}
                      homePageReady={homePageReady}
                      homeTarget={homeTarget}
                      retryingFeedIds={retryingFeedIds}
                      sourceQuery={sourceQuery}
                      onDeleteCategory={handleDeleteCategory}
                      onDeleteFeed={handleDeleteFeed}
                      onEditCategory={handleEditCategory}
                      onEditFeed={handleEditFeed}
                      onMarkAllAsReadCategory={handleMarkAllAsReadCategory}
                      onMarkAllAsReadFeed={handleMarkAllAsReadFeed}
                      onRefreshCategory={handleRefreshCategory}
                      onRefreshFeed={handleRefreshFeed}
                      onRetryFeedHealth={retryFeedHealth}
                      onSetHomePage={handleSetHomePage}
                      onToggleCategory={(categoryPath) => {
                        if (sourceQuery.trim()) {
                          return
                        }
                        const expanded = expandedCategoriesState.get()
                        setExpandedCategories(
                          expanded.includes(categoryPath)
                            ? expanded.filter((key) => key !== categoryPath)
                            : [...expanded, categoryPath],
                        )
                      }}
                    />
                  </div>
                </div>
              ))}
          </Menu>
        </AdaptiveScrollArea>

        {selectedCategory && (
          <EditCategoryModal
            categoryForm={categoryForm}
            fallbackFocusSelector={`.sidebar-container [data-category-edit-id="${selectedCategory.id}"], .sidebar-profile-trigger`}
            selectedCategory={selectedCategory}
            setVisible={setCategoryModalVisible}
            useNotification={true}
            visible={categoryModalVisible}
          />
        )}

        {selectedFeed && (
          <EditFeedModal
            fallbackFocusSelector={`.sidebar-container [data-feed-edit-id="${selectedFeed.id}"], .sidebar-profile-trigger`}
            feedForm={feedForm}
            selectedFeed={selectedFeed}
            setVisible={setFeedModalVisible}
            useNotification={true}
            visible={feedModalVisible}
          />
        )}
      </nav>
    </SidebarNavigationContext.Provider>
  )
}

export default Sidebar
