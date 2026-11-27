"""One explicitly authorized Miniflux-only research capture; never logs payloads."""
import collections
import datetime
import email.utils
import http.client
import importlib.util
import json
import os
import re
from pathlib import Path
import ssl
import sys
import time

import capture
import validate_capture

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'miniflux_content_capability_probe'))
_baseline_spec = importlib.util.spec_from_file_location('d2e2_baseline', Path(__file__).resolve().parent.parent / 'miniflux_content_capability_probe/runner.py')
baseline = importlib.util.module_from_spec(_baseline_spec)
_baseline_spec.loader.exec_module(baseline)

D2E2 = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-miniflux-content-capability/attempt-20261028T222834435109Z'
CAPABILITY = D2E2 / 'miniflux-content-capability-v1.jsonl'
SUMMARY = D2E2 / 'miniflux-content-capability-summary-v1.json'
D2E2_HASHES = {CAPABILITY:'510a9409470d45d700295e953149ed195a937cecdd646f81cfe241b87b745c91', SUMMARY:'e7a1d00b589932e863b4382a7694e67ed6fde8395e78a807ce534ae14a6c1254'}
COUNTS = collections.Counter()
HTTP = collections.Counter()
CURRENT_STAGE = 'VALIDATION'


def verify_inputs():
    rows = baseline.verify_inputs()
    for path, expected in D2E2_HASHES.items():
        if baseline.digest(path) != expected:
            raise ValueError('D2E2 input hash mismatch')
    older = [json.loads(x) for x in CAPABILITY.read_text().splitlines()]
    if len(older)!=500 or {x['article_id'] for x in older}!={x['id'] for x in rows} or len({x['article_id'] for x in older})!=500:
        raise ValueError('D2E2 membership mismatch')
    return rows, {x['article_id']:x for x in older}


def request(origin, token, path, preflight=False):
    if preflight:
        if path != '/v1/me' or COUNTS['preflight'] != 0:
            raise ValueError('invalid preflight')
        COUNTS['preflight'] += 1
    else:
        capture.check_request('GET', path)
        COUNTS['entry_attempts'] += 1
        if COUNTS['entry_attempts'] > 1000:
            raise ValueError('request limit')
    connection = None
    try:
        klass = http.client.HTTPSConnection if origin.scheme=='https' else http.client.HTTPConnection
        options = {'timeout':10}
        if origin.scheme=='https':
            options['context'] = ssl.create_default_context()
        connection = klass(origin.hostname, origin.port, **options)
        connection.connect()
        connection.sock.settimeout(30)
        connection.request('GET', path, headers={'X-Auth-Token':token, 'Accept':'application/json','User-Agent':'NewsFlux-Research-D2E3/1.0'})
        response = connection.getresponse()
        status = response.status
        retry_after = response.getheader('Retry-After')
        body = response.read()
        HTTP[str(status)] += 1
        return status,body,retry_after if status==429 and retry_after else .25
    except (OSError,http.client.HTTPException,ssl.SSLError):
        HTTP['transport_failure'] += 1
        return None,None,.25
    finally:
        if connection:
            try:
                connection.close()
            except OSError:
                pass


def reject_secret(body, token):
    if not token or body is not None and token.encode('utf-8') in body:
        raise capture.SecretLeak('credential in payload')


