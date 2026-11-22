import { Button, Input } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useState } from "react"
import { useNavigate } from "react-router"

import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState, updateSettings } from "@/store/settingsState"
import { pendingSmartViewState, smartViewsState, updateSmartViews } from "@/store/smartViewsState"
import { getHomeIdentityKey } from "@/utils/home-page"
import {
  canOpenSmartView,
  getSmartViews,
  moveSmartView,
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
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const key = getHomeIdentityKey(identity)
  const views = getSmartViews(storage, key)
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
      filterDate,
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
    updateSettings({
      showStatus: view.showStatus,
      orderBy: view.orderBy,
      orderDirection: view.orderDirection,
    })
    pendingSmartViewState.set({ key, view })
    onOpenView()
    onClose()
    navigate(smartViewPath(view))
  }
  const exportViews = () => {
    const file = new Blob([JSON.stringify({ version: 1, views }, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(file)
    const link = document.createElement("a")
    link.href = url
    link.download = "newsflux-smart-views.json"
    link.click()
    URL.revokeObjectURL(url)
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
                  <span>
                    ({view.source}
                    {view.sourceId ? ` ${view.sourceId}` : ""}; {view.showStatus})
                  </span>
                  <div>{view.query}</div>
                  <Button size="mini" onClick={() => open(view)}>
                    Open
                  </Button>
                  <Button
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
                    size="mini"
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
