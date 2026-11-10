import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { mkdir, writeFile } from "node:fs/promises"

const sourceRoot = process.env.NEWSFLUX_SOURCE_ROOT
const outputRoot = process.env.NEWSFLUX_OUTPUT_ROOT
const origin = process.env.NEWSFLUX_APP_ORIGIN
const minifluxBase = process.env.NEWSFLUX_MINIFLUX_BASE_URL
const userKey = process.env.NEWSFLUX_TEST_USER_KEY
const rotatedKey = process.env.NEWSFLUX_TEST_ROTATED_KEY
const ingressIp = process.env.NEWSFLUX_INGRESS_IP
assert.ok(sourceRoot && outputRoot && origin && minifluxBase && userKey && rotatedKey && ingressIp)

const requireFromSource = createRequire(path.join(sourceRoot, "package.json"))
const { chromium, expect } = requireFromSource("@playwright/test")
await mkdir(outputRoot, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: [`--host-resolver-rules=MAP newsflux.test ${ingressIp}`],
})
const browserVersion = browser.version()
const recoveryRequests = []
const pageErrors = []

async function createReader({ entryId, width, height, touch }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: touch,
    hasTouch: touch,
    colorScheme: width < 600 ? "light" : "dark",
    serviceWorkers: "block",
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      "X-Forwarded-Proto": "http",
      "X-Forwarded-For": "198.51.100.77",
      Forwarded: "for=198.51.100.77;proto=http",
    },
  })
  await context.addInitScript(
    ({ server, token }) => {
      globalThis.localStorage.setItem(
        "auth",
        JSON.stringify({ server, token, apiKeyId: undefined, username: "", password: "" }),
      )
      globalThis.localStorage.setItem(
        "settings",
        JSON.stringify({ markReadBy: "manually", language: "en-US" }),
      )
    },
    { server: minifluxBase, token: userKey },
  )
  const page = await context.newPage()
  page.on("request", (request) => {
    const url = new globalThis.URL(request.url())
    if (url.pathname.includes("/api/content-fallback/reader/v1/entries/")) {
      recoveryRequests.push({ method: request.method(), pathname: url.pathname })
    }
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.goto(origin + "/all/entry/" + entryId, { waitUntil: "domcontentloaded" })
  await expect(page.getByText("Synthetic story " + entryId).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /recover full text/i })).toBeVisible()
  return { context, page }
}

async function fixtureState(page) {
  const response = await page.request.get(origin + "/miniflux/__harness__/state")
  assert.equal(response.status(), 200)
  return response.json()
}

