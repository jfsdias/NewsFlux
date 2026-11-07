const CATEGORY_ID_PREFIX_PATTERN = /^\s*(\d+)\s+·\s+(.+?)\s*$/u

const formatCategoryDisplayName = (category) => {
  const title = typeof category?.title === "string" ? category.title : ""
  const match = title.match(CATEGORY_ID_PREFIX_PATTERN)
  const categoryId = Number(category?.id)

  if (
    !match ||
    !Number.isSafeInteger(categoryId) ||
    categoryId <= 0 ||
    String(categoryId) !== match[1]
  ) {
    return title
  }

  const displayName = match[2].trim()
  return displayName || title
}

export default formatCategoryDisplayName
