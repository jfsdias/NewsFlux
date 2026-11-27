"""Derive and freeze label-blind features; no pack selection or model calls."""
import csv
import hashlib
import json
from pathlib import Path
import sys

import fresh_features as features

ROOT = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p2-fresh-features'
INPUT = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1'
RECEIPT = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/feature-v2/canary-20261027-v2/feature-pipeline-v2-receipt.json'
HASHES = {'fresh-home-corpus-v1.jsonl': '3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206',
          'p3-crossfeed-24h-pairs.csv': '056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec',
          'all-crossfeed-168h-pairs.csv': 'c6b7c2cb0d578ac6930965f35809daddccc0f452a5ae52b6184da4fe20dc690c',
          'freeze-manifest-v1.json': '8ab3daf7ecdc74f1c4b7b382fea5ab9303dd335e9f0cd51b27e8a85dc42e5723'}
RECEIPT_HASH = '540eb9f303262370e1ace5ab702dbbb99ec62b631d3089b66cf1263679a43d68'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main(attempt):
    root = ROOT.resolve()
    attempt = Path(attempt).resolve()
    if not attempt.is_relative_to(root) or attempt == root:
        raise ValueError('private destination required')
    for name, digest in HASHES.items():
        if sha((INPUT / name).read_bytes()) != digest:
            raise ValueError('frozen input hash mismatch')
    if sha(RECEIPT.read_bytes()) != RECEIPT_HASH:
        raise ValueError('P1 receipt hash mismatch')
    manifest = json.loads((INPUT / 'freeze-manifest-v1.json').read_bytes())
    if manifest['audit']['home_overlap'] != 0 or manifest['audit']['gold_overlap'] != 0:
        raise ValueError('historical article overlap')
    articles = [json.loads(line) for line in (INPUT / 'fresh-home-corpus-v1.jsonl').read_text().splitlines() if line.strip()]
    corpus = {a['id']: a for a in articles}
    if len(articles) != 500 or len(corpus) != 500:
        raise ValueError('article count mismatch')
    with (INPUT / 'p3-crossfeed-24h-pairs.csv').open(newline='') as f:
        pairs = [(int(row['entry_a_id']), int(row['entry_b_id'])) for row in csv.DictReader(f)]
    features.validate_pairs(pairs, corpus, 33135)
    emb1, emb2 = (attempt / 'embedding-pass1.tmp').read_bytes(), (attempt / 'embedding-pass2.tmp').read_bytes()
    if emb1 != emb2:
        raise ValueError('embedding replay mismatch')
    embedding = json.loads(emb1)
    if embedding['ids'] != [article['id'] for article in articles]:
        raise ValueError('embedding order mismatch')
    rows1, thresholds1 = features.materialize(articles, pairs, embedding['embeddings'])
    rows2, thresholds2 = features.materialize(articles, pairs, embedding['embeddings'])
    output1, output2 = features.jsonl_bytes(rows1), features.jsonl_bytes(rows2)
    if output1 != output2 or thresholds1 != thresholds2:
        raise ValueError('feature replay mismatch')
    if {r['pair_key'] for r in rows1} != {f'{a}:{b}' for a, b in pairs} or len(rows1) != 33135:
        raise ValueError('pair completeness mismatch')
    audit = features.capacity_audit(rows1, thresholds1)
    audit.update(article_count=500, pair_count=len(rows1), home_overlap=0, gold_article_overlap=0,
                 gold_pair_overlap=0, isolation_basis='verified_A2D2B_manifest_and_exact_corpus_pair_set')
    if not audit['raw_capacity_pass']:
        print(json.dumps({'status': 'RAW_CAPACITY_FAIL', 'audit': audit}, sort_keys=True))
        return
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'a2d2b'))
    import capture
    audit_bytes = capture.json_bytes(audit)
    artifacts = {'fresh-feature-v2-embeddings.json': emb1, 'fresh-p3-feature-universe-v1.jsonl': output1,
                 'fresh-feature-capacity-audit-v1.json': audit_bytes}
    frozen_hashes = {name: sha(data) for name, data in artifacts.items()}
    p2_manifest = {'feature_pipeline_version': 'STORY_02_FEATURE_V2', 'model': 'qwen3-embedding:0.6b',
                   'tag_digest': 'ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d',
                   'blob_digest': '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
                   'ollama_version': '0.40.11', 'p1_receipt_sha': RECEIPT_HASH, 'inputs': HASHES,
                   'hashes': frozen_hashes, 'audit': audit, 'embedding_replay': 'PASS', 'feature_replay': 'PASS',
                   'human_label_content_parsed': False, 'new_human_labels': 0}
    artifacts['feature-p2-manifest-v1.json'] = capture.json_bytes(p2_manifest)
    frozen_hashes = capture.write_frozen(attempt / 'frozen-v1', artifacts, True)
    print(json.dumps({'status': 'FROZEN', 'audit': audit, 'hashes': frozen_hashes,
                      'embedding_run_hashes': [sha(emb1), sha(emb2)], 'feature_run_hashes': [sha(output1), sha(output2)]}, sort_keys=True))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: produce.py PRIVATE_ATTEMPT_DIRECTORY')
    main(sys.argv[1])
