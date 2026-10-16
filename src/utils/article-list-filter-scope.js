import { reconcileArticleListSearchScope } from "./article-list-search-scope.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const ID_SCOPED_SOURCES = new Set(["category", "feed"])
const SOURCES_WITHOUT_DATE_FILTER = new Set(["home", "today"])

const getCanonicalSource = ({ from, id }) => ({
  from: from ?? "all",
  id: ID_SCOPED_SOURCES.has(from) ? String(id ?? "") : "",
})

export const createArticleListSourceIdentityKey = (source) => {
  const canonicalSource = getCanonicalSource(source)
  return JSON.stringify([canonicalSource.from, canonicalSource.id])
}

export const reconcileArticleListFilterScope = ({
  previousScope,
  nextScope,
  filterDate,
  filterString,
}) => {
  const sourceChanged =
    createArticleListSourceIdentityKey(previousScope) !==
    createArticleListSourceIdentityKey(nextScope)
  const searchTransition = reconcileArticleListSearchScope({
    previousScope,
    nextScope,
    filterString,
  })
  const dateMustBeCleared = sourceChanged || SOURCES_WITHOUT_DATE_FILTER.has(nextScope.from)

  return {
    sourceChanged,
    scopeChanged: searchTransition.scopeChanged,
    filterDate: dateMustBeCleared ? null : (filterDate ?? null),
    filterString: searchTransition.filterString,
  }
}

export const isArticleListDateFilterVisible = ({ from, homeMode = false }) =>
  !homeMode && !SOURCES_WITHOUT_DATE_FILTER.has(from)

export const isArticleListDateFilterActive = ({ from, filterDate }) =>
  !SOURCES_WITHOUT_DATE_FILTER.has(from) && Boolean(filterDate)
