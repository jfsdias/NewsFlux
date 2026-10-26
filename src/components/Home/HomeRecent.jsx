import { useStore } from "@nanostores/react"
import { useEffect } from "react"

import ArticleEntry from "@/components/Article/ArticleEntry"
import ArticleGridCard from "@/components/Article/ArticleGridCard"
import useArticleListLayout from "@/hooks/useArticleListLayout"
import { polyglotState } from "@/hooks/useLanguage"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import {
  resetStoryCandidateState,
  setStoryCandidateFailed,
  setStoryCandidatePending,
  setStoryCandidateReady,
} from "@/store/storyCandidateState"
import { projectRecentEntries } from "@/utils/home-editorial-projection"
import { getHomeIdentityKey } from "@/utils/home-page"
import startHomeStoryCandidateRuntime from "@/utils/story-candidate-runtime"
import { useHomeStoryProjection } from "@/utils/story-identity"

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
      return
    }
    const runtime = startHomeStoryCandidateRuntime({
      contentStore: contentState,
      identityKey,
      sessionRevision,
      onPending: setStoryCandidatePending,
      onReady: setStoryCandidateReady,
      onFailed: setStoryCandidateFailed,
      onDispose: resetStoryCandidateState,
    })
    return () => runtime.dispose()
  }, [identityKey, sessionRevision])

  const entryById = new Map(
    projectRecentEntries(entries, highlightIds).map((entry) => [entry.id, entry]),
  )
  const recentEntries = recentIds.map((id) => entryById.get(id)).filter(Boolean)
  const storyItems = useHomeStoryProjection({ recentEntries, sessionRevision })
  const effectiveEntries = storyItems
    ? storyItems.map((item) =>
        item.type === "story"
          ? {
              ...item.representative,
              _storyData: item.data,
              _storyAlternatives: item.alternatives,
            }
          : item.data,
      )
    : recentEntries

  const { cardColumnCount, virtualItems: rows } = useArticleListLayout({
    entries: effectiveEntries,
    layout: "card",
    scrollRootRef,
  })

  if (effectiveEntries.length === 0) {
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
              <div
                key={entry.id}
                className="article-card-grid-cell"
                data-story-id={entry._storyData?.storyId}
                data-story-member-count={entry._storyData?.memberCount}
                role="listitem"
              >
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
