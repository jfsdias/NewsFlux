"""Offline D2G0 diagnosis; emits no private pair data to stdout."""
import builtins,contextlib,hashlib,io,json,os,socket,statistics,sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch
import networkx as nx
import diagnostic_core as c
from validate_diagnostic import independently_validate
if nx.__version__!='3.4.2':raise RuntimeError('networkx 3.4.2 required')
CONTRACT=Path(__file__).with_name('diagnostic-contract-v1.json')
ROLES=('d2f1_pool','d2f2_pack','d2f4_labels','d2f6_candidates','d2f6_frontier','d2f7_pack','d2f9_labels','d2f10_global','p2_features','graph_context','content_capability')
FILES={k:Path(os.environ['D2G0_'+k.upper()]) for k in ROLES}
OUTPUT=Path(os.environ['D2G0_OUTPUT_ROOT'])
def digest(b):return hashlib.sha256(b).hexdigest()
@contextlib.contextmanager
def firewall(extra=()):
 allowed={str(p.resolve()) for p in FILES.values()}|{str(CONTRACT.resolve())}|{str(Path(p).resolve()) for p in extra}
 def wrap(fn):
  def check(path,*args,**kwargs):
   if not isinstance(path,int):
    p=str(Path(path).resolve()); c.guard_name(p)
    if p not in allowed and not Path(p).is_relative_to(OUTPUT.resolve()):raise PermissionError('SOURCE_NOT_ALLOWLISTED')
   return fn(path,*args,**kwargs)
  return check
 def deny(*args,**kwargs):raise PermissionError('NETWORK_PROHIBITED')
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(socket.socket,'connect',deny),patch.object(socket.socket,'connect_ex',deny),patch.object(socket,'getaddrinfo',deny):yield

def load():
 contract=json.loads(CONTRACT.read_bytes());data={}
 for role,p in FILES.items():
  b=p.read_bytes();c.verify_hash(b,contract['inputs_sha256'][role])
  if p.stat().st_mode&0o777!=0o444:raise ValueError('INPUT_MODE')
  if role in ('d2f6_frontier','d2f10_global'):data[role]=json.loads(b)
  else:data[role]=[json.loads(x) for x in b.splitlines()]
 return contract,data

def summary(values):
 values=sorted(x for x in values if x is not None)
 return {'n':len(values),'min':min(values) if values else None,'median':statistics.median(values) if values else None,'max':max(values) if values else None}
