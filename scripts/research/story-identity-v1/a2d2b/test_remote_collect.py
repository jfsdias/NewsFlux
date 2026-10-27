import importlib.util
import pathlib
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('remote_collect', pathlib.Path(__file__).with_name('remote_collect.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class CollectorTest(unittest.TestCase):
    def test_projection_drops_content_and_secrets(self):
        entry = {'id': 1, 'feed_id': 3, 'title': 'synthetic', 'url': 'https://example.invalid',
                 'published_at': '2026-01-01T00:00:00Z', 'created_at': '2026-01-01T00:00:00Z',
                 'status': 'read', 'language': 'en', 'content': 'private body',
                 'feed': {'title': 'synthetic', 'password': 'secret', 'category': {'id': 2}}}
        result = remote.project_entry(entry)
        self.assertEqual(result['id'], 1)
        self.assertNotIn('content', result)
        self.assertNotIn('secret', str(result))

    def test_read_only_method_enforced(self):
        with self.assertRaises(ValueError):
            remote.request_json('http://example.invalid', 'token', '/v1/entries', method='POST')

    def test_cursor_invariants_reject_overlap_and_bad_order(self):
        seen = set()
        self.assertEqual(remote.check_page([{'id': 9}, {'id': 8}], 10, seen), 8)
        with self.assertRaises(ValueError):
            remote.check_page([{'id': 8}], 9, seen)
        with self.assertRaises(ValueError):
            remote.check_page([{'id': 7}, {'id': 7}], 8, set())

    def test_empty_page_proves_terminal(self):
        self.assertIsNone(remote.check_page([], 5, set()))

    def test_keyset_traversal_reaches_empty_with_no_status_or_offset(self):
        requests = []
        def fake_request(base, token, path):
            query = parse_qs(urlsplit(path).query)
            requests.append(query)
            cursor = int(query['before_entry_id'][0])
            ids = [i for i in (3, 2, 1) if i < cursor][:2]
            return {'total': 3, 'entries': [{'id': i} for i in ids]}, 10
        with patch.object(remote, 'request_json', fake_request), patch.object(remote, 'PAGE_SIZE', 2):
            result = remote.enumerate_entries('http://example.invalid', 'token', '2026-01-08T00:00:00Z', 3)
        self.assertEqual([e['id'] for e in result['rows']], [3, 2, 1])
        self.assertEqual(result['pages'], 3)
        self.assertTrue(result['terminal_empty'])
        self.assertTrue(all('status' not in q and 'offset' not in q for q in requests))


if __name__ == '__main__':
    unittest.main()
