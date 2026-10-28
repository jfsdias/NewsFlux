"""Aggregate-only, label-free frozen corpus schema inventory."""
import builtins,contextlib,hashlib,io,json,math,os,statistics,sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch

BASE='fee85ca7869f178589f6a533f1a2ea6da8839d76';PRIVATE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c';ROOT=PRIVATE/'p4-event-identity-signal-redesign';D2D=PRIVATE/'p4-graph-dev-analysis/attempt-20261028-d2d-v1';CORPUS=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl';HERE=Path(__file__).resolve().parent; V1=HERE.parent/'CANDIDATE_SPEC_V1.md';SPEC=HERE/'SIGNAL_CANDIDATE_SPEC_V2.md'
D2D_HASHES={'graph-dev-joined-v1.jsonl':'f01cf15e65308d2fc7415182f4bc841b70bd489ec8f319925952d37911c07e25','graph-dev-lane-diagnostics-v1.json':'5a27a2ba05c85810a5c32ed7d174db2449e1e8994a4cd493d7fc2bcbab3e21d0','graph-dev-analysis-v1.json':'3f653c07cb8b652600947b58ef82f0a2bd129899372bc1d2895c953daf1358a7','graph-dev-analysis-manifest-v1.json':'bf259d92c97d3d6637508d7e18b3237c3f4854e64dff7ab3510b2a679467a1cb'}
CORPUS_SHA='3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206';V1_BLOB='6af88bfd4d54e67e8f844832ceeb3368051482d5'
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','review-session-v1-human-completed.csv','story02-d2b-human-completed.csv','graph-dev-human-labels-v1.jsonl','graph-dev-joined-v1.jsonl')
RICH_FIELDS=('content','summary','description','body','excerpt','text','content_text','content_html')

def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def label_guard():
 def wrap(fn):
  def guarded(path,*args,**kwargs):
   if Path(str(path)).name in FORBIDDEN:raise PermissionError('human-label or joined data access forbidden')
   return fn(path,*args,**kwargs)
  return guarded
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)):yield

def hash_only(path):
 # Explicitly hash-only, no decode/parse of the prohibited joined artifact.
 fd=os.open(path,os.O_RDONLY); h=hashlib.sha256()
 try:
  while True:
   part=os.read(fd,1024*1024)
   if not part:break
   h.update(part)
 finally:os.close(fd)
 return h.hexdigest()

