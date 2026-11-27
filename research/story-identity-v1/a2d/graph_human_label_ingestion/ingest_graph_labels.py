"""Validate and freeze already completed human decisions, without analysis."""
import builtins,contextlib,csv,hashlib,io,json,os,sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch

BASE='3aa03136b44f7f6cc8deef1e000a9399374edcd2'
ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-graph-human-label-ingestion'
D2B=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-neutral-human-review/session-20261028-v4'
R3=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-graph-retrieval-selection/attempt-20261028-r3-v4'
COMPLETED_SHA='c0a4bff64ec287f750229aad5d75cceeb19ae6a28dd7d4badc875eca54d22977'
HASHES={D2B/'neutral-review-contract-v1.json':'73c9ef7226466c6f8ecb7edcaef46224e2524ca8b215445094cd5f898d8b9ed8',D2B/'reviewer/neutral-review-v1.csv':'391b65a0cdcecc5ddaffceeeb6b89edda8261a18e60152cf8117e461e7d886cb',D2B/'neutral-review-map-v1.jsonl':'7f7e89efe09844f01694a9126f9a9fc87ba82872cbd6d47235f0e529ac4545d7',D2B/'reviewer/REVIEW_GUIDE.md':'0ccd457c902417c1d510e2bf9e1cd5c8f058f21eb208dd491a1d44702e5e2e31',D2B/'reviewer/index.html':'3553d828ff5e925d22cacc934fdd4308af58feb42f95b34094e2ae75de082d95',D2B/'neutral-review-session-manifest-v1.json':'ffa9fec956b66fc7b0e3576314a1fffb0e5f9e4cfa9fc948cf59aa2ac77bb9b0',R3/'targeted-dev-graph-pack-v1.csv':'d6d2a0531f6a94ef283831ee256ee3381945ea376643eeba275c5eb7f17380fe',R3/'targeted-dev-graph-selection-manifest-v1.json':'356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5'}
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','review-session-v1-human-completed.csv')
LABELS='SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN'; LABELSET=set(LABELS.split('|'))
COLUMNS=('annotation_id','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision')

def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def label_guard():
 def wrap(fn):
  def guarded(path,*args,**kwargs):
   if Path(str(path)).name in FORBIDDEN:raise PermissionError('forbidden human-label source')
   return fn(path,*args,**kwargs)
  return guarded
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)):yield

def read_csv(data):
 reader=csv.DictReader(io.StringIO(data.decode('utf8'),newline=''))
 if tuple(reader.fieldnames or ())!=COLUMNS:raise ValueError('CSV schema')
 rows=list(reader)
 if any(None in row or any(v is None for v in row.values()) for row in rows):raise ValueError('CSV row')
 return rows

def blank_bytes(rows):
 out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=COLUMNS,lineterminator='\n');w.writeheader();w.writerows([{**r,'human_decision':''} for r in rows]);return out.getvalue().encode()

def verify_inputs(completed):
 for path,h in HASHES.items():
  if sha(path.read_bytes())!=h or path.stat().st_mode&0o777!=0o444:raise ValueError('input integrity '+path.name)
 if Path(completed).name!='story02-d2b-human-completed.csv':raise ValueError('completed input name')
 raw=Path(completed).read_bytes()
 if sha(raw)!=COMPLETED_SHA:raise ValueError('completed input integrity')
 return raw

def derive(human,blank,mapping,source):
 ids=[f'R{i:03}' for i in range(1,41)];gids={f'G{i:03}' for i in range(1,41)}
 if len(human)!=40 or len(blank)!=40 or [r['annotation_id'] for r in human]!=ids or [r['annotation_id'] for r in blank]!=ids:raise ValueError('review IDs')
 for h,b in zip(human,blank):
  if tuple(h)!=COLUMNS or tuple(b)!=COLUMNS or b['human_decision'] or h['human_decision'] not in LABELSET or h['label_options']!=LABELS or any(h[k]!=b[k] for k in COLUMNS if k!='human_decision'):raise ValueError('metadata or decision')
 counts=Counter(r['human_decision'] for r in human)
 if counts!=Counter({'RELATED_TOPIC':2,'DIFFERENT_EVENT':38}):raise ValueError('label count integrity')
 if len(mapping)!=40 or any(set(x)!={'review_annotation_id','source_annotation_id','pair_key'} for x in mapping):raise ValueError('mapping schema')
 if {x['review_annotation_id'] for x in mapping}!=set(ids) or {x['source_annotation_id'] for x in mapping}!=gids or len({x['pair_key'] for x in mapping})!=40:raise ValueError('mapping bijection')
 source_by={r['annotation_id']:r['pair_key'] for r in source}
 if len(source)!=40 or set(source_by)!=gids or len(set(source_by.values()))!=40 or any(source_by[m['source_annotation_id']]!=m['pair_key'] for m in mapping):raise ValueError('R3 identity')
 hby={r['annotation_id']:r['human_decision'] for r in human}
 return sorted([{'review_annotation_id':m['review_annotation_id'],'source_annotation_id':m['source_annotation_id'],'pair_key':m['pair_key'],'human_decision':hby[m['review_annotation_id']]} for m in mapping],key=lambda r:r['source_annotation_id'])

