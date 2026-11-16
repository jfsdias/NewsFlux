import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("Reader exposes explicit WallHop external action only for safe URLs", async () => {
  const source = await read("src/components/Article/ActionButtons.jsx")
  assert.match(source, /buildWallhopExternalUrl\(activeContent\?\.url\)/u)
  assert.match(source, /wallhopExternalUrl && \(/u)
  assert.match(source, /key="open-with-wallhop"/u)
  assert.match(source, /onClick=\{handleOpenViaWallhop\}/u)
})

test("opening external WallHop requires explicit consent and no referrer", async () => {
  const source = await read("src/components/Article/ActionButtons.jsx")
  assert.match(
    source,
    /globalThis\.confirm\(polyglot\.t\("article_card\.wallhop_external_consent"\)\)/u,
  )
  assert.match(
    source,
    /globalThis\.open\(wallhopExternalUrl, "_blank", "noopener,noreferrer"\)/u,
  )
  assert.doesNotMatch(source, /useEffect\([^)]*wallhopExternalUrl/su)
})

test("external WallHop action and consent are localized in every shipped locale", async () => {
  for (const locale of ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]) {
    const phrases = JSON.parse(await read(`src/locales/${locale}.json`))
    for (const key of ["open_with_wallhop", "wallhop_external_consent"]) {
      assert.equal(typeof phrases.article_card?.[key], "string", `${locale} missing ${key}`)
      assert.ok(phrases.article_card[key].trim(), `${locale} empty ${key}`)
    }
  }
})
