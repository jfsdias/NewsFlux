import process from "node:process"

import createMockMiniflux from "./mock-miniflux.js"

const port = Number(process.env.E2E_API_PORT ?? 8081)
const mock = createMockMiniflux({ port })

await mock.listen()
console.log(`Synthetic Miniflux listening on http://127.0.0.1:${port}`)

const stop = async () => {
  await mock.close()
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
