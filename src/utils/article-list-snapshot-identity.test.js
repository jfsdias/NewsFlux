import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions
import createArticleListSnapshotIdentity from "./article-list-snapshot-identity.js"

const content = {
  articleListRevision: 0,
  filterDate: null,
  filterString: "",
  infoFrom: "all",
  infoId: null,
}

const settings = {
  orderBy: "published_at",
  orderDirection: "desc",
  pageSize: 20,
  showHiddenFeeds: false,
  showStatus: "unread",
}

const identity = (overrides = {}) =>
  createArticleListSnapshotIdentity({
    content: { ...content, ...overrides.content },
    settings: { ...settings, ...overrides.settings },
    info: overrides.info,
    sessionRevision: overrides.sessionRevision ?? 3,
  })

test("refresh revisions reuse the same same-session, same-query snapshot identity", () => {
  assert.equal(identity(), identity({ content: { articleListRevision: 8 } }))
  assert.equal(
    createArticleListSnapshotIdentity({
      content: { ...content, infoId: null },
      settings,
      info: { from: "all", id: undefined },
      sessionRevision: 3,
    }),
    identity(),
  )
  assert.equal(
    createArticleListSnapshotIdentity({
      content: { ...content, infoId: null },
      settings,
      info: { from: "all", id: "" },
      sessionRevision: 3,
    }),
    identity(),
  )
  assert.equal(
    createArticleListSnapshotIdentity({
      content: { ...content, infoFrom: "feed", infoId: 7 },
      settings,
      info: { from: "feed", id: "7" },
      sessionRevision: 3,
    }),
    createArticleListSnapshotIdentity({
      content: { ...content, infoFrom: "feed", infoId: "7" },
      settings,
      info: { from: "feed", id: 7 },
      sessionRevision: 3,
    }),
  )
})

test("snapshot identity changes when the source, feed, category, query or date changes", () => {
  const baseline = identity()

  for (const overrides of [
    { content: { infoFrom: "feed", infoId: 1 }, info: { from: "feed", id: 1 } },
    { content: { infoFrom: "feed", infoId: 2 }, info: { from: "feed", id: 2 } },
    { content: { infoFrom: "category", infoId: 1 }, info: { from: "category", id: 1 } },
    { content: { filterString: "news" } },
    { content: { filterDate: "2026-11-05" } },
  ]) {
    assert.notEqual(identity(overrides), baseline)
  }
})

test("snapshot identity changes when status, ordering or page composition settings change", () => {
  const baseline = identity()

  for (const overrides of [
    { settings: { showStatus: "all" } },
    { settings: { orderBy: "changed_at" } },
    { settings: { orderDirection: "asc" } },
    { settings: { pageSize: 40 } },
    { settings: { removeDuplicates: "hash" } },
    { settings: { showHiddenFeeds: true } },
  ]) {
    assert.notEqual(identity(overrides), baseline)
  }
})

test("snapshot identity changes with session revision and never applies to Home", () => {
  assert.notEqual(identity(), identity({ sessionRevision: 4 }))
  assert.equal(
    createArticleListSnapshotIdentity({
      content: { ...content, infoFrom: "home" },
      settings,
      info: { from: "home", id: null },
      sessionRevision: 3,
    }),
    null,
  )
})
