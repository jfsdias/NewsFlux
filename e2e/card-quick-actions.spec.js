import { cards, horizontalOverflow } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

const cardActions = (page) => page.getByRole("button", { name: "Card actions" }).first()
const actionMenu = (page) => page.locator(".mobile-action-menu").filter({ visible: true })

const touchPrimaryCard = async (openApp, viewport, path = "/all") => {
  const { page } = await openApp({
    path,
    ...viewport,
    touch: true,
    settings: { articleListLayout: "card", themeMode: "dark" },
  })
  const title = page.locator(".article-entry-card-shell .article-entry-title").first()
  await expect(title).toBeVisible()
  const bounds = await title.boundingBox()
  expect(bounds).not.toBeNull()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const linkHref = await title.evaluate(
    (element) =>
      element.closest(".article-entry-card-shell")?.querySelector(":scope > a.article-entry")?.href,
  )
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return target?.closest("a.article-entry")?.href ?? null
  }, point)
  expect(hit).toBe(linkHref)
  await page.touchscreen.tap(point.x, point.y)
  await expect(page).toHaveURL(linkHref)
}

const tapMenuItemWithTouch = async (page, item) => {
  const bounds = await item.boundingBox()
  expect(bounds).not.toBeNull()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return {
      menu: Boolean(target?.closest(".mobile-action-menu")),
      item: target?.closest(".mobile-action-menu [role=menuitem]")?.textContent ?? "",
    }
  }, point)
  expect(hit.menu).toBe(true)
  await page.touchscreen.tap(point.x, point.y)
}