try {
  const small = await createReader({ entryId: 501, width: 390, height: 844, touch: true })
  const beforeSmallAction = await fixtureState(small.page)
  assert.equal(
    beforeSmallAction.reader_recovery_gets.includes("/v1/entries/501/fetch-content"),
    false,
  )
  assert.equal(recoveryRequests.length, 0, "Reader recovery must be explicit")
  const buttonBox = await small.page
    .getByRole("button", { name: /recover full text/i })
    .boundingBox()
  assert.ok(buttonBox && buttonBox.width > 0 && buttonBox.height > 0)
  assert.ok(buttonBox.x >= 0 && buttonBox.y >= 0)
  assert.ok(buttonBox.x + buttonBox.width <= 390 && buttonBox.y + buttonBox.height <= 844)

  await small.page.screenshot({
    path: path.join(outputRoot, "reader-before-recovery-390x844.png"),
    animations: "disabled",
  })
  await small.page.getByRole("button", { name: /recover full text/i }).tap()
  await expect(
    small.page.getByText("Full text recovered with Miniflux scraper", { exact: true }),
  ).toBeVisible()
  await expect(
    small.page.getByText("Synthetic recovered paragraph for isolated Reader validation").first(),
  ).toBeVisible()
  await expect(small.page.locator(".article-body script")).toHaveCount(0)
  assert.equal(new globalThis.URL(small.page.url()).origin, origin)
  assert.equal(await small.page.evaluate(() => globalThis.__unsafe_fixture_script === true), false)
  const successPath = recoveryRequests.find(({ pathname }) => pathname.includes("/501/"))
  assert.deepEqual(successPath, {
    method: "POST",
    pathname: "/api/content-fallback/reader/v1/entries/501/recover",
  })
  const afterSmallAction = await fixtureState(small.page)
  assert.deepEqual(afterSmallAction.writes, [])
  assert.deepEqual(afterSmallAction.read_ids, [])
  assert.ok(afterSmallAction.unread_ids.includes(501))
  assert.ok(afterSmallAction.starred_ids.includes(501))
  assert.equal(afterSmallAction.real_wallhop_requests, 0)
  await small.page.screenshot({
    path: path.join(outputRoot, "reader-recovered-390x844.png"),
    animations: "disabled",
  })
  await small.context.close()

  const large = await createReader({ entryId: 502, width: 884, height: 1104, touch: false })
  await expect(large.page.getByText("Original teaser 502", { exact: false })).toBeVisible()
  await large.page.getByRole("button", { name: /recover full text/i }).click()
  await expect(
    large.page.getByText("Full text could not be recovered. The original content is still shown.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(large.page.getByText("Original teaser 502", { exact: false })).toBeVisible()
  await expect(
    large.page.getByText("Synthetic recovered paragraph for isolated Reader validation"),
  ).toHaveCount(0)
  await large.page.screenshot({
    path: path.join(outputRoot, "reader-original-fallback-884x1104.png"),
    animations: "disabled",
  })
  const afterFailure = await fixtureState(large.page)
  assert.deepEqual(afterFailure.writes, [])
  assert.deepEqual(afterFailure.read_ids, [])
  assert.ok(afterFailure.unread_ids.includes(502))
  assert.ok(afterFailure.starred_ids.includes(502))
  await large.context.close()

  const stale = await createReader({ entryId: 503, width: 390, height: 844, touch: true })
  const pendingRecovery = stale.page.waitForRequest((request) =>
    new globalThis.URL(request.url()).pathname.endsWith("/reader/v1/entries/503/recover"),
  )
  const completedRecovery = stale.page.waitForResponse((response) =>
    new globalThis.URL(response.url()).pathname.endsWith("/reader/v1/entries/503/recover"),
  )
  await stale.page.getByRole("button", { name: /recover full text/i }).tap()
  await pendingRecovery
  const previousAuth = await stale.page.evaluate(() => globalThis.localStorage.getItem("auth"))
  const nextAuth = JSON.stringify({
    server: minifluxBase,
    token: rotatedKey,
    apiKeyId: undefined,
    username: "",
    password: "",
  })
  await stale.page.evaluate(
    ({ oldValue, newValue }) => {
      globalThis.localStorage.setItem("auth", newValue)
      globalThis.dispatchEvent(
        new globalThis.StorageEvent("storage", {
          key: "auth",
          oldValue,
          newValue,
          storageArea: globalThis.localStorage,
        }),
      )
    },
    { oldValue: previousAuth, newValue: nextAuth },
  )
  await expect
    .poll(() =>
      stale.page.evaluate(() => JSON.parse(globalThis.localStorage.getItem("auth") ?? "{}").token),
    )
    .toBe(rotatedKey)
  const staleResponse = await completedRecovery
  assert.equal(staleResponse.status(), 200)
  await expect(
    stale.page.getByText("Full text recovered with Miniflux scraper", { exact: true }),
  ).toHaveCount(0)
  await expect(
    stale.page.getByText("Synthetic recovered paragraph for isolated Reader validation"),
  ).toHaveCount(0)
  const afterStaleSession = await fixtureState(stale.page)
  assert.deepEqual(afterStaleSession.writes, [])
  assert.ok(afterStaleSession.unread_ids.includes(503))
  assert.ok(afterStaleSession.starred_ids.includes(503))
  await stale.context.close()

  assert.deepEqual(pageErrors, [], "Unexpected browser exceptions: " + pageErrors.join(" | "))
  const receipt = {
    browser: "Chromium",
    browserVersion,
    origin,
    tlsErrorsIgnored: false,
    viewportCssPixels: ["390x844", "884x1104"],
    deviceScaleFactor: 2,
    readerAction: "PASS",
    providerFailurePreservedOriginal: "PASS",
    staleSessionResponseSuppressed: "PASS",
    readStarUnchanged: "PASS",
    minifluxWrites: 0,
    realWallHopRequests: 0,
    screenshots: [
      "reader-before-recovery-390x844.png",
      "reader-recovered-390x844.png",
      "reader-original-fallback-884x1104.png",
    ],
  }
  await writeFile(
    path.join(outputRoot, "browser-receipt.json"),
    JSON.stringify(receipt, undefined, 2) + "\n",
  )
  process.stdout.write("READER_BROWSER_GATE=PASS\n")
  process.stdout.write("ORIGINAL_FALLBACK=PASS\n")
  process.stdout.write("SESSION_PROTECTION=PASS\n")
  process.stdout.write("MINIFLUX_WRITES=0\n")
  process.stdout.write("REAL_WALLHOP_REQUESTS=0\n")
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const summary = message.split(/\r?\n/).slice(0, 8).join(" | ").slice(0, 1000)
  process.stderr.write(`READER_BROWSER_FAILURE=${summary}\n`)
  throw error
} finally {
  await browser.close()
}
