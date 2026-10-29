"""Independent reconstruction of phase A, without article metadata."""
import collections, json, pathlib, sys
from exact_k_matching import capacity, exact_k_matching
from select_review_pack import source, FILES, digest, canon, freeze

def validate(target):
    target=pathlib.Path(target);source_path=source();raw=(source_path/next(iter(FILES))).read_bytes()
    pool=[json.loads(x) for x in raw.splitlines()]
    groups=collections.defaultdict(list)
    for row in pool:groups[row['component_id']].append(row)
    groups=sorted(groups.values(),key=lambda g:-len(g))
    if [len(g) for g in groups]!=[408,115,1,1] or [capacity(g) for g in groups]!=[35,17,1,1]:raise ValueError('source structure')
    expected=[]; traces=[]
    for group,k in zip(groups,[21,17,1,1]):
        chosen,trace=exact_k_matching(group,k);expected.extend(chosen);traces.append(trace)
    expected.sort(key=lambda r:r['deterministic_rank'])
    actual=[json.loads(x) for x in (target/'selected-positive-review-pack-v1.jsonl').read_bytes().splitlines()]
    if len(actual)!=40 or [r['pair_key'] for r in actual]!=[r['pair_key'] for r in expected]:raise ValueError('selected identities mismatch')
    if len({i for r in actual for i in (r['article_id_a'],r['article_id_b'])})!=80:raise ValueError('article overlap')
    for a,e in zip(actual,expected):
        if a['source_pool_rank']!=e['deterministic_rank'] or any(a[x]!=e[x] for x in ('article_id_a','article_id_b','component_id','lane_primary','lane_membership','both_content_usable','title_equivalent_article_present')):raise ValueError('selected metadata')
        if set(a)!={'pair_key','article_id_a','article_id_b','component_id','lane_primary','lane_membership','both_content_usable','title_equivalent_article_present','source_pool_rank'}:raise ValueError('unexpected field')
    proof=json.loads((target/'exact-k-proof-v1.json').read_bytes())
    if any(proof[i]['trace_sha256']!=digest(canon(t)) for i,t in enumerate(traces)):raise ValueError('trace mismatch')
    trace_path=target/'exact-k-private-trace-v1.json'
    if trace_path.exists():
        if trace_path.read_bytes()!=canon(traces):raise ValueError('private trace mismatch')
    else:freeze(trace_path,canon(traces))
    return {'selected_pack_validator':'PASS','selection_replay':'PASS','private_trace':'FROZEN','selected_pair_count':len(actual)}
if __name__=='__main__':print(json.dumps(validate(sys.argv[1]),sort_keys=True))
