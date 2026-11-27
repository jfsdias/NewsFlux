// Create a local, offline gallery of the synthetic screenshot artifacts.
import { readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import console from "node:console"

const root = path.resolve(process.argv[2] ?? "test-results/nf-qa01-visual")
const files = []
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(entryPath)
    else if (entry.name.endsWith(".png")) files.push(entryPath)
  }
}
walk(root)
const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const rows = files
  .toSorted((a, b) => a.split("/").at(-1).localeCompare(b.split("/").at(-1)))
  .map((file) => {
    const name = file.split("/").at(-1)
    const url = path
      .relative(root, file)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")
    return `<figure><figcaption>${escape(name)}</figcaption><a href="${url}"><img src="${url}" alt="${escape(name)}"></a></figure>`
  })
writeFileSync(
  path.join(root, "gallery.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>NF-QA01 visual evidence</title><style>body{background:#ddd;color:#111;font:16px system-ui;margin:16px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;background:#fff;padding:8px;overflow:hidden}figcaption{overflow-wrap:anywhere;margin-bottom:6px}img{display:block;width:100%;height:440px;object-fit:contain;object-position:top}</style><h1>NF-QA01 — ${files.length} synthetic screenshots</h1><main>${rows.join("")}</main></html>`,
)
console.log(`GALLERY=PASS SCREENSHOTS=${files.length}`)
