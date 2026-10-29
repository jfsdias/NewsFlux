import itertools
import unittest
import select_expansion_pack as s


def row(a,b,priority):
    return {'a':a,'b':b,'qwen':100-priority,'support':1,'lexical':0.1,'gap':1}

class ExactKProof(unittest.TestCase):
    def test_brute_force_small_graphs(self):
        all_edges=list(itertools.combinations(range(1,6),2))
        for mask in range(1,1<<len(all_edges)):
            edges=[row(a,b,i) for i,(a,b) in enumerate(all_edges) if mask & (1<<i)]
            for k in (1,2):
                choices=[]
                for indices in itertools.combinations(range(len(edges)),k):
                    ids=[x for i in indices for x in (edges[i]['a'],edges[i]['b'])]
                    if len(set(ids))==2*k:choices.append(tuple(i+1 for i in indices))
                if not choices:
                    with self.assertRaises(ValueError):s.select(edges,k)
                else:
                    selected,ranks,_=s.select(edges,k)
                    self.assertEqual(tuple(ranks),min(choices))
                    self.assertEqual(len({n for e in selected for n in (e['a'],e['b'])}),2*k)
                    self.assertEqual(ranks,s.select(list(reversed(edges)),k)[1])
    def test_rejects_greedy_trap(self):
        edges=[row(1,2,0),row(1,3,1),row(2,4,2)]
        self.assertEqual(s.select(edges,2)[1],[2,3])
    def test_rank_tie_uses_numeric_ids(self):
        edges=[row(10,20,0),row(2,3,0)]
        self.assertEqual([x['a'] for x in s.select(edges,2)[0]],[2,10])
    def test_duplicate_and_invalid_endpoints(self):
        for edges in ([row(1,2,0),row(1,2,1)],[row(1,1,0)],[row(2,1,0)]):
            with self.assertRaises(ValueError):s.select(edges,1)
    def test_capacity_only_oracle(self):
        from unittest.mock import patch
        import exact_k_matching
        edges=[row(1,2,0),row(3,4,1)]
        original=exact_k_matching.capacity
        with patch.object(exact_k_matching,'capacity',side_effect=lambda value:original(list(reversed(value)))):
            self.assertEqual(s.select(edges,2)[1],[1,2])
