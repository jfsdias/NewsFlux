"""Bounded deterministic prospective adapter over historical component search."""
import hashlib
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'targeted_gold'))
from component_search import search_components
from joint_search import SearchRules
import validator

SEED=20261026
# Preregistered nested search frontiers: chain-edge and per-bucket limits.
FRONTIERS=((80,75),(160,125),(240,175))

def order(row):
    return hashlib.sha256(f"{SEED}:P3R1:{row['pair_key']}".encode()).digest()

def frontier(rows, chain_cap, bucket_cap):
    # The unbounded general input stays intact. The solver library is bounded;
    # this limitation does not imply infeasibility.
    chosen={}
    for row in sorted((r for r in rows if r['search_rank_v2']<=validator.CEILING),key=order)[:chain_cap]:
        chosen[row['pair_key']]=row
    for bucket in validator.BLIND:
        for row in sorted((r for r in rows if r['primary_bucket']==bucket),key=order)[:bucket_cap]:
            chosen[row['pair_key']]=row
    return sorted(chosen.values(),key=order)

def attempt(rows, chain_cap, bucket_cap):
    pool=frontier(rows,chain_cap,bucket_cap)
    # Compatibility adapter exists only in this new path. Non-chain entries
    # keep their real V2 rank and remain eligible as ordinary motif edges.
    adapted=[dict(r,best_rank=r['search_rank_v2']) for r in pool]
    dev=[dict(r,best_rank=r['search_rank_v2']) for r in rows]
    rules=SearchRules(chain_rank_ceiling=validator.CEILING)
    result=search_components(adapted,dev,rules=rules,seed=SEED,node_limit=500,
                             restarts=1,variants=1,solver_seconds=20,max_candidate_attempts=1)
    return result, pool
