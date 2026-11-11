const isArticleIntelligenceEnabled = (
  envValue = import.meta.env?.VITE_ARTICLE_INTELLIGENCE_ENABLED ??
    globalThis.process?.env?.VITE_ARTICLE_INTELLIGENCE_ENABLED,
) => envValue === "1"

export default isArticleIntelligenceEnabled
