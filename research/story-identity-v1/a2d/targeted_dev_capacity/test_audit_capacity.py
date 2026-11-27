import unittest
import audit_capacity as a

class CapacityTests(unittest.TestCase):
 def test_corroboration_and_priority(self):
  q={'q75':.2,'q85':.3,'q90':.4,'q95':.5,'q50_nonzero':.1,'q75_nonzero':.2}
  r={'qwen_score':.6,'temporal_delta_hours':2,'lexical_overlap':.3,'entity_anchor_overlap':1,'number_overlap':0,'date_overlap':0}
  self.assertEqual(a.corroboration(r),2);self.assertTrue(a.strong(r,'S0',q));self.assertEqual(a.lane(r,'S0','T0',q),'strong')
 def test_quantile(self):self.assertEqual(a.quantile([1,2,3],.75),2.5)
 def test_sealed_file_guard(self):
  import builtins
  from pathlib import Path
  p=Path('/tmp/blind-human-labels-sealed-v1.jsonl')
  with a.blind_guard():
   for fn in (lambda:builtins.open(p),lambda:p.open(),lambda:p.read_text(),lambda:p.read_bytes()):
    with self.assertRaises(PermissionError):fn()
 def test_matching_bound(self):
  rows=[{'article_a_id':1,'article_b_id':2},{'article_a_id':1,'article_b_id':3},{'article_a_id':4,'article_b_id':5}]
  self.assertEqual(a.matching_upper_bound(rows),2)
 def test_catalog_and_templates(self):
  import hashlib
  self.assertEqual(hashlib.sha256(a.CATALOG_BYTES).hexdigest(),a.CATALOG_HASH)
  self.assertEqual([sum(a.CATALOG['templates'][k]) for k in ('Q64','Q72','Q80')],[64,72,80])
 def test_predicates_and_priority(self):
  q={'q75':.2,'q85':.3,'q90':.4,'q95':.5,'q50_nonzero':.1,'q75_nonzero':.2}
  r={'qwen_score':.6,'temporal_delta_hours':2,'lexical_overlap':.3,'entity_anchor_overlap':1,'number_overlap':0,'date_overlap':0}
  for s in a.CATALOG['strong']:self.assertTrue(a.strong(r,s,q))
  for t in a.CATALOG['text']:self.assertTrue(a.text_match(r,t,q))
  r['qwen_score']=.1
  self.assertEqual(a.lane(r,'S0','T0',q),'control')
 def test_exclusion_crossfeed_temporal(self):
  r=dict(article_a_id=1,article_b_id=2,feed_a_id=10,feed_b_id=20,temporal_delta_hours=24)
  self.assertTrue(a.eligible(r,set()));self.assertFalse(a.eligible(r,{2}))
  r['feed_b_id']=10;self.assertFalse(a.eligible(r,set()))
  r['feed_b_id']=20;r['temporal_delta_hours']=24.01;self.assertFalse(a.eligible(r,set()))
 def test_solver_witness_and_bounds(self):
  rows=[dict(article_a_id=2*n,article_b_id=2*n+1,feed_a_id=2*n,feed_b_id=2*n+1,category_a='A',category_b='B') for n in range(10)]
  x=a.max_total_witness(rows);self.assertEqual(x['status'],'OPTIMAL');self.assertEqual(x['total'],10)
 def test_dominant_category_not_reported_feasible(self):
  rows=[dict(article_a_id=2*n,article_b_id=2*n+1,feed_a_id=2*n,feed_b_id=2*n+1,category_a='A',category_b='A') for n in range(10)]
  self.assertEqual(a.max_total_witness(rows)['status'],'UNKNOWN_BOUNDED_SEARCH')
 def test_private_export_and_replay(self):
  import tempfile,json
  from pathlib import Path
  from unittest.mock import patch
  import export_audit as e
  sample=(json.dumps({'frontier':[{'strong':'S0'}]})+'\n').encode()
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'private';root.mkdir()
   with patch.object(e,'ROOT',root):
    with self.assertRaises(ValueError):e.export(sample,sample+b'x',root/'x')
    with self.assertRaises(ValueError):e.export(sample,sample,Path(t)/'outside')
    out=e.export(sample,sample,root/'good');self.assertEqual(len(out),3)
    self.assertEqual((root/'good/capacity-audit-v1.json').stat().st_mode&0o777,0o444)

class DiversityTests(unittest.TestCase):
 def test_feed_cap_blocks_upper_bound(self):
  rows=[dict(article_a_id=2*n,article_b_id=2*n+1,feed_a_id=1,feed_b_id=100+n,category_a='A',category_b='B') for n in range(10)]
  self.assertEqual(a.max_total_witness(rows)['status'],'UNKNOWN_BOUNDED_SEARCH')
 def test_source_pair_cap_blocks_upper_bound(self):
  rows=[dict(article_a_id=2*n,article_b_id=2*n+1,feed_a_id=2*n+10,feed_b_id=2*n+11,category_a='A',category_b='B') for n in range(10)]
  rows[1]['feed_a_id']=rows[0]['feed_a_id'];rows[1]['feed_b_id']=rows[0]['feed_b_id']
  self.assertEqual(a.max_total_witness(rows)['status'],'UNKNOWN_BOUNDED_SEARCH')
 def test_text_priority_and_near_miss(self):
  q={'q75':.2,'q85':.3,'q90':.4,'q95':.5,'q50_nonzero':.1,'q75_nonzero':.2}
  r={'qwen_score':.45,'temporal_delta_hours':9,'lexical_overlap':.21,'entity_anchor_overlap':1,'number_overlap':0,'date_overlap':0}
  self.assertEqual(a.lane(r,'S0','T0',q),'text');r['lexical_overlap']=.01
  self.assertEqual(a.lane(r,'S0','T0',q),'near_miss')
