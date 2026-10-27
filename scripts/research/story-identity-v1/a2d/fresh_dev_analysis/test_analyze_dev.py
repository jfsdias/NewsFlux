import unittest
import analyze_dev as a

def row(label,score,pred=False,bucket='POSITIVE_SEEKING'):
 return {'human_decision':label,'qwen_score':score,'candidate_a':pred,'candidate_b':pred,'candidate_c':pred,'primary_bucket':bucket,'mining_strata':['S4_x'],'lexical_overlap':0.1,'temporal_delta_hours':2,'entity_anchor_overlap':1,'number_overlap':0,'date_overlap':0,'search_rank_v2':100}

class DevTests(unittest.TestCase):
 def test_confusion_uncertain_and_near_miss(self):
  rows=[row('SAME_EVENT',.9,True),row('RELATED_TOPIC',.8,True),row('DIFFERENT_EVENT',.7,True),row('UNCERTAIN',.6,True),row('SAME_EVENT',.5,False),row('DIFFERENT_EVENT',.4,False)]
  m=a.metrics(rows,lambda x:x['candidate_a'])
  self.assertEqual((m['TP'],m['FP_RELATED_TOPIC'],m['FP_DIFFERENT_EVENT'],m['FN'],m['TN'],m['UNCERTAIN_PREDICTED_MERGE']),(1,1,1,1,1,1))
 def test_sweep_and_determinism(self):
  rows=[row('SAME_EVENT',.9),row('RELATED_TOPIC',.4),row('UNCERTAIN',.4)]
  self.assertEqual(a.sweep(rows),a.sweep(rows));self.assertEqual(len(a.sweep(rows)),5)
 def test_pareto(self):
  data=[{'FALSE_MERGE_COUNT':0,'FALSE_SPLIT_COUNT':2},{'FALSE_MERGE_COUNT':1,'FALSE_SPLIT_COUNT':1},{'FALSE_MERGE_COUNT':2,'FALSE_SPLIT_COUNT':2}]
  self.assertEqual(a.pareto(data),data[:2])
 def test_evidence(self):
  good=[row('SAME_EVENT',.5,bucket='A') for _ in range(4)]+[row('SAME_EVENT',.5,bucket='B') for _ in range(4)]+[row('RELATED_TOPIC',.4) for _ in range(8)]+[row('DIFFERENT_EVENT',.1) for _ in range(44)]
  self.assertTrue(a.evidence(good)['pass']);self.assertFalse(a.evidence(good[:10])['pass'])
 def test_blind_guard(self):
  import builtins
  from pathlib import Path
  p=Path('/tmp/blind-human-labels-sealed-v1.jsonl')
  with a.blind_guard():
   for f in (lambda:builtins.open(p),lambda:p.read_bytes(),lambda:p.read_text()):
    with self.assertRaises(PermissionError):f()

class MoreDevTests(unittest.TestCase):
 def test_bucket_and_stratum_aggregation(self):
  rows=[row('SAME_EVENT',.8),row('RELATED_TOPIC',.4)]
  agg=a.aggregate(rows)
  self.assertEqual(agg['buckets']['POSITIVE_SEEKING']['SAME_EVENT'],1)
  self.assertEqual(agg['strata']['S4']['RELATED_TOPIC'],1)
 def test_exact_selective_join(self):
  from pathlib import Path
  import json,tempfile
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'features.jsonl';p.write_text(''.join(json.dumps(x,separators=(',',':'))+'\n' for x in [{'pair_key':'1:2','v':1},{'pair_key':'3:4','v':2}]))
   self.assertEqual(set(a.selective_jsonl(p,{'1:2'})),{'1:2'})
   with self.assertRaises(ValueError):a.selective_jsonl(p,{'9:10'})
 def test_private_artifacts_deterministic_and_invalid_domain(self):
  rows=[]
  for n in range(80):
   r=row('SAME_EVENT' if n<8 else 'DIFFERENT_EVENT',n/100)
   r['pair_key']=f'{2*n+1}:{2*n+2}';rows.append(r)
  self.assertEqual(a.artifacts(rows),a.artifacts(rows))
  rows[0]['human_decision']='BAD'
  with self.assertRaises(ValueError):a.analyze(rows)
 def test_guard_also_blocks_path_open(self):
  from pathlib import Path
  p=Path('/tmp/blind-human-labels-sealed-v1.jsonl')
  with a.blind_guard():
   with self.assertRaises(PermissionError):p.open()
 def test_private_destination(self):
  from pathlib import Path
  from unittest.mock import patch
  import tempfile
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'private';root.mkdir()
   with patch.object(a,'OUTPUT',root):
    with self.assertRaises(ValueError):a.freeze(Path(t)/'outside',{'x':b'x'})
    a.freeze(root/'good',{'x':b'x'})
    self.assertEqual((root/'good/x').stat().st_mode&0o777,0o444)
