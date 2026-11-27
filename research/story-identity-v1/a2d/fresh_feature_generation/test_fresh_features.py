import importlib.util
import pathlib
import unittest
import tempfile
import sys

spec = importlib.util.spec_from_file_location('fresh_features', pathlib.Path(__file__).with_name('fresh_features.py'))
p2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p2)


class FreshFeatureTest(unittest.TestCase):
    def test_pair_validation_rejects_duplicate_and_same_feed(self):
        corpus = {1: {'feed_id': 1, 'published_at': '2026-01-01T00:00:00Z'},
                  2: {'feed_id': 2, 'published_at': '2026-01-01T01:00:00Z'},
                  3: {'feed_id': 1, 'published_at': '2026-01-03T00:00:00Z'}}
        self.assertEqual(p2.validate_pairs([(1, 2)], corpus, 1), [(1, 2)])
        for pairs in ([(1, 2), (1, 2)], [(1, 3)], [(1, 4)], [(2, 1)]):
            with self.assertRaises(ValueError):
                p2.validate_pairs(pairs, corpus, len(pairs))

    def test_bucket_capacity_and_repeat_serialization(self):
        data = [{'pair_key': '1:2', 'primary_bucket': 'DIVERSITY_CONTROL'}]
        self.assertEqual(p2.jsonl_bytes(data), p2.jsonl_bytes(data))
        self.assertFalse(p2.raw_capacity({'DIVERSITY_CONTROL': 1}))
        self.assertTrue(p2.raw_capacity({'POSITIVE_SEEKING': 44, 'HARD_NEGATIVE_SEEKING': 44,
                                         'BOUNDARY_DISAGREEMENT': 24, 'DIVERSITY_CONTROL': 16}))

    def test_shared_feature_pipeline_and_replay(self):
        articles = [{'id': 1, 'feed_id': 1, 'feed_title': 'Alpha', 'category_id': 1,
                     'title': 'Example title', 'published_at': '2026-01-01T00:00:00Z'},
                    {'id': 2, 'feed_id': 2, 'feed_title': 'Beta', 'category_id': 2,
                     'title': 'Example title', 'published_at': '2026-01-01T01:00:00Z'}]
        vectors = [[1.0] + [0.0] * 1023] * 2
        first, thresholds = p2.materialize(articles, [(1, 2)], vectors)
        second, _ = p2.materialize(articles, [(1, 2)], vectors)
        self.assertEqual(p2.jsonl_bytes(first), p2.jsonl_bytes(second))
        self.assertEqual(first[0]['qwen_score'], 1.0)
        self.assertEqual(first[0]['lexical_overlap'], 1.0)
        self.assertEqual(first[0]['temporal_delta_hours'], 1.0)
        self.assertTrue(all('candidate_' + x in first[0] for x in 'abc'))
        self.assertEqual(thresholds['qwen_q50'], 1.0)
        self.assertTrue(first[0]['mining_strata'])
        self.assertIn(first[0]['primary_bucket'], ('POSITIVE_SEEKING', 'HARD_NEGATIVE_SEEKING', 'BOUNDARY_DISAGREEMENT', 'DIVERSITY_CONTROL'))

    def test_tampered_frozen_input_is_rejected_before_inference(self):
        sys.path.insert(0, str(pathlib.Path(__file__).parent))
        import run_embeddings
        with tempfile.TemporaryDirectory() as root:
            corpus = pathlib.Path(root) / 'corpus'
            receipt = pathlib.Path(root) / 'receipt'
            corpus.write_text('synthetic')
            receipt.write_text('synthetic')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                run_embeddings.main(corpus, receipt, pathlib.Path(root) / 'output')


if __name__ == '__main__':
    unittest.main()
