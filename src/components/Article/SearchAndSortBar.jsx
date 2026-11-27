import { Button, Input, Tooltip, Typography } from "@arco-design/web-react"
import {
  IconCalendar,
  IconQuestionCircle,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { Fragment, lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { useNavigate, useParams } from "react-router"

import ActiveSmartView from "./ActiveSmartView.jsx"
import ArticleSelectionControls from "./ArticleSelectionControls.jsx"
import SidebarTrigger from "./SidebarTrigger.jsx"
import SmartViews from "./SmartViews.jsx"

import AccessibleModal from "@/components/ui/AccessibleModal"
import CustomTooltip from "@/components/ui/CustomTooltip"
import FeedSourceMark from "@/components/ui/FeedSourceMark"
import useContentContext from "@/hooks/useContentContext"
import { polyglotState } from "@/hooks/useLanguage"
import useScreenWidth from "@/hooks/useScreenWidth"
import {
  contentState,
  dynamicCountState,
  setActiveContent,
  setFilterDate,
  setFilterString,
} from "@/store/contentState"
import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { duplicateHotkeysState, hotkeysState } from "@/store/hotkeysState"
import { settingsState, updateSettings } from "@/store/settingsState"
import {
  isArticleListDateFilterActive,
  isArticleListDateFilterVisible,
} from "@/utils/article-list-filter-scope"
import {
  createArticleListSearchScopeKey,
  resolveArticleListSearchInputValue,
} from "@/utils/article-list-search-scope"
import formatCategoryDisplayName from "@/utils/category-display-name"
import { getStartOfToday } from "@/utils/date"
import "./SearchAndSortBar.css"

const SearchModal = memo(
  ({ value, visible, onCancel, onConfirm, onChange, source, sourceId, filterDate, onOpenView }) => {
    const { polyglot } = useStore(polyglotState)
    const tooltipLines = polyglot.t("search.article_tooltip").split("\n")
    const searchInputRef = useRef(null)

    const handleAfterOpen = () => searchInputRef.current?.focus()

    const handleConfirm = () => onConfirm(value)

    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        handleConfirm()
      }
    }

    const modalTitle = polyglot.t("search.search")

    return (
      <AccessibleModal
        afterOpen={handleAfterOpen}
        className="search-modal"
        closeLabel={polyglot.t("actions.close_dialog", { name: modalTitle })}
        title={modalTitle}
        visible={visible}
        footer={
          <>
            <Button onClick={onCancel}>{polyglot.t("search.cancel")}</Button>
            <Button type="primary" onClick={handleConfirm}>
              {polyglot.t("search.confirm")}
            </Button>
          </>
        }
        onCancel={onCancel}
      >
        <div className="search-modal-content">
          <Input.Search
            ref={searchInputRef}
            allowClear
            aria-label={polyglot.t("search.article_input_label")}
            placeholder={polyglot.t("search.article_placeholder")}
            value={value}
            prefix={
              <Tooltip
                mini
                trigger={["hover", "click"]}
                content={
                  <div>
                    {tooltipLines.map((line, index) => (
                      <Fragment key={`tooltip-line-${index}`}>
                        {line}
                        {index < tooltipLines.length - 1 && <br />}
                      </Fragment>
                    ))}
                  </div>
                }
              >
                <Button
                  aria-label={polyglot.t("search.syntax_help")}
                  className="search-syntax-help"
                  icon={<IconQuestionCircle aria-hidden="true" />}
                  shape="circle"
                  size="mini"
                  type="text"
                />
              </Tooltip>
            }
            onChange={onChange}
            onKeyDown={handleKeyDown}
          />
        </div>
        {visible && (
          <SmartViews
            filterDate={filterDate}
            query={value}
            source={source}
            sourceId={sourceId}
            onClose={onCancel}
            onOpenView={onOpenView}
          />
        )}
      </AccessibleModal>
    )
  },
)
SearchModal.displayName = "SearchModal"

const ActiveButton = ({ active, expanded, icon, tooltip, onClick }) => (
  <CustomTooltip mini content={tooltip}>
    <Button
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-label={tooltip}
      className={`nf-glass-control${active ? " nf-glass-control-active" : ""}`}
      icon={icon}
      shape="circle"
      size="small"
      onClick={onClick}
    />
  </CustomTooltip>
)

// The date picker is large and only opens on demand. Its trigger renders immediately and the
// picker module is requested as soon as the browser is idle, so it is normally ready before use.
const loadDatePicker = () => import("@arco-design/web-react/es/DatePicker")
const DatePicker = lazy(loadDatePicker)

