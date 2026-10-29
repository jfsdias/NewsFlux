"""Prepare frozen local review metadata; never open reviewer UI or read labels."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import datetime
import review_core as c
import validate_neutral_review as v

HERE=Path(__file__).resolve().parent
ROOT=Path.home()/'NewsFlux-STORY00/private-p4'
D=ROOT/'story02-a2d2c'
SOURCE=D/'p4-fresh-positive-expansion-pack/attempt-20261029T181310658051Z'
CORPUS=ROOT/'story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
FILES={'selected_pack':SOURCE/'b1-selected-pack-v1.jsonl','pack_contract':SOURCE/'b1-expansion-pack-contract-v1.json','proof':SOURCE/'b1-selection-proof-v1.json','receipt':SOURCE/'b1-pack-receipt-v1.json','manifest':SOURCE/'b1-pack-manifest-v1.json','corpus':CORPUS}
PRE='862e6715851809addd7f02d949c1efc418276ed3'
OLD=D/'p4-fresh-positive-expansion-neutral-review/attempt-20261029T182753261223Z'
RENDERER_VERSION='D2F8_NEUTRAL_REVIEW_RENDERER_V1'
sys.path.insert(0,str(HERE.parent/'fresh_positive_expansion_design'))
from expansion_frontier import firewall
sys.path.insert(0,str(HERE.parent/'fresh_positive_expansion_pack'))
from validate_expansion_pack import validate_schema

GUIDE='''# Neutral headline review guide

Judge whether both headlines describe the same specific real-world event. The same subject, person, entity or developing story alone is not enough. Use only displayed titles, sources and publication times; do not search the web, open articles or rely on prior review memories. Judge each pair independently.

- SAME_EVENT: the same concrete event or occurrence, sufficiently specific to be event-equivalent reporting.
- RELATED_TOPIC: related subject or situation without the same specific event; this is merge-negative.
- DIFFERENT_EVENT: distinct events.
- UNCERTAIN: neutral metadata does not support a reliable classification.

A false merge costs more than a false split. Only SAME_EVENT is merge-positive; RELATED_TOPIC and UNCERTAIN are not.
'''.encode()

def load_sources():
    contract=json.loads((HERE/'review-contract-v1.json').read_bytes())
    with firewall(set(FILES.values())):
        data={}
        for role,p in FILES.items():
            if p.stat().st_mode&0o777 != 0o444:raise ValueError('SOURCE_MODE')
            blob=p.read_bytes()
            if c.sha(blob)!=contract['source_sha256'][role]:raise ValueError('SOURCE_HASH')
            data[role]=blob
        source_manifest=json.loads(data['manifest'])
        for role in ('selected_pack','pack_contract','proof','receipt'):
            if source_manifest['sha256'][FILES[role].name]!=c.sha(data[role]):raise ValueError('SOURCE_MANIFEST')
        pairs=[json.loads(x) for x in data['selected_pack'].splitlines()]
        validate_schema(pairs)
        if len(pairs)!=11 or len({x for p in pairs for x in (p['article_id_a'],p['article_id_b'])})!=22:raise ValueError('SOURCE_SAMPLE')
        proof=json.loads(data['proof'])
        if proof['selected_rank_vector_sha256']!='ac2e4b36468d032cfca81a267866c046a182461c5e79f6f181a026b61917d034' or c.sha(c.canonical([p['b1_rank'] for p in pairs]))!=proof['selected_rank_vector_sha256']:raise ValueError('SOURCE_RANK_HASH')
        corpus=[]
        for line in data['corpus'].splitlines():
            item=json.loads(line)
            if any(k in item for k in ('content','body','html','normalized_content','raw_payload')):raise ValueError('CONTENT_FIELD')
            corpus.append({k:item.get(k) for k in ('id','title','feed_title','published_at')})
        if len(corpus)!=500 or len({x['id'] for x in corpus})!=500:raise ValueError('CORPUS_COUNT')
    return pairs,corpus,contract

def build(pairs,corpus,nonce,contract,provenance,renderer_commit):
    rows,mapping=c.derive(pairs,corpus,nonce)
    csvdata=c.csv_bytes(rows);session_id=c.sha(b'story02-d2f8|'+nonce)[:24]
    template=(HERE/'review-ui-template.html').read_text()
    html=template.replace('__DATA__',c.html_data(rows)).replace('__STORAGE__',json.dumps('newsflux-story02-d2f8-'+session_id)).encode()
    visible=[{k:x[k] for k in c.COLUMNS if k!='human_decision'} for x in rows]
    identity=[{k:x[k] for k in ('review_id','pair_key','left_article_id','right_article_id')} for x in mapping]
    meta_hash=c.sha(c.canonical(visible));identity_hash=c.sha(c.canonical(identity))
    randomization={'version':'D2F8_HMAC_SHA256_V1','nonce_hex':nonce.hex(),'session_id':session_id}
    receipt={'version':'D2F8_SESSION_V1','renderer_version':RENDERER_VERSION,'renderer_commit':renderer_commit,'renderer_provenance':provenance,'session_id':session_id,'review_metadata_sha256':meta_hash,'review_identity_map_sha256':identity_hash,'review_pair_count':11,'initial_decision_count':0,'session_state':'PREPARED_UNOPENED','human_review_started':False,'completed_review_export_exists':False}
    artifacts={'neutral-review-contract-v1.json':c.canonical(dict(contract,preregistration_commit=PRE,renderer_version=RENDERER_VERSION,renderer_commit=renderer_commit,renderer_provenance=provenance)),'neutral-review-randomization-v1.json':c.canonical(randomization),'neutral-review-identity-map-v1.jsonl':b''.join(c.canonical(x) for x in mapping),'neutral-review-session-v1.csv':csvdata,'neutral-review-guide-v1.md':GUIDE,'neutral-review-ui-v1.html':html,'neutral-review-receipt-v1.json':c.canonical(receipt)}
    v.validate(pairs,corpus,nonce,rows,mapping,csvdata,html,session_id)
    v.verify_fingerprints(rows,mapping,receipt,nonce)
    v.check_guide(GUIDE)
    v.independently_verify_html_replay((HERE/'review-ui-template.html').read_bytes(),rows,session_id,html)
    return artifacts,receipt

def main():
    if len(sys.argv)!=2:raise ValueError('RENDERER_COMMIT_REQUIRED')
    renderer_commit=sys.argv[1]
    head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    subprocess.run(['git','merge-base','--is-ancestor',renderer_commit,head],check=True)
    provenance=v.verify_committed_renderer(Path.cwd(),renderer_commit)
    subprocess.run(['git','merge-base','--is-ancestor',PRE,head],check=True)
    rel='scripts/research/story-identity-v1/a2d/fresh_positive_expansion_neutral_review/review-contract-v1.json'
    if subprocess.check_output(['git','show',PRE+':'+rel])!=(HERE/'review-contract-v1.json').read_bytes():raise ValueError('PREREGISTRATION')
    pairs,corpus,contract=load_sources()
    names=('neutral-review-manifest-v1.json','neutral-review-randomization-v1.json','neutral-review-identity-map-v1.jsonl','neutral-review-session-v1.csv','neutral-review-ui-v1.html','neutral-review-receipt-v1.json','neutral-review-guide-v1.md')
    with firewall({OLD/n for n in names}):
        old={n:(OLD/n).read_bytes() for n in names}
        if c.sha(old['neutral-review-manifest-v1.json'])!='69846b21a44fe6059b5eb4b602dce0b7554830c96e092d3ceab0f727329f3a5c':raise ValueError('OLD_MANIFEST')
        oldmanifest=json.loads(old['neutral-review-manifest-v1.json'])
        for name in names[1:]:
            if (OLD/name).stat().st_mode&0o777!=0o444 or c.sha(old[name])!=oldmanifest['sha256'][name]:raise ValueError('OLD_ARTIFACT')
    randomization=json.loads(old['neutral-review-randomization-v1.json']);nonce=bytes.fromhex(randomization['nonce_hex'])
    oldrows=v.check_csv(old['neutral-review-session-v1.csv']);oldmap=[json.loads(x) for x in old['neutral-review-identity-map-v1.jsonl'].splitlines()];oldreceipt=json.loads(old['neutral-review-receipt-v1.json'])
    v.validate(pairs,corpus,nonce,oldrows,oldmap,old['neutral-review-session-v1.csv'],old['neutral-review-ui-v1.html'],randomization['session_id'])
    v.verify_fingerprints(oldrows,oldmap,oldreceipt,nonce)
    with firewall({HERE/'review-ui-template.html'}):
        first,receipt=build(pairs,corpus,nonce,contract,provenance,renderer_commit);second,receipt2=build(pairs,corpus,nonce,contract,provenance,renderer_commit)
    for name in ('neutral-review-randomization-v1.json','neutral-review-identity-map-v1.jsonl','neutral-review-session-v1.csv','neutral-review-guide-v1.md'):
        if first[name]!=old[name]:raise ValueError('OLD_NEW_IDENTITY_OR_METADATA')
    if receipt['review_metadata_sha256']!=oldreceipt['review_metadata_sha256'] or receipt['review_identity_map_sha256']!=oldreceipt['review_identity_map_sha256']:raise ValueError('OLD_NEW_FINGERPRINT')
    if first!=second or receipt!=receipt2:raise ValueError('REPLAY')
    manifest=c.canonical({'version':'D2F8_MANIFEST_V1','sha256':{name:c.sha(value) for name,value in first.items()},'source_sha256':contract['source_sha256'],'preregistration_commit':PRE,'renderer_version':RENDERER_VERSION,'renderer_commit':renderer_commit,'renderer_provenance':provenance,'randomization_sha256':c.sha(first['neutral-review-randomization-v1.json']),'identity_map_sha256':c.sha(first['neutral-review-identity-map-v1.jsonl']),'review_metadata_sha256':receipt['review_metadata_sha256']})
    files=dict(first);files['neutral-review-manifest-v1.json']=manifest
    root=D/'p4-fresh-positive-expansion-neutral-review';root.mkdir(mode=0o700,exist_ok=True)
    if root.is_symlink() or root.stat().st_mode&0o077:raise ValueError('ROOT_MODE')
    attempt=root/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));attempt.mkdir(mode=0o700)
    for name,data in files.items():
        path=attempt/name
        with tempfile.NamedTemporaryFile(dir=attempt,delete=False) as f:f.write(data);f.flush();os.fsync(f.fileno());tmp=Path(f.name)
        os.chmod(tmp,0o444);os.link(tmp,path);os.unlink(tmp)
        if path.stat().st_mode&0o777!=0o444 or c.sha(path.read_bytes())!=c.sha(data):raise ValueError('FREEZE')
    readback={name:(attempt/name).read_bytes() for name in files}
    if any(readback[n]!=files[n] for n in files):raise ValueError('READBACK')
    randomization=json.loads(readback['neutral-review-randomization-v1.json']);mapping=[json.loads(x) for x in readback['neutral-review-identity-map-v1.jsonl'].splitlines()]
    rows=v.check_csv(readback['neutral-review-session-v1.csv']);v.validate(pairs,corpus,bytes.fromhex(randomization['nonce_hex']),rows,mapping,readback['neutral-review-session-v1.csv'],readback['neutral-review-ui-v1.html'],randomization['session_id'])
    v.verify_fingerprints(rows,mapping,json.loads(readback['neutral-review-receipt-v1.json']),bytes.fromhex(randomization['nonce_hex']))
    v.check_guide(readback['neutral-review-guide-v1.md'])
    v.verify_committed_renderer(Path.cwd(),renderer_commit,provenance)
    v.independently_verify_html_replay((HERE/'review-ui-template.html').read_bytes(),rows,randomization['session_id'],readback['neutral-review-ui-v1.html'])
    if json.loads(readback['neutral-review-manifest-v1.json'])['sha256']!={name:c.sha(data) for name,data in first.items()}:raise ValueError('MANIFEST')
    print(json.dumps({'attempt':str(attempt),'receipt':receipt,'sha256':{name:c.sha(data) for name,data in files.items()}},sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('D2F8_STOP='+type(exc).__name__+': '+str(exc),file=sys.stderr);sys.exit(1)
