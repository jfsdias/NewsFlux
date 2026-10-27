"""Offline derivation from immutable inputs; never opens human-label artifacts."""
import csv
import hashlib
import json
import sys
from pathlib import Path
import search_rank as sr

RESEARCH = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RESEARCH / 'a2d' / 'fresh_feature_v2'))
sys.path.insert(0, str(RESEARCH / 'a2d' / 'fresh_feature_generation'))
sys.path.insert(0, str(RESEARCH / 'a2d2b'))
from feature_contract import cosine, validate_private_destination, validate_vectors
from fresh_features import jsonl_bytes
from capture import write_frozen, json_bytes

PRIVATE = Path.home() / 'NewsFlux-STORY00/private-p4'
CORPUS = PRIVATE / 'story02-a2d2b/20261027T142244Z/r3b-systematic-v1'
P2 = PRIVATE / 'story02-a2d2c/p2-fresh-features/attempt-20261027-v1/frozen-v1'
HISTORIC = PRIVATE / '20261023-220212/r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv'
ROOT = PRIVATE / 'story02-a2d2c/p3-search-rank-v2'
INPUTS = {
 HISTORIC:'bd50a4d4e316e2bdd0b6735c1df8c3fe52f6dc14878923325dd2794cfeb3eb14',
 CORPUS/'fresh-home-corpus-v1.jsonl':'3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206',
 CORPUS/'all-crossfeed-168h-pairs.csv':'c6b7c2cb0d578ac6930965f35809daddccc0f452a5ae52b6184da4fe20dc690c',
 CORPUS/'p3-crossfeed-24h-pairs.csv':'056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec',
 P2/'fresh-feature-v2-embeddings.json':'1fd1f5335117a28549df669ee7fe0cd4b93a3d442efd970d5ca6e06cbfd31380',
 P2/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',
 P2/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e'}

def sha(data): return hashlib.sha256(data).hexdigest()
def read_csv(path):
    with path.open(newline='') as stream: return list(csv.DictReader(stream))
def main(dest):
    validate_private_destination(dest, ROOT)
    for path, expected in INPUTS.items():
        if sha(path.read_bytes()) != expected: raise ValueError('input hash mismatch')
    hrows = read_csv(HISTORIC)
    if len(hrows) != 18953: raise ValueError('historical count')
    historic = sr.historical(hrows)
    corpus = [json.loads(line) for line in (CORPUS/'fresh-home-corpus-v1.jsonl').read_text().splitlines()]
    embedding = json.loads((P2/'fresh-feature-v2-embeddings.json').read_bytes())
    if embedding['ids'] != [r['id'] for r in corpus]: raise ValueError('embedding order')
    validate_vectors(embedding['embeddings'], 500)
    vectors = dict(zip(embedding['ids'], embedding['embeddings']))
    allpairs = read_csv(CORPUS/'all-crossfeed-168h-pairs.csv')
    p3pairs = read_csv(CORPUS/'p3-crossfeed-24h-pairs.csv')
    if len(allpairs)!=119384 or len(p3pairs)!=33135: raise ValueError('pair counts')
    pairs = [(f"{r['entry_a_id']}:{r['entry_b_id']}", int(r['entry_a_id']), int(r['entry_b_id'])) for r in allpairs]
    p3keys = {f"{r['entry_a_id']}:{r['entry_b_id']}" for r in p3pairs}
    rows = [json.loads(line) for line in (P2/'fresh-p3-feature-universe-v1.jsonl').read_text().splitlines()]
    if len(rows)!=33135 or len(p3keys)!=33135 or {r['pair_key'] for r in rows}!=p3keys: raise ValueError('P3 join mismatch')
    def derive():
        ranked = sr.rank([(k,cosine(vectors[a],vectors[b])) for k,a,b in pairs])
        joined = sr.join(rows,ranked)
        return ranked, joined, jsonl_bytes(ranked), jsonl_bytes(joined)
    ranks, joined, global1, p31 = derive()
    _, _, global2, p32 = derive()
    if global1 != global2 or p31 != p32: raise ValueError('rank replay mismatch')
    limit = sr.ceiling(historic['frontier'],historic['total'],len(ranks))
    audit = {'historical': historic, 'ceiling':limit, 'p3_frontier':sr.diagnostics(joined,limit),
             'absolute_1250_noncanonical':sr.diagnostics(joined,1250), 'global_count':len(ranks),
             'p3_join_count':len(joined), 'rank_replay':'PASS', 'labels_read':False}
    artifacts = {'fresh-168h-qwen-global-rank-v1.jsonl':global1,'fresh-p3-search-rank-v2.jsonl':p31,
                 'search-rank-v2-audit.json':json_bytes(audit)}
    manifest = {'version':'STORY_02_SEARCH_RANK_V2','input_hashes':{str(p.relative_to(PRIVATE)):h for p,h in INPUTS.items()},
                'artifact_hashes':{name:sha(data) for name,data in artifacts.items()},'audit':audit}
    artifacts['search-rank-v2-manifest.json'] = json_bytes(manifest)
    hashes = write_frozen(dest, artifacts, True)
    print(json.dumps({'audit':audit,'hashes':hashes,'run1_global':sha(global1),'run2_global':sha(global2),
                      'run1_p3':sha(p31),'run2_p3':sha(p32)},sort_keys=True))
if __name__ == '__main__':
    if len(sys.argv)!=2: raise SystemExit('usage: produce.py PRIVATE_NEW_DIRECTORY')
    main(Path(sys.argv[1]))
