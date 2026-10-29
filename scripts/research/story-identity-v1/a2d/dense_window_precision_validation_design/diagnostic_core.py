"""Preregistered diagnostics and enforceable future-validation invariants."""
import hashlib,json

def canonical(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n').encode()
def verify_hash(data,expected):
 if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('HASH_MISMATCH')
def verify_role(role):
 if role!='CANONICAL':raise ValueError('NONCANONICAL')
def guard_name(path):
 if any(x in str(path).lower() for x in ('blind','gold-label','gold-v2','old-dev','dev-human-labels','graph-dev-human-label','normalized-content','source-payload')):raise PermissionError('FORBIDDEN_SOURCE')
def forbid_network():raise PermissionError('NETWORK_FORBIDDEN')
def forbid_review_pack():raise PermissionError('REVIEW_PACK_FORBIDDEN')
def check_counts(counts):
 if counts!={'SAME_EVENT':7,'RELATED_TOPIC':1,'DIFFERENT_EVENT':43,'UNCERTAIN':0}:raise ValueError('COUNTS')
def check_feature_semantics(status):
 if status not in ('COMPARABLE','COMPARABLE_AFTER_FROZEN_TRANSFORMATION','NOT_COMPARABLE'):raise ValueError('SEMANTICS')
def check_b1(a,b):
 if a!=b or len(a)!=11:raise ValueError('B1_MISMATCH')
def verify_excluded(rows,excluded):
 if any(r['a'] in excluded or r['b'] in excluded for r in rows):raise ValueError('EXCLUSION_FAILURE')
def good_design():
 return {'legacy':'HISTORICAL_SUPERSEDED_FOR_FUTURE_READINESS','alpha':0.05,'delta':0.05,'production_threshold':None,'fixed_design_effect':None,'article_sampling':'ALL_ELIGIBLE','temporal_independence':True,'capture_after_merge':True,'independent_reviewers':2,'adjudication':True,'known_inclusion_probabilities':True,'independent_units_from_pairs':False,'benchmark_authorized':False,'blind_open':False,'direction':'ONE_SIDED_UPPER_BOUND','primary_unit':'FROZEN_CANDIDATE_GRAPH_COMPONENT','primary_sampling':'SRSWOR_COMPONENTS_REVIEW_ALL_PREDICTED_EDGES_IN_EACH','primary_interval':'HYPERGEOMETRIC_COMPONENT_BOUND_TO_WORST_CASE_EDGE_BOUND','single_final_look':True,'capture_span_hours':48,'pair_window_hours':24,'uncertain':'UNCONFIRMED_COUNTS_AGAINST_SAFE','qwen':'RETRIEVAL_ONLY','graph_support':'RETRIEVAL_PRIORITIZATION_ONLY'}
def validate_design(contract):
 if any(contract.get(k)!=v for k,v in good_design().items()):raise ValueError('DESIGN_CONTRACT_VIOLATION')
def residual_capacities(candidates,reviewed):
 import networkx as nx
 if nx.__version__!='3.4.2':raise RuntimeError('networkx 3.4.2 required')
 out={}
 for strategy in ('B0','B1','B2','B3','B4','B5'):
  rows=[x for x in candidates if strategy in x['strategy_membership'] and x['a'] not in reviewed and x['b'] not in reviewed]
  verify_excluded(rows,reviewed)
  graph=nx.Graph();graph.add_edges_from((x['a'],x['b']) for x in rows)
  out[strategy]={'pair_count':len(rows),'unique_articles':graph.number_of_nodes(),'max_article_disjoint':len(nx.max_weight_matching(graph,maxcardinality=True))}
 return out
