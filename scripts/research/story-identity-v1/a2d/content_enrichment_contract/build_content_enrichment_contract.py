"""Freeze a contract only: no content retrieval or human-label access."""
import builtins,contextlib,hashlib,io,json,os,sys
from pathlib import Path
from unittest.mock import patch

BASE='3d83ff4177058d19e0bb6b4b77c46e1f9f798693';PRIVATE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c';ROOT=PRIVATE/'p4-content-enrichment-contract';D2E=PRIVATE/'p4-event-identity-signal-redesign/attempt-20261028-d2e-v1';CORPUS=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
CORPUS_SHA='3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206';AUDIT_SHA='eebe9ea3a1b7631b1bb5c1ff76ca34a44fafcd69102867f9223eaf088bf032ea';MANIFEST_SHA='7b4b41e356d7cdf42a37aa4412fb23e1c1ccba9ce4b1fc965689ec2b6a55e94c'
FORBIDDEN_LABEL_FILES=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','graph-dev-human-labels-v1.jsonl','story02-d2b-human-completed.csv','graph-dev-joined-v1.jsonl')

def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
@contextlib.contextmanager
def label_guard():
 def wrap(fn):
  def guarded(path,*args,**kwargs):
   if Path(str(path)).name in FORBIDDEN_LABEL_FILES:raise PermissionError('human labels forbidden')
   return fn(path,*args,**kwargs)
  return guarded
 with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)):yield

def verify_inputs():
 for p,h in ((CORPUS,CORPUS_SHA),(D2E/'fresh-corpus-field-audit-v1.json',AUDIT_SHA),(D2E/'event-identity-signal-redesign-manifest-v1.json',MANIFEST_SHA)):
  if sha(p.read_bytes())!=h or p.stat().st_mode&0o777!=0o444:raise ValueError('input integrity')
 with CORPUS.open('rb') as f:count=sum(1 for line in f if line.strip())
 audit=json.loads((D2E/'fresh-corpus-field-audit-v1.json').read_bytes());manifest=json.loads((D2E/'event-identity-signal-redesign-manifest-v1.json').read_bytes())
 if count!=500 or audit['article_count']!=500 or audit['rich_text_available']!='NO' or audit['rich_text_nonempty_count']!=0 or manifest['field_audit_sha256']!=AUDIT_SHA:raise ValueError('D2E result')

def coverage_route(n):
 if not isinstance(n,int) or isinstance(n,bool) or not 0<=n<=500:raise ValueError('usable count')
 return 'PASS' if n>=400 else ('FAIL_PARTIAL' if n>0 else 'FAIL_NO_CONTENT')

