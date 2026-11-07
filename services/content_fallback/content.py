from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from difflib import SequenceMatcher

_WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")
_SENTENCE_RE = re.compile(r"[.!?…]+(?:[\"'’”)]*)\s+|[.!?…]+$", re.UNICODE)
_TITLE_ONLY_WORD_LIMIT = 30
MIN_FULL_WORDS = 180
MIN_FULL_SENTENCES = 5
MIN_PARAGRAPH_WORDS = 12

_BLOCK_PAGE_MARKERS = (
    "just a moment",
    "verify you are human",
    "complete the captcha",
    "checking your browser",
    "enable javascript and cookies",
    "access denied",
    "automated access to this site has been denied",
    "request blocked",
)
_PAYWALL_MARKERS = (
    "subscribe to continue reading",
    "subscribe to keep reading",
    "subscription required to continue",
    "this article is for subscribers",
    "subscriber-only content",
    "sign in to read the full article",
    "unlock this article",
    "create an account to continue reading",
    "continue reading with a subscription",
    "you have reached your article limit",
)
_SKIP_TAGS = {
    "script", "style", "svg", "iframe", "nav", "header", "footer", "aside",
    "form", "button", "select", "option", "textarea", "noscript", "canvas",
    "video", "audio", "dialog",
}
_SKIP_CLASS_RE = re.compile(
    r"(?:^|[-_ ])(?:nav|menu|sidebar|toolbar|breadcrumb|cookie|advert|promo|social|"
    r"related|subscribe|paywall|subscription|modal|dialog|masthead)(?:$|[-_ ])",
    re.IGNORECASE,
)
_BLOCK_TAGS = {"p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section"}


def _clean_text(value: str) -> str:
    return _SPACE_RE.sub(" ", value).strip()


def _words(value: str) -> list[str]:
    return _WORD_RE.findall(value)


def _normalized(value: str) -> str:
    return " ".join(word.casefold() for word in _words(value))


@dataclass(frozen=True)
class _ParsedHTML:
    blocks: tuple[str, ...]
    diagnostic_text: str
    article_bodies: tuple[str, ...]
    has_article_element: bool
    has_prose_block: bool


class _HTMLTextExtractor(HTMLParser):
    def __init__(self, *, read_jsonld: bool = True) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._current: list[str] = []
        self._diagnostic: list[str] = []
        self._article_bodies: list[str] = []
        self._jsonld_chunks: list[str] | None = None
        self._read_jsonld = read_jsonld
        self._skip_depth = 0
        self._skip_tag: str | None = None
        self._skip_stack: list[str] = []
        self._has_article_element = False
        self._has_prose_block = False

    @property
    def parsed(self) -> _ParsedHTML:
        self._commit()
        return _ParsedHTML(
            blocks=tuple(self.blocks),
            diagnostic_text=_clean_text(" ".join(self._diagnostic)),
            article_bodies=tuple(self._article_bodies),
            has_article_element=self._has_article_element,
            has_prose_block=self._has_prose_block,
        )

    def _commit(self) -> None:
        text = _clean_text(" ".join(self._current))
        self._current.clear()
        if text and (not self.blocks or text != self.blocks[-1]):
            self.blocks.append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.casefold(): value or "" for key, value in attrs}
        if self._read_jsonld and tag == "script" and "ld+json" in attributes.get("type", "").casefold():
            self._jsonld_chunks = []
            self._skip_depth += 1
            self._skip_stack.append(tag)
            return
        if self._skip_depth:
            self._skip_depth += 1
            self._skip_stack.append(tag)
            return
        classes = f"{attributes.get('class', '')} {attributes.get('id', '')}"
        hidden = "hidden" in attributes or attributes.get("aria-hidden", "").casefold() == "true"
        if tag in _SKIP_TAGS or hidden or _SKIP_CLASS_RE.search(classes):
            self._skip_depth = 1
            self._skip_tag = tag
            self._skip_stack.append(tag)
            return
        if tag in {"article", "main"}:
            self._has_article_element = True
        if tag in {"p", "li", "blockquote"}:
            self._has_prose_block = True
        if tag in _BLOCK_TAGS:
            self._commit()
        elif tag == "br":
            self._current.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            if self._skip_stack:
                self._skip_stack.pop()
            self._skip_depth = max(0, self._skip_depth - 1)
            if self._skip_depth == 0:
                if self._jsonld_chunks is not None and tag == "script":
                    raw = "".join(self._jsonld_chunks).strip()
                    self._jsonld_chunks = None
                    self._article_bodies.extend(_jsonld_article_bodies(raw))
                self._skip_tag = None
            return
        if tag in _BLOCK_TAGS:
            self._commit()

    def handle_data(self, data: str) -> None:
        if self._jsonld_chunks is not None:
            self._jsonld_chunks.append(data)
            return
        if self._skip_depth:
            if self._skip_tag not in {"script", "style", "svg"}:
                self._diagnostic.append(data)
            return
        if data:
            self._current.append(data)
            self._diagnostic.append(data)


def _jsonld_article_bodies(raw: str) -> list[str]:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    result: list[str] = []

    def visit(node: object) -> None:
        if isinstance(node, dict):
            body = node.get("articleBody")
            if isinstance(body, str) and body.strip():
                result.append(body)
            for child in node.values():
                if isinstance(child, (dict, list)):
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return result


