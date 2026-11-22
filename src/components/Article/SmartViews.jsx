import { Button, Input } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router"

import {
  catalogCategoriesState,
  catalogFeedsState,
  getDataSessionRevision,
} from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState } from "@/store/settingsState"
import { pendingSmartViewState, smartViewsState, updateSmartViews } from "@/store/smartViewsState"
import { downloadFile } from "@/utils/file"
import { getHomeIdentityKey } from "@/utils/home-page"
import {
  canOpenSmartView,
  describeSmartView,
  getSmartViews,
  moveSmartView,
  normalizeSmartViewDate,
  sanitizeSmartView,
  smartViewPath,
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
        feeds.find((item) => Number(item.id) === view.sourceId)?.title ??
        `Unavailable feed ${view.sourceId}`
      )
    }
    if (view.source === "category") {
      return (
        categories.find((item) => Number(item.id) === view.sourceId)?.title ??
        `Unavailable category ${view.sourceId}`
      )
    }
    return null
  }
  const touchTarget = { minHeight: 44, minWidth: 44 }
  const save = () => {
    let sequence = 1
    while (views.some((view) => view.id === `view-${sequence}`)) {
      sequence += 1
    }
    const view = sanitizeSmartView({
      id: `view-${sequence}`,
      name,
      query,
      source,
      sourceId,
      filterDate: normalizeSmartViewDate(filterDate),
      showStatus: settings.showStatus,
      orderBy: settings.orderBy,
      orderDirection: settings.orderDirection,
    })
    if (!view) {
      setMessage("Enter a name and search query to save this view.")
      return
    }
    try {
      updateSmartViews(key, (current) => [...current, view])
      setName("")
      setMessage("View saved on this browser.")
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
    const targetPath = smartViewPath(view)
    const pending = {
      key,
      view,
      targetPath,
      originPath: location.pathname,
      sessionRevision: getDataSessionRevision(),
    }
    pendingSmartViewState.set(pending)
    globalThis.setTimeout(() => {
      if (pendingSmartViewState.get() === pending) {
        pendingSmartViewState.set(null)
      }
    }, 10_000)
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
    <section aria-label="Saved views" style={{ marginTop: 20 }}>
      <h3>Saved views</h3>
      <p>
        Saved only in this browser for this server account. They do not sync and are not included in
        the settings backup.
      </p>
      {!key && <p>Saved views are unavailable until your account is identified.</p>}
      {key && (
        <>
          {source !== "home" && (
            <div>
              <Input
                aria-label="View name"
                maxLength={100}
                placeholder="View name"
                value={name}
                onChange={setName}
              />
              <Button disabled={!name.trim() || !query.trim()} onClick={save}>
                Save this search
              </Button>
            </div>
          )}
          {views.length === 0 ? (
            <p>No saved views yet.</p>
          ) : (
            <ul style={{ paddingLeft: 20 }}>
              {views.map((view, index) => (
                <li key={view.id} style={{ marginTop: 10 }}>
                  <strong>{view.name}</strong>{" "}
                  <span>({describeSmartView(view, sourceName(view))})</span>
                  <div>{view.query}</div>
                  <Button
                    aria-label={`Open ${view.name}`}
                    size="mini"
                    style={touchTarget}
                    onClick={() => open(view)}
                  >
                    Open
                  </Button>
                  <Button
                    aria-label={`Rename ${view.name}`}
                    size="mini"
                    style={touchTarget}
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
                    style={touchTarget}
                    onClick={() => edit((current) => moveSmartView(current, view.id, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label={`Move ${view.name} down`}
                    disabled={index === views.length - 1}
                    size="mini"
                    style={touchTarget}
                    onClick={() => edit((current) => moveSmartView(current, view.id, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    aria-label={`Delete ${view.name}`}
                    size="mini"
                    style={touchTarget}
                    onClick={() => {
                      if (globalThis.confirm(`Delete saved view "${view.name}"?`)) {
                        edit((current) => current.filter((item) => item.id !== view.id))
                      }
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {views.length > 0 && (
            <div>
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
