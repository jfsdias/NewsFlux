import importlib.util
import pathlib
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('capture', pathlib.Path(__file__).with_name('capture.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTest(unittest.TestCase):
    def row(self, ident, feed, when='2026-01-01T00:00:00Z'):
        return dict(id=ident, feed_id=feed, title='example', published_at=when,
                    created_at=when, category_id=1, feed_title='source', url='', language='')

    def test_exclusions_order_and_cutoff(self):
        rows = [self.row(1, 1), self.row(2, 1), self.row(3, 2), self.row(4, 99),
                self.row(5, 1, '2027-01-01T00:00:00Z'), self.row(6, 2)]
        entries, stats = capture.normalize(rows, {1, 2}, {1}, {2}, '2026-01-02T00:00:00Z')
        self.assertEqual([e['id'] for e in entries], [6, 3])
        self.assertEqual((stats['old'], stats['gold'], stats['unknown'], stats['after_cutoff']), (1, 1, 1, 1))

    def test_duplicate_ids_are_fatal_even_if_excluded(self):
        with self.assertRaises(ValueError):
            capture.normalize([self.row(1, 1), self.row(1, 1)], {1}, {1}, set(), '2026-02-01T00:00:00Z')

    def test_status_neutral_window_and_id_ceiling(self):
        cutoff = '2026-01-08T00:00:00Z'
        rows = [dict(self.row(1, 1), status='read'), dict(self.row(2, 1), status='unread'),
                self.row(3, 1, '2025-12-31T23:59:59Z'),
                self.row(4, 1, '2026-01-08T00:00:01Z'), self.row(6, 1)]
        entries, _ = capture.normalize(rows, {1}, set(), set(), cutoff, max_entry_id=5)
        self.assertEqual([e['id'] for e in entries], [2, 1])

    def test_newest_500_under_24_hours_is_not_extended(self):
        rows = [self.row(i, 1 if i % 2 else 2) for i in range(1, 502)]
        data = dict(rows=rows, known_feeds=[1, 2], old_ids=[], gold_ids=[],
                    cutoff='2026-01-01T01:00:00Z', max_entry_id=501)
        with self.assertRaisesRegex(ValueError, 'temporal'):
            capture.derive(data)

    def test_replay_must_match_complete_id_sequence(self):
        capture.validate_replay([self.row(2, 1), self.row(1, 1)], [2, 1], True)
        with self.assertRaises(ValueError):
            capture.validate_replay([self.row(2, 1), self.row(1, 1)], [2, 3], True)
        with self.assertRaises(ValueError):
            capture.validate_replay([self.row(2, 1)], [2], False)

    def test_query_keeps_fixed_window_and_descending_id_without_status(self):
        query = capture.keyset_params('2026-01-08T00:00:00Z', 100, 90, 5)
        self.assertEqual(query['before_entry_id'], 90)
        self.assertEqual((query['order'], query['direction']), ('id', 'desc'))
        self.assertEqual((query['published_after'], query['published_before']), (1767225599, 1767830401))
        self.assertNotIn('status', query)
        self.assertTrue(query['globally_visible'])
        with self.assertRaises(ValueError):
            capture.keyset_params('2026-01-08T00:00:00Z', 100, 102, 5)

    def test_systematic_rank_endpoints_unique_and_repeatable(self):
        rows = [self.row(i, 1) for i in range(1, 1002)]
        sample = capture.systematic_sample(rows, 500)
        self.assertEqual(len(sample), 500)
        self.assertEqual((sample[0]['id'], sample[-1]['id']), (1, 1001))
        self.assertEqual(len({x['id'] for x in sample}), 500)
        self.assertEqual(sample, capture.systematic_sample(rows, 500))
        with self.assertRaises(ValueError):
            capture.systematic_sample(rows[:499], 500)

    def test_atomic_freeze_requires_validation_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as parent:
            destination = pathlib.Path(parent) / 'new'
            with self.assertRaises(ValueError):
                capture.write_frozen(destination, {'x': b'synthetic'}, False)
            self.assertFalse(destination.exists())
            capture.write_frozen(destination, {'x': b'synthetic'}, True)
            self.assertEqual((destination / 'x').read_bytes(), b'synthetic')
            self.assertEqual((destination / 'x').stat().st_mode & 0o777, 0o444)
            with self.assertRaises(FileExistsError):
                capture.write_frozen(destination, {'x': b'other'}, True)

    def test_pair_canonical_windows_and_determinism(self):
        rows = [self.row(3, 1), self.row(1, 2, '2025-12-31T00:00:00Z'),
                self.row(2, 1), self.row(4, 3, '2025-12-24T23:59:59Z')]
        a = capture.pairs(rows, 24)
        self.assertEqual(a, [(1, 2), (1, 3)])
        self.assertEqual(a, capture.pairs(list(reversed(rows)), 24))
        self.assertNotIn((3, 4), capture.pairs(rows, 168))
        within = [self.row(11, 1), self.row(12, 2, '2025-12-30T00:00:00Z')]
        self.assertEqual(len(capture.pairs(within, 24)), 0)
        self.assertEqual(len(capture.pairs(within, 168)), 1)


if __name__ == '__main__':
    unittest.main()
