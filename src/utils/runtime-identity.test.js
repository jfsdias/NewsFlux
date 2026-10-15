import test from "node:test"
import assert from "node:assert/strict"

import {
  PRODUCT_GITHUB_REPO_PATH,
  PRODUCT_NAME,
  UPSTREAM_GITHUB_REPO_PATH,
  UPSTREAM_NAME,
} from "./constants.js"
import { applyRuntimeProductIdentity } from "./product-identity.js"
import { shouldNotifyProductUpdate } from "./update-check.js"

test("exposes separate NewsFlux product and ReactFlux upstream identities", () => {
  assert.equal(PRODUCT_NAME, "NewsFlux")
  assert.equal(PRODUCT_GITHUB_REPO_PATH, "jfsdias/NewsFlux")
  assert.equal(UPSTREAM_NAME, "ReactFlux")
  assert.equal(UPSTREAM_GITHUB_REPO_PATH, "electh/ReactFlux")
})

test("brands nested runtime phrases without mutating the locale source", () => {
  const source = {
    compatibility: {
      description: "ReactFlux requires Miniflux %{minimumVersion} or newer.",
    },
    article: {
      tooltip: "Open in ReactFlux",
    },
    untouched: "Miniflux",
  }

  const branded = applyRuntimeProductIdentity(source)

  assert.deepEqual(branded, {
    compatibility: {
      description: "NewsFlux requires Miniflux %{minimumVersion} or newer.",
    },
    article: {
      tooltip: "Open in NewsFlux",
    },
    untouched: "Miniflux",
  })
  assert.equal(source.article.tooltip, "Open in ReactFlux")
})

test("suppresses a main advance that only changes docs", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 1,
      files: [{ filename: "docs/NEWSFLUX_PROJECT_STATE.md" }],
    }),
    false,
  )
})

test("reports a main advance that includes runtime code", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 2,
      files: [
        { filename: "docs/NEWSFLUX_PROJECT_STATE.md" },
        { filename: "src/App.jsx" },
      ],
    }),
    true,
  )
})

test("fails open to update notification at the GitHub compare file cap", () => {
  assert.equal(
    shouldNotifyProductUpdate({
      status: "ahead",
      ahead_by: 1,
      files: Array.from({ length: 300 }, (_, index) => ({ filename: `docs/${index}.md` })),
    }),
    true,
  )
})

test("does not notify when main is not ahead of the build", () => {
  for (const status of ["identical", "behind", "diverged"]) {
    assert.equal(
      shouldNotifyProductUpdate({ status, ahead_by: 0, files: [{ filename: "src/App.jsx" }] }),
      false,
    )
  }
})
