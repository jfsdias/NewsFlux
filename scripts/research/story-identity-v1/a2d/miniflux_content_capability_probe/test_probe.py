import unittest
import probe


class ProbeTests(unittest.TestCase):
    def test_content_classes(self):
        for value, expected in [(None, 'EMPTY_AFTER_NORMALIZATION'), ('  ', 'EMPTY_AFTER_NORMALIZATION'), ('<script>x</script>', 'STRUCTURAL_ONLY'), ({}, 'UNSUPPORTED_FORMAT'), ('<p>A &amp; B</p>', 'USABLE')]:
            with self.subTest(value=value):
                self.assertEqual(probe.content(value, 'title')[0], expected)

    def test_void_tags_inside_omitted_blocks_do_not_leak(self):
        self.assertEqual(probe.normalize('<nav><input/>secret</nav><p>safe</p>'), 'safe')

    def test_no_dangerous_methods(self):
        for method, path in [('POST', '/v1/entries/1'), ('GET', '/v1/me'), ('GET', '/v1/entries/1/fetch-content')]:
            with self.assertRaises(ValueError):
                probe.check_request(method, path)
        probe.check_request('GET', '/v1/entries/1')

    def test_unicode_normalization_and_truncation(self):
        self.assertEqual(probe.normalize('<nav>bad</nav> e\u0301 &amp; ok'), 'é & ok')
        self.assertEqual(len(probe.normalize('a' * 9000)), 8192)

    def test_identity_and_title_diagnostic(self):
        frozen = {'id': 1, 'feed_id': 2, 'title': 'Hello', 'url': 'https://example.test', 'published_at': '2026-01-01T00:00:00Z'}
        entry = dict(frozen, content='<p>Hello</p>')
        row = probe.row(frozen, 200, entry, 1)
        self.assertEqual(row['identity_status'], 'IDENTITY_MATCH')
        self.assertEqual(row['content_status'], 'USABLE')
        self.assertTrue(row['content_equals_title'])
        entry['feed_id'] = 3
        self.assertEqual(probe.row(frozen, 200, entry, 1)['content_status'], 'IDENTITY_FAILURE')

    def test_retry_and_auth_stop(self):
        self.assertTrue(probe.retryable(429))
        self.assertTrue(probe.retryable(503))
        for status in (200, 401, 403, 404):
            self.assertFalse(probe.retryable(status))

    def test_summaries_keep_target_denominator(self):
        result = probe.summarize([{'identity_status': 'IDENTITY_MATCH', 'content_status': 'USABLE', 'content_equals_title': False, 'raw_character_count': 1, 'normalized_character_count': 1, 'entry_http_status': 200, 'request_attempt_count': 1}], 500)
        self.assertEqual(result['usable_coverage'], .002)

class RunnerTests(unittest.TestCase):
    def test_retry_is_bounded(self):
        from unittest.mock import patch
        import runner
        frozen = {'id': 1, 'feed_id': 2, 'title': 'A', 'url': 'https://example.test', 'published_at': '2026-01-01T00:00:00Z'}
        with patch.object(runner, 'request', side_effect=[(503, None), (404, None)]) as request, patch.object(runner.time, 'sleep'):
            row = runner.fetch_one(None, None, frozen)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(row['identity_status'], 'ENTRY_NOT_FOUND')
        self.assertEqual(row['request_attempt_count'], 2)

    def test_auth_stops_without_retry(self):
        from unittest.mock import patch
        import runner
        with patch.object(runner, 'request', return_value=(401, None)) as request:
            with self.assertRaises(PermissionError):
                runner.fetch_one(None, None, {'id':1})
        self.assertEqual(request.call_count, 1)

    def test_independent_validator_accepts_and_rejects_metadata(self):
        import runner
        from validate import validate
        frozen = [{'id': i, 'feed_id':2, 'title':'A', 'url':'https://example.test', 'published_at':'2026-01-01T00:00:00Z'} for i in range(1,501)]
        rows = [probe.row(item, 200, dict(item, content='<p>text</p>'), 1) for item in frozen]
        summary = probe.summarize(rows)
        summary.update(auth_preflight_requests=1,total_request_attempts=501,coverage_gate='PASS',attempt_http_status_counts={'200':500},transport_failure_attempts=0)
        validate(frozen, rows, summary)
        rows[5]['content'] = 'forbidden'
        with self.assertRaises(ValueError):
            validate(frozen, rows, summary)

    def test_synthetic_capture_writes_only_allowed_metadata(self):
        import contextlib
        import hashlib
        import io
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import runner
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / 'corpus.jsonl'
            frozen = [{'id': i, 'feed_id':i % 52, 'category_id':i % 11, 'title':'synthetic private title', 'url':'https://example.test/private', 'published_at':'2026-01-01T00:00:00Z'} for i in range(1,501)]
            corpus_path.write_text(''.join(json.dumps(x) + '\n' for x in frozen))
            fake_contract = root / 'contract.json'
            fake_manifest = root / 'manifest.json'
            fake_contract.write_text('{}')
            fake_manifest.write_text('{}')
            sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            inputs = {corpus_path:sha(corpus_path), fake_contract:sha(fake_contract), fake_manifest:sha(fake_manifest)}
            by_id = {item['id']: item for item in frozen}
            def fake_request(origin, token, article_id):
                runner.COUNTS['attempts'] += 1
                runner.COUNTS['http_200'] += 1
                return 200, dict(by_id[article_id], content='synthetic private body')
            output = io.StringIO()
            runner.COUNTS.clear()
            with patch.object(runner, 'CORPUS', corpus_path), patch.object(runner, 'CONTRACT', fake_contract), patch.object(runner, 'MANIFEST', fake_manifest), patch.object(runner, 'INPUTS', inputs), patch.object(runner, 'credentials', return_value=(None,None)), patch.object(runner, 'request', side_effect=fake_request), patch.object(Path, 'home', return_value=root), contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                runner.main()
            report = json.loads(output.getvalue())
            attempt = Path(report['attempt'])
            self.assertEqual(report['summary']['usable_count'], 500)
            for path in attempt.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o444)
                contents = path.read_text()
                self.assertNotIn('synthetic private', contents)
                self.assertNotIn('example.test', contents)


if __name__ == '__main__':
    unittest.main()
