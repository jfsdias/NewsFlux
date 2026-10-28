import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import capture


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.frozen = {'id': 1, 'feed_id': 2, 'title': 'Synthetic', 'url': 'https://example.test/a', 'published_at': '2026-01-01T00:00:00Z'}
        self.entry = dict(self.frozen, content='<p>Synthetic &amp; text</p>')
        self.payload = json.dumps(self.entry).encode()

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_body_content_address_and_replay(self):
        mapping = capture.freeze_payload(self.root, 1, 200, 1, self.payload, b'example-secret', '2026-01-01T00:00:00Z')
        path = self.root / mapping['source_payload_artifact_relpath']
        self.assertEqual(path.read_bytes(), self.payload)
        self.assertEqual(mapping['source_payload_sha256'], hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(path.stat().st_mode & 0o777, 0o444)
        row = capture.derive(self.frozen, mapping, path.read_bytes())
        self.assertEqual(row['content_status'], 'USABLE')
        self.assertEqual(row['normalized_content'], 'Synthetic & text')
        self.assertEqual(row['raw_content_sha256'], hashlib.sha256(self.entry['content'].encode()).hexdigest())

    def test_secret_body_rejected_before_write(self):
        with self.assertRaises(capture.SecretLeak):
            capture.freeze_payload(self.root, 1, 200, 1, b'private-secret', b'private-secret', '2026-01-01T00:00:00Z')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_content_hash_mismatch_rejected(self):
        mapping = capture.freeze_payload(self.root, 1, 200, 1, self.payload, b'secret', '2026-01-01T00:00:00Z')
        with self.assertRaises(capture.CaptureFailure) as result:
            capture.derive(self.frozen, mapping, self.payload + b' ')
        self.assertEqual(result.exception.stage,'PAYLOAD_INDEX')

    def test_no_raw_body_in_sidecar(self):
        mapping = capture.freeze_payload(self.root, 1, 200, 1, self.payload, b'secret', '2026-01-01T00:00:00Z')
        result = capture.derive(self.frozen, mapping, self.payload)
        self.assertNotIn('raw_content', result)
        self.assertNotIn('source_payload', result)
        self.assertNotIn(self.entry['content'], json.dumps(result))

    def test_invalid_request_is_blocked(self):
        for method, path in [('POST', '/v1/entries/1'), ('GET', '/v1/entries/1/fetch-content')]:
            with self.assertRaises(ValueError):
                capture.check_request(method, path)

    def test_identity_mismatch_suppresses_content(self):
        payload = json.dumps(dict(self.entry, feed_id=99)).encode()
        mapping = capture.freeze_payload(self.root, 1, 200, 1, payload, b'secret', '2026-01-01T00:00:00Z')
        row = capture.derive(self.frozen, mapping, payload)
        self.assertEqual(row['identity_status'], 'IDENTITY_MISMATCH')
        self.assertIsNone(row['normalized_content'])

    def test_retries_and_missing_source(self):
        self.assertTrue(capture.retryable(429))
        self.assertTrue(capture.retryable(503))
        self.assertFalse(capture.retryable(401))
        self.assertFalse(capture.retryable(404))
        mapping = capture.freeze_payload(self.root, 1, None, 2, None, b'secret', '2026-01-01T00:00:00Z')
        self.assertEqual(capture.derive(self.frozen, mapping, None)['content_status'], 'SOURCE_FAILURE')

class ValidatorTests(unittest.TestCase):
    def test_index_duplicate_missing_and_hash_tampering_rejected(self):
        import validate_capture as validate
        frozen = {'id': 1, 'feed_id': 2, 'title': 'Synthetic', 'url': 'https://example.test/a', 'published_at':'2026-01-01T00:00:00Z'}
        body = json.dumps(dict(frozen, content='<b>example</b>')).encode()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mapping = capture.freeze_payload(root, 1, 200, 1, body, b'secret', '2026-01-01T00:00:00Z')
            row = capture.derive(frozen, mapping, body)
            validate.validate([frozen], [mapping], [row], root, b'secret', expected_count=1)
            with self.assertRaises(ValueError):
                validate.validate([frozen], [mapping, mapping], [row], root, b'secret', expected_count=1)
            broken = dict(mapping, source_payload_sha256='0' * 64)
            with self.assertRaises(ValueError):
                validate.validate([frozen], [broken], [row], root, b'secret', expected_count=1)
            (root / mapping['source_payload_artifact_relpath']).unlink()
            with self.assertRaises(ValueError):
                validate.validate([frozen], [mapping], [row], root, b'secret', expected_count=1)

class CompleteSyntheticRunTests(unittest.TestCase):
    def test_private_destination_must_not_be_in_git_tree(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('d2e3_runner', Path(__file__).with_name('runner.py'))
        runner=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with self.assertRaises(ValueError):
                runner.validate_destination(root, root, root)

    def test_retry_only_for_retryable_and_auth_stops(self):
        import importlib.util
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location('d2e3_runner', Path(__file__).with_name('runner.py'))
        runner=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        article={'id':1,'feed_id':2,'title':'Synthetic','url':'https://example.test/a','published_at':'2026-01-01T00:00:00Z'}
        body=json.dumps(dict(article,content='sample')).encode()
        runner.COUNTS.clear()
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(runner,'request',side_effect=[(503,b'error',0),(200,body,0)]) as request, patch.object(runner.time,'sleep'):
                mapping,row=runner.fetch(None,'secret',article,Path(tmp))
            self.assertEqual(request.call_count,2)
            self.assertEqual(mapping['request_attempt_used'],2)
            self.assertEqual(row['content_status'],'USABLE')
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(runner,'request',return_value=(403,b'no',0)) as request:
                with self.assertRaises(capture.CaptureFailure) as result:
                    runner.fetch(None,'secret',article,Path(tmp))
            self.assertEqual(request.call_count,1)
            self.assertEqual(result.exception.code,'AUTHORIZATION_FAILED')
            self.assertEqual(list(Path(tmp).iterdir()),[])

    def test_complete_capture_and_offline_replay(self):
        import collections
        import contextlib
        import io
        from unittest.mock import patch
        import importlib.util
        spec=importlib.util.spec_from_file_location('d2e3_runner', Path(__file__).with_name('runner.py'))
        runner=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            corpus=[{'id':i,'feed_id':i%52,'category_id':i%11,'title':'Synthetic','url':'https://example.test/a','published_at':'2026-01-01T00:00:00Z'} for i in range(1,501)]
            old={x['id']:{'identity_status':'IDENTITY_MATCH','content_status':'USABLE','content_equals_title':False} for x in corpus}
            by_id={x['id']:x for x in corpus}
            def request(origin,token,path,preflight=False):
                if preflight:
                    runner.COUNTS['preflight']+=1
                    runner.HTTP['200']+=1
                    return 200,b'{}',0
                runner.COUNTS['entry_attempts']+=1
                runner.HTTP['200']+=1
                i=int(path.rsplit('/',1)[1])
                return 200,json.dumps(dict(by_id[i],content='<p>Synthetic body</p>')).encode(),0
            runner.COUNTS.clear();runner.HTTP.clear()
            output=io.StringIO()
            with patch.object(runner,'verify_inputs',return_value=(corpus,old)),patch.object(runner.baseline,'credentials',return_value=(None,'synthetic-secret')),patch.object(runner,'request',side_effect=request),patch.object(Path,'home',return_value=root),contextlib.redirect_stdout(output),contextlib.redirect_stderr(io.StringIO()):
                runner.main()
            report=json.loads(output.getvalue())
            self.assertEqual(report['summary']['usable_count'],500)
            self.assertEqual(report['summary']['content_status_changed_count'],0)
            self.assertEqual(report['summary']['content_equals_title_changed_count'],0)
            attempt=Path(report['attempt'])
            self.assertEqual(attempt.stat().st_mode&0o777,0o700)
            for name in ('source-payload-index-v1.jsonl','fresh-content-enrichment-receipt-v1.json','fresh-content-enrichment-manifest-v1.json'):
                text=(attempt/name).read_text()
                self.assertNotIn('Synthetic body',text)
                self.assertNotIn('synthetic-secret',text)
                self.assertNotIn('example.test',text)


if __name__ == '__main__':
    unittest.main()
