// Page and count reconciliation share this fixed Home query and visibility policy.
// Named contract shared by the page adapter and pure request tests.
// eslint-disable-next-line import/prefer-default-export
export const buildHomeEntryRequest = ({ pageSize, showHiddenFeeds, cursor, tieDrain }) => {
  const visibility = !showHiddenFeeds
  if (tieDrain) {
    return {
      status: "unread",
      order: "id",
      direction: "desc",
      limit: pageSize,
      globally_visible: visibility,
      published_after: tieDrain.bucketSecond - 1,
      published_before: tieDrain.bucketSecond + 1,
      ...(tieDrain.beforeEntryId !== null && {
        before_entry_id: tieDrain.beforeEntryId,
      }),
    }
  }

  return {
    status: "unread",
    order: "published_at",
    direction: "desc",
    limit: pageSize,
    globally_visible: visibility,
    ...(cursor !== undefined && cursor !== null && { published_before: cursor }),
  }
}
