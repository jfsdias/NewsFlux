"""Generate two private V2 embedding passes; no labels or feature selection."""
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'fresh_feature_v2'))
import feature_contract as contract
import runner

CORPUS_SHA = '3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206'
RECEIPT_SHA = '540eb9f303262370e1ace5ab702dbbb99ec62b631d3089b66cf1263679a43d68'


def main(corpus_path, receipt_path, destination):
    corpus_path, receipt_path = Path(corpus_path), Path(receipt_path)
    if hashlib.sha256(corpus_path.read_bytes()).hexdigest() != CORPUS_SHA or hashlib.sha256(receipt_path.read_bytes()).hexdigest() != RECEIPT_SHA:
        raise ValueError('input hash mismatch')
    contract.validate_canary_receipt(json.loads(receipt_path.read_bytes()))
    articles = [json.loads(line) for line in corpus_path.read_text().splitlines() if line.strip()]
    ids = [article['id'] for article in articles]
    if len(ids) != 500 or len(set(ids)) != 500 or any(not a.get('feed_id') or not a.get('published_at') for a in articles):
        raise ValueError('fresh corpus invalid')
    titles = [contract.canonical_title(article['title']) for article in articles]
    requests = [contract.request_payload(titles[i:i + 20]) for i in range(0, 500, 20)]
    outputs = []
    for _ in range(2):
        batches = runner.remote(requests)
        vectors = [vector for batch in batches for vector in batch]
        contract.validate_vectors(vectors, 500)
        outputs.append(contract.canonical_json({'ids': ids, 'embeddings': vectors}))
    hashes = [hashlib.sha256(output).hexdigest() for output in outputs]
    if hashes[0] != hashes[1]:
        raise ValueError('fresh embeddings are not byte-identical')
    root = Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p2-fresh-features'
    dest = contract.validate_private_destination(destination, root)
    dest.mkdir(mode=0o700, parents=True, exist_ok=False)
    for index, output in enumerate(outputs, 1):
        path = dest / f'embedding-pass{index}.tmp'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(output)
            stream.flush()
            os.fsync(stream.fileno())
        if hashlib.sha256(path.read_bytes()).hexdigest() != hashes[index - 1]:
            raise ValueError('private embedding readback mismatch')
    print(json.dumps({'article_count': len(ids), 'dimension': 1024, 'batch_size': 20, 'model_calls': 50, 'hashes': hashes}))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: run_embeddings.py CORPUS RECEIPT PRIVATE_NEW_DIRECTORY')
    main(*sys.argv[1:])
