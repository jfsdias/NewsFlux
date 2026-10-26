import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

test("Story Identity isolation: All, Unread, Starred, ArticleDetail, Search never import story-identity", () => {
  const isolatedFiles = [
    "src/components/Article/ArticleList.jsx",
    "src/components/Article/ArticleDetail.jsx",
    "src/components/Article/ArticleItem.jsx",
    "src/components/Article/ArticleCard.jsx",
    "src/components/Article/ArticleTable.jsx",
    "src/components/Content/Content.jsx",
    "src/components/Sidebar/Sidebar.jsx",
  ]

  for (const relativePath of isolatedFiles) {
    const fullPath = path.resolve(relativePath)
    if (!fs.existsSync(fullPath)) {
      continue
    }

    const content = fs.readFileSync(fullPath, "utf8")
    assert.ok(
      !content.includes("story-identity"),
      `File ${relativePath} must NOT import story-identity (isolation violation)`,
    )
    assert.ok(
      !content.includes("applyStoryProjection"),
      `File ${relativePath} must NOT use applyStoryProjection`,
    )
    assert.ok(
      !content.includes("StoryRequestController"),
      `File ${relativePath} must NOT use StoryRequestController`,
    )
  }
})

test("Story Identity integration is strictly limited to Home surface", () => {
  // Check that only Home-related components import useHomeStoryProjection
  const srcDir = path.resolve("src")
  const matchingFiles = []

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== ".git") {
          scan(full)
        }
      } else if (ent.isFile() && (ent.name.endsWith(".jsx") || ent.name.endsWith(".js"))) {
        // Skip story-identity folder itself and tests
        if (full.includes("story-identity") || full.endsWith(".test.js")) {
          continue
        }
        const text = fs.readFileSync(full, "utf8")
        if (text.includes("story-identity")) {
          matchingFiles.push(path.relative(srcDir, full))
        }
      }
    }
  }

  scan(srcDir)

  // Matching files must ONLY be under components/Home/
  for (const f of matchingFiles) {
    assert.ok(f.startsWith("components/Home/"), `Story Identity was imported outside of Home: ${f}`)
  }
  assert.equal(matchingFiles.length, 1)
  assert.equal(matchingFiles[0], "components/Home/HomeRecent.jsx")
})
