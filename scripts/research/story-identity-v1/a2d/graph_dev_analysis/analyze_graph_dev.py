"""Frozen graph DEV descriptive analysis; no threshold optimization."""
import builtins,contextlib,hashlib,io,json,math,os,statistics,sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch

BASE='0a53a0dc56811c735e76d3953cab94429ccec1ba';PRIVATE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c';ROOT=PRIVATE/'p4-graph-dev-analysis';D2C=PRIVATE/'p4-graph-human-label-ingestion/attempt-20261028-d2c-v1';R3=PRIVATE/'p4-graph-retrieval-selection/attempt-20261028-r3-v4';HERE=Path(__file__).resolve().parent;OLD=HERE.parent/'fresh_dev_analysis'
HASHES={D2C/'graph-dev-human-labels-v1.jsonl':'561d857e73eb74e8ef9603e2699a5168ea4be5b7b117dcafb4fc2d5789ff57b1',D2C/'graph-human-label-ingestion-audit-v1.json':'0920f9a9143802b343b4279b6bb3a3fda68030d893d0c393d93d15492fdc2cf3',D2C/'graph-human-label-ingestion-manifest-v1.json':'fef244105cfcfb129de5763a72d13392686e17d58700c402e4fcf927a03f855b',R3/'graph-retrieval-contract-v1.json':'0236f1671bf13a83d4c64aeacf46b9077caa81b67dc4ba54e6eb1c81ed81ae30',R3/'targeted-dev-graph-pack-v1.csv':'d6d2a0531f6a94ef283831ee256ee3381945ea376643eeba275c5eb7f17380fe',R3/'targeted-dev-graph-sidecar-v1.jsonl':'98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36',R3/'targeted-dev-graph-selection-audit-v1.json':'77aa3f88ea7a4f01fdde8aa9f0af5254c349d2edd789121fa5451e71ca32d6f9',R3/'targeted-dev-graph-selection-manifest-v1.json':'356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5'}
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','review-session-v1-human-completed.csv','story02-d2b-human-completed.csv')
FEATURES=('qwen_score','temporal_delta_hours','rank_a_to_b','rank_b_to_a','reciprocal_rank_max','shared_support_article_count','shared_support_feed_count','common_top5_count','common_top10_count','support_degree_a','support_degree_b','min_support_degree','support_burst_span_hours')
LABELS=('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN');LANES=('event','near','control');OLD_COUNTS={'SAME_EVENT':0,'RELATED_TOPIC':1,'DIFFERENT_EVENT':79,'UNCERTAIN':0}

def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return (json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def label_guard():
 def wrap(fn):
  def guarded(path,*args,**kwargs):
   if Path(str(path)).name in FORBIDDEN:raise PermissionError('forbidden human-label file')
   return fn(path,*args,**kwargs)
  return guarded
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)):yield

