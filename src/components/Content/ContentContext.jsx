import { Message } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { createContext, useCallback, useMemo, useRef } from "react"
import { useLocation, useNavigate } from "react-router"

import { updateEntriesStatusOptimistically } from "@/hooks/useEntryActions"
import { polyglotState } from "@/hooks/useLanguage"
import { contentState, setActiveContent } from "@/store/contentState"
import { settingsState } from "@/store/settingsState"
import handleUnavailableEntry from "@/utils/unavailable-entry"
import { buildEntryDetailPath, extractBasePath, isEntryDetailPath } from "@/utils/url"

const Context = createContext()

const scheduleAfterNextPaint = (callback) => {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => globalThis.setTimeout(callback, 0))
  } else {
    globalThis.setTimeout(callback, 0)
  }
}

export const ContextProvider = ({ children }) => {
  const { polyglot } = useStore(polyglotState)
  const { markReadBy } = useStore(settingsState, { keys: ["markReadBy"] })

  const entryDetailRef = useRef(null)
  const entryListRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  const restoreEntryListFocus = useCallback((entryId) => {
    scheduleAfterNextPaint(() => {
      const entryList = entryListRef.current
      const numericEntryId = Number(entryId)
      const entryElement = Number.isFinite(numericEntryId)
        ? [...(entryList?.el?.querySelectorAll("[data-entry-id]") ?? [])].find(
            (element) => Number(element.dataset.entryId) === numericEntryId,
          )
        : null
      const focusTarget = entryElement ?? entryList?.contentWrapperEl
      focusTarget?.focus({ preventScroll: true })
    })
  }, [])

  const closeActiveContent = useCallback(() => {
    const activeEntryId = contentState.get().activeContent?.id
    setActiveContent(null)

    const currentPath = location.pathname
    const basePath = extractBasePath(currentPath)

    if (isEntryDetailPath(currentPath)) {
      navigate(basePath)
    }
    restoreEntryListFocus(activeEntryId)
  }, [location.pathname, navigate, restoreEntryListFocus])

  const handleEntryUnavailable = useCallback(
    (error, isCurrentRequest) =>
      handleUnavailableEntry({
        pathname: location.pathname,
        error,
        isCurrentRequest,
        clearActiveContent: () => setActiveContent(null),
        navigate,
        notify: () => Message.warning(polyglot.t("content.entry_unavailable")),
      }),
    [location.pathname, navigate, polyglot],
  )

  const handleEntryClick = useCallback(
    (entry, { basePath: requestedBasePath } = {}) => {
      const shouldAutoMarkAsRead = markReadBy === "view"
      const updatedEntry = shouldAutoMarkAsRead ? { ...entry, status: "read" } : { ...entry }

      if (shouldAutoMarkAsRead && entry.status === "unread") {
        void updateEntriesStatusOptimistically([entry], "read", () => {
          Message.error(polyglot.t("content.mark_as_read_error"))
        })
      }
      setActiveContent(updatedEntry)

      const currentPath = location.pathname
      const basePath = requestedBasePath ?? extractBasePath(currentPath)
      const entryDetailPath = buildEntryDetailPath(basePath, entry.id)

      navigate(entryDetailPath)

      scheduleAfterNextPaint(() => {
        const articleContent = entryDetailRef.current
        if (articleContent) {
          const contentWrapper = articleContent.querySelector(
            ".simplebar-content-wrapper, .scroll-container",
          )
          contentWrapper?.scroll({ top: 0 })
          articleContent.focus()
        }
      })
    },
    [polyglot, markReadBy, location.pathname, navigate],
  )

  const value = useMemo(
    () => ({
      entryDetailRef,
      entryListRef,
      handleEntryClick,
      handleEntryUnavailable,
      restoreEntryListFocus,
      setActiveContent,
      closeActiveContent,
    }),
    [handleEntryClick, handleEntryUnavailable, restoreEntryListFocus, closeActiveContent],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const ContentContext = Context
