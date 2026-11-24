import { useEffect, useMemo, useState } from "react"

import { projectDuplicates } from "@/utils/duplicate-projection"
import {
  buildBriefing,
  getEditorialTitle,
  groupHomeStories,
  projectFocus,
} from "@/utils/home-editorial-intelligence"
import buildSourceReview from "@/utils/source-review"

import "./HomeIntelligence.css"

const LIMIT = 250
const sourceId = (entry) => entry.feed_id ?? entry.feed?.id
const sourceName = (entry) => entry.feed?.title || String(sourceId(entry) ?? "Unknown source")

const HomeIntelligence = ({ articleActivation, entries, polyglot }) => {
  const [feedId, setFeedId] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) {
      return
    }
    const timer = globalThis.setInterval(() => setNow(Date.now()), 60_000)
    return () => globalThis.clearInterval(timer)
  }, [enabled])
  const [preferences, setPreferences] = useState({ sources: {}, categories: {} })
  const [categoryId, setCategoryId] = useState("")
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
  const categories = useMemo(() => {
    const found = new Map()
    for (const entry of loaded) {
      const category = entry.feed?.category
      if (category?.id != null && !found.has(String(category.id))) {
        found.set(String(category.id), category.title || String(category.id))
      }
    }
    return [...found]
  }, [loaded])
  const activeCategoryId = categories.some(([id]) => id === categoryId) ? categoryId : ""
  const activeFeedId = sources.some(([id]) => id === feedId) ? feedId : ""
  const focused = useMemo(() => projectFocus(loaded, activeFeedId), [loaded, activeFeedId])
  const briefing = useMemo(
    () =>
      buildBriefing(focused, {
        preferences: preferences.sources,
        categoryPreferences: preferences.categories,
        now,
      }),
    [focused, preferences, now],
  )
  const allStories = useMemo(() => (enabled ? groupHomeStories(loaded) : []), [enabled, loaded])
  const stories = useMemo(
    () =>
      allStories.filter(
        (group) =>
          !activeFeedId || group.entries.some((entry) => String(sourceId(entry)) === activeFeedId),
      ),
    [allStories, activeFeedId],
  )
  const sourceReview = useMemo(
    () => (enabled ? buildSourceReview(loaded, allStories) : []),
    [enabled, loaded, allStories],
  )
  const duplicateGroups = useMemo(() => {
    if (!enabled) {
      return []
    }
    const result = []
    for (const key of ["hash", "url", "title"]) {
      const { counts } = projectDuplicates(loaded, key)
      for (const [id] of counts) {
        const representative = loaded.find((entry) => entry.id === id)
        const members = [
          ...new Map(
            loaded
              .filter((entry) => entry[key] === representative[key])
              .map((entry) => [entry.id, entry]),
          ).values(),
        ]
        if (activeFeedId && !members.some((entry) => String(sourceId(entry)) === activeFeedId)) {
          continue
        }
        if (members.length < 2) {
          continue
        }
        result.push({ key, members })
      }
    }
    return result
  }, [enabled, loaded, activeFeedId])
  const titleFor = (entry) => getEditorialTitle(entry, polyglot.t("article_card.untitled_article"))
  const link = (entry) => <a {...articleActivation.getPrimaryLinkProps(entry)}>{titleFor(entry)}</a>
  const title = polyglot.t("home_intelligence.title")
  return (
    <section aria-label={title} className="home-intelligence">
      <h2 className="home-section-heading">{title}</h2>
      <button
        aria-pressed={enabled}
        type="button"
        onClick={() => {
          setNow(Date.now())
          setEnabled(!enabled)
        }}
      >
        {polyglot.t(enabled ? "home_intelligence.disable" : "home_intelligence.enable")}
      </button>
      {enabled && (
        <>
          <p>{polyglot.t("home_intelligence.scope_short")}</p>
          <details>
            <summary>{polyglot.t("home_intelligence.methodology")}</summary>
            <p>{polyglot.t("home_intelligence.scope")}</p>
          </details>
          <label>
            {polyglot.t("home_intelligence.focus")}{" "}
            <select value={activeFeedId} onChange={(event) => setFeedId(event.target.value)}>
              <option value="">{polyglot.t("home_intelligence.all_sources")}</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {activeFeedId && (
            <p>
              <button
                type="button"
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    sources: { ...preferences.sources, [activeFeedId]: 1 },
                  })
                }
              >
                {polyglot.t("home_intelligence.more")}
              </button>{" "}
              <button
                type="button"
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    sources: { ...preferences.sources, [activeFeedId]: -1 },
                  })
                }
              >
                {polyglot.t("home_intelligence.less")}
              </button>{" "}
              <button
                type="button"
                onClick={() => updatePreferences({ sources: {}, categories: {} })}
              >
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
              {polyglot.t("home_intelligence.preference", {
                value: preferences.sources[activeFeedId] ?? 0,
              })}
            </p>
          )}
          <label>
            {polyglot.t("home_intelligence.category")}{" "}
            <select
              value={activeCategoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">{polyglot.t("home_intelligence.choose_category")}</option>
              {categories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {activeCategoryId && (
            <p>
              <button
                type="button"
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    categories: { ...preferences.categories, [activeCategoryId]: 1 },
                  })
                }
              >
                {polyglot.t("home_intelligence.more_category")}
              </button>{" "}
              <button
                type="button"
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    categories: { ...preferences.categories, [activeCategoryId]: -1 },
                  })
                }
              >
                {polyglot.t("home_intelligence.less_category")}
              </button>{" "}
              {polyglot.t("home_intelligence.preference", {
                value: preferences.categories[activeCategoryId] ?? 0,
              })}
            </p>
          )}
          {!activeFeedId && (
            <p>
              <button
                type="button"
                onClick={() => updatePreferences({ sources: {}, categories: {} })}
              >
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
              </button>
            </p>
          )}
          <details>
            <summary>{polyglot.t("home_intelligence.source_review")}</summary>
            <p>{polyglot.t("home_intelligence.source_review_scope")}</p>
            {sourceReview.length === 0 ? (
              <p>{polyglot.t("home_intelligence.source_review_empty")}</p>
            ) : (
              <>
                <div aria-hidden="true" className="source-review-heading">
                  <span>{polyglot.t("home_intelligence.source_review_name")}</span>
                  <span>{polyglot.t("home_intelligence.source_review_entries")}</span>
                  <span>{polyglot.t("home_intelligence.source_review_related")}</span>
                </div>
                <ul className="source-review-list">
                  {sourceReview.map((source) => (
                    <li key={source.id}>
                      <span>{source.name}</span>
                      <span>
                        <span className="visually-hidden">
                          {polyglot.t("home_intelligence.source_review_entries")}:{" "}
                        </span>
                        {source.entryCount}
                      </span>
                      <span>
                        <span className="visually-hidden">
                          {polyglot.t("home_intelligence.source_review_related")}:{" "}
                        </span>
                        {source.relatedCount}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
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
                  {link(entry)} — {sourceName(entry)} —{" "}
                  {polyglot.t("home_intelligence.reason", {
                    source: preferences.sources[String(sourceId(entry))] ?? 0,
                    category: preferences.categories[String(entry.feed?.category?.id)] ?? 0,
                  })}
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
                {titleFor(group.entries[0])} ({group.entries.length})
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
                {titleFor(group.members[0])} ({group.members.length}; {group.key})
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
