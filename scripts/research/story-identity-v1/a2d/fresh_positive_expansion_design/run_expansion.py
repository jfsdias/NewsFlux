"""Frozen-input label-blind frontier runner; never emits candidate identities."""
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import datetime
import expansion_frontier as e

ROOT=Path.home()/'NewsFlux-STORY00/private-p4'
D=ROOT/'story02-a2d2c'
F=ROOT/'story02-a2d2b/20261027T142244Z/r3b-systematic-v1'
P2=D/'p2-fresh-features/attempt-20261027-v1/frozen-v1'
P3=D/'p3-pack-search/attempt-20261027-r1-v1'
G=D/'p4-graph-context-retrieval/attempt-20261028-r2a-v1'
GD=D/'p4-graph-retrieval-selection/attempt-20261028-r3-v4'
C=D/'p4-miniflux-content-capability/attempt-20261028T222834435109Z'
POOL=D/'p4-fresh-positive-evidence/attempt-20261029T001530696758Z'
PACK=D/'p4-fresh-positive-neutral-review/attempt-20261029-d2f2-a/selected-positive-review-pack-v1.jsonl'
INPUTS={
 F/'p3-crossfeed-24h-pairs.csv':'056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec',
 P2/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',
 P2/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e',
 P3/'freeze-manifest-v1.json':'6538e87728aaff2d01362ac0655ee7903f01031f9f9146dd46aa640522c54399',
 P3/'dev/audit-sidecar-v1.json':'87422a83b594c87313c8613dd42dabaf25b7571cc4ca65fb853853a4e3411d29',
 P3/'blind/audit-sidecar-v1.json':'99e7faa23f0f72fceb2cfe1f0ec5bd597859b2aa14d9227d0b96b8b7798b0a9f',
 GD/'targeted-dev-graph-sidecar-v1.jsonl':'98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36',
 GD/'targeted-dev-graph-selection-manifest-v1.json':'356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5',
 G/'fresh-graph-context-features-v1.jsonl':'fe0f3372cca91d8ccbc775dac7ba97e3855c076b6ae79ae032a32b27d49223b9',
 C/'miniflux-content-capability-v1.jsonl':'510a9409470d45d700295e953149ed195a937cecdd646f81cfe241b87b745c91',
 C/'miniflux-content-capability-summary-v1.json':'e7a1d00b589932e863b4382a7694e67ed6fde8395e78a807ce534ae14a6c1254',
 POOL/'fresh-positive-candidate-pool-v1.jsonl':'8316724ca107055bf77079399e6998546eb26c09b8ec1609bec9496c26e5c024',
 POOL/'fresh-positive-capacity-frontier-v1.json':'7e37d1feb78e10e8849f793388bb401beec7facb53e1a3cb0cd67bf1377d1954',
 POOL/'fresh-positive-pool-receipt-v1.json':'13f3683abd9d6e441c09d2e07a01481bf2a9cfbaba7412fe68d63faa4126fff9',
 POOL/'fresh-positive-pool-manifest-v1.json':'bb11378dc3e9ef45c48b6049d9964801d3e245076e09d61d1c8455e48018bb61',
 PACK:'a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90'}
PRE='7e38bb7d06e04402d4f4f7ce24d6a4b248f01e40'
SOURCE_ROLES={
 'pair_universe':F/'p3-crossfeed-24h-pairs.csv',
 'p2_features':P2/'fresh-p3-feature-universe-v1.jsonl',
 'p2_manifest':P2/'feature-p2-manifest-v1.json',
 'p3_freeze_manifest':P3/'freeze-manifest-v1.json',
 'old_dev_identities':P3/'dev/audit-sidecar-v1.json',
 'blind_identities':P3/'blind/audit-sidecar-v1.json',
 'graph_dev_identities':GD/'targeted-dev-graph-sidecar-v1.jsonl',
 'graph_selection_manifest':GD/'targeted-dev-graph-selection-manifest-v1.json',
 'graph_context_features':G/'fresh-graph-context-features-v1.jsonl',
 'd2e2_capability':C/'miniflux-content-capability-v1.jsonl',
 'd2e2_capability_summary':C/'miniflux-content-capability-summary-v1.json',
 'd2f1_pool':POOL/'fresh-positive-candidate-pool-v1.jsonl',
 'd2f1_capacity_frontier':POOL/'fresh-positive-capacity-frontier-v1.json',
 'd2f1_receipt':POOL/'fresh-positive-pool-receipt-v1.json',
 'd2f1_manifest':POOL/'fresh-positive-pool-manifest-v1.json',
 'd2f2_selected_pack':PACK}

