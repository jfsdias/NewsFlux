import unittest
import diagnostic_core as d
class DiagnosticTests(unittest.TestCase):
 def test_hash_mismatch(self):
  with self.assertRaises(ValueError):d.verify_hash(b'x','0'*64)
 def test_noncanonical_attempt(self):
  with self.assertRaises(ValueError):d.verify_role('OTHER')
 def test_blind_path(self):
  with self.assertRaises(PermissionError):d.guard_name('blind-human-labels.csv')
 def test_network(self):
  with self.assertRaises(PermissionError):d.forbid_network()
 def test_bad_counts(self):
  with self.assertRaises(ValueError):d.check_counts({'SAME_EVENT':8})
 def test_review_pack_generation_forbidden(self):
  with self.assertRaises(PermissionError):d.forbid_review_pack()
 def test_feature_mismatch(self):
  with self.assertRaises(ValueError):d.check_feature_semantics('incompatible')
 def test_b1_mismatch(self):
  with self.assertRaises(ValueError):d.check_b1({1},{2})
 def test_exclusion(self):
  with self.assertRaises(ValueError):d.verify_excluded([{'a':1,'b':2}],{1})
 def test_replay(self):self.assertEqual(d.canonical({'x':1}),d.canonical({'x':1}))

class RuntimeFirewallTests(unittest.TestCase):
 def test_actual_socket_firewall(self):
  import os,socket,importlib
  from unittest.mock import patch
  roles=('d2f1_pool','d2f2_pack','d2f4_labels','d2f6_candidates','d2f6_frontier','d2f7_pack','d2f9_labels','d2f10_global','p2_features','graph_context','content_capability')
  env={'D2G0_'+k.upper():'/tmp/synthetic-'+k for k in roles};env['D2G0_OUTPUT_ROOT']='/tmp/synthetic-output'
  with patch.dict(os.environ,env):
   module=importlib.import_module('diagnose_private_evidence')
   with socket.socket() as sock, module.firewall(), self.assertRaises(PermissionError):sock.connect(('127.0.0.1',1))
 def test_actual_blind_file_firewall(self):
  import os,importlib
  from pathlib import Path
  from unittest.mock import patch
  roles=('d2f1_pool','d2f2_pack','d2f4_labels','d2f6_candidates','d2f6_frontier','d2f7_pack','d2f9_labels','d2f10_global','p2_features','graph_context','content_capability')
  env={'D2G0_'+k.upper():'/tmp/synthetic-'+k for k in roles};env['D2G0_OUTPUT_ROOT']='/tmp/synthetic-output'
  with patch.dict(os.environ,env):
   module=importlib.import_module('diagnose_private_evidence')
   with module.firewall(),self.assertRaises(PermissionError):Path('/tmp/blind-human-labels.csv').read_bytes()
 def test_gold_forbidden(self):
  with self.assertRaises(PermissionError):d.guard_name('story-identity-gold-v2.csv')
