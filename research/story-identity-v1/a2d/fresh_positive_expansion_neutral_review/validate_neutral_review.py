"""Independent checks of neutral sample presentation and frozen artifacts."""
import ast
import csv
import hashlib
import hmac
import io
import json
import re

COLS=('review_id','left_title','left_source','left_published_at','right_title','right_source','right_published_at','human_decision')
LABELS={'SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN'}

def require(condition,name):
    if not condition:raise ValueError(name)

def check_csv(data,initial=True):
    reader=csv.DictReader(io.StringIO(data.decode(),newline=''))
    require(tuple(reader.fieldnames or ())==COLS,'CSV_SCHEMA');rows=list(reader)
    require(len(rows)==11 and [x['review_id'] for x in rows]==[f'R{i:03}' for i in range(1,12)],'REVIEW_IDS')
    require(all(x['human_decision']=='' if initial else x['human_decision'] in LABELS for x in rows),'DECISIONS')
    return rows

def check_html(html,rows,session_id):
    text=html.decode()
    require(not re.search(r'(?i)(?:src|href)\s*=\s*["\']\s*(?:https?:)?//|\bfetch\s*\(|XMLHttpRequest|WebSocket|@import',text),'NETWORK_REFERENCE')
    m=re.search(r'const rows\s*=\s*(.*?)\s*;?\s*const storageKey\s*=',text,re.S)
    require(bool(m) and json.loads(m.group(1))==rows,'HTML_ROWS')
    require(json.dumps('newsflux-story02-d2f8-'+session_id) in text,'NAMESPACE')
    require(bool(re.search(r'rows\.length\s*!==\s*11\s*\|\|\s*!rows\.every',text)) and 'labels.includes(decisions[x.review_id])' in text,'COMPLETION_RULE')
    declared=re.search(r'const labels\s*=\s*(\[[^\]]+\])',text)
    require(bool(declared) and set(ast.literal_eval(declared.group(1)))==LABELS and len(ast.literal_eval(declared.group(1)))==4,'TAXONOMY')

def validate(pairs,corpus,nonce,rows,mapping,csvdata,html,session_id):
    require(len(pairs)==11 and len(mapping)==11,'PAIR_COUNT')
    require(len({x['pair_key'] for x in pairs})==11 and len({a for p in pairs for a in (p['article_id_a'],p['article_id_b'])})==22,'SOURCE_IDENTITY')
    articles={}
    for x in corpus:
        require(x['id'] not in articles,'DUPLICATE_CORPUS');articles[x['id']]=x
    bykey={p['pair_key']:p for p in pairs};require({m['pair_key'] for m in mapping}==set(bykey),'SAMPLE_IDENTITY')
    def dig(domain,key):return hmac.new(nonce,(domain+'|'+key).encode(),hashlib.sha256).digest()
    expected=sorted(pairs,key=lambda p:(dig('order',p['pair_key']),p['pair_key']))
    require([m['pair_key'] for m in mapping]==[p['pair_key'] for p in expected],'PERMUTATION')
    require([m['pair_key'] for m in mapping]!=[p['pair_key'] for p in sorted(pairs,key=lambda p:p['b1_rank'])],'RANK_ORDER')
    require([m['pair_key'] for m in mapping]!=[p['pair_key'] for p in sorted(pairs,key=lambda p:p['selection_position'])],'SELECTION_ORDER')
    require([x['review_id'] for x in mapping]==[f'R{i:03}' for i in range(1,12)],'MAPPING_IDS')
    for m,row in zip(mapping,rows):
        p=bykey[m['pair_key']];a,b=p['article_id_a'],p['article_id_b'];left,right=(b,a) if dig('side',p['pair_key'])[0]&1 else (a,b)
        require(set(m)=={'review_id','pair_key','article_id_a','article_id_b','left_article_id','right_article_id','selection_position','b1_rank'},'MAP_SCHEMA')
        require((m['article_id_a'],m['article_id_b'],m['left_article_id'],m['right_article_id'],m['selection_position'],m['b1_rank'])==(a,b,left,right,p['selection_position'],p['b1_rank']),'MAPPING')
        require(left in articles and right in articles,'MISSING_ARTICLE')
        def meta(x):
            item=articles[x];require(isinstance(item.get('title'),str) and bool(item['title'].strip()),'TITLE')
            return item['title'],item.get('feed_title') or 'SOURCE_UNAVAILABLE',item.get('published_at') or 'PUBLISHED_AT_UNAVAILABLE'
        lt,ls,lp=meta(left);rt,rs,rp=meta(right)
        require(tuple(row)==COLS and list(row.values())==[m['review_id'],lt,ls,lp,rt,rs,rp,''],'VISIBLE_FIELDS')
    require(check_csv(csvdata)==rows,'CSV_DATA')
    check_html(html,rows,session_id)


def verify_fingerprints(rows,mapping,receipt,nonce):
    def canonical(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
    visible=[{k:row[k] for k in COLS if k!='human_decision'} for row in rows]
    identity=[{k:row[k] for k in ('review_id','pair_key','left_article_id','right_article_id')} for row in mapping]
    require(receipt['review_metadata_sha256']==hashlib.sha256(canonical(visible)).hexdigest(),'METADATA_FINGERPRINT')
    require(receipt['review_identity_map_sha256']==hashlib.sha256(canonical(identity)).hexdigest(),'IDENTITY_FINGERPRINT')
    require(receipt['session_id']==hashlib.sha256(b'story02-d2f8|'+nonce).hexdigest()[:24],'SESSION_ID')
    require(receipt['initial_decision_count']==0 and receipt['session_state']=='PREPARED_UNOPENED' and receipt['human_review_started'] is False and receipt['completed_review_export_exists'] is False,'INITIAL_STATE')


def check_guide(data):
    text=data.decode()
    require(all(x in text for x in LABELS) and 'merge-negative' in text and 'Only SAME_EVENT is merge-positive' in text,'GUIDE_TAXONOMY')
    require('do not search the web' in text and 'UNCERTAIN' in text,'GUIDE_POLICY')


def validate_renderer_template(expected_sha, data):
    require(hashlib.sha256(data).hexdigest()==expected_sha,'TEMPLATE_HASH_MISMATCH')

def verify_committed_renderer(repo, commit, expected=None):
    from pathlib import Path
    import subprocess
    base='scripts/research/story-identity-v1/a2d/fresh_positive_expansion_neutral_review/'
    names={'template_sha256':'review-ui-template.html','renderer_source_sha256':'prepare_neutral_review.py','core_source_sha256':'review_core.py'}
    result={}
    for role,name in names.items():
        committed=subprocess.check_output(['git','show',commit+':'+base+name],cwd=repo)
        current=(Path(repo)/base/name).read_bytes()
        require(current==committed,'RENDERER_COMMIT_MISMATCH')
        result[role]=hashlib.sha256(committed).hexdigest()
    if expected is not None:
        require(result==expected,'RENDERER_PROVENANCE_MISMATCH')
    return result


def independently_verify_html_replay(template_bytes,rows,session_id,html_bytes):
    data=json.dumps(rows,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    expected=template_bytes.decode().replace('__DATA__',data).replace('__STORAGE__',json.dumps('newsflux-story02-d2f8-'+session_id)).encode()
    require(expected==html_bytes,'HTML_BYTE_REPLAY')
