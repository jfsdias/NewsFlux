"""Label-blind research selection; no human-label, model or network access."""
from __future__ import annotations
import builtins, contextlib, csv, hashlib, io, json, os, sys
from collections import Counter, defaultdict
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'graph_context_retrieval'))
import graph_context as graph

FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels-v1.jsonl','blind-human-labels-sealed-v1.jsonl','review-session-v1-human-completed.csv')
ROOT=Path.home()/'NewsFlux-STORY00/private-p4'
R2=ROOT/'story02-a2d2c/p4-graph-context-retrieval/attempt-20261028-r2a-v1'
P3=ROOT/'story02-a2d2c/p3-pack-search/attempt-20261027-r1-v1'
CORPUS=ROOT/'story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
HOME=ROOT/'20261023-220212/home-200.jsonl'
DEV=P3/'dev/annotation-pack-v1.csv'; BLIND=P3/'blind/annotation-pack-v1.csv'
HASHES={
 R2/'fresh-graph-context-features-v1.jsonl':'fe0f3372cca91d8ccbc775dac7ba97e3855c076b6ae79ae032a32b27d49223b9',
 R2/'historical-graph-context-features-v1.jsonl':'4f9d53f6f3443e403b67f69c818e8d74d15d2874fc3990450bef65e674af5d16',
 R2/'graph-strategy-catalog-v1.json':'70dd2bcb55bbd36a9bf4327ef8bd3c980e5a10b9a5f4af0ade4e12472f2b8a9c',
 R2/'graph-strategy-diagnostics-v1.csv':'9214b1c5aecc308fae8d06344b291a20aedd77cb00786d0b439df16893fbeb35',
 R2/'graph-pack-feasibility-v1.csv':'42ab2a1d611183bf7a96d5873cfdff55b7dedc11a979e2277a249a5bc55ac815',
 R2/'graph-context-audit-v1.json':'2358b4f51c6b71f9cc5b0f36f0e662a46588812250cd8dba4970a5ca33892e8d',
 R2/'graph-context-manifest-v1.json':'429c4c06b6c57ca52f2ea6d5cab707aadcdf2b95b8027ff2950943e054d901fb',
 R2/'gold-coverage-receipt-v1.json':'dc1eecd8b8ddf502ef3f2aa22ec7a23e2e6597f419f85ae80253f15f0cd966f3',
 CORPUS:'3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206', HOME:'0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0',
 DEV:'a5168490d1daeee383934a47b8982341eaaa7e78a17343020e21ca7425a0ed10',BLIND:'e5452ddb6df47d16b3da60d729d18a8186b2354a33e55de8ffbb755c5fc8b41b'}
QUOTAS={'event':20,'near':12,'control':8}

def digest(data): return hashlib.sha256(data).hexdigest()
def priority(contract_hash,lane,pair_key): return digest(f'STORY02-R3|{contract_hash}|{lane}|{pair_key}'.encode())

@contextlib.contextmanager
def label_guard():
    originals=(builtins.open,io.open,Path.open,Path.read_text,Path.read_bytes)
    def wrap(fn):
        def guarded(path,*args,**kwargs):
            if any(name.lower() in str(path).lower() for name in FORBIDDEN): raise PermissionError('human-label access forbidden')
            return fn(path,*args,**kwargs)
        return guarded
    with patch.object(builtins,'open',wrap(originals[0])),patch.object(io,'open',wrap(originals[1])),patch.object(Path,'open',wrap(originals[2])),patch.object(Path,'read_text',wrap(originals[3])),patch.object(Path,'read_bytes',wrap(originals[4])): yield

def lexicographic_lock(candidates,feasible,target):
    included=set();excluded=set()
    for i,_ in enumerate(candidates):
        if len(included)==target: break
        if feasible(included|{i},excluded): included.add(i)
        else: excluded.add(i)
    if len(included)!=target: raise ValueError('no exact witness')
    return sorted(included)

def freeze(path,data):
    path=Path(path);tmp=path.with_name('.'+path.name+'.tmp')
    if path.exists(): raise FileExistsError(path)
    with tmp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
    h=digest(data)
    if digest(tmp.read_bytes())!=h:raise ValueError('pre-freeze hash')
    os.replace(tmp,path); path.chmod(0o444)
    if path.stat().st_mode&0o777!=0o444 or digest(path.read_bytes())!=h:raise ValueError('post-freeze hash')
    return h