def source_pins(roles):
    if len({str(path) for path,_ in roles.values()})!=len(roles): raise ValueError('duplicate source role path')
    return {role:sha for role,(_,sha) in roles.items()}


def enc(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def digest(x):return hashlib.sha256(x).hexdigest()
def lines(data):return [json.loads(x) for x in data.splitlines() if x.strip()]
def key(a,b):
    a,b=int(a),int(b)
    if a<=0 or b<=a: raise ValueError('noncanonical identity')
    return f'{a}:{b}'

def sources():
    with e.firewall(INPUTS):
        blobs={}
        for p,h in INPUTS.items():
            if p.stat().st_mode & 0o777 != 0o444: raise ValueError('unfrozen source')
            data=p.read_bytes()
            if digest(data)!=h: raise ValueError('source hash mismatch')
            blobs[p]=data
        pairs=list(csv.DictReader(io.StringIO(blobs[F/'p3-crossfeed-24h-pairs.csv'].decode())))
        universe={key(min(int(x['entry_a_id']),int(x['entry_b_id'])), max(int(x['entry_a_id']),int(x['entry_b_id']))) for x in pairs}
        if len(pairs)!=33135 or len(universe)!=33135:raise ValueError('universe mismatch')
        features=lines(blobs[P2/'fresh-p3-feature-universe-v1.jsonl'])
        if len(features)!=33135 or {x['pair_key'] for x in features}!=universe:raise ValueError('features mismatch')
        graph_rows=lines(blobs[G/'fresh-graph-context-features-v1.jsonl']); graph={x['pair_key']:x for x in graph_rows}
        if len(graph)!=len(graph_rows) or not set(graph)<=universe:raise ValueError('graph mismatch')
        caps_rows=lines(blobs[C/'miniflux-content-capability-v1.jsonl']);caps={x['article_id']:x for x in caps_rows}
        if len(caps)!=500 or len(caps_rows)!=500:raise ValueError('capability mismatch')
        old=json.loads(blobs[P3/'dev/audit-sidecar-v1.json']);blind=json.loads(blobs[P3/'blind/audit-sidecar-v1.json']);gd=lines(blobs[GD/'targeted-dev-graph-sidecar-v1.jsonl']);pack=lines(blobs[PACK]); pool=lines(blobs[POOL/'fresh-positive-candidate-pool-v1.jsonl'])
        for rows,n in ((old,80),(blind,48),(gd,40),(pack,40),(pool,525)):
            if len(rows)!=n or len({x['pair_key'] for x in rows})!=n:raise ValueError('source count mismatch')
            if any(any(k in x for k in ('human_decision','human_label','label','title','url','content')) for x in rows):raise ValueError('forbidden source field')
        excluded_keys={x['pair_key'] for rows in (old,blind,gd,pack) for x in rows}
        if not excluded_keys<=universe:raise ValueError('exclusion outside universe')
        excluded={int(i) for k in excluded_keys for i in k.split(':')}
        pack_ids={int(i) for x in pack for i in x['pair_key'].split(':')}
        if len(pack_ids)!=80:raise ValueError('review identities mismatch')
        pool_keys={x['pair_key'] for x in pool if not ({x['article_id_a'],x['article_id_b']} & pack_ids)}
        return features,graph,caps,universe,excluded,pool_keys

def calculate(src):
    features,graph,caps,universe,excluded,pool=src
    eligible=[]; seen=set()
    for x in features:
        a,b=int(x['article_a_id']),int(x['article_b_id']); k=key(a,b)
        if k!=x['pair_key'] or k in seen:raise ValueError('feature identity mismatch')
        seen.add(k)
        if not e.eligible_ids(a,b,excluded,universe):continue
        if x['feed_a_id']==x['feed_b_id'] or not 0<=x['temporal_delta_hours']<=24:raise ValueError('scope mismatch')
        if a not in caps or b not in caps or k not in graph:raise ValueError('missing metadata')
        if caps[a]['content_status']!='USABLE' or caps[b]['content_status']!='USABLE':continue
        for field in ('qwen_score','lexical_overlap','entity_anchor_overlap','number_overlap','date_overlap','temporal_delta_hours'):
            if isinstance(x[field],bool) or not isinstance(x[field],(int,float)) or not math.isfinite(x[field]):raise ValueError('invalid feature')
        support=graph[k]['shared_support_feed_count']
        if isinstance(support,bool) or not isinstance(support,int) or support<0:raise ValueError('invalid support')
        eligible.append({'a':a,'b':b,'qwen':x['qwen_score'],'support':support,'lexical':x['lexical_overlap'],'entity':x['entity_anchor_overlap'],'number':x['number_overlap'],'date':x['date_overlap'],'gap':x['temporal_delta_hours'],'feed':sorted((x['feed_a_id'],x['feed_b_id'])),'category':sorted((x['category_a'],x['category_b'])),'equiv':caps[a]['content_equals_title'] is True or caps[b]['content_equals_title'] is True})
    q={'.'+str(n / 100).split('.')[1]:e.quantile([x['qwen'] for x in eligible],n/100) for n in (60,70,75,80,90)}
    rows=[]
    for x in eligible:
        memberships=e.memberships(x,q)
        if key(x['a'],x['b']) in pool:memberships.add('B0')
        if memberships:rows.append(dict(x,strategy_membership=sorted(memberships)))
    if {key(x['a'],x['b']) for x in rows if 'B0' in x['strategy_membership']}!=pool:raise ValueError('B0 not fully eligible')
    rows.sort(key=e.rank)
    summaries={}
    for name in ('B0','B1','B2','B3','B4','B5'):
        sub=[x for x in rows if name in x['strategy_membership']]
        summaries[name]=e.safe_metrics(e.metrics(sub))
        summaries[name].update(e.threshold_metadata(name,q))
    return rows,{'quantiles':q,'strategies':summaries,'non_dominated':['B0','B1','B2','B3','B4','B5'],'minimum_additional_positives_required':5,'expected_positive_yield':'NOT_ESTIMATED','feasible':any(x['logical_capacity_gate'] for x in summaries.values())}


def main():
    from validate_expansion_frontier import validate
    current=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    subprocess.run(['git','merge-base','--is-ancestor',PRE,current],check=True)
    doc=Path(__file__).with_name('EXPANSION_DESIGN.md')
    contract_data=subprocess.check_output(['git','show',PRE+':scripts/research/story-identity-v1/a2d/fresh_positive_expansion_design/EXPANSION_DESIGN.md'])
    if contract_data != doc.read_bytes():raise ValueError('contract differs from preregistration')
    src=sources()
    with e.firewall(INPUTS):
        rows,front=calculate(src)
        second_rows,second_front=calculate((list(reversed(src[0])),*src[1:]))
        data=b''.join(enc(x) for x in rows); frontier=enc(front)
        if data!=b''.join(enc(x) for x in second_rows) or frontier!=enc(second_front):raise ValueError('replay mismatch')
        validate(src,rows,front)
    output=D/'p4-fresh-positive-expansion-design'
    output.mkdir(mode=0o700,exist_ok=True)
    if output.stat().st_mode & 0o077 or output.is_symlink():raise ValueError('unsafe output parent')
    attempt=output/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    attempt.mkdir(mode=0o700)
    contract=enc({'version':'D2F6_V1','preregistration_sha':PRE,'design_sha256':digest(contract_data),'input_sha256':source_pins({role:(path,INPUTS[path]) for role,path in SOURCE_ROLES.items()})})
    receipt=enc({'version':'D2F6_V1','schema_version':'D2F6_THRESHOLD_REPORTING_V2','schema_erratum_commit_sha':'f58bee9870f11e30a1b26de2791d5b37838827ea','replay':'PASS','independent_validator':'PASS','prior_review_article_overlap':0,'human_label_accesses':0,'d2f5_private_analysis_accesses':0,'network_requests':0,'review_pack_created':False,'model_calls':0,'benchmark_runs':0})
    artifacts={'fresh-positive-expansion-contract-v1.json':contract,'fresh-positive-expansion-candidates-v1.jsonl':data,'fresh-positive-expansion-frontier-v1.json':frontier,'fresh-positive-expansion-receipt-v1.json':receipt}
    manifest=enc({'version':'D2F6_V1','schema_version':'D2F6_THRESHOLD_REPORTING_V2','schema_erratum_commit_sha':'f58bee9870f11e30a1b26de2791d5b37838827ea', 'input_sha256':source_pins({role:(path,INPUTS[path]) for role,path in SOURCE_ROLES.items()}),'sha256':{name:digest(value) for name,value in artifacts.items()}})
    artifacts['fresh-positive-expansion-manifest-v1.json']=manifest
    with e.firewall(set(INPUTS)|{attempt/name for name in artifacts}):
        for name,value in artifacts.items():
            path=attempt/name
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as handle:handle.write(value);handle.flush();os.fsync(handle.fileno())
            os.chmod(path,0o444)
            if path.stat().st_mode & 0o777!=0o444 or digest(path.read_bytes())!=digest(value):raise ValueError('freeze verification failed')
    print(json.dumps({'attempt':str(attempt),'frontier':front,'sha256':{name:digest(value) for name,value in artifacts.items()},'preregistration':PRE},sort_keys=True))

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('D2F6_STOP='+type(exc).__name__+': '+str(exc),file=sys.stderr)
        sys.exit(1)
