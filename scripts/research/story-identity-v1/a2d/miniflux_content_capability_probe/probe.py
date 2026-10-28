"""Read-only, metadata-only capability probe for the frozen research corpus."""
import collections
import datetime
from html.parser import HTMLParser
import math
import re
import statistics
import unicodedata


class TextExtractor(HTMLParser):
    OMIT = {'script', 'style', 'noscript', 'nav', 'form', 'button', 'select', 'textarea'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if self.depth or tag in self.OMIT:
            if tag not in {'input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'embed', 'wbr'}:
                self.depth += 1
        elif tag not in {'input'}:
            self.parts.append(' ')

    def handle_startendtag(self, tag, attrs):
        if not self.depth and tag not in self.OMIT:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
        else:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def normalize(value):
    parser = TextExtractor()
    parser.feed(value)
    parser.close()
    return ' '.join(unicodedata.normalize('NFC', ''.join(parser.parts)).split())[:8192]


def clean_title(value):
    return ' '.join(unicodedata.normalize('NFC', value).split())


def content(value, title):
    if value is None or isinstance(value, str) and not value.strip():
        return 'EMPTY_AFTER_NORMALIZATION', 0, 0, False
    if not isinstance(value, str):
        return 'UNSUPPORTED_FORMAT', None, None, False
    text = normalize(value)
    return ('USABLE' if text else 'STRUCTURAL_ONLY', len(value), len(text), bool(text) and text == clean_title(title))


def check_request(method, path):
    if method != 'GET' or not re.fullmatch(r'/v1/entries/[1-9][0-9]*', path):
        raise ValueError('request outside read-only entry endpoint')


def retryable(status):
    return status is None or status == 429 or 500 <= status <= 599


def instant(value):
    date = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('timestamp without timezone')
    return date.astimezone(datetime.timezone.utc)


def row(frozen, status, entry, attempts):
    result = dict(article_id=frozen['id'], identity_status=None, entry_http_status=status,
                  entry_id_match=None, feed_id_match=None, title_match=None,
                  url_match=None, published_at_match=None, content_status=None,
                  raw_character_count=None, normalized_character_count=None,
                  content_equals_title=None, request_attempt_count=attempts)
    if status != 200:
        result['identity_status'] = 'ENTRY_NOT_FOUND' if status == 404 else 'SOURCE_UNAVAILABLE'
        result['content_status'] = 'IDENTITY_FAILURE' if status == 404 else 'SOURCE_FAILURE'
        return result
    try:
        result.update(entry_id_match=entry['id'] == frozen['id'], feed_id_match=entry['feed_id'] == frozen['feed_id'],
                      title_match=clean_title(entry['title']) == clean_title(frozen['title']),
                      url_match=entry['url'].strip() == frozen['url'].strip(),
                      published_at_match=instant(entry['published_at']) == instant(frozen['published_at']))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('entry identity cannot be evaluated') from None
    if not all(result[k] for k in ('entry_id_match', 'feed_id_match', 'title_match', 'url_match', 'published_at_match')):
        result.update(identity_status='IDENTITY_MISMATCH', content_status='IDENTITY_FAILURE')
        return result
    result['identity_status'] = 'IDENTITY_MATCH'
    (result['content_status'], result['raw_character_count'], result['normalized_character_count'], result['content_equals_title']) = content(entry.get('content'), frozen['title'])
    return result


def stats(values):
    values = sorted(x for x in values if x is not None and x > 0)
    return dict(min=values[0], median=statistics.median(values), p90=values[math.ceil(.9 * len(values)) - 1], max=values[-1]) if values else dict(min=None, median=None, p90=None, max=None)


def summarize(rows, target=500):
    identity = collections.Counter(r['identity_status'] for r in rows)
    contents = collections.Counter(r['content_status'] for r in rows)
    http = collections.Counter(str(r['entry_http_status']) for r in rows)
    usable = contents['USABLE']
    return dict(total_target_articles=target, identity_counts=dict(identity), content_status_counts=dict(contents),
                content_equals_title_count=sum(r['content_equals_title'] is True for r in rows),
                usable_count=usable, usable_coverage=usable / target,
                raw_character_length=stats(r['raw_character_count'] for r in rows),
                normalized_character_length=stats(r['normalized_character_count'] for r in rows),
                entry_primary_requests=len(rows), retry_requests=sum(r['request_attempt_count'] - 1 for r in rows),
                http_status_counts=dict(http))
