import json,unittest
import ingest_fresh_positive_labels as m

def fixture():
    cols=m.COLUMNS;blank=[];human=[];mapping=[];selected=[]
    for i in range(1,41):
        ident=f'R{i:03}';a=2*i-1;b=2*i;key=f'{a}:{b}'
        row={k:'' for k in cols};row.update(annotation_id=ident,feed_a='a',feed_b='b',title_a='a',title_b='b',published_at_a='t',published_at_b='t',label_options=m.LABELS)
        blank.append(row);human.append({**row,'human_decision':'UNCERTAIN'})
        s={'pair_key':key,'article_id_a':a,'article_id_b':b,'component_id':'C','source_pool_rank':i,'lane_primary':'A','lane_membership':['A'],'both_content_usable':True,'title_equivalent_article_present':False}
        selected.append(s);mapping.append({'review_annotation_id':ident,**s})
    return human,blank,mapping,selected
class IngestionTests(unittest.TestCase):
    def setUp(self):self.h,self.b,self.m,self.s=fixture()
    def derive(self):return m.derive(self.h,self.b,self.m,self.s)
    def test_valid_and_replay(self):
        a=self.derive();self.assertEqual(len(a),40);self.assertEqual(a,self.derive());self.assertEqual([x['pair_key'] for x in a],sorted(x['pair_key'] for x in a))
    def test_count_sum(self):self.assertEqual(sum(m.counts(self.derive()).values()),40)
    def test_missing_review(self):self.h.pop();self.assertRaises(ValueError,self.derive)
    def test_duplicate_review(self):self.h[0]['annotation_id']=self.h[1]['annotation_id'];self.assertRaises(ValueError,self.derive)
    def test_metadata(self):self.h[0]['title_a']='changed';self.assertRaises(ValueError,self.derive)
    def test_invalid(self):self.h[0]['human_decision']='INVALID';self.assertRaises(ValueError,self.derive)
    def test_blank(self):self.h[0]['human_decision']='';self.assertRaises(ValueError,self.derive)
    def test_missing_map(self):self.m.pop();self.assertRaises(ValueError,self.derive)
    def test_duplicate_map(self):self.m[0]['review_annotation_id']=self.m[1]['review_annotation_id'];self.assertRaises(ValueError,self.derive)
    def test_duplicate_pair(self):self.m[0]['pair_key']=self.m[1]['pair_key'];self.assertRaises(ValueError,self.derive)
    def test_outside_pack(self):self.m[0]['pair_key']='1001:1002';self.assertRaises(ValueError,self.derive)
    def test_article_mismatch(self):self.m[0]['article_id_a']=999;self.assertRaises(ValueError,self.derive)
    def test_component_mismatch(self):self.m[0]['component_id']='X';self.assertRaises(ValueError,self.derive)
    def test_malformed_key(self):self.s[0]['pair_key']='foo';self.assertRaises(ValueError,self.derive)
    def test_reverse_key(self):self.s[0]['pair_key']='2:1';self.m[0]['pair_key']='2:1';self.assertRaises(ValueError,self.derive)
    def test_reconstruction(self):self.assertEqual(m.blank_bytes(self.h),m.blank_bytes(self.b))
    def test_forbidden_source(self):
        from pathlib import Path
        with m.guard():
            for name in m.FORBIDDEN:
                with self.assertRaises(PermissionError):Path('/tmp',name).read_bytes()
    def test_output_minimal(self):self.assertEqual(set(self.derive()[0]),{'review_annotation_id','pair_key','human_decision'})
if __name__=='__main__':unittest.main()

class FrozenOutputTests(unittest.TestCase):
    def test_freeze_readback_and_no_overwrite(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'artifact';self.assertEqual(m.freeze(p,b'test'),m.sha(b'test'))
            self.assertEqual(p.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):m.freeze(p,b'other')
    def test_input_hash_mismatch(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fixture';p.write_bytes(b'fixture');p.chmod(0o444)
            with patch.object(m,'INPUTS',{p:'0'*64}),self.assertRaises(ValueError):m.verify_inputs()
    def test_manifest_tamper_rejected(self):
        import tempfile,io,csv
        from pathlib import Path
        from unittest.mock import patch
        import validate_fresh_positive_labels as v
        human,blank,mapping,selected=fixture()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);session=root/'session';completion=root/'completion';out=root/'out'
            session.mkdir();completion.mkdir();out.mkdir(mode=0o700);(session/'reviewer').mkdir()
            neutral=m.blank_bytes(blank); (session/'reviewer/neutral-review-v1.csv').write_bytes(neutral)
            stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=m.COLUMNS,lineterminator='\n');writer.writeheader();writer.writerows(human)
            raw=stream.getvalue().encode();(completion/'fresh-positive-human-completed-v1.csv').write_bytes(raw)
            (session/'neutral-review-map-v1.jsonl').write_bytes(b''.join(m.canonical(x) for x in mapping))
            (session/'selected-positive-review-pack-v1.jsonl').write_bytes(b''.join(m.canonical(x) for x in selected))
            labels=b''.join(m.canonical(x) for x in m.derive(human,blank,mapping,selected))
            audit=m.canonical({'class_counts':m.counts(m.derive(human,blank,mapping,selected))})
            for name,data in [('human-completed-input-v1.csv',raw),('fresh-positive-human-labels-v1.jsonl',labels),('fresh-positive-human-label-ingestion-audit-v1.json',audit)]:m.freeze(out/name,data)
            inputs={session/'reviewer/neutral-review-v1.csv':m.sha(neutral)}
            manifest={'completed_sha256':'0'*64,'labels_sha256':m.sha(labels),'audit_sha256':m.sha(audit),'input_sha256':{p.name:h for p,h in inputs.items()}}
            m.freeze(out/'fresh-positive-human-label-ingestion-manifest-v1.json',m.canonical(manifest))
            with patch.object(m,'verify_inputs'),patch.object(m,'COMPLETION',completion),patch.object(m,'SESSION',session),patch.object(m,'INPUTS',inputs):
                with self.assertRaisesRegex(ValueError,'manifest'):v.validate(out)
    def test_replay_is_byte_identical(self):
        h,b,mp,s=fixture()
        one=b''.join(m.canonical(x) for x in m.derive(h,b,mp,s))
        two=b''.join(m.canonical(x) for x in m.derive(h,b,mp,s))
        self.assertEqual(one,two)
