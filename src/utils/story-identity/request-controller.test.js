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

const { FAIL_OPEN_REASONS, PIPELINE_STATES } = await import("./constants")
const { FixtureScoreProvider } = await import("./fixture-score-provider")
const { NullScoreProvider } = await import("./null-score-provider")
const { StoryRequestController } = await import("./request-controller")
const { runP3Clustering } = await import("./story-engine")
const { buildStoryProjections } = await import("./story-projection")

class TestMockWorker {
  constructor(behavior = {}) {
    this.behavior = behavior
    this.terminated = false
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
    if (this.behavior.crash) {
      setTimeout(() => this._emit("error", new Error("Worker thread crashed")), 5)
      return
    }
    if (this.behavior.workerError) {
      setTimeout(
        () =>
          this._emit("message", {
            data: {
              type: "STORY_PROJECTION_ERROR",
              requestId: data.requestId,
              error: "Worker processing exception",
            },
          }),
        5,
      )
      return
    }
    if (this.behavior.delayMs) {
      setTimeout(() => this._respond(data), this.behavior.delayMs)
      return
    }
    if (this.behavior.invalidProjection) {
      setTimeout(
        () =>
          this._emit("message", {
            data: {
              type: "STORY_PROJECTION_SUCCESS",
              requestId: data.requestId,
              sessionRevision: data.sessionRevision,
              articleRevision: data.articleRevision,
              projections: [
                {
                  storyId: "invalid_s1",
                  representativeArticleId: 9999, // Unknown article ID
                  memberArticleIds: [9999],
                  memberCount: 1,
                  placementIndex: 0,
                },
              ],
            },
          }),
        5,
      )
      return
    }

    setTimeout(() => this._respond(data), 5)
  }

  _respond(data) {
    if (this.terminated) {
      return
    }
    const clusters = runP3Clustering(data.articles, data.pairScores, data.policy)
    const projections = buildStoryProjections(clusters, data.articles)
    this._emit("message", {
      data: {
        type: "STORY_PROJECTION_SUCCESS",
        requestId: data.requestId,
        sessionRevision: data.sessionRevision,
        articleRevision: data.articleRevision,
        projections,
        timingMs: { totalMs: 2 },
      },
    })
  }

  terminate() {
    this.terminated = true
  }
}

test("request-controller fails open when feature flag is disabled", async () => {
  // In node tests, VITE_STORY_IDENTITY_ENABLED is undefined -> disabled
  const controller = new StoryRequestController({
    workerFactory: () => new TestMockWorker(),
  })
  const res = await controller.processHomeArticles({
    articles: [{ id: 1, title: "A", feedId: "f1", publishedAt: 100 }],
  })

  assert.equal(res.status, PIPELINE_STATES.DISABLED)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.FEATURE_DISABLED)
  assert.equal(res.projections, null)
})

test("request-controller with explicit flag on + NullScoreProvider returns flat Home", async () => {
  // Mock feature flag enabled
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"
  const controller = new StoryRequestController({
    scoreProvider: new NullScoreProvider(),
    workerFactory: () => new TestMockWorker(),
  })

  const articles = [
    { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
  ]

  const res = await controller.processHomeArticles({ articles })
  assert.equal(res.status, PIPELINE_STATES.READY)
  assert.equal(res.failOpenReason, null)
  assert.equal(res.projections, null) // NullScoreProvider produces null projections -> flat Home
})

test("request-controller with FixtureScoreProvider successfully dispatches and clusters", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const articles = [
    { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
    { id: 3, title: "C", feedId: "f3", publishedAt: 300 },
  ]

  const fixturePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider(fixturePairs),
    workerFactory: () => new TestMockWorker(),
  })

  const res = await controller.processHomeArticles({ articles })
  assert.equal(res.status, PIPELINE_STATES.READY)
  assert.ok(Array.isArray(res.projections))
  assert.equal(res.projections.length, 2) // 1 multi-story [1, 2] + 1 singleton [3]
  assert.equal(res.projections[0].memberCount, 2)
  assert.equal(res.projections[1].memberCount, 1)
})

