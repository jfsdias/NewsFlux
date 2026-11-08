const supportedThemes = new Set(["light", "dark"])

const applyHarnessTheme = (theme, documentObject) => {
  if (!supportedThemes.has(theme)) {
    throw new TypeError(`Unsupported harness theme: ${theme}`)
  }

  if (!documentObject?.body || !documentObject?.documentElement || !documentObject?.defaultView) {
    throw new TypeError("A browser document is required to apply the harness theme")
  }

  const { body } = documentObject
  body.setAttribute("arco-theme", theme)
  body.style.colorScheme = theme

  const canvas = documentObject.defaultView
    .getComputedStyle(body)
    .getPropertyValue("--nf-canvas")
    .trim()

  if (!canvas) {
    throw new Error(`The ${theme} harness theme did not resolve --nf-canvas`)
  }

  documentObject.documentElement.style.setProperty("--app-shell-background", canvas)
  return canvas
}

export default applyHarnessTheme
