"""Offline private D2F7 selection and freeze; no labels or content."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import networkx as nx
import select_expansion_pack as selector
import validate_expansion_pack as validator

sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'fresh_positive_expansion_design'))
from expansion_frontier import firewall

ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c'
SOURCE=ROOT/'p4-fresh-positive-expansion-design/attempt-20261029T161838927664Z'
P3=ROOT/'p3-pack-search/attempt-20261027-r1-v1'
GD=ROOT/'p4-graph-retrieval-selection/attempt-20261028-r3-v4'
PREVPACK=ROOT/'p4-fresh-positive-neutral-review/attempt-20261029-d2f2-a/selected-positive-review-pack-v1.jsonl'
FILES={'contract':'fresh-positive-expansion-contract-v1.json','candidates':'fresh-positive-expansion-candidates-v1.jsonl','frontier':'fresh-positive-expansion-frontier-v1.json','receipt':'fresh-positive-expansion-receipt-v1.json','manifest':'fresh-positive-expansion-manifest-v1.json'}
PRIOR={P3/'dev/audit-sidecar-v1.json':'87422a83b594c87313c8613dd42dabaf25b7571cc4ca65fb853853a4e3411d29',P3/'blind/audit-sidecar-v1.json':'99e7faa23f0f72fceb2cfe1f0ec5bd597859b2aa14d9227d0b96b8b7798b0a9f',GD/'targeted-dev-graph-sidecar-v1.jsonl':'98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36',PREVPACK:'a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90'}
PREREG='cd152ada39c4418ffc38a1bc58d420d72e2670c3'
ERRATUM='c11db01f2174c748b058450d07fc2e1d0e8bb81f'
HERE=Path(__file__).resolve().parent

def digest(data):return hashlib.sha256(data).hexdigest()
def encode(x):return validator.canonical(x)
def lines(data):return [json.loads(x) for x in data.splitlines() if x.strip()]

def load_sources():
    contract=json.loads((HERE/'pack-contract-v1.json').read_text())
    paths={SOURCE/name for name in FILES.values()}|set(PRIOR)
    with firewall(paths):
        data={}
        for role,name in FILES.items():
            p=SOURCE/name
            if p.stat().st_mode & 0o777 != 0o444:raise ValueError('SOURCE_MODE')
            blob=p.read_bytes()
            if digest(blob)!=contract['source_sha256'][role]:raise ValueError('SOURCE_HASH')
            data[role]=blob
        prior={}
        for p,sha in PRIOR.items():
            if p.stat().st_mode & 0o777!=0o444 or digest(blob:=p.read_bytes())!=sha:raise ValueError('PRIOR_HASH_OR_MODE')
            prior[p]=blob
        frozen_manifest=json.loads(data['manifest'])
        for role in ('contract','candidates','frontier','receipt'):
            if frozen_manifest['sha256'][FILES[role]]!=digest(data[role]):raise ValueError('SOURCE_MANIFEST')
        groups=[json.loads(prior[P3/'dev/audit-sidecar-v1.json']),json.loads(prior[P3/'blind/audit-sidecar-v1.json']),lines(prior[GD/'targeted-dev-graph-sidecar-v1.jsonl']),lines(prior[PREVPACK])]
        if [len(x) for x in groups]!=[80,48,40,40]:raise ValueError('PRIOR_COUNT')
        excluded=set()
        for group in groups:
            for row in group:
                if any(k in row for k in ('human_decision','label','title','url','content')):raise ValueError('NON_NEUTRAL_SOURCE')
                a,b=map(int,row['pair_key'].split(':'));excluded.update((a,b))
        return lines(data['candidates']),json.loads(data['frontier']),excluded,contract

def generate(rows,frontier,excluded,contract):
    b1=[x for x in rows if 'B1' in x['strategy_membership']]
    ordered=sorted(b1,key=selector.rank)
    if len(ordered)!=36 or len({(x['a'],x['b']) for x in ordered})!=36:raise ValueError('B1_COUNT')
    selected,ranks,trace=selector.select(ordered,11)
    pack=[{'selection_position':i,'b1_rank':rank,'pair_key':f"{x['a']}:{x['b']}",'article_id_a':x['a'],'article_id_b':x['b'],'qwen_score':x['qwen'],'supporting_feed_count':x['support'],'lexical_overlap':x['lexical'],'temporal_delta_hours':x['gap'],'strategy_membership':x['strategy_membership']} for i,(rank,x) in enumerate(zip(ranks,selected),1)]
    proof={'pack_size':11,'b1_input_pair_count':36,'b1_max_matching_capacity':11,'canonical_rank':contract['rank'],'selected_rank_vector':ranks,'selected_rank_vector_sha256':digest(encode(ranks)),'feasibility_trace':trace,'networkx_version':nx.__version__,'algorithm_version':'LEXICOGRAPHIC_RANK_BY_FEASIBILITY_ORACLE_V1'}
    # Descriptive component count in the selected B1 source graph, without quotas.
    g=nx.Graph();g.add_edges_from((x['a'],x['b']) for x in ordered)
    comps=list(nx.connected_components(g));components=sum(any(x['a'] in c for x in selected) for c in comps)
    audit={'selected_pair_count':len(pack),'selected_unique_article_count':len({v for x in pack for v in (x['article_id_a'],x['article_id_b'])}),'prior_review_article_overlap':sum(v in excluded for x in pack for v in (x['article_id_a'],x['article_id_b'])),'selected_component_count':components,'selected_feed_count':len({v for x in selected for v in x['feed']}),'selected_category_count':len({v for x in selected for v in x['category']})}
    validator.validate(rows,frontier,excluded,pack,proof,audit)
    return pack,proof,audit

def main():
    head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    subprocess.run(['git','merge-base','--is-ancestor',PREREG,ERRATUM],check=True)
    subprocess.run(['git','merge-base','--is-ancestor',ERRATUM,head],check=True)
    contract_path=HERE/'pack-contract-v1.json'
    rel='scripts/research/story-identity-v1/a2d/fresh_positive_expansion_pack/pack-contract-v1.json'
    if subprocess.check_output(['git','show',ERRATUM+':'+rel])!=contract_path.read_bytes():raise ValueError('PREREGISTRATION')
    validator.verify_effective_pins(Path.cwd(),SOURCE)
    src1=load_sources();src2=load_sources()
    with firewall(set()):
        pack,proof,audit=generate(*src1);pack2,proof2,audit2=generate(*src2)
        if (encode(pack),encode(proof),encode(audit))!=(encode(pack2),encode(proof2),encode(audit2)):raise ValueError('REPLAY')
        validator.validate(*src2[:3],pack,proof,audit)
    old_path=ROOT/'p4-fresh-positive-expansion-pack/attempt-20261029T171109184369Z/b1-selected-pack-v1.jsonl'
    with firewall({old_path}):
        old_bytes=old_path.read_bytes()
    if digest(old_bytes)!='355fcb988b9a7444355b19d5c738c2767ad42665a5caf9ef3b786ee15b05a03f' or old_path.stat().st_mode & 0o777!=0o444:raise ValueError('OLD_ATTEMPT_INTEGRITY')
    old=lines(old_bytes)
    projection=('selection_position','b1_rank','pair_key','article_id_a','article_id_b')
    if [[x[k] for k in projection] for x in old]!=[[x[k] for k in projection] for x in pack]:raise ValueError('IDENTITY_PROJECTION')
    if [x['b1_rank'] for x in old]!=proof['selected_rank_vector'] or proof['selected_rank_vector_sha256']!='ac2e4b36468d032cfca81a267866c046a182461c5e79f6f181a026b61917d034':raise ValueError('RANK_VECTOR')
    pack_data=b''.join(encode(x) for x in pack)
    receipt={'preregistration_sha':PREREG,'input_pin_erratum_sha':ERRATUM,'replay':'PASS','independent_validator':'PASS','review_pack_created':False,'human_review_started':False,'human_decisions':0,'expected_positive_yield':'NOT_ESTIMATED','previous_attempt_exists':True,'previous_attempt_canonical':False,'previous_attempt_failure':'PRIVATE_PACK_SCHEMA_TEXT_CATEGORY_METADATA','corrective_run_selection_identical':True,'scientific_selection_changed':False,'output_schema_corrected':True,'pack_schema_version':'D2F7_SELECTED_PACK_MINIMAL_V1'}
    payload={'b1-expansion-pack-contract-v1.json':contract_path.read_bytes(),'b1-selected-pack-v1.jsonl':pack_data,'b1-selection-proof-v1.json':encode(proof),'b1-pack-audit-v1.json':encode(audit),'b1-pack-receipt-v1.json':encode(receipt)}
    payload['b1-pack-manifest-v1.json']=encode({'sha256':{k:digest(v) for k,v in payload.items()},'source_sha256':src1[3]['source_sha256'],'preregistration_sha':PREREG,'input_pin_erratum_sha':ERRATUM})
    base=ROOT/'p4-fresh-positive-expansion-pack';base.mkdir(mode=0o700,exist_ok=True)
    if base.is_symlink() or base.stat().st_mode & 0o077:raise ValueError('OUTPUT_PARENT')
    attempt=base/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));attempt.mkdir(mode=0o700)
    for name,blob in payload.items():
        path=attempt/name
        with tempfile.NamedTemporaryFile(dir=attempt,delete=False) as f:
            f.write(blob);f.flush();os.fsync(f.fileno());temp=Path(f.name)
        os.chmod(temp,0o444)
        if path.exists():raise ValueError('OUTPUT_EXISTS')
        os.link(temp,path);os.unlink(temp)
        if path.stat().st_mode & 0o777!=0o444 or digest(path.read_bytes())!=digest(blob):raise ValueError('FREEZE')
    manifest=json.loads((attempt/'b1-pack-manifest-v1.json').read_bytes())
    for name,sha in manifest['sha256'].items():
        if digest((attempt/name).read_bytes())!=sha:raise ValueError('POST_FREEZE_HASH')
    validator.verify_effective_pins(Path.cwd(),SOURCE)
    frozen=lines((attempt/'b1-selected-pack-v1.jsonl').read_bytes())
    validator.validate(*load_sources()[:3],frozen,json.loads((attempt/'b1-selection-proof-v1.json').read_bytes()),json.loads((attempt/'b1-pack-audit-v1.json').read_bytes()))
    print(json.dumps({'attempt':str(attempt),'audit':audit,'rank_vector_sha256':proof['selected_rank_vector_sha256'],'sha256':{k:digest(v) for k,v in payload.items()}},sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('D2F7_STOP='+type(exc).__name__+': '+str(exc),file=sys.stderr);sys.exit(1)