const DateFilter = ({ filterDate, from, polyglot }) => {
  const [calendarVisible, setCalendarVisible] = useState(false)
  const selectDateLabel = polyglot.t("search.select_date")

  useEffect(() => {
    const request = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 200))
    const cancel = globalThis.cancelIdleCallback ?? clearTimeout
    const handle = request(() => void loadDatePicker())
    return () => cancel(handle)
  }, [])

  const setDateAndClose = (date) => {
    setFilterDate(date)
    setCalendarVisible(false)
  }

  const calendarTrigger = (onClick) => (
    <CustomTooltip mini content={selectDateLabel}>
      <Button
        aria-expanded={calendarVisible}
        aria-haspopup="dialog"
        aria-label={selectDateLabel}
        icon={<IconCalendar aria-hidden="true" />}
        shape="circle"
        size="small"
        className={`nf-glass-control${
          isArticleListDateFilterActive({ from, filterDate }) ? " nf-glass-control-active" : ""
        }`}
        onClick={onClick}
      />
    </CustomTooltip>
  )

  return (
    // The fallback is the same trigger, so nothing shifts while the picker loads; a click made
    // before then opens the picker as soon as it arrives.
    <Suspense fallback={calendarTrigger(() => setCalendarVisible(true))}>
      <DatePicker
        popupVisible={calendarVisible}
        position="bottom"
        showNowBtn={false}
        triggerElement={calendarTrigger()}
        value={filterDate}
        extra={
          <div className="calendar-actions">
            <Button
              long
              size="mini"
              type="primary"
              onClick={() => setDateAndClose(getStartOfToday())}
            >
              {polyglot.t("search.today")}
            </Button>
            <Button long size="mini" onClick={() => setDateAndClose(null)}>
              {polyglot.t("search.clear_date")}
            </Button>
          </div>
        }
        triggerProps={{
          boundaryDistance: { bottom: 8, left: 8, right: 8, top: 8 },
          className: "mobile-date-picker-popup",
        }}
        onChange={setFilterDate}
        onVisibleChange={setCalendarVisible}
      />
    </Suspense>
  )
}