def check_inputs():
    for p,h in HASHES.items():
        if digest(p.read_bytes())!=h:raise ValueError('input hash mismatch '+p.name)
        if p.is_relative_to(R2) and p.stat().st_mode&0o777!=0o444:raise ValueError('R2 input mode')
    if graph.strategy_catalog_hash()!=HASHES[R2/'graph-strategy-catalog-v1.json'] or graph.STRATEGY_CATALOG['event']['E0']['name']!='RECIPROCAL_5' or graph.STRATEGY_CATALOG['near']['N1']['name']!='RECIPROCAL_WITHOUT_SHARED_SUPPORT' or graph.STRATEGY_CATALOG['templates']['G40']!=QUOTAS:raise ValueError('strategy drift')
    receipt=json.loads((R2/'gold-coverage-receipt-v1.json').read_bytes())
    expected={'gold_pair_count':233,'gold_unique_pair_count':233,'gold_article_count':153,'home200_article_count':200,'gold_pair_missing_from_historical_source':0,'gold_pair_missing_from_historical_context':0,'gold_article_missing_from_home200':0,'gold_graph_compatibility_gate':'PASS','gold_identity_subset_home200_gate':'PASS','gold_pair_set_sha256':'5bd1ac7d13c4eb5a5ab6279b2522a0f5ab9e9203471e62c59696942d6ab48880','gold_article_set_sha256':'67508740cb22cdc0bb502cd37cb652b8f31746f4d285fc6da9dc4fc61ef40c85'}
    if any(receipt.get(k)!=v for k,v in expected.items()):raise ValueError('R2A receipt')
    audit=json.loads((R2/'graph-context-audit-v1.json').read_bytes())
    if audit['graph_context_signal_gate']!='PASS' or audit['g40_feasible_config_count']!=5 or audit['g48_feasible_config_count']!=4 or set(audit['recommended_for_pm_review'])!={'E0/N1/G40','E3/N1/G40','E3/N1/G48'}:raise ValueError('scientific parity')
    return receipt

def pack_keys(path):
    with path.open(newline='') as f:
        rows=csv.DictReader(f); result=set()
        for r in rows:
            if r.get('pair_key'): a,b=map(int,r['pair_key'].split(':'))
            else:
                cols=next((x for x in [('id_a','id_b'),('entry_a_id','entry_b_id'),('article_a_id','article_b_id')] if r.get(x[0]) and r.get(x[1])),None)
                if cols is None:raise ValueError('pack schema')
                a,b=(int(r[k]) for k in cols)
            result.add(f'{min(a,b)}:{max(a,b)}')
        return result

def contract():
    return {'version':'STORY_02_GRAPH_RETRIEVAL_SELECTION_V1','base_main_sha':'680287ea4ca33494e77e93724829b579d175bb1c','r2a_manifest_sha256':HASHES[R2/'graph-context-manifest-v1.json'],'r2a_audit_sha256':HASHES[R2/'graph-context-audit-v1.json'],'gold_coverage_receipt_sha256':HASHES[R2/'gold-coverage-receipt-v1.json'],'fresh_graph_context_sha256':HASHES[R2/'fresh-graph-context-features-v1.jsonl'],'graph_strategy_catalog_sha256':HASHES[R2/'graph-strategy-catalog-v1.json'],'fresh_corpus_sha256':HASHES[CORPUS],'home200_sha256':HASHES[HOME],'event_strategy':'E0','near_strategy':'N1','template':'G40','event_quota':20,'near_quota':12,'control_quota':8,'total_pairs':40,'selection_loss_principle':'FALSE_MERGE_COST_GT_FALSE_SPLIT_COST','gold_isolation_proof':'TRANSITIVE_VIA_R2A_GOLD_SUBSET_HOME200_AND_FRESH_HOME200_DISJOINTNESS','production_policy':'NOT_FROZEN'}

