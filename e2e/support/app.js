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

/** How many of five points inside `locator` hit the element (or its descendants). */
export const hitPoints = (locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const fractions = [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ]
    let hits = 0
    for (const [x, y] of fractions) {
      const target = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)
      if (target && (target === element || element.contains(target))) {
        hits += 1
      }
    }
    return hits
  })

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
