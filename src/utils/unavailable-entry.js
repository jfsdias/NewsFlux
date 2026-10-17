// eslint-disable-next-line import/extensions -- Node's native ESM test runner requires explicit extensions.
import { extractBasePath, isEntryDetailPath } from "./url.js"

const handleUnavailableEntry = ({
  pathname,
  error,
  isCurrentRequest,
  clearActiveContent,
  navigate,
  notify,
}) => {
  if (!isCurrentRequest() || error?.status !== 404 || !isEntryDetailPath(pathname)) {
    return false
  }

  clearActiveContent()
  navigate(extractBasePath(pathname), { replace: true })
  notify()
  return true
}

export default handleUnavailableEntry