def fetch(origin,token,article,root):
    path = '/v1/entries/' + str(article['id'])
    COUNTS['primary'] += 1
    try:
        status,body,delay = request(origin,token,path)
    except Exception as exc:
        raise capture.CaptureFailure('HTTP_RESPONSE','REQUEST_FAILED',type(exc).__name__,article_id=article['id']) from None
    attempts = 1
    if status in (401,403):
        raise capture.CaptureFailure('HTTP_RESPONSE','AUTHORIZATION_FAILED','PermissionError',article_id=article['id'],status=status,payload_received=body is not None)
    if capture.retryable(status):
        try:
            if isinstance(delay,str):
                try:
                    delay=max(0.0,float(delay))
                except ValueError:
                    when=email.utils.parsedate_to_datetime(delay)
                    delay=max(0.0,(when-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
            if delay>60:
                raise ValueError('retry window')
        except Exception as exc:
            mapping=freeze_safe(root,article['id'],status,attempts,body,token,None)
            raise capture.CaptureFailure('HTTP_RESPONSE','RETRY_POLICY_INVALID',type(exc).__name__,article_id=article['id'],status=status,payload_received=body is not None,payload_frozen=body is not None,payload_sha256=mapping['source_payload_sha256'],secret_scan_pass=body is not None) from None
        time.sleep(delay)
        COUNTS['retry'] += 1
        try:
            status,body,delay = request(origin,token,path)
        except Exception as exc:
            raise capture.CaptureFailure('HTTP_RESPONSE','RETRY_REQUEST_FAILED',type(exc).__name__,article_id=article['id']) from None
        attempts = 2
        if status in (401,403):
            raise capture.CaptureFailure('HTTP_RESPONSE','AUTHORIZATION_FAILED','PermissionError',article_id=article['id'],status=status,payload_received=body is not None)
    mapping=freeze_safe(root,article['id'],status,attempts,body,token,None)
    try:
        mapping['retrieved_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    except Exception as exc:
        raise capture.CaptureFailure('PAYLOAD_INDEX','TIMESTAMP_FAILED',type(exc).__name__,article_id=article['id'],status=status,payload_received=body is not None,payload_frozen=body is not None,payload_sha256=mapping['source_payload_sha256'],secret_scan_pass=body is not None) from None
    try:
        frozen=(root/mapping['source_payload_artifact_relpath']).read_bytes() if body is not None else None
    except Exception as exc:
        raise capture.CaptureFailure('RAW_PAYLOAD_FREEZE','READBACK_FAILED',type(exc).__name__,article_id=article['id'],status=status,payload_received=body is not None,payload_frozen=False,payload_sha256=mapping['source_payload_sha256'],secret_scan_pass=body is not None) from None
    return mapping,capture.derive(article,mapping,frozen)


def freeze_safe(root,article_id,status,attempts,body,token,retrieved):
    context=dict(article_id=article_id,status=status,payload_received=body is not None)
    try:
        reject_secret(body,token)
        # Reject nonempty credential-like JSON properties without parsing the payload.
        if body is not None and re.search(rb'"(?:authorization|x-auth-token|cookie|set-cookie)"\s*:\s*+(?!null\b|false\b|""|\[\]|\{\})',body,re.IGNORECASE):
            raise capture.SecretLeak()
    except Exception as exc:
        raise capture.CaptureFailure('SECRET_SCAN','TOKEN_OR_SENSITIVE_METADATA_DETECTED',type(exc).__name__,**context) from None
    try:
        digest=capture.sha(body) if body is not None else None
    except Exception as exc:
        raise capture.CaptureFailure('RAW_PAYLOAD_HASH','HASH_FAILED',type(exc).__name__,secret_scan_pass=body is not None,**context) from None
    try:
        return capture.freeze_payload(root,article_id,status,attempts,body,token.encode('utf-8'),retrieved)
    except Exception as exc:
        raise capture.CaptureFailure('RAW_PAYLOAD_FREEZE','WRITE_OR_READBACK_FAILED',type(exc).__name__,payload_sha256=digest,secret_scan_pass=body is not None,**context) from None


def summary(rows,index,older,corpus,started,finished):
    identity=collections.Counter(r['identity_status'] for r in rows)
    status=collections.Counter(r['content_status'] for r in rows)
    frozen={r['id']:r for r in corpus}
    equal={r['article_id']:(r['normalized_content']==capture.probe.clean_title(frozen[r['article_id']]['title']) if r['normalized_content'] is not None else False if r['identity_status']=='IDENTITY_MATCH' else None) for r in rows}
    usable=status['USABLE']
    out={'source_semantics':'MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL','total_target_articles':500,'identity_counts':dict(identity),'content_status_counts':dict(status),'usable_count':usable,'coverage_denominator':500,'usable_coverage':usable/500,'coverage_gate':'PASS' if usable>=400 else 'FAIL',
         'content_equals_title_count':sum(x is True for x in equal.values()),
         'identity_status_changed_count':sum(r['identity_status']!=older[r['article_id']]['identity_status'] for r in rows),
         'content_status_changed_count':sum(r['content_status']!=older[r['article_id']]['content_status'] for r in rows),
         'content_equals_title_changed_count':sum(equal[r['article_id']]!=older[r['article_id']]['content_equals_title'] for r in rows),
         'auth_preflight_requests':COUNTS['preflight'],'entry_primary_requests':COUNTS['primary'],'retry_requests':COUNTS['retry'],'total_request_attempts':COUNTS['preflight']+COUNTS['entry_attempts'],
         'http_attempt_counts':dict(HTTP),'retrieval_started_at':started,'retrieval_finished_at':finished,
         'raw_source_payload_retention':'AUTHORIZED_PRIVATE_ONLY','publisher_requests':0,'human_label_accesses':0,'external_model_calls':0}
    out['raw_source_payload_artifact_count']=len({r['source_payload_sha256'] for r in index if r['source_payload_sha256'] is not None})
    out['raw_source_payload_total_bytes']=sum({r['source_payload_sha256']:r['source_payload_byte_count'] for r in index if r['source_payload_sha256'] is not None}.values())
    return out


def validate_destination(root, private_root, repo_root):
    if root.is_symlink() or not root.resolve().is_relative_to(private_root.resolve()) or root.resolve().is_relative_to(repo_root.resolve()) or root.stat().st_mode & 0o077:
        raise ValueError('unsafe private capture destination')


def _main():
    global CURRENT_STAGE
    CURRENT_STAGE = 'VALIDATION'
    corpus,older=verify_inputs()
    origin,token=baseline.credentials()
    root = Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-content-enrichment'
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    validate_destination(root, Path.home()/'NewsFlux-STORY00/private-p4', Path(__file__).resolve().parents[5])
    attempt=root/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    attempt.mkdir(mode=0o700)
    if attempt.stat().st_mode & 0o777!=0o700:
        raise ValueError('invalid private directory mode')
    CURRENT_STAGE = 'HTTP_RESPONSE'
    status,body,_=request(origin,token,'/v1/me',preflight=True)
    if status in (401,403):
        raise capture.CaptureFailure('HTTP_RESPONSE','AUTHORIZATION_FAILED','PermissionError',status=status,payload_received=body is not None)
    if status!=200:
        raise capture.CaptureFailure('HTTP_RESPONSE','AUTH_PREFLIGHT_FAILED','ValueError',status=status,payload_received=body is not None)
    CURRENT_STAGE = 'SECRET_SCAN'
    reject_secret(body,token)
    del body
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    index=[]; rows=[]
    for article in corpus:
        mapping,row=fetch(origin,token,article,attempt)
        index.append(mapping);rows.append(row)
        if len(rows)%100==0:
            print('ENTRIES_COMPLETED='+str(len(rows)),file=sys.stderr,flush=True)
    finished=datetime.datetime.now(datetime.timezone.utc).isoformat()
    CURRENT_STAGE = 'VALIDATION'
    index.sort(key=lambda x:x['article_id']);rows.sort(key=lambda x:x['article_id'])
    verify_inputs()
    if COUNTS['primary']!=500 or COUNTS['preflight']!=1 or COUNTS['entry_attempts']!=500+COUNTS['retry'] or COUNTS['retry']>500:
        raise ValueError('request accounting mismatch')
    validate_capture.validate(corpus,index,rows,attempt,token.encode('utf-8'))
    sidecar=b''.join(capture.canonical(x) for x in rows)
    index_data=b''.join(capture.canonical(x) for x in index)
    receipt=summary(rows,index,older,corpus,started,finished)
    receipt['failed_attempt_noncanonical']={'path':str(Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-content-enrichment/attempt-20261028T230149822584Z'),'auth_preflight_requests':1,'entry_primary_requests':1,'retry_requests':0,'total_request_attempts':2,'root_cause':'UNRECOVERABLE_DUE_TO_PRE_DIAGNOSTIC_EVIDENCE_LOSS'}
    receipt['d2e3_cumulative']={'auth_preflight_requests':1+COUNTS['preflight'],'entry_primary_requests':1+COUNTS['primary'],'retry_requests':COUNTS['retry'],'total_request_attempts':2+COUNTS['preflight']+COUNTS['entry_attempts']}
    receipt.update(corpus_sha256=baseline.INPUTS[baseline.CORPUS],d2e1_contract_sha256=baseline.INPUTS[baseline.CONTRACT],d2e1_manifest_sha256=baseline.INPUTS[baseline.MANIFEST],d2e2_capability_sha256=D2E2_HASHES[CAPABILITY],d2e2_summary_sha256=D2E2_HASHES[SUMMARY],sidecar_sha256=capture.sha(sidecar),source_payload_index_sha256=capture.sha(index_data))
    hashes=sorted({x['source_payload_sha256'] for x in index if x['source_payload_sha256'] is not None})
    receipt['source_payload_set_digest']=capture.sha(('\n'.join(hashes)+'\n').encode())
    receipt_data=capture.canonical(receipt)
    manifest={'sidecar_sha256':capture.sha(sidecar),'receipt_sha256':capture.sha(receipt_data),'source_payload_index_sha256':capture.sha(index_data),'source_payload_set_digest':receipt['source_payload_set_digest'],'corpus_sha256':baseline.INPUTS[baseline.CORPUS],'contract_sha256':baseline.INPUTS[baseline.CONTRACT],'contract_manifest_sha256':baseline.INPUTS[baseline.MANIFEST],'d2e2_capability_sha256':D2E2_HASHES[CAPABILITY],'d2e2_summary_sha256':D2E2_HASHES[SUMMARY],'count':500,'usable_coverage':receipt['usable_coverage'],'source_semantics':receipt['source_semantics'],'network_mode':'MINIFLUX_GET_ONLY','normalization_contract_version':'D2E1'}
    manifest['failed_attempt_noncanonical']=receipt['failed_attempt_noncanonical']
    manifest['d2e3_cumulative']=receipt['d2e3_cumulative']
    manifest_data=capture.canonical(manifest)
    for b in (sidecar,index_data,receipt_data,manifest_data):
        reject_secret(b,token)
    paths=[attempt/'fresh-content-enrichment-v1.jsonl',attempt/'source-payload-index-v1.jsonl',attempt/'fresh-content-enrichment-receipt-v1.json',attempt/'fresh-content-enrichment-manifest-v1.json']
    CURRENT_STAGE = 'SIDECAR_WRITE'
    for path,data in zip(paths,(sidecar,index_data,receipt_data,manifest_data)):
        capture.secure_write(path,data)
    CURRENT_STAGE = 'VALIDATION'
    read_index=[json.loads(x) for x in paths[1].read_text().splitlines()]
    read_rows=[json.loads(x) for x in paths[0].read_text().splitlines()]
    validate_capture.validate(corpus,read_index,read_rows,attempt,token.encode('utf-8'))
    # Independently rederive from frozen bytes, never from normalized sidecar.
    replay=[]
    for article,mapping in zip(sorted(corpus,key=lambda x:x['id']),read_index):
        raw=(attempt/mapping['source_payload_artifact_relpath']).read_bytes() if mapping['source_payload_sha256'] is not None else None
        replay.append(capture.derive(article,mapping,raw))
    if b''.join(capture.canonical(x) for x in replay)!=sidecar:
        raise ValueError('offline replay failed')
    CURRENT_STAGE = 'FREEZE'
    for path in paths:
        if path.stat().st_mode&0o777!=0o444 or token.encode('utf-8') in path.read_bytes():
            raise ValueError('private freeze or secret gate failed')
    verify_inputs()
    print(json.dumps({'attempt':str(attempt),'summary':receipt,'sidecar_sha256':baseline.digest(paths[0]),'index_sha256':baseline.digest(paths[1]),'receipt_sha256':baseline.digest(paths[2]),'manifest_sha256':baseline.digest(paths[3])},sort_keys=True))


def main():
    spec = importlib.util.spec_from_file_location('d2e1_guard', Path(__file__).resolve().parent.parent / 'content_enrichment_contract/build_content_enrichment_contract.py')
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    with guard.label_guard():
        return _main()


def safe_diagnostic(exc):
    if isinstance(exc,capture.CaptureFailure):
        return {'error_type':exc.error_type,'error_stage':exc.stage,'error_code':exc.code,'article_id':exc.article_id,'entry_http_status':exc.status,'payload_received':exc.payload_received,'payload_secret_scan_pass':exc.secret_scan_pass,'payload_frozen':exc.payload_frozen,'payload_sha256':exc.payload_sha256,'payload_sha256_available':exc.payload_sha256 is not None}
    return {'error_type':type(exc).__name__,'error_stage':CURRENT_STAGE,'error_code':'UNEXPECTED_FAILURE'}


if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        diagnostic=safe_diagnostic(exc)
        diagnostic.update(preflight=COUNTS['preflight'],primary=COUNTS['primary'],entry_attempts=COUNTS['entry_attempts'],retry=COUNTS['retry'])
        print('CAPTURE_STOP='+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)
        sys.exit(1)
