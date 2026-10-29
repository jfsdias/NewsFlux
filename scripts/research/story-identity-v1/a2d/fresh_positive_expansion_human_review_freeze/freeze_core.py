"""Exact one-to-one human-review restoration without outcome aggregation."""
import csv
import hashlib
import io
import json

COLUMNS=('review_id','left_title','left_source','left_published_at','right_title','right_source','right_published_at','human_decision')
MAP_KEYS=('review_id','pair_key','article_id_a','article_id_b','left_article_id','right_article_id','selection_position','b1_rank')
IDENTITY_KEYS=('pair_key','article_id_a','article_id_b','selection_position','b1_rank')
LABELS={'SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN'}

def canonical(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(data):return hashlib.sha256(data).hexdigest()
def parse_csv(data):
    reader=csv.DictReader(io.StringIO(data.decode('utf-8'),newline=''))
    if tuple(reader.fieldnames or ())!=COLUMNS:raise ValueError('CSV_SCHEMA')
    rows=list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):raise ValueError('CSV_ROW_SCHEMA')
    return rows

def restore(completed, visible, mapping, selected):
    ids=[f'R{i:03}' for i in range(1,12)]
    if len(completed)!=11 or len(visible)!=11 or len(mapping)!=11 or len(selected)!=11:raise ValueError('ROW_COUNT')
    if [x.get('review_id') for x in completed]!=ids or [x.get('review_id') for x in visible]!=ids or [x.get('review_id') for x in mapping]!=ids:raise ValueError('REVIEW_ID_ORDER')
    byid={x['review_id']:x for x in mapping}
    if len(byid)!=11 or len({x['pair_key'] for x in mapping})!=11 or len({z for x in mapping for z in (x['article_id_a'],x['article_id_b'])})!=22:raise ValueError('MAPPING_UNIQUENESS')
    expected={tuple(x[k] for k in IDENTITY_KEYS) for x in selected}
    actual={tuple(x[k] for k in IDENTITY_KEYS) for x in mapping}
    if len(expected)!=11 or expected!=actual:raise ValueError('PAIR_IDENTITY')
    out=[]
    for row,original in zip(completed,visible):
        if set(row)!=set(COLUMNS) or set(original)!=set(COLUMNS):raise ValueError('CSV_SCHEMA')
        if row['human_decision'] not in LABELS or original['human_decision']!='':raise ValueError('DECISION')
        if any(row[k]!=original[k] for k in COLUMNS[:-1]):raise ValueError('METADATA')
        m=byid[row['review_id']]
        if set(m)!=set(MAP_KEYS) or {m['left_article_id'],m['right_article_id']}!={m['article_id_a'],m['article_id_b']} or m['article_id_a']>=m['article_id_b'] or m['pair_key']!=f"{m['article_id_a']}:{m['article_id_b']}":raise ValueError('IDENTITY_MAP')
        out.append(dict(m,human_decision=row['human_decision']))
    return out

def validate_governance(audit,receipt):
    allowed={'row_count','nonempty_decision_count','unknown_decision_count','review_id_count','metadata_match','identity_join_count'}
    if not set(audit)<=allowed or receipt.get('distribution_computed') is not False or receipt.get('scientific_result_computed',False) is not False:raise ValueError('GOVERNANCE')

def verify_hash(data,expected,byte_length=None):
    if sha(data)!=expected or (byte_length is not None and len(data)!=byte_length):raise ValueError('HASH_GATE')

def fingerprints(visible,mapping):
    metadata=[{k:x[k] for k in COLUMNS[:-1]} for x in visible]
    identities=[{k:x[k] for k in ('review_id','pair_key','left_article_id','right_article_id')} for x in mapping]
    return sha(canonical(metadata)),sha(canonical(identities))

def validate_restored(rows):
    if len(rows)!=11:raise ValueError('RESTORED_SCHEMA')
    for x in rows:
        if set(x)!=set(MAP_KEYS)|{'human_decision'} or x['human_decision'] not in LABELS:raise ValueError('RESTORED_SCHEMA')
