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

const { getHomeStoryProjectionContext } = await import("./use-home-story-projection")
const { FixtureScoreProvider } = await import("./fixture-score-provider")
const { NullScoreProvider } = await import("./null-score-provider")
const { StoryRequestController, setGlobalStoryScoreProvider, resetGlobalStoryIdentity } =
  await import("./request-controller")
const { runP3Clustering } = await import("./story-engine")
const { buildStoryProjections, computeArticleRevision } = await import("./story-projection")

globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

class TestMockWorker {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  _emit(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event)
    }
  }

  postMessage(data) {
    const clusters = runP3Clustering(data.articles, data.pairScores, data.policy)
    const projections = buildStoryProjections(clusters, data.articles)
    setTimeout(() => {
      this._emit("message", {
        data: {
          type: "STORY_PROJECTION_SUCCESS",
          requestId: data.requestId,
          sessionRevision: data.sessionRevision,
          articleRevision: data.articleRevision,
          projections,
          timingMs: { totalMs: 1 },
        },
      })
    }, 5)
  }

  terminate() {}
}

/**
 * High-fidelity React hook lifecycle runner.
 * Simulates React's exact state, ref, and effect lifecycle across multiple renders.
 */
class ReactHookLifecycleSimulator {
  constructor({ scoreProvider, workerFactory }) {
    this.controller = new StoryRequestController({
      scoreProvider: scoreProvider ?? new NullScoreProvider(),
      workerFactory: workerFactory ?? (() => new TestMockWorker()),
    })
    this.projectionState = null
    this.lastRenderResult = null
    this.processRequestCount = 0

    // Spy on controller.processHomeArticles to track exact recomputation calls
    const originalProcess = this.controller.processHomeArticles.bind(this.controller)
    this.controller.processHomeArticles = async (params) => {
      this.processRequestCount++
      return originalProcess(params)
    }

    // Effect tracking
    this.lastDeps = null
    this.activeEffectDisposer = null
  }

  /**
   * Simulates a component render with the given props.
   */
  async render({ recentEntries, sessionRevision = 0, isFlagEnabled = true }) {
    const isEnabled =
      Boolean(isFlagEnabled) && Array.isArray(recentEntries) && recentEntries.length > 0
    const articleRevision = isEnabled ? computeArticleRevision(recentEntries) : ""
    const currentProjectionKey = isEnabled ? `${sessionRevision}_${articleRevision}` : ""

    // 1. Calculate render-time projection context
    const context = getHomeStoryProjectionContext({
      recentEntries,
      sessionRevision,
      projectionState: this.projectionState,
      isFlagEnabled: isEnabled,
    })
    this.lastRenderResult = context

    // 2. Evaluate effect dependencies [isEnabled, articleRevision, sessionRevision, currentProjectionKey]
    const currentDeps = [isEnabled, articleRevision, sessionRevision, currentProjectionKey]
    const depsChanged = !this.lastDeps || this.lastDeps.some((dep, idx) => dep !== currentDeps[idx])

    if (depsChanged) {
      this.lastDeps = currentDeps

      if (this.activeEffectDisposer) {
        this.activeEffectDisposer()
        this.activeEffectDisposer = null
      }

      if (isEnabled && articleRevision) {
        let disposed = false
        this.activeEffectDisposer = () => {
          disposed = true
        }

        const targetKey = currentProjectionKey
        const targetRevision = articleRevision

        const result = await this.controller.processHomeArticles({
          articles: recentEntries,
          sessionRevision,
        })

        if (!disposed) {
          this.projectionState =
            result?.status === "ready" &&
            Array.isArray(result?.projections) &&
            result.articleRevision === targetRevision
              ? {
                  projectionKey: targetKey,
                  projections: result.projections,
                }
              : null

          // Trigger state update rerender with current articles
          const rerenderContext = getHomeStoryProjectionContext({
            recentEntries,
            sessionRevision,
            projectionState: this.projectionState,
            isFlagEnabled: isEnabled,
          })
          this.lastRenderResult = rerenderContext
        }
      }
    }

    return this.lastRenderResult
  }
}

test("FLAG_OFF_ZERO_WORK: returns null and does 0 worker/recompute work when disabled", async () => {
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider([{ articleAId: 1, articleBId: 2, score: 0.9 }]),
  })

  const articles = [
    { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
  ]

  const res = await sim.render({ recentEntries: articles, isFlagEnabled: false })
  assert.equal(res.isEnabled, false)
  assert.equal(res.projectedItems, null)
  assert.equal(sim.processRequestCount, 0, "No controller request when flag is off")
})

