import { cards, entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

const footerMarkAllButton = (page) =>
  page.getByRole("button", { name: "Mark all as read", exact: true })
const undoButton = (page) => page.getByRole("button", { name: "Undo", exact: true })
const articleWord = (count) => (count === 1 ? "article" : "articles")

const acknowledgedReadIds = async (mock, fromMutationIndex = 0) => {
  const mutations = await mock.mutations()
  return mutations
    .slice(fromMutationIndex)
    .filter(({ status }) => status === "read")
    .flatMap(({ entryIds: ids }) => ids)
}

const failSecondReadBatch = async (page) => {
  const requests = []
  await page.route("**/v1/entries", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue()
      return
    }

    requests.push(route.request().postDataJSON().entry_ids)
    if (requests.length === 2) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error_message: "synthetic second batch failure" }),
      })
      return
    }
    await route.continue()
  })
  return requests
}

const feedCounterRequestCount = async (mock) => {
  const requests = await mock.requests()
  return requests.filter((request) => request.startsWith("GET /v1/feeds/counters")).length
}

const sortedNumericIds = (ids) => ids.toSorted((left, right) => left - right)

const expectAcknowledgedOnlyUndo = async ({ page, mock, batchRequests, expectedScope }) => {
  await expect.poll(() => batchRequests.length).toBe(2)
  const acknowledgedIds = batchRequests[0]
  const failedBatchIds = batchRequests[1]

  expect(acknowledgedIds).toHaveLength(1000)
  expect(new Set(acknowledgedIds).size).toBe(acknowledgedIds.length)
  expect(failedBatchIds.length).toBeGreaterThan(0)
  expect(acknowledgedIds.some((id) => failedBatchIds.includes(id))).toBe(false)

  await expect(
    page.getByText(
      `${acknowledgedIds.length} articles confirmed as read before Mark all as read stopped in ${expectedScope}`,
    ),
  ).toBeVisible()
  await expect(undoButton(page)).toBeVisible()
  await expect(page).toHaveURL(/\/(?:feed\/1|category\/1)$/)
  expect(sortedNumericIds(await mock.readIds())).toEqual(sortedNumericIds(acknowledgedIds))

  const mutationsBeforeUndo = await mock.mutations()
  expect(mutationsBeforeUndo).toHaveLength(1)
  expect(mutationsBeforeUndo[0].status).toBe("read")
  expect(sortedNumericIds(mutationsBeforeUndo[0].entryIds)).toEqual(
    sortedNumericIds(acknowledgedIds),
  )

  const countersBeforeUndo = await feedCounterRequestCount(mock)
  await undoButton(page).click()
  await expect.poll(() => mock.readIds()).toEqual([])
  await expect.poll(() => mock.mutations()).toHaveLength(2)
  const mutationsAfterUndo = await mock.mutations()
  expect(mutationsAfterUndo[1].status).toBe("unread")
  expect(sortedNumericIds(mutationsAfterUndo[1].entryIds)).toEqual(
    sortedNumericIds(acknowledgedIds),
  )
  await expect.poll(async () => feedCounterRequestCount(mock)).toBeGreaterThan(countersBeforeUndo)
  await expect(page).toHaveURL(/\/(?:feed\/1|category\/1)$/)
}

const confirmFooterMarkAll = async (page) => {
  await footerMarkAllButton(page)
    .first()
    .click({ position: { x: 8, y: 36 } })
  await expect(page.getByText("Mark all as read?")).toBeVisible()
  await page.locator(".arco-popconfirm-btn .arco-btn-primary").click()
  await expect(page.getByRole("alert")).toBeVisible()
}

