import unittest,csv,io,hashlib
import ingest_graph_labels as p

class IngestionTests(unittest.TestCase):
    def fixture(self):
        blank=[];human=[];mapping=[];source=[]
        for i in range(1,41):
            r={'annotation_id':f'R{i:03}','feed_a':'A','feed_b':'B','title_a':f'A {i}','title_b':f'B {i}','published_at_a':'2026-01-01','published_at_b':'2026-01-02','label_options':p.LABELS,'human_decision':''};blank.append(r);human.append({**r,'human_decision':'RELATED_TOPIC' if i<=2 else 'DIFFERENT_EVENT'});mapping.append({'review_annotation_id':r['annotation_id'],'source_annotation_id':f'G{i:03}','pair_key':f'{2*i-1}:{2*i}'});source.append({'annotation_id':f'G{i:03}','pair_key':f'{2*i-1}:{2*i}'})
        return human,blank,mapping,source
    def test_valid_and_deterministic(self):
        args=self.fixture();x=p.derive(*args);self.assertEqual(x,p.derive(*args));self.assertEqual(len(x),40);self.assertEqual(x[0]['source_annotation_id'],'G001')
    def test_metadata_and_decision_rejected(self):
        for field,value in [('title_a','different'),('feed_a','different'),('published_at_a','changed'),('label_options','bad'),('human_decision',''),('human_decision','INVALID')]:
            human,blank,mapping,source=self.fixture();human[0][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):p.derive(human,blank,mapping,source)
    def test_duplicate_missing_unknown_mapping_rejected(self):
        for action in ('duplicate','missing','unknown','map','pair'):
            human,blank,mapping,source=self.fixture()
            if action=='duplicate':human[1]['annotation_id']=human[0]['annotation_id']
            elif action=='missing':human.pop()
            elif action=='unknown':human[0]['annotation_id']='R999'
            elif action=='map':mapping[0]['source_annotation_id']=mapping[1]['source_annotation_id']
            else:mapping[0]['pair_key']='900:901'
            with self.subTest(action=action),self.assertRaises(ValueError):p.derive(human,blank,mapping,source)
    def test_forbidden_guard(self):
        import builtins,io,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            ok=Path(d)/'story02-d2b-human-completed.csv';ok.write_text('ok')
            with p.label_guard():
                self.assertEqual(ok.read_text(),'ok')
                for n in p.FORBIDDEN:
                    f=Path(d)/n
                    for read in (lambda:builtins.open(f),lambda:io.open(f),lambda:f.open(),lambda:f.read_text(),lambda:f.read_bytes()):
                        with self.assertRaises(PermissionError):read()

    def test_independent_output_validator(self):
        from unittest.mock import patch
        human,blank,mapping,source=self.fixture();actual=p.derive(human,blank,mapping,source)
        with patch.object(p,'derive',side_effect=AssertionError('must not call derivation')):
            p.validate_output(actual,human,blank,mapping,source)
            actual[0]['pair_key']='9:999'
            with self.assertRaises(ValueError):p.validate_output(actual,human,blank,mapping,source)

    def test_csv_schema_and_reconstruction(self):
        human,blank,_,_=self.fixture();b=p.blank_bytes(human);self.assertEqual(p.read_csv(b),blank)
        altered=b.replace(b'annotation_id',b'bad_header',1)
        with self.assertRaises(ValueError):p.read_csv(altered)
        self.assertEqual(hashlib.sha256(b).hexdigest(),hashlib.sha256(p.blank_bytes(human)).hexdigest())

    def test_exact_counts_and_map_structure(self):
        human,blank,mapping,source=self.fixture();human[0]['human_decision']='SAME_EVENT'
        with self.assertRaises(ValueError):p.derive(human,blank,mapping,source)
        human,blank,mapping,source=self.fixture();mapping[0]['unexpected']='extra'
        with self.assertRaises(ValueError):p.derive(human,blank,mapping,source)
        human,blank,mapping,source=self.fixture();source[0]['annotation_id']='G999'
        with self.assertRaises(ValueError):p.derive(human,blank,mapping,source)

    def test_freeze_and_canonical_encoding(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'x';data=p.canonical({'b':1,'a':'text'});self.assertEqual(data,b'{"a":"text","b":1}\n');h=p.freeze(f,data)
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(),h);self.assertEqual(f.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):p.freeze(f,data)

    def test_pinned_inputs_and_mutation_detection(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);f=root/'neutral.csv';f.write_bytes(b'neutral');f.chmod(0o444)
            human=root/'story02-d2b-human-completed.csv';human.write_bytes(b'completed')
            with patch.object(p,'HASHES',{f:p.sha(b'neutral')}),patch.object(p,'COMPLETED_SHA',p.sha(b'completed')):
                self.assertEqual(p.verify_inputs(human),b'completed')
                f.chmod(0o644);f.write_bytes(b'changed');f.chmod(0o444)
                with self.assertRaises(ValueError):p.verify_inputs(human)
                f.chmod(0o644);f.write_bytes(b'neutral');f.chmod(0o444);human.write_bytes(b'changed')
                with self.assertRaises(ValueError):p.verify_inputs(human)
                with self.assertRaises(ValueError):p.verify_inputs(root/'story02-d2b-checkpoint.csv')
