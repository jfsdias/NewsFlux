import { expect, test } from "./support/fixtures.js"

/*
 * NF-E02 Smart Views MVP — synthetic E2E contract
 *
 * Run from the exact NewsFlux checkout with its Playwright config.  This file
 * intentionally imports the existing fixture rather than adding a second mock
 * client.  Smart Views are browser-local metadata: every scenario asserts that
 * the Miniflux mock recorded no article mutations.
 */

const QUERY_A = '"Notícia 4"'
const QUERY_B = "Notícia 2"

const openSearch = async (page) => {
  await page
    .getByRole("button", { name: /^Search(?::|$)/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  return page.getByLabel("Search article titles and content")
}

const saveView = async (page, name, query) => {
  const input = await openSearch(page)
  await input.fill(query)
  await page.getByLabel("View name").fill(name)
  await page.getByRole("button", { name: "Save this search" }).click()
  await expect(page.getByText("View saved on this browser.")).toBeVisible()
}

const closeSearch = async (page) => {
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
}

const entryRequestFor = (page, query) =>
  page.waitForRequest(
    (request) =>
      /\/v1\/(?:entries|feeds\/\d+\/entries|categories\/\d+\/entries)$/.test(
        new URL(request.url()).pathname,
      ) && new URL(request.url()).searchParams.get("search") === query,
  )

test.describe("NF-E02 Smart Views", () => {
  test("NF-E02-1: create, open and reload preserve query and source scope", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/feed/1" })
    await expect(page.locator("a.article-entry").first()).toBeVisible()

    await saveView(page, "Feed 1 search", QUERY_A)
    await closeSearch(page)

    // Opening must re-run the provider query in the same feed scope.
    const request = entryRequestFor(page, QUERY_A)
    await openSearch(page)
    await page.getByRole("button", { name: /^Open / }).click()
    await expect(page).toHaveURL(/\/feed\/1$/)
    await request
    await expect(page).toHaveURL(/\/feed\/1$/)

    // Saved metadata is browser-local and survives a full reload.
    await page.reload()
    await expect(page.locator("a.article-entry").first()).toBeVisible()
    await openSearch(page)
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Feed 1 search")).toBeVisible()
    await expect(dialog.getByText(QUERY_A)).toBeVisible()
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-E02-2: reopening a view has scope parity and no implicit writes", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/category/1" })
    await saveView(page, "Category query", QUERY_B)
    await closeSearch(page)

    const request = entryRequestFor(page, QUERY_B)
    await openSearch(page)
    await page.getByRole("button", { name: /^Open / }).click()
    await expect(page).toHaveURL(/\/category\/1$/)
    await request

    // The route is the saved source scope; opening does not jump to /all.
    expect(new URL(page.url()).pathname).toBe("/category/1")
    expect(await mock.mutations()).toEqual([])
  })

  test("NF-E02-3: rename, reorder and delete are explicit and persisted", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await saveView(page, "First view", QUERY_A)
    await closeSearch(page)
    await saveView(page, "Second view", QUERY_B)

    // Rename uses the component's native confirmation prompt.
    page.once("dialog", (dialog) => dialog.accept("Renamed view"))
    await page.getByRole("button", { name: "Rename First view", exact: true }).first().click()
    await expect(page.getByRole("dialog").getByText("Renamed view")).toBeVisible()

    // Move the second item above the first; DOM order is the persistence contract.
    await page.getByRole("button", { name: "Move Second view up" }).click()
    await expect(page.locator('[aria-label="Saved views"] li').first()).toContainText("Second view")

    // Delete is explicit and must remove only the selected saved view.
    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "Delete Second view", exact: true }).first().click()
    await expect(
      page.locator('[aria-label="Saved views"]').getByText("Second view", { exact: true }),
    ).toHaveCount(0)

    // Reopen the modal to prove rename/reorder/delete survived component remount.
    await closeSearch(page)
    await openSearch(page)
    await expect(page.getByRole("dialog").getByText("Renamed view")).toBeVisible()
    await expect(page.getByRole("dialog").getByText(QUERY_A)).toBeVisible()
    await expect(
      page.locator('[aria-label="Saved views"]').getByText(QUERY_B, { exact: true }),
    ).toHaveCount(0)
    expect(await mock.mutations()).toEqual([])
  })
})

test("NF-E02-4: restores a starred feed view from all without changing read state", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/feed/1", settings: { showStatus: "starred" } })
  await saveView(page, "Starred feed", QUERY_B)
  await closeSearch(page)
  await page.goto("/all")
  await openSearch(page)
  const request = page.waitForRequest((r) => {
    const url = new URL(r.url())
    return (
      url.pathname === "/v1/feeds/1/entries" &&
      url.searchParams.get("search") === QUERY_B &&
      url.searchParams.get("starred") === "true"
    )
  })
  await page.getByRole("button", { name: /^Open / }).click()
  await request
  expect(await mock.mutations()).toEqual([])
})

test("NF-E02-5: Today shortcut restores date and sort", async ({ openApp, mock }) => {
  const { page } = await openApp({ path: "/all" })
  await page.getByRole("button", { name: "Select date" }).click()
  await page.getByRole("button", { name: "Today", exact: true }).click()
  await saveView(page, "Today search", QUERY_B)
  await expect(page.getByText(/date \d{4}-\d{2}-\d{2}/)).toBeVisible()
  await closeSearch(page)
  await page.getByRole("button", { name: "Select date" }).click()
  await page.getByRole("button", { name: "Clear", exact: true }).click()
  await openSearch(page)
  const request = page.waitForRequest((r) => {
    const url = new URL(r.url())
    return (
      url.pathname === "/v1/entries" &&
      url.searchParams.get("search") === QUERY_B &&
      url.searchParams.get("order") === "created_at" &&
      url.searchParams.get("direction") === "desc" &&
      Boolean(url.searchParams.get("published_after")) &&
      Boolean(url.searchParams.get("published_before"))
    )
  })
  await page.getByRole("button", { name: "Open Today search" }).click()
  await request
  expect(await mock.mutations()).toEqual([])
})