def gitblob(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def verify_inputs():
 for p,h in HASHES.items():
  if sha(p.read_bytes())!=h or p.stat().st_mode&0o777!=0o444:raise ValueError('input integrity '+p.name)
 for name,h in [('DEV_ANALYSIS_PROTOCOL.md','d47e44013456c2252afa22d81afb0e282d8d23a4'),('DEV_ANALYSIS_REPORT.md','35d5ae17746771c139905d09a7854ce54debe7c6')]:
  if gitblob((OLD/name).read_bytes())!=h:raise ValueError('old DEV aggregate drift')
 report=(OLD/'DEV_ANALYSIS_REPORT.md').read_text();protocol=(OLD/'DEV_ANALYSIS_PROTOCOL.md').read_text()
 if '0 SAME_EVENT, 1 RELATED_TOPIC, 79 DIFFERENT_EVENT and 0 UNCERTAIN' not in report or 'at least eight SAME_EVENT, eight RELATED_TOPIC, 60 non-UNCERTAIN records' not in protocol:raise ValueError('old DEV aggregate contract')
 m=json.loads((D2C/'graph-human-label-ingestion-manifest-v1.json').read_bytes())
 for key,value in {'annotation_state':'ANNOTATED_INGESTED_FROZEN','analysis_state':'NOT_RUN','human_label_source':'MANUAL_HUMAN_REVIEW','agent_generated_labels':0,'row_count':40}.items():
  if m.get(key)!=value:raise ValueError('ingestion state')

def join(labels,side):
 if len(labels)!=40 or len(side)!=40:raise ValueError('join count')
 lb={r['pair_key']:r for r in labels}; sb={r['pair_key']:r for r in side}
 if len(lb)!=40 or len(sb)!=40 or set(lb)!=set(sb):raise ValueError('pair identity mismatch')
 if Counter(x['human_decision'] for x in labels)!=Counter({'RELATED_TOPIC':2,'DIFFERENT_EVENT':38}):raise ValueError('label count')
 if Counter(x['selection_lane'] for x in side)!=Counter({'event':20,'near':12,'control':8}):raise ValueError('lane count')
 rows=[]
 for key in lb:
  a,b=lb[key],sb[key]
  if a['source_annotation_id']!=b['annotation_id']:raise ValueError('source identity mismatch')
  row={'source_annotation_id':a['source_annotation_id'],'review_annotation_id':a['review_annotation_id'],'pair_key':key,'human_decision':a['human_decision'],'selection_lane':b['selection_lane']}
  for f in FEATURES:
   value=b.get(f)
   if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value)):raise ValueError('invalid numeric feature')
   row[f]=value
  rows.append(row)
 rows.sort(key=lambda r:r['source_annotation_id'])
 if [r['source_annotation_id'] for r in rows]!=[f'G{i:03}' for i in range(1,41)] or len({r['review_annotation_id'] for r in rows})!=40:raise ValueError('source/review IDs')
 return rows

def divide(a,b):return a/b if b else None

def merge_proxy(rows):
 tp=fr=fd=fn=tn=0
 for r in rows:
  lab=r['human_decision'];event=r['selection_lane']=='event'
  if lab=='UNCERTAIN':continue
  if event and lab=='SAME_EVENT':tp+=1
  elif event and lab=='RELATED_TOPIC':fr+=1
  elif event and lab=='DIFFERENT_EVENT':fd+=1
  elif not event and lab=='SAME_EVENT':fn+=1
  elif not event and lab in ('RELATED_TOPIC','DIFFERENT_EVENT'):tn+=1
  else:raise ValueError('label')
 return {'tp':tp,'fp_related':fr,'fp_different':fd,'fn':fn,'tn':tn,'precision':divide(tp,tp+fr+fd),'recall':divide(tp,tp+fn),'event_negative_count':fr+fd,'event_negative_share':divide(fr+fd,tp+fr+fd),'interpretation':'EVENT_LANE_MERGE_PROXY_ONLY_NOT_PRODUCTION_CLASSIFIER'}

def recommendation(same,related,nonuncertain):
 if same>=8 and related>=8 and nonuncertain>=60:return 'DEV_EVIDENCE_SUFFICIENT_FOR_NEXT_SCORER_STAGE'
 if same>0:return 'GRAPH_CONTEXT_PARTIAL_SIGNAL_EVIDENCE_STILL_INSUFFICIENT'
 return 'GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV'

