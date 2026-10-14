const getUnreadShortcutFeeds = (visibleFeeds, showUnreadFeedsOnly) => {
  if (showUnreadFeedsOnly) {
    return []
  }

  return visibleFeeds.filter((feed) => feed.unreadCount > 0)
}

export default getUnreadShortcutFeeds
