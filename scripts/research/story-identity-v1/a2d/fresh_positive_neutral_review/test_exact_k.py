import itertools
import random
import unittest
from exact_k_matching import exact_k_matching

def row(a,b,r): return {'article_id_a':a,'article_id_b':b,'deterministic_rank':r,'pair_key':f'{min(a,b)}:{max(a,b)}'}
def brute(edges,k):
    candidates=[]
    for subset in itertools.combinations(edges,k):
        vertices=[v for e in subset for v in (e['article_id_a'],e['article_id_b'])]
        if len(vertices)==len(set(vertices)): candidates.append(tuple(sorted(e['deterministic_rank'] for e in subset)))
    if not candidates: raise ValueError('infeasible')
    return min(candidates)
def ranks(edges,k): return tuple(e['deterministic_rank'] for e in exact_k_matching(edges,k)[0])
class ExactKTests(unittest.TestCase):
    def test_truncation_counterexample(self):
        e=[row(1,2,1),row(3,4,2),row(1,3,3),row(2,5,4),row(4,6,5)]
        self.assertEqual(ranks(e,2),(1,2));self.assertEqual(ranks(e,3),(3,4,5))
    def test_exhaustive_small_graphs(self):
        random.seed(1042)
        for n in range(2,7):
            all_edges=list(itertools.combinations(range(1,n+1),2))
            for _ in range(35):
                es=random.sample(all_edges,random.randrange(len(all_edges)+1));random.shuffle(es)
                rows=[row(a,b,i+1) for i,(a,b) in enumerate(es)]
                for k in range(n//2+1):
                    try: expected=brute(rows,k)
                    except ValueError:
                        with self.assertRaises(ValueError): exact_k_matching(rows,k)
                    else: self.assertEqual(ranks(rows,k),expected)
    def test_permutations(self):
        edges=[row(1,2,1),row(2,3,2),row(3,4,3),row(4,1,4),row(5,6,5)]
        expected=ranks(edges,2)
        for _ in range(50):
            random.shuffle(edges); self.assertEqual(ranks(edges,2),expected)
    def test_invalid(self):
        for edges in ([row(1,1,1)],[row(1,2,1),row(2,1,2)],[row(1,2,1),row(3,4,1)]):
            with self.assertRaises(ValueError): exact_k_matching(edges,1)
        with self.assertRaises(ValueError): exact_k_matching([row(1,2,1)],2)
        with self.assertRaises(ValueError): exact_k_matching([], -1)
    def test_disjoint_and_empty(self):
        self.assertEqual(ranks([],0),())
        edges=[row(1,2,1),row(2,3,2),row(4,5,3)]
        result,_=exact_k_matching(edges,2)
        self.assertEqual(len({v for e in result for v in (e['article_id_a'],e['article_id_b'])}),4)
if __name__=='__main__':unittest.main()

class StaticGuardTests(unittest.TestCase):
    def test_no_truncated_maximum_matching(self):
        import ast
        from pathlib import Path
        tree=ast.parse(Path(__file__).with_name('exact_k_matching.py').read_text())
        for node in ast.walk(tree):
            if isinstance(node,ast.Subscript) and isinstance(node.value,ast.Call):
                self.assertNotIn('max_weight_matching',ast.unparse(node.value))
