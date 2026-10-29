import unittest
import expansion_frontier as e

class SyntheticTests(unittest.TestCase):
    def test_quantile_interpolation(self): self.assertEqual(e.quantile([0,10], .7), 7)
    def test_thresholds_and_union(self):
        q={'.6':.6,'.7':.7,'.8':.8}
        x={'qwen':.85,'support':2,'lexical':.06,'entity':1,'number':0,'date':0}
        self.assertEqual(e.memberships(x,q), {'B1','B2','B3','B5'})
        x.update(lexical=.01,support=1)
        self.assertEqual(e.memberships(x,q), {'B4','B5'})
        x.update(qwen=.65,support=2)
        self.assertEqual(e.memberships(x,q), {'B2','B5'})
        x.update(entity=0)
        self.assertEqual(e.memberships(x,q), set())
    def test_rank(self):
        def r(a,b,q,s,l,t):return dict(a=a,b=b,qwen=q,support=s,lexical=l,gap=t)
        rows=[r(3,4,.8,2,.1,2),r(1,2,.8,2,.1,2),r(5,6,.9,0,0,0)]
        self.assertEqual([x['a'] for x in sorted(rows,key=e.rank)], [5,1,3])
    def test_metrics_and_exact_matching(self):
        rows=[dict(a=a,b=b,feed=(1,2),category=('a','b'),equiv=False) for a,b in [(1,2),(2,3),(3,4),(5,6)]]
        m=e.metrics(rows)
        self.assertEqual((m['components'],m['matching']), (2,3))
        self.assertFalse(e.closure(4));self.assertTrue(e.closure(5))
    def test_exclusion(self):
        self.assertFalse(e.eligible_ids(1,2,{2},{'1:2'}));self.assertTrue(e.eligible_ids(3,4,{2},{'3:4'}))
    def test_family_incomparable(self): self.assertFalse(e.comparable('B3','B4'));self.assertFalse(e.comparable('B0','B5'))
    def test_path_and_network_firewall(self):
        import socket
        from pathlib import Path
        with e.firewall({Path('/private/tmp/allowed-d2f6')}):
            for p in ('/private/tmp/d2f5/fresh-positive-human-labels-v1.jsonl','/private/tmp/d2f5/stratified.json','/private/tmp/blind-human-labels.jsonl','/private/tmp/human-completed.csv'):
                with self.assertRaises(PermissionError):open(p)
            with self.assertRaises(PermissionError):socket.create_connection(('example.invalid',80))
            with self.assertRaises(FileNotFoundError):open('/private/tmp/allowed-d2f6')

class PredicateTests(unittest.TestCase):
    def setUp(self):
        self.q={'.6':.6,'.7':.7,'.8':.8}
        self.row={'qwen':.8,'support':2,'lexical':.05,'entity':0,'number':1,'date':0}
    def test_b1_requires_support_and_threshold(self):
        self.assertIn('B1',e.memberships(self.row,self.q))
        for k,v in [('support',1),('qwen',.69)]:
            row=dict(self.row,**{k:v});self.assertNotIn('B1',e.memberships(row,self.q))
    def test_b2_requires_anchor(self):
        row=dict(self.row,qwen=.6,number=0)
        self.assertNotIn('B2',e.memberships(row,self.q))
        row['date']=1;self.assertIn('B2',e.memberships(row,self.q))
    def test_b3_lexical_boundary(self):
        self.assertIn('B3',e.memberships(self.row,self.q))
        self.assertNotIn('B3',e.memberships(dict(self.row,lexical=.049),self.q))
    def test_b4_and_support(self):
        row=dict(self.row,lexical=.049,support=1)
        self.assertIn('B4',e.memberships(row,self.q))
        self.assertNotIn('B4',e.memberships(dict(row,support=0),self.q))
    def test_membership_union_deduplicates(self):
        values=e.memberships(self.row,self.q);self.assertEqual(list(values).count('B5'),1)
    def test_universe_gate(self):self.assertFalse(e.eligible_ids(1,2,set(),{'1:3'}))
    def test_firewall_rejects_forbidden_even_if_allowlisted(self):
        from pathlib import Path
        bad=Path('/private/tmp/p4-fresh-positive-gate-analysis/stratified.json')
        with e.firewall({bad}):
            with self.assertRaises(PermissionError):open(bad)

class DisclosureTests(unittest.TestCase):
    def test_reject_identity_title_content(self):
        empty=e.metrics([])
        for key in ('pair_key','article_id','review_id','title','url','content'):
            with self.assertRaises(ValueError):e.safe_metrics(dict(empty, **{key:'private'}))
        self.assertEqual(e.safe_metrics(empty),empty)
    def test_allow_neutral_selected_pack(self):
        from pathlib import Path
        allowed=Path('/private/tmp/selected-positive-review-pack-v1.jsonl')
        with e.firewall({allowed}):
            with self.assertRaises(FileNotFoundError):open(allowed)
    def test_deny_model_imports(self):
        import ast
        from pathlib import Path
        tree=ast.parse(Path(e.__file__).read_text())
        modules={node.module for node in ast.walk(tree) if isinstance(node,ast.ImportFrom)} | {a.name for node in ast.walk(tree) if isinstance(node,ast.Import) for a in node.names}
        self.assertFalse(modules & {'openai','transformers','torch','requests'})


class QuantileRegression(unittest.TestCase):
    def test_independent_q60_float_evaluation_matches_preregistered_order(self):
        import validate_expansion_frontier as validator
        scores=[0.00,0.01,0.02,0.03]
        self.assertEqual(validator.independent_quantile(scores,60),e.quantile(scores,.6))
