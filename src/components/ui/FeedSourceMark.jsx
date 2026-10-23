import SourceMark from "@/components/ui/SourceMark"
import useFeedIcons from "@/hooks/useFeedIcons"

const FeedSourceMark = ({ feed, size = 20, className = "" }) => {
  const iconId = feed?.icon?.icon_id ?? 0
  const providerIcon = useFeedIcons(iconId, feed)

  return (
    <SourceMark
      className={className}
      feed={feed}
      providerIconHeight={providerIcon?.height}
      providerIconUrl={providerIcon?.url}
      providerIconWidth={providerIcon?.width}
      size={size}
    />
  )
}

export default FeedSourceMark
