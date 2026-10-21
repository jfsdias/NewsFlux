import assert from "node:assert/strict"
import test from "node:test"

/* eslint-disable import/extensions -- Node ESM needs explicit extensions. */
import observeNearViewport, {
  findNearestScrollableAncestor,
  importWhileMounted,
} from "./near-viewport-activation.js"
/* eslint-enable import/extensions */

const makeObserverClass = () => {
  const observers = []

  class ControlledIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.targets = []
      this.disconnectCount = 0
      observers.push(this)
    }

    observe(target) {
      this.targets.push(target)
    }

    disconnect() {
      this.disconnectCount += 1
    }

    emit(isIntersecting, target = this.targets[0]) {
      this.callback([{ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, target }])
    }
  }

  return { ControlledIntersectionObserver, observers }
}

test("far media stays inactive until it intersects the established prefetch margin", () => {
  const { ControlledIntersectionObserver, observers } = makeObserverClass()
  const target = {}
  let activations = 0

  observeNearViewport(target, () => activations++, { Observer: ControlledIntersectionObserver })

  assert.equal(activations, 0)
  assert.equal(observers[0].targets[0], target)
  assert.equal(observers[0].options.rootMargin, "400px 0px")

  observers[0].emit(false)
  assert.equal(activations, 0)

  observers[0].emit(true)
  assert.equal(activations, 1)
  assert.equal(observers[0].disconnectCount, 1)
})

test("activation is one-way and cannot reinitialize after leaving and re-entering", () => {
  const { ControlledIntersectionObserver, observers } = makeObserverClass()
  let activations = 0

  observeNearViewport({}, () => activations++, { Observer: ControlledIntersectionObserver })
  observers[0].emit(true)
  observers[0].emit(false)
  observers[0].emit(true)

  assert.equal(activations, 1)
})

test("observer cleanup ignores a late intersection callback after unmount", () => {
  const { ControlledIntersectionObserver, observers } = makeObserverClass()
  let activations = 0

  const cleanup = observeNearViewport({}, () => activations++, {
    Observer: ControlledIntersectionObserver,
  })
  cleanup()
  observers[0].emit(true)

  assert.equal(activations, 0)
  assert.equal(observers[0].disconnectCount, 1)
})

test("IntersectionObserver absence activates media for non-browser environments", async () => {
  let activations = 0

  observeNearViewport({}, () => activations++, { Observer: null })
  assert.equal(activations, 0)
  await Promise.resolve()

  assert.equal(activations, 1)
})

test("unsupported-observer fallback cleanup prevents activation after unmount", async () => {
  let activations = 0

  const cleanup = observeNearViewport({}, () => activations++, { Observer: null })
  cleanup()
  await Promise.resolve()

  assert.equal(activations, 0)
})

test("a late player module import is discarded after unmount or article switch", async () => {
  let resolveImport
  let isCancelled = false
  const pendingModule = importWhileMounted(
    () =>
      new Promise((resolve) => {
        resolveImport = resolve
      }),
    () => isCancelled,
  )

  isCancelled = true
  resolveImport({ default: class LatePlayer {} })

  assert.equal(await pendingModule, null)
})

test("a current player module import continues to initialization", async () => {
  const playerModule = { default: class Player {} }

  assert.equal(
    await importWhileMounted(
      async () => playerModule,
      () => false,
    ),
    playerModule,
  )
})

test("near-viewport observer uses the closest scrollable ancestor as its root", () => {
  const { ControlledIntersectionObserver, observers } = makeObserverClass()
  const scrollRoot = { parentElement: null }
  const articleBody = { parentElement: scrollRoot }
  const player = { parentElement: articleBody }

  assert.equal(
    findNearestScrollableAncestor(player, (element) =>
      element === scrollRoot ? { overflowY: "auto" } : { overflowY: "visible" },
    ),
    scrollRoot,
  )

  observeNearViewport(player, () => {}, {
    Observer: ControlledIntersectionObserver,
    root: scrollRoot,
  })

  assert.equal(observers[0].options.root, scrollRoot)
})

test("near-viewport observer falls back to the document viewport without a scroll ancestor", () => {
  const { ControlledIntersectionObserver, observers } = makeObserverClass()
  const target = { parentElement: null }

  assert.equal(
    findNearestScrollableAncestor(target, () => ({ overflowY: "visible" })),
    null,
  )
  observeNearViewport(target, () => {}, { Observer: ControlledIntersectionObserver })

  assert.equal(observers[0].options.root, null)
})