def gitblob(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def verify_inputs():
 if sha(CORPUS.read_bytes())!=CORPUS_SHA or CORPUS.stat().st_mode&0o777!=0o444:raise ValueError('fresh corpus integrity')
 for name,h in D2D_HASHES.items():
  path=D2D/name
  if (hash_only(path) if name=='graph-dev-joined-v1.jsonl' else sha(path.read_bytes()))!=h or path.stat().st_mode&0o777!=0o444:raise ValueError('D2D input integrity')
 if gitblob(V1.read_bytes())!=V1_BLOB:raise ValueError('candidate V1 drift')
 x=json.loads((D2D/'graph-dev-analysis-v1.json').read_bytes());m=json.loads((D2D/'graph-dev-analysis-manifest-v1.json').read_bytes())
 if x['graph_dev_strict_positive_recovery_gate']!='FAIL' or x['graph_dev_related_boundary_evidence_gate']!='FAIL' or x['new_counts']!={'SAME_EVENT':0,'RELATED_TOPIC':2,'DIFFERENT_EVENT':38,'UNCERTAIN':0} or x['combined']['SAME_EVENT']!=0 or x['combined']['RELATED_TOPIC']!=3 or x['combined']['DIFFERENT_EVENT']!=117 or x['recommendation']!='GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV' or m['blind_state']!='UNTOUCHED_SEALED':raise ValueError('D2D baseline drift')

def nonempty(value):
 if value is None:return False
 if isinstance(value,str):return bool(value.strip())
 if isinstance(value,(list,dict)):return bool(value)
 return True

def rich_route(n,total):
 if total<=0 or n<0 or n>total:raise ValueError('invalid coverage')
 return 'YES' if n/total>=.8 else ('PARTIAL' if n>0 else 'NO')

def p90(lengths):return sorted(lengths)[max(0,math.ceil(.9*len(lengths))-1)] if lengths else None

def field_audit(rows,expected_count=500):
 if len(rows)!=expected_count or not all(isinstance(r,dict) for r in rows):raise ValueError('corpus count/schema')
 names=sorted({k for row in rows for k in row});fields={}
 for name in names:
  vals=[r[name] for r in rows if name in r];non=[v for v in vals if nonempty(v)];types=Counter(type(v).__name__ for v in vals);lens=[len(v) for v in non if isinstance(v,str)]
  fields[name]={'present_record_count':len(vals),'nonempty_record_count':len(non),'nonempty_share':len(non)/len(rows),'types':dict(sorted(types.items())),'type_consistent':len(types)<=1,'character_length_min':min(lens) if lens else None,'character_length_median':statistics.median(lens) if lens else None,'character_length_p90':p90(lens),'character_length_max':max(lens) if lens else None}
 rich={n:fields[n]['nonempty_record_count'] for n in RICH_FIELDS if n in fields};best=max(rich.values(),default=0)
 return {'version':'STORY_02_FRESH_CORPUS_FIELD_AUDIT_V1','fresh_corpus_sha256':CORPUS_SHA,'article_count':len(rows),'schema_field_count':len(fields),'fields':fields,'rich_text_fields':rich,'rich_text_nonempty_count':best,'rich_text_nonempty_share':best/len(rows),'rich_text_available':rich_route(best,len(rows)),'coverage_semantics':'MAX_NONEMPTY_SHARE_OF_ONE_RECOGNIZED_NON_TITLE_TEXT_FIELD','raw_values_included':False}

def validate_field_audit(rows,audit):
 expected_keys={'version','fresh_corpus_sha256','article_count','schema_field_count','fields','rich_text_fields','rich_text_nonempty_count','rich_text_nonempty_share','rich_text_available','coverage_semantics','raw_values_included'}
 if set(audit)!=expected_keys or audit['version']!='STORY_02_FRESH_CORPUS_FIELD_AUDIT_V1' or audit['fresh_corpus_sha256']!=CORPUS_SHA or audit['coverage_semantics']!='MAX_NONEMPTY_SHARE_OF_ONE_RECOGNIZED_NON_TITLE_TEXT_FIELD':raise ValueError('audit schema')
 if len(rows)!=audit['article_count'] or audit['schema_field_count']!=len(audit['fields']):raise ValueError('count')
 if set(audit['fields'])!={k for row in rows for k in row}:raise ValueError('schema')
 for key,stat in audit['fields'].items():
  present=0;non=0;types={};lengths=[]
  for row in rows:
   if key not in row:continue
   present+=1;v=row[key];name=type(v).__name__;types[name]=types.get(name,0)+1
   is_non=v is not None and (bool(v.strip()) if isinstance(v,str) else bool(v) if isinstance(v,(list,dict)) else True)
   if is_non:
    non+=1
    if isinstance(v,str):lengths.append(len(v))
  lengths.sort();med=statistics.median(lengths) if lengths else None;pn=lengths[max(0,math.ceil(len(lengths)*.9)-1)] if lengths else None
  expected={'present_record_count':present,'nonempty_record_count':non,'nonempty_share':non/len(rows),'types':dict(sorted(types.items())),'type_consistent':len(types)<=1,'character_length_min':lengths[0] if lengths else None,'character_length_median':med,'character_length_p90':pn,'character_length_max':lengths[-1] if lengths else None}
  if stat!=expected:raise ValueError('field statistics')
 rich={k:audit['fields'][k]['nonempty_record_count'] for k in RICH_FIELDS if k in audit['fields']};best=max(rich.values(),default=0);expected='YES' if best/len(rows)>=.8 else ('PARTIAL' if best else 'NO')
 if audit['rich_text_fields']!=rich or audit['rich_text_nonempty_count']!=best or audit['rich_text_nonempty_share']!=best/len(rows) or audit['rich_text_available']!=expected or audit['raw_values_included'] is not False:raise ValueError('rich text routing')

def route(value):return {'YES':'STORY_02_A2D2C_P4_D2F_CONTENT_AWARE_EVENT_SIGNAL_BENCHMARK','PARTIAL':'STORY_02_A2D2C_P4_D2E1_CONTENT_COVERAGE_DECISION','NO':'STORY_02_A2D2C_P4_D2E1_FRESH_CORPUS_CONTENT_ENRICHMENT_CONTRACT'}[value]

def validate_spec():
 text=SPEC.read_text();required=('A_CONTENT_AWARE_SEMANTIC_CONFIRMATION','B_EVENT_ANCHOR_FINGERPRINT','C_CONTENT_EVENT_ANCHOR_HYBRID','D_PAIRWISE_RERANKER_REFERENCE_HOLD','State: HOLD','GRAPH_CONTEXT_ROLE=CORROBORATION_NOT_PRIMARY_IDENTITY_SIGNAL','FROZEN_REFERENCE','FRESH_SAME_EVENT_PREVALENCE=UNKNOWN','NEGATIVE_CHALLENGE_CHECK','FRESH_POSITIVE_IDENTIFIABILITY_RISK')
 if any(item not in text for item in required):raise ValueError('preregistered spec missing')

def freeze(path,data):
 path=Path(path);tmp=path.with_name('.'+path.name+'.tmp')
 if path.exists():raise FileExistsError(path)
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 h=sha(data)
 if sha(tmp.read_bytes())!=h:raise ValueError('pre-freeze')
 os.replace(tmp,path);path.chmod(0o444)
 if path.stat().st_mode&0o777!=0o444 or sha(path.read_bytes())!=h:raise ValueError('post-freeze')
 return h

def run(dest):
 dest=Path(dest).resolve();root=ROOT.resolve()
 if not dest.is_relative_to(root) or dest==root or dest.exists():raise ValueError('new private attempt')
 with label_guard():
  verify_inputs();validate_spec();rows=[json.loads(x) for x in CORPUS.read_text().splitlines() if x.strip()];one=field_audit(rows);two=field_audit(rows)
  if canonical(one)!=canonical(two):raise ValueError('audit replay')
  validate_field_audit(rows,one);dest.mkdir(parents=True,mode=0o700);ah=freeze(dest/'fresh-corpus-field-audit-v1.json',canonical(one))
  manifest={'version':'STORY_02_EVENT_IDENTITY_SIGNAL_REDESIGN_V1','base_main_sha':BASE,'fresh_corpus_sha256':CORPUS_SHA,'d2d_analysis_sha256':D2D_HASHES['graph-dev-analysis-v1.json'],'d2d_manifest_sha256':D2D_HASHES['graph-dev-analysis-manifest-v1.json'],'candidate_spec_v1_git_blob':V1_BLOB,'candidate_spec_v2_sha256':sha(SPEC.read_bytes()),'human_label_access':'NONE','model_inference':'NONE','model_download':'NONE','production_policy':'NOT_FROZEN','field_audit_sha256':ah,'next_recommended_track':route(one['rich_text_available'])}
  mh=freeze(dest/'event-identity-signal-redesign-manifest-v1.json',canonical(manifest));read=json.loads((dest/'fresh-corpus-field-audit-v1.json').read_bytes());validate_field_audit(rows,read)
  if sha((dest/'fresh-corpus-field-audit-v1.json').read_bytes())!=ah or sha((dest/'event-identity-signal-redesign-manifest-v1.json').read_bytes())!=mh or any(p.stat().st_mode&0o777!=0o444 for p in dest.iterdir()):raise ValueError('readback')
  verify_inputs();return {'audit':one,'audit_sha256':ah,'manifest_sha256':mh,'next_recommended_track':manifest['next_recommended_track']}
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit('usage: audit_signal_inputs.py PRIVATE_ATTEMPT')
 print(json.dumps(run(sys.argv[1]),sort_keys=True))