test("request-controller fails open when score provider throws (PROVIDER_FAILED)", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([], {
      shouldThrow: true,
      errorMessage: "Provider explosion",
    }),
    workerFactory: () => new TestMockWorker(),
  })

  const res = await controller.processHomeArticles({
    articles: [{ id: 1, title: "A", feedId: "f1", publishedAt: 100 }],
  })

  assert.equal(res.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.PROVIDER_FAILED)
  assert.equal(res.projections, null)
})

test("request-controller fails open when worker is unavailable (WORKER_FAILED)", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([{ articleAId: 1, articleBId: 2, score: 0.9 }]),
    workerFactory: () => null, // Worker unavailable
  })

  const res = await controller.processHomeArticles({
    articles: [
      { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
      { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
    ],
  })

  assert.equal(res.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.WORKER_FAILED)
  assert.equal(res.projections, null)
})

test("request-controller fails open when worker crashes or throws error (WORKER_FAILED)", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([{ articleAId: 1, articleBId: 2, score: 0.9 }]),
    workerFactory: () => new TestMockWorker({ crash: true }),
  })

  const res = await controller.processHomeArticles({
    articles: [
      { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
      { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
    ],
  })

  assert.equal(res.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.WORKER_FAILED)
  assert.equal(res.projections, null)
})

test("request-controller fails open on worker timeout (TIMEOUT)", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([{ articleAId: 1, articleBId: 2, score: 0.9 }]),
    workerFactory: () => new TestMockWorker({ delayMs: 100 }), // Worker takes 100ms
    timeoutMs: 20, // Timeout after 20ms
  })

  const res = await controller.processHomeArticles({
    articles: [
      { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
      { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
    ],
  })

  assert.equal(res.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.TIMEOUT)
  assert.equal(res.projections, null)
})

test("request-controller stale request fencing: Request A discarded when Request B starts", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([
      { articleAId: 1, articleBId: 2, score: 0.9 },
      { articleAId: 3, articleBId: 4, score: 0.9 },
    ]),
    workerFactory: () => new TestMockWorker({ delayMs: 40 }),
    timeoutMs: 1000,
  })

  const articlesA = [
    { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
  ]
  const articlesB = [
    { id: 3, title: "C", feedId: "f3", publishedAt: 300 },
    { id: 4, title: "D", feedId: "f4", publishedAt: 400 },
  ]

  // Start Request A (takes 40ms)
  const promiseA = controller.processHomeArticles({ articles: articlesA, sessionRevision: 1 })

  // Start Request B immediately (supersedes A)
  const promiseB = controller.processHomeArticles({ articles: articlesB, sessionRevision: 2 })

  const [resA, resB] = await Promise.all([promiseA, promiseB])

  // Request A must be discarded as STALE_RESULT
  assert.equal(resA.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(resA.failOpenReason, FAIL_OPEN_REASONS.STALE_RESULT)
  assert.equal(resA.projections, null)

  // Request B must be READY
  assert.equal(resB.status, PIPELINE_STATES.READY)
  assert.ok(Array.isArray(resB.projections))
})

test("request-controller fails open when worker emits invalid projection (INVALID_PROJECTION)", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  const controller = new StoryRequestController({
    scoreProvider: new FixtureScoreProvider([{ articleAId: 1, articleBId: 2, score: 0.9 }]),
    workerFactory: () => new TestMockWorker({ invalidProjection: true }),
  })

  const res = await controller.processHomeArticles({
    articles: [
      { id: 1, title: "A", feedId: "f1", publishedAt: 100 },
      { id: 2, title: "B", feedId: "f2", publishedAt: 200 },
    ],
  })

  assert.equal(res.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(res.failOpenReason, FAIL_OPEN_REASONS.INVALID_PROJECTION)
  assert.equal(res.projections, null)
})

