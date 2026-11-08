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
_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
_SKIP_CLASS_RE = re.compile(
    r"(?:^|[-_ ])(?:nav|menu|sidebar|toolbar|breadcrumb|cookie|advert|promo|social|"
    r"related|subscribe|paywall|subscription|modal|dialog|masthead)(?:$|[-_ ])",
    re.IGNORECASE,
)
_BLOCK_TAGS = {"p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section"}
_WALLHOP_HEADER_RE = re.compile(r"wallhop(?:\.io)?", re.IGNORECASE)
_WALLHOP_FOOTER_MARKERS = (
    re.compile(r"\bwafflehacker\b", re.IGNORECASE),
    re.compile(r"\beverywall\b", re.IGNORECASE),
    re.compile(r"\bladder\b", re.IGNORECASE),
    re.compile(r"\bgpl[-\s]?3\.0\b", re.IGNORECASE),
)
_WALLHOP_FOOTER_WINDOW = 6
_WALLHOP_FOOTER_MAX_WORDS = 60
_WALLHOP_FOOTER_CONTEXT = (
    "help keep wallhop running on ko fi",
    "wafflehacker dev project",
    "heavily modified and tuned by wafflehacker",
    "built on the open source everywall ladder",
)


def _clean_text(value: str) -> str:
    return _SPACE_RE.sub(" ", value).strip()


def _words(value: str) -> list[str]:
    return _WORD_RE.findall(value)


def _normalized(value: str) -> str:
    return " ".join(word.casefold() for word in _words(value))


@dataclass(frozen=True)
class _ParsedHTML:
    blocks: tuple[str, ...]
    block_tags: tuple[str, ...]
    block_in_content: tuple[bool, ...]
    diagnostic_text: str
    article_bodies: tuple[str, ...]
    has_article_element: bool
    has_prose_block: bool


class _HTMLTextExtractor(HTMLParser):
    def __init__(self, *, read_jsonld: bool = True) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self.block_tags: list[str] = []
        self.block_in_content: list[bool] = []
        self._current: list[str] = []
        self._current_block_tag = ""
        self._current_block_in_content = False
        self._diagnostic: list[str] = []
        self._article_bodies: list[str] = []
        self._jsonld_chunks: list[str] | None = None
        self._read_jsonld = read_jsonld
        self._skip_tag: str | None = None
        self._skip_stack: list[str] = []
        self._has_article_element = False
        self._has_prose_block = False
        self._content_depth = 0

    @property
    def parsed(self) -> _ParsedHTML:
        self._commit()
        return _ParsedHTML(
            blocks=tuple(self.blocks),
            block_tags=tuple(self.block_tags),
            block_in_content=tuple(self.block_in_content),
            diagnostic_text=_clean_text(" ".join(self._diagnostic)),
            article_bodies=tuple(self._article_bodies),
            has_article_element=self._has_article_element,
            has_prose_block=self._has_prose_block,
        )

    def _commit(self) -> None:
        text = _clean_text(" ".join(self._current))
        self._current.clear()
        if text:
            self.blocks.append(text)
            self.block_tags.append(self._current_block_tag)
            self.block_in_content.append(self._current_block_in_content)
        self._current_block_tag = ""
        self._current_block_in_content = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        attributes = {key.casefold(): value or "" for key, value in attrs}
        if self._read_jsonld and tag == "script" and "ld+json" in attributes.get("type", "").casefold():
            self._jsonld_chunks = []
            if not self._skip_stack:
                self._skip_tag = tag
            self._skip_stack.append(tag)
            return
        if self._skip_stack:
            if tag not in _VOID_TAGS:
                self._skip_stack.append(tag)
            return
        classes = f"{attributes.get('class', '')} {attributes.get('id', '')}"
        hidden = "hidden" in attributes or attributes.get("aria-hidden", "").casefold() == "true"
        if tag in _SKIP_TAGS or hidden or _SKIP_CLASS_RE.search(classes):
            self._skip_tag = tag
            if tag not in _VOID_TAGS:
                self._skip_stack.append(tag)
            return
        if tag in {"article", "main"}:
            self._commit()
            self._has_article_element = True
            self._content_depth += 1
        if tag in {"p", "li", "blockquote"}:
            self._has_prose_block = True
        if tag in _BLOCK_TAGS:
            self._commit()
            if tag not in {"div", "section"}:
                self._current_block_tag = tag
                self._current_block_in_content = self._content_depth > 0
        elif tag == "br":
            self._current.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if self._skip_stack:
            if tag in _VOID_TAGS or tag not in self._skip_stack:
                return
            index = len(self._skip_stack) - 1 - self._skip_stack[::-1].index(tag)
            removed = self._skip_stack[index:]
            del self._skip_stack[index:]
            if self._jsonld_chunks is not None and "script" in removed:
                chunks = self._jsonld_chunks
                self._jsonld_chunks = None
                if tag == "script":
                    self._article_bodies.extend(_jsonld_article_bodies("".join(chunks).strip()))
            self._skip_tag = self._skip_stack[0] if self._skip_stack else None
            return
        if tag in {"article", "main"}:
            self._commit()
            self._content_depth = max(0, self._content_depth - 1)
            return
        if tag in _BLOCK_TAGS:
            self._commit()

    def handle_data(self, data: str) -> None:
        if self._jsonld_chunks is not None:
            self._jsonld_chunks.append(data)
            return
        if self._skip_stack:
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


def _safe_html_from_blocks(blocks: list[str] | tuple[str, ...]) -> str:
    return "".join(f"<p>{html.escape(block, quote=False)}</p>" for block in blocks if block)


