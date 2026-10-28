import hashlib
import unittest
import select_graph_dev as s

class SelectionContractTests(unittest.TestCase):
    def test_priority_is_exact_sha256(self):
        self.assertEqual(s.priority('a'*64,'event','1:2'),hashlib.sha256(('STORY02-R3|'+'a'*64+'|event|1:2').encode()).hexdigest())

    def test_guard_blocks_all_label_files(self):
        import builtins, io
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as tmp:
            receipt=Path(tmp)/'gold-coverage-receipt-v1.json'; receipt.write_text('{}')
            with s.label_guard():
                self.assertEqual(receipt.read_text(),'{}')
                for name in s.FORBIDDEN:
                    path=Path(tmp)/name
                    for read in (lambda: builtins.open(path),lambda: io.open(path),lambda: path.open(),lambda: path.read_text(),lambda: path.read_bytes()):
                        with self.assertRaises(PermissionError): read()

    def test_lexicographic_locking(self):
        candidates=[{'id':i} for i in range(4)]
        def feasible(included,excluded):
            return len(included)<=2 and not ({0,1}<=included) and len(set(range(4))-excluded)>=2
        self.assertEqual(s.lexicographic_lock(candidates,feasible,2),[0,2])

class ValidatorTests(unittest.TestCase):
    def fixture(self):
        corpus={}; rows=[]
        for i in range(40):
            lane='event' if i<20 else ('near' if i<32 else 'control')
            a,b=2*i+1,2*i+2
            for x in (a,b):corpus[x]={'id':x,'feed_id':x,'feed_title':'feed','title':'title','published_at':'2026-01-01T00:00:00Z','category_id':x%3}
            rows.append({'article_a_id':a,'article_b_id':b,'feed_a_id':a,'feed_b_id':b,'category_a':a%3,'category_b':b%3,'pair_key':f'{a}:{b}','selection_lane':lane,'selection_priority':'0'*64,'qwen_score':.4,'temporal_delta_hours':0,'reciprocal_rank_max':1 if lane=='event' else (7 if lane=='near' else 50),'shared_support_feed_count':0,'common_top10_count':0})
        return rows,corpus
    def test_valid_and_bad_membership(self):
        rows,corpus=self.fixture();self.assertEqual(s.validate(rows,corpus,set(),set(),set())['same_feed_pair_count'],0)
        with self.assertRaises(ValueError):s.validate(rows,corpus,{1},set(),set())
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),{'1:2'},set())
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),{'1:2'})
        with self.assertRaises(ValueError):s.validate(rows[:-1],corpus,set(),set(),set())
        with self.assertRaises(ValueError):s.validate(rows,{k:v for k,v in corpus.items() if k!=1},set(),set(),set())
    def test_wrong_lane_and_duplicate(self):
        rows,corpus=self.fixture();rows[0]['selection_lane']='near';rows[20]['selection_lane']='event'
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),set())
        rows,corpus=self.fixture();rows[1]=dict(rows[0])
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),set())
    def test_frozen_contract_and_replay_pack(self):
        import tempfile
        from pathlib import Path
        rows,corpus=self.fixture()
        for r in rows:
            r.update(rank_a_to_b=1,rank_b_to_a=1,common_top5_count=0,support_degree_a=0,support_degree_b=0,min_support_degree=0,support_burst_span_hours=0,shared_support_article_count=0)
        one=s.encode_pack(rows,corpus);self.assertEqual(one,s.encode_pack(rows,corpus))
        text=one[0].decode();self.assertIn('G001',text);self.assertIn('G040',text);self.assertIn('SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN',text)
        self.assertTrue(all(line.endswith(',') for line in text.splitlines()[1:]))
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'contract.json'; content=s.graph.canonical_json_bytes(s.contract()); h=s.freeze(path,content)
            self.assertEqual(h,hashlib.sha256(content).hexdigest());self.assertEqual(path.stat().st_mode & 0o777,0o444)
            with self.assertRaises(FileExistsError):s.freeze(path,content)
    def test_contract_exact(self):
        c=s.contract();self.assertEqual((c['event_strategy'],c['near_strategy'],c['template']),( 'E0','N1','G40'))
        self.assertEqual((c['event_quota'],c['near_quota'],c['control_quota']),(20,12,8))

    def test_temporal_rounding_and_actual_boundary(self):
        rows,corpus=self.fixture(); corpus[2]['published_at']='2026-01-01T00:00:01Z';rows[0]['temporal_delta_hours']=round(1/3600,4)
        s.validate(rows,corpus,set(),set(),set())
        rows,corpus=self.fixture(); corpus[66]['published_at']='2026-01-02T00:00:01Z'; rows[32]['temporal_delta_hours']=24.0
        with self.assertRaisesRegex(ValueError,'time'):s.validate(rows,corpus,set(),set(),set())

    def test_pair_key_must_identify_endpoints(self):
        rows,corpus=self.fixture();rows[0]['pair_key']='2001:2002'
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),set())

    def test_rejects_same_feed_and_each_diversity_limit(self):
        rows,corpus=self.fixture(); corpus[2]['feed_id']=1
        with self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),set())
        for kind in ('feed','category','source'):
            rows,corpus=self.fixture()
            for i,r in enumerate(rows):
                a,b=r['article_a_id'],r['article_b_id']
                if kind=='feed' and i<17:corpus[a]['feed_id']=1000;r['feed_a_id']=1000
                if kind=='category':corpus[a]['category_id']=0;corpus[b]['category_id']=0
                if kind=='source' and i<5:
                    corpus[a]['feed_id']=1000; corpus[b]['feed_id']=1001;r['feed_a_id']=1000;r['feed_b_id']=1001
            with self.subTest(kind=kind),self.assertRaises(ValueError):s.validate(rows,corpus,set(),set(),set())

    def test_explicit_lane_priority(self):
        rows,_=self.fixture(); r=rows[0];self.assertTrue(s.graph.matches_strategy(r,'E0'));self.assertTrue(s.graph.matches_strategy(r,'N1'))
        self.assertEqual(s.graph.classify_lanes([r],'E0','N1')[0]['selection_lane'],'event')

    def test_r2a_receipt_validation_and_rejection(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); catalog=root/'graph-strategy-catalog-v1.json';catalog.write_bytes(s.graph.canonical_json_bytes(s.graph.STRATEGY_CATALOG))
            receipt=root/'gold-coverage-receipt-v1.json'; audit=root/'graph-context-audit-v1.json'
            gold={'gold_pair_count':233,'gold_unique_pair_count':233,'gold_article_count':153,'home200_article_count':200,'gold_pair_missing_from_historical_source':0,'gold_pair_missing_from_historical_context':0,'gold_article_missing_from_home200':0,'gold_graph_compatibility_gate':'PASS','gold_identity_subset_home200_gate':'PASS','gold_pair_set_sha256':'5bd1ac7d13c4eb5a5ab6279b2522a0f5ab9e9203471e62c59696942d6ab48880','gold_article_set_sha256':'67508740cb22cdc0bb502cd37cb652b8f31746f4d285fc6da9dc4fc61ef40c85'}
            evidence={'graph_context_signal_gate':'PASS','g40_feasible_config_count':5,'g48_feasible_config_count':4,'recommended_for_pm_review':['E0/N1/G40','E3/N1/G40','E3/N1/G48']}
            receipt.write_text(json.dumps(gold));audit.write_text(json.dumps(evidence));
            for p in (receipt,audit,catalog):p.chmod(0o444)
            hashes={p:s.digest(p.read_bytes()) for p in (receipt,audit,catalog)}
            with patch.object(s,'R2',root),patch.object(s,'HASHES',hashes):
                self.assertEqual(s.check_inputs()['gold_pair_count'],233)
                receipt.chmod(0o644);gold['gold_article_missing_from_home200']=1;receipt.write_text(json.dumps(gold));receipt.chmod(0o444);hashes[receipt]=s.digest(receipt.read_bytes())
                with self.assertRaisesRegex(ValueError,'receipt'):s.check_inputs()
