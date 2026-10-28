"""Prepare a private, neutral, unannotated static review session."""
import builtins,contextlib,csv,hashlib,io,json,os,re,sys
from pathlib import Path
from unittest.mock import patch

ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-neutral-human-review'
SOURCE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-graph-retrieval-selection/attempt-20261028-r3-v4'
HASHES={'graph-retrieval-contract-v1.json':'0236f1671bf13a83d4c64aeacf46b9077caa81b67dc4ba54e6eb1c81ed81ae30','targeted-dev-graph-pack-v1.csv':'d6d2a0531f6a94ef283831ee256ee3381945ea376643eeba275c5eb7f17380fe','targeted-dev-graph-sidecar-v1.jsonl':'98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36','targeted-dev-graph-selection-audit-v1.json':'77aa3f88ea7a4f01fdde8aa9f0af5254c349d2edd789121fa5451e71ca32d6f9','targeted-dev-graph-selection-manifest-v1.json':'356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5'}
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','review-session-v1-human-completed.csv')
LABELS='SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN'
COLUMNS=('annotation_id','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision')
TEMPLATE=Path(__file__).with_name('reviewer_template.html')
GUIDE='''# Review guide

Use only the titles, feeds and published times displayed. Do not infer missing facts.

- **SAME_EVENT**: Both articles report the same concrete event or specific episode, such as the same announcement, court ruling, launch, acquisition, outage, incident or update. Headlines need not use identical wording.
- **RELATED_TOPIC**: Articles are clearly related but describe different events, episodes, developments or claims. The same person, company, product, case, topic or category alone is not enough for SAME_EVENT.
- **DIFFERENT_EVENT**: The articles report different events or have no meaningful event identity relationship.
- **UNCERTAIN**: The available titles and metadata do not safely distinguish these possibilities.

A false merge is more costly than a false split. When stories merely concern the same subject, do not call them SAME_EVENT.
'''.encode()

def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def label_guard():
    def wrap(fn):
        def guarded(path,*args,**kwargs):
            if any(x.lower() in str(path).lower() for x in FORBIDDEN):raise PermissionError('human label access prohibited')
            return fn(path,*args,**kwargs)
        return guarded
    with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)):yield

def contract():
    return {'version':'STORY_02_NEUTRAL_REVIEW_SESSION_V1','source_pack_sha256':HASHES['targeted-dev-graph-pack-v1.csv'],'source_manifest_sha256':HASHES['targeted-dev-graph-selection-manifest-v1.json'],'source_contract_sha256':HASHES['graph-retrieval-contract-v1.json'],'row_count':40,'review_id_prefix':'R','label_options':LABELS,'ordering':'DETERMINISTIC_BLIND_SHA256','reviewer_metadata':'FEED_TITLE_TITLE_PUBLISHED_AT_ONLY','selection_metadata_exposed':'NO','human_decision_initial_state':'BLANK','human_reviewer':'HUMAN_ONLY'}

def verify_inputs():
    for n,h in HASHES.items():
        p=SOURCE/n
        if sha(p.read_bytes())!=h or p.stat().st_mode&0o777!=0o444:raise ValueError('source artifact integrity')
    manifest=json.loads((SOURCE/'targeted-dev-graph-selection-manifest-v1.json').read_bytes())
    if (manifest['pack_state'],manifest['human_labels'],manifest['human_review_started'],manifest['production_policy'])!=('SELECTED_FROZEN_UNANNOTATED',0,False,'NOT_FROZEN'):raise ValueError('source state')
    with (SOURCE/'targeted-dev-graph-pack-v1.csv').open(newline='') as f: rows=list(csv.DictReader(f))
    return rows

def derive(rows,contract_hash):
    if len(rows)!=40:raise ValueError('source row count')
    if any(r['human_decision'] or r['label_options']!=LABELS for r in rows):raise ValueError('source label state')
    keys=[r['pair_key'] for r in rows]; source_ids=[r['annotation_id'] for r in rows]; articles=[int(n) for k in keys for n in k.split(':')]
    if len(set(keys))!=40 or len(set(source_ids))!=40 or len(set(articles))!=80 or set(source_ids)!={f'G{i:03}' for i in range(1,41)}:raise ValueError('source identity')
    order=sorted(rows,key=lambda r:sha(f"STORY02-D2B|{contract_hash}|{r['pair_key']}".encode()))
    if [r['annotation_id'] for r in order]==source_ids:raise ValueError('source order preserved')
    reviews=[];mapping=[]
    for i,r in enumerate(order,1):
        ident=f'R{i:03}';reviews.append({k:ident if k=='annotation_id' else r[k] for k in COLUMNS});mapping.append({'review_annotation_id':ident,'source_annotation_id':r['annotation_id'],'pair_key':r['pair_key']})
    return reviews,mapping

def csv_bytes(rows):
    out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=COLUMNS,lineterminator='\n');w.writeheader();w.writerows(rows);return out.getvalue().encode()

def freeze(path,data):
    path=Path(path);tmp=path.with_name('.'+path.name+'.tmp')
    if path.exists():raise FileExistsError(path)
    with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    h=sha(data)
    if sha(tmp.read_bytes())!=h:raise ValueError('temporary hash')
    os.replace(tmp,path);path.chmod(0o444)
    if path.stat().st_mode&0o777!=0o444 or sha(path.read_bytes())!=h:raise ValueError('freeze')
    return h

