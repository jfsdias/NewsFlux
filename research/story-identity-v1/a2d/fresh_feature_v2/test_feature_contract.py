import importlib.util
import math
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('feature_contract', Path(__file__).with_name('feature_contract.py'))
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)


class FeatureContractTest(unittest.TestCase):
    def test_title_strip_only(self):
        self.assertEqual(v2.canonical_title('  A  B\nCafé <b>X</b>  '), 'A  B\nCafé <b>X</b>')
        self.assertEqual(v2.canonical_title(' e\u0301 '), 'e\u0301')
        with self.assertRaises(ValueError):
            v2.canonical_title('  ')

    def test_request_and_pin(self):
        request = v2.request_payload([' A ', 'B'])
        self.assertEqual(request, {'model': 'qwen3-embedding:0.6b', 'input': ['A', 'B'], 'truncate': False})
        v2.verify_pin(v2.MODEL_DIGEST, v2.BLOB_DIGEST, '0.40.11')
        with self.assertRaises(ValueError):
            v2.verify_pin('bad', v2.BLOB_DIGEST, '0.40.11')
        with self.assertRaises(ValueError):
            v2.verify_pin(v2.MODEL_DIGEST, 'bad', '0.40.11')
        with self.assertRaises(ValueError):
            v2.verify_pin(v2.MODEL_DIGEST, v2.BLOB_DIGEST, 'wrong')

    def test_vectors_and_cosine(self):
        a = [1.0] + [0.0] * 1023
        self.assertEqual(v2.validate_vectors([a], 1), [a])
        self.assertEqual(v2.cosine(a, a), 1.0)
        for bad in ([0.0] * 1024, [float('nan')] * 1024, [1.0]):
            with self.assertRaises(ValueError):
                v2.validate_vectors([bad], 1)
        with self.assertRaises(ValueError):
            v2.validate_vectors([], 1)

    def test_serialization_and_synthetic_fixture(self):
        self.assertEqual(v2.canonical_json({'z': 'é', 'a': [1.0]}), b'{"a":[1.0],"z":"\xc3\xa9"}')
        with self.assertRaises(ValueError):
            v2.canonical_json({'v': math.nan})
        self.assertGreaterEqual(len(v2.SYNTHETIC_TITLES), 6)

    def test_private_output_guard(self):
        with tempfile.TemporaryDirectory() as root:
            v2.validate_private_destination(Path(root) / 'private', Path(root))
            with self.assertRaises(ValueError):
                v2.validate_private_destination(Path(root).parent / 'outside', Path(root))

    def test_human_label_artifact_not_read_by_runner(self):
        runner = Path(__file__).with_name('runner.py').read_text()
        self.assertNotIn('human-labels-v1.csv', runner)

    def test_canary_receipt_must_match_pin_and_all_three_runs(self):
        receipt = {'contract': 'STORY_02_FEATURE_V2', 'dimension': v2.DIMENSION, 'manifest_digest': v2.MODEL_DIGEST,
                   'blob_digest': v2.BLOB_DIGEST, 'ollama_version': v2.VERSION,
                   'request': v2.request_payload(v2.SYNTHETIC_TITLES), 'run_hashes': ['a', 'a', 'a']}
        v2.validate_canary_receipt(receipt)
        receipt['run_hashes'] = ['a', 'b', 'a']
        with self.assertRaises(ValueError):
            v2.validate_canary_receipt(receipt)


if __name__ == '__main__':
    unittest.main()
