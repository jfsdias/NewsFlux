"""Preregistered global outcome and conditional historical component semantics."""
import json
from collections import Counter
LABELS=('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')
def canonical(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
def validate_rows(rows):
 keys=set()
 for r in rows:
  a,b=r['article_id_a'],r['article_id_b']; key=r['pair_key']
  if not isinstance(a,int) or not isinstance(b,int) or a>=b or key!=f'{a}:{b}' or key in keys or r['human_decision'] not in LABELS:raise ValueError('INVALID_ROW')
  keys.add(key)
def counts(rows):
 validate_rows(rows); c=Counter(x['human_decision'] for x in rows)
 return {label:c[label] for label in LABELS}
def discovery(n):return 'PASS' if n>=1 else 'FAIL'
def count_gate(n):return 'PASS' if n>=12 else 'FAIL'
def component_required(n):return n>=12
def disjoint(a,b):
 if {r['pair_key'] for r in a}&{r['pair_key'] for r in b} or {i for r in a for i in (r['article_id_a'],r['article_id_b'])}&{i for r in b for i in (r['article_id_a'],r['article_id_b'])}:raise ValueError('OVERLAP')
def components(rows):
 parent={}
 def find(x):
  parent.setdefault(x,x)
  while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
  return x
 for r in rows:
  a,b=find(r['article_id_a']),find(r['article_id_b'])
  if a!=b:parent[max(a,b)]=min(a,b)
 return {x:find(x) for x in parent}
def check_baseline_components(rows,byarticle):
 roots=sorted(set(byarticle.values()));name={root:f'C{i+1:04d}' for i,root in enumerate(roots)}
 for r in rows:
  a,b=r['article_id_a'],r['article_id_b']
  if a not in byarticle or b not in byarticle or byarticle[a]!=byarticle[b] or r['component_id']!=name[byarticle[a]]:raise ValueError('D2F2_COMPONENT_MISMATCH')
def project(rows,byarticle):
 out=[]
 for r in rows:
  a,b=r['article_id_a'],r['article_id_b']
  if a not in byarticle or b not in byarticle:raise ValueError('ARTICLE_NOT_IN_HISTORICAL_POOL')
  if byarticle[a]!=byarticle[b]:raise ValueError('EXPANDED_EDGE_BRIDGES_HISTORICAL_COMPONENTS')
  out.append(byarticle[a])
 return out
def calibration(n,component_counts):return n>=12 and len(component_counts)>=3 and max(component_counts,default=0)*2<=n
def governance(n):return {'fresh_positive_discovery_gate_v2':discovery(n),'legacy_count_condition':count_gate(n),'fresh_same_event_prevalence':'UNKNOWN','benchmark_authorized':False}
