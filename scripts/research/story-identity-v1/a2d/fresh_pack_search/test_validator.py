import unittest
from copy import deepcopy
import validator as v


def fixture():
    buckets = [name for name, count in v.BLIND.items() for _ in range(count)]
    edges = []
    groups = []
    for comp in range(6):
        base = 100 * comp + 1
        pairs = [(base+i, base+j) for i in range(4) for j in range(i+1,4)]
        if comp < 4: pairs.append((base, base+4))
        groups.append([f'{base}:{base+1}', f'{base+1}:{base+2}'])
        edges += pairs
    edges += [(1000+2*i,1001+2*i) for i in range(8)]
    def row(pair, bucket):
        a,b = pair
        return dict(pair_key=f'{a}:{b}', article_a_id=a, article_b_id=b, feed_a_id=a, feed_b_id=b,
                    category_a=str(a%2),category_b=str(b%2),primary_bucket=bucket, search_rank_v2=1)
    blind = [row(p,b) for p,b in zip(edges,buckets)]
    cats = {a: str(i%2) for i,a in enumerate(sorted({x for p in edges for x in p}))}
    for r in blind: r['category_a']=cats[r['article_a_id']]; r['category_b']=cats[r['article_b_id']]
    db = [name for name, count in v.DEV.items() for _ in range(count)]
    dev = [row((3000+2*i,3001+2*i),b) for i,b in enumerate(db)]
    return dev,blind,groups

class ValidatorTests(unittest.TestCase):
    def test_synthetic_witness_and_chain_only_rank(self):
        dev,blind,groups=fixture()
        designated={x for g in groups for x in g}
        for r in blind:
            if r['pair_key'] not in designated: r['search_rank_v2']=99999
        self.assertEqual(v.validate(dev,blind,groups)['chains'],6)
    def test_missing_quota_rejected(self):
        dev,blind,groups=fixture()
        with self.assertRaises(ValueError): v.validate(dev,blind[:-1],groups)
    def test_mutated_rank_rejected(self):
        dev,blind,groups=fixture()
        next(r for r in blind if r['pair_key']==groups[0][0])['search_rank_v2']=15037
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_overlap_rejected(self):
        dev,blind,groups=fixture()
        dev[0]['article_a_id']=blind[0]['article_a_id']
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_chain_shape_rejected(self):
        dev,blind,groups=fixture(); groups[0]=[groups[0][0],groups[1][0]]
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_category_dominance_rejected(self):
        dev,blind,groups=fixture()
        for r in dev: r['category_a']=r['category_b']='same'
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)

if __name__=='__main__': unittest.main()

class SearchAndOutputTests(unittest.TestCase):
    def test_search_frontier_keeps_non_chain_candidates(self):
        import search
        dev,blind,_=fixture()
        for row in blind: row['search_rank_v2']=20000
        pool=search.frontier(blind,2,100)
        self.assertEqual(len(pool),48)
        self.assertEqual(pool,search.frontier(list(reversed(blind)),2,100))
    def test_feed_share_rejected(self):
        dev,blind,groups=fixture()
        for row in dev: row['feed_a_id']=1
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_source_pair_share_rejected(self):
        dev,blind,groups=fixture()
        for row in dev[:9]: row['feed_a_id']=5; row['feed_b_id']=6
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_duplicate_chain_rejected(self):
        dev,blind,groups=fixture();groups[1]=groups[0][:]
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_valid_reviewer_is_blinded_and_deterministic(self):
        import csv,io
        import finalize
        dev,_,_=fixture()
        corpus={i:{'title':'synthetic','feed_title':'synthetic','published_at':'2026-01-01T00:00:00Z'} for r in dev for i in v.vertices(r)}
        a=finalize.reviewer(dev,corpus); b=finalize.reviewer(dev,corpus)
        self.assertEqual(a,b)
        rows=list(csv.DictReader(io.StringIO(a.decode())))
        self.assertEqual(tuple(rows[0]),finalize.COLUMNS)
        self.assertTrue(all(not r['human_decision'] for r in rows))
    def test_private_guard_and_mode(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import finalize
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'private';root.mkdir()
            with patch.object(finalize,'PRIVATE',root):
                with self.assertRaises(ValueError): finalize.freeze(Path(temp)/'outside',{'x':b'synthetic'})
                hashes=finalize.freeze(root/'good',{'dev/a':b'synthetic'})
                self.assertEqual(hashes['dev/a'],finalize.sha(b'synthetic'))
                self.assertEqual((root/'good/dev/a').stat().st_mode & 0o777,0o444)

class MutationTests(unittest.TestCase):
    def test_pair_and_article_disjoint(self):
        dev,blind,groups=fixture(); dev[0]=deepcopy(blind[0]); dev[0]['primary_bucket']='POSITIVE_SEEKING'
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_bridge_between_designated_groups_rejected(self):
        dev,blind,groups=fixture()
        row=blind[-1]; row.update(pair_key='1:101',article_a_id=1,article_b_id=101,
                                   feed_a_id=1,feed_b_id=101,category_a='0',category_b='1')
        with self.assertRaises(ValueError): v.validate(dev,blind,groups)
    def test_no_historical_article_overlap(self):
        dev,blind,groups=fixture()
        with self.assertRaisesRegex(ValueError,'historical overlap'): v.validate(dev,blind,groups,historical_articles={dev[0]['article_a_id']})
    def test_no_historical_pair_overlap(self):
        dev,blind,groups=fixture()
        with self.assertRaisesRegex(ValueError,'historical overlap'): v.validate(dev,blind,groups,historical_pairs={blind[0]['pair_key']})
    def test_temporal_limit(self):
        dev,blind,groups=fixture();blind[0]['temporal_delta_hours']=24.01
        with self.assertRaisesRegex(ValueError,'temporal'): v.validate(dev,blind,groups)
    def test_exact_provenance(self):
        dev,blind,groups=fixture(); universe={r['pair_key']:deepcopy(r) for r in dev+blind}
        self.assertEqual(v.validate(dev,blind,groups,universe=universe)['chains'],6)
        blind[0]['search_rank_v2']=2
        with self.assertRaisesRegex(ValueError,'provenance'): v.validate(dev,blind,groups,universe=universe)

class ComponentTests(unittest.TestCase):
    @staticmethod
    def replace_last(blind,a,b):
        row=blind[-1];row.update(pair_key=f'{a}:{b}',article_a_id=a,article_b_id=b,feed_a_id=a,feed_b_id=b)
        articles=sorted({x for r in blind for x in v.vertices(r)})
        cats={x:str(i%3) for i,x in enumerate(articles)}
        for r in blind:
            r['category_a']=cats[r['article_a_id']];r['category_b']=cats[r['article_b_id']]
    def test_component_max_pairs_rejected(self):
        dev,blind,groups=fixture();self.replace_last(blind,1,101)
        with self.assertRaisesRegex(ValueError,'components'):v.validate(dev,blind,groups)
    def test_independent_minimum_rejected(self):
        dev,blind,groups=fixture();self.replace_last(blind,1,5000)
        with self.assertRaisesRegex(ValueError,'components'):v.validate(dev,blind,groups)
    def test_blind_exact_quota_rejected(self):
        dev,blind,groups=fixture();blind[0]['primary_bucket']='DIVERSITY_CONTROL'
        with self.assertRaisesRegex(ValueError,'quota'):v.validate(dev,blind,groups)
    def test_six_chains_required(self):
        dev,blind,groups=fixture()
        with self.assertRaisesRegex(ValueError,'chain count'):v.validate(dev,blind,groups[:5])