def freeze(path,data):
 path=Path(path);tmp=path.with_name('.'+path.name+'.tmp')
 if path.exists():raise FileExistsError(path)
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 h=sha(data)
 if sha(tmp.read_bytes())!=h:raise ValueError('before rename')
 os.replace(tmp,path);path.chmod(0o444)
 if path.stat().st_mode&0o777!=0o444 or sha(path.read_bytes())!=h:raise ValueError('after chmod')
 return h

def inputs(completed):
 raw=verify_inputs(completed);human=read_csv(raw);blank=read_csv((D2B/'reviewer/neutral-review-v1.csv').read_bytes())
 if sha(blank_bytes(human))!=HASHES[D2B/'reviewer/neutral-review-v1.csv']:raise ValueError('neutral reconstruction')
 mapping=[json.loads(x) for x in (D2B/'neutral-review-map-v1.jsonl').read_text().splitlines() if x.strip()]
 with (R3/'targeted-dev-graph-pack-v1.csv').open(newline='') as f:source=list(csv.DictReader(f))
 return raw,human,blank,mapping,source

def validate_output(actual,human,blank,mapping,source):
 ids=[f"R{i:03}" for i in range(1,41)]; gids=[f"G{i:03}" for i in range(1,41)]
 if any(len(x)!=40 for x in (actual,human,blank,mapping,source)):raise ValueError("row counts")
 if [r["annotation_id"] for r in human]!=ids or [r["annotation_id"] for r in blank]!=ids:raise ValueError("review order")
 if [r["source_annotation_id"] for r in actual]!=gids:raise ValueError("source order")
 if len({r["review_annotation_id"] for r in actual})!=40 or len({r["pair_key"] for r in actual})!=40:raise ValueError("output uniqueness")
 mapped={m["review_annotation_id"]:m for m in mapping}; src={r["annotation_id"]:r["pair_key"] for r in source}; review={r["annotation_id"]:r for r in human}
 if set(mapped)!=set(ids) or len(src)!=40 or set(src)!=set(gids):raise ValueError("identity set")
 for h,b in zip(human,blank):
  if tuple(h)!=COLUMNS or tuple(b)!=COLUMNS or h["human_decision"] not in LABELSET or b["human_decision"] or h["label_options"]!=LABELS or any(h[k]!=b[k] for k in COLUMNS if k!="human_decision"):raise ValueError("metadata")
 if Counter(h["human_decision"] for h in human)!=Counter({"RELATED_TOPIC":2,"DIFFERENT_EVENT":38}):raise ValueError("counts")
 for r in actual:
  if set(r)!={"review_annotation_id","source_annotation_id","pair_key","human_decision"}:raise ValueError("output schema")
  mid=r["review_annotation_id"]; m=mapped.get(mid)
  if m is None or set(m)!={"review_annotation_id","source_annotation_id","pair_key"} or m["source_annotation_id"]!=r["source_annotation_id"] or m["pair_key"]!=r["pair_key"] or src.get(r["source_annotation_id"])!=r["pair_key"] or review[mid]["human_decision"]!=r["human_decision"]:raise ValueError("crosscheck")

