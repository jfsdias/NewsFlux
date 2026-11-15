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
const FALLBACK_NOT_USED_OUTCOMES = new Set([
  "NOT_AVAILABLE",
  "PAID_NOT_CONSENTED",
  "CROSS_PROVIDER_NOT_CONSENTED",
  "PROVIDER_UNVERIFIED",
  "DEADLINE",
  "FAILED",
])

// v3 only: say plainly when the fallback answered (and why), or why it was not used.
const FallbackNotice = ({ provenance, modelLabels, polyglot }) => {
  const label = (id) => modelLabels?.[id] ?? id
  if (provenance.fallback_used) {
    return (
      <p className="article-intelligence-summary__meta" role="status">
        {polyglot.t(`article_intelligence.fallback_used_${provenance.fallback_reason}`, {
          primary: label(provenance.primary_model_id),
          fallback: label(provenance.fallback_model_id),
        })}
      </p>
    )
  }
  if (provenance.fallback_model_id && FALLBACK_NOT_USED_OUTCOMES.has(provenance.fallback_outcome)) {
    return (
      <p className="article-intelligence-summary__meta" role="status">
        {polyglot.t(`article_intelligence.fallback_outcome_${provenance.fallback_outcome}`, {
          fallback: label(provenance.fallback_model_id),
        })}
      </p>
    )
  }
  return null
}

const ArticleSummaryResult = ({ summary, modelLabel, modelLabels, polyglot }) => {
  const isV3 = summary.schema_version === "3"
  const isV2 = summary.schema_version === "2" || isV3
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
          model: isV3
            ? (modelLabels?.[provenance.effective_model_id] ??
              provenance.effective_model_id ??
              modelLabel ??
              "—")
            : (modelLabel ?? provenance.model_id ?? "—"),
          effective:
            (isV3 ? provenance.effective_model_alias : provenance.effective_model_id) ?? "—",
          origin: polyglot.t("article_intelligence.origin_original_miniflux"),
        })}
      </p>
      {isV3 && (
        <FallbackNotice modelLabels={modelLabels} polyglot={polyglot} provenance={provenance} />
      )}
    </div>
  )
}

export default ArticleSummaryResult
