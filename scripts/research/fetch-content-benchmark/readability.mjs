import { readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

const fixtures = JSON.parse(readFileSync(0, "utf8"))
// Only the locally authored fixtures from benchmark.py; no URLs or resource loading.
const results = fixtures.map((html) => {
  const outputs = []
  const elapsed = []
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now()
    const dom = new JSDOM(html)
    const article = new Readability(dom.window.document, { disableJSONLD: true }).parse()
    outputs.push(article?.content ?? "")
    dom.window.close()
    elapsed.push(performance.now() - start)
  }
  return {
    html: outputs[0],
    deterministic: outputs.every((output) => output === outputs[0]),
    median_ms: Number(elapsed.sort((a, b) => a - b)[2].toFixed(3)),
  }
})
process.stdout.write(JSON.stringify(results))