def validate_frozen(root,completed):
 raw,human,blank,mapping,source=inputs(completed)
 if (root/'human-completed-input-v1.csv').read_bytes()!=raw:raise ValueError('raw readback')
 data=(root/'graph-dev-human-labels-v1.jsonl').read_bytes(); actual=[json.loads(x) for x in data.splitlines()]
 validate_output(actual,human,blank,mapping,source)
 if data!=b''.join(canonical(r) for r in actual):raise ValueError('canonical readback')
 m=json.loads((root/'graph-human-label-ingestion-manifest-v1.json').read_bytes())
 for name,key in [('human-completed-input-v1.csv','human_completed_sha256'),('graph-dev-human-labels-v1.jsonl','graph_dev_human_labels_sha256'),('graph-human-label-ingestion-audit-v1.json','ingestion_audit_sha256')]:
  p=root/name
  if p.stat().st_mode&0o777!=0o444 or sha(p.read_bytes())!=m[key]:raise ValueError('manifest readback')
 if (root/'graph-human-label-ingestion-manifest-v1.json').stat().st_mode&0o777!=0o444:raise ValueError('manifest mode')

def run(dest,completed):
 dest=Path(dest).resolve();root=ROOT.resolve()
 if not dest.is_relative_to(root) or dest==root or dest.exists():raise ValueError('new private attempt')
 with label_guard():
  raw,human,blank,mapping,source=inputs(completed); one=derive(human,blank,mapping,source);two=derive(human,blank,mapping,source)
  data=b''.join(canonical(r) for r in one)
  if data!=b''.join(canonical(r) for r in two):raise ValueError('replay')
  def make_audit():
   return {'version':'STORY_02_GRAPH_HUMAN_LABEL_INGESTION_V1','human_completed_sha256':COMPLETED_SHA,'neutral_review_csv_sha256':HASHES[D2B/'reviewer/neutral-review-v1.csv'],'neutral_review_map_sha256':HASHES[D2B/'neutral-review-map-v1.jsonl'],'neutral_review_contract_sha256':HASHES[D2B/'neutral-review-contract-v1.json'],'d2b_session_manifest_sha256':HASHES[D2B/'neutral-review-session-manifest-v1.json'],'r3_pack_sha256':HASHES[R3/'targeted-dev-graph-pack-v1.csv'],'r3_selection_manifest_sha256':HASHES[R3/'targeted-dev-graph-selection-manifest-v1.json'],'row_count':40,'same_event_count':0,'related_topic_count':2,'different_event_count':38,'uncertain_count':0,'blank_decisions':0,'invalid_decisions':0,'reviewer_metadata_match_gate':'PASS','neutral_reconstruction_gate':'PASS','map_bijection_gate':'PASS','r3_identity_crosscheck_gate':'PASS','forbidden_human_label_access_gate':'PASS','ingestion_replay_gate':'PASS','independent_validator_gate':'PASS'}
  audit=make_audit()
  a=canonical(audit)
  if canonical(make_audit())!=a:raise ValueError('audit replay')
  dest.mkdir(parents=True,mode=0o700);rh=freeze(dest/'human-completed-input-v1.csv',raw);dh=freeze(dest/'graph-dev-human-labels-v1.jsonl',data);ah=freeze(dest/'graph-human-label-ingestion-audit-v1.json',a)
  m={'version':'STORY_02_GRAPH_HUMAN_LABEL_INGESTION_V1','base_main_sha':BASE,'human_completed_sha256':rh,'neutral_review_csv_sha256':audit['neutral_review_csv_sha256'],'neutral_review_map_sha256':audit['neutral_review_map_sha256'],'neutral_review_contract_sha256':audit['neutral_review_contract_sha256'],'d2b_session_manifest_sha256':audit['d2b_session_manifest_sha256'],'r3_pack_sha256':audit['r3_pack_sha256'],'r3_selection_manifest_sha256':audit['r3_selection_manifest_sha256'],'human_label_source':'MANUAL_HUMAN_REVIEW','agent_generated_labels':0,'row_count':40,'annotation_state':'ANNOTATED_INGESTED_FROZEN','analysis_state':'NOT_RUN','production_policy':'NOT_FROZEN','graph_dev_human_labels_sha256':dh,'ingestion_audit_sha256':ah}
  mh=freeze(dest/'graph-human-label-ingestion-manifest-v1.json',canonical(m));validate_frozen(dest,completed);verify_inputs(completed)
  return {**audit,'graph_dev_human_labels_sha256':dh,'ingestion_audit_sha256':ah,'ingestion_manifest_sha256':mh}
if __name__=='__main__':
 if len(sys.argv)!=3:raise SystemExit('usage: ingest_graph_labels.py PRIVATE_ATTEMPT COMPLETED_CSV')
 print(json.dumps(run(sys.argv[1],sys.argv[2]),sort_keys=True))
