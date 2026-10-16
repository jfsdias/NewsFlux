export default function hasProviderReportedFeedError(feed) {
  return Number(feed?.parsing_error_count ?? 0) > 0 && feed?.disabled !== true
}