test("BULK-01C-1: Footer Mark All reports confirmed count and feed scope with usable Undo", async ({
  openApp,
  mock,
}) => {
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 1104, width: 884 },
  ]) {
    const { page } = await openApp({
      path: "/feed/1",
      ...viewport,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    await expect(cards(page).first()).toBeVisible()
    const mutationsBefore = await mock.mutations()
    const mutationStart = mutationsBefore.length
    await confirmFooterMarkAll(page)

    await expect.poll(() => acknowledgedReadIds(mock, mutationStart)).not.toEqual([])
    const acknowledgedIds = await acknowledgedReadIds(mock, mutationStart)
    expect(acknowledgedIds.length).toBeGreaterThan(0)
    await expect(
      page.getByText(
        `${acknowledgedIds.length} ${articleWord(acknowledgedIds.length)} marked as read in Alfa Tech (Feed)`,
      ),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/feed\/1$/)
    await expect(undoButton(page)).toBeVisible()

    const notice = page
      .locator(".arco-notification")
      .filter({ hasText: /marked as read in Alfa Tech \(Feed\)/ })
    await expect
      .poll(async () => {
        const currentBounds = await notice.boundingBox()
        return currentBounds !== null && currentBounds.x + currentBounds.width <= viewport.width + 1
      })
      .toBe(true)
    const bounds = await notice.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
    const noticeOverflow = await notice.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    )
    expect(noticeOverflow).toBe(false)

    await undoButton(page).click()
    await expect.poll(() => mock.readIds()).not.toContain(acknowledgedIds[0])
    await expect(page).toHaveURL(/\/feed\/1$/)
  }
})

test("BULK-01C-2: Sidebar category Mark All reports its confirmed count and supports Undo", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/category/1",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  await page.getByRole("button", { name: "Feeds", exact: true }).click()
  const category = page.locator("#category-link-1")
  await expect(category).toBeVisible()
  await category.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Mark all as read" }).click()
  await expect(page.getByText("Mark all as read?")).toBeVisible()
  await page.locator(".arco-modal-wrapper .arco-btn-primary").click()

  await expect(page.getByRole("alert")).toBeVisible()
  await expect.poll(() => acknowledgedReadIds(mock)).not.toEqual([])
  const acknowledgedIds = await acknowledgedReadIds(mock)
  expect(acknowledgedIds.length).toBeGreaterThan(0)
  await expect(
    page.getByText(
      `${acknowledgedIds.length} ${articleWord(acknowledgedIds.length)} marked as read in Tecnologia (Category)`,
    ),
  ).toBeVisible()
  await undoButton(page).click()
  await expect.poll(() => mock.readIds()).not.toContain(acknowledgedIds[0])
})

test("BULK-01C-7: Footer Mark All partial failure undoes only the acknowledged batch", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/feed/1",
    settings: { articleListLayout: "card", showStatus: "unread", markAllReadJumpToNext: true },
  })
  await mock.inject(1001)
  await page.reload()
  await expect(cards(page).first()).toBeVisible()
  const countersBeforeAction = await feedCounterRequestCount(mock)
  const batchRequests = await failSecondReadBatch(page)

  await confirmFooterMarkAll(page)
  await expectAcknowledgedOnlyUndo({
    page,
    mock,
    batchRequests,
    expectedScope: "Alfa Tech (Feed)",
  })
  await expect
    .poll(async () => feedCounterRequestCount(mock))
    .toBeGreaterThan(countersBeforeAction + 1)
})

test("BULK-01C-8: Sidebar category partial failure undoes only the acknowledged batch", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/category/1",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  await mock.inject(1001)
  await page.reload()
  await expect(cards(page).first()).toBeVisible()
  const countersBeforeAction = await feedCounterRequestCount(mock)
  const batchRequests = await failSecondReadBatch(page)

  await page.getByRole("button", { name: "Feeds", exact: true }).click()
  const category = page.locator("#category-link-1")
  await expect(category).toBeVisible()
  await category.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Mark all as read" }).click()
  await expect(page.getByText("Mark all as read?")).toBeVisible()
  await page.locator(".arco-modal-wrapper .arco-btn-primary").click()

  await expectAcknowledgedOnlyUndo({
    page,
    mock,
    batchRequests,
    expectedScope: "Tecnologia (Category)",
  })
  await expect
    .poll(async () => feedCounterRequestCount(mock))
    .toBeGreaterThan(countersBeforeAction + 1)
})

