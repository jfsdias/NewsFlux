"""Independent checks of neutral sample presentation and frozen artifacts."""
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
    m=re.search(r'const rows=(.*?);\s*const storageKey=',text,re.S)
    require(bool(m) and json.loads(m.group(1))==rows,'HTML_ROWS')
    require(json.dumps('newsflux-story02-d2f8-'+session_id) in text,'NAMESPACE')
    require("rows.length!==11||!rows.every" in text and "labels.includes(decisions[x.review_id])" in text,'COMPLETION_RULE')
    require(all(x in text for x in LABELS),'TAXONOMY')

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
