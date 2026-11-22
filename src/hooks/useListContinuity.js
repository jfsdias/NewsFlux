import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  getContinuityResetRevision,
  readingContinuityState,
  saveReadingContinuity,
} from "@/store/readingContinuityState"
import { continuityFingerprint } from "@/utils/continuity-fingerprint"

export default function useListContinuity({
  account,
  snapshot,
  ready,
  entries,
  layout,
  columns,
  scrollRef,
  scrollRootRevision,
  virtualizerRef,
  suspendReadOnScroll,
  resumeReadOnScroll,
}) {
  const [saved, setCandidate] = useState(null)
  const storage = useStore(readingContinuityState)
  const generation = useRef(0)
  const canCapture = useRef(false)
  const interacted = useRef(false)
  const captureRevision = useRef(-1)
  const scopeRef = useRef(null)
  const accountRef = useRef(null)
  useEffect(() => {
    const current = ++generation.current
    canCapture.current = false
    interacted.current = false
    scopeRef.current = null
    accountRef.current = null
    resumeReadOnScroll()
    if (!account || !snapshot || !ready) {
      return
    }
    void Promise.all([continuityFingerprint(snapshot), continuityFingerprint(account)])
      .then(([scope, accountHash]) => {
        if (!scope || !accountHash || current !== generation.current) {
          return null
        }
        accountRef.current = accountHash
        scopeRef.current = scope
        const record = readingContinuityState
          .get()
          .records.find(
            (item) => item.account === accountHash && item.kind === "list" && item.scope === scope,
          )
        if (!interacted.current) {
          setCandidate(record ? { record, account, snapshot } : null)
        }
        return null
      })
      .catch(() => {})
    return () => {
      generation.current++
    }
  }, [account, snapshot, ready, resumeReadOnScroll])
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !account || !ready) {
      return
    }
    const enable = (event) => {
      if (!event.isTrusted || event.target?.closest?.("[data-continuity-resume]")) {
        return
      }
      interacted.current = true
      setCandidate(null)
      canCapture.current = true
      captureRevision.current = getContinuityResetRevision()
      resumeReadOnScroll()
    }
    const capture = () => {
      if (
        !canCapture.current ||
        captureRevision.current !== getContinuityResetRevision() ||
        !scopeRef.current ||
        !accountRef.current
      ) {
        return
      }
      const rect = node.getBoundingClientRect()
      const visible = [...node.querySelectorAll("[data-entry-id]")].find((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.bottom > rect.top && bounds.top < rect.bottom
      })
      const entryId = Number(visible?.dataset.entryId)
      if (!Number.isSafeInteger(entryId) || entryId <= 0) {
        return
      }
      const offset = Math.max(
        0,
        Math.min(10_000_000, rect.top - visible.getBoundingClientRect().top),
      )
      saveReadingContinuity({
        account: accountRef.current,
        kind: "list",
        scope: scopeRef.current,
        entryId,
        offset,
      })
    }
    node.addEventListener("pointerdown", enable, { passive: true })
    node.addEventListener("wheel", enable, { passive: true })
    node.addEventListener("touchstart", enable, { passive: true })
    node.addEventListener("keydown", enable)
    node.addEventListener("scroll", capture, { passive: true })
    return () => {
      node.removeEventListener("pointerdown", enable)
      node.removeEventListener("wheel", enable)
      node.removeEventListener("touchstart", enable)
      node.removeEventListener("keydown", enable)
      node.removeEventListener("scroll", capture)
    }
  }, [account, ready, resumeReadOnScroll, scrollRef, scrollRootRevision])
  const candidate =
    ready &&
    saved?.account === account &&
    saved?.snapshot === snapshot &&
    storage.records.some(
      (record) =>
        record.account === saved.record.account &&
        record.kind === "list" &&
        record.scope === saved.record.scope &&
        record.entryId === saved.record.entryId,
    )
      ? saved.record
      : null
  const index = candidate
    ? entries.findIndex((entry) => Number(entry.id) === candidate.entryId)
    : -1
  const resume = useCallback(() => {
    if (index < 0 || !candidate) {
      return
    }
    canCapture.current = false
    suspendReadOnScroll()
    const virtualIndex = layout === "card" ? Math.floor(index / columns) : index
    virtualizerRef.current?.scrollToIndex(virtualIndex, {
      align: "start",
      offset: candidate.offset,
    })
    setCandidate(null)
  }, [candidate, columns, index, layout, suspendReadOnScroll, virtualizerRef])
  return { canResume: index >= 0, resume }
}
