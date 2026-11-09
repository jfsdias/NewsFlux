import { cards, horizontalOverflow } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

const cardActions = (page) => page.getByRole("button", { name: "Card actions" }).first()
const actionMenu = (page) => page.locator(".mobile-action-menu").filter({ visible: true })

test.describe("CARD-QUICK-ACTIONS-01", () => {
  test("CARD-QUICK-ACTIONS-01-1: keyboard menu semantics and focus restoration", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    const card = cards(page).first()
    const button = cardActions(page)

    await expect(card).toBeVisible()
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute("aria-haspopup", "menu")
    await expect(button).toHaveAttribute("aria-expanded", "false")
    expect(await button.evaluate((element) => element.closest("a.article-entry"))).toBeNull()
    const bounds = await button.boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)

    await card.focus()
    await page.keyboard.press("Tab")
    await expect(button).toBeFocused()
    await button.press("Enter")
    await expect(actionMenu(page)).toBeVisible()
    await expect(button).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("menuitem").first()).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("menuitem", { name: /Mark as read/i })).toBeFocused()
    await expect(page).toHaveURL(/\/all$/)

    await page.keyboard.press("Escape")
    await expect(actionMenu(page)).toBeHidden()
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute("aria-expanded", "false")

    const columnRun = await openApp({ path: "/all", settings: { articleListLayout: "column" } })
    const columnButton = cardActions(columnRun.page)
    await expect(columnButton).toBeVisible()
    const columnBounds = await columnButton.boundingBox()
    expect(columnBounds.width).toBeGreaterThanOrEqual(44)
    expect(columnBounds.height).toBeGreaterThanOrEqual(44)
    await columnButton.click()
    await expect(actionMenu(columnRun.page)).toBeVisible()
  })

  test("CARD-QUICK-ACTIONS-01-2: existing read and favorite actions remain available", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    const button = cardActions(page)
    await button.click()
    await page.getByRole("menuitem", { name: /Mark as read/i }).click()
    await expect.poll(() => mock.readIds()).toContain(1)
    await expect(page).toHaveURL(/\/all$/)

    await button.click()
    await page.getByRole("menuitem", { name: /^Star$/i }).click()
    await expect
      .poll(async () => {
        const state = await mock.state()
        return state.starred
      })
      .toContain(1)

    await button.click()
    await page.getByRole("menuitem", { name: /Mark as unread/i }).click()
    await expect.poll(() => mock.readIds()).not.toContain(1)

    await button.click()
    await page.getByRole("menuitem", { name: /^Unstar$/i }).click()
    await expect
      .poll(async () => {
        const state = await mock.state()
        return state.starred
      })
      .not.toContain(1)

    await button.click()
    await page.getByRole("menuitem", { name: /Mark articles below as read/i }).click()
    const undo = page.getByRole("button", { name: "Undo" })
    await expect(undo).toBeVisible()
    await undo.click()
    await expect.poll(() => mock.readIds()).not.toContain(2)

    await mock.fault("status-mutation", "500")
    await button.click()
    await page.getByRole("menuitem", { name: /Mark as read/i }).click()
    await expect(page.getByText("Failed to mark as read, please try again later")).toBeVisible()
    await expect.poll(() => mock.readIds()).not.toContain(1)
  })

  test("CARD-QUICK-ACTIONS-01-3: card primary click still opens the article", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    await cards(page).first().click()
    await expect(page).toHaveURL(/\/all\/entry\/\d+$/)
  })

  test("CARD-QUICK-ACTIONS-01-4: right-click and touch long-press still open the menu", async ({
    openApp,
  }) => {
    const mouseRun = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    await cards(mouseRun.page).first().click({ button: "right" })
    await expect(mouseRun.page.getByRole("menuitem", { name: /Mark as read/i })).toBeVisible()

    const touchRun = await openApp({
      path: "/all",
      settings: { articleListLayout: "card" },
      touch: true,
      width: 390,
      height: 844,
    })
    const card = cards(touchRun.page).first()
    const point = await card.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x: x + width / 2, y: y + height / 2 }
    })
    await card.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    })
    await touchRun.page.waitForTimeout(550)
    await card.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
    })
    await expect(touchRun.page.getByRole("menuitem", { name: /Mark as read/i })).toBeVisible()

    await touchRun.page.keyboard.press("Escape")
    const actionButton = cardActions(touchRun.page)
    await actionButton.tap()
    await expect(actionMenu(touchRun.page)).toBeVisible()
    await expect(touchRun.page).toHaveURL(/\/all$/)
  })

  test("CARD-QUICK-ACTIONS-01-5: List and multi-select remain unchanged", async ({ openApp }) => {
    const listRun = await openApp({ path: "/all", settings: { articleListLayout: "list" } })
    await expect(cards(listRun.page).first()).toBeVisible()
    await expect(cardActions(listRun.page)).toHaveCount(0)

    const selectionRun = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    const selectionTrigger = selectionRun.page.getByRole("button", { name: "Select", exact: true })
    await expect(selectionTrigger).toBeEnabled()
    await selectionTrigger.click()
    await expect(selectionRun.page.locator("input[data-bulk-entry-checkbox]").first()).toBeVisible()
    await expect(cardActions(selectionRun.page)).toHaveCount(0)
  })

  test("CARD-QUICK-ACTIONS-01-6: responsive Light and Dark/OLED visual matrix", async ({
    openApp,
  }, testInfo) => {
    const viewports = [
      { height: 844, label: "compact-mobile", width: 390 },
      { height: 614, label: "surface-duo-closed", width: 466 },
      { height: 1104, label: "surface-duo-open-critical", width: 884 },
    ]
    const themes = [
      { expected: "light", label: "light" },
      { expected: "dark", label: "dark-oled" },
    ]

    for (const viewport of viewports) {
      for (const theme of themes) {
        const { page } = await openApp({
          path: "/all",
          width: viewport.width,
          height: viewport.height,
          settings: { articleListLayout: "card", themeMode: theme.expected },
        })
        const shell = page.locator(".article-entry-card-shell.grid-card-wrapper").first()
        const button = shell.getByRole("button", { name: "Card actions" })

        await expect(shell).toBeVisible()
        await expect(button).toBeVisible()
        await expect(page.locator("body")).toHaveAttribute("arco-theme", theme.expected)
        expect(await horizontalOverflow(page)).toBe(false)

        const bounds = await button.boundingBox()
        const cardBounds = await shell.boundingBox()
        expect(bounds.width).toBeGreaterThanOrEqual(44)
        expect(bounds.height).toBeGreaterThanOrEqual(44)
        expect(bounds.x).toBeGreaterThanOrEqual(cardBounds.x)
        expect(bounds.y).toBeGreaterThanOrEqual(cardBounds.y)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height)

        const visualChecks = await shell.evaluate((element) => {
          const buttonElement = element.querySelector("button.card-quick-actions")
          const buttonBounds = buttonElement.getBoundingClientRect()
          const cardBounds = element.getBoundingClientRect()
          const targets = [...element.querySelectorAll(".article-entry-title, img")].map(
            (target) => {
              const bounds = target.getBoundingClientRect()
              return {
                bottom: bounds.bottom,
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
              }
            },
          )
          const overlaps = targets.some(
            (target) =>
              buttonBounds.left < target.right &&
              buttonBounds.right > target.left &&
              buttonBounds.top < target.bottom &&
              buttonBounds.bottom > target.top,
          )
          const textChannels = getComputedStyle(buttonElement)
            .color.match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
          const surfaceChannels = getComputedStyle(element)
            .backgroundColor.match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
          const [textRed, textGreen, textBlue] = textChannels.map((value) => {
            const normalized = value / 255
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4
          })
          const [surfaceRed, surfaceGreen, surfaceBlue] = surfaceChannels.map((value) => {
            const normalized = value / 255
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4
          })
          const textLuminance = 0.2126 * textRed + 0.7152 * textGreen + 0.0722 * textBlue
          const surfaceLuminance =
            0.2126 * surfaceRed + 0.7152 * surfaceGreen + 0.0722 * surfaceBlue

          return {
            backgroundColor: getComputedStyle(element).backgroundColor,
            buttonClipped:
              buttonBounds.left < cardBounds.left || buttonBounds.right > cardBounds.right,
            contrastRatio:
              (Math.max(textLuminance, surfaceLuminance) + 0.05) /
              (Math.min(textLuminance, surfaceLuminance) + 0.05),
            overlapsTitleOrImage: overlaps,
          }
        })
        expect(visualChecks.buttonClipped).toBe(false)
        expect(visualChecks.overlapsTitleOrImage).toBe(false)
        expect(visualChecks.contrastRatio).toBeGreaterThanOrEqual(4.5)
        expect(visualChecks.backgroundColor).not.toBe("rgba(0, 0, 0, 0)")

        await button.click()
        await expect(actionMenu(page)).toBeVisible()
        const screenshotName = `${viewport.label}-${theme.label}.png`
        const screenshotPath = testInfo.outputPath(screenshotName)
        await page.screenshot({ animations: "disabled", path: screenshotPath })
        await testInfo.attach(screenshotName, {
          path: screenshotPath,
          contentType: "image/png",
        })
      }
    }
  })

  test("CARD-QUICK-ACTIONS-01-7: grid card content fills each stretched row", async ({
    openApp,
  }) => {
    for (const path of ["/", "/all"]) {
      const { page } = await openApp({
        path,
        width: 884,
        height: 1104,
        settings: { articleListLayout: "card" },
      })
      const gridCards = page.locator(
        path === "/"
          ? ".home-editorial .article-entry-card-shell.grid-card-wrapper"
          : ".article-entry-card-shell.grid-card-wrapper",
      )
      await expect(gridCards.first()).toBeVisible()

      const cardHeights = await gridCards.evaluateAll((elements) =>
        elements.map((shell) => {
          const content = shell.querySelector(".article-entry-card-content > .grid-card-content")
          return {
            content: content?.getBoundingClientRect().height ?? 0,
            shell: shell.clientHeight,
          }
        }),
      )
      const footerGaps = await page.locator(".article-card-grid-row").evaluateAll((rows) =>
        rows.flatMap((row) => {
          const footers = [...row.children]
            .map(
              (cell) =>
                cell
                  .querySelector(".article-entry-card-shell.grid-card-wrapper .grid-card-footer")
                  ?.getBoundingClientRect().bottom,
            )
            .filter((bottom) => Number.isFinite(bottom))
          if (footers.length < 2) {
            return []
          }
          return [Math.max(...footers) - Math.min(...footers)]
        }),
      )
      expect(cardHeights.length).toBeGreaterThan(0)
      expect(
        cardHeights.filter(({ content, shell }) => content < shell - 2),
        `${path}: ${JSON.stringify(cardHeights)}`,
      ).toEqual([])
      expect(footerGaps.length).toBeGreaterThan(0)
      expect(
        footerGaps.filter((gap) => gap > 1),
        `${path}: ${JSON.stringify(footerGaps)}`,
      ).toEqual([])
    }
  })
})
