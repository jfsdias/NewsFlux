import unittest,hashlib
import prepare_review_session as p

class SessionTests(unittest.TestCase):
    def source(self):
        return [{'annotation_id':f'G{i:03}','pair_key':f'{i*2-1}:{i*2}','feed_a':'A','feed_b':'B','title_a':f'A {i}','title_b':f'B {i}','published_at_a':'2026-01-01','published_at_b':'2026-01-01','label_options':p.LABELS,'human_decision':''} for i in range(1,41)]
    def test_neutral_order_schema_and_replay(self):
        rows=self.source(); a=p.derive(rows,'a'*64);b=p.derive(rows,'a'*64);self.assertEqual(a,b)
        review,mapping=a;self.assertEqual(len(review),40);self.assertEqual(len(mapping),40)
        self.assertEqual([r['annotation_id'] for r in review],[f'R{i:03}' for i in range(1,41)])
        self.assertNotEqual([x['source_annotation_id'] for x in mapping],[x['annotation_id'] for x in rows])
        self.assertTrue(all(tuple(r)==p.COLUMNS and not r['human_decision'] and r['label_options']==p.LABELS for r in review))
    def test_reject_nonblank_and_duplicates(self):
        rows=self.source();rows[0]['human_decision']='SAME_EVENT'
        with self.assertRaises(ValueError):p.derive(rows,'a'*64)
        rows=self.source();rows[1]['pair_key']=rows[0]['pair_key']
        with self.assertRaises(ValueError):p.derive(rows,'a'*64)
    def test_guard(self):
        import builtins,io,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            q=Path(d)/'receipt.json';q.write_text('{}')
            with p.label_guard():
                self.assertEqual(q.read_text(),'{}')
                for n in p.FORBIDDEN:
                    f=Path(d)/n
                    for read in (lambda:builtins.open(f),lambda:io.open(f),lambda:f.open(),lambda:f.read_text(),lambda:f.read_bytes()):
                        with self.assertRaises(PermissionError):read()

    def test_independent_validator_rejects_hidden_metadata(self):
        rows=self.source(); reviews,mapping,cb,html=p.build(rows,'a'*64)
        p.validate(rows,reviews,mapping,'a'*64,cb,html)
        with self.assertRaises(ValueError):p.validate(rows,reviews,mapping,'a'*64,cb,html+b'<!-- pair_key -->')
        with self.assertRaises(ValueError):p.validate(rows,reviews,mapping,'a'*64,cb,html.replace(b'const rows = ',b'const rows = [];const bogus='))

    def test_exact_order_hash_and_mapping(self):
        rows=self.source(); review,mapping=p.derive(rows,'f'*64)
        expected=sorted(rows,key=lambda r:hashlib.sha256(f"STORY02-D2B|{'f'*64}|{r['pair_key']}".encode()).hexdigest())
        self.assertEqual([x['source_annotation_id'] for x in mapping],[x['annotation_id'] for x in expected])
        self.assertEqual(len({x['pair_key'] for x in mapping}),40)
        self.assertEqual(len({x['source_annotation_id'] for x in mapping}),40)
        self.assertTrue(all(set(x)=={'review_annotation_id','source_annotation_id','pair_key'} for x in mapping))
        self.assertEqual(review[0]['annotation_id'],'R001');self.assertEqual(review[-1]['annotation_id'],'R040')

    def test_contract_and_freeze(self):
        import tempfile
        from pathlib import Path
        self.assertEqual(p.canonical(p.contract()),p.canonical(p.contract()))
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'contract.json'; data=p.canonical(p.contract()); h=p.freeze(path,data)
            self.assertEqual(h,hashlib.sha256(data).hexdigest());self.assertEqual(path.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):p.freeze(path,data)

    def test_reviewer_surface_privacy(self):
        rows=self.source();review,mapping,cb,html=p.build(rows,'a'*64)
        self.assertNotIn(b'pair_key',cb);self.assertNotIn(b'G001',cb);self.assertNotIn(b'neutral-review-map-v1',html)
        for label in p.LABELS.split('|'):self.assertIn(label.encode(),p.GUIDE)
        for bad in (b'pair_key',b'qwen_score',b'selection_lane',b'G001'):
            with self.assertRaises(ValueError):p.privacy(bad)
        p.validate(rows,review,mapping,'a'*64,cb,html)
