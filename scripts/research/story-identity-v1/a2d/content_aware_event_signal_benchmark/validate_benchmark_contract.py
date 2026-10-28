"""Validate preregistration only. This module cannot execute the benchmark."""
import json
from pathlib import Path

PINS = {
    'base_main_sha': '4e29bf76d551d463ad553c051da6b87a7a1f1634',
    'corpus_sha256': '3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206',
    'd2e1_contract_sha256': '6186c896b5f16398391f63387aae1018e5431d88ccd9a43b450c94fe0e2ae260',
    'd2e1_manifest_sha256': '422b3140c8292c95feff864f262ee17ea0f74c27a575f3004a873dcb40dbf343',
    'd2e2_capability_sha256': '510a9409470d45d700295e953149ed195a937cecdd646f81cfe241b87b745c91',
    'd2e2_summary_sha256': 'e7a1d00b589932e863b4382a7694e67ed6fde8395e78a807ce534ae14a6c1254',
    'd2e3_sidecar_sha256': '53f86ce8ac20b9343f4b8ad6617463dbe5a914a0f4ef45d3330ceddd929caf69',
    'd2e3_receipt_sha256': 'b4316ee8c80d1e3c80ff566adabbab468808de2036ad66839df6ae8999c01247',
    'd2e3_manifest_sha256': '6a1decd66b4cdd139f71337b68ee39b95808c94b27acbc354e579aafb3597bf0',
    'source_payload_index_sha256': '993636a23d3ed52be606917bda03ca9a090f1406e31b654b17b093c07ffe52f5',
    'source_payload_set_digest': '9c93ecfe8bc40855e04dabddb15b029064e8ff91793529b9914b61de58973385',
}
CANDIDATES = {'A_CONTENT_AWARE_SEMANTIC_CONFIRMATION', 'B_EVENT_ANCHOR_FINGERPRINT', 'C_CONTENT_EVENT_ANCHOR_HYBRID', 'D_PAIRWISE_RERANKER_REFERENCE_HOLD'}
METRICS = {'SAME_EVENT_PRECISION','SAME_EVENT_RECALL','F1','FALSE_MERGE_COUNT','FALSE_SPLIT_COUNT','RELATED_TOPIC_FALSE_MERGE_RATE','CONFUSION_MATRIX','PREDICTED_MERGE_RATE','SCOREABLE_PAIR_COVERAGE','CONTENT_AVAILABILITY_COVERAGE'}
TAXONOMY = {'FALSE_MERGE_RELATED_TOPIC','FALSE_MERGE_SHARED_ENTITY','FALSE_MERGE_CONTINUING_STORY','FALSE_MERGE_NEAR_TIME_DIFFERENT_EVENT','FALSE_SPLIT_PARAPHRASE','FALSE_SPLIT_LOW_CONTENT','FALSE_SPLIT_CROSS_SOURCE','CONTENT_UNAVAILABLE','CONTENT_TITLE_EQUIVALENT'}


def require(value):
    if not value:
        raise ValueError('D2F contract invariant failed')


def validate(c):
    try:
        require(isinstance(c,dict) and all(c[k] == v for k,v in PINS.items()))
        require(c['version']=='STORY_02_D2F_BENCHMARK_DESIGN_V1' and c['track']=='STORY_02_A2D2C_P4_D2F_CONTENT_AWARE_EVENT_SIGNAL_BENCHMARK')
        require(c['benchmark_scope']=='DESIGN_ONLY')
        for key in ('model_inference_performed','label_access_performed','benchmark_run_performed','blind_access_performed','publisher_fetch_performed'):
            require(c[key] is False)
        candidates=c['candidate_families']; require(isinstance(candidates,dict) and set(candidates)==CANDIDATES)
        for key,value in candidates.items():
            require(isinstance(value,dict) and value['status']==('HOLD' if key.startswith('D_') else 'DESIGN_ONLY'))
            require(all(isinstance(value[k],str) and value[k] for k in ('hypothesis','inputs','representation','scoring','threshold','missing','cost_latency','reproducibility','privacy','production_feasibility')))
            require(bool(value['failure_modes']))
        p=c['pair_universe_policy']; require(p['denominator_articles']==500 and p['pair_count']==33135 and p['cross_feed_only'] is True and p['published_time_delta_max_hours']==24 and p['no_generation_during_design'] is True)
        require(p['artifact_sha256']=='056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec' and p['pair_key']=='min(article_id):max(article_id)')
        content=c['content_input_policy']; require(content['source']=='D2E3_FROZEN_PRIVATE_CONTENT_ONLY' and content['live_refetch'] is False and content['publisher'] is False and content['missing_excludes_no_article'] is True)
        missing=c['missing_content_policy']; require(missing['silent_drop'] is False and missing['article_denominator']==500 and missing['observed_usable']==486 and missing['observed_nonusable']==14)
        require(set(missing['coverage'])=={'FULL_CORPUS_COVERAGE','CONTENT_ELIGIBLE_PAIR_COVERAGE','SCOREABLE_PAIR_COVERAGE'})
        require(c['title_equivalent_policy']['observed_count']==14 and c['title_equivalent_policy']['silent_drop'] is False)
        labels=c['label_access_policy']; require(labels['current']=='NONE' and labels['pm_approval_required'] is True and labels['graph_dev']=='FROZEN_NEGATIVE_CHALLENGE_ONLY_AFTER_SELECTION')
        blind=c['blind_policy']; require(blind['state']=='SEALED' and blind['maximum_evaluation_runs']==1 and blind['tuning_from_blind'] is False)
        require({'PM_AUTHORIZATION','CANDIDATE_FROZEN','MODEL_AND_TOKENIZER_FROZEN','THRESHOLDS_FROZEN','CODE_SHA_FROZEN','PAIR_UNIVERSE_HASH_FROZEN','DEV_RESULTS_FROZEN'} <= set(blind['opening_requires']))
        selection=c['candidate_selection_policy']; require(selection['selection_scope']=='INNER_TRAINING_COMPONENT_FOLDS_ONLY' and selection['outer_test_leakage'] is False and selection['gold_full_fit'] is False)
        threshold=c['threshold_selection_policy']; require(threshold['selected_now'] is False and threshold['numeric_thresholds_require_pm_approval'] is True)
        decision=c['primary_decision_rule']; require(decision['same_event_merge_positive'] is True and decision['related_topic_merge_negative'] is True and decision['false_merge_cost_exceeds_false_split'] is True and decision['numeric_acceptance_thresholds']=='PM_DECISION_REQUIRED')
        require(METRICS <= set(c['metrics']) and TAXONOMY <= set(c['error_taxonomy']))
        require(c['source_semantics']=='MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL' and c['publisher_policy']=='HOLD' and c['production_policy']=='NOT_FROZEN')
        require(c['privacy']['external_article_data'] is False and c['model_policy']['local_processing'] is True and c['model_policy']['model_download_authorized'] is False and c['model_policy']['model_selection_final'] is False)
        gates=c['next_authorization_gate']; require(all(gates[k] is True for k in ('pm_authorization_required','label_access_requires_separate_approval','model_execution_requires_separate_approval','numeric_acceptance_thresholds_require_pm_approval','fresh_positive_evidence_required')))
        require(c['baseline_references']['same_pair_comparison'] is True)
    except (KeyError,TypeError,AttributeError):
        raise ValueError('D2F contract schema invalid') from None


if __name__=='__main__':
    contract=json.loads(Path(__file__).with_name('benchmark-contract-v1.json').read_text())
    validate(contract)
    print('D2F_CONTRACT_VALIDATOR=PASS')
