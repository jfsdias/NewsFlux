"""Prospective Story feature V2; no claim about historical generation lineage."""
import json
import math
from pathlib import Path

MODEL = 'qwen3-embedding:0.6b'
MODEL_DIGEST = 'ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d'
BLOB_DIGEST = '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439'
VERSION = '0.40.11'
DIMENSION = 1024
SYNTHETIC_TITLES = ('A simple headline', '  Spaces around  ', 'Internal  spaces',
                    'Café déjà vu', 'Punctuation: A, B!', 'Two lines\nwithin title')


def canonical_title(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('title must be a non-empty string')
    return value.strip()


def request_payload(titles):
    return {'model': MODEL, 'input': [canonical_title(x) for x in titles], 'truncate': False}


def verify_pin(manifest, blob, version):
    if (manifest, blob, version) != (MODEL_DIGEST, BLOB_DIGEST, VERSION):
        raise ValueError('model pin mismatch')


def validate_vectors(vectors, expected):
    if not isinstance(vectors, list) or len(vectors) != expected:
        raise ValueError('vector count mismatch')
    for vector in vectors:
        if not isinstance(vector, list) or len(vector) != DIMENSION:
            raise ValueError('vector dimension mismatch')
        if any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector):
            raise ValueError('non-finite vector')
        if not any(x != 0 for x in vector):
            raise ValueError('zero-norm vector')
    return vectors


def cosine(a, b):
    validate_vectors([a, b], 2)
    return math.fsum(x * y for x, y in zip(a, b)) / (math.sqrt(math.fsum(x * x for x in a)) * math.sqrt(math.fsum(x * x for x in b)))


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def validate_private_destination(path, root):
    target, base = Path(path).resolve(), Path(root).resolve()
    if target == base or not target.is_relative_to(base):
        raise ValueError('output must be a new directory inside the private research root')
    return target


def validate_canary_receipt(receipt):
    verify_pin(receipt['manifest_digest'], receipt['blob_digest'], receipt['ollama_version'])
    hashes = receipt.get('run_hashes', [])
    if (receipt.get('contract') != 'STORY_02_FEATURE_V2' or receipt.get('dimension') != DIMENSION or receipt.get('request') != request_payload(SYNTHETIC_TITLES)
            or len(hashes) != 3 or len(set(hashes)) != 1):
        raise ValueError('matching successful synthetic canary required')
