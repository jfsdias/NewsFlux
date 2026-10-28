"""Single bounded corpus probe. Never records entry payloads or credentials."""
import datetime
import collections
import email.utils
import hashlib
import http.client
import json
import os
from pathlib import Path
import shlex
import ssl
import sys
import tempfile
import time
from urllib.parse import urlsplit
import probe

CORPUS = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
CONTRACT_ROOT = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-content-enrichment-contract/attempt-20261028-d2e1-v1'
CONTRACT = CONTRACT_ROOT / 'fresh-content-enrichment-contract-v1.json'
MANIFEST = CONTRACT_ROOT / 'fresh-content-enrichment-contract-manifest-v1.json'
INPUTS = {CORPUS: '3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206', CONTRACT: '6186c896b5f16398391f63387aae1018e5431d88ccd9a43b450c94fe0e2ae260', MANIFEST: '422b3140c8292c95feff864f262ee17ea0f74c27a575f3004a873dcb40dbf343'}
COUNTS = collections.Counter()
RETRY_DELAY = 0.25
FIELDS = {'article_id','identity_status','entry_http_status','entry_id_match','feed_id_match','title_match','url_match','published_at_match','content_status','raw_character_count','normalized_character_count','content_equals_title','request_attempt_count'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_inputs():
    if any(digest(p) != value for p, value in INPUTS.items()):
        raise RuntimeError('input hash mismatch')
    rows = [json.loads(line) for line in CORPUS.read_text().splitlines()]
    if len(rows) != 500 or len({r['id'] for r in rows}) != 500 or len({r['feed_id'] for r in rows}) != 52 or len({r['category_id'] for r in rows}) != 11:
        raise RuntimeError('invalid corpus identity counts')
    if any(type(r['id']) is not int or r['id'] <= 0 or type(r['feed_id']) is not int or not isinstance(r['title'], str) or not isinstance(r['url'], str) or not r['url'].strip() for r in rows):
        raise RuntimeError('invalid frozen identity')
    for r in rows:
        probe.instant(r['published_at'])
    return rows


def credentials():
    directory = Path.home() / '.config/newsflux-research'
    file = directory / 'miniflux-direct.env'
    if directory.stat().st_mode & 0o777 != 0o700 or file.stat().st_mode & 0o777 != 0o600:
        raise RuntimeError('credential permissions mismatch')
    values = {}
    for line in file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        line = line.removeprefix('export ')
        name, sep, value = line.partition('=')
        if not sep or name not in {'MINIFLUX_BASE_URL', 'MINIFLUX_API_TOKEN'} or name in values:
            raise RuntimeError('unexpected credential configuration')
        parts = shlex.split(value)
        if len(parts) != 1:
            raise RuntimeError('unsupported credential encoding')
        values[name] = parts[0]
    if set(values) != {'MINIFLUX_BASE_URL', 'MINIFLUX_API_TOKEN'}:
        raise RuntimeError('incomplete credential configuration')
    u = urlsplit(values['MINIFLUX_BASE_URL'])
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
        raise RuntimeError('invalid direct endpoint')
    return u, values['MINIFLUX_API_TOKEN']


def request(origin, token, article_id):
    global RETRY_DELAY
    path = f'/v1/entries/{article_id}'
    COUNTS['attempts'] += 1
    if COUNTS['attempts'] > 1000:
        raise RuntimeError('request budget exceeded')
    probe.check_request('GET', path)
    conn = None
    try:
        if origin.scheme == 'https':
            conn = http.client.HTTPSConnection(origin.hostname, origin.port, timeout=10, context=ssl.create_default_context())
        else:
            conn = http.client.HTTPConnection(origin.hostname, origin.port, timeout=10)
        conn.connect()
        conn.sock.settimeout(30)
        conn.request('GET', path, headers={'X-Auth-Token': token, 'Accept':'application/json', 'User-Agent':'NewsFlux-Research-D2E2/1.0'})
        response = conn.getresponse()
        status = response.status
        RETRY_DELAY = 0.25
        retry_after = response.getheader('Retry-After')
        if retry_after and status == 429:
            try:
                RETRY_DELAY = max(0.0, float(retry_after))
            except ValueError:
                try:
                    when = email.utils.parsedate_to_datetime(retry_after)
                    RETRY_DELAY = max(0.0, (when - datetime.datetime.now(datetime.timezone.utc)).total_seconds())
                except (ValueError, TypeError, OverflowError):
                    raise RuntimeError('invalid retry-after header') from None
            if RETRY_DELAY > 60:
                raise RuntimeError('retry-after exceeds safe execution window')
        if status == 200:
            payload = response.read()
            COUNTS['http_' + str(status)] += 1
            try:
                entry = json.loads(payload)
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise RuntimeError('invalid entry response') from None
            if not isinstance(entry, dict):
                raise RuntimeError('invalid entry representation')
            return status, entry
        response.read()
        COUNTS['http_' + str(status)] += 1
        return status, None
    except (OSError, http.client.HTTPException, ssl.SSLError):
        COUNTS['transport_failure'] += 1
        return None, None
    finally:
        if conn:
            conn.close()


def fetch_one(origin, token, article):
    status, entry = request(origin, token, article['id'])
    attempts = 1
    if status in (401,403):
        raise PermissionError('entry authorization rejected')
    if probe.retryable(status):
        time.sleep(RETRY_DELAY)
        status, entry = request(origin, token, article['id'])
        attempts += 1
        if status in (401,403):
            raise PermissionError('entry authorization rejected')
    return probe.row(article, status, entry, attempts)


def serialize(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'))+'\n').encode()


def atomic_write(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.d2e2-')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    except BaseException:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass
        raise


def main():
    corpus = verify_inputs()
    origin, token = credentials()
    root = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-miniflux-content-capability'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    attempt = root / ('attempt-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    attempt.mkdir(mode=0o700)
    # No authentication preflight: it was already consumed by the PM.
    rows = []
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for article in corpus:
        COUNTS['primary'] += 1
        rows.append(fetch_one(origin, token, article))
        if len(rows) % 100 == 0:
            print('ENTRIES_COMPLETED=' + str(len(rows)), file=sys.stderr, flush=True)
    rows.sort(key=lambda r: r['article_id'])
    finished = datetime.datetime.now(datetime.timezone.utc).isoformat()
    verify_inputs()
    summary = probe.summarize(rows)
    summary['attempt_http_status_counts'] = {k.removeprefix('http_'): v for k, v in COUNTS.items() if k.startswith('http_')}
    summary['transport_failure_attempts'] = COUNTS['transport_failure']
    if sum(summary['attempt_http_status_counts'].values()) + summary['transport_failure_attempts'] != COUNTS['attempts']:
        raise RuntimeError('attempt accounting mismatch')
    summary['auth_preflight_requests'] = 1
    summary['total_request_attempts'] = 1 + sum(r['request_attempt_count'] for r in rows)
    summary['coverage_gate'] = 'PASS' if summary['usable_count'] >= 400 else ('FAIL_PARTIAL' if summary['usable_count'] else 'FAIL_NO_CONTENT')
    if summary['total_request_attempts'] > 1001:
        raise RuntimeError('request budget exceeded')
    from validate import validate
    validate(corpus, rows, summary)
    data = b''.join(serialize(row) for row in rows)
    summary_data = serialize(summary)
    replay_summary = probe.summarize(rows)
    replay_summary.update({k:v for k,v in summary.items() if k not in replay_summary})
    if data != b''.join(serialize(row) for row in rows) or summary_data != serialize(replay_summary):
        raise RuntimeError('offline derivation replay mismatch')
    cap = attempt / 'miniflux-content-capability-v1.jsonl'
    summ = attempt / 'miniflux-content-capability-summary-v1.json'
    receipt = attempt / 'capture-receipt-v1.json'
    manifest = attempt / 'freeze-manifest-v1.json'
    atomic_write(cap, data)
    atomic_write(summ, summary_data)
    atomic_write(receipt, serialize({'started_at':started,'finished_at':finished,'auth_preflight_requests':1,'entry_primary_requests':500,'retry_requests':summary['retry_requests'],'total_request_attempts':summary['total_request_attempts'],'raw_content_persisted':False,'normalized_content_persisted':False}))
    atomic_write(manifest, serialize({'corpus_sha256':INPUTS[CORPUS],'contract_sha256':INPUTS[CONTRACT],'contract_manifest_sha256':INPUTS[MANIFEST],'capability_sha256':digest(cap),'summary_sha256':digest(summ),'receipt_sha256':digest(receipt)}))
    for p in (cap,summ,receipt,manifest):
        before = digest(p)
        p.chmod(0o444)
        if digest(p) != before or p.stat().st_mode & 0o777 != 0o444:
            raise RuntimeError('private freeze verification failed')
    reloaded = [json.loads(line) for line in cap.read_text().splitlines()]
    validate(corpus, reloaded, json.loads(summ.read_text()))
    verify_inputs()
    print(json.dumps({'attempt':str(attempt),'capability_sha256':digest(cap),'summary_sha256':digest(summ),'receipt_sha256':digest(receipt),'manifest_sha256':digest(manifest),'summary':summary},sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('PROBE_STOP=' + type(exc).__name__ + ' PRIMARY=' + str(COUNTS['primary']) + ' ATTEMPTS=' + str(COUNTS['attempts']), file=sys.stderr)
        sys.exit(1)