def contract():
 return {'version':'STORY_02_FRESH_CONTENT_ENRICHMENT_CONTRACT_V1','base_main_sha':BASE,'fresh_corpus_sha256':CORPUS_SHA,'fresh_article_count':500,'d2e_field_audit_sha256':AUDIT_SHA,'d2e_manifest_sha256':MANIFEST_SHA,'authorized_now':'CONTRACT_DESIGN_ONLY','authorized_later':'NOTHING_UNTIL_PM_APPROVAL','fresh_corpus_mutation':'FORBIDDEN','storage_model':'IMMUTABLE_SIDECAR',
 'sources':{'priority':['MINIFLUX_ENTRY_CONTENT','ORIGINAL_ARTICLE_URL_FETCH'],'miniflux_access_in_d2e1':'NOT_AUTHORIZED','publisher_url_fetch':'HOLD','publisher_hold_release':'LATER_EXPLICIT_PM_GATE_ONLY','forbidden':['SEARCH_ENGINE_SNIPPETS','SEARCH_ENGINE_CACHED_PAGES','THIRD_PARTY_ARTICLE_MIRRORS','LLM_GENERATED_SUMMARIES','LLM_CONTENT_RECONSTRUCTION','BROWSER_GENERATED_SUMMARIES','READABILITY_PROXY_SERVICES','ARCHIVE_SERVICES','SOCIAL_MEDIA_REPOSTS','OTHER_ARTICLES','MANUALLY_SUBSTITUTED_URLS'],'generated_content_allowed':False,'third_party_substitution_allowed':False},
 'identity':{'key':'article_id','preserve':['id','title','published_at','feed_id','category_id','original_url','corpus_membership','corpus_ordering_identity'],'checks':['ENTRY_EXISTS','ENTRY_ID_EXACT','ORIGINAL_URL_CONSISTENT','TITLE_CONSISTENT_WITH_EXPLICIT_MISMATCH_STATUS'],'status_values':['IDENTITY_MATCH','IDENTITY_MISMATCH','ENTRY_NOT_FOUND','SOURCE_UNAVAILABLE'],'usable_identity_status':'IDENTITY_MATCH','mismatch_auto_repair':False,'substitution_allowed':False},
 'temporal':{'preserve':['original_published_at','original_created_at_when_available','enrichment_retrieved_at'],'retrieval_after_publication':'YES_PROVENANCE','miniflux':'MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL','publisher':'LIVE_PAGE_AT_RETRIEVAL','original_publication_snapshot_claim':'PROHIBITED_WITHOUT_EVIDENCE'},
 'normalization':{'steps':['IDENTIFY_SOURCE_FIELD','DECODE_DECLARED_ENCODING','PARSE_HTML_WITHOUT_SCRIPT_EXECUTION','REMOVE_SCRIPT_STYLE_NOSCRIPT_NAVIGATION_FORM_CONTROLS','DECODE_HTML_ENTITIES','UNICODE_NFC','COLLAPSE_WHITESPACE','STRIP_EDGES','TRUNCATE_AFTER_NORMALIZATION'],'max_codepoints':8192,'token_or_language_dependent_truncation':False,'title_in_normalized_content':False,'title_only_fallback_counts_as_enrichment':False,'boilerplate_policy':'PRESERVE_CONTENT_OVER_CLEANLINESS','publisher_specific_rules':'NOT_AUTHORIZED','llm_cleaning':'FORBIDDEN'},
 'content':{'status_values':['USABLE','EMPTY_AFTER_NORMALIZATION','STRUCTURAL_ONLY','UNSUPPORTED_FORMAT','IDENTITY_FAILURE','SOURCE_FAILURE'],'enriched_only_when':'USABLE_AND_IDENTITY_MATCH','raw_retention':'PRIVATE_HASHED_ARTIFACT_ONLY_IF_REQUIRED_FOR_REPRODUCIBILITY','never_commit_raw_or_normalized_content':True,'language_metadata':'PRESERVE_NO_FILTER_NO_TRANSLATION'},
 'coverage':{'denominator':500,'minimum_share':0.8,'minimum_usable_count':400,'routing':{'PASS':'CONTENT_AWARE_SIGNAL_BENCHMARK_PREPARATION','FAIL_PARTIAL':'PM_COVERAGE_DECISION','FAIL_NO_CONTENT':'PM_SOURCE_ESCALATION_DECISION'},'automatic_publisher_escalation':False,'no_drop_or_replace_failed_articles':True},
 'security':{'schemes':['HTTP','HTTPS'],'blocked_destinations':['FILE_SCHEME','LOCALHOST','LOOPBACK','RFC1918_PRIVATE','LINK_LOCAL','CLOUD_METADATA'],'dns_resolution_checked_before_connection':True,'redirect_destinations_rechecked':True,'scope':'ONLY_IF_PUBLISHER_FETCH_LATER_AUTHORIZED'},
 'redirect':{'maximum':5,'record_every_redirect':True,'preserve_original_requested_final_url_separately':True,'http_redirects_only':True,'cross_origin_allowed_if_every_destination_safe':True,'canonical_link_second_fetch':False},
 'http_status':{'2XX':'CANDIDATE_FOR_EXTRACTION','3XX':'FOLLOW_ONLY_UNDER_REDIRECT_POLICY','401_403':'SOURCE_RESTRICTED','404_410':'SOURCE_NOT_FOUND','429':'SOURCE_RATE_LIMITED','5XX':'SOURCE_SERVER_FAILURE','paywall_or_auth_bypass':False},
 'rate_limit':{'bounded_concurrency':True,'per_host_throttle':True,'global_request_ceiling':True,'bounded_retries':True,'respect_retry_after':True,'identifiable_research_user_agent':True,'exact_values':'FUTURE_EXECUTION_CONTRACT'},
 'privacy':{'local_processing_only':True,'external_model_or_summarizer_apis':False,'git_raw_content_files':0,'git_normalized_content_files':0,'tracked_outputs':'CONTRACTS_AGGREGATES_HASHES_ONLY','no_article_examples':True},
 'provenance_fields':['article_id','source_tier','source_kind','source_identifier','source_url_original','source_url_requested','source_url_final','redirect_count','http_status','retrieved_at','content_available','content_extraction_status','raw_content_sha256','normalized_content_sha256','normalized_character_count','identity_status','failure_reason'],
 'future_artifacts':{'root':'~/NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-content-enrichment/','unique_attempt_required':True,'sidecar':'fresh-content-enrichment-v1.jsonl','row_count':500,'unique_article_ids':500,'success_fields':['article_id','source_kind','source_identifier','identity_status','content_status','normalized_content','normalized_content_sha256','normalized_character_count','raw_content_sha256','retrieved_at','source_temporal_semantics'],'failure_fields':['article_id','source_kind','identity_status','content_status','failure_reason','retrieved_at'],'retain_failed_rows':True,'receipt':'fresh-content-enrichment-receipt-v1.json','receipt_fields':['original_corpus_sha256','contract_sha256','total_records','source_counts','identity_match_counts','usable_counts','failure_counts','coverage_share','redirect_statistics_if_applicable','input_output_hashes','network_request_counts','miniflux_read_count','external_request_count'],'manifest':'fresh-content-enrichment-manifest-v1.json','manifest_fields':['original_corpus_sha256','contract_sha256','source_policy_version','normalization_contract_version','enrichment_jsonl_sha256','capture_receipt_sha256','article_count','usable_coverage','source_temporal_semantics','network_mode']},
 'reproducibility':{'pipeline_requires':['SAME_FROZEN_500_IDENTITIES','SAME_SOURCE_HIERARCHY','SAME_NORMALIZATION_VERSION','SAME_SOURCE_PAYLOADS'],'source_byte_reproducibility':'NOT_ASSUMED_FOR_LIVE_PUBLISHER_PAGES','miniflux_source_stability':'REQUIRES_FUTURE_EVIDENCE'},
 'next_recommended_track':'STORY_02_A2D2C_P4_D2E2_MINIFLUX_CONTENT_CAPABILITY_PROBE','next_probe':{'mode':'READ_ONLY_LABEL_BLIND','selection':'DETERMINISTIC_CORPUS_WIDE_OR_IDENTITY_SAMPLE','purpose':'MEASURE_MINIFLUX_STORED_CONTENT_AVAILABILITY','publisher_fetch':False,'benchmark':False,'requires_separate_authorization':True},'human_label_access':'NONE','content_fetch_performed':False,'miniflux_api_reads':0,'article_http_requests':0,'model_inference_calls':0,'production_policy':'NOT_FROZEN'}