test.describe("CARD-QUICK-ACTIONS-01", () => {
  test("CARD-QUICK-ACTIONS-01-8: primary touch still opens the article on the open Duo", async ({
    openApp,
  }) => {
    await touchPrimaryCard(openApp, { width: 884, height: 1104 })
    await touchPrimaryCard(openApp, { width: 884, height: 1104 }, "/")
  })

  test("CARD-QUICK-ACTIONS-01-11: primary touch still opens the article on the closed Duo", async ({
    openApp,
  }) => {
    await touchPrimaryCard(openApp, { width: 466, height: 614 })
  })

  test("CARD-QUICK-ACTIONS-01-12: menu dismissal leaves primary touch navigation intact", async ({
    openApp,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all", themeMode: "dark" },
    })
    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    const outsidePoint = await page.evaluate(() => {
      const menuRect = document.querySelector(".mobile-action-menu")?.getBoundingClientRect()
      for (let y = 4; y < innerHeight - 4; y += 8) {
        for (let x = 4; x < innerWidth - 4; x += 8) {
          if (
            menuRect &&
            x >= menuRect.left &&
            x <= menuRect.right &&
            y >= menuRect.top &&
            y <= menuRect.bottom
          ) {
            continue
          }
          const target = document.elementFromPoint(x, y)
          if (!target?.closest("a,button,input,textarea,select,[role=button],[role=menuitem]")) {
            return { x, y }
          }
        }
      }
      return null
    })
    expect(outsidePoint).not.toBeNull()
    await page.touchscreen.tap(outsidePoint.x, outsidePoint.y)
    await expect(actionMenu(page)).toBeHidden()
    await expect(page).toHaveURL(/\/all$/)

    const title = page.locator(".article-entry-card-shell .article-entry-title").first()
    const bounds = await title.boundingBox()
    expect(bounds).not.toBeNull()
    const entryId = await title.evaluate(
      (element) =>
        element.closest(".article-entry-card-shell")?.querySelector(":scope > a.article-entry")
          ?.dataset.entryId,
    )
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await expect(page).toHaveURL(new RegExp(`/all/entry/${entryId}$`))
  })

  test("CARD-QUICK-ACTIONS-01-9: touch mark-as-read mutates only the synthetic entry", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    const card = cards(page).first()
    const entryId = Number(await card.getAttribute("data-entry-id"))

    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    await expect(page).toHaveURL(/\/all$/)
    const outsidePoint = await page.evaluate(() => {
      const menuRect = document.querySelector(".mobile-action-menu")?.getBoundingClientRect()
      for (let y = 4; y < innerHeight - 4; y += 8) {
        for (let x = 4; x < innerWidth - 4; x += 8) {
          if (
            menuRect &&
            x >= menuRect.left &&
            x <= menuRect.right &&
            y >= menuRect.top &&
            y <= menuRect.bottom
          ) {
            continue
          }
          const target = document.elementFromPoint(x, y)
          if (!target?.closest("a,button,input,textarea,select,[role=button],[role=menuitem]")) {
            return { x, y }
          }
        }
      }
      return null
    })
    expect(outsidePoint).not.toBeNull()
    await page.touchscreen.tap(outsidePoint.x, outsidePoint.y)
    await expect(actionMenu(page)).toBeHidden()
    await expect(page).toHaveURL(/\/all$/)
    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    const markAsRead = page.getByRole("menuitem", { name: /Mark as read/i })
    const markAsReadBounds = await markAsRead.boundingBox()
    expect(markAsReadBounds).not.toBeNull()
    const menuHit = await page.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        return {
          insideMenu: Boolean(target?.closest(".mobile-action-menu")),
          menuItem: target?.closest(".mobile-action-menu [role=menuitem]")?.textContent ?? "",
        }
      },
      {
        x: markAsReadBounds.x + markAsReadBounds.width / 2,
        y: markAsReadBounds.y + markAsReadBounds.height / 2,
      },
    )
    expect(menuHit.insideMenu).toBe(true)
    expect(menuHit.menuItem).toMatch(/Mark as read/i)
    await page.touchscreen.tap(
      markAsReadBounds.x + markAsReadBounds.width / 2,
      markAsReadBounds.y + markAsReadBounds.height / 2,
    )
    await expect.poll(() => mock.readIds()).toContain(entryId)
    await expect(page).toHaveURL(/\/all$/)
  })

  test("CARD-QUICK-ACTIONS-01-10: touch mark-as-unread mutates only the synthetic entry", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    const card = cards(page).first()
    const entryId = Number(await card.getAttribute("data-entry-id"))
    const statusAll = page
      .getByRole("radiogroup", { name: "Filter articles by status" })
      .getByRole("radio", { name: "All" })
    await expect(statusAll).toBeChecked()
    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    await page.getByRole("menuitem", { name: /Mark as read/i }).tap()
    await expect.poll(() => mock.readIds()).toContain(entryId)
    await expect(page).toHaveURL(/\/all$/)
    await cardActions(page).tap()
    await page.getByRole("menuitem", { name: /Mark as unread/i }).tap()
    await expect.poll(() => mock.readIds()).not.toContain(entryId)
    await expect(page).toHaveURL(/\/all$/)
  })

  test("CARD-QUICK-ACTIONS-01-13: Chrome touch long press opens the context menu without navigation", async ({
    openApp,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    const card = cards(page).first()
    const bounds = await card.boundingBox()
    expect(bounds).not.toBeNull()
    const cdp = await page.context().newCDPSession(page)
    const point = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + Math.min(80, bounds.height / 2),
    }

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: point.x, y: point.y, force: 1 }],
    })
    await page.waitForTimeout(550)
    await expect(actionMenu(page)).toBeVisible()
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(page).toHaveURL(/\/all$/)
    await expect(actionMenu(page)).toBeVisible()
  })

  test("CARD-QUICK-ACTIONS-01-14: touch star and unstar stay on the card list", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    const entryId = Number(await cards(page).first().getAttribute("data-entry-id"))
    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    await tapMenuItemWithTouch(page, page.getByRole("menuitem", { name: /^Star$/i }))
    await expect
      .poll(async () => {
        const state = await mock.state()
        return state.starred
      })
      .toContain(entryId)
    await expect(page).toHaveURL(/\/all$/)

    await cardActions(page).tap()
    await expect(actionMenu(page)).toBeVisible()
    await tapMenuItemWithTouch(page, page.getByRole("menuitem", { name: /^Unstar$/i }))
    await expect
      .poll(async () => {
        const state = await mock.state()
        return state.starred
      })
      .not.toContain(entryId)
    await expect(page).toHaveURL(/\/all$/)
  })

  test("CARD-QUICK-ACTIONS-01-15: Chrome vertical touch scroll does not activate a card or menu", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 466,
      height: 614,
      touch: true,
      settings: { articleListLayout: "card", showStatus: "all" },
    })
    await mock.inject(10)
    await page.reload()
    const card = cards(page).first()
    const scrollArea = page.locator(".entry-list")
    await expect(card).toBeVisible()
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true)

    const scrollStart = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const scrollBounds = element.closest(".entry-list").getBoundingClientRect()
      const minY = Math.max(bounds.top + 24, scrollBounds.top + 24, 24)
      const y = Math.min(bounds.bottom - 24, scrollBounds.bottom - 24, innerHeight - 24)
      return {
        distance: Math.min(120, y - minY),
        x: bounds.x + bounds.width / 2,
        y,
      }
    })
    expect(scrollStart.distance).toBeGreaterThanOrEqual(40)
    const before = await scrollArea.evaluate((element) => element.scrollTop)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: scrollStart.x, y: scrollStart.y, force: 1 }],
    })
    const moveCount = Math.ceil(scrollStart.distance / 24)
    for (let step = 1; step <= moveCount; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 1,
            x: scrollStart.x,
            y: scrollStart.y - (scrollStart.distance * step) / moveCount,
            force: 1,
          },
        ],
      })
      await page.waitForTimeout(20)
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })

    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(before)
    await expect(page).toHaveURL(/\/all$/)
    await expect(actionMenu(page)).toBeHidden()
  })

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

    const primaryRun = await openApp({ path: "/all", settings: { articleListLayout: "card" } })
    const primaryLink = primaryRun.page
      .locator(".article-entry-card-shell > a.article-entry")
      .first()
    const primaryHref = await primaryLink.getAttribute("href")
    expect(primaryHref).toBeTruthy()
    expect(await primaryLink.evaluate((element) => element.tagName)).toBe("A")
    await primaryLink.focus()
    await primaryRun.page.keyboard.press("Enter")
    await expect(primaryRun.page).toHaveURL(new URL(primaryHref, primaryRun.page.url()).href)
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
