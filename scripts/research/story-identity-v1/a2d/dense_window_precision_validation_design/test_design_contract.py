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
