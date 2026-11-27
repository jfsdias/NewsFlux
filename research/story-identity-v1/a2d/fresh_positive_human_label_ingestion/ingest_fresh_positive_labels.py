"""Ingest only the authorized fresh review; never evaluate scientific gates."""
import builtins,contextlib,csv,hashlib,io,json,os,socket,sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch

ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c'
SESSION=ROOT/'p4-fresh-positive-neutral-review/attempt-20261029-d2f2-a'
COMPLETION=ROOT/'p4-fresh-positive-human-review/attempt-20261029T123414234146Z'
OUTPUT=ROOT/'p4-fresh-positive-human-label-ingestion'
INPUTS={COMPLETION/'fresh-positive-human-completed-v1.csv':'527b9da0033ccf781e1c874778e2c16fb8dce340dd46e49c950d2e4532acc71c',COMPLETION/'human-review-completion-receipt-v1.json':'fe74e29d9085013382019d87d741c2f42f8342704df0f29b8c650d5a5ce1d3f2',COMPLETION/'human-review-completion-manifest-v1.json':'e2715c037e3e854d10f8baef7f46d98eaf6bbc67c7ea625a5b4adf2272cb1b72',SESSION/'selected-positive-review-pack-v1.jsonl':'a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90',SESSION/'reviewer/neutral-review-v1.csv':'8a6795294a626411a2badacf7c2e62f376f109bade17955c3de7afbeb8276d05',SESSION/'neutral-review-map-v1.jsonl':'ae160b8f236170dbdc6dc00c73bfb0e20a82e9729ef0a1e0482e970a7aedf47b',SESSION/'neutral-review-contract-v1.json':'b498c26be5b667d91c1f9df338dea81a91dfed0edb334affeefd8434fcd43999',SESSION/'neutral-review-manifest-v1.json':'5070a8bcd079f60d317a5ba7e667201138e0c7b8f3133a3deac6629b4f51fa28'}
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels','blind-human-labels','graph-dev-human-labels','story02-d2b-human-completed','d2e3','normalized-content','raw-payload')
COLUMNS=('annotation_id','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision')
LABELS='SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN'; LABELSET=set(LABELS.split('|'))
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(o):return (json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def guard():
 def wrap(fn):
  def wrapped(path,*a,**k):
   if any(n in str(path).lower() for n in FORBIDDEN):raise PermissionError('forbidden source')
   return fn(path,*a,**k)
  return wrapped
 def deny(*a,**k):raise PermissionError('network prohibited')
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)),patch.object(socket.socket,'connect',deny):yield

def verify_inputs():
 for p,h in INPUTS.items():
  if sha(p.read_bytes())!=h or p.stat().st_mode&0o777!=0o444:raise ValueError('input integrity')
def read_csv(data):
 r=csv.DictReader(io.StringIO(data.decode('utf8'),newline=''))
 if tuple(r.fieldnames or ())!=COLUMNS:raise ValueError('schema')
 rows=list(r)
 if any(None in x or any(v is None for v in x.values()) for x in rows):raise ValueError('invalid csv row')
 return rows
def blank_bytes(rows):
 out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=COLUMNS,lineterminator='\n');w.writeheader();w.writerows([{**r,'human_decision':''} for r in rows]);return out.getvalue().encode()
def validate_review(human,blank):
 ids={f'R{i:03}' for i in range(1,41)}
 if len(human)!=40 or len(blank)!=40 or len({x['annotation_id'] for x in human})!=40 or len({x['annotation_id'] for x in blank})!=40 or {x['annotation_id'] for x in human}!=ids or {x['annotation_id'] for x in blank}!=ids:raise ValueError('review ids')
 by={x['annotation_id']:x for x in blank}
 for x in human:
  y=by[x['annotation_id']]
  if tuple(x)!=COLUMNS or tuple(y)!=COLUMNS or x['human_decision'] not in LABELSET or y['human_decision'] or x['label_options']!=LABELS or any(x[k]!=y[k] for k in COLUMNS if k!='human_decision'):raise ValueError('review metadata')
 if blank_bytes(human)!=blank_bytes(blank):raise ValueError('neutral reconstruction')

