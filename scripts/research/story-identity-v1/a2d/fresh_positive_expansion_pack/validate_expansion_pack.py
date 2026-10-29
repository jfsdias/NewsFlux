"""Independent capacity-oracle reconstruction; never imports the selector."""
import hashlib
import json
import math
import networkx as nx


def canonical(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()

def check(condition,name):
    if not condition:raise ValueError(name)

def matching(edges):
    g=nx.Graph();g.add_edges_from((x['a'],x['b']) for x in edges)
    return len(nx.max_weight_matching(g,maxcardinality=True))

SCHEMA_KEYS={'selection_position','b1_rank','pair_key','article_id_a','article_id_b','qwen_score','supporting_feed_count','lexical_overlap','temporal_delta_hours','strategy_membership'}

def validate_schema(selected):
    check(isinstance(selected,list) and len(selected)==11,'PRIVATE_SELECTED_PACK_SCHEMA')
    seen_pairs=set();used=set();ranks=set()
    for position,row in enumerate(selected,1):
        check(isinstance(row,dict) and set(row)==SCHEMA_KEYS,'PRIVATE_SELECTED_PACK_SCHEMA')
        for field in ('selection_position','b1_rank','article_id_a','article_id_b'):
            check(type(row[field]) is int and row[field]>0,'PRIVATE_SELECTED_PACK_SCHEMA')
        check(row['selection_position']==position and row['article_id_a']<row['article_id_b'],'PRIVATE_SELECTED_PACK_SCHEMA')
        check(row['pair_key']==f"{row['article_id_a']}:{row['article_id_b']}",'PRIVATE_SELECTED_PACK_SCHEMA')
        check(row['pair_key'] not in seen_pairs and row['b1_rank'] not in ranks and row['article_id_a'] not in used and row['article_id_b'] not in used,'PRIVATE_SELECTED_PACK_SCHEMA')
        seen_pairs.add(row['pair_key']);ranks.add(row['b1_rank']);used.update((row['article_id_a'],row['article_id_b']))
        for field in ('qwen_score','lexical_overlap','temporal_delta_hours'):
            check(type(row[field]) in (int,float) and math.isfinite(row[field]),'PRIVATE_SELECTED_PACK_SCHEMA')
        check(type(row['supporting_feed_count']) is int and row['supporting_feed_count']>=0,'PRIVATE_SELECTED_PACK_SCHEMA')
        membership=row['strategy_membership']
        check(isinstance(membership,list) and all(isinstance(x,str) and x in {'B0','B1','B2','B3','B4','B5'} for x in membership) and membership==sorted(set(membership)) and 'B1' in membership,'PRIVATE_SELECTED_PACK_SCHEMA')
    check([row['b1_rank'] for row in selected]==sorted(ranks),'PRIVATE_SELECTED_PACK_SCHEMA')


def validate(rows, frontier, excluded, selected, proof, audit):
    validate_schema(selected)
    b1=[x for x in rows if 'B1' in x['strategy_membership']]
    b1.sort(key=lambda x:(-x['qwen'],-x['support'],-x['lexical'],x['gap'],int(x['a']),int(x['b'])))
    check(len(b1)==36 and len({(x['a'],x['b']) for x in b1})==36,'B1_COUNT')
    check(len({z for x in b1 for z in (x['a'],x['b'])})==25,'B1_ARTICLES')
    check(all(x['a']<x['b'] and x['a'] not in excluded and x['b'] not in excluded for x in b1),'ARTICLE_EXCLUSION')
    m=frontier['strategies']['B1']
    check((m['pairs'],m['articles'],m['matching'],m['logical_capacity_gate'])==(36,25,11,True),'FRONTIER_EXPECTATIONS')
    check(m['QWEN_THRESHOLD_USED']==0.2297840754548002 and m['QWEN_THRESHOLD_POLICY']=={'kind':'DIRECT_RESIDUAL_QUANTILE','quantile_id':'Q70'},'Q70')
    check(matching(b1)==11,'CAPACITY')
    chosen=[];occupied=set();trace=[]
    for i,edge in enumerate(b1):
        if len(chosen)==11:break
        a,b=edge['a'],edge['b']
        if a in occupied or b in occupied:
            trace.append({'rank':i+1,'decision':'occupied'});continue
        blocked=occupied|{a,b};remaining=[t for t in b1[i+1:] if t['a'] not in blocked and t['b'] not in blocked]
        graph=nx.Graph();graph.add_edges_from((t['a'],t['b']) for t in remaining)
        achievable=len(nx.algorithms.matching.max_weight_matching(graph,maxcardinality=True))
        needed=10-len(chosen);accept=achievable>=needed
        trace.append({'rank':i+1,'decision':'selected' if accept else 'rejected','needed':needed,'capacity':achievable})
        if accept:chosen.append((i+1,edge));occupied|={a,b}
    check(len(chosen)==11,'EXACT_K')
    expected=[]
    for position,(rank,x) in enumerate(chosen,1):
        expected.append({'selection_position':position,'b1_rank':rank,'pair_key':f"{x['a']}:{x['b']}",'article_id_a':x['a'],'article_id_b':x['b'],'qwen_score':x['qwen'],'supporting_feed_count':x['support'],'lexical_overlap':x['lexical'],'temporal_delta_hours':x['gap'],'strategy_membership':x['strategy_membership']})
    check(selected==expected,'OPTIMAL_PACK')
    ranks=[n for n,_ in chosen]
    check(proof['pack_size']==11 and proof['b1_input_pair_count']==36 and proof['b1_max_matching_capacity']==11 and proof['networkx_version']=='3.4.2' and proof['algorithm_version']=='LEXICOGRAPHIC_RANK_BY_FEASIBILITY_ORACLE_V1','PROOF_METADATA')
    check(proof['selected_rank_vector']==ranks and proof['feasibility_trace']==trace,'PROOF')
    check(proof['selected_rank_vector_sha256']==hashlib.sha256(canonical(ranks)).hexdigest(),'RANK_VECTOR_HASH')
    check(len({z for x in selected for z in (x['article_id_a'],x['article_id_b'])})==22,'DISJOINTNESS')
    source_graph=nx.Graph();source_graph.add_edges_from((x['a'],x['b']) for x in b1)
    components=list(nx.connected_components(source_graph))
    selected_edges=[x for _,x in chosen]
    expected_audit={'selected_pair_count':11,'selected_unique_article_count':22,'prior_review_article_overlap':0,'selected_component_count':sum(any(x['a'] in c for x in selected_edges) for c in components),'selected_feed_count':len({z for x in selected_edges for z in x['feed']}),'selected_category_count':len({z for x in selected_edges for z in x['category']})}
    check(audit==expected_audit,'AUDIT')


def verify_effective_pins(repo, source):
    """Independently verify the two committed contracts and five source byte hashes."""
    import subprocess
    from pathlib import Path
    original='cd152ada39c4418ffc38a1bc58d420d72e2670c3'
    erratum='c11db01f2174c748b058450d07fc2e1d0e8bb81f'
    rel='scripts/research/story-identity-v1/a2d/fresh_positive_expansion_pack/pack-contract-v1.json'
    subprocess.run(['git','merge-base','--is-ancestor',original,erratum],cwd=repo,check=True)
    old=json.loads(subprocess.check_output(['git','show',original+':'+rel],cwd=repo))
    effective=json.loads(subprocess.check_output(['git','show',erratum+':'+rel],cwd=repo))
    check(old['source_sha256']['manifest']=='973bf1ef6fcb8d63ca1a67ad3805d823a67331105c07fa2d619502a098e28fd2','OLD_PIN')
    check(effective['source_sha256']['manifest']=='973bf1ef6fcb6d63ca1a67ad3805d823a67331105c07fa2d619502a098e28fd2','CORRECT_PIN')
    old['source_sha256']['manifest']=effective['source_sha256']['manifest']
    check(old==effective,'ERRATUM_SCOPE')
    names={'contract':'fresh-positive-expansion-contract-v1.json','candidates':'fresh-positive-expansion-candidates-v1.jsonl','frontier':'fresh-positive-expansion-frontier-v1.json','receipt':'fresh-positive-expansion-receipt-v1.json','manifest':'fresh-positive-expansion-manifest-v1.json'}
    for role,name in names.items():
        p=Path(source)/name
        check(p.stat().st_mode & 0o777==0o444,'SOURCE_MODE')
        check(hashlib.sha256(p.read_bytes()).hexdigest()==effective['source_sha256'][role],'SOURCE_HASH')
    return effective
