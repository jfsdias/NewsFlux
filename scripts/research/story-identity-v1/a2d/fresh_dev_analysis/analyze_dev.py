"""DEV-only diagnostics; sealed BLIND artifacts are guarded from access."""
import builtins
import contextlib
import csv
import hashlib
import io
import json
import math
import os
from collections import Counter,defaultdict
from pathlib import Path
from unittest.mock import patch

BASE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c'
OUTPUT=BASE/'p4-dev-analysis'
P4=BASE/'p4-human-labeling/session-20261027-v1/ingested-v1'
P2=BASE/'p2-fresh-features/attempt-20261027-v1/frozen-v1'
P3=BASE/'p3-pack-search/attempt-20261027-r1-v1/dev'
RANK=BASE/'p3-search-rank-v2/attempt-20261027-v1/fresh-p3-search-rank-v2.jsonl'
FILES={P4/'dev-human-labels-v1.jsonl':'79d1e30476d532b335e9b201ec95982942cb5fdbc49f90361b331930477f8306',
 P4/'human-label-ingestion-manifest-v1.json':'590ee4b36f067676dcbb7bffdfb22ea0d174e42a884e89ce1cb638c013b59156',
 P2/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',
 P2/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e',
 P3/'annotation-pack-v1.csv':'a5168490d1daeee383934a47b8982341eaaa7e78a17343020e21ca7425a0ed10',
 P3/'audit-sidecar-v1.json':'87422a83b594c87313c8613dd42dabaf25b7571cc4ca65fb853853a4e3411d29',
 RANK:'a6db023e7adf4e85b96222c2f21495a9f877ae85ed484e17a89950f3bda1ad02'}
LABELS=('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')
FEATURES=('qwen_score','lexical_overlap','temporal_delta_hours','entity_anchor_overlap','number_overlap','date_overlap','search_rank_v2')

@contextlib.contextmanager
def blind_guard():
    forbidden='blind-human-labels-sealed-v1.jsonl'
    orig_builtin=builtins.open;orig_io=io.open;orig_open=Path.open;orig_bytes=Path.read_bytes;orig_text=Path.read_text
    def check(p):
        if forbidden in str(p) or '/p3-pack-search/attempt-20261027-r1-v1/blind/' in str(p):raise PermissionError('sealed input access forbidden')
    def builtin(p,*x,**kw):check(p);return orig_builtin(p,*x,**kw)
    def io_open(p,*x,**kw):check(p);return orig_io(p,*x,**kw)
    def path_open(p,*x,**kw):check(p);return orig_open(p,*x,**kw)
    def read_bytes(p):check(p);return orig_bytes(p)
    def read_text(p,*x,**kw):check(p);return orig_text(p,*x,**kw)
    with patch.object(builtins,'open',builtin),patch.object(io,'open',io_open),patch.object(Path,'open',path_open),patch.object(Path,'read_bytes',read_bytes),patch.object(Path,'read_text',read_text):yield

def metrics(rows,predict):
    c=Counter()
    for r in rows:
        label=r['human_decision'];pred=bool(predict(r))
        if label=='UNCERTAIN':c['UNCERTAIN_PREDICTED_MERGE' if pred else 'UNCERTAIN_PREDICTED_NO_MERGE']+=1
        elif label=='SAME_EVENT':c['TP' if pred else 'FN']+=1
        elif label in ('RELATED_TOPIC','DIFFERENT_EVENT'):
            if pred:c['FP_'+label]+=1
            else:c['TN']+=1
        else:raise ValueError('label domain')
    tp=c['TP'];fp=c['FP_RELATED_TOPIC']+c['FP_DIFFERENT_EVENT'];fn=c['FN']
    return {**{k:c[k] for k in ('TP','FP_RELATED_TOPIC','FP_DIFFERENT_EVENT','FN','TN','UNCERTAIN_PREDICTED_MERGE','UNCERTAIN_PREDICTED_NO_MERGE')},
      'FP_TOTAL':fp,'FALSE_MERGE_COUNT':fp,'FALSE_SPLIT_COUNT':fn,
      'DEV_CHALLENGE_PRECISION':tp/(tp+fp) if tp+fp else None,'DEV_CHALLENGE_RECALL':tp/(tp+fn) if tp+fn else None}

