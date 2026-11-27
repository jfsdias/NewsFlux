"""Private-only prospective V2 experiment; never reads a human-label artifact."""
import hashlib
import csv
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from datetime import datetime, timezone

import feature_contract as contract

REMOTE = r'''import hashlib,json,os,subprocess,sys,urllib.request
request=json.load(sys.stdin)
manifest="/root/.ollama/models/manifests/registry.ollama.ai/library/qwen3-embedding/0.6b"
blob="/root/.ollama/models/blobs/sha256-06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439"
def pin():
 version=subprocess.check_output(["docker","exec","ollama","ollama","--version"],text=True).strip().split()[-1]
 def digest(path):return subprocess.check_output(["docker","exec","ollama","sha256sum",path],text=True).split()[0]
 if version!="0.40.11" or digest(manifest)!="ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d" or digest(blob)!="06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439":raise RuntimeError("pin mismatch")
pin()
responses=[]
for payload in request:
 if set(payload)!={"model","input","truncate"} or payload["model"]!="qwen3-embedding:0.6b" or payload["truncate"] is not False:raise ValueError("invalid request")
 data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
 req=urllib.request.Request("http://127.0.0.1:11434/api/embed",data=data,headers={"Content-Type":"application/json"},method="POST")
 with urllib.request.urlopen(req,timeout=600) as r:responses.append(json.load(r)["embeddings"])
pin()
json.dump(responses,sys.stdout,allow_nan=False,separators=(",",":"))
'''


def remote(requests):
    command = 'python3 -c ' + shlex.quote(REMOTE)
    host = os.environ.get('STORY_V2_SSH_TARGET')
    if not host or host.startswith('-'):
        raise ValueError('STORY_V2_SSH_TARGET must name an existing SSH target')
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', host, command],
                            input=contract.canonical_json(requests), capture_output=True, check=False, timeout=1800)
    if result.returncode:
        raise RuntimeError('remote inference or model-pin check failed')
    return json.loads(result.stdout)


def digest(value):
    return hashlib.sha256(contract.canonical_json(value)).hexdigest()


