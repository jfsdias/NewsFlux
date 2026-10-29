"""Preregistered diagnostics and enforceable future-validation invariants."""
import hashlib,json

def canonical(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n').encode()
def verify_hash(data,expected):
 if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('HASH_MISMATCH')
def verify_role(role):
 if role!='CANONICAL':raise ValueError('NONCANONICAL')
def guard_name(path):
 if any(x in str(path).lower() for x in ('blind','gold-label','old-dev','graph-dev-human-label','normalized-content','source-payload')):raise PermissionError('FORBIDDEN_SOURCE')
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
 return {'legacy':'HISTORICAL_SUPERSEDED_FOR_FUTURE_READINESS','alpha':0.05,'delta':0.05,'production_threshold':None,'fixed_design_effect':None,'article_sampling':'ALL_ELIGIBLE','temporal_independence':True,'capture_after_merge':True,'independent_reviewers':2,'adjudication':True,'known_inclusion_probabilities':True,'independent_units_from_pairs':False,'benchmark_authorized':False,'blind_open':False}
def validate_design(contract):
 if contract!=good_design():raise ValueError('DESIGN_CONTRACT_VIOLATION')
