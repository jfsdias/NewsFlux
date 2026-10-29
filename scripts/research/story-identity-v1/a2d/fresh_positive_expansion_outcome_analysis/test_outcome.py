import copy,unittest
import analyze_expansion_outcome as a

def row(x,y,label):return {'pair_key':f'{x}:{y}','article_id_a':x,'article_id_b':y,'human_decision':label}
class Tests(unittest.TestCase):
 def test_global_arithmetic(self):self.assertEqual(a.counts([row(1,2,'SAME_EVENT'),row(3,4,'RELATED_TOPIC')])['SAME_EVENT'],1)
 def test_discovery_zero(self):self.assertEqual(a.discovery(0),'FAIL')
 def test_discovery_one(self):self.assertEqual(a.discovery(1),'PASS')
 def test_count_eleven(self):self.assertEqual(a.count_gate(11),'FAIL')
 def test_count_twelve(self):self.assertEqual(a.count_gate(12),'PASS')
 def test_count_failure_skips_components(self):self.assertFalse(a.component_required(11))
 def test_count_success_requires_components(self):self.assertTrue(a.component_required(12))
 def test_reconstruction(self):self.assertEqual(a.components([row(1,2,'UNCERTAIN'),row(2,3,'UNCERTAIN')]),{1:1,2:1,3:1})
 def test_mismatch_rejected(self):
  with self.assertRaises(ValueError):a.check_baseline_components([dict(row(1,2,'SAME_EVENT'),component_id='C0002')],{1:1,2:1})
 def test_projection(self):self.assertEqual(a.project([row(1,2,'SAME_EVENT')],{1:1,2:1}),[1])
 def test_bridge_rejected(self):
  with self.assertRaisesRegex(ValueError,'BRIDGES'):a.project([row(1,2,'SAME_EVENT')],{1:1,2:2})
 def test_absent_rejected(self):
  with self.assertRaisesRegex(ValueError,'NOT_IN'):a.project([row(1,2,'SAME_EVENT')],{1:1})
 def test_calibration_pass(self):self.assertTrue(a.calibration(12,[6,3,3]))
 def test_component_count_fail(self):self.assertFalse(a.calibration(12,[6,6]))
 def test_share_fail(self):self.assertFalse(a.calibration(12,[7,3,2]))
 def test_share_half_pass(self):self.assertTrue(a.calibration(12,[6,4,2]))
 def test_related_not_positive(self):self.assertEqual(a.counts([row(1,2,'RELATED_TOPIC')])['SAME_EVENT'],0)
 def test_uncertain_not_positive(self):self.assertEqual(a.counts([row(1,2,'UNCERTAIN')])['SAME_EVENT'],0)
 def test_duplicate_pair(self):
  with self.assertRaises(ValueError):a.validate_rows([row(1,2,'UNCERTAIN'),row(1,2,'UNCERTAIN')])
 def test_pair_overlap(self):
  with self.assertRaises(ValueError):a.disjoint([row(1,2,'UNCERTAIN')],[row(1,2,'UNCERTAIN')])
 def test_article_overlap(self):
  with self.assertRaises(ValueError):a.disjoint([row(1,2,'UNCERTAIN')],[row(2,3,'UNCERTAIN')])
 def test_governance(self):self.assertEqual(a.governance(0)['fresh_same_event_prevalence'],'UNKNOWN');self.assertFalse(a.governance(0)['benchmark_authorized'])
 def test_replay(self):self.assertEqual(a.canonical(a.governance(12)),a.canonical(a.governance(12)))
 def test_invalid_decision(self):
  with self.assertRaises(ValueError):a.validate_rows([row(1,2,'INVALID')])
if __name__=='__main__':unittest.main()
