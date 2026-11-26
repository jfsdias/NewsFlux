// Check freshness synchronously after the response settles, before list data is committed.
const resolveCurrentArticleListRequest = (response, isCurrent) =>
  isCurrent() ? { current: true, response } : { current: false }

export default resolveCurrentArticleListRequest
