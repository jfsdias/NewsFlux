import { useCallback } from "react"
import { useParams } from "react-router"

import { getFeedEntries } from "@/apis"
import Content from "@/components/Content/Content"

const Feed = () => {
  const { id: feedId } = useParams()

  const getEntries = useCallback(
    (status, starred, filterParams) => getFeedEntries(feedId, status, starred, filterParams),
    [feedId],
  )
  return <Content getEntries={getEntries} info={{ from: "feed", id: feedId }} />
}

export default Feed
