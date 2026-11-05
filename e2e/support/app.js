/** Small page helpers shared by the scenarios. */

export const cards = (page) => page.locator("a.article-entry")

export const entryIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a.article-entry")].map((link) => Number(link.dataset.entryId)),
  )

export const bodyText = async (page) => {
  // Rendered (visible) text is intended here, which textContent does not provide.
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content
  const text = await page.evaluate(() => document.body.innerText)
  return text.replaceAll(/\s+/g, " ").trim()
}

export const bodyTextLength = async (page) => {
  const text = await bodyText(page)
  return text.length
}

/** The element that actually receives a pointer at the center of `locator`. */
export const elementAtCenter = (locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return target?.closest("button")?.getAttribute("aria-label") ?? target?.tagName ?? null
  })

/** Captures structured DOM hit-test evidence for the actual center of a target element. */
export const inspectPointerAtCenter = (locator, inputMode = "touch") =>
  locator.evaluate((closeElement, mode) => {
    const closeButton = closeElement.closest("button") ?? closeElement
    const rect = closeElement.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const target = document.elementFromPoint(center.x, center.y)
    const stack = document.elementsFromPoint(center.x, center.y)

    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby")
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "")
          .join(" ")
          .trim()
        if (text) {
          return text
        }
      }
      return (
        element.getAttribute("aria-label") ??
        element.textContent?.replaceAll(/\s+/g, " ").trim() ??
        ""
      )
    }

    const describe = (element, isCloseArticle = false) => ({
      tagName: element.tagName,
      role:
        element.getAttribute("role") ??
        { BUTTON: "button", A: "link", INPUT: "textbox" }[element.tagName] ??
        "",
      accessibleName: accessibleName(element),
      isCloseArticle,
      rect: (() => {
        const bounds = element.getBoundingClientRect()
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      })(),
    })

    const nearestButton = target?.closest("button") ?? null

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      inputMode: mode,
      closeButton: {
        accessibleName: accessibleName(closeButton),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      },
      center,
      hitTarget: target ? describe(target) : null,
      hitTargetIsCloseArticle: (target?.closest("button") ?? target) === closeButton,
      nearestInterceptingButton: nearestButton ? describe(nearestButton) : null,
      elementsAtCenter: stack.map((element) =>
        describe(element, element === closeButton || element.closest("button") === closeButton),
      ),
    }
  }, inputMode)

export const center = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export const entriesRequests = async (mock) => {
  const hits = await mock.requests()
  return hits.filter((hit) => hit.startsWith("GET /v1/entries?")).length
}

export const horizontalOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)

export const FAILURE_FEEDBACK = /(error|fail|retry|try again|unavailable|could not|unable|wrong)/i
