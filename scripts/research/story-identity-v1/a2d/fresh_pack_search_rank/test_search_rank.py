import unittest
import search_rank as s

class RankTests(unittest.TestCase):
    def test_historical_desc_ties_and_formula(self):
        rows = [dict(pair_key='1:2', qwen_score='0.5', mistral_score='0.9', qwen_rank='2', mistral_rank='1', best_rank='1', rank_sum='3'), dict(pair_key='1:3', qwen_score='0.5', mistral_score='0.1', qwen_rank='1', mistral_rank='2', best_rank='1', rank_sum='3')]
        result = s.historical(rows)
        self.assertEqual(result['qwen_tie_direction'], 'desc')
        self.assertEqual(result['frontier'], 2)
        rows[0]['rank_sum'] = '4'
        with self.assertRaises(ValueError): s.historical(rows)

    def test_fresh_order_ceiling_and_exact_join(self):
        ranks = s.rank([('b', .5), ('a', .5), ('c', .8)])
        self.assertEqual([(r['pair_key'], r['search_rank_v2']) for r in ranks], [('c',1),('a',2),('b',3)])
        self.assertEqual(s.ceiling(2, 3, 10), 7)
        joined = s.join([{'pair_key':'a', 'qwen_score':.5}], ranks)
        self.assertEqual(joined[0]['search_rank_v2'], 2)
        with self.assertRaises(ValueError): s.join([{'pair_key':'missing'}], ranks)

    def test_replay_and_nonfinite_rejection(self):
        pairs = [('a', .25), ('b', .25), ('c', .6)]
        self.assertEqual(s.rank(pairs), s.rank(list(reversed(pairs))))
        with self.assertRaises(ValueError): s.rank([('a', float('nan'))])

    def test_historical_rank_base_rejected(self):
        rows = [dict(pair_key='a', qwen_score='0.5', mistral_score='0.9', qwen_rank='0', mistral_rank='1', best_rank='0', rank_sum='1')]
        with self.assertRaises(ValueError): s.historical(rows)

    def test_historical_score_mismatch_rejected(self):
        rows = [dict(pair_key='a', qwen_score='0.9', mistral_score='0.9', qwen_rank='2', mistral_rank='1', best_rank='1', rank_sum='3'), dict(pair_key='b', qwen_score='0.1', mistral_score='0.1', qwen_rank='1', mistral_rank='2', best_rank='1', rank_sum='3')]
        with self.assertRaises(ValueError): s.historical(rows)

    def test_diagnostics_uses_two_edge_seeds(self):
        rows = [dict(search_rank_v2=i, article_a_id=a, article_b_id=b, feed_a_id=a, feed_b_id=b, primary_bucket='x') for i, (a,b) in enumerate([(1,2),(2,3),(3,4)],1)]
        d = s.diagnostics(rows, 3)
        self.assertEqual(d['chain_seeds'], 2)
        self.assertEqual(d['buckets'], {'x': 3})

    def test_rank_duplicate_rejected(self):
        with self.assertRaises(ValueError): s.rank([('a',.1),('a',.2)])

if __name__ == '__main__': unittest.main()

class PrivateBoundaryTests(unittest.TestCase):
    def test_private_guard_and_frozen_readback(self):
        import hashlib
        import tempfile
        from pathlib import Path
        import produce
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'private'
            root.mkdir()
            target = root / 'attempt'
            produce.validate_private_destination(target, root)
            with self.assertRaises(ValueError):
                produce.validate_private_destination(root.parent / 'outside', root)
            content = b'synthetic data'
            hashes = produce.write_frozen(target, {'synthetic.json': content}, True)
            self.assertEqual(hashes['synthetic.json'], hashlib.sha256(content).hexdigest())
            self.assertEqual((target / 'synthetic.json').stat().st_mode & 0o777, 0o444)
            with self.assertRaises(ValueError):
                produce.write_frozen(root / 'invalid', {'x': content}, False)

    def test_input_hash_guard_fails_before_derivation(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import produce
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.write_bytes(b'synthetic')
            with patch.object(produce, 'ROOT', root), patch.object(produce, 'INPUTS', {source: '0' * 64}):
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    produce.main(root / 'new')
                self.assertFalse((root / 'new').exists())

    def test_prospective_execution_has_no_inference_dependency(self):
        from pathlib import Path
        text = (Path(__file__).parent / 'produce.py').read_text()
        self.assertNotIn('import ollama', text)
        self.assertNotIn('requests.post', text)
        self.assertNotIn('mistral_score', text)
