import { Typography } from "@arco-design/web-react"
import { IconFilter } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import classNames from "classnames"
import { useId } from "react"
import { useLocation, useNavigate } from "react-router"

import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { requestSmartViewOpen } from "@/store/smartViewActions"
import { activeSmartViewState, smartViewsState } from "@/store/smartViewsState"
import { getHomeIdentityKey } from "@/utils/home-page"
import { canOpenSmartView, getSmartViews } from "@/utils/smart-views"

// One-interaction shortcuts to the saved Smart Views of the current account. Rendered by the
// shared Sidebar, so the desktop sidebar and the compact Feeds drawer both show it.
const SavedViewsNav = ({ onNavigate }) => {
  const headingId = useId()
  const identity = useStore(homeIdentityState)
  const storage = useStore(smartViewsState)
  const active = useStore(activeSmartViewState)
  const feeds = useStore(catalogFeedsState)
  const categories = useStore(catalogCategoriesState)
  const navigate = useNavigate()
  const location = useLocation()
  const key = getHomeIdentityKey(identity)
  const views = getSmartViews(storage, key)

  if (!key || views.length === 0) {
    return null
  }

  const open = (view) => {
    const targetPath = requestSmartViewOpen({ key, view, originPath: location.pathname })
    navigate(targetPath)
    onNavigate?.()
  }

  return (
    <section aria-labelledby={headingId} className="saved-views-nav">
      <Typography.Title
        className="section-title"
        heading={6}
        id={headingId}
        style={{ paddingLeft: "12px" }}
      >
        Saved views
      </Typography.Title>
      <ul className="saved-views-nav__list">
        {views.map((view) => {
          const isActive = active?.key === key && active.view.id === view.id
          const available = canOpenSmartView(view, feeds, categories)
          return (
            <li key={view.id}>
              <button
                aria-current={isActive ? "true" : undefined}
                disabled={!available}
                title={available ? view.query : "This feed or category is unavailable"}
                type="button"
                className={classNames("arco-menu-item custom-menu-link saved-view-link", {
                  "arco-menu-selected": isActive,
                })}
                onClick={() => open(view)}
              >
                <span className="saved-view-link__label">
                  <IconFilter aria-hidden="true" />
                  {view.name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default SavedViewsNav
