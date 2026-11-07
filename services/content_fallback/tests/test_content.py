from __future__ import annotations

import json
import unittest

from services.content_fallback.content import assess_content, passes_recovery


def full_article_html() -> str:
    paragraphs = []
    for index in range(8):
        paragraphs.append(
            "<p>Researchers reported that the coastal sensors recorded a clear change in the "
            f"local current during observation period {index}. The team compared those readings "
            "with earlier measurements and found a consistent pattern across several sites. "
            "Independent analysts said the results need another season of study before policy "
            "makers can draw broader conclusions from the evidence.</p>"
        )
    return "<article><h1>Research Update</h1>" + "".join(paragraphs) + "</article>"


class ContentAssessmentTests(unittest.TestCase):
    def test_void_tags_inside_nested_skip_regions_do_not_hide_article(self) -> None:
        raw = (
            "<header><img src='/logo.png'><nav>Home<br><input></header>"
            "<footer><a href='/about'>About</a></footer>"
            + full_article_html()
        )

        result = assess_content("Research Update", raw)

        self.assertEqual(result.state, "SUFFICIENT")
        self.assertNotIn("Home", result.safe_html)
        self.assertNotIn("About", result.safe_html)
        self.assertIn("Researchers reported", result.safe_html)

    def test_content_already_complete_requires_prose_and_structure(self) -> None:
        result = assess_content("Research Update", full_article_html())
        self.assertEqual(result.state, "SUFFICIENT")
        self.assertGreaterEqual(result.word_count, 180)
        self.assertGreaterEqual(result.sentence_count, 5)
        self.assertGreaterEqual(result.paragraph_count, 2)

    def test_content_empty(self) -> None:
        result = assess_content("Research Update", "")
        self.assertEqual((result.state, result.reason), ("EMPTY", "no_text"))

    def test_content_teaser_and_paywall_marker(self) -> None:
        teaser = (
            "<article><p>Researchers described a change in the coastal current and shared "
            "several early measurements. The team will continue to review the findings "
            "during the next observation period.</p></article>"
            "<button>Subscribe to continue reading</button>"
        )
        result = assess_content("Research Update", teaser)
        self.assertEqual(result.state, "TEASER")
        self.assertTrue(result.paywall_signal)
        self.assertEqual(result.reason, "paywall_marker")

    def test_content_structural_only(self) -> None:
        result = assess_content("Research Update", "<div class='menu'>Home News Sections</div><div>Log in</div>")
        self.assertEqual(result.state, "STRUCTURAL_ONLY")

    def test_jsonld_article_body_can_supply_full_prose(self) -> None:
        full_text = " ".join(
            "Scientists compared the measurements across several independent observation sites."
            for _ in range(30)
        )
        raw = "<article><p>A brief publisher teaser.</p></article>" + (
            '<script type="application/ld+json">'
            + json.dumps({"@type": "NewsArticle", "articleBody": full_text})
            + "</script>"
        )
        result = assess_content("Research Update", raw)
        self.assertEqual(result.state, "SUFFICIENT")
        self.assertTrue(result.article_signal)
        self.assertNotIn("application/ld+json", result.safe_html)

    def test_wallhop_block_page_with_http_200_is_not_sufficient(self) -> None:
        result = assess_content(
            "Research Update",
            "<html><body><main><h1>Just a moment</h1><p>Verify you are human to continue.</p></main></body></html>",
        )
        self.assertEqual(result.state, "TEASER")
        self.assertTrue(result.blocked_page)

    def test_structural_markup_and_scripts_do_not_become_article_content(self) -> None:
        result = assess_content(
            "Research Update",
            "<nav>Home Latest Local</nav><script>alert(1)</script><p>Only a short teaser.</p>",
        )
        self.assertNotIn("alert", result.safe_html)
        self.assertNotIn("<script", result.safe_html)
        self.assertEqual(result.state, "TEASER")

    def test_partial_candidate_does_not_replace_original(self) -> None:
        original = assess_content("Research Update", "<p>Short feed teaser.</p>")
        partial = assess_content("Research Update", "<article><p>" + ("Partial words here. " * 28) + "</p></article>")
        self.assertFalse(passes_recovery(original, partial))

    def test_recovered_content_must_add_meaningful_text(self) -> None:
        original = assess_content("Research Update", "<p>Short feed teaser.</p>")
        full = assess_content("Research Update", full_article_html())
        self.assertTrue(passes_recovery(original, full))
        self.assertFalse(passes_recovery(full, full))


if __name__ == "__main__":
    unittest.main()