def derive(data):
 base=data['d2f4_labels'];exp=data['d2f9_labels'];f2={r['pair_key']:r for r in data['d2f2_pack']};f7={r['pair_key']:r for r in data['d2f7_pack']};labels=base+exp
 if len(base)!=40 or len(exp)!=11 or len(f2)!=40 or len(f7)!=11 or len({x['pair_key'] for x in labels})!=51:raise ValueError('IDENTITY_COUNT')
 if {x['pair_key'] for x in base}!=set(f2) or {x['pair_key'] for x in exp}!=set(f7):raise ValueError('IDENTITY_MISMATCH')
 for x in exp:
  selected=f7[x['pair_key']]
  if any(x[k]!=selected[k] for k in ('article_id_a','article_id_b','selection_position','b1_rank')):raise ValueError('B1_IDENTITY_MISMATCH')
 counts=Counter(x['human_decision'] for x in labels);c.check_counts(dict(counts)|{'UNCERTAIN':counts['UNCERTAIN']})
 reviewed={int(v) for x in labels for v in x['pair_key'].split(':')}
 if len(reviewed)!=102:raise ValueError('ARTICLE_OVERLAP')
 features={x['pair_key']:x for x in data['p2_features']};graph={x['pair_key']:x for x in data['graph_context']};caps={x['article_id']:x for x in data['content_capability']}
 if len(features)!=len(data['p2_features']) or len(graph)!=len(data['graph_context']) or len(caps)!=500:raise ValueError('FEATURE_IDENTITY')
 candidates={f"{x['a']}:{x['b']}":x for x in data['d2f6_candidates']}
 if len(candidates)!=len(data['d2f6_candidates']):raise ValueError('CANDIDATE_DUPLICATION')
 if not set(f7)<=set(candidates) or any('B1' not in candidates[k]['strategy_membership'] for k in f7):raise ValueError('B1_ROW_SET_MISMATCH')
 for k,selected in f7.items():
  x=candidates[k];f=features[k];g=graph.get(k,{})
  if selected['qwen_score']!=f['qwen_score'] or selected['lexical_overlap']!=f['lexical_overlap'] or selected['temporal_delta_hours']!=f['temporal_delta_hours'] or selected['supporting_feed_count']!=g.get('shared_support_feed_count',0) or x['qwen']!=f['qwen_score'] or x['lexical']!=f['lexical_overlap'] or x['gap']!=f['temporal_delta_hours'] or x['support']!=g.get('shared_support_feed_count',0) or x['entity']!=f['entity_anchor_overlap'] or x['number']!=f['number_overlap'] or x['date']!=f['date_overlap']:raise ValueError('FEATURE_SEMANTIC_MISMATCH')
 ordered_b1=sorted((x for x in candidates.values() if 'B1' in x['strategy_membership']),key=lambda x:(-x['qwen'],-x['support'],-x['lexical'],x['gap'],x['a'],x['b']))
 rank_by_key={f"{x['a']}:{x['b']}":i for i,x in enumerate(ordered_b1,1)}
 if any(v['b1_rank']!=rank_by_key[k] for k,v in f7.items()):raise ValueError('B1_RANK_MISMATCH')
 fields=('qwen_score','lexical_overlap','temporal_delta_hours','entity_anchor_overlap','number_overlap','date_overlap','shared_support_feed_count')
 profile={};private_pairs=[]
 for labelgroup in ('POSITIVE','NONPOSITIVE'):
  subset=[x for x in labels if (x['human_decision']=='SAME_EVENT')==(labelgroup=='POSITIVE')]
  rows=[]
  for lab in subset:
   key=lab['pair_key'];f=features[key];g=graph.get(key,{})
   row={k:(g.get(k,0) if k=='shared_support_feed_count' else f[k]) for k in fields}
   row.update(pair_key=key,human_decision=lab['human_decision'],anchor_present=any(f[k]>0 for k in ('entity_anchor_overlap','number_overlap','date_overlap')),article_a_content_status=caps[f['article_a_id']]['content_status'],article_b_content_status=caps[f['article_b_id']]['content_status'],title_equivalent=bool(caps[f['article_a_id']]['content_equals_title'] or caps[f['article_b_id']]['content_equals_title']),feed_ids=[f['feed_a_id'],f['feed_b_id']],category_ids=[f['category_a'],f['category_b']],baseline_component=f2[key]['component_id'] if key in f2 else None,baseline_lanes=f2[key]['lane_membership'] if key in f2 else None,expansion_strategies=candidates[key]['strategy_membership'] if key in candidates else None)
   rows.append(row)
  profile[labelgroup]={'pair_count':len(rows),'features':{k:summary([v[k] for v in rows]) for k in fields},'anchor_count':sum(v['anchor_present'] for v in rows)}
  private_pairs+=rows
 autopsy=[]
 for lab in exp:
  k=lab['pair_key'];f=features[k];g=graph.get(k,{});candidate=candidates[k];selected=f7[k]
  autopsy.append({'pair_key':k,'selection_position':selected['selection_position'],'b1_rank':selected['b1_rank'],'qwen_score':f['qwen_score'],'lexical_overlap':f['lexical_overlap'],'temporal_delta_hours':f['temporal_delta_hours'],'supporting_feed_count':g.get('shared_support_feed_count',0),'entity_overlap':f['entity_anchor_overlap'],'number_overlap':f['number_overlap'],'date_overlap':f['date_overlap'],'anchor_present':any(f[v]>0 for v in ('entity_anchor_overlap','number_overlap','date_overlap')),'strategy_membership':candidate['strategy_membership'],'positive_profile_comparison':{name:('WITHIN_RANGE' if profile['POSITIVE']['features'][name]['min']<=value<=profile['POSITIVE']['features'][name]['max'] else 'OUTSIDE_RANGE') for name,value in [('qwen_score',f['qwen_score']),('lexical_overlap',f['lexical_overlap']),('temporal_delta_hours',f['temporal_delta_hours']),('shared_support_feed_count',g.get('shared_support_feed_count',0))]},'taxonomy':'UNEXPLAINED'})
 residual={}
 for strategy in ('B0','B1','B2','B3','B4','B5'):
  rows=[x for x in candidates.values() if strategy in x['strategy_membership'] and x['a'] not in reviewed and x['b'] not in reviewed]
  c.verify_excluded(rows,reviewed);graph_nx=nx.Graph();graph_nx.add_edges_from((x['a'],x['b']) for x in rows)
  residual[strategy]={'pair_count':len(rows),'unique_articles':graph_nx.number_of_nodes(),'max_article_disjoint':len(nx.max_weight_matching(graph_nx,maxcardinality=True))}
 lineage={name:{'classification':'COMPARABLE','producer':'P2_FROZEN_FEATURE_UNIVERSE','universe':'P3_24H_UNIVERSE'} for name in ('qwen_score','lexical_overlap','temporal_delta_hours','entity_anchor_overlap','number_overlap','date_overlap','feed_category')}
 lineage.update({'supporting_feed_count':{'classification':'COMPARABLE','producer':'FROZEN_GRAPH_CONTEXT','universe':'P3_24H_UNIVERSE'},'anchor_presence':{'classification':'COMPARABLE_AFTER_FROZEN_TRANSFORMATION','producer':'OR_OF_P2_ENTITY_NUMBER_DATE','universe':'P3_24H_UNIVERSE'},'content_availability_title_equivalence':{'classification':'COMPARABLE','producer':'D2E2_CAPABILITY_METADATA','universe':'FROZEN_500'},'lane_strategy_rank_components':{'classification':'NOT_COMPARABLE','producer':'D2F1_OR_D2F6_SELECTION','universe':'DIFFERENT_FROZEN_UNIVERSES'},'quantiles':{'classification':'NOT_COMPARABLE','producer':'UNIVERSE_SPECIFIC','universe':'DESCRIPTIVE_ONLY'}})
 return lineage,{'group_summaries':profile,'pairs':private_pairs},{'pairs':autopsy,'taxonomy_counts':{'UNEXPLAINED':len(autopsy)},'b1_primary_hypothesis_status':'PARTIALLY_SUPPORTED','reason':'ALL_ELEVEN_HAVE_NO_FROZEN_ANCHOR_AND_SHARED_FEED_SUPPORT;TOPIC_HUB_CAUSALITY_UNPROVEN'},residual

