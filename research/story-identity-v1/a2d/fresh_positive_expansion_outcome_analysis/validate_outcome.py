"""Independent outcome oracle; never imports the analyzer's result function."""
import json,hashlib
from collections import Counter
LABELS=('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')
def independent(baseline,expansion,global_out,private,pool_path):
 if len(baseline)!=40 or len(expansion)!=11:raise ValueError('COUNTS')
 for rows in (baseline,expansion):
  if len({r['pair_key'] for r in rows})!=len(rows) or len({v for r in rows for v in (r['article_id_a'],r['article_id_b'])})!=2*len(rows):raise ValueError('UNIQUENESS')
  if any(r['human_decision'] not in LABELS or r['article_id_a']>=r['article_id_b'] or r['pair_key']!=f"{r['article_id_a']}:{r['article_id_b']}" for r in rows):raise ValueError('ROW')
 if {r['pair_key'] for r in baseline}&{r['pair_key'] for r in expansion} or {v for r in baseline for v in (r['article_id_a'],r['article_id_b'])}&{v for r in expansion for v in (r['article_id_a'],r['article_id_b'])}:raise ValueError('OVERLAP')
 def counts(rows):
  c=Counter(r['human_decision'] for r in rows);return {k:c[k] for k in LABELS}
 bc=counts(baseline);ec=counts(expansion);total={k:bc[k]+ec[k] for k in LABELS};n=total['SAME_EVENT']
 if list(bc.values())!=[7,1,32,0] or global_out['baseline_counts']!=bc or global_out['expansion_counts']!=ec or global_out['combined_counts']!=total or global_out['combined_pair_count']!=51 or global_out['combined_unique_article_count']!=102:raise ValueError('GLOBAL')
 if global_out['fresh_positive_discovery_gate_v2']!=('PASS' if n>=1 else 'FAIL') or global_out['legacy_count_condition']!=('PASS' if n>=12 else 'FAIL') or global_out['fresh_same_event_prevalence']!='UNKNOWN' or global_out['benchmark_authorized'] is not False:raise ValueError('GOVERNANCE')
 if n<12:
  if private!={'component_analysis_required':False,'reason':'LEGACY_COUNT_CONDITION_FAILED'} or global_out['legacy_calibration_heuristic_status']!='FAIL_COUNT_CONDITION' or global_out['historical_component_projection_status']!='NOT_RUN':raise ValueError('CONDITIONAL')
  return
 # Independently reconstruct D2F1 graph by connected-component traversal.
 graph={}
 for r in map(json.loads,pool_path.read_bytes().splitlines()):
  x,y=r['article_id_a'],r['article_id_b'];graph.setdefault(x,set()).add(y);graph.setdefault(y,set()).add(x)
 component={};groups=[]
 for node in sorted(graph):
  if node in component:continue
  stack=[node];visited=set()
  while stack:
   x=stack.pop()
   if x in visited:continue
   visited.add(x);stack.extend(graph[x]-visited)
  root=min(visited);groups.append(root)
  for x in visited:component[x]=root
 names={root:f'C{i+1:04d}' for i,root in enumerate(sorted(groups))}
 for r in baseline:
  x,y=r['article_id_a'],r['article_id_b']
  if x not in component or y not in component or component[x]!=component[y] or r['component_id']!=names[component[x]]:raise ValueError('D2F2_MISMATCH')
 failure=None
 for r in expansion:
  x,y=r['article_id_a'],r['article_id_b']
  if x not in component or y not in component:failure='ARTICLE_NOT_IN_HISTORICAL_POOL';break
  if component[x]!=component[y]:failure='EXPANDED_EDGE_BRIDGES_HISTORICAL_COMPONENTS';break
 if failure:
  if private!={'component_analysis_required':True,'projection_failure_reason':failure} or global_out['legacy_calibration_heuristic_status']!='NOT_EVALUABLE_UNDER_HISTORICAL_COMPONENT_SEMANTICS' or global_out['historical_component_projection_status']!='FAIL':raise ValueError('PROJECTION')
  return
 c=Counter(component[r['article_id_a']] for r in baseline+expansion if r['human_decision']=='SAME_EVENT');largest=max(c.values(),default=0)
 expected='PASS' if len(c)>=3 and 2*largest<=n else 'FAIL'
 if global_out['legacy_calibration_heuristic_status']!=expected or global_out['historical_component_projection_status']!='PASS' or private['positive_component_count']!=len(c) or private['largest_positive_component_count']!=largest or private['largest_positive_component_share']!=largest/n:raise ValueError('CALIBRATION')