def sweep(rows):
    scores=sorted({float(r['qwen_score']) for r in rows})
    if not scores or not all(math.isfinite(x) for x in scores):raise ValueError('invalid score')
    thresholds=[float('-inf')]+[v for pair in zip(scores,scores[1:]) for v in (pair[0],(pair[0]+pair[1])/2)]+[scores[-1],float('inf')]
    return [dict(threshold=('-inf' if t==float('-inf') else 'inf' if t==float('inf') else t),**metrics(rows,lambda r:float(r['qwen_score'])>=t)) for t in thresholds]

def pareto(items):
    return [x for x in items if not any(y['FALSE_MERGE_COUNT']<=x['FALSE_MERGE_COUNT'] and y['FALSE_SPLIT_COUNT']<=x['FALSE_SPLIT_COUNT'] and (y['FALSE_MERGE_COUNT']<x['FALSE_MERGE_COUNT'] or y['FALSE_SPLIT_COUNT']<x['FALSE_SPLIT_COUNT']) for y in items)]

def evidence(rows):
    c=Counter(r['human_decision'] for r in rows);b=len({r['primary_bucket'] for r in rows if r['human_decision']=='SAME_EVENT'})
    return {'pass':c['SAME_EVENT']>=8 and c['RELATED_TOPIC']>=8 and len(rows)-c['UNCERTAIN']>=60 and b>=2,
            'positive_buckets':b,'same_event':c['SAME_EVENT'],'related_topic':c['RELATED_TOPIC'],'non_uncertain':len(rows)-c['UNCERTAIN']}

def quantile(values,q):
    if not values:return None
    v=sorted(values);p=(len(v)-1)*q;lo=int(p);hi=math.ceil(p)
    return v[lo]+(v[hi]-v[lo])*(p-lo)

def distributions(rows):
    out={}
    for feature in FEATURES:
        out[feature]={}
        for label in LABELS:
            vals=[float(r[feature]) for r in rows if r['human_decision']==label and r.get(feature) is not None]
            out[feature][label]={'n':len(vals),'min':min(vals) if vals else None,'q25':quantile(vals,.25),'median':quantile(vals,.5),'q75':quantile(vals,.75),'max':max(vals) if vals else None}
    return out

def aggregate(rows):
    bucket=defaultdict(Counter);strata=defaultdict(Counter)
    for r in rows:
        bucket[r['primary_bucket']][r['human_decision']]+=1
        for s in {x.split('_',1)[0] for x in r['mining_strata']}:strata[s][r['human_decision']]+=1
    def complete(c):
        total=sum(c.values())
        return {**{label:c[label] for label in LABELS},'total':total,'proportions':{label:(c[label]/total if total else None) for label in LABELS}}
    return {'buckets':{k:complete(v) for k,v in sorted(bucket.items())},'strata':{f'S{n}':complete(strata[f'S{n}']) for n in range(1,11)}}

def analyze(rows):
    if len(rows)!=80 or len({r['pair_key'] for r in rows})!=80 or any(r['human_decision'] not in LABELS for r in rows):raise ValueError('DEV input invalid')
    candidates={name:metrics(rows,lambda r,k='candidate_'+name.lower():r[k]) for name in ('A','B','C')}
    sw=sweep(rows);comparison=[dict(name=k,threshold=None,**v) for k,v in candidates.items()]+[dict(name='QWEN',**r) for r in sw]
    front=pareto(comparison)
    labels=Counter(r['human_decision'] for r in rows)
    return {'label_counts':{k:labels[k] for k in LABELS},'aggregation':aggregate(rows),'candidates':candidates,
            'feature_distributions':distributions(rows),'sufficiency':evidence(rows),'threshold_count':len(sw),'frontier_count':len(front)},sw,front

def sha(data):return hashlib.sha256(data).hexdigest()
def read_csv(path):
    with path.open(newline='',encoding='utf-8') as f:return list(csv.DictReader(f))
def selective_jsonl(path,keys):
    # Only parse lines belonging to the known DEV keys, not other pair records.
    needles={f'"pair_key":"{key}"':key for key in keys};out={}
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            found=[key for token,key in needles.items() if token in line]
            if len(found)>1:raise ValueError('ambiguous DEV join')
            if found:
                row=json.loads(line);key=found[0]
                if row['pair_key']!=key or key in out:raise ValueError('duplicate DEV join')
                out[key]=row
    if set(out)!=keys:raise ValueError('DEV join missing')
    return out

