import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import capture

spec=importlib.util.spec_from_file_location('d2e3_diagnostic_runner',Path(__file__).with_name('runner.py'))
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.article={'id':1,'feed_id':2,'title':'Sensitive synthetic title','url':'https://example.test/private','published_at':'2026-01-01T00:00:00Z'}
        self.entry=dict(self.article,content='Sensitive synthetic body')
        runner.COUNTS.clear()

    def tearDown(self):
        self.temp.cleanup()

    def failure(self,body,stage,code):
        with patch.object(runner,'request',return_value=(200,body,0)):
            with self.assertRaises(capture.CaptureFailure) as result:
                runner.fetch(None,'synthetic-secret',self.article,self.root)
        error=result.exception
        self.assertEqual(error.stage,stage)
        self.assertEqual(error.code,code)
        self.assertTrue(error.payload_frozen)
        self.assertEqual(error.status,200)
        self.assertNotIn('Sensitive synthetic',str(error))
        self.assertNotIn('synthetic-secret',str(error))
        self.assertNotIn('example.test',str(error))
        self.assertEqual(len(list((self.root/'source-payloads'/'sha256').glob('*.bin'))),1)
        return error

    def test_invalid_json_saved_before_parse(self):
        self.failure(b'{invalid json','JSON_DECODE','INVALID_JSON')

    def test_invalid_root_saved(self):
        self.failure(b'[]','JSON_SHAPE','INVALID_ROOT')

    def test_missing_identity_saved(self):
        x=dict(self.entry);del x['feed_id']
        self.failure(json.dumps(x).encode(),'IDENTITY_EXTRACTION','MISSING_OR_INVALID_FIELD')

    def test_invalid_timestamp_saved(self):
        x=dict(self.entry,published_at='bad')
        self.failure(json.dumps(x).encode(),'IDENTITY_VALIDATION','INVALID_IDENTITY_VALUE')

    def test_normalization_failure_saved(self):
        with patch.object(capture.probe,'normalize',side_effect=RuntimeError('Sensitive synthetic body')):
            self.failure(json.dumps(self.entry).encode(),'NORMALIZATION','NORMALIZATION_FAILED')

    def test_secret_not_persisted(self):
        with patch.object(runner,'request',return_value=(200,b'synthetic-secret',0)):
            with self.assertRaises(capture.CaptureFailure) as result:
                runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(result.exception.stage,'SECRET_SCAN')
        self.assertFalse(result.exception.payload_frozen)
        self.assertEqual(list(self.root.iterdir()),[])

    def test_write_error_stops_before_derivation(self):
        with patch.object(runner,'request',return_value=(200,json.dumps(self.entry).encode(),0)), patch.object(capture,'secure_write',side_effect=OSError('Sensitive synthetic body')), patch.object(capture,'derive') as derive:
            with self.assertRaises(capture.CaptureFailure) as result:
                runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(result.exception.stage,'RAW_PAYLOAD_FREEZE')
        derive.assert_not_called()
        self.assertNotIn('Sensitive synthetic',str(result.exception))

    def test_empty_cookie_metadata_does_not_block(self):
        body=json.dumps(dict(self.entry,cookie=None)).encode()
        with patch.object(runner,'request',return_value=(200,body,0)):
            _,row=runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(row['content_status'],'USABLE')

    def test_nonempty_cookie_metadata_is_not_persisted(self):
        body=json.dumps(dict(self.entry,cookie='private-cookie')).encode()
        with patch.object(runner,'request',return_value=(200,body,0)):
            with self.assertRaises(capture.CaptureFailure) as result:
                runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(result.exception.stage,'SECRET_SCAN')
        self.assertFalse(result.exception.payload_frozen)
        self.assertEqual(list(self.root.iterdir()),[])

    def test_digest_readback_failure_is_distinct(self):
        with patch.object(runner,'request',return_value=(200,json.dumps(self.entry).encode(),0)),patch.object(capture,'secure_write',side_effect=ValueError('private data')):
            with self.assertRaises(capture.CaptureFailure) as result:
                runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(result.exception.stage,'RAW_PAYLOAD_FREEZE')
        self.assertEqual(result.exception.code,'WRITE_OR_READBACK_FAILED')
        self.assertNotIn('private data',str(result.exception))

    def test_safe_diagnostic_never_includes_message_or_traceback(self):
        bad=ValueError('Sensitive synthetic title https://example.test/private synthetic-secret Sensitive synthetic body')
        rendered=json.dumps(runner.safe_diagnostic(bad))
        for prohibited in ('Sensitive synthetic','example.test','synthetic-secret','traceback','locals'):
            self.assertNotIn(prohibited,rendered)

    def test_freeze_before_json_decode(self):
        body=json.dumps(self.entry).encode()
        original=json.loads
        def inspect(data,*args,**kwargs):
            self.assertEqual(len(list((self.root/'source-payloads'/'sha256').glob('*.bin'))),1)
            return original(data,*args,**kwargs)
        with patch.object(runner,'request',return_value=(200,body,0)),patch.object(capture.json,'loads',side_effect=inspect):
            runner.fetch(None,'synthetic-secret',self.article,self.root)

    def test_unsupported_content_remains_contractual(self):
        body=json.dumps(dict(self.entry,content={'a':1})).encode()
        with patch.object(runner,'request',return_value=(200,body,0)):
            _,row=runner.fetch(None,'synthetic-secret',self.article,self.root)
        self.assertEqual(row['content_status'],'UNSUPPORTED_FORMAT')


if __name__=='__main__':
    unittest.main()
