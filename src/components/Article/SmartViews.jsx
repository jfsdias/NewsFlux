import "./SmartViews.css"

import { Button, Input } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState } from "@/store/settingsState"
import { requestSmartViewOpen } from "@/store/smartViewActions"
import { smartViewsState, updateSmartViews } from "@/store/smartViewsState"
import { downloadFile } from "@/utils/file"
import { getHomeIdentityKey } from "@/utils/home-page"
import {
  canOpenSmartView,
  describeSmartView,
  getSmartViews,
  moveSmartView,
  normalizeSmartViewDate,
  resolveSmartViewName,
  sanitizeSmartView,
  suggestSmartViewName,
} from "@/utils/smart-views"

const SmartViews = ({ source, sourceId, query, filterDate, onClose, onOpenView }) => {
  const identity = useStore(homeIdentityState)
  const storage = useStore(smartViewsState)
  const settings = useStore(settingsState)
  const feeds = useStore(catalogFeedsState)
  const categories = useStore(catalogCategoriesState)
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const key = getHomeIdentityKey(identity)
  const views = getSmartViews(storage, key)
  const sourceName = (view) => {
    if (view.source === "feed") {
      return (
        feeds.find((item) => Number(item.id) === Number(view.sourceId))?.title ??
        `Unavailable feed ${view.sourceId}`
      )
    }
    if (view.source === "category") {
      return (
        categories.find((item) => Number(item.id) === Number(view.sourceId))?.title ??
        `Unavailable category ${view.sourceId}`
      )
    }
    return null
  }
  const draftView = (viewName, id) => ({
    id,
    name: viewName,
    query,
    source,
    sourceId,
    filterDate: normalizeSmartViewDate(filterDate),
    showStatus: settings.showStatus,
    orderBy: settings.orderBy,
    orderDirection: settings.orderDirection,
  })
  const names = views.map((view) => view.name)
  // While a view is active the list holds its own status/sort, which is what a save captures.
  const suggestion = query.trim()
    ? suggestSmartViewName(draftView("x", "draft"), sourceName(draftView("x", "draft")), names)
    : ""
  const save = () => {
    let sequence = 1
    while (views.some((view) => view.id === `view-${sequence}`)) {
      sequence += 1
    }
    const id = `view-${sequence}`
    const candidate = draftView("x", id)
    const resolved = resolveSmartViewName(name, candidate, sourceName(candidate), names)
    const view = sanitizeSmartView({ ...candidate, name: resolved.name })
    if (!view) {
      setMessage("Enter a search query to save this view.")
      return
    }
    try {
      updateSmartViews(key, (current) => [...current, view])
      setName("")
      setMessage(
        resolved.generated
          ? `View saved on this browser. Named \u201C${view.name}\u201D.`
          : "View saved on this browser.",
      )
    } catch {
      setMessage("Could not save the view on this browser.")
    }
  }
  const edit = (update) => {
    try {
      updateSmartViews(key, update)
      setMessage("")
    } catch {
      setMessage("Could not update the saved views on this browser.")
    }
  }
  const open = (view) => {
    if (!canOpenSmartView(view, feeds, categories)) {
      setMessage("This feed or category is unavailable. The saved view was not opened.")
      return
    }
    const targetPath = requestSmartViewOpen({ key, view, originPath: location.pathname })
    onOpenView()
    onClose()
    navigate(targetPath)
  }
  const exportViews = () => {
    try {
      downloadFile(
        JSON.stringify({ version: 1, views }, null, 2),
        "newsflux-smart-views.json",
        "application/json",
      )
    } catch {
      setMessage("Could not export saved views.")
    }
  }
  return (
    <section aria-label="Saved views" className="smart-views">
      <h3>Saved views</h3>
      <p>
        Saved only in this browser for this server account. They do not sync and are not included in
        the settings backup. A view applies its own status and sort only while it is open; leaving
        it restores your preferences.
      </p>
      {!key && <p>Saved views are unavailable until your account is identified.</p>}
      {key && (
        <>
          {source !== "home" && (
            <div className="smart-views__save">
              <Input
                aria-label="View name"
                maxLength={100}
                placeholder={suggestion || "View name"}
                value={name}
                onChange={setName}
              />
              <Button disabled={!query.trim()} onClick={save}>
                Save this search
              </Button>
            </div>
          )}
          {views.length === 0 ? (
            <p>No saved views yet.</p>
          ) : (
            <ul className="smart-views__list">
              {views.map((view, index) => (
                <li key={view.id} className="smart-views__item">
                  <strong className="smart-views__name">{view.name}</strong>
                  <span className="smart-views__metadata">
                    {describeSmartView(view, sourceName(view))}
                  </span>
                  <div className="smart-views__query">{view.query}</div>
                  <div className="smart-views__actions">
                    <Button aria-label={`Open ${view.name}`} size="mini" onClick={() => open(view)}>
                      Open
                    </Button>
                    <Button
                      aria-label={`Rename ${view.name}`}
                      size="mini"
                      onClick={() => {
                        const next = globalThis.prompt("Rename view", view.name)
                        if (next === null) {
                          return
                        }
                        const renamed = sanitizeSmartView({ ...view, name: next })
                        if (!renamed) {
                          setMessage("Enter a valid view name.")
                          return
                        }
                        edit((current) =>
                          current.map((item) => (item.id === view.id ? renamed : item)),
                        )
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      aria-label={`Move ${view.name} up`}
                      disabled={index === 0}
                      size="mini"
                      onClick={() => edit((current) => moveSmartView(current, view.id, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      aria-label={`Move ${view.name} down`}
                      disabled={index === views.length - 1}
                      size="mini"
                      onClick={() => edit((current) => moveSmartView(current, view.id, 1))}
                    >
                      ↓
                    </Button>
                    <Button
                      aria-label={`Delete ${view.name}`}
                      size="mini"
                      onClick={() => {
                        if (globalThis.confirm(`Delete saved view "${view.name}"?`)) {
                          edit((current) => current.filter((item) => item.id !== view.id))
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {views.length > 0 && (
            <div className="smart-views__actions smart-views__bulk-actions">
              <Button size="mini" onClick={exportViews}>
                Export views
              </Button>
              <Button
                size="mini"
                onClick={() => {
                  if (
                    globalThis.confirm("Delete all saved views for this account on this browser?")
                  ) {
                    edit(() => [])
                  }
                }}
              >
                Reset views
              </Button>
            </div>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
export default SmartViews
