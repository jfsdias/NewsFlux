"""Aggregate-only bounded audit; ephemeral witnesses never reach disk."""
import csv,hashlib,json
from pathlib import Path
from collections import Counter
import audit_capacity as a
B=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c';P2=B/'p2-fresh-features/attempt-20261027-v1/frozen-v1';P3=B/'p3-pack-search/attempt-20261027-r1-v1';DEV=B/'p4-dev-analysis/attempt-20261027-v1/dev-pair-diagnostics-v1.jsonl';M=B/'p4-human-labeling/session-20261027-v1/ingested-v1/human-label-ingestion-manifest-v1.json'
FILES={P2/'fresh-p3-feature-universe-v1.jsonl':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da',P2/'feature-p2-manifest-v1.json':'0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e',P3/'dev/annotation-pack-v1.csv':'a5168490d1daeee383934a47b8982341eaaa7e78a17343020e21ca7425a0ed10',P3/'blind/annotation-pack-v1.csv':'e5452ddb6df47d16b3da60d729d18a8186b2354a33e55de8ffbb755c5fc8b41b',DEV:'20373b25eaeb7d7b97c895164e74ee1c37d3b5d85d8f3a74f66060ad83fb57b8',M:'590ee4b36f067676dcbb7bffdfb22ea0d174e42a884e89ce1cb638c013b59156'}
def evaluate():
 for p,h in FILES.items():
  if hashlib.sha256(p.read_bytes()).hexdigest()!=h:raise ValueError('input integrity')
 m=json.loads(M.read_bytes())
 if m['blind_state']!='ANNOTATED_SEALED' or m['blind_sealed_artifact_sha256']!='e1dcc5396c239b6e58ede6c5661fece4dc0cbc4043d1e7772b516616f9716588':raise ValueError('sealed state')
 ids=set();keys=set()
 for name in ('dev','blind'):
  with (P3/name/'annotation-pack-v1.csv').open(newline='') as f:
   for r in csv.DictReader(f):keys.add(r['pair_key']);ids.update(map(int,r['pair_key'].split(':')))
 if len(keys)!=128:raise ValueError('existing packs')
 original=[json.loads(x) for x in (P2/'fresh-p3-feature-universe-v1.jsonl').open()]
 if len(original)!=33135 or len({r['pair_key'] for r in original})!=33135:raise ValueError('pair universe')
 rows=[r for r in original if a.eligible(r,ids)];scores=[r['qwen_score'] for r in rows];lex=[r['lexical_overlap'] for r in rows if r['lexical_overlap']>0]
 q={f'q{n}':a.quantile(scores,n/100) for n in (75,85,90,95)};q.update(q50_nonzero=a.quantile(lex,.5),q75_nonzero=a.quantile(lex,.75))
 strong={k:[r for r in rows if a.strong(r,k,q)] for k in a.CATALOG['strong']};bounds={k:a.matching_upper_bound(v) for k,v in strong.items()}
 raw_s={k:len(v) for k,v in strong.items()};raw_t={k:sum(a.text_match(r,k,q) for r in rows) for k in a.CATALOG['text']};frontier=[]
 for s in a.CATALOG['strong']:
  for t in a.CATALOG['text']:
   counts=Counter(a.lane(r,s,t,q) for r in rows)
   for name,quota in a.CATALOG['templates'].items():
    raw=all(counts[k]>=v for k,v in zip(('strong','text','near_miss','control'),quota))
    if not raw:status='INFEASIBLE_RAW_LANE';article='NOT_EVALUATED_RAW_FAIL'
    elif bounds[s] is not None and bounds[s]<quota[0]:status='INFEASIBLE_STRONG_MATCHING_BOUND';article='NO_PROVEN_STRONG_BOUND'
    else:status='UNKNOWN_BOUNDED_SEARCH';article='UNKNOWN'
    frontier.append(dict(strong=s,text=t,template=name,strong_raw=counts['strong'],text_raw=counts['text'],near_raw=counts['near_miss'],control_raw=counts['control'],raw_capacity_gate='PASS' if raw else 'FAIL',article_disjoint_feasible=article,diversity_feasible='NOT_EVALUATED',full_witness_feasible=status,search_complete='NO' if status=='UNKNOWN_BOUNDED_SEARCH' else 'YES'))
 maximum=a.max_total_witness(rows)
 if maximum['status']=='OPTIMAL':
  chosen=maximum.pop('rows');maximum['config_vectors']={f'{s}/{t}':dict(Counter(a.lane(r,s,t,q) for r in chosen)) for s in a.CATALOG['strong'] for t in a.CATALOG['text']}
 dev=[json.loads(x) for x in DEV.open()];old={}
 if len(dev)!=80:raise ValueError('old DEV size')
 for name in list(a.CATALOG['strong'])+list(a.CATALOG['text']):
  selected=[r for r in dev if (a.strong(r,name,q) if name.startswith('S') else a.text_match(r,name,q))]
  old[name]={'matches':len(selected),'labels':{label:sum(r['human_decision']==label for r in selected) for label in ('SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','UNCERTAIN')}}
 return {'eligible_pairs':len(rows),'quantiles':q,'raw_strong':raw_s,'raw_text':raw_t,'strong_matching_bounds':bounds,'frontier':frontier,'maximum_joint':maximum,'old_dev':old,'catalog_sha256':a.CATALOG_HASH}
if __name__=='__main__':
 with a.blind_guard():print(json.dumps(evaluate(),sort_keys=True))