def _is_wallhop_provider_footer(block: str) -> bool:
    if len(_words(block)) > _WALLHOP_FOOTER_MAX_WORDS:
        return False
    if not all(marker.search(block) for marker in _WALLHOP_FOOTER_MARKERS):
        return False
    normalized = _normalized(block)
    return (
        all(context in normalized for context in _WALLHOP_FOOTER_CONTEXT)
    )


def clean_wallhop_content(
    content_html: str, *, source_html: str | None = None
) -> tuple[str, str]:
    """Remove only high-confidence WallHop chrome from sanitized text blocks.

    Ambiguous provider-like blocks are left intact and reported to the caller so it can
    reject the candidate instead of guessing which text is editorial.
    """
    blocks = list(_parse(content_html, read_jsonld=False).blocks)
    if not blocks:
        return "", "no_provider_chrome"

    source = _parse(source_html if source_html is not None else content_html, read_jsonld=False)

    remove: set[int] = set()
    header_positions = [
        index for index, block in enumerate(blocks)
        if _WALLHOP_HEADER_RE.fullmatch(block.strip())
    ]
    footer_positions: list[int] = []
    tail_start = max(0, len(blocks) - _WALLHOP_FOOTER_WINDOW)
    for index, block in enumerate(blocks):
        marker_count = sum(bool(marker.search(block)) for marker in _WALLHOP_FOOTER_MARKERS)
        if _is_wallhop_provider_footer(block):
            if index < tail_start:
                return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"
            footer_positions.append(index)
        elif index >= tail_start and marker_count >= 3:
            return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"

    if len(footer_positions) > 1:
        return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"
    remove.update(footer_positions)

    for index in header_positions:
        if index > 2 or len(blocks) < 2:
            return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"
        source_block = source.blocks[index] if index < len(source.blocks) else ""
        source_tag = source.block_tags[index] if index < len(source.block_tags) else ""
        in_content = source.block_in_content[index] if index < len(source.block_in_content) else False
        if not _WALLHOP_HEADER_RE.fullmatch(source_block.strip()):
            return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"
        # A heading inside the publisher's article is editorial, even if its text is
        # exactly "WallHop". The provider banner is a standalone paragraph outside
        # the article, immediately followed by publisher article content.
        if in_content or source_tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            continue
        has_article_following = any(source.block_in_content[index + 1 :])
        legacy_body_end = footer_positions[0] if footer_positions else len(blocks)
        has_legacy_article_body = sum(
            len(_words(block)) >= MIN_PARAGRAPH_WORDS
            for block in blocks[index + 1 : legacy_body_end]
        ) >= 2
        if source_tag == "p" and has_article_following:
            remove.add(index)
        elif (
            footer_positions
            and index == 1
            and has_legacy_article_body
        ):
            # Legacy cache HTML has already lost its article wrapper. The exact
            # funding, project, and license footer signature corroborates the
            # isolated paragraph-two banner before a substantive cached article.
            remove.add(index)
        else:
            return _safe_html_from_blocks(blocks), "ambiguous_provider_chrome"

    cleaned = [block for index, block in enumerate(blocks) if index not in remove]
    reason = "provider_chrome_removed" if remove else "no_provider_chrome"
    return _safe_html_from_blocks(cleaned), reason


@dataclass(frozen=True)
class ContentAssessment:
    state: str
    reason: str
    word_count: int
    sentence_count: int
    paragraph_count: int
    quality_word_count: int
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
    # Keep every publisher block in safe_html, but do not let duplicate blocks
    # inflate the evidence used to classify a teaser as full text.
    quality_blocks: list[str] = []
    seen_quality_blocks: set[str] = set()
    for block in body_blocks:
        block_normalized = _normalized(block)
        if block_normalized and block_normalized not in seen_quality_blocks:
            seen_quality_blocks.add(block_normalized)
            quality_blocks.append(block)
    quality_text = _clean_text(" ".join(quality_blocks))
    quality_word_count = len(_words(quality_text))
    quality_sentence_count = len(_SENTENCE_RE.findall(quality_text))
    quality_paragraph_count = sum(
        1 for block in quality_blocks if len(_words(block)) >= MIN_PARAGRAPH_WORDS
    )
    diagnostic = parsed.diagnostic_text.casefold()
    blocked_page = any(marker in diagnostic[:1800] for marker in _BLOCK_PAGE_MARKERS)
    paywall_signal = quality_word_count < MIN_FULL_WORDS and any(
        marker in diagnostic[:3000] for marker in _PAYWALL_MARKERS
    )
    title_only = False
    if title_normalized and quality_word_count <= _TITLE_ONLY_WORD_LIMIT:
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
        (quality_word_count < 40 and not article_signal and not prose_block_signal)
        or (
            quality_paragraph_count == 0
            and not article_signal
            and not prose_block_signal
            and quality_sentence_count < 2
        )
    ):
        state, reason = "STRUCTURAL_ONLY", "insufficient_prose_structure"
    elif (
        quality_word_count >= MIN_FULL_WORDS
        and quality_sentence_count >= MIN_FULL_SENTENCES
        and (quality_paragraph_count >= 2 or article_signal)
    ):
        state, reason = "SUFFICIENT", "prose_and_structure"
    else:
        state, reason = "TEASER", "short_or_partial_prose"

    safe_html = _safe_html_from_blocks(body_blocks)
    fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return ContentAssessment(
        state=state,
        reason=reason,
        word_count=word_count,
        sentence_count=sentence_count,
        paragraph_count=paragraph_count,
        quality_word_count=quality_word_count,
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
    minimum_gain = max(30, int(original.quality_word_count * 0.15))
    return (
        candidate.fingerprint != original.fingerprint
        and candidate.quality_word_count >= MIN_FULL_WORDS
        and candidate.quality_word_count >= original.quality_word_count + minimum_gain
    )