def derive(human,blank,mapping,selected):
 validate_review(human,blank)
 ids={f'R{i:03}' for i in range(1,41)}
 if len(mapping)!=40 or len(selected)!=40 or {x['review_annotation_id'] for x in mapping}!=ids or len({x['review_annotation_id'] for x in mapping})!=40 or len({x['pair_key'] for x in mapping})!=40 or len({x['pair_key'] for x in selected})!=40:raise ValueError('bijection')
 if len({i for r in selected for i in (r['article_id_a'],r['article_id_b'])})!=80:raise ValueError('article overlap')
 source={x['pair_key']:x for x in selected};decisions={x['annotation_id']:x['human_decision'] for x in human}
 if set(source)!={x['pair_key'] for x in mapping}:raise ValueError('outside pack')
 result=[]
 for m in mapping:
  a,b=m['article_id_a'],m['article_id_b'];key=m['pair_key'];s=source[key]
  if not isinstance(a,int) or not isinstance(b,int) or a>=b or key!=f'{a}:{b}':raise ValueError('pair key')
  if set(s)!=(set(m)-{'review_annotation_id'}) or any(m[k]!=s[k] for k in s):raise ValueError('identity mismatch')
  result.append({'review_annotation_id':m['review_annotation_id'],'pair_key':key,'human_decision':decisions[m['review_annotation_id']]})
 return sorted(result,key=lambda r:r['pair_key'])
def counts(rows):
 c=Counter(r['human_decision'] for r in rows)
 return {name:c[name] for name in ('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')}
def freeze(path,data):
 tmp=path.with_name('.'+path.name+'.tmp')
 if path.exists():raise FileExistsError(path)
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 if sha(tmp.read_bytes())!=sha(data):raise ValueError('temp hash')
 os.replace(tmp,path);path.chmod(0o444)
 if sha(path.read_bytes())!=sha(data) or path.stat().st_mode&0o777!=0o444:raise ValueError('freeze readback')
 return sha(data)
def run(target):
 target=Path(target).resolve()
 if not target.is_relative_to(OUTPUT.resolve()) or target==OUTPUT.resolve() or target.exists():raise ValueError('new private destination required')
 with guard():
  verify_inputs()
  raw=(COMPLETION/'fresh-positive-human-completed-v1.csv').read_bytes();human=read_csv(raw)
  blank=read_csv((SESSION/'reviewer/neutral-review-v1.csv').read_bytes())
  validate_review(human,blank)
  if sha(blank_bytes(human))!=INPUTS[SESSION/'reviewer/neutral-review-v1.csv']:raise ValueError('neutral hash reconstruction')
  mapping=[json.loads(x) for x in (SESSION/'neutral-review-map-v1.jsonl').read_bytes().splitlines()]
  selected=[json.loads(x) for x in (SESSION/'selected-positive-review-pack-v1.jsonl').read_bytes().splitlines()]
  one=derive(human,blank,mapping,selected);two=derive(human,blank,mapping,selected)
  data=b''.join(canonical(x) for x in one)
  if data!=b''.join(canonical(x) for x in two):raise ValueError('replay')
  totals=counts(one)
  if sum(totals.values())!=40:raise ValueError('count sum')
  OUTPUT.mkdir(parents=True,mode=0o700,exist_ok=True)
  if OUTPUT.stat().st_mode&0o777!=0o700:raise ValueError('parent mode')
  target.mkdir(mode=0o700)
  rawh=freeze(target/'human-completed-input-v1.csv',raw);lh=freeze(target/'fresh-positive-human-labels-v1.jsonl',data)
  audit={'version':'STORY02_D2F4_AUDIT_V1','track':'STORY_02_A2D2C_P4_D2F4_HUMAN_LABEL_INGESTION','base_sha':'708316aa85986a55204fcb4b9d7ccabdcc551d52','completed_sha256':rawh,'neutral_sha256':INPUTS[SESSION/'reviewer/neutral-review-v1.csv'],'map_sha256':INPUTS[SESSION/'neutral-review-map-v1.jsonl'],'selected_pack_sha256':INPUTS[SESSION/'selected-positive-review-pack-v1.jsonl'],'d2f2_manifest_sha256':INPUTS[SESSION/'neutral-review-manifest-v1.json'],'d2f3_manifest_sha256':INPUTS[COMPLETION/'human-review-completion-manifest-v1.json'],'canonical_labels_sha256':lh,'row_count':40,'class_counts':totals,'blank_count':0,'invalid_count':0,'map_bijection':'PASS','neutral_reconstruction':'PASS','scientific_analysis_performed':False,'stratified_label_analysis':False,'discovery_gate_evaluated':False,'calibration_gate_evaluated':False}
  ah=freeze(target/'fresh-positive-human-label-ingestion-audit-v1.json',canonical(audit))
  manifest={'version':'STORY02_D2F4_MANIFEST_V1','completed_sha256':rawh,'labels_sha256':lh,'audit_sha256':ah,'input_sha256':{p.name:h for p,h in INPUTS.items()},'file_mode':'0444','directory_mode':'0700','ordering':'PAIR_KEY_LEXICOGRAPHIC'}
  mh=freeze(target/'fresh-positive-human-label-ingestion-manifest-v1.json',canonical(manifest))
  verify_inputs()
  return {'counts':totals,'input_sha256':rawh,'labels_sha256':lh,'audit_sha256':ah,'manifest_sha256':mh,'private_root':str(target)}
if __name__=='__main__':print(json.dumps(run(sys.argv[1]),sort_keys=True))
