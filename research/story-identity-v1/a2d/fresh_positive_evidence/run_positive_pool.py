"""One authorized offline pool generation after the preregistration commit."""
import builtins
import contextlib
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch

import build_positive_candidate_pool as builder
import validate_positive_candidate_pool as validator

HERE=Path(__file__).resolve().parent
PRIVATE=Path.home()/'NewsFlux-STORY00/private-p4'
FRESH=PRIVATE/'story02-a2d2b/20261027T142244Z/r3b-systematic-v1'
D2C=PRIVATE/'story02-a2d2c'
P2=D2C/'p2-fresh-features/attempt-20261027-v1/frozen-v1'
P3=D2C/'p3-pack-search/attempt-20261027-r1-v1'
GRAPH=D2C/'p4-graph-context-retrieval/attempt-20261028-r2a-v1'
GDEV=D2C/'p4-graph-retrieval-selection/attempt-20261028-r3-v4'
CAP=D2C/'p4-miniflux-content-capability/attempt-20261028T222834435109Z'
D2F=HERE.parent/'content_aware_event_signal_benchmark'
CONTRACT=HERE/'positive-evidence-contract-v1.json'
OUTPUT=D2C/'p4-fresh-positive-evidence'
FORBIDDEN={'story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','graph-dev-human-labels-v1.jsonl','story02-d2b-human-completed.csv','graph-dev-joined-v1.jsonl','fresh-content-enrichment-v1.jsonl','dev-pair-diagnostics-v1.jsonl','review-session-v1-human-completed.csv','graph-dev-human-completed.csv'}
INPUTS={
 FRESH/'fresh-home-corpus-v1.jsonl':'3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206',
 FRESH/'p3-crossfeed-24h-pairs.csv':'056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec',
 P2/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',
 P2/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e',
 P3/'freeze-manifest-v1.json':'6538e87728aaff2d01362ac0655ee7903f01031f9f9146dd46aa640522c54399',
 P3/'dev/audit-sidecar-v1.json':'87422a83b594c87313c8613dd42dabaf25b7571cc4ca65fb853853a4e3411d29',
 P3/'blind/audit-sidecar-v1.json':'99e7faa23f0f72fceb2cfe1f0ec5bd597859b2aa14d9227d0b96b8b7798b0a9f',
 GDEV/'targeted-dev-graph-sidecar-v1.jsonl':'98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36',
 GDEV/'targeted-dev-graph-selection-manifest-v1.json':'356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5',
 GRAPH/'fresh-graph-context-features-v1.jsonl':'fe0f3372cca91d8ccbc775dac7ba97e3855c076b6ae79ae032a32b27d49223b9',
 CAP/'miniflux-content-capability-v1.jsonl':'510a9409470d45d700295e953149ed195a937cecdd646f81cfe241b87b745c91',
 CAP/'miniflux-content-capability-summary-v1.json':'e7a1d00b589932e863b4382a7694e67ed6fde8395e78a807ce534ae14a6c1254',
 D2F/'benchmark-contract-v1.json':'adb4c5a670acab6292fce2c12343fc9bf8e40dc2ab365cda1cec06646c2f4317',
 D2F/'benchmark-contract-manifest-v1.json':'014441aed43317b06b9a40b8d1afdc60d5f1a25f6c958433e29296cbbaffe77e'}


def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return (json.dumps(obj,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False)+'\n').encode()


@contextlib.contextmanager
def firewall():
    def wrap(fn):
        def check(path,*args,**kwargs):
            s=str(path)
            if Path(s).name in FORBIDDEN or 'source-payloads' in s:raise PermissionError('forbidden private source')
            return fn(path,*args,**kwargs)
        return check
    def deny(*args,**kwargs):raise PermissionError('network disabled during pool generation')
    with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(Path,'open',wrap(Path.open)),patch.object(Path,'read_bytes',wrap(Path.read_bytes)),patch.object(Path,'read_text',wrap(Path.read_text)),patch.object(socket,'create_connection',deny),patch.object(socket.socket,'connect',deny):yield