test("NULL_PROVIDER_FLAT_HOME: with flag on and NullScoreProvider, yields flat Home with no loop", async () => {
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new NullScoreProvider(),
  })

  const articles = [
    { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
  ]

  const res = await sim.render({ recentEntries: articles, isFlagEnabled: true })
  assert.equal(res.isEnabled, true)
  assert.equal(res.projectedItems, null, "Null provider yields flat Home (null)")
  assert.equal(sim.processRequestCount, 1)

  // Re-render
  await sim.render({ recentEntries: [...articles], isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1, "Rerender with same articles does not recompute")
})

test("FIXTURE_PROVIDER_NO_RENDER_LOOP: valid story result stops at requestCount=1 without looping", async () => {
  const fixturePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
  })

  const articles = [
    { id: 1, title: "News 1", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "News 2", feedId: "f2", publishedAt: 200 },
    { id: 3, title: "News 3", feedId: "f3", publishedAt: 300 },
  ]

  // Initial render: triggers request 1 and resolves multi-article story
  const res1 = await sim.render({ recentEntries: articles, isFlagEnabled: true })
  assert.ok(Array.isArray(res1.projectedItems))
  assert.equal(res1.projectedItems.length, 2) // 1 story + 1 singleton
  assert.equal(res1.projectedItems[0].type, "story")
  assert.equal(sim.processRequestCount, 1)

  // Simulate multiple parent rerenders where recentEntries is re-created
  for (let i = 0; i < 5; i++) {
    const recreatedArticles = articles.map((a) => ({ ...a }))
    const resRerender = await sim.render({ recentEntries: recreatedArticles, isFlagEnabled: true })
    assert.equal(resRerender.projectedItems.length, 2)
    assert.equal(
      sim.processRequestCount,
      1,
      `Request count must remain 1 on rerender #${i + 1} (NO RENDER LOOP)`,
    )
  }
})

test("SEMANTICALLY_IDENTICAL_NEW_ARRAY_NO_RECOMPUTE: new array instance with same items does not recompute", async () => {
  const fixturePairs = [{ articleAId: 10, articleBId: 20, score: 0.95 }]
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
  })

  const articlesBatch1 = [
    { id: 10, title: "Alpha", feedId: "f1", publishedAt: 1000 },
    { id: 20, title: "Beta", feedId: "f2", publishedAt: 1500 },
  ]
  await sim.render({ recentEntries: articlesBatch1, isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1)

  // Brand new array instance with identical contents
  const articlesBatch2 = [
    { id: 10, title: "Alpha", feedId: "f1", publishedAt: 1000 },
    { id: 20, title: "Beta", feedId: "f2", publishedAt: 1500 },
  ]
  await sim.render({ recentEntries: articlesBatch2, isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1, "Semantic revision unchanged -> no recomputation")
})

test("READ_CHANGE_NO_RECOMPUTE & LIVE_ARTICLE_STATE_REFRESH: mutating read does not recompute stories and updates live UI immediately", async () => {
  const fixturePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
  })

  const initialArticles = [
    { id: 1, title: "Title A", feedId: "f1", publishedAt: 100, read: false, starred: false },
    { id: 2, title: "Title B", feedId: "f2", publishedAt: 200, read: false, starred: false },
  ]

  const res1 = await sim.render({ recentEntries: initialArticles, isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1)
  assert.equal(res1.projectedItems[0].representative.read, false)

  // Mutate read state on article 1
  const readMutatedArticles = [
    { id: 1, title: "Title A", feedId: "f1", publishedAt: 100, read: true, starred: false }, // Read mutated!
    { id: 2, title: "Title B", feedId: "f2", publishedAt: 200, read: false, starred: false },
  ]

  const res2 = await sim.render({ recentEntries: readMutatedArticles, isFlagEnabled: true })

  // 1. Recompute count MUST NOT increase
  assert.equal(
    sim.processRequestCount,
    1,
    "READ_CHANGE_NO_RECOMPUTE: request count remains exactly 1",
  )

  // 2. Live UI object MUST reflect the new read state immediately
  assert.equal(
    res2.projectedItems[0].representative.read,
    true,
    "LIVE_ARTICLE_STATE_REFRESH: representative article reflects live read=true",
  )
})

