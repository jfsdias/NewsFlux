import { Button } from "@arco-design/web-react"
import { IconClose, IconFilter } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"

import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { leaveSmartView } from "@/store/smartViewActions"
import { activeSmartViewState, smartViewsState } from "@/store/smartViewsState"
import { getSmartViewChips, getSmartViews } from "@/utils/smart-views"

// Header banner that makes an active Smart View explicit: its name, its predicates as chips and
// one action that leaves the view and returns to the underlying scope.
const ActiveSmartView = () => {
  const active = useStore(activeSmartViewState)
  const storage = useStore(smartViewsState)
  const feeds = useStore(catalogFeedsState)
  const categories = useStore(catalogCategoriesState)

  if (!active) {
    return null
  }

  const view = getSmartViews(storage, active.key).find((item) => item.id === active.view.id)
  if (!view) {
    return null
  }
  const catalog = view.source === "feed" ? feeds : view.source === "category" ? categories : []
  const sourceName = catalog.find((item) => Number(item.id) === view.sourceId)?.title ?? null

  return (
    <section aria-label={`Active Smart View: ${view.name}`} className="active-smart-view">
      <div className="active-smart-view__header">
        <IconFilter aria-hidden="true" className="active-smart-view__icon" />
        <span className="active-smart-view__eyebrow">Smart View</span>
        <strong className="active-smart-view__name" title={view.name}>
          {view.name}
        </strong>
        <Button
          className="active-smart-view__leave"
          icon={<IconClose aria-hidden="true" />}
          size="small"
          type="text"
          onClick={leaveSmartView}
        >
          Leave view
        </Button>
      </div>
      <ul aria-label="View filters" className="active-smart-view__chips">
        {getSmartViewChips(view, sourceName).map((chip) => (
          <li key={chip.id} className="active-smart-view__chip" data-chip={chip.id}>
            {chip.label}
          </li>
        ))}
      </ul>
      <span className="a11y-visually-hidden" role="status">
        {`Smart View ${view.name} is active.`}
      </span>
    </section>
  )
}

export default ActiveSmartView