def _parse(value: str, *, read_jsonld: bool = True) -> _ParsedHTML:
    parser = _HTMLTextExtractor(read_jsonld=read_jsonld)
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        # HTMLParser is intentionally tolerant; an incomplete publisher document should
        # still be assessed using the text seen before the malformed fragment.
        pass
    return parser.parsed


def _text_and_blocks(value: str) -> tuple[str, tuple[str, ...]]:
    parsed = _parse(value, read_jsonld=False)
    return _clean_text(" ".join(parsed.blocks)), parsed.blocks


@dataclass(frozen=True)
class ContentAssessment:
    state: str
    reason: str
    word_count: int
    sentence_count: int
    paragraph_count: int
    article_signal: bool
    prose_block_signal: bool
    blocked_page: bool
    paywall_signal: bool
    fingerprint: str
    safe_html: str

    @property
    def sufficient(self) -> bool:
        return self.state == "SUFFICIENT"

    def public_dict(self) -> dict[str, object]:
        return {
            "state": self.state,
            "reason": self.reason,
            "word_count": self.word_count,
            "sentence_count": self.sentence_count,
            "paragraph_count": self.paragraph_count,
        }


def assess_content(title: str, content_html: str) -> ContentAssessment:
    """Assess prose quality and extraction signals; character count is never sufficient."""

    parsed = _parse(content_html)
    body_blocks = list(parsed.blocks)
    body_text = _clean_text(" ".join(body_blocks))
    article_signal = parsed.has_article_element
    prose_block_signal = parsed.has_prose_block

    # JSON-LD often carries the publisher's full articleBody even when visible markup
    # contains only a teaser. Prefer it when it is materially more substantial.
    jsonld_text = ""
    jsonld_blocks: tuple[str, ...] = ()
    for raw_body in parsed.article_bodies:
        candidate_text, candidate_blocks = _text_and_blocks(raw_body)
        if len(_words(candidate_text)) > len(_words(jsonld_text)):
            jsonld_text = candidate_text
            jsonld_blocks = candidate_blocks
    visible_words = len(_words(body_text))
    jsonld_words = len(_words(jsonld_text))
    if jsonld_words >= max(visible_words + 50, int(visible_words * 1.35)):
        body_text = jsonld_text
        body_blocks = list(jsonld_blocks)
        article_signal = True
        prose_block_signal = True

    normalized = _normalized(body_text)
    title_normalized = _normalized(title)
    word_list = _words(body_text)
    word_count = len(word_list)
    sentence_count = len(_SENTENCE_RE.findall(body_text))
    paragraph_count = sum(1 for block in body_blocks if len(_words(block)) >= MIN_PARAGRAPH_WORDS)
    diagnostic = parsed.diagnostic_text.casefold()
    blocked_page = any(marker in diagnostic[:1800] for marker in _BLOCK_PAGE_MARKERS)
    paywall_signal = word_count < MIN_FULL_WORDS and any(
        marker in diagnostic[:3000] for marker in _PAYWALL_MARKERS
    )
    title_only = False
    if title_normalized and word_count <= _TITLE_ONLY_WORD_LIMIT:
        title_only = normalized == title_normalized or SequenceMatcher(
            None, normalized, title_normalized
        ).ratio() >= 0.92

    if not body_text:
        state, reason = "EMPTY", "no_text"
    elif blocked_page:
        state, reason = "TEASER", "block_page_marker"
    elif paywall_signal:
        state, reason = "TEASER", "paywall_marker"
    elif title_only:
        state, reason = "TEASER", "title_only"
    elif (
        (word_count < 40 and not article_signal and not prose_block_signal)
        or (paragraph_count == 0 and not article_signal and not prose_block_signal and sentence_count < 2)
    ):
        state, reason = "STRUCTURAL_ONLY", "insufficient_prose_structure"
    elif (
        word_count >= MIN_FULL_WORDS
        and sentence_count >= MIN_FULL_SENTENCES
        and (paragraph_count >= 2 or article_signal)
    ):
        state, reason = "SUFFICIENT", "prose_and_structure"
    else:
        state, reason = "TEASER", "short_or_partial_prose"

    safe_html = "".join(f"<p>{html.escape(block, quote=False)}</p>" for block in body_blocks if block)
    fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return ContentAssessment(
        state=state,
        reason=reason,
        word_count=word_count,
        sentence_count=sentence_count,
        paragraph_count=paragraph_count,
        article_signal=article_signal,
        prose_block_signal=prose_block_signal,
        blocked_page=blocked_page,
        paywall_signal=paywall_signal,
        fingerprint=fingerprint,
        safe_html=safe_html,
    )


def passes_recovery(original: ContentAssessment, candidate: ContentAssessment) -> bool:
    """Accept only a validated article that adds meaningful content over the stored feed."""

    if not candidate.sufficient or candidate.blocked_page or candidate.paywall_signal:
        return False
    minimum_gain = max(30, int(original.word_count * 0.15))
    return (
        candidate.fingerprint != original.fingerprint
        and candidate.word_count >= MIN_FULL_WORDS
        and candidate.word_count >= original.word_count + minimum_gain
    )
