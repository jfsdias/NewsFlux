"""Independent replay validator, consuming frozen source bytes and metadata."""
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'miniflux_content_capability_probe'))
import probe  # noqa: E402


def require(value):
    if not value:
        raise ValueError('independent capture validation failed')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate(corpus, index, sidecar, root, token, expected_count=500):
    require(len(corpus)==len(index)==len(sidecar)==expected_count)
    ids = [x['id'] for x in corpus]
    map_ids = [x['article_id'] for x in index]
    side_ids = [x['article_id'] for x in sidecar]
    require(len(set(ids))==expected_count and len(set(map_ids))==expected_count)
    require(map_ids == sorted(ids) and side_ids == sorted(ids))
    catalog = {x['id']:x for x in corpus}
    fields = {'article_id','source_tier','source_kind','source_identifier','source_url_original','source_url_requested','source_url_final','redirect_count','identity_status','content_status','content_available','http_status','raw_content_sha256','normalized_content','normalized_content_sha256','normalized_character_count','retrieved_at','source_temporal_semantics','failure_reason'}
    index_fields = {'article_id','request_attempt_used','entry_http_status','source_payload_sha256','source_payload_byte_count','source_payload_artifact_relpath','retrieved_at'}
    for item, row in zip(index,sidecar):
        require(set(item)==index_fields and set(row)==fields)
        require(item['request_attempt_used'] in (1,2) and item['entry_http_status'] not in (401,403))
        require(row['source_tier']==1 and row['source_kind']=='MINIFLUX_ENTRY_CONTENT' and row['source_identifier']==str(item['article_id']))
        require(row['source_temporal_semantics']=='MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL')
        require(row['http_status']==item['entry_http_status'] and row['retrieved_at']==item['retrieved_at'])
        require(row['source_url_original']==catalog[item['article_id']]['url'])
        require(row['source_url_requested'] is None and row['source_url_final'] is None and row['redirect_count'] is None)
        payload = None
        if item['source_payload_sha256'] is None:
            require(item['entry_http_status'] is None and item['source_payload_byte_count'] is None and item['source_payload_artifact_relpath'] is None)
        else:
            h = item['source_payload_sha256']
            require(len(h)==64 and all(x in '0123456789abcdef' for x in h))
            require(item['source_payload_artifact_relpath']=='source-payloads/sha256/'+h+'.bin')
            path = root / item['source_payload_artifact_relpath']
            require(path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o777 == 0o444)
            payload=path.read_bytes()
            require(token not in payload and digest(payload)==h and len(payload)==item['source_payload_byte_count'])
        status = item['entry_http_status']
        entry = json.loads(payload) if status==200 and payload is not None else None
        require(status != 200 or isinstance(entry,dict))
        base = probe.row(catalog[item['article_id']],status,entry,item['request_attempt_used'])
        require(row['identity_status']==base['identity_status'] and row['content_status']==base['content_status'])
        raw=entry.get('content') if entry is not None and base['identity_status']=='IDENTITY_MATCH' else None
        expected_raw=digest(raw.encode('utf-8')) if isinstance(raw,str) else None
        require(row['raw_content_sha256']==expected_raw)
        expected=probe.normalize(raw) if base['content_status']=='USABLE' else None
        require(row['normalized_content']==expected and row['content_available']==(expected is not None))
        require(row['normalized_content_sha256']==(digest(expected.encode('utf-8')) if expected is not None else None))
        require(row['normalized_character_count']==(len(expected) if expected is not None else base['normalized_character_count']))
        require(row['normalized_character_count'] is None or row['normalized_character_count']<=8192)
        require(row['failure_reason']==(None if expected is not None else base['content_status']))
