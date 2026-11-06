// eslint-disable-next-line import/extensions
import createArticleListRequestKey from "./article-list-request-key.js"

/**
 * Describes the membership of a committed non-Home snapshot. Refresh revisions are deliberately
 * normalized away: refreshing the same query must keep its visible snapshot while the request is
 * pending. Session revision remains part of the identity so account/session changes never reuse it.
 */
const createArticleListSnapshotIdentity = ({ content, settings, info, sessionRevision }) => {
  const source = info?.from ?? content.infoFrom
  if (source === "home") {
    return null
  }

  const requestContent = { ...content, articleListRevision: 0 }
  const rawSourceId = info?.id ?? content.infoId ?? null
  const sourceId = rawSourceId === "" ? null : rawSourceId
  const normalizedInfo = {
    from: source,
    id: sourceId === null ? null : String(sourceId),
  }
  const requestKey = createArticleListRequestKey({
    content: requestContent,
    settings,
    info: normalizedInfo,
    sessionRevision,
  })

  return JSON.stringify({ requestKey, sessionRevision })
}

export default createArticleListSnapshotIdentity
