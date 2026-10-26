import { ScoreProvider } from "./score-provider"

/**
 * Null Score Provider.
 *
 * Production-safe default:
 * - Emits zero candidate pairs.
 * - Always yields flat, unclustered Home feed.
 * - No ML models, no network egress, no performance overhead.
 */
export class NullScoreProvider extends ScoreProvider {
  /**
   * @param {Array<Object>} articles
   * @param {Object} context
   * @returns {Promise<{ version: string, articleRevision: string, pairs: Array<any> }>}
   */
  async scorePairs(articles, context) {
    return {
      version: "1.0",
      articleRevision: context?.articleRevision ?? "",
      pairs: [],
    }
  }
}

export default NullScoreProvider
