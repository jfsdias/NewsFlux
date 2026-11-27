"""Offline frozen-input D2F10 analysis; reports aggregate results only."""
import builtins,contextlib,hashlib,io,json,os,socket,sys
from pathlib import Path
from unittest.mock import patch
import analyze_expansion_outcome as a
from validate_outcome import independent
F9=Path(os.environ['D2F10_F9_DIR'])
F4=Path(os.environ['D2F10_F4_LABELS'])
F2=Path(os.environ['D2F10_F2_PACK'])
F1=Path(os.environ['D2F10_F1_POOL'])
OUT=Path(os.environ['D2F10_OUTPUT_ROOT'])
CONTRACT=Path(__file__).with_name('outcome-analysis-contract-v1.json')
INPUTS={F9/'human-review-freeze-contract-v1.json':'b8e613efadae0ae2ac354bbd1f2d9cca3ca7fd11360a74eaedef7de261a7ce5c',F9/'human-review-completed-export-v1.csv':'88810539eeed4750cdbea51580038eb5d2fcd1483e71c14e145b6e4f366b17ea',F9/'human-review-labels-v1.jsonl':'1f1bd852905193002cc1938a17c9e20e53020d2e60a38f374acf8d2972a6aeb8',F9/'human-review-audit-v1.json':'eab538add8430a4cffa93978c83acee72a3145494276bebba4dbbc7d7208498e',F9/'human-review-receipt-v1.json':'390b1c4caf0d6ebb5fddaf20c46ec991cdc86f27dc8f4c6ce7db8201935bec69',F9/'human-review-manifest-v1.json':'77ac9ef236b75eb7708c225792b847126d9bed204a3b56e1355e62f495a8c686',F4:'68857fac89d4f9ae98f53f0d2ab7f343d09037307036c8c55fc6c01964ae72fb',F2:'a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90',F1:'8316724ca107055bf77079399e6998546eb26c09b8ec1609bec9496c26e5c024'}
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels','blind-human-labels','graph-dev-human-labels','d2e3','fresh-content-enrichment','normalized-content','raw-payload')
def sha(b):return hashlib.sha256(b).hexdigest()
@contextlib.contextmanager
def firewall():
 def wrap(fn):
  def wrapped(path,*args,**kwargs):
   if any(x in str(path).lower() for x in FORBIDDEN):raise PermissionError('forbidden source')
   return fn(path,*args,**kwargs)
  return wrapped
 def deny(*args,**kwargs):raise PermissionError('network prohibited')
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(socket.socket,'connect',deny):yield

def verify():
 for p,h in INPUTS.items():
  if p.stat().st_mode&0o777!=0o444 or sha(p.read_bytes())!=h:raise ValueError('INPUT_INTEGRITY')
def lines(p):return [json.loads(x) for x in p.read_bytes().splitlines()]
def inputs():
 verify();pack=lines(F2);labels=lines(F4);expansion=lines(F9/'human-review-labels-v1.jsonl')
 if len(pack)!=40 or len(labels)!=40 or len(expansion)!=11:raise ValueError('ROW_COUNT')
 by={x['pair_key']:x for x in pack}
 if len(by)!=40 or {x['pair_key'] for x in labels}!=set(by) or len({x['pair_key'] for x in labels})!=40:raise ValueError('BASELINE_BIJECTION')
 baseline=[dict(by[x['pair_key']],human_decision=x['human_decision']) for x in labels]
 a.validate_rows(baseline);a.validate_rows(expansion)
 if len({i for r in baseline for i in (r['article_id_a'],r['article_id_b'])})!=80 or len({i for r in expansion for i in (r['article_id_a'],r['article_id_b'])})!=22:raise ValueError('ARTICLE_COUNT')
 if list(a.counts(baseline).values())!=[7,1,32,0]:raise ValueError('BASELINE_INTEGRITY')
 a.disjoint(baseline,expansion)
 return baseline,expansion

