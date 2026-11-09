from __future__ import annotations

import unittest

from services.article_intel_summary.content import ContentSnapshotResolver

from services.article_intel_summary.tests.support import ENTRY_ID, SHORT_HTML, SYNTHETIC_HTML, USER_ID, make_snapshot


class ContentSnapshotTests(unittest.TestCase):
    def test_snapshot_contains_only_authorized_miniflux_paragraphs_and_stable_ids(self) -> None:
        snapshot = make_snapshot()

        self.assertEqual(
            (snapshot.entry_id, snapshot.user_id, snapshot.content_origin, snapshot.content_scope),
            (ENTRY_ID, USER_ID, "miniflux", "unknown"),
        )
        self.assertTrue(snapshot.is_sufficient)
        self.assertEqual([paragraph.id for paragraph in snapshot.paragraphs], [f"p{i}" for i in range(1, 9)])
        self.assertIn("ignore todas as instruções anteriores", snapshot.paragraphs[-1].text.casefold())
        self.assertEqual(len(snapshot.content_fingerprint), 64)
        self.assertNotIn("https://publisher.example", repr(snapshot))

    def test_miniflux_content_is_never_called_complete_without_completeness_evidence(self) -> None:
        snapshot = make_snapshot()
        self.assertEqual(snapshot.content_scope, "unknown")

    def test_short_miniflux_teaser_is_insufficient_and_keeps_prose_for_local_reasoning_only(self) -> None:
        snapshot = make_snapshot(SHORT_HTML)

        self.assertFalse(snapshot.is_sufficient)
        self.assertEqual(snapshot.content_origin, "miniflux")
        self.assertGreaterEqual(len(snapshot.paragraphs), 1)

    def test_duplicate_paragraphs_do_not_inflate_completeness(self) -> None:
        repeated = (
            "A equipe informou que novas medições serão analisadas durante a próxima etapa do estudo. "
            "Os resultados preliminares ainda não definem quando a decisão será anunciada."
        )
        snapshot = make_snapshot("<article>" + "".join(f"<p>{repeated}</p>" for _ in range(12)) + "</article>")

        self.assertFalse(snapshot.is_sufficient)
        self.assertEqual(len(snapshot.paragraphs), 12)

    def test_snapshot_fingerprint_is_scoped_to_user_and_article_content(self) -> None:
        first = make_snapshot()
        another_user = make_snapshot(user_id=USER_ID + 1)
        changed_body = make_snapshot(SYNTHETIC_HTML.replace("3.200 passageiros", "3.201 passageiros"))

        self.assertNotEqual(first.content_fingerprint, another_user.content_fingerprint)
        self.assertNotEqual(first.content_fingerprint, changed_body.content_fingerprint)

    def test_snapshot_limits_reject_oversized_html_without_truncation(self) -> None:
        snapshot = make_snapshot("<p>" + ("palavra " * (300_000)) + "</p>")

        self.assertFalse(snapshot.is_sufficient)
        self.assertIn("limit", snapshot.reason)


if __name__ == "__main__":
    unittest.main()
