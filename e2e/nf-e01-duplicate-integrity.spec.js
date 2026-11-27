import { cards, entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

/**
 * NF-E01 residual validation (closes the open items of PR #295 / #299).
 *
 * Invariant under test: duplicate presentation is a view-only projection. Showing, collapsing,
 * expanding or navigating duplicate groups must never send a read/unread change to Miniflux; only
 * explicit user actions may, and they act on exactly what the user chose.
 *
 * The synthetic Miniflux records every `PUT /v1/entries` as a mutation, so "no implicit mutation"
 * is asserted as `mock.mutations()` staying empty. Duplicates are matched by title (the setting
 * `removeDuplicates: "title"`), so the fixtures give distinct entries from different feeds the same
 * title. Newest first, the seeded head of the list is: A1 A2 A3 (one story), U (unique), B1 B2.
 */

const TITLE_A = "Duplicate story A"
const TITLE_B = "Duplicate story B"
const SETTINGS = {
  removeDuplicates: "title",
  markReadBy: "manually",
  markReadOnScroll: false,
  showStatus: "all",
}

const seedDuplicates = async (mock) => {
  await mock.inject(1, { title: TITLE_A, feed: 2, age: 1 })
  await mock.inject(1, { title: TITLE_A, feed: 3, age: 2 })
  await mock.inject(1, { title: TITLE_A, feed: 5, age: 3 })
  await mock.inject(1, { feed: 3, age: 4 })
  await mock.inject(1, { title: TITLE_B, feed: 4, age: 6 })
  await mock.inject(1, { title: TITLE_B, feed: 6, age: 7 })
  const { entries } = await mock.json(
    "/v1/entries?limit=6&order=published_at&direction=desc&status=unread",
  )
  const ids = entries.map(({ id }) => id)
  return { all: ids, A: ids.slice(0, 3), U: ids[3], B: ids.slice(4, 6) }
}

const showButton = (page, hidden) =>
  page.getByRole("button", { name: `Show ${hidden} duplicates`, exact: true })
const hideButton = (page, hidden) =>
  page.getByRole("button", { name: `Hide ${hidden} duplicates`, exact: true })

const firstIds = async (page, count) => {
  const ids = await entryIds(page)
  return ids.slice(0, count)
}
const mutatedIds = async (mock) => {
  const mutations = await mock.mutations()
  return mutations.flatMap(({ entryIds: ids }) => ids)
}

const expectNoMutations = async (mock) => {
  expect(await mock.mutations()).toEqual([])
  expect(await mock.readIds()).toEqual([])
}

const openList = async (openApp, options = {}) => {
  const { settings, ...rest } = options
  const app = await openApp({ path: "/all", settings: { ...SETTINGS, ...settings }, ...rest })
  await expect(cards(app.page).first()).toBeVisible()
  return app
}

test.describe("NF-E01 duplicate presentation integrity", () => {
  test("NF-E01-DUP-1: load, collapse and expand never mutate read state and keep canonical order", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { page } = await openList(openApp)

    // Collapsed: only the canonical (newest) entry of each group, in unchanged chronological order.
    await expect(showButton(page, 2)).toBeVisible()
    await expect(showButton(page, 1)).toBeVisible()
    expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])

    await showButton(page, 2).click()
    await expect(hideButton(page, 2)).toHaveAttribute("aria-expanded", "true")
    expect(await firstIds(page, 5)).toEqual([...seed.A, seed.U, seed.B[0]])
    await showButton(page, 1).click()
    expect(await firstIds(page, 6)).toEqual(seed.all)

    await hideButton(page, 2).click()
    await hideButton(page, 1).click()
    expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])

    // Title matching groups distinct stories (different feeds, different ids); expansion reveals
    // every loaded duplicate, and nothing was written back.
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-2: all three layouts group, reveal and stay read-state neutral", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    for (const articleListLayout of ["column", "card", "list"]) {
      const { page } = await openList(openApp, { settings: { articleListLayout } })
      await expect(showButton(page, 2)).toBeVisible()
      expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])
      await showButton(page, 2).click()
      expect(await firstIds(page, 5)).toEqual([...seed.A, seed.U, seed.B[0]])
      await hideButton(page, 2).click()
      expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])
    }
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-3: keyboard and touch operate groups without mutations", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const keyboard = await openList(openApp)
    const control = showButton(keyboard.page, 2)
    await control.focus()
    await keyboard.page.keyboard.press("Enter")
    await expect(hideButton(keyboard.page, 2)).toBeFocused()
    await keyboard.page.keyboard.press("Space")
    await expect(showButton(keyboard.page, 2)).toBeFocused()
    expect(await firstIds(keyboard.page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])

    const touch = await openList(openApp, { touch: true, width: 390, height: 844 })
    await showButton(touch.page, 2).tap()
    expect(await firstIds(touch.page, 4)).toEqual([...seed.A, seed.U])
    await hideButton(touch.page, 2).tap()
    expect(await firstIds(touch.page, 2)).toEqual([seed.A[0], seed.U])
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-4: reader previous/next follows displayed entries; expansion adds duplicates", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { page } = await openList(openApp)
    const openEntry = (id) => page.locator(`a.article-entry[data-entry-id="${id}"]`).click()
    const activeId = () => page.evaluate(() => new URL(location.href).pathname)

    await openEntry(seed.A[0])
    await expect(page.getByRole("button", { name: "Close article" })).toBeVisible()
    const startPath = await activeId()
    await page.keyboard.press("j")
    // The hidden duplicates A2/A3 are skipped: the next displayed entry is U, then B1.
    await expect.poll(activeId).not.toBe(startPath)
    expect(await activeId()).toContain(String(seed.U))
    await page.keyboard.press("j")
    await expect.poll(activeId).toContain(String(seed.B[0]))
    await page.keyboard.press("k")
    await expect.poll(activeId).toContain(String(seed.U))
    await page.keyboard.press("k")
    await expect.poll(activeId).toContain(String(seed.A[0]))
    await expectNoMutations(mock)

    // Once the user expands the group, its members join the previous/next sequence.
    await page.getByRole("button", { name: "Close article" }).click()
    await showButton(page, 2).click()
    await openEntry(seed.A[0])
    await page.keyboard.press("j")
    await expect.poll(activeId).toContain(String(seed.A[1]))
    await page.keyboard.press("j")
    await expect.poll(activeId).toContain(String(seed.A[2]))
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-5: virtualized scrolling in every layout keeps groups and sends nothing", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    await mock.inject(60, { age: 10 })
    for (const articleListLayout of ["column", "card", "list"]) {
      const { page } = await openList(openApp, {
        settings: { articleListLayout, markReadOnScroll: false },
      })
      const list = page.locator(
        ".entry-list.adaptive-scroll-area-native, .entry-list .simplebar-content-wrapper",
      )
      await showButton(page, 2).click()
      await list.hover()
      for (let step = 0; step < 4; step += 1) {
        await page.mouse.wheel(0, 900)
      }
      await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(600)
      // Scrolling the group out of the virtualized window and back keeps it expanded and intact.
      await list.evaluate((node) => {
        node.scrollTop = 0
      })
      await expect(hideButton(page, 2)).toBeVisible()
      expect(await firstIds(page, 3)).toEqual(seed.A)
    }
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-6: read-on-scroll marks only displayed entries, never hidden duplicates", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    await mock.inject(60, { age: 10 })
    const { page } = await openList(openApp, { settings: { markReadOnScroll: true } })
    const list = page.locator(
      ".entry-list.adaptive-scroll-area-native, .entry-list .simplebar-content-wrapper",
    )
    expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])
    await list.hover()
    for (let step = 0; step < 4; step += 1) {
      await page.mouse.wheel(0, 900)
    }
    await expect
      .poll(() => mock.mutations().then((mutations) => mutations.length), { timeout: 15_000 })
      .toBeGreaterThan(0)
    await page.waitForTimeout(400)
    const mutations = await mock.mutations()
    expect(mutations.every(({ status }) => status === "read")).toBe(true)
    const marked = await mutatedIds(mock)
    const readIds = await mock.readIds()
    // Product rule: read-on-scroll acts on what the user actually scrolled past, i.e. rendered
    // cards. Collapsed duplicates are not rendered, so they are never marked.
    expect(marked).toContain(seed.A[0])
    for (const hiddenId of [seed.A[1], seed.A[2], seed.B[1]]) {
      expect(marked).not.toContain(hiddenId)
    }
    expect(readIds).toEqual(expect.arrayContaining(marked))
    for (const hiddenId of [seed.A[1], seed.A[2], seed.B[1]]) {
      expect(readIds).not.toContain(hiddenId)
    }
  })

  test("NF-E01-DUP-7: pagination grows a group and keeps the user's expansion", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { context, page } = await openApp({
      path: "",
      settings: { ...SETTINGS, pageSize: 2 },
    })
    let listRequests = 0
    let releasePageTwo
    const pageTwoGate = new Promise((resolve) => {
      releasePageTwo = resolve
    })
    await context.route(
      (url) => url.pathname === "/v1/entries",
      async (route) => {
        const { searchParams } = new URL(route.request().url())
        // Only pages of the list itself count; the auxiliary "new entries" probe has limit=1.
        if (route.request().method() === "GET" && searchParams.get("limit") === "2") {
          listRequests += 1
          if (listRequests === 2) {
            await pageTwoGate
          }
        }
        await route.continue()
      },
    )
    await page.goto("/all")

    // Page one holds A1 and A2 only: a group of two.
    await expect(showButton(page, 1).first()).toBeVisible()
    expect(await entryIds(page)).toEqual([seed.A[0]])
    await showButton(page, 1).first().click()
    expect(await entryIds(page)).toEqual([seed.A[0], seed.A[1]])

    // Page two brings A3: the group grows to three and the expanded group reveals it.
    releasePageTwo()
    await expect(hideButton(page, 2)).toBeVisible()
    expect(await firstIds(page, 3)).toEqual(seed.A)
    await hideButton(page, 2).click()
    await expect(showButton(page, 2)).toBeVisible()
    expect(await firstIds(page, 2)).toEqual([seed.A[0], seed.U])
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-8: refresh and repeated page entries neither mutate nor inflate groups", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { page } = await openList(openApp)
    await showButton(page, 2).click()
    await mock.inject(1, { title: TITLE_B, feed: 7, age: 0 })
    const { entries: fresh } = await mock.json(
      "/v1/entries?limit=1&order=published_at&direction=desc&status=unread",
    )
    const newest = fresh[0].id

    await page.getByRole("button", { name: "Refresh" }).first().click()
    // The refreshed group B now has a newer canonical entry; A keeps the user's expansion.
    await expect(page.locator(`a.article-entry[data-entry-id="${newest}"]`)).toBeVisible()
    await expect(showButton(page, 2)).toBeVisible()
    expect(await firstIds(page, 5)).toEqual([newest, ...seed.A, seed.U])
    await expectNoMutations(mock)

    // A server page that repeats entries must not show them twice or count them as duplicates.
    await mock.fault("entries", "dup")
    await page.reload()
    await expect(cards(page).first()).toBeVisible()
    const ids = await entryIds(page)
    expect(new Set(ids).size).toBe(ids.length)
    // Repeated copies of the first five entries must not turn "2 duplicates" into more.
    await expect(showButton(page, 2).first()).toBeVisible()
    await expect(page.getByRole("button", { name: /^Show [3-9] duplicates$/ })).toHaveCount(0)
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-9: search and filters project their own results without mutations", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { page } = await openList(openApp)
    const openSearch = async () => {
      await page
        .getByRole("button", { name: /^Search(?::|$)/ })
        .first()
        .click()
      return page.getByLabel("Search article titles and content")
    }
    const input = await openSearch()
    await input.fill(TITLE_A)
    await input.press("Enter")
    await expect(showButton(page, 2)).toBeVisible()
    await expect.poll(() => entryIds(page)).toEqual([seed.A[0]])
    await showButton(page, 2).click()
    await expect.poll(() => entryIds(page)).toEqual(seed.A)

    // Clearing the search restores the full projection.
    const again = await openSearch()
    await again.fill("")
    await again.press("Enter")
    await expect.poll(() => entryIds(page).then((ids) => ids.length)).toBeGreaterThan(3)
    await expectNoMutations(mock)
  })

  test("NF-E01-DUP-10: selection mode shows every duplicate and marks exactly the chosen entries", async ({
    openApp,
    mock,
  }) => {
    const seed = await seedDuplicates(mock)
    const { page } = await openList(openApp)
    expect(await firstIds(page, 3)).toEqual([seed.A[0], seed.U, seed.B[0]])

    await page.getByRole("button", { name: "Select", exact: true }).click()
    const checkboxes = page.locator("input[data-bulk-entry-checkbox]")
    await expect(checkboxes.first()).toBeVisible()
    // Selection bypasses collapsing, so a hidden duplicate can be selected on its own.
    expect(await firstIds(page, 6)).toEqual(seed.all)
    await expectNoMutations(mock)

    await checkboxes.nth(1).check()
    await page.getByRole("button", { name: "Mark as read", exact: true }).click()
    await expect.poll(() => mock.readIds()).toEqual([seed.A[1]])
    expect(await mock.mutations()).toEqual([
      { entryIds: [seed.A[1]], status: "read", outcome: "applied" },
    ])
  })

  test("NF-E01-DUP-11: starred and history never collapse; All does", async ({ openApp, mock }) => {
    await mock.inject(2, { title: "Starred twin", feed: 2, age: 1, starred: true })
    await mock.inject(2, { title: "History twin", feed: 3, age: 2, status: "read" })
    const all = await openApp({ path: "/all", settings: { ...SETTINGS, showStatus: "all" } })
    await expect(showButton(all.page, 1).first()).toBeVisible()

    const starred = await openApp({ path: "/starred", settings: SETTINGS })
    await expect(cards(starred.page).first()).toBeVisible()
    await expect(starred.page.getByText("Starred twin")).toHaveCount(2)
    await expect(starred.page.getByRole("button", { name: /duplicates?$/ })).toHaveCount(0)

    const history = await openApp({ path: "/history", settings: SETTINGS })
    await expect(cards(history.page).first()).toBeVisible()
    await expect(history.page.getByText("History twin")).toHaveCount(2)
    await expect(history.page.getByRole("button", { name: /duplicates?$/ })).toHaveCount(0)
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-E01-DUP-12: scoped Mark all is an explicit action over the whole feed, hidden duplicates included", async ({
    openApp,
    mock,
  }) => {
    await mock.inject(3, { title: "Feed twin", feed: 1, age: 1 })
    const { entries } = await mock.json("/v1/entries?limit=3&order=published_at&direction=desc")
    const twinIds = entries.map(({ id }) => id)
    const { page } = await openApp({
      path: "/feed/1",
      settings: { ...SETTINGS, articleListLayout: "card" },
    })
    await expect(showButton(page, 2)).toBeVisible()
    expect(await entryIds(page)).toEqual(expect.not.arrayContaining(twinIds.slice(1)))
    await expectNoMutations(mock)

    await page
      .getByRole("button", { name: "Mark all as read", exact: true })
      .first()
      .click({ position: { x: 8, y: 36 } })
    await expect(page.getByText("Mark all as read?")).toBeVisible()
    await expectNoMutations(mock)
    await page.locator(".arco-popconfirm-btn .arco-btn-primary").click()
    await expect(page.getByRole("alert")).toBeVisible()
    await expect
      .poll(async () => {
        const readIds = await mock.readIds()
        return readIds.filter((id) => twinIds.includes(id)).length
      })
      .toBe(3)
  })

  test("NF-E01-DUP-13: unread counts stay server-true while groups collapse and expand", async ({
    openApp,
    mock,
  }) => {
    await seedDuplicates(mock)
    const { page } = await openList(openApp, { settings: { showStatus: "unread" } })
    const { unread: unreadTotal } = await mock.state()
    const bodyHas = async (text) => {
      const visible = await page.locator("body").evaluate((body) => body.textContent)
      return visible.includes(text)
    }
    await expect.poll(() => bodyHas(String(unreadTotal))).toBe(true)
    await showButton(page, 2).click()
    expect(await bodyHas(String(unreadTotal))).toBe(true)
    await hideButton(page, 2).click()
    expect(await bodyHas(String(unreadTotal))).toBe(true)
    const after = await mock.state()
    expect(after.unread).toBe(unreadTotal)
    await expectNoMutations(mock)
  })

  test("NF-E01-HOME-1: Home renders with read-on-scroll enabled and sends nothing on load", async ({
    openApp,
    mock,
  }) => {
    const { page, errors } = await openApp({
      path: "/",
      settings: { ...SETTINGS, markReadOnScroll: true },
    })
    await expect(page.getByText("Highlights", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Something went wrong")).toHaveCount(0)
    expect(errors).toEqual([])
    await expectNoMutations(mock)
  })
})