def canary(destination):
    dest = contract.validate_private_destination(destination, Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/feature-v2')
    req = contract.request_payload(contract.SYNTHETIC_TITLES)
    a, b = remote([req, req])
    c, = remote([req])
    for vectors in (a, b, c):
        contract.validate_vectors(vectors, len(req['input']))
    hashes = [digest(v) for v in (a, b, c)]
    if len(set(hashes)) != 1:
        raise ValueError('synthetic repeat hashes differ')
    receipt = {'contract': 'STORY_02_FEATURE_V2', 'model': contract.MODEL, 'manifest_digest': contract.MODEL_DIGEST,
               'blob_digest': contract.BLOB_DIGEST, 'ollama_version': contract.VERSION, 'dimension': contract.DIMENSION,
               'input_contract': 'title.strip() only', 'request': req, 'vector_storage_normalization': 'none',
               'serialization': 'json.dumps ensure_ascii=False sort_keys=True separators=(comma,colon) allow_nan=False UTF-8',
               'run_hashes': hashes, 'timestamp_utc': datetime.now(timezone.utc).isoformat()}
    dest.mkdir(mode=0o700, parents=True, exist_ok=False)
    path = dest / 'feature-pipeline-v2-receipt.json'
    data = contract.canonical_json(receipt)
    with path.open('xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    path.chmod(0o444)
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    if h != hashlib.sha256(data).hexdigest():
        raise ValueError('receipt verification failed')
    return {'hashes': hashes, 'receipt_sha256': h, 'title_count': len(req['input']), 'model_calls': 3}


def bridge(corpus_path, vectors_path, pairs_path, canary_receipt, destination):
    import numpy as np
    from scipy.stats import spearmanr

    dest = contract.validate_private_destination(destination, Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/feature-v2')
    receipt_path = Path(canary_receipt).resolve()
    private_root = (Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/feature-v2').resolve()
    if not receipt_path.is_relative_to(private_root):
        raise ValueError('canary receipt must be private')
    receipt = json.loads(receipt_path.read_bytes())
    contract.validate_canary_receipt(receipt)
    paths = [Path(corpus_path), Path(vectors_path)]
    expected = ['0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0',
                '9818b4081dc404eb8a8d842b377c99c43a5d7c33ce9888ae1cffa8dd8e207904']
    if [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths] != expected:
        raise ValueError('historical input hash mismatch')
    articles = [json.loads(line) for line in paths[0].read_text().splitlines() if line.strip()]
    historical = json.loads(paths[1].read_bytes())
    if len(articles) != 200 or [a['id'] for a in articles] != historical['ids']:
        raise ValueError('historical article order mismatch')
    titles = [contract.canonical_title(a['title']) for a in articles]
    requests = [contract.request_payload(titles[i:i + 20]) for i in range(0, 200, 20)]
    batches = remote(requests)
    vectors = [vector for batch in batches for vector in batch]
    contract.validate_vectors(vectors, 200)
    contract.validate_vectors(historical['embeddings'], 200)
    old, new = np.asarray(historical['embeddings'], dtype=np.float64), np.asarray(vectors, dtype=np.float64)
    norms = np.linalg.norm(old, axis=1) * np.linalg.norm(new, axis=1)
    cosines = np.sum(old * new, axis=1) / norms
    max_component = np.max(np.abs(old - new), axis=1)
    vector_pass = bool(np.all(cosines >= 0.999999) and np.all(max_component <= 1e-6))
    id_index = {int(a['id']): i for i, a in enumerate(articles)}
    old_norm = old / np.linalg.norm(old, axis=1, keepdims=True)
    new_norm = new / np.linalg.norm(new, axis=1, keepdims=True)
    old_scores, new_scores = [], []
    with open(pairs_path, newline='') as f:
        for row in csv.DictReader(f):
            i, j = id_index[int(row['id_a'])], id_index[int(row['id_b'])]
            old_scores.append(float(old_norm[i] @ old_norm[j]))
            new_scores.append(float(new_norm[i] @ new_norm[j]))
    if len(old_scores) != 18953:
        raise ValueError('historical pair count mismatch')
    delta = np.abs(np.asarray(old_scores) - np.asarray(new_scores))
    score_pass = vector_pass and float(np.max(delta)) <= 1e-6
    metrics = {'article_count': 200, 'vector_dimension_match': True,
               'exact_vector_match_count': int(np.sum(np.all(old == new, axis=1))),
               'min_vector_cosine': float(np.min(cosines)), 'p50_vector_cosine': float(np.median(cosines)),
               'max_vector_abs_component_error': float(np.max(max_component)),
               'p99_vector_abs_component_error': float(np.quantile(max_component, .99)),
               'historical_vector_functional_bridge': 'NUMERIC_EQUIVALENT' if vector_pass else 'NOT_EQUIVALENT',
               'pair_score_count': len(old_scores), 'max_qwen_score_delta': float(np.max(delta)),
               'p50_qwen_score_delta': float(np.median(delta)), 'p95_qwen_score_delta': float(np.quantile(delta, .95)),
               'p99_qwen_score_delta': float(np.quantile(delta, .99)), 'spearman_rho': float(spearmanr(old_scores, new_scores).statistic),
               'historical_score_functional_bridge': 'PASS' if score_pass else 'FAIL',
               'historical_qwen_threshold_transfer': 'AUTHORIZED_BY_FULL_FUNCTIONAL_EQUIVALENCE' if score_pass else 'PROHIBITED',
               'historical_lineage_provenance': 'NOT_ESTABLISHED', 'model_calls': len(requests)}
    dest.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name, obj in (('home200-v2-embeddings.json', {'ids': historical['ids'], 'embeddings': vectors}),
                      ('home200-v2-bridge-private.json', metrics)):
        path = dest / name
        with path.open('xb') as f:
            f.write(contract.canonical_json(obj))
            f.flush()
            os.fsync(f.fileno())
        path.chmod(0o444)
    return metrics


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'canary':
        print(json.dumps(canary(sys.argv[2]), sort_keys=True))
    elif len(sys.argv) == 7 and sys.argv[1] == 'bridge':
        print(json.dumps(bridge(*sys.argv[2:]), sort_keys=True))
    else:
        raise SystemExit('usage: runner.py canary PRIVATE_NEW_DIRECTORY | bridge CORPUS VECTORS PAIRS CANARY_RECEIPT PRIVATE_NEW_DIRECTORY')