def solve(rows):
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix
    constraints=[]
    for lane,q in QUOTAS.items():constraints.append(({i:1 for i,r in enumerate(rows) if r['selection_lane']==lane},q,q))
    groups=defaultdict(dict)
    for i,r in enumerate(rows):
        for side in ('a','b'):
            for kind,key in [('article',r[f'article_{side}_id']),('feed',r[f'feed_{side}_id']),('category',r[f'category_{side}'])]:
                d=groups[(kind,str(key))];d[i]=d.get(i,0)+1
        groups[('source',tuple(sorted((str(r['feed_a_id']),str(r['feed_b_id'])))))][i]=1
    for (kind,_),d in groups.items():constraints.append((d,0,{'article':1,'feed':16,'category':40,'source':4}[kind]))
    ri=[];ci=[];vv=[];lo=[];hi=[]
    for j,(d,l,h) in enumerate(constraints):
        lo.append(l);hi.append(h)
        for i,v in d.items():ri.append(j);ci.append(i);vv.append(v)
    mat=coo_matrix((np.array(vv,dtype=float),(np.array(ri,dtype='int32'),np.array(ci,dtype='int32'))),shape=(len(constraints),len(rows))).tocsc()
    constraint=LinearConstraint(mat,np.array(lo),np.array(hi)); n=len(rows); witness=set(); calls=0
    def feasible(yes,no):
        nonlocal witness,calls
        if yes<=witness and not no&witness:return True
        lower=np.zeros(n);upper=np.ones(n)
        for i in yes:lower[i]=1
        for i in no:upper[i]=0
        result=milp(np.zeros(n),integrality=np.ones(n),bounds=Bounds(lower,upper),constraints=constraint,options={'time_limit':60})
        calls+=1
        if result.status==2:return False
        if result.status!=0 or result.x is None:raise RuntimeError(f'solver undecided {result.status}')
        witness={i for i,v in enumerate(result.x) if v>.5}
        return True
    if not feasible(set(),set()):raise ValueError('no feasible witness')
    selected=lexicographic_lock(rows,feasible,40)
    return [rows[i] for i in selected],calls

def validate(selected, corpus, home_ids, dev_keys, blind_keys):
    if len(selected)!=40 or Counter(r['selection_lane'] for r in selected)!=QUOTAS:raise ValueError('quotas')
    keys=[r['pair_key'] for r in selected]; ids=[int(r[f'article_{s}_id']) for r in selected for s in ('a','b')]
    if len(set(keys))!=40 or len(set(ids))!=80 or not set(ids)<=set(corpus) or set(ids)&home_ids:raise ValueError('article membership')
    for old in (dev_keys,blind_keys):
        prior={int(x) for k in old for x in k.split(':')}
        if set(keys)&old or set(ids)&prior:raise ValueError('existing pack overlap')
    f=Counter();c=Counter();sp=Counter()
    for r in selected:
        endpoints=sorted((int(r['article_a_id']),int(r['article_b_id'])))
        if r['pair_key']!=f'{endpoints[0]}:{endpoints[1]}':raise ValueError('pair identity')
        if graph.classify_lanes([r],'E0','N1')[0]['selection_lane']!=r['selection_lane']:raise ValueError('lane')
        a,b=(corpus[int(r[f'article_{s}_id'])] for s in ('a','b'))
        if str(a['feed_id'])!=str(r['feed_a_id']) or str(b['feed_id'])!=str(r['feed_b_id']) or a['feed_id']==b['feed_id']:raise ValueError('feed')
        hours=abs(graph._timestamp(a['published_at'])-graph._timestamp(b['published_at']))/3600
        if not 0<=hours<=24 or abs(round(hours,4)-float(r['temporal_delta_hours']))>1e-9:raise ValueError('time')
        for x in (a,b):f[str(x['feed_id'])]+=1;c[str(x['category_id'])]+=1
        sp[tuple(sorted((str(a['feed_id']),str(b['feed_id']))))]+=1
    if max(f.values())>16 or max(c.values())>40 or max(sp.values())>4:raise ValueError('diversity')
    return {'max_feed_share':max(f.values())/80,'max_source_pair_share':max(sp.values())/40,'max_category_share':max(c.values())/80,'max_temporal_delta_hours':max(float(r['temporal_delta_hours']) for r in selected),'same_feed_pair_count':0}

def jsonl(path):return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
def encode_pack(selected,corpus):
    out=io.StringIO(newline='');cols=['annotation_id','pair_key','feed_a','feed_b','title_a','title_b','published_at_a','published_at_b','label_options','human_decision'];w=csv.DictWriter(out,fieldnames=cols,lineterminator='\n');w.writeheader();side=[]
    fields=['qwen_score','temporal_delta_hours','rank_a_to_b','rank_b_to_a','reciprocal_rank_max','shared_support_article_count','shared_support_feed_count','common_top5_count','common_top10_count','support_degree_a','support_degree_b','min_support_degree','support_burst_span_hours']
    for i,r in enumerate(selected,1):
        a,b=(corpus[int(r[f'article_{s}_id'])] for s in ('a','b'));ident=f'G{i:03}'
        w.writerow({'annotation_id':ident,'pair_key':r['pair_key'],'feed_a':a['feed_title'],'feed_b':b['feed_title'],'title_a':a['title'],'title_b':b['title'],'published_at_a':a['published_at'],'published_at_b':b['published_at'],'label_options':'SAME_EVENT|RELATED_TOPIC|DIFFERENT_EVENT|UNCERTAIN','human_decision':''})
        side.append({'annotation_id':ident,'pair_key':r['pair_key'],'selection_lane':r['selection_lane'],'selection_priority':r['selection_priority'],'event_strategy':'E0','near_strategy':'N1','template':'G40',**{k:r[k] for k in fields}})
    return out.getvalue().encode(),b''.join(graph.canonical_json_bytes(x) for x in side)

