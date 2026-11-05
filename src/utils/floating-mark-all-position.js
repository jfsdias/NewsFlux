const clampRatio = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

export const createFloatingPositionBounds = ({
  viewportWidth,
  viewportHeight,
  controlWidth,
  controlHeight,
  safeArea = {},
  bottomReserved = 0,
  edgeSpacing = 12,
}) => {
  const minX = Math.max(0, safeArea.left ?? 0) + edgeSpacing
  const minY = Math.max(0, safeArea.top ?? 0) + edgeSpacing

  return {
    minX,
    minY,
    maxX: Math.max(
      minX,
      viewportWidth - Math.max(0, safeArea.right ?? 0) - edgeSpacing - controlWidth,
    ),
    maxY: Math.max(
      minY,
      viewportHeight -
        Math.max(0, safeArea.bottom ?? 0) -
        Math.max(0, bottomReserved) -
        edgeSpacing -
        controlHeight,
    ),
  }
}

export const clampFloatingPosition = (position, bounds) => ({
  x: Math.min(
    bounds.maxX,
    Math.max(bounds.minX, Number.isFinite(position?.x) ? position.x : bounds.minX),
  ),
  y: Math.min(
    bounds.maxY,
    Math.max(bounds.minY, Number.isFinite(position?.y) ? position.y : bounds.minY),
  ),
})

export const normalizeFloatingPosition = (position, bounds) => {
  const clamped = clampFloatingPosition(position, bounds)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  return {
    x: width > 0 ? clampRatio((clamped.x - bounds.minX) / width) : 0,
    y: height > 0 ? clampRatio((clamped.y - bounds.minY) / height) : 0,
  }
}

export const denormalizeFloatingPosition = (normalizedPosition, bounds) =>
  clampFloatingPosition(
    {
      x: bounds.minX + clampRatio(normalizedPosition?.x) * Math.max(0, bounds.maxX - bounds.minX),
      y: bounds.minY + clampRatio(normalizedPosition?.y) * Math.max(0, bounds.maxY - bounds.minY),
    },
    bounds,
  )

export const parseFloatingPositionPreference = (value) => {
  try {
    const preference = JSON.parse(value)
    if (
      preference?.version !== 1 ||
      !Number.isFinite(preference.x) ||
      !Number.isFinite(preference.y)
    ) {
      return null
    }

    return { x: clampRatio(preference.x), y: clampRatio(preference.y) }
  } catch {
    return null
  }
}
