"""WallHop contract audit tool: refusals and bounded behaviour. Synthetic fetcher only; no network."""
from __future__ import annotations

import contextlib
import io
import json
import os
import stat
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import wallhop_contract_audit as audit

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
TOKEN = "OPERATOR_APPROVED_20261115"


class AuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.approved = self.dir / "approved.json"
        self.approved.write_text(json.dumps(self.sources("example-public.org")))
        self.calls = []

    @staticmethod
    def sources(*domains, **overrides):
        entry = {"public_without_login": True, "terms_permit_automated_retrieval": True, "terms_reviewed_url": "https://example-public.org/terms"}
        entry.update(overrides)
        return {"version": "wallhop-approved-sources-v1", "approved_by": "operator", "approved_at": "2026-11-15",
                "sources": [{"domain": d, **entry} for d in domains]}

    def fetch(self, url):
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            return 200, {"Content-Type": "text/plain"}, b"User-agent: *\n"
        if "/raw/" in url:
            return 200, {"Content-Type": "text/html; charset=utf-8", "X-RateLimit-Remaining": "9", "Set-Cookie": "s=secret"}, b"<html>article</html>"
        return 200, {"Content-Type": "text/html"}, b"<html>home</html>"

    def main(self, *args, token=TOKEN):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = audit.main(
                ["--approved-sources", str(self.approved), "--out-dir", str(self.dir / "out"), *args],
                fetch=self.fetch, now=NOW, environ={"WALLHOP_AUDIT_AUTHORIZATION": token} if token else {},
            )
        return code, out.getvalue()

    def test_bounded_read_only_audit_with_private_output(self) -> None:
        code, text = self.main("--article-url", "https://news.example-public.org/a/1")
        self.assertEqual(code, 0, text)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[2], "https://wallhop.io/raw/https://news.example-public.org/a/1")
        report = json.loads((self.dir / "out" / "report.json").read_text())
        self.assertEqual(report["requests"]["raw_article"]["rate_limit_headers"], ["x-ratelimit-remaining"])
        self.assertEqual(report["contract_status"], "OBSERVED_NEEDS_OPERATOR_REVIEW")
        self.assertEqual(stat.S_IMODE(os.stat(self.dir / "out").st_mode), 0o700)
        self.assertNotIn("secret", text + json.dumps(report))
        self.assertNotIn("article</html>", text)

    def test_refusals_happen_before_any_request(self) -> None:
        for args, token, code_text in (
            (("--article-url", "https://news.example-public.org/a"), None, "AUTHORIZATION_MISSING_OR_NOT_TODAY"),
            (("--article-url", "https://news.example-public.org/a"), "OPERATOR_APPROVED_20261114", "AUTHORIZATION_MISSING_OR_NOT_TODAY"),
            (("--article-url", "http://news.example-public.org/a"), TOKEN, "ARTICLE_URL_MUST_BE_PLAIN_HTTPS"),
            (("--article-url", "https://www.nytimes.com/a"), TOKEN, "ARTICLE_DOMAIN_IS_PAYWALLED"),
            (("--article-url", "https://other.org/a"), TOKEN, "ARTICLE_DOMAIN_NOT_OPERATOR_APPROVED"),
            (("--article-url", "https://user:pw@news.example-public.org/a"), TOKEN, "ARTICLE_URL_MUST_BE_PLAIN_HTTPS"),
        ):
            code, text = self.main(*args, token=token)
            self.assertEqual(code, 1, args)
            self.assertIn(f"CODE={code_text}", text)
        self.assertEqual(self.calls, [])

    def test_paywalled_domain_cannot_be_approved_into_scope(self) -> None:
        self.approved.write_text(json.dumps(self.sources("nytimes.com")))
        code, text = self.main("--article-url", "https://www.nytimes.com/a")
        self.assertIn("ARTICLE_DOMAIN_IS_PAYWALLED", text)
        self.assertEqual(self.calls, [])

    def test_draft_evidence_never_passes_the_contract_gate_alone(self) -> None:
        code, _ = self.main("--article-url", "https://news.example-public.org/a/1")
        self.assertEqual(code, 0)
        draft = json.loads((self.dir / "out" / "contract-evidence.draft.json").read_text())
        self.assertEqual(draft["version"], "wallhop-contract-evidence-v1")
        self.assertFalse(draft["terms_reviewed"])
        self.assertIsNone(draft["checked_by"])
        self.assertEqual(draft["sample_domain"], "news.example-public.org")

    def test_sources_without_terms_evidence_are_refused(self) -> None:
        for overrides in ({"public_without_login": False}, {"terms_permit_automated_retrieval": False}, {"terms_reviewed_url": "http://x"}):
            self.approved.write_text(json.dumps(self.sources("example-public.org", **overrides)))
            code, text = self.main("--article-url", "https://news.example-public.org/a")
            self.assertIn("APPROVED_SOURCES_MALFORMED", text, overrides)
        self.approved.write_text(json.dumps(["example-public.org"]))
        code, text = self.main("--article-url", "https://news.example-public.org/a")
        self.assertIn("APPROVED_SOURCES_MALFORMED", text)
        self.assertEqual(self.calls, [])

    def test_existing_output_directory_is_never_overwritten(self) -> None:
        (self.dir / "out").mkdir()
        code, text = self.main("--article-url", "https://news.example-public.org/a")
        self.assertIn("OUT_DIR_EXISTS", text)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
