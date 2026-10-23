import { useState } from "react"

import {
  analyzeLoadedImage,
  getSourceMonogram,
  isProviderIconUsable,
  resolveAdaptivePlate,
} from "@/utils/source-identity"

import "./SourceMark.css"

const SIZES = new Set([16, 20, 24])

const RssGlyph = () => (
  <svg
    aria-hidden="true"
    className="source-mark__rss"
    fill="none"
    focusable="false"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="4"
    viewBox="0 0 48 48"
  >
    <circle cx="9" cy="39" fill="currentColor" r="3" stroke="none" />
    <path d="M9 22c9.389 0 17 7.611 17 17" />
    <path d="M9 9c16.569 0 30 13.431 30 30" />
  </svg>
)

const SourceMark = ({
  feed,
  providerIconUrl = null,
  providerIconWidth = null,
  providerIconHeight = null,
  size = 20,
  className = "",
}) => {
  const [imageState, setImageState] = useState({ url: null, unavailable: false, plate: "neutral" })
  const normalizedSize = SIZES.has(size) ? size : 20
  const state = imageState.url === providerIconUrl ? imageState : null
  const dimensionsKnown = Number.isFinite(providerIconWidth) && Number.isFinite(providerIconHeight)
  const knownDimensionsInvalid =
    dimensionsKnown && !isProviderIconUsable(providerIconWidth, providerIconHeight)
  const imageUnavailable = Boolean(state?.unavailable) || knownDimensionsInvalid
  const showProviderIcon = Boolean(providerIconUrl) && !imageUnavailable
  const monogram = getSourceMonogram(feed)

  const handleImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (!isProviderIconUsable(naturalWidth, naturalHeight)) {
      setImageState({ url: providerIconUrl, unavailable: true, plate: "neutral" })
      return
    }

    const analysis = analyzeLoadedImage(event.currentTarget)
    const plate = resolveAdaptivePlate(analysis) ?? "neutral"
    setImageState({ url: providerIconUrl, unavailable: false, plate })
  }

  const handleImageError = () => {
    setImageState({ url: providerIconUrl, unavailable: true, plate: "neutral" })
  }

  const plate = state?.plate ?? "neutral"
  const plateClass = `source-mark--${plate}`

  return (
    <span
      aria-hidden="true"
      className={`source-mark ${plateClass} ${className}`.trim()}
      data-source-mark-fallback={showProviderIcon ? "provider" : monogram ? "monogram" : "rss"}
      data-source-mark-plate={plate}
      style={{ "--source-mark-size": `${normalizedSize}px` }}
    >
      {showProviderIcon ? (
        <img
          alt=""
          className="source-mark__image"
          src={providerIconUrl}
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      ) : monogram ? (
        <span aria-hidden="true" className="source-mark__monogram">
          {monogram}
        </span>
      ) : (
        <RssGlyph />
      )}
    </span>
  )
}

export default SourceMark
