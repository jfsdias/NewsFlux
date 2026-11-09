from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from html.parser import HTMLParser

from services.article_intel_auth.auth import AuthorizedEntry
from services.content_fallback.content import assess_content

MAX_SOURCE_HTML_BYTES = 512 * 1024
MAX_SNAPSHOT_TEXT_BYTES = 128 * 1024
MAX_PARAGRAPHS = 200
MAX_PARAGRAPH_CHARS = 12_000


@dataclass(frozen=True)
class ArticleParagraph:
    id: str
    text: str


@dataclass(frozen=True)
class ResolvedContentSnapshot:
    entry_id: int
    user_id: int
    title: str
    content_origin: str
    source_fingerprint: str
    content_fingerprint: str
    content_scope: str
    paragraphs: tuple[ArticleParagraph, ...]
    is_sufficient: bool
    reason: str


class _ParagraphTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self._active = False
        self._current: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.casefold() == "p":
            self._commit()
            self._active = True

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "p":
            self._commit()
            self._active = False

    def handle_data(self, data: str) -> None:
        if self._active and data:
            self._current.append(data)

    def _commit(self) -> None:
        text = " ".join(" ".join(self._current).split())
        self._current.clear()
        if text:
            self.paragraphs.append(text)


class ContentSnapshotResolver:
    """Build a request-scoped Miniflux snapshot; this resolver never fetches alternate content."""

    def resolve(self, entry: AuthorizedEntry) -> ResolvedContentSnapshot:
        raw = entry.content_html
        try:
            raw_size = len(raw.encode("utf-8", errors="strict"))
        except UnicodeError:
            return self._empty(entry, "invalid_source_text")
        if raw_size > MAX_SOURCE_HTML_BYTES:
            return self._empty(entry, "source_html_limit_exceeded")

        assessment = assess_content(entry.title, raw)
        parser = _ParagraphTextParser()
        parser.feed(assessment.safe_html)
        parser.close()
        blocks = parser.paragraphs
        total_text_bytes = sum(len(block.encode("utf-8")) for block in blocks)
        if len(blocks) > MAX_PARAGRAPHS or total_text_bytes > MAX_SNAPSHOT_TEXT_BYTES:
            return self._empty(entry, "snapshot_text_limit_exceeded")
        if any(len(block) > MAX_PARAGRAPH_CHARS for block in blocks):
            return self._empty(entry, "paragraph_limit_exceeded")

        paragraphs = tuple(ArticleParagraph(id=f"p{index}", text=block) for index, block in enumerate(blocks, 1))
        source_document = {
            "entry_id": entry.entry_id,
            "user_id": entry.user_id,
            "title": entry.title,
            "content_origin": "miniflux",
            "source_fingerprint": entry.content_sha256,
            "paragraphs": [{"id": paragraph.id, "text": paragraph.text} for paragraph in paragraphs],
        }
        fingerprint = hashlib.sha256(
            json.dumps(source_document, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        sufficient = bool(assessment.sufficient and paragraphs)
        return ResolvedContentSnapshot(
            entry_id=entry.entry_id,
            user_id=entry.user_id,
            title=entry.title,
            content_origin="miniflux",
            source_fingerprint=entry.content_sha256,
            content_fingerprint=fingerprint,
            content_scope="unknown" if sufficient else ("partial" if paragraphs else "unknown"),
            paragraphs=paragraphs,
            is_sufficient=sufficient,
            reason=assessment.reason,
        )

    @staticmethod
    def _empty(entry: AuthorizedEntry, reason: str) -> ResolvedContentSnapshot:
        identity = f"{entry.entry_id}:{entry.user_id}:miniflux:{entry.content_sha256}:{reason}"
        return ResolvedContentSnapshot(
            entry_id=entry.entry_id,
            user_id=entry.user_id,
            title=entry.title,
            content_origin="miniflux",
            source_fingerprint=entry.content_sha256,
            content_fingerprint=hashlib.sha256(identity.encode("utf-8")).hexdigest(),
            content_scope="unknown",
            paragraphs=(),
            is_sufficient=False,
            reason=reason,
        )
