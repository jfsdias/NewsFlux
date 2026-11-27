"""Offline identity restoration; never compute decision distributions."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import freeze_core as f
import validate_human_review_freeze as v

HERE=Path(__file__).resolve().parent
ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c'
SESSION=ROOT/'p4-fresh-positive-expansion-neutral-review/attempt-20261029T184839769408Z'
SELECTED=ROOT/'p4-fresh-positive-expansion-pack/attempt-20261029T181310658051Z/b1-selected-pack-v1.jsonl'
EXPORT=Path.home()/'Downloads/neutral-review-completed.csv'
PRE='42b3073686749c3497d880b82d86ebcaa105182d'
sys.path.insert(0,str(HERE.parent/'fresh_positive_expansion_design'))
from expansion_frontier import firewall

def lines(b):return [json.loads(line) for line in b.splitlines() if line.strip()]

def load():
    contract=json.loads((HERE/'human-review-freeze-contract-v1.json').read_bytes())
    paths={SESSION/name for name in contract['d2f8_sha256']}|{SELECTED,EXPORT}
    with firewall(paths):
        raw=EXPORT.read_bytes()
        f.verify_hash(raw,contract['export_sha256'],contract['export_bytes'])
        sources={}
        for name,pin in contract['d2f8_sha256'].items():
            p=SESSION/name
            if p.stat().st_mode&0o777!=0o444:raise ValueError('SOURCE_MODE')
            data=p.read_bytes();f.verify_hash(data,pin);sources[name]=data
        if SELECTED.stat().st_mode&0o777!=0o444:raise ValueError('D2F7_MODE')
        selected=SELECTED.read_bytes();f.verify_hash(selected,contract['d2f7_selected_pack_sha256'])
        v.verify_source_bytes(raw,sources,selected,contract)
    return raw,sources,selected,contract

def build(source):
    raw,sources,selectedbytes,contract=source
    completed=f.parse_csv(raw);visible=f.parse_csv(sources['neutral-review-session-v1.csv'])
    mapping=lines(sources['neutral-review-identity-map-v1.jsonl']);selected=lines(selectedbytes)
    metadata,maphash=f.fingerprints(visible,mapping)
    if (metadata,maphash)!=(contract['metadata_sha256'],contract['identity_map_sha256']):raise ValueError('FINGERPRINT')
    labels=f.restore(completed,visible,mapping,selected);f.validate_restored(labels)
    labeldata=b''.join(f.canonical(row) for row in labels)
    audit={'row_count':11,'nonempty_decision_count':11,'unknown_decision_count':0,'review_id_count':11,'metadata_match':True,'identity_join_count':11}
    receipt={'version':'D2F9_RECEIPT_V1','source_export_sha256':contract['export_sha256'],'source_export_bytes':contract['export_bytes'],'d2f8_sha256':contract['d2f8_sha256'],'d2f7_selected_pack_sha256':contract['d2f7_selected_pack_sha256'],'metadata_sha256':metadata,'identity_map_sha256':maphash,'preregistration_sha':PRE,'row_count':11,'taxonomy_valid':True,'identity_restoration':'PASS','session_source_state':'HUMAN_REVIEW_COMPLETED','distribution_computed':False,'scientific_result_computed':False}
    f.validate_governance(audit,receipt)
    v.validate(raw,sources['neutral-review-session-v1.csv'],sources['neutral-review-identity-map-v1.jsonl'],selectedbytes,labeldata,audit,receipt,contract)
    return labeldata,audit,receipt

def main():
    head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    subprocess.run(['git','merge-base','--is-ancestor',PRE,head],check=True)
    relative='scripts/research/story-identity-v1/a2d/fresh_positive_expansion_human_review_freeze/human-review-freeze-contract-v1.json'
    contractbytes=(HERE/'human-review-freeze-contract-v1.json').read_bytes()
    if subprocess.check_output(['git','show',PRE+':'+relative])!=contractbytes:raise ValueError('PREREGISTRATION')
    source1=load();source2=load()
    with firewall(set()):
        labels,audit,receipt=build(source1);labels2,audit2,receipt2=build(source2)
        if source1[0]!=source2[0] or labels!=labels2 or f.canonical(audit)!=f.canonical(audit2):raise ValueError('REPLAY')
        v.validate(source2[0],source2[1]['neutral-review-session-v1.csv'],source2[1]['neutral-review-identity-map-v1.jsonl'],source2[2],labels,audit,receipt,source2[3])
    artifacts={'human-review-freeze-contract-v1.json':f.canonical(dict(source1[3],preregistration_sha=PRE)),'human-review-completed-export-v1.csv':source1[0],'human-review-labels-v1.jsonl':labels,'human-review-audit-v1.json':f.canonical(audit),'human-review-receipt-v1.json':f.canonical(receipt)}
    artifacts['human-review-manifest-v1.json']=f.canonical({'version':'D2F9_MANIFEST_V1','sha256':{n:f.sha(b) for n,b in artifacts.items()},'source_export_sha256':source1[3]['export_sha256'],'d2f8_sha256':source1[3]['d2f8_sha256'],'d2f7_selected_pack_sha256':source1[3]['d2f7_selected_pack_sha256'],'metadata_sha256':source1[3]['metadata_sha256'],'identity_map_sha256':source1[3]['identity_map_sha256'],'preregistration_sha':PRE})
    root=ROOT/'p4-fresh-positive-expansion-human-review-freeze';root.mkdir(mode=0o700,exist_ok=True)
    if root.is_symlink() or root.stat().st_mode&0o077:raise ValueError('PRIVATE_ROOT')
    attempt=root/('attempt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));attempt.mkdir(mode=0o700)
    for name,data in artifacts.items():
        target=attempt/name
        with tempfile.NamedTemporaryFile(dir=attempt,delete=False) as handle:handle.write(data);handle.flush();os.fsync(handle.fileno());tmp=Path(handle.name)
        os.chmod(tmp,0o444);os.link(tmp,target);os.unlink(tmp)
        if target.stat().st_mode&0o777!=0o444 or f.sha(target.read_bytes())!=f.sha(data):raise ValueError('FREEZE')
    frozen={name:(attempt/name).read_bytes() for name in artifacts}
    manifest=json.loads(frozen['human-review-manifest-v1.json'])
    if any(f.sha(frozen[name])!=sha for name,sha in manifest['sha256'].items()):raise ValueError('MANIFEST')
    post=load()
    if frozen['human-review-completed-export-v1.csv']!=post[0]:raise ValueError('EXPORT_BYTE_IDENTITY')
    v.validate(frozen['human-review-completed-export-v1.csv'],post[1]['neutral-review-session-v1.csv'],post[1]['neutral-review-identity-map-v1.jsonl'],post[2],frozen['human-review-labels-v1.jsonl'],json.loads(frozen['human-review-audit-v1.json']),json.loads(frozen['human-review-receipt-v1.json']),post[3])
    print(json.dumps({'attempt':str(attempt),'sha256':{n:f.sha(b) for n,b in artifacts.items()}},sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('D2F9_STOP='+type(exc).__name__+': '+str(exc),file=sys.stderr);sys.exit(1)
