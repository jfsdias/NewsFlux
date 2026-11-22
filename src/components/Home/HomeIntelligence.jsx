import { useMemo, useState } from "react"

import { projectDuplicates } from "@/utils/duplicate-projection"
import { buildBriefing, groupHomeStories, projectFocus } from "@/utils/home-editorial-intelligence"

import "./HomeIntelligence.css"

const LIMIT = 250
const sourceId = (entry) => entry.feed_id ?? entry.feed?.id
const sourceName = (entry) => entry.feed?.title || String(sourceId(entry) ?? "Unknown source")

const HomeIntelligence = ({ articleActivation, entries, polyglot }) => {
  const [feedId, setFeedId] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [preferences, setPreferences] = useState({})
  const [previousPreferences, setPreviousPreferences] = useState(null)
  const updatePreferences = (next) => {
    setPreviousPreferences(preferences)
    setPreferences(next)
  }
  const loaded = useMemo(() => entries.slice(0, LIMIT), [entries])
  const sources = useMemo(() => {
    const found = new Map()
    for (const entry of loaded) {
      const id = sourceId(entry)
      if (id != null && !found.has(String(id))) {
        found.set(String(id), sourceName(entry))
      }
    }
    return [...found]
  }, [loaded])
  const focused = useMemo(() => projectFocus(loaded, feedId), [loaded, feedId])
  const briefing = useMemo(() => buildBriefing(focused, { preferences }), [focused, preferences])
  const stories = useMemo(() => (enabled ? groupHomeStories(focused) : []), [enabled, focused])
  const duplicateGroups = useMemo(() => {
    if (!enabled) {
      return []
    }
    const result = []
    const seen = new Set()
    for (const key of ["hash", "url", "title"]) {
      const { counts } = projectDuplicates(focused, key)
      for (const [id] of counts) {
        const representative = focused.find((entry) => entry.id === id)
        const members = focused.filter(
          (entry) => entry[key] === representative[key] && !seen.has(entry.id),
        )
        if (members.length < 2) {
          continue
        }
        for (const entry of members) {
          seen.add(entry.id)
        }
        result.push({ key, members })
      }
    }
    return result
  }, [enabled, focused])
  const link = (entry) => <a {...articleActivation.getPrimaryLinkProps(entry)}>{entry.title}</a>
  const title = polyglot.t("home_intelligence.title")
  return (
    <section aria-label={title} className="home-intelligence">
      <h2 className="home-section-heading">{title}</h2>
      <button aria-pressed={enabled} type="button" onClick={() => setEnabled(!enabled)}>
        {polyglot.t(enabled ? "home_intelligence.disable" : "home_intelligence.enable")}
      </button>
      {enabled && (
        <>
          <p>{polyglot.t("home_intelligence.scope")}</p>
          <label>
            {polyglot.t("home_intelligence.focus")}{" "}
            <select value={feedId} onChange={(event) => setFeedId(event.target.value)}>
              <option value="">{polyglot.t("home_intelligence.all_sources")}</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {feedId && (
            <p>
              <button
                type="button"
                onClick={() => updatePreferences({ ...preferences, [feedId]: 1 })}
              >
                {polyglot.t("home_intelligence.more")}
              </button>{" "}
              <button
                type="button"
                onClick={() => updatePreferences({ ...preferences, [feedId]: -1 })}
              >
                {polyglot.t("home_intelligence.less")}
              </button>{" "}
              <button type="button" onClick={() => updatePreferences({})}>
                {polyglot.t("home_intelligence.reset")}
              </button>{" "}
              <button
                disabled={!previousPreferences}
                type="button"
                onClick={() => {
                  setPreferences(previousPreferences)
                  setPreviousPreferences(null)
                }}
              >
                {polyglot.t("home_intelligence.undo")}
              </button>{" "}
              {polyglot.t("home_intelligence.preference", { value: preferences[feedId] ?? 0 })}
            </p>
          )}
          <h3>{polyglot.t("home_intelligence.briefing")}</h3>
          <p>
            {polyglot.t("home_intelligence.counts", {
              entries: focused.length,
              sources: briefing.sourceCount,
              unread: briefing.unreadCount,
            })}
          </p>
          {briefing.entries.length === 0 ? (
            <p>{polyglot.t("home_intelligence.empty")}</p>
          ) : (
            <ol>
              {briefing.entries.map((entry) => (
                <li key={entry.id}>
                  {link(entry)} — {sourceName(entry)}
                </li>
              ))}
            </ol>
          )}
          <h3>{polyglot.t("home_intelligence.related")}</h3>
          <p>{polyglot.t("home_intelligence.related_explanation")}</p>
          {stories.length === 0 && <p>{polyglot.t("home_intelligence.no_related")}</p>}
          {stories.map((group) => (
            <details key={group.entries.map((entry) => entry.id).join("-")}>
              <summary>
                {group.entries[0].title} ({group.entries.length})
              </summary>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    {link(entry)} — {sourceName(entry)}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <h3>{polyglot.t("home_intelligence.duplicates")}</h3>
          <p>{polyglot.t("home_intelligence.duplicate_explanation")}</p>
          {duplicateGroups.length === 0 && <p>{polyglot.t("home_intelligence.no_duplicates")}</p>}
          {duplicateGroups.map((group) => (
            <details key={`${group.key}-${group.members[0].id}`}>
              <summary>
                {group.members[0].title} ({group.members.length}; {group.key})
              </summary>
              <ul>
                {group.members.map((entry) => (
                  <li key={entry.id}>
                    {link(entry)} — {sourceName(entry)}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
    </section>
  )
}
export default HomeIntelligence
