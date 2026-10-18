import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import useContentContext from "@/hooks/useContentContext"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import {
  createArticleSelectionScopeKey,
  getEligibleArticleSelectionIds,
  isArticleSelectionAvailable,
  reconcileArticleSelection,
  toggleArticleSelection,
} from "@/utils/article-selection"
import shouldExitArticleSelectionOnEscape from "@/utils/article-selection-escape"

const EMPTY_SELECTION = new Set()

const focusWithoutScroll = (element) => element?.focus?.({ preventScroll: true })

const scheduleFocus = (callback) => {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(callback)
  } else {
    globalThis.setTimeout(callback, 0)
  }
}

const getSelectionCheckboxes = (entryListRef) => [
  ...(entryListRef.current?.el?.querySelectorAll?.("input[data-bulk-entry-checkbox]") ?? []),
]

const focusFirstSelectionControl = (entryListRef) => {
  const firstEligibleCheckbox = getSelectionCheckboxes(entryListRef).find(
    (checkbox) => !checkbox.disabled,
  )
  if (firstEligibleCheckbox) {
    focusWithoutScroll(firstEligibleCheckbox)
    return
  }

  focusWithoutScroll(
    globalThis.document?.querySelector("[data-selection-fallback], [data-selection-primary]"),
  )
}

