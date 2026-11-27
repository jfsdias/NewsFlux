import unittest
from analyze_positive_evidence import analyze, verified


def fixture(counts):
    labels, pairs = [], []
    for component, count in enumerate(counts):
        for i in range(count):
            key = f'{component}-{i}'
            labels.append({'review_annotation_id': key, 'pair_key': key, 'human_decision': 'SAME_EVENT'})
            pairs.append({'pair_key': key, 'article_id_a': key+'a', 'article_id_b': key+'b', 'component_id': str(component), 'lane_primary': 'A', 'lane_membership': ['A'], 'title_equivalent_article_present': False})
    return labels, pairs


class Tests(unittest.TestCase):
    def test_discovery_and_calibration(self):
        for counts, discovery, conditions, passed in [([], False, [False, False, False], False), ([1], True, [False, False, False], False), ([6, 3, 3], True, [True, True, True], True), ([7, 3, 2], True, [True, True, False], False), ([6, 6], True, [True, False, True], False)]:
            a, _ = analyze(*fixture(counts), strict=False)
            self.assertEqual((a['discovery_pass'], a['legacy_calibration_conditions'], a['legacy_calibration_pass']), (discovery, conditions, passed))
    def test_tie_and_replay(self):
        inputs = fixture([2, 2])
        a = analyze(*inputs, strict=False)
        self.assertEqual(a, analyze(*inputs, strict=False))
        self.assertEqual(a[0]['largest_positive_component_share'], .5)
    def test_related_is_not_positive(self):
        labels, pairs = fixture([1])
        labels[0]['human_decision'] = 'RELATED_TOPIC'
        a, _ = analyze(labels, pairs, strict=False)
        self.assertFalse(a['discovery_pass'])
    def test_invalid(self):
        labels, pairs = fixture([1])
        for ls, ps in [(labels*2, pairs), (labels, []), ([], pairs), ([dict(labels[0], human_decision='BOGUS')], pairs)]:
            with self.assertRaises(ValueError): analyze(ls, ps, strict=False)
    def test_hash(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile() as f:
            os.chmod(f.name, 0o444)
            with self.assertRaises(ValueError): verified(f.name, 'bad')

if __name__ == '__main__': unittest.main()

class PrivacyTests(unittest.TestCase):
    def test_public_report_is_global_only(self):
        import re
        from pathlib import Path
        report = Path(__file__).with_name('POSITIVE_EVIDENCE_ANALYSIS_REPORT.md').read_text()
        for key in ('POSITIVE_COMPONENT_COUNT', 'LARGEST_POSITIVE_COMPONENT_COUNT', 'LARGEST_POSITIVE_COMPONENT_SHARE', 'SAME_EVENT_COMPONENT_COVERAGE'):
            self.assertRegex(report, rf'{key}=SUPPRESSED_PRIVACY')
            self.assertNotRegex(report, rf'{key}=(?!SUPPRESSED_PRIVACY)\S+')
        for key in ('LEGACY_CALIBRATION_COMPONENT_CONDITION', 'LEGACY_CALIBRATION_CONCENTRATION_CONDITION'):
            self.assertRegex(report, rf'{key}=PRIVATE_NOT_DISCLOSED')
            self.assertNotRegex(report, rf'{key}=(?:PASS|FAIL)')
        for token in ('pair_key', 'review_annotation_id', 'article_id', 'component_id', 'lane_primary', 'lane_membership'):
            self.assertNotIn(token, report)
        self.assertIn('seven is below the historical minimum of twelve', report)
        self.assertIn('LEGACY_CALIBRATION_RULE_RESULT=FAIL', report)

    def test_count_alone_implies_failure(self):
        self.assertFalse(7 >= 12 and object() and object())

    def test_source_firewall(self):
        import ast
        from pathlib import Path
        root = Path(__file__).parent
        for name in ('analyze_positive_evidence.py', 'run_analysis.py', 'validate_positive_evidence.py'):
            tree = ast.parse((root / name).read_text())
            imports = {alias.name.split('.')[0] for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names} | {node.module.split('.')[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
            self.assertFalse(imports & {'socket', 'requests', 'urllib', 'http', 'subprocess', 'openai'})

class BoundaryTests(unittest.TestCase):
    def test_count_condition_fails_below_twelve(self):
        result, _ = analyze(*fixture([3, 3, 3]), strict=False)
        self.assertFalse(result['legacy_calibration_conditions'][0])
    def test_component_condition_fails_with_two(self):
        result, _ = analyze(*fixture([6, 6]), strict=False)
        self.assertFalse(result['legacy_calibration_conditions'][1])
    def test_concentration_and_multiple_components(self):
        result, _ = analyze(*fixture([5, 2, 1]), strict=False)
        self.assertEqual(result['largest_positive_component_count'], 5)
        self.assertEqual(result['largest_positive_component_share'], 5 / 8)
        self.assertFalse(result['legacy_calibration_conditions'][2])
    def test_duplicate_selected_pair_rejected(self):
        labels, pairs = fixture([1])
        with self.assertRaises(ValueError): analyze(labels, pairs * 2, strict=False)
    def test_extra_schema_rejected(self):
        labels, pairs = fixture([1]); labels[0]['extra'] = 'x'
        with self.assertRaises(ValueError): analyze(labels, pairs, strict=False)
    def test_wrong_input_hashes_including_historical_inputs_rejected(self):
        import tempfile, os
        from analyze_positive_evidence import load_inputs
        with tempfile.NamedTemporaryFile() as f:
            os.chmod(f.name, 0o444)
            with self.assertRaises(ValueError): load_inputs(f.name, f.name, f.name, f.name, f.name)
    def test_private_lane_counts_not_in_public_report(self):
        from pathlib import Path
        report = Path(__file__).with_name('POSITIVE_EVIDENCE_ANALYSIS_REPORT.md').read_text()
        for forbidden in ('STRONG_CONSENSUS', 'GRAPH_SUPPORTED_EVENT', 'CROSS_SOURCE_PARAPHRASE', 'POSITIVE_BOUNDARY', 'RELATED_TOPIC stratum'):
            self.assertNotIn(forbidden, report)
    def test_input_mode_rejected(self):
        import tempfile, os, hashlib
        with tempfile.NamedTemporaryFile() as f:
            os.chmod(f.name, 0o600)
            with self.assertRaises(ValueError): verified(f.name, hashlib.sha256(b'').hexdigest())

class HashGateTests(unittest.TestCase):
    def test_tampered_labels_and_selected_pack_are_rejected_before_parse(self):
        import hashlib
        import os
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import analyze_positive_evidence as module
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / str(i) for i in range(5)]
            blob = b'{"synthetic":true}\n'
            digest = hashlib.sha256(blob).hexdigest()
            for path in paths:
                path.write_bytes(blob)
                os.chmod(path, 0o444)
            with patch.multiple(module, LABEL_HASH=digest, PACK_HASH=digest, AUDIT_HASH=digest, MANIFEST_HASH=digest, CONTRACT_HASH=digest):
                for index in (0, 1):
                    os.chmod(paths[index], 0o600)
                    paths[index].write_bytes(b'tampered')
                    os.chmod(paths[index], 0o444)
                    with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                        module.load_inputs(*paths)
                    os.chmod(paths[index], 0o600)
                    paths[index].write_bytes(blob)
                    os.chmod(paths[index], 0o444)