def freeze(path,data):
 if path.exists():raise FileExistsError(path)
 tmp=path.with_name('.'+path.name+'.tmp')
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 if digest(tmp.read_bytes())!=digest(data):raise ValueError('TEMP_HASH')
 os.replace(tmp,path);path.chmod(0o444)
 if digest(path.read_bytes())!=digest(data) or path.stat().st_mode&0o777!=0o444:raise ValueError('FREEZE_HASH')
 return digest(data)
def run(target):
 target=Path(target).resolve()
 if not target.is_relative_to(OUTPUT.resolve()) or target==OUTPUT.resolve() or target.exists():raise ValueError('PRIVATE_TARGET')
 with firewall():
  contract,data=load();result=derive(data);result2=derive(data)
  if c.canonical(result)!=c.canonical(result2):raise ValueError('REPLAY')
  independently_validate(data,result)
  OUTPUT.mkdir(parents=True,mode=0o700,exist_ok=True)
  if OUTPUT.stat().st_mode&0o777!=0o700:raise ValueError('OUTPUT_MODE')
  target.mkdir(mode=0o700)
  names=('feature-lineage-v1.json','positive-profile-v1.json','b1-autopsy-v1.json','residual-capacity-v1.json')
  hashes={'private-diagnostic-contract-v1.json':freeze(target/'private-diagnostic-contract-v1.json',CONTRACT.read_bytes())}
  for name,value in zip(names,result):hashes[name]=freeze(target/name,c.canonical(value))
  receipt={'version':'D2G0_DIAGNOSTIC_RECEIPT_V1','preregistration_sha':'31f9ad7d7438e92fdaa59f32a5961cc357b40f6c','input_sha256':contract['inputs_sha256'],'outputs':hashes,'replay':'PASS','independent_validator':'PASS','human_labels':'HYPOTHESIS_GENERATION_ONLY','benchmark_authorized':False}
  hashes['private-diagnostic-receipt-v1.json']=freeze(target/'private-diagnostic-receipt-v1.json',c.canonical(receipt))
  manifest={'version':'D2G0_DIAGNOSTIC_MANIFEST_V1','sha256':hashes,'directory_mode':'0700','file_mode':'0444'}
  mh=freeze(target/'private-diagnostic-manifest-v1.json',c.canonical(manifest))
  independently_validate(data,result)
  for name,h in hashes.items():
   if digest((target/name).read_bytes())!=h:raise ValueError('READBACK')
  return {'residual':result[3],'profile_summaries':result[1]['group_summaries'],'autopsy_aggregate':{'count':len(result[2]['pairs']),'anchor_count':sum(x['anchor_present'] for x in result[2]['pairs']),'taxonomy_counts':result[2]['taxonomy_counts'],'hypothesis':result[2]['b1_primary_hypothesis_status']},'hashes':hashes,'manifest_sha256':mh}
if __name__=='__main__':print(json.dumps(run(sys.argv[1]),sort_keys=True))