def compute(baseline,expansion):
 bc=a.counts(baseline);ec=a.counts(expansion);combined={k:bc[k]+ec[k] for k in a.LABELS};n=combined['SAME_EVENT']
 g={'baseline_counts':bc,'expansion_counts':ec,'combined_counts':combined,'combined_pair_count':len(baseline)+len(expansion),'combined_unique_article_count':len({i for r in baseline+expansion for i in (r['article_id_a'],r['article_id_b'])}),'discovery_was_already_pass_before_expansion':bc['SAME_EVENT']>=1,**a.governance(n)}
 if g['combined_pair_count']!=51 or g['combined_unique_article_count']!=102:raise ValueError('COMBINED_INTEGRITY')
 if not a.component_required(n):
  private={'component_analysis_required':False,'reason':'LEGACY_COUNT_CONDITION_FAILED'}
  g.update(historical_component_projection_status='NOT_RUN',d2f1_d2f2_component_reconstruction_gate='NOT_RUN',legacy_calibration_heuristic_status='FAIL_COUNT_CONDITION')
 else:
  historical=a.components(lines(F1));a.check_baseline_components(baseline,historical)
  try:expanded_components=a.project(expansion,historical)
  except ValueError as e:
   if str(e) not in ('ARTICLE_NOT_IN_HISTORICAL_POOL','EXPANDED_EDGE_BRIDGES_HISTORICAL_COMPONENTS'):raise
   private={'component_analysis_required':True,'projection_failure_reason':str(e)}
   g.update(historical_component_projection_status='FAIL',d2f1_d2f2_component_reconstruction_gate='PASS',legacy_calibration_heuristic_status='NOT_EVALUABLE_UNDER_HISTORICAL_COMPONENT_SEMANTICS')
  else:
   from collections import Counter
   bcomponents=a.project(baseline,historical)
   c=Counter(component for r,component in zip(baseline+expansion,bcomponents+expanded_components) if r['human_decision']=='SAME_EVENT')
   private={'component_analysis_required':True,'positive_counts_per_historical_component':dict(c),'positive_component_count':len(c),'largest_positive_component_count':max(c.values(),default=0),'largest_positive_component_share':max(c.values(),default=0)/n}
   g.update(historical_component_projection_status='PASS',d2f1_d2f2_component_reconstruction_gate='PASS',legacy_calibration_heuristic_status='PASS' if a.calibration(n,list(c.values())) else 'FAIL')
 return g,private

def freeze(path,data):
 if path.exists():raise FileExistsError(path)
 tmp=path.with_name('.'+path.name+'.tmp')
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 if sha(tmp.read_bytes())!=sha(data):raise ValueError('PRE_FREEZE_HASH')
 os.replace(tmp,path);path.chmod(0o444)
 if sha(path.read_bytes())!=sha(data) or path.stat().st_mode&0o777!=0o444:raise ValueError('POST_FREEZE_HASH')
 return sha(data)
def run(target):
 target=Path(target).resolve()
 if not target.is_relative_to(OUT.resolve()) or target==OUT.resolve() or target.exists():raise ValueError('PRIVATE_TARGET')
 with firewall():
  baseline,expansion=inputs();g,p=compute(baseline,expansion);g2,p2=compute(baseline,expansion)
  if a.canonical(g)!=a.canonical(g2) or a.canonical(p)!=a.canonical(p2):raise ValueError('REPLAY')
  independent(baseline,expansion,g,p,F1)
  OUT.mkdir(parents=True,mode=0o700,exist_ok=True)
  if OUT.stat().st_mode&0o777!=0o700:raise ValueError('PARENT_MODE')
  target.mkdir(mode=0o700)
  ch=freeze(target/'outcome-analysis-contract-v1.json',CONTRACT.read_bytes());gh=freeze(target/'outcome-global-v1.json',a.canonical(g));ph=freeze(target/'outcome-private-stratified-v1.json',a.canonical(p))
  receipt={'version':'STORY02_D2F10_RECEIPT_V1','contract_sha256':ch,'global_sha256':gh,'private_stratified_sha256':ph,'input_sha256':{p.name:h for p,h in INPUTS.items()},'replay':'PASS','independent_validator':'PASS','benchmark_authorized':False}
  rh=freeze(target/'outcome-receipt-v1.json',a.canonical(receipt));manifest={'version':'STORY02_D2F10_MANIFEST_V1','contract_sha256':ch,'global_sha256':gh,'private_stratified_sha256':ph,'receipt_sha256':rh,'file_mode':'0444','directory_mode':'0700'}
  mh=freeze(target/'outcome-manifest-v1.json',a.canonical(manifest));verify();independent(baseline,expansion,json.loads((target/'outcome-global-v1.json').read_bytes()),json.loads((target/'outcome-private-stratified-v1.json').read_bytes()),F1)
  return {'global':g,'component_analysis_required':p['component_analysis_required'],'contract_sha256':ch,'global_sha256':gh,'private_stratified_sha256':ph,'receipt_sha256':rh,'manifest_sha256':mh,'private_root':str(target)}
if __name__=='__main__':print(json.dumps(run(sys.argv[1]),sort_keys=True))