def run(dest):
    import scipy
    dest=Path(dest).resolve();allowed=(ROOT/'story02-a2d2c/p4-graph-retrieval-selection').resolve()
    if not dest.is_relative_to(allowed) or dest==allowed or dest.exists():raise ValueError('new private destination required')
    with label_guard():
        check_inputs(); corpusrows=jsonl(CORPUS);home=jsonl(HOME);corpus={int(x['id']):x for x in corpusrows};homeids={int(x['id']) for x in home}
        if len(corpusrows)!=500 or len(corpus)!=500 or len(home)!=200 or len(homeids)!=200 or set(corpus)&homeids:raise ValueError('fresh/home isolation')
        dev,blind=pack_keys(DEV),pack_keys(BLIND)
        dest.mkdir(parents=True,mode=0o700); ch=freeze(dest/'graph-retrieval-contract-v1.json',graph.canonical_json_bytes(contract()))
        rows=graph.classify_lanes(jsonl(R2/'fresh-graph-context-features-v1.jsonl'),'E0','N1');counts=dict(Counter(r['selection_lane'] for r in rows))
        for r in rows:r['selection_priority']=priority(ch,r['selection_lane'],r['pair_key'])
        rows.sort(key=lambda r:r['selection_priority'])
        one,calls1=solve(rows);two,calls2=solve(rows);p1,s1=encode_pack(one,corpus);p2,s2=encode_pack(two,corpus)
        if p1!=p2 or s1!=s2:raise ValueError('selection replay')
        metrics=validate(one,corpus,homeids,dev,blind);validate(two,corpus,homeids,dev,blind)
        audit={'version':'STORY02_R3_SELECTION_AUDIT_V1','contract_sha256':ch,'r2a_receipt_sha256':HASHES[R2/'gold-coverage-receipt-v1.json'],'r2a_audit_sha256':HASHES[R2/'graph-context-audit-v1.json'],'r2a_manifest_sha256':HASHES[R2/'graph-context-manifest-v1.json'],'fresh_corpus_sha256':HASHES[CORPUS],'home200_sha256':HASHES[HOME],'candidate_counts':counts,'selected_counts':QUOTAS,'selected_total':40,'unique_articles':80,'selection_algorithm':'LEXICOGRAPHIC_FEASIBILITY_LOCKING','solver':'scipy.optimize.milp','solver_version':scipy.__version__,'solver_status':'OPTIMAL_FEASIBILITY','solver_calls':[calls1,calls2],'replay_gate':'PASS','independent_validator':'PASS','fresh_home200_overlap':0,'gold_transitive_isolation':'PASS','existing_dev_pair_overlap':0,'existing_dev_article_overlap':0,'existing_blind_pair_overlap':0,'existing_blind_article_overlap':0,'human_label_accesses':0,**metrics}
        ph=freeze(dest/'targeted-dev-graph-pack-v1.csv',p1);sh=freeze(dest/'targeted-dev-graph-sidecar-v1.jsonl',s1);ah=freeze(dest/'targeted-dev-graph-selection-audit-v1.json',graph.canonical_json_bytes(audit))
        manifest={'version':'STORY02_R3_SELECTION_V1','retrieval_contract_sha256':ch,'pack_sha256':ph,'sidecar_sha256':sh,'selection_audit_sha256':ah,'input_sha256':{str(p.relative_to(ROOT)):h for p,h in HASHES.items()},'pack_state':'SELECTED_FROZEN_UNANNOTATED','human_labels':0,'human_review_started':False,'production_policy':'NOT_FROZEN'}
        mh=freeze(dest/'targeted-dev-graph-selection-manifest-v1.json',graph.canonical_json_bytes(manifest))
        return {**audit,'pack_sha256':ph,'sidecar_sha256':sh,'selection_audit_sha256':ah,'manifest_sha256':mh}
if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('usage: select_graph_dev.py PRIVATE_ATTEMPT')
    print(json.dumps(run(sys.argv[1]),sort_keys=True))