def analyze(rows):
 matrix={lane:{**{lab:sum(r['selection_lane']==lane and r['human_decision']==lab for r in rows) for lab in LABELS},'total':sum(r['selection_lane']==lane for r in rows)} for lane in LANES};yields={lane:{'strict_same_yield':divide(m['SAME_EVENT'],m['total']),'related_or_same_yield':divide(m['SAME_EVENT']+m['RELATED_TOPIC'],m['total']),'interpretation':'NOT_A_MERGE_PRECISION_METRIC'} for lane,m in matrix.items()}
 def summary(subset):
  result={}
  for f in FEATURES:
   vals=[r[f] for r in subset if r[f] is not None]
   result[f]={'n':len(subset),'available_n':len(vals),'min':min(vals) if vals else None,'median':statistics.median(vals) if vals else None,'max':max(vals) if vals else None}
  return result
 counts=Counter(r['human_decision'] for r in rows);combined={lab:OLD_COUNTS[lab]+counts[lab] for lab in LABELS};combined['total']=sum(combined.values());combined['non_uncertain']=combined['total']-combined['UNCERTAIN'];rec=recommendation(combined['SAME_EVENT'],combined['RELATED_TOPIC'],combined['non_uncertain'])
 next_track='STORY_02_A2D2C_P4_D2E_EVENT_IDENTITY_SIGNAL_REDESIGN' if counts['SAME_EVENT']==0 else 'PM_REVIEW_NEXT_SCORER_STAGE'
 return {'input_hashes':{p.name:h for p,h in HASHES.items()},'matrix':matrix,'lane_yields':yields,'proxy':merge_proxy(rows),'feature_summaries':{'by_lane':{k:summary([r for r in rows if r['selection_lane']==k]) for k in LANES},'by_human_decision':{k:{'sample_caution':'VERY_SMALL_N_NO_INFERENTIAL_CLAIM' if k=='RELATED_TOPIC' else None,'features':summary([r for r in rows if r['human_decision']==k])} for k in LABELS}},'new_counts':{k:counts[k] for k in LABELS},'old_counts':OLD_COUNTS,'combined':combined,'thresholds':{'min_same_event':8,'min_related_topic':8,'min_non_uncertain':60,'min_positive_buckets':2},'sufficiency':{'same_event':'PASS' if combined['SAME_EVENT']>=8 else 'FAIL','related_topic':'PASS' if combined['RELATED_TOPIC']>=8 else 'FAIL','non_uncertain':'PASS' if combined['non_uncertain']>=60 else 'FAIL','positive_buckets':'NOT_COMPARABLE_ACROSS_SELECTION_DESIGNS','overall':'PASS' if combined['SAME_EVENT']>=8 and combined['RELATED_TOPIC']>=8 and combined['non_uncertain']>=60 else 'FAIL'},'graph_dev_strict_positive_recovery_gate':'PASS' if counts['SAME_EVENT']>=8 else 'FAIL','graph_dev_related_boundary_evidence_gate':'PASS' if counts['RELATED_TOPIC']>=8 else 'FAIL','recommendation':rec,'next_recommended_track':next_track,'sample_limitation':'Constrained challenge sample; proportions are not corpus prevalence; challenge precision and recall are not production precision or population recall.'}

