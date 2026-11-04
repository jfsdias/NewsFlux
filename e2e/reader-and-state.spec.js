import { bodyTextLength, cards, center, horizontalOverflow } from "./support/app.js"
import { knownDefect, requirementPending } from "./support/classification.js"
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

    await knownDefect("QA-001", /Open sidebar[\s\S]*intercepts pointer events/, async () => {
      await closeArticle(page).click({ timeout: 3000 })
    })
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

    await knownDefect("QA-001", /toHaveURL[\s\S]*Received[^\n]*\/all\/entry\/\d+/, async () => {
      await page.touchscreen.tap(x, y)
      await expect(page).toHaveURL(/\/all$/, { timeout: 2000 })
    })
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

  test("F06-3: an article opened by a direct link is marked as read (proposed behavior)", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all/entry/14" })
    await expect(page.getByText("Notícia 14").first()).toBeVisible()
    // The negative claim needs a fixed window: nothing is expected to happen.
    await page.waitForTimeout(3000)

    await requirementPending("QA-002", /QA-002/, async () => {
      expect(
        await mock.readIds(),
        "QA-002: a deep-linked article should be marked read once displayed",
      ).toContain(14)
    })
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
