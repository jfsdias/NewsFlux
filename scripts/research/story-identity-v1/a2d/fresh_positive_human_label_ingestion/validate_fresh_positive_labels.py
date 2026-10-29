"""Independent reconstruction and frozen readback, with no stratification."""
import json,sys
from pathlib import Path
import ingest_fresh_positive_labels as m

def validate(root):
 root=Path(root)
 with m.guard():
  m.verify_inputs()
  raw=(m.COMPLETION/'fresh-positive-human-completed-v1.csv').read_bytes()
  human=m.read_csv(raw);blank=m.read_csv((m.SESSION/'reviewer/neutral-review-v1.csv').read_bytes())
  m.validate_review(human,blank)
  if m.sha(m.blank_bytes(human))!=m.INPUTS[m.SESSION/'reviewer/neutral-review-v1.csv']:raise ValueError('neutral hash')
  selected=[json.loads(x) for x in (m.SESSION/'selected-positive-review-pack-v1.jsonl').read_bytes().splitlines()]
  mapping=[json.loads(x) for x in (m.SESSION/'neutral-review-map-v1.jsonl').read_bytes().splitlines()]
  source={r['pair_key']:r for r in selected};reviews={r['annotation_id']:r['human_decision'] for r in human};maps={r['review_annotation_id']:r for r in mapping}
  data=(root/'fresh-positive-human-labels-v1.jsonl').read_bytes();rows=[json.loads(x) for x in data.splitlines()]
  ids={f'R{i:03}' for i in range(1,41)}
  if len(rows)!=40 or len(source)!=40 or len(maps)!=40 or set(maps)!=ids or {r['review_annotation_id'] for r in rows}!=ids or len({r['pair_key'] for r in rows})!=40:raise ValueError('counts')
  if data!=b''.join(m.canonical(r) for r in rows) or [r['pair_key'] for r in rows]!=sorted(source):raise ValueError('serialization')
  for r in rows:
   if set(r)!={'review_annotation_id','pair_key','human_decision'}:raise ValueError('schema')
   mm=maps[r['review_annotation_id']];ss=source[r['pair_key']];a=mm['article_id_a'];b=mm['article_id_b']
   if mm['pair_key']!=r['pair_key'] or reviews[r['review_annotation_id']]!=r['human_decision'] or a>=b or r['pair_key']!=f'{a}:{b}' or set(ss)!=(set(mm)-{'review_annotation_id'}) or any(ss[k]!=mm[k] for k in ss):raise ValueError('crosscheck')
  if len({i for r in selected for i in (r['article_id_a'],r['article_id_b'])})!=80:raise ValueError('article uniqueness')
  manifest=json.loads((root/'fresh-positive-human-label-ingestion-manifest-v1.json').read_bytes());audit=json.loads((root/'fresh-positive-human-label-ingestion-audit-v1.json').read_bytes())
  files={'human-completed-input-v1.csv':'completed_sha256','fresh-positive-human-labels-v1.jsonl':'labels_sha256','fresh-positive-human-label-ingestion-audit-v1.json':'audit_sha256'}
  for name,key in files.items():
   p=root/name
   if p.stat().st_mode&0o777!=0o444 or m.sha(p.read_bytes())!=manifest[key]:raise ValueError('manifest')
  if (root/'fresh-positive-human-label-ingestion-manifest-v1.json').stat().st_mode&0o777!=0o444 or root.stat().st_mode&0o777!=0o700:raise ValueError('mode')
  if (root/'human-completed-input-v1.csv').read_bytes()!=raw or audit['class_counts']!=m.counts(rows) or sum(audit['class_counts'].values())!=40:raise ValueError('audit')
  if manifest['input_sha256']!={p.name:h for p,h in m.INPUTS.items()}:raise ValueError('input pins')
  m.verify_inputs()
 return {'independent_label_ingestion_validator':'PASS','row_count':40,'manifest_sha256':m.sha((root/'fresh-positive-human-label-ingestion-manifest-v1.json').read_bytes())}
if __name__=='__main__':print(json.dumps(validate(sys.argv[1]),sort_keys=True))
