import unittest
import build_content_enrichment_contract as c

class ContractTests(unittest.TestCase):
    def test_pinned_contract_and_replay(self):
        x=c.contract();self.assertEqual(c.canonical(x),c.canonical(c.contract()));c.validate_contract(x)
        self.assertEqual(x['base_main_sha'],'3d83ff4177058d19e0bb6b4b77c46e1f9f798693')
        self.assertEqual(x['coverage']['denominator'],500);self.assertEqual(x['coverage']['minimum_share'],0.8)
    def test_contract_mutation_rejected(self):
        import copy
        for path,val in [(('storage_model',),'REPLACE'),(('coverage','denominator'),499),(('coverage','minimum_share'),0.79),(('normalization','max_codepoints'),8193),(('redirect','maximum'),6),(('sources','publisher_url_fetch'),'ALLOW'),(('identity','mismatch_auto_repair'),True)]:
            x=copy.deepcopy(c.contract());o=x
            for p in path[:-1]:o=o[p]
            o[path[-1]]=val
            with self.subTest(path=path),self.assertRaises(ValueError):c.validate_contract(x)
    def test_coverage_routes(self):
        self.assertEqual(c.coverage_route(400),'PASS');self.assertEqual(c.coverage_route(399),'FAIL_PARTIAL');self.assertEqual(c.coverage_route(0),'FAIL_NO_CONTENT')
        with self.assertRaises(ValueError):c.coverage_route(501)
    def test_forbidden_guard(self):
        import tempfile,builtins,io
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            for name in c.FORBIDDEN_LABEL_FILES:
                p=Path(d)/name
                with c.label_guard():
                    for read in (lambda:builtins.open(p),lambda:io.open(p),lambda:p.open(),lambda:p.read_text(),lambda:p.read_bytes()):
                        with self.assertRaises(PermissionError):read()
    def test_independent_validator_rejects_missing_security_rule(self):
        x=c.contract();x['security']['blocked_destinations'].remove('LOOPBACK')
        with self.assertRaises(ValueError):c.validate_contract(x)

    def test_source_temporal_and_normalization_contract(self):
        x=c.contract();self.assertEqual(x['sources']['priority'][0],'MINIFLUX_ENTRY_CONTENT');self.assertEqual(x['sources']['publisher_url_fetch'],'HOLD')
        self.assertEqual(x['temporal']['miniflux'],'MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL');self.assertEqual(x['temporal']['publisher'],'LIVE_PAGE_AT_RETRIEVAL')
        self.assertFalse(x['normalization']['title_only_fallback_counts_as_enrichment']);self.assertEqual(x['normalization']['max_codepoints'],8192)
        self.assertEqual(x['identity']['usable_identity_status'],'IDENTITY_MATCH');self.assertFalse(x['identity']['mismatch_auto_repair'])

    def test_no_network_or_model_in_contract_generation(self):
        import socket,urllib.request
        from unittest.mock import patch
        with patch.object(socket,'create_connection',side_effect=AssertionError('network')),patch.object(urllib.request,'urlopen',side_effect=AssertionError('network')):
            x=c.contract();c.validate_contract(x)
            self.assertEqual(x['miniflux_api_reads'],0);self.assertEqual(x['article_http_requests'],0);self.assertEqual(x['model_inference_calls'],0)

    def test_private_freeze(self):
        import tempfile,hashlib
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'contract.json';data=c.canonical(c.contract());h=c.freeze(p,data)
            self.assertEqual(h,hashlib.sha256(p.read_bytes()).hexdigest());self.assertEqual(p.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):c.freeze(p,data)

    def test_no_article_values_in_contract(self):
        def keys(obj):
            if isinstance(obj,dict):return set(obj)|{k for v in obj.values() for k in keys(v)}
            if isinstance(obj,list):return {k for v in obj for k in keys(v)}
            return set()
        self.assertNotIn('normalized_content',keys(c.contract()));self.assertNotIn('pair_key',keys(c.contract()))

    def test_input_pins_and_d2e_state(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);corpus=root/'corpus.jsonl';corpus.write_bytes(b'{}\n'*500);corpus.chmod(0o444)
            audit=root/'fresh-corpus-field-audit-v1.json';audit.write_bytes(c.canonical({'article_count':500,'rich_text_available':'NO','rich_text_nonempty_count':0}));audit.chmod(0o444)
            manifest=root/'event-identity-signal-redesign-manifest-v1.json';manifest.write_bytes(c.canonical({'field_audit_sha256':c.sha(audit.read_bytes())}));manifest.chmod(0o444)
            with patch.object(c,'CORPUS',corpus),patch.object(c,'CORPUS_SHA',c.sha(corpus.read_bytes())),patch.object(c,'D2E',root),patch.object(c,'AUDIT_SHA',c.sha(audit.read_bytes())),patch.object(c,'MANIFEST_SHA',c.sha(manifest.read_bytes())):
                c.verify_inputs();corpus.chmod(0o644);corpus.write_bytes(b'changed');corpus.chmod(0o444)
                with self.assertRaisesRegex(ValueError,'integrity'):c.verify_inputs()
