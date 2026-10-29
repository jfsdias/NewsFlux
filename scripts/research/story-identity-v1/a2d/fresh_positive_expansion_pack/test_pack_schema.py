import itertools
import unittest
import run_pack_freeze as r
import validate_expansion_pack as v


def synthetic_source():
    original=[(i,i+1) for i in range(1,23,2)]
    extra=[(1,23),(1,24),(1,25)]
    for pair in itertools.combinations(range(1,23),2):
        if pair not in original and pair not in extra and len(extra)<25:extra.append(pair)
    rows=[{'a':a,'b':b,'qwen':.5-i/1000,'support':2,'lexical':.1,'gap':1,'strategy_membership':['B1','B5'],'feed':[1,2],'category':['some textual category','another']} for i,(a,b) in enumerate(original+extra)]
    frontier={'strategies':{'B1':{'pairs':36,'articles':25,'matching':11,'logical_capacity_gate':True,'QWEN_THRESHOLD_USED':0.2297840754548002,'QWEN_THRESHOLD_POLICY':{'kind':'DIRECT_RESIDUAL_QUANTILE','quantile_id':'Q70'}}}}
    return rows,frontier,set(),{'rank':'synthetic'}

class PackSchemaRegression(unittest.TestCase):
    def test_text_category_is_rejected(self):
        src=synthetic_source()
        selected,proof,audit=r.generate(*src)
        selected[0]['category_pair']=['some textual category','another']
        with self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):
            v.validate(*src[:3],selected,proof,audit)

class SchemaCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows,cls.proof,cls.audit=r.generate(*synthetic_source())
    def test_exact_schema_accepts_correct_pack(self):v.validate_schema(self.rows)
    def test_extra_fields_all_rejected(self):
        import copy
        for key,value in [('category','text'),('category_pair',['text','text']),('category_id',3),('feed',8),('title','x'),('url','x'),('content','x'),('human_decision','x'),('review_id','x'),('annotation_id','x'),('unexpected','x')]:
            rows=copy.deepcopy(self.rows);rows[0][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):v.validate_schema(rows)
    def test_missing_bool_nonfinite_and_membership(self):
        import copy
        mutations=[('qwen_score',True),('qwen_score',float('inf')),('lexical_overlap',float('nan')),('supporting_feed_count',True),('strategy_membership',['B5']),('strategy_membership',['B1','B1']),('selection_position',2)]
        for key,value in mutations:
            rows=copy.deepcopy(self.rows);rows[0][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):v.validate_schema(rows)
        rows=copy.deepcopy(self.rows);del rows[0]['b1_rank']
        with self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):v.validate_schema(rows)
    def test_duplicate_pair_or_article_overlap_rejected(self):
        import copy
        for duplicate in (True,False):
            rows=copy.deepcopy(self.rows)
            rows[1]['article_id_a']=rows[0]['article_id_a']
            if duplicate:rows[1]['article_id_b']=rows[0]['article_id_b']
            rows[1]['pair_key']=f"{rows[1]['article_id_a']}:{rows[1]['article_id_b']}"
            with self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):v.validate_schema(rows)
    def test_identity_and_rank_projection(self):
        import copy
        newer=copy.deepcopy(self.rows);old=copy.deepcopy(newer)
        for row in old:row['category_pair']=['synthetic','category']
        keys=('selection_position','b1_rank','pair_key','article_id_a','article_id_b')
        self.assertEqual([[x[k] for k in keys] for x in old],[[x[k] for k in keys] for x in newer])
        self.assertEqual([x['b1_rank'] for x in old],[x['b1_rank'] for x in newer])
        with self.assertRaisesRegex(ValueError,'PRIVATE_SELECTED_PACK_SCHEMA'):v.validate_schema(old)