def validate_analysis(rows,labels,side,result):
 if len(rows)!=40 or [r['source_annotation_id'] for r in rows]!=[f'G{i:03}' for i in range(1,41)] or len({r['pair_key'] for r in rows})!=40:raise ValueError('joined identities')
 lab={x['pair_key']:x for x in labels};src={x['pair_key']:x for x in side}
 if len(lab)!=40 or len(src)!=40 or set(lab)!=set(src) or set(lab)!={x['pair_key'] for x in rows}:raise ValueError('input identities')
 counts=Counter(r['human_decision'] for r in rows);lanes=Counter(r['selection_lane'] for r in rows)
 if counts!=Counter({'RELATED_TOPIC':2,'DIFFERENT_EVENT':38}) or lanes!=Counter({'event':20,'near':12,'control':8}):raise ValueError('counts')
 for r in rows:
  l=lab[r['pair_key']];s=src[r['pair_key']]
  if r['human_decision']!=l['human_decision'] or r['source_annotation_id']!=l['source_annotation_id'] or r['source_annotation_id']!=s['annotation_id'] or r['review_annotation_id']!=l['review_annotation_id'] or r['selection_lane']!=s['selection_lane'] or any(r[f]!=s.get(f) for f in FEATURES):raise ValueError('join')
 for lane in LANES:
  subset=[r for r in rows if r['selection_lane']==lane];m=result['matrix'][lane]
  if m['total']!=len(subset) or any(m[k]!=sum(r['human_decision']==k for r in subset) for k in LABELS):raise ValueError('matrix')
  y=result['lane_yields'][lane]
  if y['strict_same_yield']!=divide(m['SAME_EVENT'],len(subset)) or y['related_or_same_yield']!=divide(m['SAME_EVENT']+m['RELATED_TOPIC'],len(subset)):raise ValueError('yield')
 for grouping in ('by_lane','by_human_decision'):
  for group in (LANES if grouping=='by_lane' else LABELS):
   subset=[r for r in rows if r['selection_lane' if grouping=='by_lane' else 'human_decision']==group]; summary=result['feature_summaries'][grouping][group];summary=summary if grouping=='by_lane' else summary['features']
   for f in FEATURES:
    vals=[r[f] for r in subset if r[f] is not None];expected={'n':len(subset),'available_n':len(vals),'min':min(vals) if vals else None,'median':statistics.median(vals) if vals else None,'max':max(vals) if vals else None}
    if summary[f]!=expected:raise ValueError('feature summary')
 proxy=result['proxy']; ev=[r for r in rows if r['selection_lane']=='event' and r['human_decision']!='UNCERTAIN'];rest=[r for r in rows if r['selection_lane']!='event' and r['human_decision']!='UNCERTAIN'];tp=sum(r['human_decision']=='SAME_EVENT' for r in ev);fr=sum(r['human_decision']=='RELATED_TOPIC' for r in ev);fd=sum(r['human_decision']=='DIFFERENT_EVENT' for r in ev);fn=sum(r['human_decision']=='SAME_EVENT' for r in rest);tn=sum(r['human_decision'] in ('RELATED_TOPIC','DIFFERENT_EVENT') for r in rest)
 if any(proxy[k]!=v for k,v in {'tp':tp,'fp_related':fr,'fp_different':fd,'fn':fn,'tn':tn,'precision':divide(tp,tp+fr+fd),'recall':divide(tp,tp+fn),'event_negative_count':fr+fd,'event_negative_share':divide(fr+fd,tp+fr+fd)}.items()):raise ValueError('confusion')
 combined={k:OLD_COUNTS[k]+counts[k] for k in LABELS};combined['total']=sum(combined.values());combined['non_uncertain']=combined['total']-combined['UNCERTAIN']
 if result['combined']!=combined or result['recommendation']!=recommendation(combined['SAME_EVENT'],combined['RELATED_TOPIC'],combined['non_uncertain']):raise ValueError('combined or recommendation')
 if result['graph_dev_strict_positive_recovery_gate']!=('PASS' if counts['SAME_EVENT']>=8 else 'FAIL') or result['graph_dev_related_boundary_evidence_gate']!=('PASS' if counts['RELATED_TOPIC']>=8 else 'FAIL'):raise ValueError('primary evidence gates')
 if counts['SAME_EVENT']==0 and result['next_recommended_track']!='STORY_02_A2D2C_P4_D2E_EVENT_IDENTITY_SIGNAL_REDESIGN':raise ValueError('next track')
 if result['thresholds']!={'min_same_event':8,'min_related_topic':8,'min_non_uncertain':60,'min_positive_buckets':2} or result['sufficiency']!={'same_event':'PASS' if combined['SAME_EVENT']>=8 else 'FAIL','related_topic':'PASS' if combined['RELATED_TOPIC']>=8 else 'FAIL','non_uncertain':'PASS' if combined['non_uncertain']>=60 else 'FAIL','positive_buckets':'NOT_COMPARABLE_ACROSS_SELECTION_DESIGNS','overall':'PASS' if combined['SAME_EVENT']>=8 and combined['RELATED_TOPIC']>=8 and combined['non_uncertain']>=60 else 'FAIL'}:raise ValueError('sufficiency')

def freeze(path,data):
 path=Path(path);tmp=path.with_name('.'+path.name+'.tmp')
 if path.exists():raise FileExistsError(path)
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 h=sha(data)
 if sha(tmp.read_bytes())!=h:raise ValueError('pre-freeze hash')
 os.replace(tmp,path);path.chmod(0o444)
 if path.stat().st_mode&0o777!=0o444 or sha(path.read_bytes())!=h:raise ValueError('post-freeze')
 return h

