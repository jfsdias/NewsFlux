import { SECTION_RESPONSE_FIELDS } from "@/utils/article-intelligence-profile"

const PointList = ({ points }) => (
  <ul>
    {points.map((point, index) => (
      <li key={`${point.paragraph_ids.join("-")}-${index}`}>{point.text}</li>
    ))}
  </ul>
)

const SECTION_TITLES = {
  key_points: "article_intelligence.key_points",
  facts: "article_intelligence.section_facts",
  implications: "article_intelligence.section_implications",
  actions: "article_intelligence.action_points",
  limitations: "article_intelligence.section_limitations",
}

// Renders the validated summary. Requested sections without evidence are shown as
// explicitly unavailable instead of being filled with invented content.
const ArticleSummaryResult = ({ summary, modelLabel, polyglot }) => {
  const isV2 = summary.schema_version === "2"
  const sections = isV2
    ? summary.profile.sections.filter((section) => section !== "summary")
    : ["key_points", ...(summary.action_points.length > 0 ? ["actions"] : [])]
  const { provenance } = summary

  return (
    <div className="article-intelligence-summary__result">
      <h2>{polyglot.t("article_intelligence.summary")}</h2>
      <p>{summary.summary}</p>
      {sections.map((section) => {
        const points = summary[SECTION_RESPONSE_FIELDS[section]] ?? []
        return (
          <div key={section}>
            <h3>{polyglot.t(SECTION_TITLES[section])}</h3>
            {points.length > 0 ? (
              <PointList points={points} />
            ) : (
              <p className="article-intelligence-summary__empty">
                {polyglot.t("article_intelligence.section_not_supported")}
              </p>
            )}
          </div>
        )
      })}
      {(summary.status === "partial" || summary.content_scope !== "full") && (
        <p className="article-intelligence-summary__status" role="status">
          {polyglot.t("article_intelligence.partial_content")}
        </p>
      )}
      {summary.limitations.length > 0 && (
        <>
          <h3>{polyglot.t("article_intelligence.limitations")}</h3>
          <ul>
            {summary.limitations.map((limitation, index) => (
              <li key={`${index}-${limitation.slice(0, 24)}`}>{limitation}</li>
            ))}
          </ul>
        </>
      )}
      <p className="article-intelligence-summary__meta">
        {polyglot.t("article_intelligence.provenance_line", {
          model: modelLabel ?? provenance.model_id ?? "—",
          effective: provenance.effective_model_id ?? "—",
          origin: polyglot.t("article_intelligence.origin_original_miniflux"),
        })}
      </p>
    </div>
  )
}

export default ArticleSummaryResult
