"""Private source-payload vault and deterministic D2E1 sidecar derivation."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'miniflux_content_capability_probe'))
import probe  # noqa: E402

check_request = probe.check_request
retryable = probe.retryable


class CaptureFailure(Exception):
    def __init__(self, stage, code, error_type='ValueError', *, article_id=None, status=None, payload_received=False, payload_frozen=False, payload_sha256=None, secret_scan_pass=False):
        self.stage, self.code, self.error_type = stage, code, error_type
        self.article_id, self.status = article_id, status
        self.payload_received, self.payload_frozen = payload_received, payload_frozen
        self.payload_sha256, self.secret_scan_pass = payload_sha256, secret_scan_pass
        super().__init__(stage + ':' + code)


class SecretLeak(CaptureFailure):
    def __init__(self, message=''):
        super().__init__('SECRET_SCAN', 'TOKEN_DETECTED', 'SecretLeak')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def secure_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.capture-', dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, 0o444)
        os.replace(name, path)
        if path.stat().st_mode & 0o777 != 0o444 or sha(path.read_bytes()) != sha(data):
            raise ValueError('frozen artifact integrity')
    finally:
        if os.path.exists(name):
            os.unlink(name)


def freeze_payload(root, article_id, status, attempts, body, token, retrieved_at):
    if not token:
        raise ValueError('missing credential for security check')
    mapping = {'article_id':article_id, 'request_attempt_used':attempts, 'entry_http_status':status,
               'source_payload_sha256':None, 'source_payload_byte_count':None,
               'source_payload_artifact_relpath':None, 'retrieved_at':retrieved_at}
    if body is None:
        if status is not None:
            raise ValueError('missing HTTP response body')
        return mapping
    if token in body:
        raise SecretLeak('credential detected in response')
    digest = sha(body)
    relative = 'source-payloads/sha256/' + digest + '.bin'
    path = root / relative
    if path.exists():
        if path.stat().st_mode & 0o777 != 0o444 or sha(path.read_bytes()) != digest:
            raise ValueError('existing payload corrupt')
    else:
        secure_write(path, body)
    mapping.update(source_payload_sha256=digest, source_payload_byte_count=len(body), source_payload_artifact_relpath=relative)
    return mapping


def derive(frozen, mapping, body):
    status = mapping['entry_http_status']
    context = dict(article_id=frozen.get('id'), status=status, payload_received=body is not None,
                   payload_frozen=body is not None, payload_sha256=mapping.get('source_payload_sha256'),
                   secret_scan_pass=body is not None)
    def fail(stage, code, exc):
        raise CaptureFailure(stage, code, type(exc).__name__, **context) from None
    try:
        if mapping['article_id'] != frozen['id']:
            raise ValueError('identity mapping')
        if body is None:
            if status is not None or mapping['source_payload_sha256'] is not None:
                raise ValueError('missing source')
        elif sha(body) != mapping['source_payload_sha256'] or len(body) != mapping['source_payload_byte_count']:
            raise ValueError('source integrity')
    except Exception as exc:
        fail('PAYLOAD_INDEX', 'MAPPING_OR_DIGEST_INVALID', exc)
    entry = None
    if status == 200:
        try:
            entry = json.loads(body)
        except Exception as exc:
            fail('JSON_DECODE', 'INVALID_JSON', exc)
        if not isinstance(entry, dict):
            fail('JSON_SHAPE', 'INVALID_ROOT', ValueError())
        try:
            for k in ('id', 'feed_id', 'title', 'url', 'published_at'):
                if k not in entry:
                    raise KeyError(k)
            if not isinstance(entry['title'],str) or not isinstance(entry['url'],str) or not isinstance(entry['published_at'],str):
                raise TypeError('identity type')
        except Exception as exc:
            fail('IDENTITY_EXTRACTION', 'MISSING_OR_INVALID_FIELD', exc)
        try:
            probe.instant(entry['published_at'])
            probe.instant(frozen['published_at'])
            probe.clean_title(entry['title'])
            entry['url'].strip()
        except Exception as exc:
            fail('IDENTITY_VALIDATION', 'INVALID_IDENTITY_VALUE', exc)
    raw = None
    text = None
    try:
        if status == 404:
            identity = 'ENTRY_NOT_FOUND'
        elif status != 200:
            identity = 'SOURCE_UNAVAILABLE'
        else:
            checks = (entry['id']==frozen['id'], entry['feed_id']==frozen['feed_id'],
                      probe.clean_title(entry['title'])==probe.clean_title(frozen['title']),
                      entry['url'].strip()==frozen['url'].strip(),
                      probe.instant(entry['published_at'])==probe.instant(frozen['published_at']))
            identity = 'IDENTITY_MATCH' if all(checks) else 'IDENTITY_MISMATCH'
    except Exception as exc:
        fail('IDENTITY_VALIDATION', 'IDENTITY_COMPARISON_FAILED', exc)
    if identity == 'SOURCE_UNAVAILABLE':
        kind, normalized_length = 'SOURCE_FAILURE', None
    elif identity != 'IDENTITY_MATCH':
        kind, normalized_length = 'IDENTITY_FAILURE', None
    else:
        try:
            raw = entry.get('content')
        except Exception as exc:
            fail('CONTENT_EXTRACTION', 'CONTENT_EXTRACTION_FAILED', exc)
        try:
            is_supported = raw is None or isinstance(raw,str)
        except Exception as exc:
            fail('CONTENT_TYPE', 'CONTENT_TYPE_FAILED', exc)
        try:
            kind, _, normalized_length, _ = probe.content(raw, frozen['title'])
            if not is_supported and kind != 'UNSUPPORTED_FORMAT':
                raise ValueError('unsupported content classification')
            text = probe.normalize(raw) if kind == 'USABLE' else None
        except Exception as exc:
            fail('NORMALIZATION', 'NORMALIZATION_FAILED', exc)
    usable = kind == 'USABLE'
    try:
        raw_hash = sha(raw.encode('utf-8')) if isinstance(raw,str) else None
        normalized_hash = sha(text.encode('utf-8')) if text is not None else None
    except Exception as exc:
        fail('CONTENT_HASH', 'HASH_FAILED', exc)
    try:
        return {'article_id':frozen['id'], 'source_tier':1, 'source_kind':'MINIFLUX_ENTRY_CONTENT',
                'source_identifier':str(frozen['id']), 'source_url_original':frozen['url'],
                'source_url_requested':None, 'source_url_final':None, 'redirect_count':None,
                'identity_status':identity, 'content_status':kind,
                'content_available':usable, 'http_status':status,
                'raw_content_sha256':raw_hash, 'normalized_content':text,
                'normalized_content_sha256':normalized_hash,
                'normalized_character_count':len(text) if text is not None else normalized_length,
                'retrieved_at':mapping['retrieved_at'],
                'source_temporal_semantics':'MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL',
                'failure_reason':None if usable else kind}
    except Exception as exc:
        fail('ROW_DERIVATION', 'ROW_FAILED', exc)


def canonical(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))+'\n').encode()