def load_jsonl(path):return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]

def run(dest):
 dest=Path(dest).resolve();root=ROOT.resolve()
 if not dest.is_relative_to(root) or dest==root or dest.exists():raise ValueError('new private destination')
 with label_guard():
  verify_inputs();labs=load_jsonl(D2C/'graph-dev-human-labels-v1.jsonl');side=load_jsonl(R3/'targeted-dev-graph-sidecar-v1.jsonl');one=join(labs,side);two=join(labs,side);x=analyze(one);y=analyze(two)
  jb=b''.join(canonical(r) for r in one);lane={'matrix':x['matrix'],'lane_yields':x['lane_yields'],'proxy':x['proxy'],'feature_summaries':x['feature_summaries']};lbytes=canonical(lane);ab=canonical(x)
  if jb!=b''.join(canonical(r) for r in two) or canonical(y)!=ab or canonical({'matrix':y['matrix'],'lane_yields':y['lane_yields'],'proxy':y['proxy'],'feature_summaries':y['feature_summaries']})!=lbytes:raise ValueError('analysis replay')
  validate_analysis(one,labs,side,x);dest.mkdir(parents=True,mode=0o700);jh=freeze(dest/'graph-dev-joined-v1.jsonl',jb);lh=freeze(dest/'graph-dev-lane-diagnostics-v1.json',lbytes);ah=freeze(dest/'graph-dev-analysis-v1.json',ab)
  manifest={'version':'STORY_02_GRAPH_DEV_ANALYSIS_V1','base_main_sha':BASE,'graph_dev_human_labels_sha256':HASHES[D2C/'graph-dev-human-labels-v1.jsonl'],'graph_human_label_ingestion_manifest_sha256':HASHES[D2C/'graph-human-label-ingestion-manifest-v1.json'],'r3_contract_sha256':HASHES[R3/'graph-retrieval-contract-v1.json'],'r3_pack_sha256':HASHES[R3/'targeted-dev-graph-pack-v1.csv'],'r3_sidecar_sha256':HASHES[R3/'targeted-dev-graph-sidecar-v1.jsonl'],'r3_selection_manifest_sha256':HASHES[R3/'targeted-dev-graph-selection-manifest-v1.json'],'analysis_state':'DEV_ANALYZED','blind_state':'UNTOUCHED_SEALED','production_policy':'NOT_FROZEN','model_training':'NO','joined_sha256':jh,'lane_diagnostics_sha256':lh,'analysis_sha256':ah}
  mh=freeze(dest/'graph-dev-analysis-manifest-v1.json',canonical(manifest))
  verify_inputs();readrows=load_jsonl(dest/'graph-dev-joined-v1.jsonl');readresult=json.loads((dest/'graph-dev-analysis-v1.json').read_bytes());validate_analysis(readrows,load_jsonl(D2C/'graph-dev-human-labels-v1.jsonl'),load_jsonl(R3/'targeted-dev-graph-sidecar-v1.jsonl'),readresult)
  readlane=json.loads((dest/'graph-dev-lane-diagnostics-v1.json').read_bytes())
  if readlane!={k:readresult[k] for k in ('matrix','lane_yields','proxy','feature_summaries')}:raise ValueError('lane diagnostics mismatch')
  for n,h in [('graph-dev-joined-v1.jsonl',jh),('graph-dev-lane-diagnostics-v1.json',lh),('graph-dev-analysis-v1.json',ah),('graph-dev-analysis-manifest-v1.json',mh)]:
   p=dest/n
   if p.stat().st_mode&0o777!=0o444 or sha(p.read_bytes())!=h:raise ValueError('frozen output')
  return {**x,'joined_sha256':jh,'lane_diagnostics_sha256':lh,'analysis_sha256':ah,'manifest_sha256':mh}
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit('usage: analyze_graph_dev.py PRIVATE_ATTEMPT')
 print(json.dumps(run(sys.argv[1]),sort_keys=True))
