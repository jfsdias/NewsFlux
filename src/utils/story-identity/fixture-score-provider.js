import { ScoreProvider } from "./score-provider"

/**
 * Fixture Score Provider for unit tests, integration tests, and dev verification.
 *
 * Emits an explicit deterministic list of pair scores.
 * Supports failure simulation and delay testing.
 * MUST NEVER be used as an implicit production provider.
 */
export class FixtureScoreProvider extends ScoreProvider {
  /**
   * @param {Array<{ articleAId: number|string, articleBId: number|string, score: number }>} pairs
   * @param {Object} [options]
   * @param {boolean} [options.shouldThrow=false]
   * @param {string} [options.errorMessage]
   * @param {number} [options.delayMs=0]
   */
  constructor(pairs = [], options = {}) {
    super()
    this.pairs = pairs
    this.options = options
  }

  async scorePairs(articles, context) {
    if (this.options.shouldThrow) {
      throw new Error(this.options.errorMessage || "Simulated FixtureScoreProvider failure")
    }

    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs))
    }

    return {
      version: "1.0",
      articleRevision: context?.articleRevision ?? "",
      pairs: this.pairs,
    }
  }
}

export default FixtureScoreProvider
