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
import { Link, useLocation } from "react-router"

import { polyglotState } from "@/hooks/useLanguage"
import useWindowClass from "@/hooks/useWindowClass"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState, unreadTotalState } from "@/store/dataState"
import {
  mobileSidebarVisibleState,
  setMobileSidebarInvoker,
  setMobileSidebarVisible,
} from "@/store/sidebarState"
import { COMPACT_NAV_DESTINATIONS, resolveCompactNavActiveKey } from "@/utils/compact-navigation"
import { formatNavigationCountLabel } from "@/utils/source-navigation"

import "./MediumNavigation.css"

const formatNavBadge = (count) => {
  if (!count || count <= 0) {
    return null
  }
  return count > 999 ? "999+" : String(count)
}

const MediumNavigation = () => {
  const { isMedium } = useWindowClass()
  const { activeContent } = useStore(contentState, { keys: ["activeContent"] })
  const isReaderActive = Boolean(activeContent)
  const location = useLocation()
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

  const handleNavigate = useCallback(() => {
    setActiveContent(null)
  }, [])

  const handleToggleSources = useCallback(() => {
    const nextVisible = !mobileSidebarVisibleState.get()
    if (nextVisible) {
      setMobileSidebarInvoker("medium-sources")
    }
    setMobileSidebarVisible(nextVisible)
  }, [])

  if (!isMedium || isReaderActive || !polyglot) {
    return null
  }

  const items = [
    {
      key: COMPACT_NAV_DESTINATIONS.HOME,
      label: polyglot.t("settings.post_login_page_option_home"),
      Icon: IconHome,
      to: "/",
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.HOME,
      badge: null,
      count: 0,
      countType: "unread",
    },
    {
      key: COMPACT_NAV_DESTINATIONS.ALL,
      label: polyglot.t("sidebar.all"),
      Icon: IconUnorderedList,
      to: "/all",
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.ALL,
      badge: formatNavBadge(unreadTotal),
      count: unreadTotal,
      countType: "unread",
    },
    {
      key: COMPACT_NAV_DESTINATIONS.TODAY,
      label: polyglot.t("sidebar.today"),
      Icon: IconCalendar,
      to: "/today",
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.TODAY,
      badge: formatNavBadge(unreadTodayCount),
      count: unreadTodayCount,
      countType: "unread",
    },
    {
      key: COMPACT_NAV_DESTINATIONS.STARRED,
      label: polyglot.t("sidebar.starred"),
      Icon: IconStar,
      to: "/starred",
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.STARRED,
      badge: formatNavBadge(starredCount),
      count: starredCount,
      countType: "items",
    },
    {
      key: COMPACT_NAV_DESTINATIONS.SOURCES,
      label: polyglot.t("sidebar.feeds"),
      Icon: IconFolder,
      isActive: activeKey === COMPACT_NAV_DESTINATIONS.SOURCES,
      onClick: handleToggleSources,
      count: 0,
      countType: "unread",
      isDialogTrigger: true,
    },
  ]

  return (
    <nav
      aria-label={polyglot.t("sidebar.navigation_menu")}
      className="medium-navigation-rail"
      data-testid="medium-navigation-rail"
      data-window-class="MEDIUM"
    >
      <div className="medium-navigation-items">
        {items.map((item) => {
          const { Icon, badge, count, countType, isActive, isDialogTrigger, key, label } = item
          const accessibleName = formatNavigationCountLabel(label, count, {
            countType,
            polyglot,
          })
          const controlClassName = classNames("medium-navigation-item", {
            "medium-navigation-item-active": isActive,
          })
          const contents = (
            <>
              <span aria-hidden="true" className="medium-navigation-icon-wrapper">
                <Icon />
                {badge && <span className="medium-navigation-badge">{badge}</span>}
              </span>
              <span className="medium-navigation-label">{label}</span>
            </>
          )

          if (isDialogTrigger) {
            return (
              <button
                key={key}
                aria-controls="mobile-sidebar-drawer"
                aria-expanded={sidebarVisible}
                aria-haspopup="dialog"
                aria-label={accessibleName}
                className={controlClassName}
                data-nav-key={key}
                data-testid="medium-nav-sources"
                type="button"
                onClick={item.onClick}
              >
                {contents}
              </button>
            )
          }

          return (
            <Link
              key={key}
              aria-current={isActive ? "page" : undefined}
              aria-label={accessibleName}
              className={controlClassName}
              data-nav-key={key}
              data-testid={`medium-nav-${key}`}
              to={item.to}
              onClick={handleNavigate}
            >
              {contents}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

MediumNavigation.displayName = "MediumNavigation"

export default memo(MediumNavigation)
