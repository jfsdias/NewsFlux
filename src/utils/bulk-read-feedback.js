const OPERATION_MESSAGES = {
  markAll: {
    success: "article_list.mark_all_as_read_success_scoped",
    failure: "article_list.mark_all_as_read_error_scoped",
  },
  older: {
    success: "article_list.mark_older_as_read_success_scoped",
    partial: "article_list.mark_older_as_read_partial_scoped",
    failure: "article_list.mark_older_as_read_error_scoped",
  },
  relative: {
    success: "article_list.mark_relative_as_read_success_scoped",
    partial: "article_list.mark_relative_as_read_partial_scoped",
    failure: "article_list.mark_relative_as_read_error_scoped",
  },
  selected: {
    success: "article_selection.read_success_scoped",
    partial: "article_selection.partial_result_scoped",
    failure: "article_selection.read_error_scoped",
  },
}

const uniqueIds = (ids) => {
  const unique = new Map()
  for (const id of ids) {
    unique.set(String(id), id)
  }
  return [...unique.values()]
}

export const getBulkReadScopeLabel = ({
  categories = [],
  feeds = [],
  from,
  id,
  isFiltered = false,
  polyglot,
}) => {
  const t = (key, params) => polyglot.t(key, params)
  let scope

  if (from === "feed") {
    const feed = feeds.find((item) => String(item.id) === String(id))
    scope = feed?.title
      ? t("article_list.bulk_read_scope_named", {
          name: feed.title,
          type: t("home_page.type_feed"),
        })
      : t("article_list.bulk_read_scope_feed")
  } else if (from === "category") {
    const category = categories.find((item) => String(item.id) === String(id))
    scope = category?.title
      ? t("article_list.bulk_read_scope_named", {
          name: category.title,
          type: t("home_page.type_category"),
        })
      : t("article_list.bulk_read_scope_category")
  } else {
    const scopeKeys = {
      all: "article_list.bulk_read_scope_all",
      unread: "article_list.bulk_read_scope_unread",
      starred: "article_list.bulk_read_scope_starred",
      today: "article_list.bulk_read_scope_today",
      home: "article_list.bulk_read_scope_home",
    }
    scope = t(scopeKeys[from] ?? "article_list.bulk_read_scope_current")
  }

  return isFiltered ? t("article_list.bulk_read_scope_filtered", { scope }) : scope
}

export const createBulkReadFeedback = ({
  acknowledgedIds,
  direction,
  operation,
  operationLabel,
  requestedCount,
  scope,
  status,
}) => {
  const messages = OPERATION_MESSAGES[operation]
  if (!messages) {
    throw new Error(`Unsupported bulk read feedback operation: ${operation}`)
  }

  const ids = Array.isArray(acknowledgedIds) ? uniqueIds(acknowledgedIds) : null
  const acknowledgedCount = ids?.length ?? null
  const params = { scope }
  if (operation === "relative" && direction) {
    params.direction = direction
  }

  const hasAcknowledgements = acknowledgedCount > 0
  const isPartial = hasAcknowledgements && ["partial", "failure", "failed"].includes(status)

  if (isPartial) {
    const hasKnownTotal =
      Number.isSafeInteger(requestedCount) &&
      requestedCount >= acknowledgedCount &&
      requestedCount > 0

    if (hasKnownTotal && messages.partial) {
      return {
        notificationType: "warning",
        titleKey: messages.partial,
        titleParams: {
          ...params,
          marked: acknowledgedCount,
          total: requestedCount,
        },
        undoEntryIds: ids,
      }
    }

    return {
      notificationType: "warning",
      titleKey: "article_list.bulk_read_partial_count_unknown",
      titleParams: {
        ...params,
        marked: acknowledgedCount ?? 0,
        smart_count: acknowledgedCount ?? 0,
        operation: operationLabel,
      },
      undoEntryIds: ids ?? [],
    }
  }

  if (status === "success") {
    if (acknowledgedCount === null) {
      return {
        notificationType: "success",
        titleKey: "article_list.bulk_read_success_count_unknown",
        titleParams: { ...params, operation: operationLabel },
        undoEntryIds: [],
      }
    }

    return {
      notificationType: "success",
      titleKey: messages.success,
      titleParams: { ...params, smart_count: acknowledgedCount },
      undoEntryIds: ids,
    }
  }

  return {
    notificationType: "error",
    titleKey: messages.failure,
    titleParams: params,
    undoEntryIds: [],
  }
}

export default createBulkReadFeedback
