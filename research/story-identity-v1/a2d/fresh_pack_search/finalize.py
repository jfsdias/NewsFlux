"""Replay, independently validate, blind and freeze a witness in private storage."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import run_search
import search
import validator

PRIVATE=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p3-pack-search'
CORPUS=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
CORPUS_HASH='3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206'
COLUMNS=('annotation_id','pair_key','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision')

def sha(data): return hashlib.sha256(data).hexdigest()
def js(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def identity(result):
    return (tuple(sorted(r['pair_key'] for r in result['dev'])),tuple(sorted(r['pair_key'] for r in result['blind'])),
            tuple(sorted(tuple(sorted(g['pair_keys'])) for g in result['chain_groups'])))
def plain(row): return {k:v for k,v in row.items() if k!='best_rank'}

def reviewer(rows, corpus):
    out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=COLUMNS,lineterminator='\n');w.writeheader()
    for i,r in enumerate(sorted(rows,key=search.order),1):
        a,b=corpus[r['article_a_id']],corpus[r['article_b_id']]
        w.writerow(dict(annotation_id=f'A{i:03d}',pair_key=r['pair_key'],feed_a=a.get('feed_title') or '',
                        feed_b=b.get('feed_title') or '',title_a=a['title'],title_b=b['title'],
                        published_at_a=a['published_at'],published_at_b=b['published_at'],
                        label_options='SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN',human_decision=''))
    return out.getvalue().encode()

def build(dev,blind,groups,corpus,metrics):
    artifacts={}
    for name,rows in (('dev',dev),('blind',blind)):
        artifacts[f'{name}/annotation-pack-v1.csv']=reviewer(rows,corpus)
        artifacts[f'{name}/audit-sidecar-v1.json']=js(sorted(rows,key=lambda r:r['pair_key']))
        artifacts[f'{name}/selection-manifest-v1.json']=js({'count':len(rows),'state':'FROZEN','seed':search.SEED})
    artifacts['chain-groups-v1.json']=js(groups)
    artifacts['search-audit-v1.json']=js(metrics)
    return artifacts

def freeze(destination, artifacts):
    target=Path(destination).resolve(); root=PRIVATE.resolve()
    if target==root or not target.is_relative_to(root): raise ValueError('private output required')
    target.mkdir(mode=0o700,parents=False,exist_ok=False)
    result={}
    for name,data in artifacts.items():
        rel=Path(name)
        if rel.is_absolute() or '..' in rel.parts: raise ValueError('invalid output name')
        out=target/rel;out.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        temp=out.with_name(out.name+'.tmp')
        with temp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temp,out);expected=sha(data)
        if sha(out.read_bytes())!=expected: raise ValueError('readback')
        out.chmod(0o444)
        if out.stat().st_mode & 0o777 != 0o444 or sha(out.read_bytes())!=expected: raise ValueError('mode or rehash')
        result[name]=expected
    return result

def main(dest):
    rows=run_search.load(); universe={r['pair_key']:r for r in rows}
    if sha(CORPUS.read_bytes())!=CORPUS_HASH: raise ValueError('corpus hash')
    corpus_rows=[json.loads(x) for x in CORPUS.read_text().splitlines()]
    corpus={r['id']:r for r in corpus_rows}
    if len(corpus)!=500: raise ValueError('corpus size')
    log=[]; witness=None
    for chain_cap,bucket_cap in search.FRONTIERS:
        result,pool=search.attempt(rows,chain_cap,bucket_cap)
        log.append({'chain_cap':chain_cap,'bucket_cap':bucket_cap,'pool':len(pool),'inventory':result['inventory'],
                    'status':result['status'],'solver':result['solver'],'solver_version':result['solver_version'],
                    'certificate':result['certificate']})
        if result['feasible_witness_found']:
            replay,_=search.attempt(rows,chain_cap,bucket_cap)
            if not replay['feasible_witness_found'] or identity(result)!=identity(replay): raise ValueError('replay mismatch')
            witness=result;break
    if witness is None:
        print(json.dumps({'status':'COMPONENT_SEARCH_LIMIT_REACHED','search_complete':False,'attempts':log},sort_keys=True));return
    dev=[plain(r) for r in witness['dev']];blind=[plain(r) for r in witness['blind']]
    groups=[sorted(g['pair_keys']) for g in witness['chain_groups']]
    metrics=validator.validate(dev,blind,groups,universe=universe)
    metrics.update(status='FEASIBLE_WITNESS_FOUND', replay='PASS', attempts=log, historical_isolation='VERIFIED_P2_MANIFEST_CONTINUITY')
    artifacts=build(dev,blind,groups,corpus,metrics)
    if artifacts!=build(dev,blind,groups,corpus,metrics): raise ValueError('artifact replay mismatch')
    for name in ('dev/annotation-pack-v1.csv','blind/annotation-pack-v1.csv'):
        data=list(csv.DictReader(io.StringIO(artifacts[name].decode())))
        if list(data[0])!=list(COLUMNS) or any(r['human_decision'] for r in data): raise ValueError('blinding')
    artifacts['freeze-manifest-v1.json']=js({'version':'STORY_02_SEARCH_RANK_V2','ceiling':validator.CEILING,
      'input_hashes':{str(p.relative_to(run_search.P)):h for p,h in run_search.INPUTS.items()},'corpus_hash':CORPUS_HASH,
      'hashes':{name:sha(value) for name,value in artifacts.items()},'human_labels':0,'blind_state':'FROZEN'})
    hashes=freeze(dest,artifacts)
    print(json.dumps({'status':'FROZEN','metrics':metrics,'hashes':hashes},sort_keys=True))

if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit('usage: finalize.py PRIVATE_NEW_DIRECTORY')
    main(sys.argv[1])
