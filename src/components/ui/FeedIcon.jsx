import { useRef, useState } from "react"

import useFeedIcons from "@/hooks/useFeedIcons"
import { updateFeedIcon } from "@/store/feedIconsState"
import getFeedMonogram from "@/utils/feed-icon"

import "./FeedIcon.css"

const DEFAULT_ICON_URL = `${import.meta.env.BASE_URL}default-feed-icon.png`

const FeedIcon = ({
  feed,
  className = "feed-icon",
  fallbackIcon = null,
  monogramFallback = false,
}) => {
  const { icon_id: iconId } = feed.icon

  const [providerFailed, setProviderFailed] = useState(false)

  const imgRef = useRef(null)

  const fetchedIcon = useFeedIcons(iconId, feed)
  const fetchedIconURL = fetchedIcon?.url

  // Only the Miniflux provider icon or a local fallback is ever shown: no third-party lookup.
  const showLocalFallback = iconId === 0 || providerFailed

  const handleImageLoad = () => {
    if (imgRef.current) {
      const { naturalWidth, naturalHeight } = imgRef.current
      if (naturalWidth > 200 && naturalHeight > 200 && fetchedIcon.width === null) {
        updateFeedIcon(iconId, { width: naturalWidth, height: naturalHeight })
      }
    }
  }

  const handleError = () => {
    if (fetchedIconURL) {
      setProviderFailed(true)
    }
  }

  if (fallbackIcon && (showLocalFallback || !fetchedIconURL)) {
    return fallbackIcon
  }

  if (showLocalFallback && monogramFallback) {
    return (
      <span aria-hidden="true" className={`${className} feed-icon-monogram`}>
        {getFeedMonogram(feed.title)}
      </span>
    )
  }

  if (showLocalFallback) {
    return (
      <img
        alt=""
        className={className}
        src={DEFAULT_ICON_URL}
        style={{ borderRadius: "20%", backgroundColor: "rgba(255, 255, 255, 0.1)" }}
      />
    )
  }

  return (
    <img
      ref={imgRef}
      alt=""
      className={className}
      src={fetchedIconURL ?? DEFAULT_ICON_URL}
      style={{
        borderRadius: "20%",
        backgroundColor: "rgba(255, 255, 255, 0.1)",
      }}
      onError={handleError}
      onLoad={handleImageLoad}
    />
  )
}

export default FeedIcon