test("request-controller: stale provider completion cannot overwrite latest controller state", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  // Provider with custom per-request delays
  class DelayScoreProvider {
    async scorePairs(articles, context) {
      const delay = context.requestId === "req_1" ? 60 : 10
      await new Promise((resolve) => setTimeout(resolve, delay))
      return {
        version: "1.0",
        articleRevision: context.articleRevision,
        pairs: [{ articleAId: articles[0].id, articleBId: articles[1].id, score: 0.9 }],
      }
    }
  }

  const controller = new StoryRequestController({
    scoreProvider: new DelayScoreProvider(),
    workerFactory: () => new TestMockWorker({ delayMs: 5 }),
  })

  const articlesA = [
    { id: 1, title: "A1", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "A2", feedId: "f2", publishedAt: 200 },
  ]
  const articlesB = [
    { id: 3, title: "B1", feedId: "f3", publishedAt: 300 },
    { id: 4, title: "B2", feedId: "f4", publishedAt: 400 },
  ]

  const promiseA = controller.processHomeArticles({ articles: articlesA, sessionRevision: 1 })
  const promiseB = controller.processHomeArticles({ articles: articlesB, sessionRevision: 2 })

  const [resA, resB] = await Promise.all([promiseA, promiseB])

  // Request B was latest and finished READY
  assert.equal(resB.status, PIPELINE_STATES.READY)
  assert.equal(resB.failOpenReason, null)

  // Request A finished late from provider and got STALE_RESULT
  assert.equal(resA.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(resA.failOpenReason, FAIL_OPEN_REASONS.STALE_RESULT)

  // Controller-global state MUST describe the latest active request (Request B: READY)
  assert.equal(controller.status, PIPELINE_STATES.READY)
  assert.equal(controller.lastFailOpenReason, null)
})

test("request-controller: stale worker completion cannot overwrite latest controller state", async () => {
  globalThis.process.env.VITE_STORY_IDENTITY_ENABLED = "1"

  class WorkerDelayScoreProvider {
    async scorePairs(articles, context) {
      return {
        version: "1.0",
        articleRevision: context.articleRevision,
        pairs: [{ articleAId: articles[0].id, articleBId: articles[1].id, score: 0.9 }],
      }
    }
  }

  // Mock worker that delays based on request id
  class RequestAwareMockWorker extends TestMockWorker {
    postMessage(data) {
      const delay = data.requestId === "req_1" ? 60 : 10
      setTimeout(() => this._respond(data), delay)
    }
  }

  const controller = new StoryRequestController({
    scoreProvider: new WorkerDelayScoreProvider(),
    workerFactory: () => new RequestAwareMockWorker(),
  })

  const articlesA = [
    { id: 1, title: "A1", feedId: "f1", publishedAt: 100 },
    { id: 2, title: "A2", feedId: "f2", publishedAt: 200 },
  ]
  const articlesB = [
    { id: 3, title: "B1", feedId: "f3", publishedAt: 300 },
    { id: 4, title: "B2", feedId: "f4", publishedAt: 400 },
  ]

  const promiseA = controller.processHomeArticles({ articles: articlesA, sessionRevision: 1 })
  const promiseB = controller.processHomeArticles({ articles: articlesB, sessionRevision: 2 })

  const [resA, resB] = await Promise.all([promiseA, promiseB])

  // Request B was latest and finished READY
  assert.equal(resB.status, PIPELINE_STATES.READY)
  assert.equal(resB.failOpenReason, null)

  // Request A finished late from worker and got STALE_RESULT
  assert.equal(resA.status, PIPELINE_STATES.FAILED_OPEN)
  assert.equal(resA.failOpenReason, FAIL_OPEN_REASONS.STALE_RESULT)

  // Controller-global state MUST NOT be overwritten by Request A; remains READY from Request B
  assert.equal(controller.status, PIPELINE_STATES.READY)
  assert.equal(controller.lastFailOpenReason, null)
})
