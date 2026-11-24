import { useStore } from "@nanostores/react"
import { useMemo, useState } from "react"

import { dataState, globallyHiddenFeedIdsState } from "@/store/dataState"
import { recommendSources } from "@/utils/source-recommendations"

const HomeSourceRecommendations = ({ entries, polyglot }) => {
  const [enabled, setEnabled] = useState(false)
  const [now, setNow] = useState(0)
  const { feedsData, loadState } = useStore(dataState, { keys: ["feedsData", "loadState"] })
  const hasCatalog = loadState.catalog.hasSnapshot
  const hiddenFeedIds = useStore(globallyHiddenFeedIdsState)
  const recommendations = useMemo(
    () =>
      enabled && hasCatalog
        ? recommendSources({ entries, subscribedFeeds: feedsData, hiddenFeedIds, now })
        : [],
    [enabled, hasCatalog, entries, feedsData, hiddenFeedIds, now],
  )
  return (
    <section
      aria-label={polyglot.t("source_recommendations.title")}
      className="home-intelligence home-source-recommendations"
    >
      <h3>{polyglot.t("source_recommendations.title")}</h3>
      <button
        aria-pressed={enabled}
        type="button"
        onClick={() => {
          setNow(Date.now())
          setEnabled(!enabled)
        }}
      >
        {polyglot.t(enabled ? "source_recommendations.disable" : "source_recommendations.enable")}
      </button>
      {enabled && (
        <>
          <p>{polyglot.t("source_recommendations.scope")}</p>
          {hasCatalog ? (
            recommendations.length === 0 ? (
              <p>{polyglot.t("source_recommendations.empty")}</p>
            ) : (
              <ul>
                {recommendations.map((item) => (
                  <li key={item.url}>
                    <strong>{item.title}</strong> —{" "}
                    {polyglot.t("source_recommendations.reason", {
                      topic: item.topic,
                      entries: item.evidence.entries,
                      read: item.evidence.read,
                      starred: item.evidence.starred,
                    })}
                    {item.linkedEntries > 0 && (
                      <span>
                        {" "}
                        {polyglot.t("source_recommendations.linked", { count: item.linkedEntries })}
                      </span>
                    )}
                    <p>
                      <label>
                        {polyglot.t("source_recommendations.copy_url")}{" "}
                        <input
                          readOnly
                          value={item.url}
                          onFocus={(event) => event.target.select()}
                        />
                      </label>
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p role="status">{polyglot.t("source_recommendations.catalog_unavailable")}</p>
          )}
        </>
      )}
    </section>
  )
}
export default HomeSourceRecommendations
