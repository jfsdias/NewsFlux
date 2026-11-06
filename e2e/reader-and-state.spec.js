import {
  bodyTextLength,
  cards,
  center,
  elementAtCenter,
  horizontalOverflow,
} from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

const closeArticle = (page) => page.getByRole("button", { name: "Close article" })
const readToggle = (page) => page.getByRole("button", { name: /Mark as (un)?read/i }).first()

test.describe("F04 Opening and closing an article", () => {
  test("F04-1: [touch] a tapped card opens the reader and Close article is tappable", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", touch: true })
    await cards(page).first().tap()
    await expect(page).toHaveURL(/\/all\/entry\/\d+$/)
    await expect(closeArticle(page)).toBeVisible()

    const closeCenter = await center(closeArticle(page))
    await page.touchscreen.tap(closeCenter.x, closeCenter.y)
    await expect(page).toHaveURL(/\/all$/)
  })

  test("F04-2: [mouse] Close article closes the reader at 884 px", async ({ openApp }) => {
    const { page } = await openApp({ path: "/all" })
    await cards(page).first().click()
    await expect(page).toHaveURL(/\/all\/entry\/\d+$/)

    await closeArticle(page).click()

    await expect(page).toHaveURL(/\/all$/)
  })

  test("F04-3: [touch] a tap on the center of Close article closes the reader at 884 px", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", touch: true })
    await cards(page).first().tap()
    await expect(page).toHaveURL(/\/all\/entry\/\d+$/)
    const { x, y } = await center(closeArticle(page))
    const hitTarget = await elementAtCenter(closeArticle(page))
    const tapCenterAndVerifyClose = async () => {
      await page.touchscreen.tap(x, y)
      try {
        await expect(page).toHaveURL(/\/all$/, { timeout: 2000 })
        await expect(closeArticle(page)).toBeHidden()
      } catch (error) {
        const routeAfterTouch = new URL(page.url()).pathname
        const readerStillVisible = await closeArticle(page).isVisible()
        throw new Error(
          `QA-001 actual touch with hitTarget=${hitTarget} ended at ${routeAfterTouch}; readerStillVisible=${readerStillVisible}`,
          { cause: error },
        )
      }
    }

    expect(hitTarget).toBe("Close article")
    await tapCenterAndVerifyClose()
  })
})

