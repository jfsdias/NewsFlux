import { expect, test } from "./support/fixtures.js"

for (const width of [466, 884]) {
  test(`NF-READING-3-${width}: reversible presentation`, async ({ openApp, mock }) => {
    const { page, context, errors } = await openApp({
      path: null,
      width,
      height: 1104,
      touch: true,
      settings: { markReadBy: "manually" },
    })
    const entry = await mock.json("/v1/entries/1")
    const body = [
      '<section data-testid="presentation-prose">',
      "<h2>Editorial heading</h2>",
      "<p>Visible lead with <strong>inline emphasis</strong>.</p>",
      "<ul><li>First item</li><li>Second item</li></ul>",
      "<blockquote>Visible quotation.</blockquote>",
      "<p hidden>Synthetic visibility marker.</p>",
      "</section>",
      "<table><tbody><tr><td>Table value</td></tr></tbody></table>",
    ].join("")
    await context.route(`${mock.url}/v1/entries/1`, (route) =>
      route.fulfill({ json: { ...entry, content: body } }),
    )
    await page.goto("/all/entry/1")
    const toggle = page.getByRole("button", { name: "Optimized reading" })
    const article = page.locator(".article-body")
    const prose = page.getByTestId("presentation-prose")
    const marker = prose.locator("[hidden]")
    const lead = prose.locator("p").first()
    await expect(prose).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await expect(marker).toBeHidden()
    const markup = await prose.innerHTML()
    const lineHeight = () =>
      lead.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight))
    const originalLeading = await lineHeight()

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-pressed", "true")
    await expect(article).toHaveClass(/article-body--optimized/)
    await expect.poll(lineHeight).toBeGreaterThan(originalLeading)
    expect(await prose.innerHTML()).toBe(markup)
    await expect(marker).toBeHidden()
    await expect(article.getByText("Table value")).toBeVisible()
    expect(await article.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await expect(article).not.toHaveClass(/article-body--optimized/)
    await expect.poll(lineHeight).toBe(originalLeading)
    expect(await prose.innerHTML()).toBe(markup)
    await expect(marker).toBeHidden()

    await toggle.click()
    await page.goto("/all/entry/2")
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(await mock.mutations()).toEqual([])
    expect(errors).toEqual([])
  })
}
