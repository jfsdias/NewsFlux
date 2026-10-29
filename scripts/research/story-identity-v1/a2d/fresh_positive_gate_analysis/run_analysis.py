"""Run twice, independently validate, and freeze aggregate files in an empty private directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from analyze_positive_evidence import analyze, load_inputs, LABEL_HASH, PACK_HASH
from validate_positive_evidence import validate


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def main():
    ap = argparse.ArgumentParser()
    for name in ('labels', 'pack', 'audit', 'manifest', 'contract', 'output', 'base_sha', 'erratum_sha'): ap.add_argument('--'+name.replace('_','-'), required=True)
    args = ap.parse_args()
    paths = [getattr(args, n) for n in ('labels', 'pack', 'audit', 'manifest', 'contract')]
    first = analyze(*load_inputs(*paths))
    second = analyze(*load_inputs(*paths))
    if first != second: raise ValueError('replay mismatch')
    validate(paths, *first)
    root = Path(args.output)
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    gate = dict(first[0], version='1', track='STORY_02_A2D2C_P4_D2F5_POSITIVE_EVIDENCE_GATE_ANALYSIS', base_sha=args.base_sha, governance_erratum_commit_sha=args.erratum_sha, labels_sha256=LABEL_HASH, selected_pack_sha256=PACK_HASH, discovery_rule='SAME_EVENT_COUNT >= 1', legacy_calibration_rule='SAME_EVENT_COUNT >= 12 AND POSITIVE_COMPONENT_COUNT >= 3 AND LARGEST_POSITIVE_COMPONENT_SHARE <= 0.50', fresh_same_event_existence_established=first[0]['discovery_pass'])
    outputs = {'fresh-positive-gate-analysis-v1.json': gate, 'fresh-positive-stratified-analysis-v1.json': first[1]}
    hashes = {}
    for name, obj in outputs.items():
        data = encode(obj)
        path = root / name
        path.write_bytes(data)
        os.chmod(path, 0o444)
        hashes[name] = hashlib.sha256(data).hexdigest()
    manifest = encode({'version': '1', 'input_sha256': {'labels': LABEL_HASH, 'selected_pack': PACK_HASH}, 'output_sha256': hashes, 'replay_gate': 'PASS', 'independent_validator': 'PASS'})
    path = root / 'fresh-positive-gate-analysis-manifest-v1.json'
    path.write_bytes(manifest)
    os.chmod(path, 0o444)
    print(json.dumps({'status': 'PASS', 'hashes': hashes, 'manifest_sha256': hashlib.sha256(manifest).hexdigest()}, sort_keys=True))

if __name__ == '__main__': main()
