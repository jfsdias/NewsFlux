import { lazy, Suspense, useEffect, useRef, useState } from "react"

import {
  findNearestScrollableAncestor,
  observeNearViewport,
} from "@/utils/near-viewport-activation"

const PlyrPlayer = lazy(() => import("./PlyrPlayer"))
const DEFAULT_VIDEO_ASPECT_RATIO = "2 / 1"

const getIsAudioPlayer = ({ elementType, enclosure, sourceType, src }) => {
  if (elementType === "audio" || enclosure?.kind === "audio") {
    return true
  }

  const mimeType = sourceType || enclosure?.mime_type || ""
  return /^audio\//i.test(mimeType) || /\.(aac|m4a|mp3|ogg|wav)(?:[?#]|$)/i.test(src || "")
}

const LazyPlyrPlayer = (props) => {
  const containerRef = useRef(null)
  const activatedRef = useRef(false)
  const [isActivated, setIsActivated] = useState(false)
  const isAudioPlayer = getIsAudioPlayer(props)
  const playerStyle = { ...props.style, margin: "0 auto" }
  const placeholderStyle = {
    ...playerStyle,
    width: "100%",
    // Match HTMLVideoElement's 300x150 intrinsic fallback until source metadata is available.
    ...(isAudioPlayer ? { minHeight: 54 } : { aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO }),
  }
  const placeholder = <div className="lazy-plyr-player-placeholder" style={placeholderStyle} />

  useEffect(() => {
    if (!containerRef.current || activatedRef.current) {
      return
    }

    const root = findNearestScrollableAncestor(containerRef.current)

    return observeNearViewport(
      containerRef.current,
      () => {
        if (activatedRef.current) {
          return
        }

        activatedRef.current = true
        setIsActivated(true)
      },
      { root },
    )
  }, [])

  return (
    <div
      ref={containerRef}
      className="lazy-plyr-player"
      style={isActivated ? { display: "contents" } : playerStyle}
    >
      {isActivated ? (
        <Suspense fallback={placeholder}>
          <PlyrPlayer {...props} />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  )
}

export default LazyPlyrPlayer