def load():
    for path,h in FILES.items():
        if sha(path.read_bytes())!=h:raise ValueError('input hash mismatch')
    m=json.loads((P4/'human-label-ingestion-manifest-v1.json').read_bytes())
    expected={'row_count':128,'dev_count':80,'blind_count':48,'dev_state':'ANNOTATED_OPEN_FOR_DEVELOPMENT','blind_state':'ANNOTATED_SEALED','human_label_source':'MANUAL_HUMAN_REVIEW','agent_generated_labels':0,'blind_sealed_artifact_sha256':'e1dcc5396c239b6e58ede6c5661fece4dc0cbc4043d1e7772b516616f9716588'}
    if any(m.get(k)!=v for k,v in expected.items()):raise ValueError('manifest state mismatch')
    labels=[json.loads(x) for x in (P4/'dev-human-labels-v1.jsonl').read_text().splitlines()]
    keys={r['pair_key'] for r in labels}
    if len(labels)!=80 or len(keys)!=80:raise ValueError('DEV label count')
    pack=read_csv(P3/'annotation-pack-v1.csv');side=json.loads((P3/'audit-sidecar-v1.json').read_text())
    if {r['pair_key'] for r in pack}!=keys or {r['pair_key'] for r in side}!=keys or len(side)!=80:raise ValueError('DEV pack mismatch')
    features=selective_jsonl(P2/'fresh-p3-feature-universe-v1.jsonl',keys)
    ranks=selective_jsonl(RANK,keys);side_by={r['pair_key']:r for r in side}
    joined=[]
    for label in labels:
        key=label['pair_key'];rank=ranks[key];feat=features[key]
        if {k:v for k,v in rank.items() if k!='search_rank_v2'}!=feat or side_by[key]!=rank:raise ValueError('frozen feature inconsistency')
        if any(type(feat.get('candidate_'+x)) is not bool for x in ('a','b','c')):raise ValueError('candidate invalid')
        joined.append(dict(rank,human_decision=label['human_decision']))
    return joined

def csv_bytes(items):
    columns=list(items[0]);buf=io.StringIO(newline='');writer=csv.DictWriter(buf,fieldnames=columns,lineterminator='\n');writer.writeheader();writer.writerows(items);return buf.getvalue().encode()
def json_bytes(data):return (json.dumps(data,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def artifacts(rows):
    report,sw,front=analyze(rows)
    diagnostics=[{k:r[k] for k in ('pair_key','human_decision','primary_bucket','mining_strata','candidate_a','candidate_b','candidate_c',*FEATURES)} for r in rows]
    outputs={'dev-pair-diagnostics-v1.jsonl':b''.join(json_bytes(r) for r in diagnostics),
             'dev-threshold-sweep-v1.csv':csv_bytes(sw),'dev-pareto-frontier-v1.csv':csv_bytes(front),
             'dev-analysis-v1.json':json_bytes(report)}
    outputs['dev-analysis-manifest-v1.json']=json_bytes({'version':'P4D_V1','input_hashes':{str(k.relative_to(BASE)):v for k,v in FILES.items()},
       'blind_state':'ANNOTATED_SEALED','blind_hash_source':'P4C_MANIFEST_ONLY','outputs':{k:sha(v) for k,v in outputs.items()},'dev_rows':80})
    return report,outputs

def freeze(dest,outputs):
    root=OUTPUT.resolve();target=Path(dest).resolve()
    if target==root or not target.is_relative_to(root):raise ValueError('private destination')
    target.mkdir(mode=0o700,parents=False,exist_ok=False);result={}
    for name,data in outputs.items():
        if Path(name).name!=name:raise ValueError('invalid name')
        temp=target/(name+'.tmp');final=target/name
        with temp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temp,final);h=sha(data)
        if sha(final.read_bytes())!=h:raise ValueError('readback')
        final.chmod(0o444)
        if final.stat().st_mode&0o777!=0o444 or sha(final.read_bytes())!=h:raise ValueError('rehash')
        result[name]=h
    return result

def main(dest):
    with blind_guard():
        rows=load();report,first=artifacts(rows);again,second=artifacts(rows)
        if first!=second or report!=again:raise ValueError('replay')
        hashes=freeze(dest,first)
        print(json.dumps({'report':report,'hashes':hashes,'replay':'PASS','blind_file_accesses':0},sort_keys=True))
if __name__=='__main__':
    import sys
    if len(sys.argv)!=2:raise SystemExit('usage: analyze_dev.py PRIVATE_NEW_DIRECTORY')
    main(sys.argv[1])
