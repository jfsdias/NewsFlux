import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

// eslint-disable-next-line import/extensions -- Node ESM requires exact extensions in this harness.
import { evaluateUxReachSuite } from "./scenario-contract.js"

export default class UxReachFailClosedReporter {
  constructor(options = {}) {
    this.outputDir = path.resolve(options.outputDir ?? "test-results/ux-reach-01")
    this.discoveredTitles = []
    this.results = []
  }

  onBegin(config, suite) {
    this.outputDir = path.resolve(config?.outputDir ?? this.outputDir)
    this.discoveredTitles = suite?.allTests?.().map((test) => test.title) ?? []
    this.results = []
  }

  onTestEnd(test, result) {
    this.results ??= []
    this.results.push({
      title: test.title,
      status: result.status,
      durationMs: result.duration,
    })
  }

  onEnd(result) {
    const report = {
      playwrightStatus: result?.status ?? "unknown",
      ...evaluateUxReachSuite({
        discoveredTitles: this.discoveredTitles ?? [],
        results: this.results ?? [],
      }),
      executedScenarios: this.results ?? [],
    }

    try {
      mkdirSync(this.outputDir, { recursive: true })
      writeFileSync(
        path.join(this.outputDir, "ux-reach-summary.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      )
    } catch (error) {
      report.gate = "FAIL"
      report.reportWriteError = error instanceof Error ? error.message : String(error)
    }

    console.log(
      `UX-REACH-01 CI ${report.gate}: ${report.passedCount}/${report.expectedCount} required scenarios passed; ${report.failedCount} failed; ${report.skippedCount} skipped; ${report.discoveredCount} discovered.`,
    )
    for (const scenario of report.executedScenarios) {
      console.log(`UX-REACH-01 ${scenario.status}: ${scenario.title}`)
    }

    if (report.gate !== "PASS") {
      process.exitCode = 1
      console.error("UX-REACH-01 fail-closed summary:", JSON.stringify(report))
      return { status: "failed" }
    }

    return { status: result?.status ?? "passed" }
  }
}