def validate_contract(x):
 def require(ok):
  if not ok:raise ValueError('content contract validation')
 require(x['version']=='STORY_02_FRESH_CONTENT_ENRICHMENT_CONTRACT_V1' and x['base_main_sha']=='3d83ff4177058d19e0bb6b4b77c46e1f9f798693' and x['fresh_corpus_sha256']==CORPUS_SHA and x['fresh_article_count']==500 and x['d2e_field_audit_sha256']==AUDIT_SHA and x['d2e_manifest_sha256']==MANIFEST_SHA)
 require(x['authorized_now']=='CONTRACT_DESIGN_ONLY' and x['authorized_later']=='NOTHING_UNTIL_PM_APPROVAL' and x['fresh_corpus_mutation']=='FORBIDDEN' and x['storage_model']=='IMMUTABLE_SIDECAR')
 s=x['sources'];require(s['priority']==['MINIFLUX_ENTRY_CONTENT','ORIGINAL_ARTICLE_URL_FETCH'] and s['publisher_url_fetch']=='HOLD' and s['miniflux_access_in_d2e1']=='NOT_AUTHORIZED' and s['publisher_hold_release']=='LATER_EXPLICIT_PM_GATE_ONLY' and s['generated_content_allowed'] is False and s['third_party_substitution_allowed'] is False)
 require(set(s['forbidden'])=={'SEARCH_ENGINE_SNIPPETS','SEARCH_ENGINE_CACHED_PAGES','THIRD_PARTY_ARTICLE_MIRRORS','LLM_GENERATED_SUMMARIES','LLM_CONTENT_RECONSTRUCTION','BROWSER_GENERATED_SUMMARIES','READABILITY_PROXY_SERVICES','ARCHIVE_SERVICES','SOCIAL_MEDIA_REPOSTS','OTHER_ARTICLES','MANUALLY_SUBSTITUTED_URLS'})
 i=x['identity'];require(i['key']=='article_id' and i['preserve']==['id','title','published_at','feed_id','category_id','original_url','corpus_membership','corpus_ordering_identity'] and i['status_values']==['IDENTITY_MATCH','IDENTITY_MISMATCH','ENTRY_NOT_FOUND','SOURCE_UNAVAILABLE'] and i['usable_identity_status']=='IDENTITY_MATCH' and i['mismatch_auto_repair'] is False and i['substitution_allowed'] is False and set(i['checks'])=={'ENTRY_EXISTS','ENTRY_ID_EXACT','ORIGINAL_URL_CONSISTENT','TITLE_CONSISTENT_WITH_EXPLICIT_MISMATCH_STATUS'})
 t=x['temporal'];require(t['preserve']==['original_published_at','original_created_at_when_available','enrichment_retrieved_at'] and t['miniflux']=='MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL' and t['publisher']=='LIVE_PAGE_AT_RETRIEVAL' and t['original_publication_snapshot_claim']=='PROHIBITED_WITHOUT_EVIDENCE' and t['retrieval_after_publication']=='YES_PROVENANCE')
 n=x['normalization'];require(n['steps']==['IDENTIFY_SOURCE_FIELD','DECODE_DECLARED_ENCODING','PARSE_HTML_WITHOUT_SCRIPT_EXECUTION','REMOVE_SCRIPT_STYLE_NOSCRIPT_NAVIGATION_FORM_CONTROLS','DECODE_HTML_ENTITIES','UNICODE_NFC','COLLAPSE_WHITESPACE','STRIP_EDGES','TRUNCATE_AFTER_NORMALIZATION'] and n['max_codepoints']==8192 and n['title_in_normalized_content'] is False and n['title_only_fallback_counts_as_enrichment'] is False and n['token_or_language_dependent_truncation'] is False and n['llm_cleaning']=='FORBIDDEN' and n['boilerplate_policy']=='PRESERVE_CONTENT_OVER_CLEANLINESS')
 require(x['content']['status_values']==['USABLE','EMPTY_AFTER_NORMALIZATION','STRUCTURAL_ONLY','UNSUPPORTED_FORMAT','IDENTITY_FAILURE','SOURCE_FAILURE'] and x['content']['enriched_only_when']=='USABLE_AND_IDENTITY_MATCH' and x['content']['never_commit_raw_or_normalized_content'] is True)
 v=x['coverage'];require(v['denominator']==500 and v['minimum_share']==0.8 and v['minimum_usable_count']==400 and v['automatic_publisher_escalation'] is False and v['no_drop_or_replace_failed_articles'] is True and v['routing']=={'PASS':'CONTENT_AWARE_SIGNAL_BENCHMARK_PREPARATION','FAIL_PARTIAL':'PM_COVERAGE_DECISION','FAIL_NO_CONTENT':'PM_SOURCE_ESCALATION_DECISION'})
 z=x['security'];require(z['schemes']==['HTTP','HTTPS'] and set(z['blocked_destinations'])=={'FILE_SCHEME','LOCALHOST','LOOPBACK','RFC1918_PRIVATE','LINK_LOCAL','CLOUD_METADATA'} and z['dns_resolution_checked_before_connection'] is True and z['redirect_destinations_rechecked'] is True)
 r=x['redirect'];require(r['maximum']==5 and r['record_every_redirect'] is True and r['preserve_original_requested_final_url_separately'] is True and r['http_redirects_only'] is True and r['cross_origin_allowed_if_every_destination_safe'] is True and r['canonical_link_second_fetch'] is False)
 rate=x['rate_limit'];require(all(rate[k] is True for k in ('bounded_concurrency','per_host_throttle','global_request_ceiling','bounded_retries','respect_retry_after','identifiable_research_user_agent')))
 priv=x['privacy'];require(priv['local_processing_only'] is True and priv['external_model_or_summarizer_apis'] is False and priv['git_raw_content_files']==0 and priv['git_normalized_content_files']==0)
 f=x['future_artifacts'];require(f['row_count']==500 and f['unique_article_ids']==500 and f['retain_failed_rows'] is True and f['sidecar']=='fresh-content-enrichment-v1.jsonl' and f['receipt']=='fresh-content-enrichment-receipt-v1.json' and f['manifest']=='fresh-content-enrichment-manifest-v1.json')
 require(x['next_recommended_track']=='STORY_02_A2D2C_P4_D2E2_MINIFLUX_CONTENT_CAPABILITY_PROBE' and x['next_probe']['mode']=='READ_ONLY_LABEL_BLIND' and x['next_probe']['publisher_fetch'] is False and x['next_probe']['requires_separate_authorization'] is True and x['human_label_access']=='NONE' and x['content_fetch_performed'] is False and x['miniflux_api_reads']==0 and x['article_http_requests']==0 and x['model_inference_calls']==0 and x['production_policy']=='NOT_FROZEN')

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
  verify_inputs();one=contract();two=contract();validate_contract(one)
  if canonical(one)!=canonical(two):raise ValueError('contract replay')
  dest.mkdir(parents=True,mode=0o700);ch=freeze(dest/'fresh-content-enrichment-contract-v1.json',canonical(one))
  manifest={'version':'STORY_02_FRESH_CONTENT_ENRICHMENT_CONTRACT_V1','base_main_sha':BASE,'fresh_corpus_sha256':CORPUS_SHA,'d2e_field_audit_sha256':AUDIT_SHA,'d2e_manifest_sha256':MANIFEST_SHA,'content_enrichment_contract_sha256':ch,'content_fetch_performed':'NO','miniflux_reads':0,'external_article_fetches':0,'human_label_access':'NONE','model_inference':'NONE','production_policy':'NOT_FROZEN'}
  mh=freeze(dest/'fresh-content-enrichment-contract-manifest-v1.json',canonical(manifest));reloaded=json.loads((dest/'fresh-content-enrichment-contract-v1.json').read_bytes());validate_contract(reloaded)
  m=json.loads((dest/'fresh-content-enrichment-contract-manifest-v1.json').read_bytes())
  if m['content_enrichment_contract_sha256']!=ch or any(p.stat().st_mode&0o777!=0o444 for p in dest.iterdir()) or sha((dest/'fresh-content-enrichment-contract-v1.json').read_bytes())!=ch or sha((dest/'fresh-content-enrichment-contract-manifest-v1.json').read_bytes())!=mh:raise ValueError('frozen readback')
  verify_inputs();return {'contract_sha256':ch,'manifest_sha256':mh,'next_recommended_track':one['next_recommended_track']}
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit('usage: build_content_enrichment_contract.py PRIVATE_ATTEMPT')
 print(json.dumps(run(sys.argv[1]),sort_keys=True))