def validate_contract(contract):
    expected = {
        'version':'STORY_02_D2F1_POSITIVE_EVIDENCE_V1',
        'track':'STORY_02_A2D2C_P4_D2F1_FRESH_POSITIVE_EVIDENCE_DESIGN',
        'base_main_sha':'9c719e8f3af6afc0555cb6635e7d491217cc9bd0',
        'selection_role':'CALIBRATION_DEV_AUGMENT_ONLY',
        'label_policy':'NO_ROW_LEVEL_HUMAN_DECISIONS',
        'blind_policy':'SEALED_PRELABEL_IDENTITIES_EXCLUSION_ONLY',
        'existing_pack_exclusion_policy':'STRICT_ARTICLE_AND_PAIR_DISJOINT_ALL_THREE_PACKS',
        'content_eligibility_policy':'BOTH_USABLE; TITLE_EQUIVALENT_RETAINED_AND_REPORTED',
        'quantile_policy':'LINEAR_INTERPOLATION_Q75_Q90_OVER_STRICTLY_ELIGIBLE_BOTH_USABLE_UNIVERSE_BEFORE_LANE_SELECTION',
        'ranking_policy':'QWEN_DESC; GRAPH_FEED_SUPPORT_DESC; LEXICAL_DESC; HOURS_ASC; NUMERIC_PAIR_ASC',
        'matching_runtime':'PYTHON_3.14.7_NETWORKX_3.4.2_MAX_WEIGHT_MAX_CARDINALITY',
        'pair_universe_count':33135,
        'human_label_access':False,'benchmark_execution':False,'model_inference':False,'article_content_access':False,'blind_access':False,
        'lane_priority':list(builder.LANES),
        'lane_definitions':{'STRONG_CONSENSUS':'QWEN>=Q90 AND LEXICAL>=0.05 AND ANY_ENTITY_NUMBER_DATE','GRAPH_SUPPORTED_EVENT':'QWEN>=Q75 AND SHARED_SUPPORT_FEEDS>=2','CROSS_SOURCE_PARAPHRASE':'QWEN>=Q90 AND LEXICAL<0.05 AND (NUMBER OR DATE) AND SHARED_SUPPORT_FEEDS>=1','POSITIVE_BOUNDARY':'QWEN>=Q90 AND LEXICAL<0.05 AND HOURS<=4 AND ENTITY>0 AND NUMBER=DATE=0'},
    }
    if any(contract.get(k)!=v for k,v in expected.items()):raise ValueError('selection contract mismatch')
    pins={
      'd2f_contract_sha256':D2F/'benchmark-contract-v1.json','d2f_manifest_sha256':D2F/'benchmark-contract-manifest-v1.json',
      'corpus_sha256':FRESH/'fresh-home-corpus-v1.jsonl','pair_universe_sha256':FRESH/'p3-crossfeed-24h-pairs.csv',
      'd2e2_capability_sha256':CAP/'miniflux-content-capability-v1.jsonl','d2e2_summary_sha256':CAP/'miniflux-content-capability-summary-v1.json',
      'p2_features_sha256':P2/'fresh-p3-feature-universe-v1.jsonl','p2_manifest_sha256':P2/'feature-p2-manifest-v1.json',
      'p3_freeze_manifest_sha256':P3/'freeze-manifest-v1.json','prelabel_old_dev_sha256':P3/'dev/audit-sidecar-v1.json',
      'prelabel_blind_identity_sha256':P3/'blind/audit-sidecar-v1.json','prelabel_graph_dev_sha256':GDEV/'targeted-dev-graph-sidecar-v1.jsonl',
      'graph_selection_manifest_sha256':GDEV/'targeted-dev-graph-selection-manifest-v1.json','graph_context_sha256':GRAPH/'fresh-graph-context-features-v1.jsonl'}
    if any(contract.get(k)!=INPUTS[v] for k,v in pins.items()):raise ValueError('selection provenance mismatch')


def verify_inputs():
    for p,expected in INPUTS.items():
        with p.open('rb') as f:
            h=hashlib.sha256()
            for block in iter(lambda:f.read(1048576),b''):h.update(block)
        if h.hexdigest()!=expected:raise ValueError('pinned input mismatch')
        if p.is_relative_to(PRIVATE) and p.stat().st_mode&0o777!=0o444:raise ValueError('input not frozen')
    contract=json.loads(CONTRACT.read_text())
    validate_contract(contract)
    if sys.version_info[:3]!=(3,14,7):raise ValueError('unregistered interpreter')
    return contract


def jsonl(path):
    with path.open() as f:return [json.loads(line) for line in f if line.strip()]


