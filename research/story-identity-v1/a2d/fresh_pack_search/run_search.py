"""Execute preregistered label-free bounded frontiers, emitting aggregates only."""
import hashlib
import json
from pathlib import Path
from collections import Counter
import search

P=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c'
F=P/'p2-fresh-features/attempt-20261027-v1/frozen-v1'
R=P/'p3-search-rank-v2/attempt-20261027-v1'
INPUTS={F/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',
 F/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e',
 R/'fresh-168h-qwen-global-rank-v1.jsonl':'9df82e15d8fa65bba9bb726cb3c70b65871dc82f972fd91a5c86c24ce7e210d6',
 R/'fresh-p3-search-rank-v2.jsonl':'a6db023e7adf4e85b96222c2f21495a9f877ae85ed484e17a89950f3bda1ad02',
 R/'search-rank-v2-audit.json':'01405c843da70a67fa5cfb17fd4f8a4fa99412f7758083f4e206bf05cbd0db8b',
 R/'search-rank-v2-manifest.json':'c6a451a93dbd0f3d34e9d720f0462c1bf93a2be3aa484c1640883b76730db114'}

def load():
    for p,h in INPUTS.items():
        if hashlib.sha256(p.read_bytes()).hexdigest()!=h: raise ValueError('input hash mismatch')
    a=[json.loads(x) for x in (F/'fresh-p3-feature-universe-v1.jsonl').read_text().splitlines()]
    b=[json.loads(x) for x in (R/'fresh-p3-search-rank-v2.jsonl').read_text().splitlines()]
    ak={r['pair_key'] for r in a};bk={r['pair_key'] for r in b}
    if len(a)!=33135 or len(b)!=33135 or len(ak)!=33135 or ak!=bk: raise ValueError('pair set')
    old={r['pair_key']:r for r in a}
    if any({k:v for k,v in r.items() if k!='search_rank_v2'}!=old[r['pair_key']] for r in b): raise ValueError('changed features')
    audit=json.loads((F/'feature-p2-manifest-v1.json').read_bytes())['audit']
    if any(audit[k]!=0 for k in ('home_overlap','gold_article_overlap','gold_pair_overlap')): raise ValueError('historical overlap')
    return b

def main():
    rows=load(); outcomes=[]
    for chain_cap,bucket_cap in search.FRONTIERS:
        result,pool=search.attempt(rows,chain_cap,bucket_cap)
        summary={'chain_cap':chain_cap,'per_bucket_cap':bucket_cap,'pool_size':len(pool),
                 'status':result['status'],'inventory':result['inventory'],
                 'certificate':result['certificate'],'solver':result['solver'],'solver_version':result['solver_version']}
        outcomes.append(summary)
        print(json.dumps(summary,sort_keys=True),flush=True)
        if result['feasible_witness_found']:
            # Never freeze without a replay, independent validation and blinding.
            print(json.dumps({'status':'WITNESS_NEEDS_REPLAY_VALIDATION_FREEZE','frozen':False}),flush=True)
            return
    print(json.dumps({'status':'COMPONENT_SEARCH_LIMIT_REACHED','search_complete':False,'frozen':False}),flush=True)

if __name__=='__main__': main()
