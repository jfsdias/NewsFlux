"""Neutral presentation from synthetic or already-frozen identities."""
import csv
import hashlib
import hmac
import io
import json

LABELS=('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')
COLUMNS=('review_id','left_title','left_source','left_published_at','right_title','right_source','right_published_at','human_decision')

def canonical(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def digest(nonce,domain,key):return hmac.new(nonce,(domain+'|'+key).encode(),hashlib.sha256).digest()

def derive(pairs, corpus, nonce):
    if len(nonce)!=32:raise ValueError('nonce length')
    if len(pairs)!=11 or len({p['pair_key'] for p in pairs})!=11:raise ValueError('source pairs')
    if len({x for p in pairs for x in (p['article_id_a'],p['article_id_b'])})!=22:raise ValueError('source articles')
    articles={}
    for x in corpus:
        if x['id'] in articles:raise ValueError('duplicate article')
        articles[x['id']]=x
    ordered=sorted(pairs,key=lambda p:(digest(nonce,'order',p['pair_key']),p['pair_key']))
    if [x['pair_key'] for x in ordered]==[x['pair_key'] for x in sorted(pairs,key=lambda p:p['b1_rank'])]:raise ValueError('rank order exposed')
    if [x['pair_key'] for x in ordered]==[x['pair_key'] for x in sorted(pairs,key=lambda p:p['selection_position'])]:raise ValueError('selection order exposed')
    rows=[];mapping=[]
    for i,p in enumerate(ordered,1):
        a,b=p['article_id_a'],p['article_id_b']
        if a not in articles or b not in articles:raise ValueError('missing article')
        left,right=(b,a) if digest(nonce,'side',p['pair_key'])[0]&1 else (a,b)
        def meta(id):
            x=articles[id];title=x.get('title')
            if not isinstance(title,str) or not title.strip():raise ValueError('missing title')
            return title,x.get('feed_title') or 'SOURCE_UNAVAILABLE',x.get('published_at') or 'PUBLISHED_AT_UNAVAILABLE'
        lt,ls,lp=meta(left);rt,rs,rp=meta(right);rid=f'R{i:03}'
        rows.append(dict(zip(COLUMNS,(rid,lt,ls,lp,rt,rs,rp,''))))
        mapping.append({'review_id':rid,'pair_key':p['pair_key'],'article_id_a':a,'article_id_b':b,'left_article_id':left,'right_article_id':right,'selection_position':p['selection_position'],'b1_rank':p['b1_rank']})
    return rows,mapping

def csv_bytes(rows):
    out=io.StringIO(newline='');writer=csv.DictWriter(out,fieldnames=COLUMNS,lineterminator='\n');writer.writeheader();writer.writerows(rows)
    return out.getvalue().encode()

def complete(rows):return len(rows)==11 and all(x.get('human_decision') in LABELS for x in rows)

def html_data(rows):
    return json.dumps(rows,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
