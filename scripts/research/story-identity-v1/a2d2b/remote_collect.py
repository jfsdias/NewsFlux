"""Server-side GET-only capture. Stdout is private projected JSON, never raw HTTP."""
import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PAGE_SIZE = 20
MAX_RESPONSE_BYTES = 128 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect refused')


def request_json(base, token, path, method='GET'):
    if method != 'GET':
        raise ValueError('only GET is permitted')
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('invalid endpoint')
    request = Request(base.rstrip('/') + path, headers={'X-Auth-Token': token, 'Accept': 'application/json'}, method='GET')
    with build_opener(NoRedirect).open(request, timeout=45) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError('response exceeds process safety bound')
        return json.loads(raw), len(raw)


def project_entry(entry):
    feed = entry.get('feed') or {}
    category = feed.get('category') or {}
    result = {key: entry.get(key) for key in ('id', 'feed_id', 'title', 'url', 'published_at', 'created_at', 'status', 'language')}
    result.update(feed_title=feed.get('title'), category_id=category.get('id'))
    return result


def check_page(entries, cursor, seen):
    if not entries:
        return None
    previous = cursor
    for entry in entries:
        ident = entry.get('id')
        if not isinstance(ident, int) or ident >= previous or ident in seen:
            raise ValueError('ID cursor did not advance uniquely')
        seen.add(ident)
        previous = ident
    return previous


def enumerate_entries(base, token, cutoff, maximum):
    second = int(datetime.fromisoformat(cutoff.replace('Z', '+00:00')).timestamp())
    cursor, rows, seen = maximum + 1, [], set()
    pages = max_bytes = max_projected = 0
    total = None
    while True:
        query = {'globally_visible': 'true', 'order': 'id', 'direction': 'desc',
                 'before_entry_id': cursor, 'published_after': second - 604801,
                 'published_before': second + 1, 'limit': PAGE_SIZE}
        data, size = request_json(base, token, '/v1/entries?' + urlencode(query))
        pages += 1
        max_bytes = max(max_bytes, size)
        if total is None:
            total = data.get('total')
        entries = data.get('entries')
        if not isinstance(entries, list):
            raise ValueError('invalid entry page')
        next_cursor = check_page(entries, cursor, seen)
        projected = [project_entry(entry) for entry in entries]
        max_projected = max([max_projected] + [len(json.dumps(e, ensure_ascii=False).encode()) for e in projected])
        rows.extend(projected)
        del data, entries, projected
        if next_cursor is None:
            break
        cursor = next_cursor
    return {'rows': rows, 'pages': pages, 'api_total': total, 'max_response_bytes': max_bytes,
            'max_projected_entry_bytes': max_projected, 'terminal_empty': True}


def main():
    base, token = os.environ.get('MINIFLUX_URL'), os.environ.get('MINIFLUX_API_TOKEN')
    if not base or not token:
        raise ValueError('server-side configuration unavailable')
    cutoff = datetime.now(timezone.utc).isoformat()
    latest, _ = request_json(base, token, '/v1/entries?order=id&direction=desc&limit=1')
    maximum = latest['entries'][0]['id']
    feeds, _ = request_json(base, token, '/v1/feeds')
    known_feeds = [feed['id'] for feed in feeds]
    first = enumerate_entries(base, token, cutoff, maximum)
    second = enumerate_entries(base, token, cutoff, maximum)
    if [x['id'] for x in first['rows']] != [x['id'] for x in second['rows']]:
        raise ValueError('snapshot replay differs')
    json.dump({'cutoff': cutoff, 'max_entry_id': maximum, 'known_feeds': known_feeds,
               'pass1': first, 'pass2': second}, sys.stdout, ensure_ascii=False, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('CAPTURE_ERROR=' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
