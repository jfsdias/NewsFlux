import process from "node:process"

import { test as base } from "@playwright/test"

export { expect } from "@playwright/test"

const MOCK_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8081}`

const control = async (path) => {
  const response = await fetch(`${MOCK_URL}${path}`)
  return response.json()
}

const seedAuth = ({ server, apiKeyId = null }) => {
  localStorage.setItem(
    "auth",
    JSON.stringify({ server, token: "e2e-token", apiKeyId, username: "", password: "" }),
  )
}

const createMockClient = () => ({
  url: MOCK_URL,
  reset: () => control("/__e2e/reset"),
  fault: (target, kind) => control(`/__e2e/fault?target=${target}&kind=${kind}`),
  mode: (mode) => control(`/__e2e/mode?mode=${mode}`),
  inject: (count = 3) => control(`/__e2e/inject?count=${count}`),
  state: async () => {
    const body = await control("/__e2e/state")
    return body.state
  },
  readIds: async () => {
    const body = await control("/__e2e/state")
    return body.state.read
  },
  requests: async () => {
    const body = await control("/__e2e/state")
    return body.state.hits
  },
  mutations: async () => {
    const body = await control("/__e2e/state")
    return body.state.mutations
  },
  json: async (path) => {
    const response = await fetch(`${MOCK_URL}${path}`)
    return response.json()
  },
})

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  mock: async ({}, use) => {
    const client = createMockClient()
    await client.reset()
    await use(client)
    await client.reset()
  },

  openApp: async ({ browser, baseURL, mock }, use) => {
    const contexts = []

    const open = async ({
      path = "/",
      width = 884,
      height = 1104,
      touch = false,
      authenticated = true,
      provisionedApiKey = false,
      serviceWorkers = "block",
      deviceScaleFactor = 2,
      storageState,
      settings,
    } = {}) => {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height },
        deviceScaleFactor,
        hasTouch: touch,
        isMobile: touch && width < 1000,
        colorScheme: "dark",
        serviceWorkers,
        storageState,
      })
      contexts.push(context)
      if (authenticated) {
        await context.addInitScript(seedAuth, {
          server: mock.url,
          apiKeyId: provisionedApiKey ? 17 : null,
        })
      }
      if (settings) {
        await context.addInitScript((value) => {
          localStorage.setItem("settings", JSON.stringify(value))
        }, settings)
      }
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      if (path) {
        await page.goto(path)
      }
      return { context, page, errors }
    }

    await use(open)
    await Promise.all(contexts.map((context) => context.close()))
  },
})
