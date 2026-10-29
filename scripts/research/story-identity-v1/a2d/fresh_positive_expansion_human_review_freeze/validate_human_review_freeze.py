"""Independent identity and integrity checks without outcome aggregation."""
import csv
import hashlib
import io
import json

COLS=('review_id','left_title','left_source','left_published_at','right_title','right_source','right_published_at','human_decision')
MAP=('review_id','pair_key','article_id_a','article_id_b','left_article_id','right_article_id','selection_position','b1_rank')
PAIR=('pair_key','article_id_a','article_id_b','selection_position','b1_rank')
ALLOWED={'SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN'}

def check(ok,name):
    if not ok:raise ValueError(name)
def canon(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def read_csv(data):
    reader=csv.DictReader(io.StringIO(data.decode('utf-8'),newline=''))
    check(tuple(reader.fieldnames or ())==COLS,'CSV_SCHEMA')
    rows=list(reader);check(all(None not in row and all(v is not None for v in row.values()) for row in rows),'CSV_ROW_SCHEMA')
    return rows

def validate(completed,visible,mapdata,selecteddata,labeldata,audit,receipt,contract):
    check(len(completed)==contract['export_bytes'] and sha(completed)==contract['export_sha256'],'EXPORT_BYTES')
    original=read_csv(visible);rows=read_csv(completed)
    maps=[json.loads(x) for x in mapdata.splitlines()];selected=[json.loads(x) for x in selecteddata.splitlines()];restored=[json.loads(x) for x in labeldata.splitlines()]
    ids=[f'R{i:03}' for i in range(1,12)]
    check(len(rows)==len(original)==len(maps)==len(selected)==len(restored)==11,'ROW_COUNT')
    check([r['review_id'] for r in rows]==[r['review_id'] for r in original]==[m['review_id'] for m in maps]==ids,'REVIEW_ID_ORDER')
    for row,source in zip(rows,original):
        check(row['human_decision'] in ALLOWED and source['human_decision']=='','DECISION_VALIDITY')
        check(all(row[k]==source[k] for k in COLS[:-1]),'METADATA_MATCH')
    metadata=[{k:x[k] for k in COLS[:-1]} for x in rows]
    identities=[{k:x[k] for k in ('review_id','pair_key','left_article_id','right_article_id')} for x in maps]
    check(sha(canon(metadata))==contract['metadata_sha256'],'METADATA_FINGERPRINT')
    check(sha(canon(identities))==contract['identity_map_sha256'],'IDENTITY_FINGERPRINT')
    check(len({x['review_id'] for x in maps})==11 and len({x['pair_key'] for x in maps})==11,'MAPPING_UNIQUENESS')
    check({tuple(x[k] for k in PAIR) for x in maps}=={tuple(x[k] for k in PAIR) for x in selected} and len({tuple(x[k] for k in PAIR) for x in selected})==11,'PAIR_IDENTITY')
    check(len({z for x in maps for z in (x['article_id_a'],x['article_id_b'])})==22,'ARTICLE_IDENTITY')
    byid={m['review_id']:m for m in maps}
    for row,label in zip(rows,restored):
        m=byid[row['review_id']]
        check(set(m)==set(MAP) and set(label)==set(MAP)|{'human_decision'},'RESTORED_SCHEMA')
        check(m['article_id_a']<m['article_id_b'] and m['pair_key']==f"{m['article_id_a']}:{m['article_id_b']}" and {m['left_article_id'],m['right_article_id']}=={m['article_id_a'],m['article_id_b']},'ORIENTATION')
        check(all(label[k]==m[k] for k in MAP) and label['human_decision']==row['human_decision'],'IDENTITY_JOIN')
    required={'row_count','nonempty_decision_count','unknown_decision_count','review_id_count','metadata_match','identity_join_count'}
    check(set(audit)==required and audit=={'row_count':11,'nonempty_decision_count':11,'unknown_decision_count':0,'review_id_count':11,'metadata_match':True,'identity_join_count':11},'AUDIT_SCHEMA')
    check(receipt.get('distribution_computed') is False and receipt.get('scientific_result_computed') is False,'RECEIPT_POLICY')
    check(not any(any(token in k.lower() for token in ('same_event_count','related_topic_count','different_event_count','uncertain_count','class_count')) for k in receipt),'RECEIPT_SCHEMA')


def verify_source_bytes(export,source_bytes,selected,contract):
    check(len(export)==contract['export_bytes'] and sha(export)==contract['export_sha256'],'EXPORT_HASH')
    check(set(source_bytes)==set(contract['d2f8_sha256']),'SOURCE_SET')
    for name,expected in contract['d2f8_sha256'].items():check(sha(source_bytes[name])==expected,'SOURCE_HASH')
    check(sha(selected)==contract['d2f7_selected_pack_sha256'],'D2F7_HASH')
