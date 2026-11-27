import unittest
import diagnostic_core as d
class DesignTests(unittest.TestCase):
 def test_good_contract(self):d.validate_design(d.good_design())
 def bad(self,key,value):
  c=d.good_design();c[key]=value
  with self.assertRaises(ValueError):d.validate_design(c)
 def test_legacy(self):self.bad('legacy','ACTIVE')
 def test_alpha(self):self.bad('alpha',.10)
 def test_delta(self):self.bad('delta',.10)
 def test_production(self):self.bad('production_threshold',.05)
 def test_design_effect(self):self.bad('fixed_design_effect',2)
 def test_thinning(self):self.bad('article_sampling','THIN')
 def test_overlap(self):self.bad('temporal_independence',False)
 def test_capture_before_freeze(self):self.bad('capture_after_merge',False)
 def test_single_reviewer(self):self.bad('independent_reviewers',1)
 def test_adjudication(self):self.bad('adjudication',False)
 def test_probabilities(self):self.bad('known_inclusion_probabilities',False)
 def test_independent_units(self):self.bad('independent_units_from_pairs',True)
 def test_benchmark(self):self.bad('benchmark_authorized',True)
 def test_blind(self):self.bad('blind_open',True)

 def test_checked_in_contract(self):
  import json
  from pathlib import Path
  d.validate_design(json.loads(Path(__file__).with_name('validation-design-contract-v1.json').read_text()))

class SamplingFrameTimingTests(unittest.TestCase):
 def test_label_blind_two_barrier_contract(self):
  import json
  from pathlib import Path
  c=json.loads(Path(__file__).with_name('validation-design-contract-v1.json').read_text())
  expected={'sampling_rule_preregistered_pre_capture':True,'realized_frame_frozen_post_capture_pre_label':True,'realized_sample_size_known_pre_capture':False,'realized_sample_size_derived_pre_label':True,'inclusion_probabilities_known_pre_capture':False,'inclusion_probabilities_frozen_pre_label':True,'budget_exceedance_action':'STOP_TO_PM'}
  for key,value in expected.items():self.assertIn(key,c);self.assertEqual(c[key],value)
  pre={'capture_span','pair_window','candidate_rule','extractor_versions','component_construction','eligible_component_definition','unsafe_outcome_definition','sampling_algorithm','seed_derivation_policy','hypergeometric_inversion','component_to_edge_conversion','alpha_delta','component_review_cap','edge_review_budget','oversized_component_stop','frame_to_sample_size_rule','reviewer_protocol','adjudication_protocol','analysis_code_coverage_tests'}
  post={'article_frame_hash','candidate_edge_frame_hash','component_frame_hash','component_count','predicted_edge_count','component_edge_weights','census_or_sample','realized_sample_size','inclusion_probabilities','instantiated_seed','sampled_component_ids','review_edge_set'}
  self.assertEqual(set(c['pre_capture_freeze']),pre)
  self.assertEqual(set(c['post_capture_pre_label_frame_freeze']),post)
 def test_no_impossible_prefreeze_language(self):
  from pathlib import Path
  root=Path(__file__).parent
  for name in ('BENCHMARK_READINESS_FRAMEWORK_V1.md','DENSE_WINDOW_VALIDATION_DESIGN.md'):
   s=(root/name).read_text().lower()
   self.assertIn('post_capture_pre_label_frame_freeze',s)
   self.assertNotIn('determine the actual sample size before capture',s)
   self.assertNotIn('freeze sample sizes, sampling seeds, inclusion probabilities',s)
   self.assertNotIn('preregister the sample count',s)
