import copy
import unittest
import build_positive_candidate_pool as pool
import validate_positive_candidate_pool as validation


def feature(a,b,score,lex=0.1,ent=1,num=0,date=0,hours=2):
    return {'article_a_id':a,'article_b_id':b,'pair_key':f'{min(a,b)}:{max(a,b)}','qwen_score':score,'lexical_overlap':lex,'entity_anchor_overlap':ent,'number_overlap':num,'date_overlap':date,'temporal_delta_hours':hours,'feed_a_id':a,'feed_b_id':b,'category_a':'x','category_b':'y'}


class PositivePoolTests(unittest.TestCase):
    def test_canonical_identity(self):
        self.assertEqual(pool.key(9,2),'2:9')
        with self.assertRaises(ValueError):pool.key(1,1)

    def test_rank_and_lane_determinism(self):
        items=[feature(1,2,.8),feature(3,4,.9),feature(5,6,.7)]
        capabilities={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,7)}
        a=pool.build(items,{},capabilities,set(),set());b=pool.build(list(reversed(items)),{},capabilities,set(),set())
        self.assertEqual(a,b)
        self.assertTrue(all('human_decision' not in r for r in a))

    def test_article_and_pair_exclusion_are_strict(self):
        items=[feature(1,2,.9),feature(3,4,.9),feature(5,6,.9)]
        cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,7)}
        rows=pool.build(items,{},cap,{1},{'3:4'})
        self.assertEqual({r['pair_key'] for r in rows},{'5:6'})

    def test_content_eligibility_and_title_equivalence(self):
        cap={1:{'content_status':'USABLE','content_equals_title':True},2:{'content_status':'USABLE','content_equals_title':False},3:{'content_status':'EMPTY_AFTER_NORMALIZATION','content_equals_title':False},4:{'content_status':'USABLE','content_equals_title':False}}
        rows=pool.build([feature(1,2,.9),feature(3,4,.9)],{},cap,set(),set())
        self.assertEqual(len(rows),1);self.assertTrue(rows[0]['title_equivalent_article_present']);self.assertTrue(rows[0]['effective_content_gain_possible'])

    def test_exact_matching_not_greedy(self):
        edges=[{'pair_key':'1:2','article_id_a':1,'article_id_b':2,'deterministic_rank':1},{'pair_key':'1:3','article_id_a':1,'article_id_b':3,'deterministic_rank':2},{'pair_key':'2:4','article_id_a':2,'article_id_b':4,'deterministic_rank':3}]
        self.assertEqual(len(pool.maximum_matching(edges)),2)

    def test_validator_rejects_overlap_and_tampered_ranking(self):
        rows=[feature(1,2,.9),feature(3,4,.8)];cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,5)}
        result=pool.build(rows,{},cap,set(),set()); validation.validate(rows,{},cap,set(),set(),result)
        with self.assertRaises(ValueError):validation.validate(rows,{},cap,{1},set(),result)
        altered=copy.deepcopy(result);altered[0]['deterministic_rank']=99
        with self.assertRaises(ValueError):validation.validate(rows,{},cap,set(),set(),altered)

    def test_independent_frontier_rejects_tampering(self):
        rows=[feature(1,2,.9),feature(3,4,.9),feature(5,6,.9)]
        cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,7)}
        output=pool.build(rows,{},cap,set(),set())
        front=pool.frontier(output,3,3,3); validation.validate_frontier(output,front,3,3,3)
        altered=copy.deepcopy(front);altered['max_article_disjoint_pair_count']+=1
        with self.assertRaises(ValueError):validation.validate_frontier(output,altered,3,3,3)

    def test_quantile_and_nonfinite_protection(self):
        self.assertEqual(pool.quantile([1,2,3,4],.75),3.25)
        bad=feature(1,2,float('nan'));cap={i:{'content_status':'USABLE','content_equals_title':False} for i in (1,2)}
        with self.assertRaises(ValueError):pool.build([bad],{},cap,set(),set())

    def test_both_title_equivalent_remain_in_pool(self):
        cap={i:{'content_status':'USABLE','content_equals_title':True} for i in (1,2)}
        output=pool.build([feature(1,2,.9)],{},cap,set(),set())
        self.assertEqual(len(output),1);self.assertFalse(output[0]['effective_content_gain_possible'])

    def test_forbidden_label_fields_are_rejected(self):
        x=feature(1,2,.9);x['human_decision']='synthetic'
        with self.assertRaises(ValueError):pool.build([x],{},{},set(),set())

    def test_each_existing_identity_set_is_enforced(self):
        allrows=[feature(1,2,.9),feature(3,4,.9),feature(5,6,.9),feature(7,8,.9)]
        cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,9)}
        result=pool.build(allrows,{},cap,{1,3,5},{'1:2','3:4','5:6'})
        self.assertEqual([x['pair_key'] for x in result],['7:8'])
        with self.assertRaises(ValueError):validation.validate(allrows,{},cap,{1,3,5,7},{'1:2','3:4','5:6'},result)

    def test_all_four_lanes_are_registered_and_distinct(self):
        rows=[feature(1,2,.9,lex=.1,ent=1),feature(3,4,.9,lex=.2,ent=1),feature(5,6,.9,lex=.01,ent=0,num=1),feature(7,8,.9,lex=.01,ent=1)]
        graph={'3:4':{'shared_support_feed_count':2},'5:6':{'shared_support_feed_count':1}}
        cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,9)}
        output=pool.build(rows,graph,cap,set(),set())
        observed={lane for row in output for lane in row['lane_membership']}
        self.assertEqual(observed,set(pool.LANES))
        validation.validate(rows,graph,cap,set(),set(),output)

    def test_review_feasibility_is_not_assumed(self):
        cap={i:{'content_status':'USABLE','content_equals_title':False} for i in range(1,5)}
        output=pool.build([feature(1,2,.9),feature(3,4,.9)],{},cap,set(),set())
        front=pool.frontier(output,2,2,2)
        self.assertFalse(front['review_options']['40']['article_disjoint_feasible'])
        self.assertFalse(front['review_options']['80']['article_disjoint_feasible'])
        validation.validate_frontier(output,front,2,2,2)

    def test_firewall_blocks_network_and_forbidden_files(self):
        import run_positive_pool as run
        import socket
        from pathlib import Path
        with run.firewall():
            with self.assertRaises(PermissionError):Path('blind-human-labels-sealed-v1.jsonl').read_text()
            with self.assertRaises(PermissionError):Path('source-payloads/example.bin').read_bytes()
            with self.assertRaises(PermissionError):socket.create_connection(('example.test',80))

    def test_contract_mutation_rejected(self):
        import run_positive_pool as run
        import json
        contract=json.loads(run.CONTRACT.read_text());run.validate_contract(contract)
        for key,bad in [('blind_access',True),('model_inference',True),('quantile_policy','unregistered')]:
            value=copy.deepcopy(contract);value[key]=bad
            with self.subTest(key=key),self.assertRaises(ValueError):run.validate_contract(value)

    def test_private_freeze_refuses_overwrite(self):
        import run_positive_pool as run
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'artifact';run.freeze(p,b'synthetic')
            self.assertEqual(p.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):run.freeze(p,b'new')


if __name__=='__main__':unittest.main()
