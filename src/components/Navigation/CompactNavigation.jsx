import {
  IconCalendar,
  IconFolder,
  IconHome,
  IconStar,
  IconUnorderedList,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import classNames from "classnames"
import { memo, useCallback, useMemo } from "react"
import { useLocation, useNavigate } from "react-router"

import { polyglotState } from "@/hooks/useLanguage"
import useWindowClass from "@/hooks/useWindowClass"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState, unreadTotalState } from "@/store/dataState"
import { mobileSidebarVisibleState, setMobileSidebarVisible } from "@/store/sidebarState"
import {
  COMPACT_NAV_DESTINATIONS,
  resolveCompactNavActiveKey,
  shouldRenderCompactNavigation,
} from "@/utils/compact-navigation"

import "./CompactNavigation.css"

const formatNavBadge = (count) => {
  if (!count || count <= 0) {
    return null
  }
  return count > 999 ? "999+" : String(count)
}

const CompactNavigation = () => {
  const { windowClass } = useWindowClass()
  const { activeContent } = useStore(contentState, { keys: ["activeContent"] })
  const isReaderActive = Boolean(activeContent)

  const isVisible = shouldRenderCompactNavigation({ windowClass, isReaderActive })

  const location = useLocation()
  const navigate = useNavigate()
  const { polyglot } = useStore(polyglotState)

  const unreadTotal = useStore(unreadTotalState)
  const { starredCount, unreadTodayCount } = useStore(dataState, {
    keys: ["starredCount", "unreadTodayCount"],
  })
  const sidebarVisible = useStore(mobileSidebarVisibleState)

  const activeKey = useMemo(
    () => resolveCompactNavActiveKey(location.pathname),
    [location.pathname],
  )

  const handleNavigate = useCallback(
    (path) => {
      navigate(path)
      setActiveContent(null)
    },
    [navigate],
  )

  const handleToggleSources = useCallback(() => {
    setMobileSidebarVisible(!mobileSidebarVisibleState.get())
  }, [])

  if (!isVisible || !polyglot) {
    return null
  }

  const items = [
    {
      key: COMPACT_NAV_DESTINATIONS.HOME,
      label: polyglot.t("settings.post_login_page_option_home"),
      Icon: IconHome,
      onClick: () => handleNavigate("/"),
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.HOME,
      badge: null,
    },
    {
      key: COMPACT_NAV_DESTINATIONS.ALL,
      label: polyglot.t("sidebar.all"),
      Icon: IconUnorderedList,
      onClick: () => handleNavigate("/all"),
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.ALL,
      badge: formatNavBadge(unreadTotal),
    },
    {
      key: COMPACT_NAV_DESTINATIONS.TODAY,
      label: polyglot.t("sidebar.today"),
      Icon: IconCalendar,
      onClick: () => handleNavigate("/today"),
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.TODAY,
      badge: formatNavBadge(unreadTodayCount),
    },
    {
      key: COMPACT_NAV_DESTINATIONS.STARRED,
      label: polyglot.t("sidebar.starred"),
      Icon: IconStar,
      onClick: () => handleNavigate("/starred"),
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.STARRED,
      badge: formatNavBadge(starredCount),
    },
    {
      key: COMPACT_NAV_DESTINATIONS.SOURCES,
      label: polyglot.t("sidebar.feeds"),
      Icon: IconFolder,
      onClick: handleToggleSources,
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.SOURCES,
      badge: null,
      isDialogTrigger: true,
    },
  ]

  const navAriaLabel = polyglot.t("sidebar.navigation_menu")

  return (
    <nav
      aria-label={navAriaLabel}
      className="compact-nav-bar"
      data-testid="compact-nav-bar"
      data-window-class={windowClass}
    >
      <div className="compact-nav-items">
        {items.map((item) => {
          const { Icon, badge, isActive, isDialogTrigger, key, label, onClick } = item
          const accessibleName = badge ? `${label} (${badge})` : label

          return (
            <button
              key={key}
              aria-current={isActive ? "page" : undefined}
              aria-expanded={isDialogTrigger ? sidebarVisible : undefined}
              aria-haspopup={isDialogTrigger ? "dialog" : undefined}
              aria-label={accessibleName}
              data-nav-key={key}
              data-testid={`compact-nav-${key}`}
              type="button"
              className={classNames("compact-nav-item", {
                "compact-nav-item-active": isActive,
              })}
              onClick={onClick}
            >
              <div className="compact-nav-icon-wrapper">
                <Icon aria-hidden="true" />
                {badge && (
                  <span aria-hidden="true" className="compact-nav-badge">
                    {badge}
                  </span>
                )}
              </div>
              <span className="compact-nav-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

CompactNavigation.displayName = "CompactNavigation"

export default memo(CompactNavigation)
