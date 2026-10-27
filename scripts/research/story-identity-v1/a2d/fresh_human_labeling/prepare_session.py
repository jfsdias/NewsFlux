"""Prepare a blank, neutral reviewer session from frozen P3 inputs."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys

P3=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p3-pack-search/attempt-20261027-r1-v1'
ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-human-labeling'
HASHES={'dev/annotation-pack-v1.csv':'a5168490d1daeee383934a47b8982341eaaa7e78a17343020e21ca7425a0ed10',
'dev/audit-sidecar-v1.json':'87422a83b594c87313c8613dd42dabaf25b7571cc4ca65fb853853a4e3411d29',
'dev/selection-manifest-v1.json':'9a0886bf7d29da107846098c9ce2e40ebff96f2aea4449fa95c1a2ec4ecd1469',
'blind/annotation-pack-v1.csv':'e5452ddb6df47d16b3da60d729d18a8186b2354a33e55de8ffbb755c5fc8b41b',
'blind/audit-sidecar-v1.json':'99e7faa23f0f72fceb2cfe1f0ec5bd597859b2aa14d9227d0b96b8b7798b0a9f',
'blind/selection-manifest-v1.json':'04ec43f613cc1b76d435394efba6edc80ad5da9229fe9318897bb2bff84bb2ce',
'chain-groups-v1.json':'8d62ad6fa660aed97d46af1d137d1aebe80ff31ee3d0bb3d02810ab55f67326c',
'search-audit-v1.json':'100aa8caba316d7ebf23a5d552034f2539c2bc15ef7cdc5605d668c7d012ecc2',
'freeze-manifest-v1.json':'6538e87728aaff2d01362ac0655ee7903f01031f9f9146dd46aa640522c54399'}
LABELS='SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN'
COLUMNS=('annotation_id','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision')
GUIDE='''# Review guide

Use only the information shown in the review session. Do not infer missing facts or use article bodies.

- **SAME_EVENT**: Both articles concern the same concrete news event, occurrence, decision, announcement, release, incident, or coherent developing episode. Different headlines, framing, or perspectives can still describe the same event. Would merging them into one concrete Story episode be semantically correct?
- **RELATED_TOPIC**: The articles are meaningfully related by subject, entity, product, case, policy, or continuing theme, but concern distinct events or developments. The same company, person, or topic alone is not SAME_EVENT.
- **DIFFERENT_EVENT**: The articles concern distinct events and any topical relationship is absent, incidental, or too broad for one Story episode.
- **UNCERTAIN**: The available evidence does not safely distinguish SAME_EVENT from a related or different event. Do not guess.

A false merge is more costly than a false split. Do not force ambiguity into SAME_EVENT. Record decisions manually in a separate writable copy; keep this prepared blank source unchanged. No agent, language model, or automatic classifier may provide the decisions.
'''.encode()

def sha(b): return hashlib.sha256(b).hexdigest()
def checked_inputs():
    for name,digest in HASHES.items():
        path=P3/name
        if sha(path.read_bytes())!=digest or stat.S_IMODE(path.stat().st_mode)!=0o444: raise ValueError('P3 input integrity or mode')

def derive(dev,blind):
    if len(dev)!=80 or len(blind)!=48: raise ValueError('pack count')
    combined=[]; pack_vertices=[]; all_keys=set()
    for name,rows in (('DEV',dev),('BLIND',blind)):
        seen_ids=set(); vertices=set()
        for r in rows:
            if r['human_decision']!='' or r['label_options']!=LABELS: raise ValueError('nonblank or labels')
            a,b=map(int,r['pair_key'].split(':'))
            if a>=b or r['pair_key'] in all_keys or r['annotation_id'] in seen_ids: raise ValueError('identity')
            seen_ids.add(r['annotation_id']);all_keys.add(r['pair_key']);vertices.update((a,b))
            combined.append((r['pair_key'],name,r))
        pack_vertices.append(vertices)
    if pack_vertices[0]&pack_vertices[1] or len(all_keys)!=128: raise ValueError('overlap')
    combined.sort(key=lambda x:hashlib.sha256(f"STORY02-P4A|{HASHES['freeze-manifest-v1.json']}|{x[0]}".encode()).hexdigest())
    output=io.StringIO(newline='');writer=csv.DictWriter(output,fieldnames=COLUMNS,lineterminator='\n');writer.writeheader()
    mapping=[]
    for i,(key,pack,row) in enumerate(combined,1):
        ident=f'R{i:03d}';writer.writerow({**{k:row[k] for k in COLUMNS if k!='annotation_id'},'annotation_id':ident})
        mapping.append({'annotation_id':ident,'source_pack':pack,'original_annotation_id':row['annotation_id'],'pair_key':key})
    return {'review-session-v1.csv':output.getvalue().encode(),
            'review-session-map-v1.jsonl':b''.join((json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode() for x in mapping),
            'annotation-guide-v1.md':GUIDE}

def freeze(destination,artifacts):
    root=ROOT.resolve();target=Path(destination).resolve()
    if target==root or not target.is_relative_to(root): raise ValueError('private destination required')
    target.mkdir(mode=0o700,parents=False,exist_ok=False);out={}
    for name,data in artifacts.items():
        if Path(name).name!=name: raise ValueError('invalid filename')
        tmp=target/(name+'.tmp'); final=target/name
        with tmp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(tmp,final);h=sha(data)
        if sha(final.read_bytes())!=h: raise ValueError('readback')
        final.chmod(0o444)
        if stat.S_IMODE(final.stat().st_mode)!=0o444 or sha(final.read_bytes())!=h: raise ValueError('post-chmod')
        out[name]=h
    return out

def main(dest):
    checked_inputs()
    def read(name):
        with (P3/name).open(newline='') as f: return list(csv.DictReader(f))
    dev=read('dev/annotation-pack-v1.csv');blind=read('blind/annotation-pack-v1.csv')
    first=derive(dev,blind);second=derive(dev,blind)
    if first!=second: raise ValueError('replay')
    rows=list(csv.DictReader(io.StringIO(first['review-session-v1.csv'].decode())))
    mapping=[json.loads(x) for x in first['review-session-map-v1.jsonl'].splitlines()]
    if len(rows)!=128 or len(mapping)!=128 or len({x['annotation_id'] for x in mapping})!=128 or len({x['pair_key'] for x in mapping})!=128: raise ValueError('mapping')
    if any(tuple(r)!=COLUMNS or r['human_decision']!='' or r['label_options']!=LABELS for r in rows): raise ValueError('blinding')
    checked_inputs()
    manifest={'input_hashes':HASHES,'count':128,'mapping_count':128,'blank':True,'blind_state':'SEALED',
              'artifact_hashes':{k:sha(v) for k,v in first.items()},'order':'SHA256_FREEZE_MANIFEST_PLUS_PAIR_KEY'}
    first['session-manifest-v1.json']=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
    hashes=freeze(dest,first);checked_inputs()
    print(json.dumps({'status':'FROZEN','rows':len(rows),'mapping':len(mapping),'hashes':hashes},sort_keys=True))

if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit('usage: prepare_session.py PRIVATE_NEW_DIRECTORY')
    main(sys.argv[1])