const SearchAndSortBar = ({
  fullWidth = false,
  homeMode = false,
  selectionAvailable = false,
  selectionMode = false,
  selectedCount = 0,
  selectionBusy = false,
  selectionTriggerRef,
  onEnterSelectionMode,
  onCancelSelection,
  onMarkSelectedRead,
}) => {
  const { articleListError, filterDate, filterString, infoFrom, infoId, isArticleListReady } =
    useStore(contentState, {
      keys: [
        "articleListError",
        "filterDate",
        "filterString",
        "infoFrom",
        "infoId",
        "isArticleListReady",
      ],
    })
  const { orderDirection, showFeedIcon, showStatus } = useStore(settingsState, {
    keys: ["orderDirection", "showFeedIcon", "showStatus"],
  })
  const { polyglot } = useStore(polyglotState)
  const feeds = useStore(catalogFeedsState)
  const categories = useStore(catalogCategoriesState)
  const dynamicCount = useStore(dynamicCountState)
  const duplicateHotkeys = useStore(duplicateHotkeysState)
  const hotkeys = useStore(hotkeysState)

  const { id } = useParams()
  const navigate = useNavigate()
  const { closeActiveContent, entryListRef } = useContentContext()
  const { isBelowMedium } = useScreenWidth()

  const [searchModalVisible, setSearchModalVisible] = useState(false)
  const [modalDraft, setModalDraft] = useState({ scopeKey: null, query: null, value: "" })
  const searchScopeKey = createArticleListSearchScopeKey({
    from: infoFrom,
    id: infoId,
    showStatus,
  })
  const showDateFilter = isArticleListDateFilterVisible({ from: infoFrom, homeMode })
  const modalInputValue = resolveArticleListSearchInputValue({
    activeQuery: filterString,
    activeScopeKey: searchScopeKey,
    draftQuery: modalDraft.query,
    draftScopeKey: modalDraft.scopeKey,
    draftValue: modalDraft.value,
  })

  const searchLabel = filterString
    ? polyglot.t("search.active_query", { query: filterString })
    : polyglot.t("search.search")
  const sortLabel =
    orderDirection === "desc"
      ? polyglot.t("article_list.sort_direction_desc")
      : polyglot.t("article_list.sort_direction_asc")
  const openSearchModalHotkeys = hotkeys.openSearchModal.filter(
    (key) => !duplicateHotkeys.includes(key),
  )

  const { feed, title, count } = useMemo(() => {
    if (id) {
      if (infoFrom === "category") {
        const category = categories.find((c) => c.id === Number(id))
        return { feed: null, title: formatCategoryDisplayName(category), count: dynamicCount }
      }
      if (infoFrom === "feed") {
        const feed = feeds.find((f) => f.id === Number(id))
        return { feed, title: feed?.title, count: dynamicCount }
      }
    }

    const infoMap = {
      all: { key: "sidebar.all", count: dynamicCount },
      today: { key: "sidebar.today", count: dynamicCount },
      starred: { key: "sidebar.starred", count: dynamicCount },
      history: { key: "sidebar.history", count: dynamicCount },
    }

    const info = infoMap[infoFrom] || { key: "", count: 0 }
    return { feed: null, title: info.key ? polyglot.t(info.key) : "", count: info.count }
  }, [infoFrom, id, categories, feeds, dynamicCount, polyglot])

  const toggleOrderDirection = () => {
    const newOrderDirection = orderDirection === "desc" ? "asc" : "desc"
    updateSettings({ orderDirection: newOrderDirection })
  }

  const openSearchModal = () => {
    setModalDraft({ scopeKey: searchScopeKey, query: filterString, value: filterString })
    setSearchModalVisible(true)
  }

  const handleModalInputChange = (value) => {
    setModalDraft({ scopeKey: searchScopeKey, query: filterString, value })
  }

  useHotkeys(openSearchModalHotkeys, openSearchModal, {
    preventDefault: true,
    useKey: true,
  })

  const closeSearchModal = () => {
    setSearchModalVisible(false)
  }

  const handleConfirmSearch = (value) => {
    const normalizedQuery = value.trim()
    if (normalizedQuery !== filterString) {
      closeActiveContent()
      entryListRef.current?.getScrollElement()?.scroll({ top: 0 })
      setFilterString(normalizedQuery)
    }
    closeSearchModal()
    if (homeMode) {
      navigate("/all")
    }
  }

  return (
    <div
      className={`search-and-sort-bar${homeMode ? " search-and-sort-bar-home" : ""}${selectionMode ? " search-and-sort-bar-selection" : ""}`}
      style={{ width: isBelowMedium || fullWidth ? "100%" : 370 }}
    >
      <SidebarTrigger />
      {!homeMode && (
        <div className={`page-info${infoFrom === "feed" ? " page-info-feed" : ""}`}>
          {infoFrom === "feed" && showFeedIcon && feed && (
            <FeedSourceMark className="feed-header-source-mark" feed={feed} size={20} />
          )}
          <div className="title-container">
            {title ? (
              <Typography.Ellipsis
                expandable={false}
                showTooltip={!isBelowMedium}
                style={{ fontWeight: 500 }}
              >
                {title}
              </Typography.Ellipsis>
            ) : (
              <div className="placeholder-title"></div>
            )}
          </div>
          {isArticleListReady && !articleListError && count >= 0 && (
            <Typography.Text className="count-label">({count})</Typography.Text>
          )}
        </div>
      )}
      <div className="button-group">
        <ArticleSelectionControls
          available={selectionAvailable}
          busy={selectionBusy}
          disabled={!isArticleListReady || articleListError}
          mode={selectionMode}
          selectTriggerRef={selectionTriggerRef}
          selectedCount={selectedCount}
          onCancel={onCancelSelection}
          onEnter={onEnterSelectionMode}
          onMarkAsRead={onMarkSelectedRead}
        />
        {!selectionMode && (
          <>
            <ActiveButton
              active={!!filterString}
              expanded={searchModalVisible}
              icon={<IconSearch aria-hidden="true" />}
              tooltip={searchLabel}
              onClick={openSearchModal}
            />
            {showDateFilter && (
              <DateFilter filterDate={filterDate} from={infoFrom} polyglot={polyglot} />
            )}
            {!homeMode && (
              <CustomTooltip mini content={sortLabel}>
                <Button
                  aria-label={sortLabel}
                  className="nf-glass-control"
                  shape="circle"
                  size="small"
                  icon={
                    orderDirection === "desc" ? (
                      <IconSortDescending aria-hidden="true" />
                    ) : (
                      <IconSortAscending aria-hidden="true" />
                    )
                  }
                  onClick={toggleOrderDirection}
                />
              </CustomTooltip>
            )}
          </>
        )}
      </div>
      {!homeMode && <ActiveSmartView />}
      <SearchModal
        filterDate={filterDate}
        source={homeMode ? "home" : infoFrom}
        sourceId={infoId}
        value={modalInputValue}
        visible={searchModalVisible}
        onCancel={closeSearchModal}
        onChange={handleModalInputChange}
        onConfirm={handleConfirmSearch}
        onOpenView={() => {
          setActiveContent(null)
          entryListRef.current?.getScrollElement()?.scroll({ top: 0 })
        }}
      />
    </div>
  )
}

export default SearchAndSortBar
