import copy
import unittest
import freeze_core as f

def fixture():
    visible=[];completed=[];mapping=[];selected=[]
    for i in range(11):
        rid=f'R{i+1:03}';a=2*i+1;b=a+1
        base={'review_id':rid,'left_title':f'left {i}','left_source':'s','left_published_at':'t','right_title':f'right {i}','right_source':'s','right_published_at':'t','human_decision':''}
        visible.append(base);completed.append(dict(base,human_decision='UNCERTAIN'))
        mapping.append({'review_id':rid,'pair_key':f'{a}:{b}','article_id_a':a,'article_id_b':b,'left_article_id':a,'right_article_id':b,'selection_position':i+1,'b1_rank':i+1})
        selected.append({'pair_key':f'{a}:{b}','article_id_a':a,'article_id_b':b,'selection_position':i+1,'b1_rank':i+1})
    return completed,visible,mapping,selected

class FreezeTests(unittest.TestCase):
    def setUp(self):self.args=fixture()
    def test_valid_and_replay(self):
        self.assertEqual(f.restore(*self.args),f.restore(*copy.deepcopy(self.args)))
        self.assertEqual(len(f.restore(*self.args)),11)
    def test_invalid_decisions(self):
        for x in ('','UNKNOWN',' same_event '):
            a=copy.deepcopy(self.args);a[0][0]['human_decision']=x
            with self.assertRaises(ValueError):f.restore(*a)
    def test_mutated_metadata(self):
        for k in ('left_title','left_source','left_published_at','right_title','right_source','right_published_at'):
            a=copy.deepcopy(self.args);a[0][0][k]+='x'
            with self.subTest(k=k),self.assertRaises(ValueError):f.restore(*a)
        a=copy.deepcopy(self.args);a[0][0]['left_title'],a[0][0]['right_title']=a[0][0]['right_title'],a[0][0]['left_title']
        with self.assertRaises(ValueError):f.restore(*a)
    def test_schema_and_ids(self):
        for mode in ('extra','missing','duplicate','order'):
            a=copy.deepcopy(self.args)
            if mode=='extra':a[0][0]['extra']='x'
            if mode=='missing':del a[0][0]['left_title']
            if mode=='duplicate':a[0][1]['review_id']=a[0][0]['review_id']
            if mode=='order':a[0][0],a[0][1]=a[0][1],a[0][0]
            with self.subTest(mode=mode),self.assertRaises(ValueError):f.restore(*a)
    def test_map_and_selected_mismatch(self):
        for mode in ('duplicate_review','duplicate_pair','substitution','orientation'):
            a=copy.deepcopy(self.args)
            if mode=='duplicate_review':a[2][1]['review_id']=a[2][0]['review_id']
            if mode=='duplicate_pair':a[2][1]['pair_key']=a[2][0]['pair_key']
            if mode=='substitution':a[3][0]['pair_key']='900:901'
            if mode=='orientation':a[2][0]['left_article_id']=999
            with self.subTest(mode=mode),self.assertRaises(ValueError):f.restore(*a)
    def test_privacy_audit_receipt(self):
        with self.assertRaises(ValueError):f.validate_governance({'SAME_EVENT_count':1},{'distribution_computed':False})
        with self.assertRaises(ValueError):f.validate_governance({'row_count':11},{'distribution_computed':True})

class AdditionalTests(unittest.TestCase):
    def test_exact_csv_columns_and_bytes(self):
        import csv,io
        rows,*_=fixture();out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=f.COLUMNS,lineterminator='\n');w.writeheader();w.writerows(rows);data=out.getvalue().encode()
        self.assertEqual(f.parse_csv(data),rows)
        with self.assertRaises(ValueError):f.parse_csv(data.replace(b'review_id,',b'bad,'))
        with self.assertRaises(ValueError):f.parse_csv(data.replace(b'human_decision\n',b'human_decision,extra\n'))
        with self.assertRaises(ValueError):f.verify_hash(data+b'x',f.sha(data),len(data))
    def test_fingerprint_detects_mapping_mutation(self):
        _,visible,mapping,_=fixture();baseline=f.fingerprints(visible,mapping)
        modified=copy.deepcopy(mapping);modified[0]['left_article_id']=999
        self.assertNotEqual(baseline[1],f.fingerprints(visible,modified)[1])
    def test_restored_schema_rejects_extra_and_title(self):
        rows=f.restore(*fixture());f.validate_restored(rows)
        for field in ('extra','title','source'):
            changed=copy.deepcopy(rows);changed[0][field]='x'
            with self.assertRaises(ValueError):f.validate_restored(changed)
    def test_missing_and_wrong_mapping_ids(self):
        for mode in ('missing','wrong'):
            args=copy.deepcopy(fixture())
            if mode=='missing':args[2].pop()
            else:args[2][0]['review_id']='R999'
            with self.assertRaises(ValueError):f.restore(*args)
