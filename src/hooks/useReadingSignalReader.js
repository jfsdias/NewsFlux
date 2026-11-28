import { useStore } from "@nanostores/react"
import { useEffect } from "react"

import { learnFromReadingState, recordReadingSignal } from "@/store/readingSignalsState"
import { getReadToEndDwellMs, isReadToEnd } from "@/utils/reading-signals"

// Counts an open when the Reader shows an entry, and "read to end" once most of the body was
// scrolled with a dwell scaled to the entry's reading time (NF-E08). Nothing runs while off.
const useReadingSignalReader = ({ entry, scrollRef, pending }) => {
  const enabled = useStore(learnFromReadingState)
  const entryId = entry?.id
  const feedId = entry?.feed?.id ?? entry?.feed_id
  const readingTime = entry?.reading_time

  useEffect(() => {
    if (!enabled || !entryId || pending) {
      return
    }
    const signalEntry = { id: entryId, feed: { id: feedId } }
    void recordReadingSignal("opens", signalEntry)
    const openedAt = Date.now()
    const node = scrollRef.current?.getScrollElement?.()
    let counted = false
    const check = () => {
      if (counted || !node) {
        return
      }
      const progress =
        node.scrollHeight > 0
          ? Math.min(1, (node.scrollTop + node.clientHeight) / node.scrollHeight)
          : 1
      if (
        isReadToEnd({ progress, dwellMs: Date.now() - openedAt, readingTimeMinutes: readingTime })
      ) {
        counted = true
        void recordReadingSignal("read_to_end", signalEntry)
      }
    }
    node?.addEventListener("scroll", check, { passive: true })
    const timer = globalThis.setTimeout(check, getReadToEndDwellMs(readingTime) + 50)
    return () => {
      node?.removeEventListener("scroll", check)
      globalThis.clearTimeout(timer)
    }
  }, [enabled, entryId, feedId, pending, readingTime, scrollRef])
}

export default useReadingSignalReader