const useArticleSelection = ({ from, id, homeMode = false }) => {
  const { entries, filterDate, filterString } = useStore(contentState, {
    keys: ["entries", "filterDate", "filterString"],
  })
  const { showHiddenFeeds, showStatus, removeDuplicates } = useStore(settingsState, {
    keys: ["showHiddenFeeds", "showStatus", "removeDuplicates"],
  })
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const { entryListRef } = useContentContext()
  const selectionTriggerRef = useRef(null)
  const selectionLockedRef = useRef(false)
  const lastFocusedCheckboxRef = useRef(null)
  const scopeInput = useMemo(
    () => ({
      from: homeMode ? "home" : from,
      id,
      showStatus,
      filterString,
      filterDate,
      showHiddenFeeds,
      removeDuplicates,
      sessionRevision,
    }),
    [
      filterDate,
      filterString,
      from,
      homeMode,
      id,
      removeDuplicates,
      sessionRevision,
      showHiddenFeeds,
      showStatus,
    ],
  )
  const scopeInputRef = useRef(scopeInput)

  const scopeKey = createArticleSelectionScopeKey(scopeInput)
  const isAvailable = isArticleSelectionAvailable({ from, homeMode })
  const eligibleIds = useMemo(() => getEligibleArticleSelectionIds(entries), [entries])
  const [selection, setSelection] = useState(() => ({
    scopeKey,
    mode: false,
    selectedIds: EMPTY_SELECTION,
  }))
  const isSelectionMode = isAvailable && selection.scopeKey === scopeKey && selection.mode
  const selectedIds = isSelectionMode ? selection.selectedIds : EMPTY_SELECTION

  const getCurrentScopeKey = useCallback(
    () => createArticleSelectionScopeKey(scopeInputRef.current),
    [],
  )

  const focusSelectTrigger = useCallback(() => {
    scheduleFocus(() => {
      const trigger = selectionTriggerRef.current
      if (trigger?.isConnected && !trigger.disabled) {
        focusWithoutScroll(trigger)
      }
    })
  }, [])

  useLayoutEffect(() => {
    scopeInputRef.current = scopeInput
  }, [scopeInput])

  useLayoutEffect(() => {
    // Scope changes come from external stores; clear before paint so stale IDs cannot flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection((current) =>
      current.scopeKey === scopeKey
        ? current
        : { scopeKey, mode: false, selectedIds: EMPTY_SELECTION },
    )
    lastFocusedCheckboxRef.current = null
  }, [scopeKey])

  useLayoutEffect(() => {
    if (!isSelectionMode) {
      return
    }

    // Reconcile provider snapshots before exposing updated entries to the next interaction.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection((current) => {
      if (current.scopeKey !== scopeKey || !current.mode) {
        return current
      }
      const reconciledIds = reconcileArticleSelection(current.selectedIds, entries)
      if (
        reconciledIds.size === current.selectedIds.size &&
        [...reconciledIds].every((entryId) => current.selectedIds.has(entryId))
      ) {
        return current
      }
      return { ...current, selectedIds: reconciledIds }
    })

    const focusedCheckbox = lastFocusedCheckboxRef.current
    if (focusedCheckbox?.scopeKey === scopeKey && !eligibleIds.has(focusedCheckbox.entryId)) {
      lastFocusedCheckboxRef.current = null
      if (!contentState.get().activeContent) {
        scheduleFocus(() => focusFirstSelectionControl(entryListRef))
      }
    }
  }, [eligibleIds, entries, entryListRef, isSelectionMode, scopeKey])

  const enterSelectionMode = useCallback(() => {
    if (!isArticleSelectionAvailable(scopeInputRef.current) || selectionLockedRef.current) {
      return
    }
    const nextScopeKey = getCurrentScopeKey()
    setSelection({ scopeKey: nextScopeKey, mode: true, selectedIds: new Set() })
    scheduleFocus(() => focusFirstSelectionControl(entryListRef))
  }, [entryListRef, getCurrentScopeKey])

  const exitSelectionMode = useCallback(
    ({ restoreFocus = true } = {}) => {
      const currentScopeKey = getCurrentScopeKey()
      setSelection({ scopeKey: currentScopeKey, mode: false, selectedIds: EMPTY_SELECTION })
      lastFocusedCheckboxRef.current = null
      if (restoreFocus) {
        focusSelectTrigger()
      }
    },
    [focusSelectTrigger, getCurrentScopeKey],
  )

  useEffect(() => {
    if (!isSelectionMode || !globalThis.document) {
      return
    }

    const handleEscape = (event) => {
      if (
        !shouldExitArticleSelectionOnEscape(event, {
          activeContent: contentState.get().activeContent,
        })
      ) {
        return
      }
      event.preventDefault()
      exitSelectionMode()
    }

    document.addEventListener("keydown", handleEscape, true)
    return () => document.removeEventListener("keydown", handleEscape, true)
  }, [exitSelectionMode, isSelectionMode])

  const toggleEntry = useCallback(
    (entryId) => {
      if (selectionLockedRef.current) {
        return
      }
      const currentScopeKey = getCurrentScopeKey()
      const currentEntries = contentState.get().entries
      const currentEligibleIds = getEligibleArticleSelectionIds(currentEntries)
      setSelection((current) => {
        if (current.scopeKey !== currentScopeKey || !current.mode) {
          return current
        }
        return {
          ...current,
          selectedIds: toggleArticleSelection(current.selectedIds, entryId, currentEligibleIds),
        }
      })
    },
    [getCurrentScopeKey],
  )

  const removeAcknowledgedIds = useCallback(
    (entryIds, expectedScopeKey) => {
      if (getCurrentScopeKey() !== expectedScopeKey) {
        return
      }
      const removedIds = new Set(entryIds)
      setSelection((current) => {
        if (current.scopeKey !== expectedScopeKey || !current.mode) {
          return current
        }
        const selected = new Set(current.selectedIds)
        for (const entryId of removedIds) {
          selected.delete(entryId)
        }
        return selected.size === current.selectedIds.size
          ? current
          : { ...current, selectedIds: selected }
      })
    },
    [getCurrentScopeKey],
  )

  const setSelectionLocked = useCallback((locked) => {
    selectionLockedRef.current = locked
  }, [])

  const noteCheckboxFocus = useCallback(
    (entryId) => {
      lastFocusedCheckboxRef.current = { entryId, scopeKey: getCurrentScopeKey() }
    },
    [getCurrentScopeKey],
  )

  return useMemo(
    () => ({
      enterSelectionMode,
      exitSelectionMode,
      getCurrentScopeKey,
      isAvailable,
      isSelectionMode,
      noteCheckboxFocus,
      removeAcknowledgedIds,
      scopeKey,
      selectedCount: selectedIds.size,
      selectedIds,
      selectionLockedRef,
      selectionTriggerRef,
      setSelectionLocked,
      toggleEntry,
    }),
    [
      enterSelectionMode,
      exitSelectionMode,
      getCurrentScopeKey,
      isAvailable,
      isSelectionMode,
      noteCheckboxFocus,
      removeAcknowledgedIds,
      scopeKey,
      selectedIds,
      setSelectionLocked,
      toggleEntry,
    ],
  )
}

export default useArticleSelection
