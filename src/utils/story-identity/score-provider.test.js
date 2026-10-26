import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceRootUrlPrefix = pathToFileURL(`${sourceRoot}${path.sep}`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null
    if (specifier.startsWith("@/")) {
      target = path.resolve(sourceRoot, specifier.slice(2))
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith(sourceRootUrlPrefix) &&
      !path.extname(specifier)
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }

    if (target) {
      if (!path.extname(target)) {
        const jsTarget = `${target}.js`
        const jsxTarget = `${target}.jsx`
        if (existsSync(jsTarget)) {
          return nextResolve(pathToFileURL(jsTarget).href, context)
        }
        if (existsSync(jsxTarget)) {
          return nextResolve(pathToFileURL(jsxTarget).href, context)
        }
      } else if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const { FixtureScoreProvider } = await import("./fixture-score-provider")
const { NullScoreProvider } = await import("./null-score-provider")
const { normalizeAndValidatePairs, ScoreProvider } = await import("./score-provider")

test("ScoreProvider base class requires subclass implementation", async () => {
  const base = new ScoreProvider()
  await assert.rejects(
    () => base.scorePairs([], {}),
    /scorePairs must be implemented by concrete ScoreProvider/,
  )
})

test("NullScoreProvider returns empty pairs array (flat Home guarantee)", async () => {
  const provider = new NullScoreProvider()
  const res = await provider.scorePairs([{ id: 1 }, { id: 2 }], {
    articleRevision: "rev_test",
  })
  assert.equal(res.version, "1.0")
  assert.equal(res.articleRevision, "rev_test")
  assert.deepEqual(res.pairs, [])
})

test("FixtureScoreProvider returns deterministic pairs and handles delay/error", async () => {
  const pairs = [{ articleAId: 1, articleBId: 2, score: 0.95 }]
  const provider = new FixtureScoreProvider(pairs)
  const res = await provider.scorePairs([], { articleRevision: "rev_1" })
  assert.deepEqual(res.pairs, pairs)

  // Delay simulation
  const delayedProvider = new FixtureScoreProvider(pairs, { delayMs: 20 })
  const t0 = performance.now()
  await delayedProvider.scorePairs([], {})
  assert.ok(performance.now() - t0 >= 15)

  // Failure simulation
  const failingProvider = new FixtureScoreProvider([], {
    shouldThrow: true,
    errorMessage: "Custom failure",
  })
  await assert.rejects(() => failingProvider.scorePairs([], {}), /Custom failure/)
})

test("normalizeAndValidatePairs filters malformed and duplicate pairs", () => {
  const validIds = new Set([10, 20, 30])

  const rawPairs = [
    { articleAId: 10, articleBId: 20, score: 0.8 }, // Valid
    { articleAId: 20, articleBId: 10, score: 0.85 }, // Duplicate with higher score -> should update to 0.85
    { articleAId: 10, articleBId: 10, score: 0.9 }, // Self-pair -> rejected
    { articleAId: 10, articleBId: 99, score: 0.7 }, // Unknown ID 99 -> rejected
    { articleAId: 10, articleBId: 30, score: Number.NaN }, // NaN score -> rejected
    { articleAId: 20, articleBId: 30, score: "not_a_number" }, // Non-numeric score -> rejected
    { articleAId: 20, articleBId: 30, score: null }, // Null score -> rejected
    null, // Null item -> rejected
    {}, // Empty object -> rejected
  ]

  const normalized = normalizeAndValidatePairs(rawPairs, validIds)
  assert.equal(normalized.length, 1) // Only 10_20 survived
  assert.equal(normalized[0].pairKey, "10_20")
  assert.equal(normalized[0].score, 0.85) // Kept higher score
})
