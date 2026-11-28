import { useStore } from "@nanostores/react"
import { useEffect } from "react"

import { learnFromReadingState, recordReadingSignal } from "@/store/readingSignalsState"

// An impression is a card at least half visible for one second (NF-E08). One shared observer;
// nothing is observed while learning is off.
const VISIBLE_RATIO = 0.5
const VISIBLE_MS = 1000
const tracked = new Map()
let observer = null

const untrack = (element) => {
  const item = tracked.get(element)
  if (item) {
    globalThis.clearTimeout(item.timer)
    tracked.delete(element)
  }
  observer?.unobserve(element)
}

const getObserver = () => {
  observer ??= new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const item = tracked.get(record.target)
        if (!item) {
          continue
        }
        if (record.isIntersecting && record.intersectionRatio >= VISIBLE_RATIO) {
          item.timer ??= globalThis.setTimeout(() => {
            void recordReadingSignal("impressions", item.entry)
            untrack(record.target)
          }, VISIBLE_MS)
        } else {
          globalThis.clearTimeout(item.timer)
          item.timer = null
        }
      }
    },
    { threshold: [0, VISIBLE_RATIO] },
  )
  return observer
}

const useReadingSignalImpression = (elementRef, entry) => {
  const enabled = useStore(learnFromReadingState)
  const entryId = entry?.id
  const feedId = entry?.feed?.id ?? entry?.feed_id

  useEffect(() => {
    const element = elementRef.current
    if (!enabled || !element || typeof IntersectionObserver === "undefined") {
      return
    }
    tracked.set(element, { entry: { id: entryId, feed: { id: feedId } }, timer: null })
    getObserver().observe(element)
    return () => untrack(element)
  }, [elementRef, enabled, entryId, feedId])
}

export default useReadingSignalImpression
