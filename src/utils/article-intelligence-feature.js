export const ARTICLE_INTELLIGENCE_FEATURE_FLAG = "VITE_ARTICLE_INTELLIGENCE_ENABLED"

export const isArticleIntelligenceEnabled = (
  envValue = import.meta.env?.VITE_ARTICLE_INTELLIGENCE_ENABLED ??
    globalThis.process?.env?.VITE_ARTICLE_INTELLIGENCE_ENABLED,
) => envValue === "1"
