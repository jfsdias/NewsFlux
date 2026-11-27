import { entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

/*
 * NF-0301 Smart View shortcuts/polish — synthetic E2E contract
 *
 * Covers the explicit active-view banner, the absence of global preference side effects, the
 * one-interaction navigation shortcuts and the absence of list jumps after mark-read. Every
 * scenario asserts the exact article mutations the mock recorded.
 */

const QUERY = "Notícia 4"
const DESKTOP = { width: 1440, height: 900 }
const ENTRY_PATH = /\/v1\/(?:entries|feeds\/\d+\/entries|categories\/\d+\/entries)$/

const openSearch = async (page) => {
  await page
    .getByRole("button", { name: /^Search(?::|$)/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  return page.getByLabel("Search article titles and content")
}

const saveView = async (page, { name = "", query = QUERY } = {}) => {
  const input = await openSearch(page)
  // The dialog moves focus to the search field when it finishes opening; wait for that first.
  await expect(input).toBeFocused()
  await input.fill(query)
  if (name) {
    await page.getByLabel("View name").fill(name)
  }
  await page.getByRole("button", { name: "Save this search" }).click()
  await expect(page.getByText("View saved on this browser.")).toBeVisible()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
}

const entryRequest = (page, predicate) =>
  page.waitForRequest((request) => {
    const url = new URL(request.url())
    return ENTRY_PATH.test(url.pathname) && predicate(url.searchParams, url.pathname)
  })

const storedSettings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("settings")))

const statusFilter = (page) => page.getByRole("radiogroup", { name: "Filter articles by status" })

const chooseStatus = (page, name) =>
  statusFilter(page)
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click()

const savedViewsNav = (page) =>
  page.getByRole("navigation").getByRole("region", { name: "Saved views" })

test.describe("NF-0301 Smart View polish", () => {
  test("NF-0301-1: an active view states its name and predicates and can be left", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/feed/1",
      ...DESKTOP,
      settings: { showStatus: "unread", orderDirection: "desc" },
    })
    await expect(page.locator("a.article-entry").first()).toBeVisible()

    // No name typed: a readable default is proposed from the predicates.
    await saveView(page)
    const name = "Unread · Alfa Tech · “Notícia 4”"
    await expect(page.getByRole("region", { name: "Active Smart View", exact: false })).toHaveCount(
      0,
    )

    const opened = entryRequest(page, (query) => query.get("search") === QUERY)
    await savedViewsNav(page).getByRole("button", { name }).click()
    await opened

    const banner = page.getByRole("region", { name: `Active Smart View: ${name}` })
    await expect(banner).toBeVisible()
    await expect(banner.getByRole("status")).toHaveText(`Smart View ${name} is active.`)
    await expect(banner.getByRole("listitem")).toHaveText([
      "Alfa Tech",
      "Unread",
      "“Notícia 4”",
      "Newest first · added",
    ])

    // One clear action returns to the underlying scope without the view's query.
    const left = entryRequest(
      page,
      (query, pathname) => pathname === "/v1/feeds/1/entries" && !query.has("search"),
    )
    await banner.getByRole("button", { name: "Leave view" }).click()
    await left
    await expect(banner).toHaveCount(0)
    await expect(page).toHaveURL(/\/feed\/1$/)
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-0301-2: opening and leaving a view never rewrites the user's preferences", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/feed/1",
      ...DESKTOP,
      settings: { showStatus: "unread", orderDirection: "asc" },
    })
    await expect(page.locator("a.article-entry").first()).toBeVisible()
    await saveView(page, { name: "Oldest unread" })

    // The user's own preferences now differ from the saved view.
    await chooseStatus(page, "All")
    await page.getByRole("button", { name: "Oldest first", exact: true }).click()
    await expect
      .poll(() => storedSettings(page))
      .toMatchObject({ showStatus: "all", orderDirection: "desc" })

    const opened = entryRequest(
      page,
      (query) =>
        query.get("search") === QUERY &&
        query.get("status") === "unread" &&
        query.get("direction") === "asc",
    )
    await savedViewsNav(page).getByRole("button", { name: "Oldest unread" }).click()
    await opened
    const banner = page.getByRole("region", { name: "Active Smart View: Oldest unread" })
    await expect(banner).toBeVisible()
    // What storage holds (and a reload would read) is still the user's own choice.
    expect(await storedSettings(page)).toMatchObject({ showStatus: "all", orderDirection: "desc" })

    const restored = entryRequest(
      page,
      (query) => !query.has("search") && !query.has("status") && query.get("direction") === "desc",
    )
    await banner.getByRole("button", { name: "Leave view" }).click()
    await restored
    await expect(banner).toHaveCount(0)
    expect(await storedSettings(page)).toMatchObject({ showStatus: "all", orderDirection: "desc" })
    await expect(statusFilter(page).getByRole("radio", { name: "All" })).toBeChecked()

    // An explicit change made inside the view is the user's own and is kept.
    await savedViewsNav(page).getByRole("button", { name: "Oldest unread" }).click()
    await expect(banner).toBeVisible()
    await chooseStatus(page, "Starred")
    await expect(banner).toHaveCount(0)
    await expect.poll(() => storedSettings(page)).toMatchObject({ showStatus: "starred" })
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-0301-3: saved views open in one interaction from the sidebar and the compact drawer", async ({
    openApp,
    mock,
  }) => {
    const desktop = await openApp({
      path: "/feed/1",
      ...DESKTOP,
      settings: { showStatus: "unread" },
    })
    await expect(desktop.page.locator("a.article-entry").first()).toBeVisible()
    await saveView(desktop.page, { name: "Keyboard view" })

    // Keyboard: the shortcut is a focusable button that Enter activates.
    const shortcut = savedViewsNav(desktop.page).getByRole("button", { name: "Keyboard view" })
    await shortcut.focus()
    const opened = entryRequest(desktop.page, (query) => query.get("search") === QUERY)
    await desktop.page.keyboard.press("Enter")
    await opened
    await expect(
      desktop.page.getByRole("region", { name: "Active Smart View: Keyboard view" }),
    ).toBeVisible()
    await expect(shortcut).toHaveAttribute("aria-current", "true")

    // Compact navigation: Feeds opens the drawer, one tap on the view opens it and closes the drawer.
    const compact = await openApp({
      path: "/feed/1",
      width: 390,
      height: 844,
      touch: true,
      settings: { showStatus: "unread" },
    })
    const { page } = compact
    await expect(page.locator("a.article-entry").first()).toBeVisible()
    await saveView(page, { name: "Compact view" })
    await page.getByTestId("compact-nav-sources").click()
    const drawerRequest = entryRequest(page, (query) => query.get("search") === QUERY)
    await savedViewsNav(page).getByRole("button", { name: "Compact view" }).tap()
    await drawerRequest
    await expect(
      page.getByRole("region", { name: "Active Smart View: Compact view" }),
    ).toBeVisible()
    await expect(page.locator("#mobile-sidebar-drawer")).toBeHidden()
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-0301-4: marking read inside an unread view never moves the list or sends extra writes", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      ...DESKTOP,
      settings: {
        articleListLayout: "card",
        markReadBy: "manually",
        markReadOnScroll: true,
        showStatus: "unread",
      },
    })
    await expect(page.locator("a.article-entry").first()).toBeVisible()
    await saveView(page, { name: "Unread news", query: "Notícia" })
    await savedViewsNav(page).getByRole("button", { name: "Unread news" }).click()
    await expect(page.getByRole("region", { name: "Active Smart View: Unread news" })).toBeVisible()
    await expect(page.locator("a.article-entry").first()).toBeVisible()

    const list = page.locator(
      ".entry-list.adaptive-scroll-area-native, .entry-list .simplebar-content-wrapper",
    )
    const snapshot = async () => ({
      ids: await entryIds(page),
      scrollTop: await list.evaluate((node) => node.scrollTop),
    })

    // Explicit mark-as-read: the entry stays where it is and exactly that write is sent.
    const before = await snapshot()
    await page.getByRole("button", { name: "Card actions" }).first().click()
    await page.getByRole("menuitem", { name: /Mark as read/i }).click()
    await expect.poll(() => mock.readIds()).toContain(before.ids[0])
    await page.waitForTimeout(400)
    const afterExplicit = await snapshot()
    expect(afterExplicit).toEqual(before)
    expect(await mock.mutations()).toEqual([
      { entryIds: [before.ids[0]], status: "read", outcome: "applied" },
    ])

    // Read-on-scroll: entries scrolled past are marked, but nothing is removed or re-positioned.
    await list.hover()
    await page.mouse.wheel(0, 900)
    await expect
      .poll(async () => {
        const recorded = await mock.mutations()
        return recorded.length
      })
      .toBeGreaterThan(1)
    await page.waitForTimeout(600)
    const settled = await snapshot()
    await page.waitForTimeout(600)
    expect(await snapshot()).toEqual(settled)
    expect(settled.scrollTop).toBeGreaterThan(0)
    // Marked entries stay in the list: the rendered window has no gaps.
    expect(settled.ids.every((id, index) => index === 0 || id === settled.ids[index - 1] + 1)).toBe(
      true,
    )
    const mutations = await mock.mutations()
    expect(mutations.every(({ status }) => status === "read")).toBe(true)
    const firstVisible = await page.evaluate(() => {
      const root = document.querySelector(".entry-list")
      const { top } = root.getBoundingClientRect()
      const link = [...document.querySelectorAll("a.article-entry")].find(
        (element) => element.getBoundingClientRect().bottom > top,
      )
      return Number(link.dataset.entryId)
    })
    for (const { entryIds: ids } of mutations) {
      for (const id of ids) {
        expect(id).toBeLessThanOrEqual(firstVisible)
      }
    }
  })
})
