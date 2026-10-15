const getFeedMonogram = (title) => {
  const initial = [...String(title ?? "").trim()][0]
  return initial ? initial.toUpperCase() : "•"
}

export default getFeedMonogram
