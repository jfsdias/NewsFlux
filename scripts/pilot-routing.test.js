import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")

test("pilot AI route requires the trusted TLS proxy and fails closed for other AI paths", async () => {
  const config = await read("deploy/article-intel-pilot/Caddyfile")
  assert.match(config, /remote_ip \{\$NEWSFLUX_PILOT_TRUSTED_PROXY_IP\}/u)
  assert.match(config, /header X-Forwarded-Proto https/u)
  assert.match(config, /path \/api\/ai\/v1\/entries\/\*\/summary/u)
  assert.match(config, /reverse_proxy summary-api:8788/u)
  assert.match(config, /header_up X-Forwarded-Proto https/u)
  assert.match(config, /handle \/api\/ai\/\*\s*\{\s*respond 403/u)
})

test("image build retains default-off and explicitly exposes the pilot build flag", async () => {
  const dockerfile = await read("Dockerfile")
  assert.match(dockerfile, /ARG VITE_ARTICLE_INTELLIGENCE_ENABLED=0/u)
  assert.match(dockerfile, /VITE_ARTICLE_INTELLIGENCE_ENABLED=\$VITE_ARTICLE_INTELLIGENCE_ENABLED/u)
})
