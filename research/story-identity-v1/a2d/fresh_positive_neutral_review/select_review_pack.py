"""Phase A: freeze selected identities without reading reviewer metadata."""
import collections, hashlib, json, os, pathlib, sys
from exact_k_matching import capacity, exact_k_matching

ROOT = pathlib.Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-positive-evidence'
OUT = pathlib.Path.home() / 'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-positive-neutral-review'
FILES = {'fresh-positive-candidate-pool-v1.jsonl':'8316724ca107055bf77079399e6998546eb26c09b8ec1609bec9496c26e5c024','fresh-positive-capacity-frontier-v1.json':'7e37d1feb78e10e8849f793388bb401beec7facb53e1a3cb0cd67bf1377d1954','fresh-positive-pool-receipt-v1.json':'13f3683abd9d6e441c09d2e07a01481bf2a9cfbaba7412fe68d63faa4126fff9','fresh-positive-pool-manifest-v1.json':'bb11378dc3e9ef45c48b6049d9964801d3e245076e09d61d1c8455e48018bb61'}
def digest(data): return hashlib.sha256(data).hexdigest()
def canon(x): return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def source():
    matches=[]
    for p in ROOT.glob('attempt-*'):
        if all((p/n).is_file() and digest((p/n).read_bytes())==h for n,h in FILES.items()): matches.append(p)
    if len(matches)!=1: raise ValueError('source missing or ambiguous')
    return matches[0]
def select(rows):
    c=collections.defaultdict(list)
    for row in rows:c[row['component_id']].append(row)
    groups=sorted(c.values(),key=lambda x:-len(x))
    if [len(x) for x in groups]!=[408,115,1,1]:raise ValueError('component structure drift')
    capacities=[capacity(g) for g in groups]
    if capacities != [35,17,1,1]:raise ValueError('capacity drift')
    allocations=[(a,38-a) for a in range(39) if a<=capacities[0] and 38-a<=capacities[1]]
    allocations.sort(key=lambda a:(-min(a),abs(a[0]-a[1])))
    if not allocations or allocations[0]!=(21,17):raise ValueError('allocation drift')
    selected=[];proof=[]
    for group,k in zip(groups,[21,17,1,1]):
        chosen,trace=exact_k_matching(group,k)
        selected.extend(chosen)
        ranks=[e['deterministic_rank'] for e in chosen]
        proof.append({'target':k,'capacity':capacity(group),'rank_vector_sha256':digest(canon(ranks)),'rank_min':min(ranks),'rank_max':max(ranks),'trace_sha256':digest(canon(trace))})
    selected.sort(key=lambda r:r['deterministic_rank'])
    if len(selected)!=40 or len({x for r in selected for x in (r['article_id_a'],r['article_id_b'])})!=80:raise ValueError('selection integrity')
    fields=['pair_key','article_id_a','article_id_b','component_id','lane_primary','lane_membership','both_content_usable','title_equivalent_article_present']
    packed=[{**{k:r[k] for k in fields},'source_pool_rank':r['deterministic_rank']} for r in selected]
    return packed,proof

def freeze(path,data):
    if path.exists():raise FileExistsError(path)
    tmp=path.with_name('.'+path.name+'.tmp')
    with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    if digest(tmp.read_bytes())!=digest(data):raise ValueError('hash mismatch')
    os.replace(tmp,path);path.chmod(0o444)
    if digest(path.read_bytes())!=digest(data):raise ValueError('readback mismatch')

def run(target):
    target=pathlib.Path(target).resolve()
    if not target.is_relative_to(OUT.resolve()) or target.exists():raise ValueError('invalid private destination')
    p=source(); rows=[json.loads(x) for x in (p/next(iter(FILES))).read_bytes().splitlines()]
    result,proof=select(rows);result2,proof2=select(rows)
    if (result,proof)!=(result2,proof2):raise ValueError('replay mismatch')
    target.mkdir(parents=True,mode=0o700)
    data=b''.join(canon(x) for x in result)
    freeze(target/'selected-positive-review-pack-v1.jsonl',data)
    freeze(target/'exact-k-proof-v1.json',canon(proof))
    return {'selected_pack_sha256':digest(data),'proof':proof,'selected_pair_count':len(result)}
if __name__=='__main__':
    print(json.dumps(run(sys.argv[1]),sort_keys=True))