test.describe("F05 Full content", () => {
  test("F05-1: the reader renders subtitle, quote, code block and caption", async ({ openApp }) => {
    const { page } = await openApp({ path: "/all/entry/9" })

    await expect(page.locator("blockquote")).toBeVisible()
    await expect(page.locator("pre")).toBeVisible()
    await expect(page.locator("figcaption")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
    expect(await bodyTextLength(page)).toBeGreaterThan(500)
  })
})

test.describe("F06 Read and unread", () => {
  test("F06-1: opening by click marks read on the server and Mark as unread reverts it", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await cards(page).nth(2).click()
    await expect.poll(() => mock.readIds()).toContain(3)
    await expect(readToggle(page)).toHaveAttribute("aria-label", /Mark as unread/i)

    await readToggle(page).click()

    await expect.poll(() => mock.readIds()).not.toContain(3)
  })

  test("F06-2: two quick toggles end in a state that matches the server", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all/entry/13" })
    await expect(readToggle(page)).toBeVisible()

    await readToggle(page).click()
    await readToggle(page).click()

    await expect
      .poll(async () => {
        const label = (await readToggle(page).getAttribute("aria-label")) ?? ""
        const shownAsRead = /Mark as unread/i.test(label)
        const readIds = await mock.readIds()
        return shownAsRead === readIds.includes(13)
      })
      .toBe(true)
  })

  test("F06-3: a direct link marks the displayed article as read", async ({ openApp, mock }) => {
    const { context, page } = await openApp({ path: "/all/entry/14" })
    await expect(page.getByText("Notícia 14").first()).toBeVisible()
    await expect
      .poll(() => mock.mutations())
      .toEqual([{ entryIds: [14], status: "read", outcome: "applied" }])
    await expect.poll(() => mock.readIds()).toContain(14)

    await readToggle(page).click()
    await expect.poll(() => mock.readIds()).not.toContain(14)
    await expect
      .poll(() => mock.mutations())
      .toEqual([
        { entryIds: [14], status: "read", outcome: "applied" },
        { entryIds: [14], status: "unread", outcome: "applied" },
      ])
    await page.waitForTimeout(250)
    expect(await mock.mutations()).toHaveLength(2)

    const storageState = await context.storageState()
    const reopened = await openApp({
      path: "/all/entry/14",
      authenticated: false,
      storageState,
    })
    await expect(reopened.page.getByText("Notícia 14").first()).toBeVisible()
    await expect.poll(() => mock.readIds()).toContain(14)
    await expect.poll(() => mock.mutations()).toHaveLength(3)

    await reopened.page.reload()
    await expect(reopened.page.getByText("Notícia 14").first()).toBeVisible()
    await page.waitForTimeout(250)
    expect(await mock.mutations()).toHaveLength(3)

    const manual = await openApp({
      path: "/all/entry/15",
      settings: { markReadBy: "manually" },
    })
    await expect(manual.page.getByText("Notícia 15").first()).toBeVisible()
    await expect
      .poll(() =>
        manual.page.evaluate(() => JSON.parse(localStorage.getItem("settings")).markReadBy),
      )
      .toBe("manually")
    await manual.page.waitForTimeout(250)
    expect(await mock.readIds()).not.toContain(15)
    const manualMutations = await mock.mutations()
    expect(manualMutations.some(({ entryIds }) => entryIds.includes(15))).toBe(false)

    const missing = await openApp({ path: "/all/entry/999999" })
    await expect(missing.page).toHaveURL(/\/all$/)
    await expect(missing.page.getByText("Notícia 999999")).toBeHidden()
    const missingMutations = await mock.mutations()
    expect(missingMutations.some(({ entryIds }) => entryIds.includes(999_999))).toBe(false)

    await mock.fault("entry", "500")
    const failed = await openApp({ path: "/all/entry/16" })
    await expect(failed.page.getByRole("alert")).toContainText(
      "The server could not load this article. Please try again.",
    )
    const failedMutations = await mock.mutations()
    expect(failedMutations.some(({ entryIds }) => entryIds.includes(16))).toBe(false)

    await mock.fault("entry", "emptyobject")
    const malformed = await openApp({ path: "/all/entry/17" })
    await expect(malformed.page.getByRole("alert")).toContainText(
      "The server returned an unexpected response.",
    )
    await expect(malformed.page.getByRole("button", { name: "Retry" })).toBeVisible()
    const malformedMutations = await mock.mutations()
    expect(malformedMutations.some(({ entryIds }) => entryIds.includes(17))).toBe(false)
    await mock.fault("entry", "ok")

    const routeRace = await openApp({ path: "/all" })
    await expect(cards(routeRace.page).first()).toBeVisible()
    let releaseStaleEntry
    let resolveStaleRequest
    const staleRequestReached = new Promise((resolve) => {
      resolveStaleRequest = resolve
    })
    const staleRequestRelease = new Promise((resolve) => {
      releaseStaleEntry = resolve
    })
    await routeRace.context.route(`${mock.url}/v1/entries/149`, async (route) => {
      resolveStaleRequest()
      await staleRequestRelease
      await route.continue()
    })
    await routeRace.page.evaluate(() => {
      history.pushState(null, "", "/all/entry/149")
      dispatchEvent(new PopStateEvent("popstate"))
    })
    await staleRequestReached
    await routeRace.page.evaluate(() => {
      history.pushState(null, "", "/all/entry/148")
      dispatchEvent(new PopStateEvent("popstate"))
    })
    await expect(routeRace.page.getByText("Notícia 148").first()).toBeVisible()
    await expect.poll(() => mock.readIds()).toContain(148)
    releaseStaleEntry()
    await routeRace.page.waitForTimeout(250)
    const routeMutations = await mock.mutations()
    expect(routeMutations.filter(({ entryIds }) => entryIds.includes(149))).toEqual([])

    const sessionRace = await openApp({ path: "/all" })
    await expect(cards(sessionRace.page).first()).toBeVisible()
    let releaseSessionEntry
    let resolveSessionRequest
    const sessionRequestReached = new Promise((resolve) => {
      resolveSessionRequest = resolve
    })
    const sessionRequestRelease = new Promise((resolve) => {
      releaseSessionEntry = resolve
    })
    await sessionRace.context.route(`${mock.url}/v1/entries/147`, async (route) => {
      resolveSessionRequest()
      await sessionRequestRelease
      await route.continue()
    })
    await sessionRace.page.evaluate(() => {
      history.pushState(null, "", "/all/entry/147")
      dispatchEvent(new PopStateEvent("popstate"))
    })
    await sessionRequestReached
    await sessionRace.page.evaluate(() => {
      history.pushState(null, "", "/all")
      dispatchEvent(new PopStateEvent("popstate"))
    })
    await expect(cards(sessionRace.page).first()).toBeVisible()
    await mock.fault("entries", "401")
    await sessionRace.page.getByRole("button", { name: "Refresh" }).first().click()
    await expect(sessionRace.page).toHaveURL(/\/login$/)
    releaseSessionEntry()
    await sessionRace.page.waitForTimeout(250)
    const sessionMutations = await mock.mutations()
    expect(sessionMutations.filter(({ entryIds }) => entryIds.includes(147))).toEqual([])

    await mock.fault("entries", "ok")
    await mock.fault("status-mutation", "500")
    const mutationFailure = await openApp({ path: "/all/entry/21" })
    await expect(mutationFailure.page.getByText("Notícia 21").first()).toBeVisible()
    await expect.poll(() => mock.requests()).toContain("PUT /v1/entries")
    await expect
      .poll(() => mock.mutations())
      .toContainEqual({
        entryIds: [21],
        status: "read",
        outcome: "rejected",
      })
    await expect.poll(() => mock.readIds()).not.toContain(21)
    await expect(readToggle(mutationFailure.page)).toHaveAttribute("aria-label", /Mark as read/i)
    expect(mutationFailure.errors).toEqual([])
    expect(await mock.mutations()).toEqual([
      { entryIds: [14], status: "read", outcome: "applied" },
      { entryIds: [14], status: "unread", outcome: "applied" },
      { entryIds: [14], status: "read", outcome: "applied" },
      { entryIds: [148], status: "read", outcome: "applied" },
      { entryIds: [21], status: "read", outcome: "rejected" },
    ])
    await mock.fault("status-mutation", "ok")
  })
})

test.describe("F09 Images and fallbacks", () => {
  test("F09-1: a broken image does not break the reader or overflow the page", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all/entry/23" })

    await expect(page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
    expect(await horizontalOverflow(page)).toBe(false)
    expect(await bodyTextLength(page)).toBeGreaterThan(300)
  })
})

test.describe("F11 Navigation and history", () => {
  test("F11-1: browser back and forward and the j/k keys move through articles", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await cards(page).first().click()
    await expect(page).toHaveURL(/\/all\/entry\/1$/)

    await page.goBack()
    await expect(page).toHaveURL(/\/all$/)
    await page.goForward()
    await expect(page).toHaveURL(/\/all\/entry\/1$/)
    await page.keyboard.press("j")
    await expect(page).toHaveURL(/\/all\/entry\/2$/)
    await page.keyboard.press("k")
    await expect(page).toHaveURL(/\/all\/entry\/1$/)
  })
})
