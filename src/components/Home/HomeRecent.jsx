import { useStore } from "@nanostores/react"
import { useEffect } from "react"

import ArticleEntry from "@/components/Article/ArticleEntry"
import ArticleGridCard from "@/components/Article/ArticleGridCard"
import useArticleListLayout from "@/hooks/useArticleListLayout"
import { polyglotState } from "@/hooks/useLanguage"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { projectRecentEntries } from "@/utils/home-editorial-projection"
import { getHomeIdentityKey } from "@/utils/home-page"
import { startHomeStoryCandidateRuntime } from "@/utils/story-candidate-runtime"

import "@/components/Article/ArticleList.css"

const STORY_CANDIDATE_RANKING_ENABLED = import.meta.env.VITE_STORY_CANDIDATE_RANKING === "1"

const HomeRecent = ({
  articleActivation,
  entries,
  highlightIds,
  observeRead,
  recentIds,
  scrollRootRef,
}) => {
  const { polyglot } = useStore(polyglotState)
  const identity = useStore(homeIdentityState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const identityKey = getHomeIdentityKey(identity)

  useEffect(() => {
    if (!STORY_CANDIDATE_RANKING_ENABLED) {
      return undefined
    }
    const runtime = startHomeStoryCandidateRuntime({
      contentStore: contentState,
      identityKey,
      sessionRevision,
    })
    return () => runtime.dispose()
  }, [identityKey, sessionRevision])

  const entryById = new Map(
    projectRecentEntries(entries, highlightIds).map((entry) => [entry.id, entry]),
  )
  const recentEntries = recentIds.map((id) => entryById.get(id)).filter(Boolean)
  const { cardColumnCount, virtualItems: rows } = useArticleListLayout({
    entries: recentEntries,
    layout: "card",
    scrollRootRef,
  })

  if (recentEntries.length === 0) {
    return null
  }

  return (
    <section aria-label={polyglot.t("home_page.section_recent")} className="home-recent">
      <h2 className="home-section-heading">{polyglot.t("home_page.section_recent")}</h2>
      <div role="list">
        {rows.map((row) => (
          <div
            key={row[0].id}
            className="article-card-grid-row"
            role="presentation"
            style={{ "--article-card-grid-columns": cardColumnCount }}
          >
            {row.map((entry) => (
              <div key={entry.id} className="article-card-grid-cell" role="listitem">
                <ArticleEntry
                  articleActivation={articleActivation}
                  entry={entry}
                  layout="card"
                  observeRead={observeRead}
                  presenter={ArticleGridCard}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export default HomeRecent
