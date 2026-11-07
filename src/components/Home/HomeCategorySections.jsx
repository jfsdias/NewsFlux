import { useStore } from "@nanostores/react"
import { useMemo } from "react"

import ArticleEntry from "@/components/Article/ArticleEntry"
import ArticleGridCard from "@/components/Article/ArticleGridCard"
import useArticleListLayout from "@/hooks/useArticleListLayout"
import { polyglotState } from "@/hooks/useLanguage"

import "@/components/Article/ArticleList.css"

const HomeCategorySection = ({ articleActivation, entries, lane, observeRead, scrollRootRef }) => {
  const { polyglot } = useStore(polyglotState)
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [String(entry.id), entry])),
    [entries],
  )
  const sectionEntries = lane.entryIds.map((id) => entryById.get(String(id))).filter(Boolean)
  const { cardColumnCount, virtualItems: rows } = useArticleListLayout({
    entries: sectionEntries,
    layout: "card",
    scrollRootRef,
  })

  if (sectionEntries.length === 0) {
    return null
  }

  const headingId = `home-category-${lane.categoryId}-heading`

  return (
    <section
      className="home-article-section home-category-section"
      data-category-id={lane.categoryId}
      aria-label={polyglot.t("home_page.category_section_label", {
        category: lane.categoryTitle,
      })}
    >
      <h2 className="home-section-heading" id={headingId}>
        {lane.categoryTitle}
      </h2>
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

const HomeCategorySections = ({
  articleActivation,
  categoryLanes,
  entries,
  observeRead,
  scrollRootRef,
}) =>
  categoryLanes.map((lane) => (
    <HomeCategorySection
      key={lane.categoryId}
      articleActivation={articleActivation}
      entries={entries}
      lane={lane}
      observeRead={observeRead}
      scrollRootRef={scrollRootRef}
    />
  ))

export default HomeCategorySections
