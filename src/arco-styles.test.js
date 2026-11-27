import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const srcDir = path.dirname(fileURLToPath(import.meta.url))
const arcoEsDir = path.join(srcDir, "../node_modules/@arco-design/web-react/es")
const ARCO_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"@arco-design\/web-react"/g
const ARCO_CLASS = /\barco-([a-z]+)/g
const STYLE_IMPORT =
  /import\s+["'](?:@arco-design\/web-react\/es\/|(?:\.\.\/)+)([^/"']+)\/style\/css(?:\.js)?["']/g

const listSourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath)
    }
    return /\.(?:jsx?|css)$/.test(entry.name) && !entry.name.includes(".test.") ? [entryPath] : []
  })

// Components whose stylesheet is loaded by src/arco-styles.js, including their own dependencies.
const collectLoadedComponents = () => {
  const loaded = new Set()
  const visit = (file) => {
    for (const [, component] of readFileSync(file, "utf8").matchAll(STYLE_IMPORT)) {
      if (!loaded.has(component.toLowerCase())) {
        loaded.add(component.toLowerCase())
        visit(path.join(arcoEsDir, component, "style/css.js"))
      }
    }
  }
  visit(path.join(srcDir, "arco-styles.js"))
  return loaded
}

test("ARCO_STYLES_COVER_EVERY_COMPONENT_USED_BY_NAME_OR_CLASS", () => {
  const arcoComponents = new Set(
    readdirSync(arcoEsDir)
      // Some components (Icon, Portal) ship an empty stylesheet because the base tokens cover them.
      .filter((name) => {
        const stylePath = path.join(arcoEsDir, name, "style/css.js")
        return existsSync(stylePath) && statSync(stylePath).size > 0
      })
      .map((name) => name.toLowerCase()),
  )
  const used = new Set()
  for (const file of listSourceFiles(srcDir)) {
    if (file.endsWith("arco-styles.js")) {
      continue
    }
    const source = readFileSync(file, "utf8")
    for (const [, names] of source.matchAll(ARCO_IMPORT)) {
      for (const name of names.split(",")) {
        used.add(
          name
            .trim()
            .split(/\s+as\s+/, 1)[0]
            .toLowerCase(),
        )
      }
    }
    // Markup and overrides that hard-code Arco class names depend on that component's stylesheet.
    for (const [, name] of source.matchAll(ARCO_CLASS)) {
      used.add(name)
    }
  }

  const loaded = collectLoadedComponents()
  const missing = [...used].filter((name) => arcoComponents.has(name) && !loaded.has(name))
  assert.deepEqual(missing, [], `Add these Arco components to src/arco-styles.js: ${missing}`)
})
