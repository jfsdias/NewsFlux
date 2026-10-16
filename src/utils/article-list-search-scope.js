const ID_SCOPED_SOURCES = new Set(["category", "feed"])

const getCanonicalScope = ({ from, id, showStatus }) => ({
  from: from ?? "all",
  id: ID_SCOPED_SOURCES.has(from) ? String(id ?? "") : "",
  showStatus: showStatus ?? "all",
})

export const createArticleListSearchScopeKey = (scope) => {
  const canonicalScope = getCanonicalScope(scope)
  return JSON.stringify([canonicalScope.from, canonicalScope.id, canonicalScope.showStatus])
}

export const reconcileArticleListSearchScope = ({ previousScope, nextScope, filterString }) => {
  const scopeChanged =
    createArticleListSearchScopeKey(previousScope) !== createArticleListSearchScopeKey(nextScope)
  const isHomeSearchHandoff =
    previousScope.from === "home" &&
    nextScope.from === "all" &&
    previousScope.showStatus === nextScope.showStatus &&
    Boolean(filterString)

  return {
    scopeChanged,
    filterString: scopeChanged && !isHomeSearchHandoff ? "" : (filterString ?? ""),
  }
}

export const resolveArticleListSearchInputValue = ({
  activeQuery,
  activeScopeKey,
  draftQuery,
  draftScopeKey,
  draftValue,
}) => {
  if (activeScopeKey !== draftScopeKey || activeQuery !== draftQuery) {
    return activeQuery
  }

  return draftValue
}
