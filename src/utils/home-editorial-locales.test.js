import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sectionLabels = {
  "en-US": {
    highlights: "Highlights",
    recent: "Latest",
    infoLabel: "Why these stories?",
    info: "Starred sources can influence secondary Highlights and Latest. The lead story stays freshness-driven. All and Unread remain chronological.",
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
