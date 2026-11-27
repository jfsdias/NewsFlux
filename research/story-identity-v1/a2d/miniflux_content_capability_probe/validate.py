"""Independent, metadata-only validation of the capability output."""
from collections import Counter
import math
import statistics

FIELDS = {'article_id','identity_status','entry_http_status','entry_id_match','feed_id_match','title_match','url_match','published_at_match','content_status','raw_character_count','normalized_character_count','content_equals_title','request_attempt_count'}
IDENTITY = {'IDENTITY_MATCH','IDENTITY_MISMATCH','ENTRY_NOT_FOUND','SOURCE_UNAVAILABLE'}
CONTENT = {'USABLE','EMPTY_AFTER_NORMALIZATION','STRUCTURAL_ONLY','UNSUPPORTED_FORMAT','IDENTITY_FAILURE','SOURCE_FAILURE'}


def require(condition):
    if not condition:
        raise ValueError('independent metadata validation failed')


def lengths(rows, key):
    data = sorted(row[key] for row in rows if row[key] is not None and row[key] > 0)
    if not data:
        return {'min':None,'median':None,'p90':None,'max':None}
    return {'min':data[0], 'median':statistics.median(data), 'p90':data[math.ceil(len(data)*0.9)-1], 'max':data[-1]}


def validate(corpus, rows, summary):
    require(len(corpus) == 500 and len(rows) == 500)
    ids = [r['article_id'] for r in rows]
    require(ids == sorted(ids) and len(set(ids)) == 500 and set(ids) == {r['id'] for r in corpus})
    for r in rows:
        require(set(r) == FIELDS and r['identity_status'] in IDENTITY and r['content_status'] in CONTENT)
        require(r['request_attempt_count'] in (1,2))
        status = r['entry_http_status']
        require(status is None or type(status) is int and status not in (401,403))
        require(r['identity_status'] == 'ENTRY_NOT_FOUND' if status == 404 else r['identity_status'] != 'ENTRY_NOT_FOUND')
        matches = [r[k] for k in ('entry_id_match','feed_id_match','title_match','url_match','published_at_match')]
        if r['identity_status'] in ('IDENTITY_MATCH','IDENTITY_MISMATCH'):
            require(status == 200 and all(type(x) is bool for x in matches))
            require(all(matches) == (r['identity_status'] == 'IDENTITY_MATCH'))
        else:
            require(all(x is None for x in matches))
        if r['identity_status'] == 'IDENTITY_MATCH':
            require(r['content_status'] in {'USABLE','EMPTY_AFTER_NORMALIZATION','STRUCTURAL_ONLY','UNSUPPORTED_FORMAT'})
        else:
            require(r['content_status'] == ('SOURCE_FAILURE' if r['identity_status'] == 'SOURCE_UNAVAILABLE' else 'IDENTITY_FAILURE'))
            require(r['raw_character_count'] is None and r['normalized_character_count'] is None and r['content_equals_title'] is None)
        if r['identity_status'] == 'SOURCE_UNAVAILABLE':
            require(status != 200 and status != 404)
        if r['identity_status'] == 'IDENTITY_MATCH':
            kind = r['content_status']
            if kind == 'UNSUPPORTED_FORMAT':
                require(r['raw_character_count'] is None and r['normalized_character_count'] is None and r['content_equals_title'] is False)
            else:
                require(type(r['raw_character_count']) is int and r['raw_character_count'] >= 0)
                require(type(r['normalized_character_count']) is int and 0 <= r['normalized_character_count'] <= 8192)
                require(type(r['content_equals_title']) is bool)
                if kind == 'USABLE':
                    require(r['raw_character_count'] > 0 and r['normalized_character_count'] > 0)
                elif kind == 'STRUCTURAL_ONLY':
                    require(r['raw_character_count'] > 0 and r['normalized_character_count'] == 0 and not r['content_equals_title'])
                else:
                    require(r['raw_character_count'] == 0 and r['normalized_character_count'] == 0 and not r['content_equals_title'])
    identity = dict(Counter(r['identity_status'] for r in rows))
    content = dict(Counter(r['content_status'] for r in rows))
    statuses = dict(Counter(str(r['entry_http_status']) for r in rows))
    usable = content.get('USABLE',0)
    require(summary['total_target_articles'] == 500 and summary['identity_counts'] == identity and summary['content_status_counts'] == content)
    require(summary['http_status_counts'] == statuses and summary['usable_count'] == usable and summary['usable_coverage'] == usable / 500)
    require(summary['content_equals_title_count'] == sum(r['content_equals_title'] is True for r in rows))
    require(summary['raw_character_length'] == lengths(rows,'raw_character_count') and summary['normalized_character_length'] == lengths(rows,'normalized_character_count'))
    retries = sum(r['request_attempt_count']-1 for r in rows)
    require(summary['entry_primary_requests'] == 500 and summary['retry_requests'] == retries and summary['auth_preflight_requests'] == 1 and summary['total_request_attempts'] == 501 + retries <= 1001)
    require(sum(summary['attempt_http_status_counts'].values()) + summary['transport_failure_attempts'] == 500 + retries)
    if retries == 0:
        require(summary['attempt_http_status_counts'] == {k:v for k,v in statuses.items() if k != 'None'})
        require(summary['transport_failure_attempts'] == statuses.get('None', 0))
    require(summary['coverage_gate'] == ('PASS' if usable >= 400 else 'FAIL_PARTIAL' if usable else 'FAIL_NO_CONTENT'))