def prelabel_keys(path,expected,kind):
    values=json.loads(path.read_text()) if kind=='json' else jsonl(path)
    if len(values)!=expected:raise ValueError('prelabel count')
    result=set()
    for row in values:
        if any(k in row for k in ('human_decision','human_label','label','title','url','content')):raise ValueError('non-neutral prelabel source')
        a,b=map(int,str(row['pair_key']).split(':'));result.add(builder.key(a,b))
    if len(result)!=expected:raise ValueError('prelabel duplicate')
    return result


def load_sources():
    with (FRESH/'p3-crossfeed-24h-pairs.csv').open(newline='') as f:
        pair_rows=list(csv.DictReader(f))
    keys={builder.key(r['entry_a_id'],r['entry_b_id']) for r in pair_rows}
    if len(pair_rows)!=33135 or len(keys)!=33135:raise ValueError('pair universe cardinality')
    features=jsonl(P2/'fresh-p3-feature-universe-v1.jsonl')
    if len(features)!=33135 or {r['pair_key'] for r in features}!=keys:raise ValueError('feature universe membership')
    graph_rows=jsonl(GRAPH/'fresh-graph-context-features-v1.jsonl');graph={r['pair_key']:r for r in graph_rows}
    if len(graph)!=len(graph_rows) or not set(graph)<=keys:raise ValueError('graph provenance')
    cap_rows=jsonl(CAP/'miniflux-content-capability-v1.jsonl');caps={r['article_id']:r for r in cap_rows}
    if len(cap_rows)!=500 or len(caps)!=500 or sum(r['content_status']=='USABLE' for r in cap_rows)!=486:raise ValueError('content metadata')
    old=prelabel_keys(P3/'dev/audit-sidecar-v1.json',80,'json')
    blind=prelabel_keys(P3/'blind/audit-sidecar-v1.json',48,'json')
    gdev=prelabel_keys(GDEV/'targeted-dev-graph-sidecar-v1.jsonl',40,'jsonl')
    excluded_pairs=old|blind|gdev
    excluded_articles={int(i) for k in excluded_pairs for i in k.split(':')}
    if not (old|blind|gdev)<=keys:raise ValueError('exclusion identity not in universe')
    eligible=[x for x in features if x['article_a_id'] not in excluded_articles and x['article_b_id'] not in excluded_articles and x['pair_key'] not in excluded_pairs]
    if any(x['pair_key'] not in graph for x in eligible):raise ValueError('eligible graph context missing')
    scoreable=[x for x in eligible if caps[x['article_a_id']]['content_status']=='USABLE' and caps[x['article_b_id']]['content_status']=='USABLE']
    effective=[x for x in scoreable if not(caps[x['article_a_id']]['content_equals_title'] is True and caps[x['article_b_id']]['content_equals_title'] is True)]
    return features,graph,caps,excluded_articles,excluded_pairs,(old,blind,gdev),len(eligible),len(scoreable),len(effective)


