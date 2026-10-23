const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null

const splitGraphemes = (value) => {
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(value)].map(({ segment }) => segment)
  }

  return [...value]
    .map((character, index, characters) => {
      if (/\p{M}/u.test(character)) {
        return ""
      }

      let grapheme = character
      for (
        let next = index + 1;
        next < characters.length && /\p{M}/u.test(characters[next]);
        next += 1
      ) {
        grapheme += characters[next]
      }
      return grapheme
    })
    .filter(Boolean)
}

const asText = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .trim()

const getSafeHostname = (value) => {
  const candidate = asText(value)
  if (!candidate) {
    return null
  }

  try {
    const url = new URL(candidate)
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      return null
    }
    return url.hostname || null
  } catch {
    return null
  }
}

const isIpLiteral = (hostname) =>
  /^\[[\da-f:.]+\]$/i.test(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)

const getSourceDisplayName = (feed = {}) => {
  const title = asText(feed.title)
  if (title) {
    return title
  }

  return getSafeHostname(feed.site_url) ?? getSafeHostname(feed.feed_url) ?? "Source"
}

const getTextualGrapheme = (value) => {
  const graphemes = splitGraphemes(asText(value))
  for (const grapheme of graphemes) {
    if (/\p{Extended_Pictographic}/u.test(grapheme)) {
      continue
    }
    if (/\p{L}|\p{N}/u.test(grapheme)) {
      return splitGraphemes(grapheme.toUpperCase())[0] ?? null
    }
  }
  return null
}

const getSourceMonogram = (feed = {}) => {
  const fromTitle = getTextualGrapheme(feed.title)
  if (fromTitle) {
    return fromTitle
  }

  for (const value of [feed.site_url, feed.feed_url]) {
    const hostname = getSafeHostname(value)
    if (hostname && !isIpLiteral(hostname)) {
      const monogram = getTextualGrapheme(hostname)
      if (monogram) {
        return monogram
      }
    }
  }

  return null
}

const isProviderIconUsable = (width, height) =>
  Number.isFinite(width) && Number.isFinite(height) && width >= 8 && height >= 8

const analyzeImageData = (imageData) => {
  const { data } = imageData ?? {}
  if (!data || data.length < 4 || data.length % 4 !== 0) {
    return null
  }

  let weightedLuminance = 0
  let alphaTotal = 0
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255
    if (alpha === 0) {
      continue
    }

    const [red, green, blue] = [data[index], data[index + 1], data[index + 2]].map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    weightedLuminance += (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha
    alphaTotal += alpha
  }

  if (alphaTotal === 0) {
    return null
  }

  return weightedLuminance / alphaTotal >= 0.52 ? "light" : "dark"
}

const resolveAdaptivePlate = (iconLuminance) => {
  if (iconLuminance === "dark") {
    return "light"
  }
  if (iconLuminance === "light") {
    return "dark"
  }
  return null
}

const analyzeLoadedImage = (image, documentRef = globalThis.document) => {
  if (
    !documentRef ||
    !image ||
    !Number.isFinite(image.naturalWidth) ||
    !Number.isFinite(image.naturalHeight) ||
    image.naturalWidth < 1 ||
    image.naturalHeight < 1
  ) {
    return null
  }

  try {
    const canvas = documentRef.createElement("canvas")
    canvas.width = Math.min(16, image.naturalWidth)
    canvas.height = Math.min(16, image.naturalHeight)
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) {
      return null
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return analyzeImageData(context.getImageData(0, 0, canvas.width, canvas.height))
  } catch {
    // Cross-origin canvas taint is an expected capability boundary. Keep the loaded provider image.
    return null
  }
}

export {
  analyzeImageData,
  analyzeLoadedImage,
  getSafeHostname,
  getSourceDisplayName,
  getSourceMonogram,
  isProviderIconUsable,
  resolveAdaptivePlate,
}
