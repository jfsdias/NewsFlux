const CATEGORY_ORDINAL_PREFIX_PATTERN = /^\s*(\d{1,2})\s+·\s+(.+?)\s*$/u

const formatCategoryDisplayName = (category) => {
  const title = typeof category?.title === "string" ? category.title : ""
  const match = title.match(CATEGORY_ORDINAL_PREFIX_PATTERN)
  const ordinal = Number(match?.[1])

  if (!match || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99) {
    return title
  }

  const displayName = match[2].trim()
  return displayName || title
}

export default formatCategoryDisplayName
