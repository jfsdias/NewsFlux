import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node ESM tests require explicit extension.
import getExplicitArticleDoi from "./article-doi.js"

test("uses an explicit canonical DOI link without changing the identifier", () => {
  assert.equal(
    getExplicitArticleDoi("https://doi.org/10.1234/Article.2026"),
    "10.1234/Article.2026",
  )
})

test("does not infer a DOI from publisher paths or arbitrary URLs", () => {
  for (const url of [
    "https://publisher.example/doi/10.1234/example",
    "https://doi.org.example/10.1234/example",
    "https://example.org/10.1234/example",
    "10.1234/example",
    null,
  ]) {
    assert.equal(getExplicitArticleDoi(url), null)
  }
})

test("rejects ambiguous or malformed canonical links", () => {
  for (const url of [
    // eslint-disable-next-line unicorn/prefer-https -- intentionally rejects insecure input.
    "http://doi.org/10.1234/example",
    "https://doi.org/10.1234/",
    "https://doi.org/10.1234/example?redirect=1",
    "https://doi.org/10.1234/example#fragment",
    "https://user@doi.org/10.1234/example",
    "https://doi.org:443/10.1234/example",
    "https://doi.org/10.1234/../example",
  ]) {
    assert.equal(getExplicitArticleDoi(url), null)
  }
})