def privacy(data):
    text=data.decode('utf8'); forbidden=('pair_key','source_annotation_id','selection_lane','selection_priority','event_strategy','near_strategy','qwen_score','reciprocal_rank','shared_support','support_degree')
    if any(x.lower() in text.lower() for x in forbidden) or re.search(r'\b(?:E0|N1|G40|G0(?:0[1-9]|[1-3][0-9]|40))\b',text):raise ValueError('reviewer metadata leak')

def build(rows,contract_hash):
    reviews,mapping=derive(rows,contract_hash);csvdata=csv_bytes(reviews); csvhash=sha(csvdata)
    data=json.dumps(reviews,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    html=TEMPLATE.read_text().replace('__DATA__',data).replace('__STORAGE__','newsflux-story02-d2b-'+sha((contract_hash+'|'+csvhash).encode())[:24]).encode()
    for item in (html,csvdata,GUIDE):privacy(item)
    return reviews,mapping,csvdata,html

def validate(source,review,mapping,contract_hash,csvdata,html):
    if len(review)!=40 or len(mapping)!=40:raise ValueError('count')
    sourceby={x['annotation_id']:x for x in source};ids=[f'R{i:03}' for i in range(1,41)]
    if [x['annotation_id'] for x in review]!=ids or [x['review_annotation_id'] for x in mapping]!=ids:raise ValueError('review IDs')
    if len({x['pair_key'] for x in mapping})!=40 or len({x['source_annotation_id'] for x in mapping})!=40:raise ValueError('mapping duplicates')
    expected=sorted(source,key=lambda r:sha(f"STORY02-D2B|{contract_hash}|{r['pair_key']}".encode()))
    if [m['source_annotation_id'] for m in mapping]!=[r['annotation_id'] for r in expected]:raise ValueError('order')
    for r,m in zip(review,mapping):
        src=sourceby[m['source_annotation_id']]
        if m['pair_key']!=src['pair_key'] or tuple(r)!=COLUMNS or any(r[k]!=src[k] for k in COLUMNS if k!='annotation_id') or r['human_decision'] or r['label_options']!=LABELS:raise ValueError('metadata')
    if [x['source_annotation_id'] for x in mapping]==[x['annotation_id'] for x in source]:raise ValueError('order unchanged')
    match=re.search(r'const rows\s*=\s*(.*?)\s*const storageKey\s*=',html.decode(),re.DOTALL)
    if not match or json.loads(match.group(1))!=review:raise ValueError('embedded reviewer data')
    source=html.decode()
    if re.search(r'''(?:src|href)\s*=\s*["'](?:https?:)?//''',source,re.I) or re.search(r'\bfetch\s*\(',source):raise ValueError('remote asset')
    if b'neutral-review-map-v1.jsonl' in html or csv_bytes(review)!=csvdata:raise ValueError('surface')
    if "JSON.stringify(decisions)" not in source or not re.search(r'count\s*!==\s*40',source) or "columns.map" not in source:raise ValueError('review controls')
    for d in (csvdata,html,GUIDE):privacy(d)

def run(destination):
    target=Path(destination).resolve();root=ROOT.resolve()
    if not target.is_relative_to(root) or target==root or target.exists():raise ValueError('new private destination')
    with label_guard():
        source=verify_inputs();target.mkdir(parents=True,mode=0o700);public=target/'reviewer';public.mkdir(mode=0o700)
        c=canonical(contract());ch=freeze(target/'neutral-review-contract-v1.json',c)
        a=build(source,ch);b=build(source,ch)
        if a!=b:raise ValueError('session replay')
        reviews,mapping,cb,html=a;validate(source,reviews,mapping,ch,cb,html)
        mapbytes=b''.join(canonical(x) for x in mapping)
        hashes={'neutral_review_contract_sha256':ch,'neutral_review_csv_sha256':freeze(public/'neutral-review-v1.csv',cb),'neutral_review_map_sha256':freeze(target/'neutral-review-map-v1.jsonl',mapbytes),'review_guide_sha256':freeze(public/'REVIEW_GUIDE.md',GUIDE),'review_html_sha256':freeze(public/'index.html',html)}
        manifest={'version':'STORY_02_NEUTRAL_REVIEW_SESSION_V1','source_pack_sha256':HASHES['targeted-dev-graph-pack-v1.csv'],'source_manifest_sha256':HASHES['targeted-dev-graph-selection-manifest-v1.json'],'source_contract_sha256':HASHES['graph-retrieval-contract-v1.json'],**hashes,'row_count':40,'review_id_count':40,'ordering':'DETERMINISTIC_BLIND_SHA256','human_decision_nonblank_count':0,'human_review_started':False,'session_state':'PREPARED_UNOPENED','reviewer_metadata_leak_gate':'PASS','dom_hidden_metadata_leak_gate':'PASS','remote_request_gate':'PASS'}
        mh=freeze(target/'neutral-review-session-manifest-v1.json',canonical(manifest));verify_inputs()
        return {**manifest,'session_manifest_sha256':mh,'localstorage_key':'newsflux-story02-d2b-'+sha((ch+'|'+sha(cb)).encode())[:24],'reviewer_root':str(public)}
if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('usage: prepare_review_session.py PRIVATE_SESSION')
    print(json.dumps(run(sys.argv[1]),sort_keys=True))
