import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node ESM tests require explicit extension.
import { selectOpenAccessLocation } from "./open-access-location.js"

const doi = "10.1234/example"
const record = {
  doi,
  is_oa: true,
  best_oa_location: {
    host_type: "repository",
    version: "acceptedVersion",
    license: "cc-by",
    url_for_landing_page: "https://repository.example.org/item/123",
  },
}

test("exposes a licensed open repository landing page for the exact DOI", () => {
  assert.deepEqual(selectOpenAccessLocation(doi, record), {
    url: "https://repository.example.org/item/123",
    version: "acceptedVersion",
    license: "cc-by",
    hostType: "repository",
  })
})

test("does not accept a different work or closed record", () => {
  assert.equal(selectOpenAccessLocation("10.1234/other", record), null)
  assert.equal(selectOpenAccessLocation(doi, { ...record, is_oa: false }), null)
})

test("does not suggest copies with unknown license or version", () => {
  for (const patch of [{ license: null }, { license: "unknown" }, { version: "unknown" }]) {
    assert.equal(selectOpenAccessLocation(doi, {
      ...record, best_oa_location: { ...record.best_oa_location, ...patch },
    }), null)
  }
})

test("rejects absent landing page, non-HTTPS URL and credential-bearing URL", () => {
  for (const url of [null, "http://repository.example.org/item/123", "https://user@repository.example.org/item/123"]) {
    assert.equal(selectOpenAccessLocation(doi, {
      ...record, best_oa_location: { ...record.best_oa_location, url_for_landing_page: url },
    }), null)
  }
})