test("STAR_CHANGE_NO_RECOMPUTE & LIVE_ARTICLE_STATE_REFRESH: mutating starred does not recompute stories and updates live UI immediately", async () => {
  const fixturePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
  })

  const initialArticles = [
    { id: 1, title: "Title A", feedId: "f1", publishedAt: 100, read: false, starred: false },
    { id: 2, title: "Title B", feedId: "f2", publishedAt: 200, read: false, starred: false },
  ]

  await sim.render({ recentEntries: initialArticles, isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1)

  // Mutate starred state on article 2 (alternative in story)
  const starMutatedArticles = [
    { id: 1, title: "Title A", feedId: "f1", publishedAt: 100, read: false, starred: false },
    { id: 2, title: "Title B", feedId: "f2", publishedAt: 200, read: false, starred: true }, // Starred mutated!
  ]

  const res = await sim.render({ recentEntries: starMutatedArticles, isFlagEnabled: true })

  assert.equal(
    sim.processRequestCount,
    1,
    "STAR_CHANGE_NO_RECOMPUTE: request count remains exactly 1",
  )
  assert.equal(
    res.projectedItems[0].alternatives[0].starred,
    true,
    "LIVE_ARTICLE_STATE_REFRESH: alternative article reflects live starred=true",
  )
})

test("IDENTITY_REVISION_CHANGE_RECOMPUTES: title, feed, or count change triggers recomputation", async () => {
  const fixturePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const sim = new ReactHookLifecycleSimulator({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
  })

  const initialArticles = [
    { id: 1, title: "Headline One", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "Headline Two", feedId: "f2", publishedAt: 200 },
  ]

  await sim.render({ recentEntries: initialArticles, isFlagEnabled: true })
  assert.equal(sim.processRequestCount, 1)

  // Change title on article 1 -> semantic identity changes!
  const titleChangedArticles = [
    { id: 1, title: "Headline One REVISED", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "Headline Two", feedId: "f2", publishedAt: 200 },
  ]

  await sim.render({ recentEntries: titleChangedArticles, isFlagEnabled: true })
  assert.equal(
    sim.processRequestCount,
    2,
    "IDENTITY_REVISION_CHANGE_RECOMPUTES: new title triggers recomputation",
  )
})

test("OLD_PROJECTION_NOT_RENDERED_AFTER_IDENTITY_CHANGE: old projection immediately ceases being valid when identity changes", () => {
  const articlesOld = [
    { id: 1, title: "Old Title A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "Old Title B", feedId: "f2", publishedAt: 200 },
  ]
  const oldRevision = computeArticleRevision(articlesOld)
  const oldProjectionKey = `0_${oldRevision}`

  // Existing projection for old articles
  const heldProjectionState = {
    projectionKey: oldProjectionKey,
    projections: [
      {
        storyId: "s1",
        representativeArticleId: 1,
        memberArticleIds: [1, 2],
        alternativeArticleIds: [2],
        placementIndex: 0,
        memberCount: 2,
      },
    ],
  }

  // Articles identity changes
  const articlesNew = [
    { id: 1, title: "New Title A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "New Title B", feedId: "f2", publishedAt: 200 },
  ]

  const context = getHomeStoryProjectionContext({
    recentEntries: articlesNew,
    sessionRevision: 0,
    projectionState: heldProjectionState,
    isFlagEnabled: true,
  })

  // Old projection MUST NOT be rendered
  assert.equal(context.isCurrent, false)
  assert.equal(context.activeProjections, null)
  assert.equal(context.projectedItems, null, "Yields flat Home (null) during recomputation")
})

test("OLD_PROJECTION_CLEARED_ON_SESSION_CHANGE: session revision change invalidates old projection", () => {
  const articles = [
    { id: 1, title: "Title A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "Title B", feedId: "f2", publishedAt: 200 },
  ]
  const revision = computeArticleRevision(articles)

  const heldProjectionState = {
    projectionKey: `0_${revision}`, // Key for session 0
    projections: [{ storyId: "s1", representativeArticleId: 1, memberArticleIds: [1] }],
  }

  // Component renders in session 1
  const context = getHomeStoryProjectionContext({
    recentEntries: articles,
    sessionRevision: 1, // Session changed to 1!
    projectionState: heldProjectionState,
    isFlagEnabled: true,
  })

  assert.equal(context.isCurrent, false)
  assert.equal(context.activeProjections, null)
  assert.equal(context.projectedItems, null)
})
