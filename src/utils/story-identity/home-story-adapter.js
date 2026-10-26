/**
 * Home Story Adapter (STORY-02-A1).
 *
 * Pure function:
 * applyStoryProjection(homeArticles, storyProjections) -> HomeItem[]
 *
 * Guarantees:
 * - H1 placement preservation: Story placed at min(original Home position of members).
 * - Flat-Home parity when disabled or unclustered: exact same order, zero extra sorting.
 * - Live read/star state preservation: maps live article objects from Home snapshot.
 * - Strict 1:1 article accounting: every article appears exactly once.
 */

/**
 * @typedef {Object} ArticleHomeItem
 * @property {'article'} type
 * @property {Object} data - Live article object
 * @property {number|string} articleId
 * @property {number} placementIndex
 * @property {string} key
 *
 * @typedef {Object} StoryHomeItem
 * @property {'story'} type
 * @property {Object} data - StoryProjection object
 * @property {Object} representative - Live representative article object
 * @property {Array<Object>} alternatives - Live alternative article objects
 * @property {number|string} articleId
 * @property {number} placementIndex
 * @property {string} key
 *
 * @typedef {ArticleHomeItem | StoryHomeItem} HomeItem
 */

/**
 * Transforms flat Home articles and optional StoryProjections into a sequence of HomeItems.
 *
 * @param {Array<Object>} homeArticles - Live articles in Home feed order
 * @param {Array<Object>} [storyProjections=null] - Validated StoryProjection list
 * @returns {Array<HomeItem>}
 */
export function applyStoryProjection(homeArticles, storyProjections = null) {
  if (!Array.isArray(homeArticles) || homeArticles.length === 0) {
    return []
  }

  // Fast path: if no projections are provided, return flat Home items
  if (!Array.isArray(storyProjections) || storyProjections.length === 0) {
    return homeArticles.map((article, idx) => ({
      type: "article",
      data: article,
      articleId: article.id,
      placementIndex: idx,
      key: `article-${article.id}`,
    }))
  }

  const articleMap = new Map()
  for (const a of homeArticles) {
    articleMap.set(a.id, a)
  }

  const items = []
  const accountedIds = new Set()

  for (const proj of storyProjections) {
    const repArticle = articleMap.get(proj.representativeArticleId)
    if (!repArticle) {
      continue
    }

    if (proj.memberCount > 1) {
      // Multi-article Story item
      const alternatives = proj.alternativeArticleIds
        .map((id) => articleMap.get(id))
        .filter(Boolean)

      items.push({
        type: "story",
        data: proj,
        representative: repArticle,
        alternatives,
        articleId: repArticle.id,
        placementIndex: proj.placementIndex,
        key: `story-${proj.storyId}`,
      })

      for (const mId of proj.memberArticleIds) {
        accountedIds.add(mId)
      }
    } else {
      // 1-member singleton Story item behaves as a normal article
      items.push({
        type: "article",
        data: repArticle,
        articleId: repArticle.id,
        placementIndex: proj.placementIndex,
        key: `article-${repArticle.id}`,
      })
      accountedIds.add(repArticle.id)
    }
  }

  // Safety fallback: append any unaccounted original articles at their original positions
  for (const [idx, a] of homeArticles.entries()) {
    if (!accountedIds.has(a.id)) {
      items.push({
        type: "article",
        data: a,
        articleId: a.id,
        placementIndex: idx,
        key: `article-${a.id}`,
      })
    }
  }

  // Sort by placementIndex ASC, tie-break by original order / ID
  items.sort((a, b) => {
    if (a.placementIndex !== b.placementIndex) {
      return a.placementIndex - b.placementIndex
    }
    return String(a.articleId).localeCompare(String(b.articleId), undefined, {
      numeric: true,
    })
  })

  return items
}

export default applyStoryProjection
