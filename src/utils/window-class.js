export const WINDOW_CLASSES = Object.freeze({
  COMPACT: "COMPACT",
  MEDIUM: "MEDIUM",
  DESKTOP: "DESKTOP",
})

/**
 * Classifies a window viewport into one of the frozen NAV-VISUAL window classes:
 * - COMPACT: width < 600px AND height >= 480px
 * - MEDIUM: (600px <= width < 993px) OR (width < 600px AND height < 480px)
 * - DESKTOP: width >= 993px
 *
 * (Note: 884x1104 is classified as MEDIUM; EXPANDED is not a navigation class).
 *
 * @param {number|{width: number, height: number}} dimensionsOrWidth
 * @param {number} [maybeHeight]
 * @returns {string} One of WINDOW_CLASSES (COMPACT, MEDIUM, DESKTOP)
 */
export const classifyWindowClass = (dimensionsOrWidth, maybeHeight) => {
  let width
  let height

  if (typeof dimensionsOrWidth === "object" && dimensionsOrWidth !== null) {
    width = dimensionsOrWidth.width
    height = dimensionsOrWidth.height
  } else {
    width = dimensionsOrWidth
    height = maybeHeight
  }

  const w = Number(width)
  const h = Number(height)

  if (w >= 993) {
    return WINDOW_CLASSES.DESKTOP
  }

  if (w < 600 && h >= 480) {
    return WINDOW_CLASSES.COMPACT
  }

  return WINDOW_CLASSES.MEDIUM
}

export const isCompactClass = (windowClass) => windowClass === WINDOW_CLASSES.COMPACT
export const isMediumClass = (windowClass) => windowClass === WINDOW_CLASSES.MEDIUM
export const isDesktopClass = (windowClass) => windowClass === WINDOW_CLASSES.DESKTOP