test("BULK-01C-3: selected read reports the selected count and category scope", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/category/1",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  await expect(cards(page).first()).toBeVisible()
  const renderedIds = await entryIds(page)
  const selectedIds = renderedIds.slice(0, 2)
  await page.getByRole("button", { name: "Select", exact: true }).click()
  const checkboxes = page.locator("input[data-bulk-entry-checkbox]")
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  await page.getByRole("button", { name: "Mark as read", exact: true }).click()

  await expect(
    page.getByText("2 selected articles marked as read in Tecnologia (Category)"),
  ).toBeVisible()
  await expect.poll(() => mock.readIds()).toEqual(expect.arrayContaining(selectedIds))
  await undoButton(page).click()
  await expect.poll(() => mock.readIds()).not.toContain(selectedIds[0])
})

test("BULK-01C-4: relative read reports direction, confirmed count, and current scope", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/all",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  const card = cards(page).first()
  const anchorId = Number(await card.getAttribute("data-entry-id"))
  await page.getByRole("button", { name: "Card actions" }).first().click()
  await page.getByRole("menuitem", { name: "Mark articles below as read" }).click()

  await expect(page.getByRole("alert")).toBeVisible()
  await expect.poll(() => acknowledgedReadIds(mock)).not.toEqual([])
  const acknowledgedIds = await acknowledgedReadIds(mock)
  expect(acknowledgedIds.length).toBeGreaterThan(0)
  expect(acknowledgedIds).not.toContain(anchorId)
  await expect(
    page.getByText(
      `Marked ${acknowledgedIds.length} ${articleWord(acknowledgedIds.length)} below as read in All articles`,
    ),
  ).toBeVisible()
  await undoButton(page).click()
  await expect.poll(() => mock.readIds()).not.toContain(acknowledgedIds[0])
})

test("BULK-01C-5: full Footer Mark All failure shows scoped error without success or Undo", async ({
  openApp,
  mock,
}) => {
  await mock.fault("status-mutation", "500")
  const { page } = await openApp({
    path: "/feed/1",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  await expect(cards(page).first()).toBeVisible()
  await confirmFooterMarkAll(page)

  await expect(page.getByText("Could not mark articles as read in Alfa Tech (Feed)")).toBeVisible()
  await expect(page.getByText(/marked as read in Alfa Tech \(Feed\)/)).toBeHidden()
  await expect(undoButton(page)).toHaveCount(0)
  expect(await mock.readIds()).toEqual([])
  await expect(page).toHaveURL(/\/feed\/1$/)
})

test("BULK-01C-6: mark older read includes the category scope in feedback", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/category/1",
    settings: { articleListLayout: "card", showStatus: "all" },
  })
  await expect(cards(page).first()).toBeVisible()
  await page.getByRole("button", { name: "Mark older articles as read" }).click()
  await page.getByRole("menuitem", { name: "Older than 1 day" }).click()
  await expect(page.getByRole("dialog", { name: "Older than 1 day" })).toBeVisible()
  await page.getByRole("button", { name: "OK", exact: true }).click()

  await expect(page.getByRole("alert")).toBeVisible()
  await expect.poll(() => acknowledgedReadIds(mock)).not.toEqual([])
  const acknowledgedIds = await acknowledgedReadIds(mock)
  expect(acknowledgedIds.length).toBeGreaterThan(0)
  await expect(
    page.getByText(
      `${acknowledgedIds.length} older ${articleWord(acknowledgedIds.length)} marked as read in Tecnologia (Category)`,
    ),
  ).toBeVisible()
  await undoButton(page).click()
  await expect.poll(() => mock.readIds()).not.toContain(acknowledgedIds[0])
})
