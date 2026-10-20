// Node's direct unit runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
import { WINDOW_CLASSES } from "./window-class.js"

export const COMPACT_NAV_DESTINATIONS = Object.freeze({
  HOME: "home",
  ALL: "all",
  TODAY: "today",
  STARRED: "starred",
  SOURCES: "sources",
})

/**
 * Resolves which compact bottom navigation item is active based on the current URL pathname.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
export const resolveCompactNavActiveKey = (pathname) => {
  if (!pathname || typeof pathname !== "string") {
    return null
  }
  const cleanPath = pathname.split(/[?#]/, 1)[0]
  if (cleanPath === "/" || cleanPath.startsWith("/entry/")) {
    return COMPACT_NAV_DESTINATIONS.HOME
  }
  if (cleanPath === "/all" || cleanPath.startsWith("/all/")) {
    return COMPACT_NAV_DESTINATIONS.ALL
  }
  if (cleanPath === "/today" || cleanPath.startsWith("/today/")) {
    return COMPACT_NAV_DESTINATIONS.TODAY
  }
  if (cleanPath === "/starred" || cleanPath.startsWith("/starred/")) {
    return COMPACT_NAV_DESTINATIONS.STARRED
  }
  if (cleanPath.startsWith("/feed/") || cleanPath.startsWith("/category/")) {
    return COMPACT_NAV_DESTINATIONS.SOURCES
  }
  return null
}

/**
 * Determines whether the compact navigation renderer should be visible.
 *
 * Contract:
 * - Only visible in COMPACT window class.
 * - Suppressed during reader viewing (activeContent is present) to preserve single-pane reading focus and avoid competing bars.
 * - Never visible in MEDIUM or DESKTOP.
 *
 * @param {{ windowClass: string, isReaderActive: boolean }} params
 * @returns {boolean}
 */
export const shouldRenderCompactNavigation = ({ windowClass, isReaderActive }) => {
  return windowClass === WINDOW_CLASSES.COMPACT && !isReaderActive
}
