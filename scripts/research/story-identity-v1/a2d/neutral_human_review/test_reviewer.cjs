/* eslint-disable unicorn/filename-case, unicorn/prevent-abbreviations, unicorn/consistent-function-scoping, unicorn/no-this-outside-of-class, unicorn/no-null */
/* global __dirname, Blob, console */
const assert = require("node:assert/strict")
const test = require("node:test")
const vm = require("node:vm")
const fs = require("node:fs")
const path = require("node:path")
const template = fs.readFileSync(path.join(__dirname, "reviewer_template.html"), "utf8")
const labels = "SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN"
const rows = Array.from({ length: 40 }, (_, i) => ({
  annotation_id: `R${String(i + 1).padStart(3, "0")}`,
  feed_a: "Feed A",
  feed_b: "Feed B",
  title_a: `A ${i}`,
  title_b: `B ${i}`,
  published_at_a: "2026-01-01",
  published_at_b: "2026-01-02",
  label_options: labels,
  human_decision: "",
}))
function setup(existing = {}) {
  const elements = new Map(),
    listeners = {},
    memory = { ...existing }
  function element() {
    return {
      children: [],
      disabled: false,
      textContent: "",
      files: [],
      value: "",
      addEventListener(name, fn) {
        this[name] = fn
      },
      append(...items) {
        this.children.push(...items)
      },
      replaceChildren(...items) {
        this.children = items
      },
      setAttribute(k, v) {
        this[k] = v
      },
      click() {
        if (this.clickFn) this.clickFn()
      },
    }
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element())
      return elements.get(id)
    },
    createElement: element,
    addEventListener(n, f) {
      listeners[n] = f
    },
  }
  const localStorage = {
    getItem(k) {
      return memory[k] || null
    },
    setItem(k, v) {
      memory[k] = v
    },
  }
  const context = vm.createContext({
    document,
    localStorage,
    confirm: () => false,
    Blob,
    URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL() {} },
    setTimeout() {},
    console,
  })
  const html = template
    .replace("__DATA__", JSON.stringify(rows))
    .replace("__STORAGE__", "newsflux-story02-d2b-synthetic")
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInContext(source, context)
  return { context, elements, listeners, memory }
}
test("neutral defaults, progress, controls and keyboard persistence", () => {
  const { context, elements, memory, listeners } = setup()
  assert.equal(elements.get("export").disabled, true)
  assert.match(elements.get("progress").textContent, /Reviewed 0 \/ 40/)
  assert.equal(elements.get("decisions").children.length, 4)
  assert.ok(elements.get("decisions").children.every((x) => x["aria-pressed"] === "false"))
  listeners.keydown({ target: { matches: () => false }, key: "2", preventDefault() {} })
  assert.deepEqual(JSON.parse(memory["newsflux-story02-d2b-synthetic"]), { R001: "RELATED_TOPIC" })
  assert.match(elements.get("progress").textContent, /Reviewed 1 \/ 40/)
  const reloaded = setup(memory)
  assert.match(reloaded.elements.get("progress").textContent, /Reviewed 1 \/ 40/)
  vm.runInContext('index=0;document.getElementById("first").click()', context)
  assert.match(elements.get("position").textContent, /R002/)
  elements.get("clear").click()
  assert.deepEqual(JSON.parse(memory["newsflux-story02-d2b-synthetic"]), { R001: "RELATED_TOPIC" })
})
test("completion, export and import validation", () => {
  const { context, elements, memory } = setup()
  for (let i = 0; i < 40; i++) vm.runInContext(`index=${i};choose('UNCERTAIN')`, context)
  assert.equal(elements.get("export").disabled, false)
  assert.equal(Object.keys(JSON.parse(memory["newsflux-story02-d2b-synthetic"])).length, 40)
  const columns = Object.keys(rows[0])
  const csv = [
    columns.join(","),
    ...rows.map((r) =>
      columns.map((k) => JSON.stringify(k === "human_decision" ? "UNCERTAIN" : r[k])).join(","),
    ),
  ].join("\n")
  context.input = csv
  vm.runInContext("importCsv(input)", context)
  context.input = csv.replace("R001", "R999")
  assert.throws(() => vm.runInContext("importCsv(input)", context))
  context.input = csv.replace("R002", "R001")
  assert.throws(() => vm.runInContext("importCsv(input)", context))
  context.input = csv.replace(',"UNCERTAIN"', ',"BAD_LABEL"')
  assert.throws(() => vm.runInContext("importCsv(input)", context), /Invalid decision/)
  context.input = csv.replace("A 0", "changed title")
  assert.throws(() => vm.runInContext("importCsv(input)", context))
})
test("no remote assets, map, or strategy metadata in template", () => {
  assert.doesNotMatch(template, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i)
  assert.doesNotMatch(template, /\bfetch\s*\(/)
  assert.doesNotMatch(template, /neutral-review-map-v1|selection_lane|qwen_score/)
  assert.match(template, /Clear all 40 saved decisions/)
  assert.match(template, /story02-d2b-checkpoint\.csv/)
})
