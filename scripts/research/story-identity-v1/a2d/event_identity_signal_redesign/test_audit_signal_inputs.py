import unittest
import audit_signal_inputs as a

class FieldAuditTests(unittest.TestCase):
    def test_dynamic_schema_counts_and_lengths(self):
        rows=[{'id':1,'title':'Alpha','summary':'one'},{'id':2,'title':' B ','summary':''},{'id':3,'title':'','extra':None}]
        x=a.field_audit(rows,expected_count=3);self.assertEqual(x['fields']['summary']['present_record_count'],2);self.assertEqual(x['fields']['summary']['nonempty_record_count'],1);self.assertEqual(x['fields']['title']['character_length_median'],4)
        self.assertNotIn('Alpha',str(x));self.assertEqual(x['rich_text_available'],'PARTIAL')
    def test_routing_boundaries(self):
        self.assertEqual(a.rich_route(80,100),'YES');self.assertEqual(a.rich_route(79,100),'PARTIAL');self.assertEqual(a.rich_route(0,100),'NO')
        with self.assertRaises(ValueError):a.rich_route(101,100)
    def test_count_and_replay(self):
        with self.assertRaises(ValueError):a.field_audit([{'title':'a'}])
        rows=[{'id':i,'title':'x'} for i in range(500)]
        self.assertEqual(a.canonical(a.field_audit(rows)),a.canonical(a.field_audit(rows)))
        self.assertEqual(a.field_audit(rows)['rich_text_available'],'NO')
    def test_human_and_joined_firewall(self):
        import builtins,io,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            for n in a.FORBIDDEN:
                f=Path(d)/n
                with a.label_guard():
                    for read in (lambda:builtins.open(f),lambda:io.open(f),lambda:f.open(),lambda:f.read_text(),lambda:f.read_bytes()):
                        with self.assertRaises(PermissionError):read()
    def test_independent_validator_rejects_tampering(self):
        rows=[{'id':i,'title':'x'} for i in range(500)];data=a.field_audit(rows);a.validate_field_audit(rows,data)
        data['fields']['title']['present_record_count']=499
        with self.assertRaises(ValueError):a.validate_field_audit(rows,data)

    def test_spec_and_v1_pinning(self):
        a.validate_spec();self.assertEqual(a.gitblob(a.V1.read_bytes()),a.V1_BLOB)
        text=a.SPEC.read_text();self.assertIn('D_PAIRWISE_RERANKER_REFERENCE_HOLD',text);self.assertIn('State: HOLD',text);self.assertIn('CORROBORATION_NOT_PRIMARY_IDENTITY_SIGNAL',text)

    def test_frozen_artifact(self):
        import tempfile,hashlib
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'audit.json';data=a.canonical({'n':1});h=a.freeze(p,data)
            self.assertEqual(h,hashlib.sha256(p.read_bytes()).hexdigest());self.assertEqual(p.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):a.freeze(p,data)

    def test_nonempty_mixed_types(self):
        rows=[{'title':'  ','content':'x','v':None},{'title':'x','content':'  ','v':0},{'title':'x','v':'ok'}];x=a.field_audit(rows,expected_count=3)
        self.assertFalse(x['fields']['v']['type_consistent']);self.assertEqual(x['fields']['v']['nonempty_record_count'],2);self.assertEqual(x['fields']['content']['nonempty_record_count'],1)

    def test_validator_rejects_unexpected_raw_values(self):
        rows=[{'id':i,'title':'synthetic private title'} for i in range(500)];x=a.field_audit(rows);x['raw_text']='synthetic private title'
        with self.assertRaises(ValueError):a.validate_field_audit(rows,x)

    def test_next_track_routes_exactly(self):
        self.assertEqual(a.route('YES'),'STORY_02_A2D2C_P4_D2F_CONTENT_AWARE_EVENT_SIGNAL_BENCHMARK')
        self.assertEqual(a.route('PARTIAL'),'STORY_02_A2D2C_P4_D2E1_CONTENT_COVERAGE_DECISION')
        self.assertEqual(a.route('NO'),'STORY_02_A2D2C_P4_D2E1_FRESH_CORPUS_CONTENT_ENRICHMENT_CONTRACT')

    def test_d2d_joined_is_hash_only_not_parsed(self):
        import tempfile,hashlib
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'graph-dev-joined-v1.jsonl';f.write_bytes(b'not even json')
            with a.label_guard():
                self.assertEqual(a.hash_only(f),hashlib.sha256(b'not even json').hexdigest())
                with self.assertRaises(PermissionError):f.read_bytes()

    def test_input_hash_and_d2d_failure_pinning(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);corpus=root/'corpus.jsonl';corpus.write_text('{}\n');corpus.chmod(0o444);v1=root/'spec.md';v1.write_text('synthetic')
            analysis={'graph_dev_strict_positive_recovery_gate':'FAIL','graph_dev_related_boundary_evidence_gate':'FAIL','new_counts':{'SAME_EVENT':0,'RELATED_TOPIC':2,'DIFFERENT_EVENT':38,'UNCERTAIN':0},'combined':{'SAME_EVENT':0,'RELATED_TOPIC':3,'DIFFERENT_EVENT':117},'recommendation':'GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV'}
            files={'graph-dev-joined-v1.jsonl':b'not parsed','graph-dev-lane-diagnostics-v1.json':b'{}','graph-dev-analysis-v1.json':json.dumps(analysis).encode(),'graph-dev-analysis-manifest-v1.json':b'{"blind_state":"UNTOUCHED_SEALED"}'};hashes={}
            for name,data in files.items():
                path=root/name;path.write_bytes(data);path.chmod(0o444);hashes[name]=a.sha(data)
            with patch.object(a,'CORPUS',corpus),patch.object(a,'CORPUS_SHA',a.sha(corpus.read_bytes())),patch.object(a,'D2D',root),patch.object(a,'D2D_HASHES',hashes),patch.object(a,'V1',v1),patch.object(a,'V1_BLOB',a.gitblob(v1.read_bytes())):
                with a.label_guard():a.verify_inputs()
                path=root/'graph-dev-analysis-v1.json';path.chmod(0o644);analysis['graph_dev_strict_positive_recovery_gate']='PASS';path.write_text(json.dumps(analysis));path.chmod(0o444);hashes[path.name]=a.sha(path.read_bytes())
                with a.label_guard(),self.assertRaisesRegex(ValueError,'baseline'):a.verify_inputs()
                hashes[path.name]='0'*64
                with a.label_guard(),self.assertRaisesRegex(ValueError,'integrity'):a.verify_inputs()
