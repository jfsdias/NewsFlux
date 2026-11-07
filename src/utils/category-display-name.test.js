import assert from "node:assert/strict"
import test from "node:test"

const { default: formatCategoryDisplayName } = await import(
  new URL("category-display-name.js", import.meta.url)
)
const { createHomeCategoryLanes } = await import(
  new URL("home-category-projection.js", import.meta.url)
)

test("removes a supported editorial ordinal independently of the category id", () => {
  assert.equal(formatCategoryDisplayName({ id: 5, title: "13 · Viagem" }), "Viagem")
  assert.equal(formatCategoryDisplayName({ id: 13, title: "13 · Viagem" }), "Viagem")
  assert.equal(
    formatCategoryDisplayName({ id: "46", title: "14 · Notícias & Atualidades" }),
    "Notícias & Atualidades",
  )
})

test("preserves names without the confirmed prefix pattern", () => {
  assert.equal(formatCategoryDisplayName({ id: 13, title: "Travel" }), "Travel")
  assert.equal(
    formatCategoryDisplayName({ id: 13, title: "13 things to know" }),
    "13 things to know",
  )
  assert.equal(
    formatCategoryDisplayName({ id: 13, title: "2026 · Election coverage" }),
    "2026 · Election coverage",
  )
  assert.equal(formatCategoryDisplayName({ id: 13, title: "100 · Travel" }), "100 · Travel")
})

test("preserves empty and invalid category names safely", () => {
  assert.equal(formatCategoryDisplayName({ id: 13, title: "" }), "")
  assert.equal(formatCategoryDisplayName({ id: 13, title: " ".repeat(3) }), " ".repeat(3))
  assert.equal(formatCategoryDisplayName({ id: 13, title: null }), "")
  assert.equal(formatCategoryDisplayName(null), "")
})

test("formats only the display value without mutating source metadata", () => {
  const category = { id: 5, title: "13 · Viagem", userDefined: true }
  const originalMetadata = JSON.stringify(category)

  assert.equal(formatCategoryDisplayName(category), "Viagem")
  assert.equal(JSON.stringify(category), originalMetadata)
  assert.deepEqual(category, { id: 5, title: "13 · Viagem", userDefined: true })
})

test("does not use formatted-name collisions as category identity", () => {
  const entries = [
    {
      id: 1,
      feed: { category: { id: 39, title: "13 · News" } },
      status: "unread",
      published_at: "2026-11-01T00:00:00Z",
    },
    {
      id: 2,
      feed: { category: { id: 39, title: "13 · News" } },
      status: "unread",
      published_at: "2026-11-01T00:00:00Z",
    },
    {
      id: 3,
      feed: { category: { id: 46, title: "14 · News" } },
      status: "unread",
      published_at: "2026-11-01T00:00:00Z",
    },
    {
      id: 4,
      feed: { category: { id: 46, title: "14 · News" } },
      status: "unread",
      published_at: "2026-11-01T00:00:00Z",
    },
  ]
  const lanes = createHomeCategoryLanes({
    entries,
    highlightIds: [],
    recentIds: [1, 2, 3, 4],
  })

  assert.deepEqual(
    lanes.map((lane) => [
      lane.categoryId,
      formatCategoryDisplayName({ id: lane.categoryId, title: lane.categoryTitle }),
    ]),
    [
      [39, "News"],
      [46, "News"],
    ],
  )
})
