const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null

const getFirstGrapheme = (value) => {
  if (graphemeSegmenter) {
    return graphemeSegmenter.segment(value)[Symbol.iterator]().next().value?.segment
  }

  const initial = [...value][0]
  if (!initial) {
    return null
  }

  const followingMarks = value.slice(initial.length).match(/^[\p{M}\uFE0E\uFE0F]*/u)?.[0] ?? ""
  return `${initial}${followingMarks}`
}

const getFeedMonogram = (title) => {
  const initial = getFirstGrapheme(String(title ?? "").trim())
  return initial ? getFirstGrapheme(initial.toUpperCase()) : "•"
}

export default getFeedMonogram
