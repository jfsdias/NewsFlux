/* global fetch, console */
/* eslint-disable unicorn/no-await-expression-member, unicorn/prevent-abbreviations -- Local-only test harness. */
import process from "node:process"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

const binary = process.env.PILOT_CADDY_BINARY
if (!binary) throw new Error("PILOT_CADDY_BINARY is required")
const dir = await mkdtemp(path.join(os.tmpdir(), "newsflux-caddy-test-"))
const upstream = http.createServer((request, res) => {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ path: request.url, protocol: request.headers["x-forwarded-proto"] }))
})
await new Promise((resolve) => upstream.listen(18_889, "127.0.0.1", resolve))
const config = (await readFile("deploy/article-intel-pilot/Caddyfile", "utf8"))
  .replace(":2000", ":18890")
  .replace("summary-api:8788", "127.0.0.1:18889")
await writeFile(path.join(dir, "Caddyfile"), config)
const proc = spawn(
  binary,
  ["run", "--config", path.join(dir, "Caddyfile"), "--adapter", "caddyfile"],
  {
    env: { ...process.env, NEWSFLUX_PILOT_TRUSTED_PROXY_IP: "127.0.0.1" },
    stdio: "ignore",
  },
)
try {
  let ready = false
  for (let index = 0; index < 100 && !ready; index += 1) {
    try {
      await fetch("http://127.0.0.1:18890/api/ai/other")
      ready = true
    } catch {
      await sleep(50)
    }
  }
  assert.ok(ready)
  const route = "http://127.0.0.1:18890/api/ai/v1/entries/501/summary"
  const untrustedResponse = await fetch("http://[::1]:18890/api/ai/v1/entries/501/summary", {
    method: "POST",
    headers: { "X-Forwarded-Proto": "https" },
  })
  assert.equal(untrustedResponse.status, 403)
  assert.equal((await fetch(route, { method: "POST" })).status, 403)
  const response = await fetch(route, { method: "POST", headers: { "X-Forwarded-Proto": "https" } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    path: "/api/ai/v1/entries/501/summary",
    protocol: "https",
  })
  assert.equal(
    (
      await fetch("http://127.0.0.1:18890/api/ai/admin", {
        headers: { "X-Forwarded-Proto": "https" },
      })
    ).status,
    403,
  )
  console.log("CADDY_ROUTE=PASS")
} finally {
  proc.kill("SIGTERM")
  upstream.close()
  await rm(dir, { recursive: true, force: true })
}
