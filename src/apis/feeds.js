import apiClient from "./ofetch"

export const getFeeds = async () => apiClient.get("/v1/feeds")

export const getFeed = async (id) => apiClient.get(`/v1/feeds/${id}`)

export const getCounters = async () => apiClient.get("/v1/feeds/counters")

export const refreshFeed = async (id) => apiClient.raw(`/v1/feeds/${id}/refresh`, { method: "PUT" })

export const refreshAllFeed = async () => apiClient.raw("/v1/feeds/refresh", { method: "PUT" })

export const addFeed = async (url, categoryId, isFullText) =>
  apiClient.post("/v1/feeds", {
    feed_url: url,
    category_id: categoryId,
    crawler: isFullText,
  })

export const deleteFeed = async (id) => apiClient.raw(`/v1/feeds/${id}`, { method: "DELETE" })

export const updateFeed = async (id, newDetails) => {
  const { categoryId, title, siteUrl, feedUrl, hidden, disabled, isFullText } = newDetails

  const payload = {
    category_id: categoryId,
    title,
    site_url: siteUrl,
    feed_url: feedUrl,
    hide_globally: hidden,
    disabled,
    crawler: isFullText,
  }

  if (Object.hasOwn(newDetails, "blocklistRules")) {
    payload.blocklist_rules = newDetails.blocklistRules
  }
  if (Object.hasOwn(newDetails, "keeplistRules")) {
    payload.keeplist_rules = newDetails.keeplistRules
  }

  return apiClient.put(`/v1/feeds/${id}`, payload)
}

export const markFeedAsRead = async (id) => apiClient.put(`/v1/feeds/${id}/mark-all-as-read`)