def freeze(path,data):
    if path.exists():raise FileExistsError('artifact exists')
    fd,name=tempfile.mkstemp(prefix='.d2f1-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(name,path);path.chmod(0o444)
        if path.stat().st_mode&0o777!=0o444 or sha(path.read_bytes())!=sha(data):raise ValueError('freeze failure')
    finally:
        if os.path.exists(name):os.unlink(name)


def main():
    with firewall():
        verify_inputs()
        repo=Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip())
        head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
        if subprocess.check_output(['git','status','--porcelain'],text=True).strip():raise ValueError('preregistration worktree not clean')
        relative=CONTRACT.relative_to(repo).as_posix()
        committed=subprocess.check_output(['git','show','HEAD:'+relative])
        if committed!=CONTRACT.read_bytes():raise ValueError('preregistration contract mismatch')
        features,graph,caps,excluded_articles,excluded_pairs,prior,eligible,scoreable,effective=load_sources()
        rows=builder.build(features,graph,caps,excluded_articles,excluded_pairs)
        validator.validate(features,graph,caps,excluded_articles,excluded_pairs,rows)
        for prior_keys in prior:
            prior_ids={int(i) for k in prior_keys for i in k.split(':')}
            if any(r['pair_key'] in prior_keys or r['article_id_a'] in prior_ids or r['article_id_b'] in prior_ids for r in rows):raise ValueError('exclusion failure')
        front=builder.frontier(rows,eligible,scoreable,effective)
        # Independently reconstruct key aggregate counts and exact matching cardinality.
        validator.validate_frontier(rows,front,eligible,scoreable,effective)
        data=b''.join(canonical(r) for r in rows);fdata=canonical(front)
        rows2=builder.build(list(reversed(features)),graph,caps,excluded_articles,excluded_pairs)
        front2=builder.frontier(rows2,eligible,scoreable,effective)
        if data!=b''.join(canonical(r) for r in rows2) or fdata!=canonical(front2):raise ValueError('replay mismatch')
        OUTPUT.mkdir(parents=True,exist_ok=True,mode=0o700)
        if OUTPUT.is_symlink() or not OUTPUT.resolve().is_relative_to(PRIVATE.resolve()) or OUTPUT.resolve().is_relative_to(repo.resolve()) or OUTPUT.stat().st_mode&0o077:raise ValueError('private destination invalid')
        import datetime
        attempt=OUTPUT/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));attempt.mkdir(mode=0o700)
        with tempfile.TemporaryDirectory(prefix='.replay-',dir=attempt) as tmp:
            tmp=Path(tmp); (tmp/'a').mkdir(mode=0o700);(tmp/'b').mkdir(mode=0o700)
            for sub,r,f in [('a',data,fdata),('b',b''.join(canonical(x) for x in rows2),canonical(front2))]:
                for name,value in [('pool',r),('frontier',f)]:
                    p=tmp/sub/name
                    fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
                    with os.fdopen(fd,'wb') as out:out.write(value);out.flush();os.fsync(out.fileno())
            if (tmp/'a/pool').read_bytes()!=(tmp/'b/pool').read_bytes() or (tmp/'a/frontier').read_bytes()!=(tmp/'b/frontier').read_bytes():raise ValueError('replay byte mismatch')
        receipt={'version':'STORY_02_D2F1_POOL_RECEIPT_V1','design_preselection_commit_sha':head,'selection_role':'CALIBRATION_DEV_AUGMENT_ONLY','pool_sha256':sha(data),'frontier_sha256':sha(fdata),'corpus_sha256':INPUTS[FRESH/'fresh-home-corpus-v1.jsonl'],'pair_universe_sha256':INPUTS[FRESH/'p3-crossfeed-24h-pairs.csv'],'d2f_contract_sha256':INPUTS[D2F/'benchmark-contract-v1.json'],'p2_features_sha256':INPUTS[P2/'fresh-p3-feature-universe-v1.jsonl'],'graph_context_sha256':INPUTS[GRAPH/'fresh-graph-context-features-v1.jsonl'],'old_dev_article_overlap':0,'old_dev_pair_overlap':0,'graph_dev_article_overlap':0,'graph_dev_pair_overlap':0,'blind_article_overlap':0,'blind_pair_overlap':0,'human_label_accesses':0,'article_content_reads':0,'model_inference':0,'network_requests':0,'frontier':front}
        receipt_data=canonical(receipt)
        manifest={'version':'STORY_02_D2F1_POOL_MANIFEST_V1','design_preselection_commit_sha':head,'pool_sha256':sha(data),'frontier_sha256':sha(fdata),'receipt_sha256':sha(receipt_data),'contract_sha256':sha(CONTRACT.read_bytes()),'pair_universe_sha256':receipt['pair_universe_sha256'],'blind_state':'SEALED','selection_role':'CALIBRATION_DEV_AUGMENT_ONLY','model_inference':0,'human_label_accesses':0}
        artifacts=[('fresh-positive-candidate-pool-v1.jsonl',data),('fresh-positive-capacity-frontier-v1.json',fdata),('fresh-positive-pool-receipt-v1.json',receipt_data),('fresh-positive-pool-manifest-v1.json',canonical(manifest))]
        for name,value in artifacts:freeze(attempt/name,value)
        loaded=[json.loads(x) for x in (attempt/artifacts[0][0]).read_text().splitlines()]
        validator.validate(features,graph,caps,excluded_articles,excluded_pairs,loaded)
        validator.validate_frontier(loaded,json.loads((attempt/artifacts[1][0]).read_text()),eligible,scoreable,effective)
        verify_inputs()
        print(json.dumps({'attempt':str(attempt),'preselection_head':head,'pool_sha256':sha(data),'frontier_sha256':sha(fdata),'receipt_sha256':sha(receipt_data),'manifest_sha256':sha(canonical(manifest)),'frontier':front},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('POOL_STOP='+type(exc).__name__,file=sys.stderr);sys.exit(1)
