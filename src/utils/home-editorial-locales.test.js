import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sectionLabels = {
  "de-DE": {
    highlights: "Highlights",
    recent: "Neueste",
    infoLabel: "Warum diese Artikel?",
    info: "Artikel aus markierten Quellen können die weiteren Highlights und die neuesten Artikel beeinflussen. Das Haupt-Highlight richtet sich weiterhin nach Aktualität. Alle und Ungelesen bleiben chronologisch sortiert.",
  },
  "en-US": {
    highlights: "Highlights",
    recent: "Latest",
    infoLabel: "Why these stories?",
    info: "Starred sources can influence secondary Highlights and Latest. The lead story stays freshness-driven. All and Unread remain chronological.",
  },
  "es-ES": {
    highlights: "Destacados",
    recent: "Más recientes",
    infoLabel: "¿Por qué estas noticias?",
    info: "Las fuentes destacadas pueden influir en los destacados secundarios y en las noticias más recientes. La noticia principal sigue guiándose por la actualidad. Todas y No leídas mantienen el orden cronológico.",
  },
  "fr-FR": {
    highlights: "À la une",
    recent: "Plus récents",
    infoLabel: "Pourquoi ces articles ?",
    info: "Les sources favorites peuvent influencer les autres articles à la une et les plus récents. L’article principal reste déterminé par l’actualité. Toutes et Non lus restent chronologiques.",
  },
  "ja-JP": {
    highlights: "注目記事",
    recent: "最新記事",
    infoLabel: "この注目記事について",
    info: "スターを付けたフィードは、その他の注目記事や最新記事に影響する場合があります。最初の記事は新しさを基準に選ばれます。「すべて」と「未読」は時系列順のままです。",
  },
  "zh-CN": {
    highlights: "精选",
    recent: "最新文章",
    infoLabel: "为何推荐这些文章？",
    info: "已加星标的来源可能影响其他精选文章和最新文章。主文章仍按时效性优先。“全部”和“未读”仍按时间顺序排列。",
  },
}

test("Home editorial section headings are translated in every shipped locale", () => {
  for (const [locale, expected] of Object.entries(sectionLabels)) {
    const phrases = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    )
    assert.equal(phrases.home_page.section_highlights, expected.highlights, `${locale} highlights`)
    assert.equal(phrases.home_page.section_recent, expected.recent, `${locale} recent`)
    assert.equal(
      phrases.home_page.personalization_info_label,
      expected.infoLabel,
      `${locale} personalization label`,
    )
    assert.equal(phrases.home_page.personalization_info, expected.info, `${locale} explanation`)
  }
})
