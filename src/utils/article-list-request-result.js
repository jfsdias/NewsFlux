// Check freshness after the response settles, before any list data is committed.
const resolveCurrentArticleListRequest = async (request, isCurrent) => {
  const response = await request
  return isCurrent() ? { current: true, response } : { current: false }
}

export default resolveCurrentArticleListRequest
