import copy
import json
import unittest
from pathlib import Path

import validate_benchmark_contract as validator


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=json.loads(Path(__file__).with_name('benchmark-contract-v1.json').read_text())

    def test_contract_is_valid(self):
        validator.validate(self.contract)

    def test_no_early_execution(self):
        for key in ('model_inference_performed','label_access_performed','benchmark_run_performed','blind_access_performed','publisher_fetch_performed'):
            value=copy.deepcopy(self.contract); value[key]=True
            with self.subTest(key=key), self.assertRaises(ValueError): validator.validate(value)

    def test_blind_and_reranker_cannot_be_released(self):
        for path in (('blind_policy','state'),('candidate_families','D_PAIRWISE_RERANKER_REFERENCE_HOLD','status')):
            value=copy.deepcopy(self.contract);value[path[0]][path[1]]='OPEN'
            with self.assertRaises(ValueError): validator.validate(value)

    def test_critical_hash_drift_is_rejected(self):
        for key in ('corpus_sha256','d2e1_contract_sha256','d2e3_sidecar_sha256','d2e3_receipt_sha256','d2e3_manifest_sha256'):
            value=copy.deepcopy(self.contract);value[key]='0'*64
            with self.subTest(key=key),self.assertRaises(ValueError):validator.validate(value)

    def test_coverage_and_safety_cannot_be_relaxed(self):
        value=copy.deepcopy(self.contract);value['missing_content_policy']['silent_drop']=True
        with self.assertRaises(ValueError):validator.validate(value)
        value=copy.deepcopy(self.contract);value['primary_decision_rule']['false_merge_cost_exceeds_false_split']=False
        with self.assertRaises(ValueError):validator.validate(value)
        value=copy.deepcopy(self.contract);value['pair_universe_policy']['denominator_articles']=486
        with self.assertRaises(ValueError):validator.validate(value)

    def test_execution_requires_authorization(self):
        value=copy.deepcopy(self.contract);value['next_authorization_gate']['pm_authorization_required']=False
        with self.assertRaises(ValueError):validator.validate(value)

    def test_source_and_graph_challenge_firewalls(self):
        for section,key,bad in [('content_input_policy','live_refetch',True),('privacy','external_article_data',True),('label_access_policy','current','ALLOWED'),('label_access_policy','graph_dev','TUNING')]:
            value=copy.deepcopy(self.contract);value[section][key]=bad
            with self.subTest(section=section,key=key),self.assertRaises(ValueError):validator.validate(value)

    def test_no_blind_or_outer_test_tuning(self):
        for section,key,bad in [('blind_policy','tuning_from_blind',True),('candidate_selection_policy','outer_test_leakage',True),('candidate_selection_policy','gold_full_fit',True)]:
            value=copy.deepcopy(self.contract);value[section][key]=bad
            with self.assertRaises(ValueError):validator.validate(value)

    def test_manifest_pins_exact_contract_bytes(self):
        import hashlib
        p=Path(__file__).with_name('benchmark-contract-v1.json')
        manifest=json.loads(Path(__file__).with_name('benchmark-contract-manifest-v1.json').read_text())
        self.assertEqual(manifest['contract_sha256'],hashlib.sha256(p.read_bytes()).hexdigest())
        self.assertEqual(manifest['scope'],'DESIGN_ONLY')
        self.assertFalse(manifest['benchmark_run_performed'])

    def test_safety_metrics_and_taxonomy_required(self):
        for key in ('metrics','error_taxonomy'):
            value=copy.deepcopy(self.contract);value[key]=[]
            with self.subTest(key=key),self.assertRaises(ValueError):validator.validate(value)

    def test_baseline_references_are_pinned(self):
        value=copy.deepcopy(self.contract);value['baseline_references']['spec_git_blob']='0'*40
        with self.assertRaises(ValueError):validator.validate(value)

    def test_pair_universe_frozen(self):
        value=copy.deepcopy(self.contract);value['pair_universe_policy']['artifact_sha256']='0'*64
        with self.assertRaises(ValueError):validator.validate(value)
        value=copy.deepcopy(self.contract);value['pair_universe_policy']['no_generation_during_design']=False
        with self.assertRaises(ValueError):validator.validate(value)


if __name__=='__main__': unittest.main()
