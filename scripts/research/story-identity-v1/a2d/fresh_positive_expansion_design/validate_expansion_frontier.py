"""Independent reconstruction of label-blind membership and aggregate capacity."""
from collections import Counter
import math
import networkx as nx


class ValidationError(Exception):
    pass

def require(name, condition):
    if not condition: raise ValidationError(name)

def independent_quantile(scores, n):
    scores=sorted(scores)
    pos=(len(scores)-1)*(n/100)
    low=math.floor(pos); high=math.ceil(pos)
    return scores[low]+(scores[high]-scores[low])*(pos-low)

def validate(src, candidates, frontier):
    features, graph, caps, universe, excluded, oldpool=src
    eligible=[]
    for x in features:
        a,b=int(x['article_a_id']),int(x['article_b_id']); k=f'{a}:{b}'
        if a in excluded or b in excluded or caps[a]['content_status']!='USABLE' or caps[b]['content_status']!='USABLE':continue
        require('V04_PAIR_UNIVERSE_MEMBERSHIP', k in universe and x['feed_a_id']!=x['feed_b_id'] and 0<=x['temporal_delta_hours']<=24)
        eligible.append(x)
    scores=sorted(x['qwen_score'] for x in eligible)
    qs={}
    for n in (60,70,75,80,90):
        qs['.'+str(n/100).split('.')[1]]=independent_quantile(scores,n)
    for idx,n in enumerate((60,70,75,80,90),8):
        k='.'+str(n/100).split('.')[1]
        require(f'V{idx:02d}_QUANTILE_Q{n}', qs[k]==frontier['quantiles'][k])
    validate_thresholds(frontier['strategies'],qs)
    expected={}
    for x in eligible:
        a,b=int(x['article_a_id']),int(x['article_b_id']);k=f'{a}:{b}';s=graph[k]['shared_support_feed_count'];v=x['qwen_score'];lex=x['lexical_overlap']
        anchor=x['entity_anchor_overlap']>0 or x['number_overlap']>0 or x['date_overlap']>0
        names=[]
        if k in oldpool:names.append('B0')
        if v>=qs['.7'] and s>=2:names.append('B1')
        if v>=qs['.6'] and s>=2 and anchor:names.append('B2')
        if v>=qs['.8'] and lex>=.05 and anchor:names.append('B3')
        if v>=qs['.8'] and lex<.05 and s>=1 and anchor:names.append('B4')
        if any(z in names for z in ('B1','B2','B3','B4')):names.append('B5')
        if names:expected[k]=sorted(names)
    actual={f"{r['a']}:{r['b']}":r for r in candidates}
    require('V18_B5_UNION_DEDUP', len(actual)==len(candidates) and set(actual)==set(expected))
    for i in range(6):
        name=f'B{i}'
        require(f'V{13+i:02d}_{name}_PREDICATE', all((name in actual[k]['strategy_membership']) == (name in v) for k,v in expected.items()))
    for x in eligible:
        a,b=int(x['article_a_id']),int(x['article_b_id']); k=f'{a}:{b}'
        if k not in actual: continue
        r=actual[k]
        require('V07_RESIDUAL_UNIVERSE_CONSTRUCTION', (r['qwen'],r['support'],r['lexical'],r['entity'],r['number'],r['date'],r['gap']) == (x['qwen_score'],graph[k]['shared_support_feed_count'],x['lexical_overlap'],x['entity_anchor_overlap'],x['number_overlap'],x['date_overlap'],x['temporal_delta_hours']))
        require('V22_V23_FEED_CATEGORY_INPUTS', r['feed']==sorted((x['feed_a_id'],x['feed_b_id'])) and r['category']==sorted((x['category_a'],x['category_b'])))
        require('V24_TITLE_EQUIVALENCE_AGGREGATES', r['equiv']==(caps[a]['content_equals_title'] is True or caps[b]['content_equals_title'] is True))
    require('V05_PRIOR_REVIEW_ARTICLE_EXCLUSION', all(r['a'] not in excluded and r['b'] not in excluded for r in candidates))
    require('V19_COMMON_RANKING', candidates==sorted(candidates,key=lambda r:(-r['qwen'],-r['support'],-r['lexical'],r['gap'],r['a'],r['b'])))
    for name, summary in frontier['strategies'].items():
        subset=[r for r in candidates if name in r['strategy_membership']]
        net=nx.Graph();net.add_edges_from((r['a'],r['b']) for r in subset)
        components=list(nx.connected_components(net)); counts=[sum(r['a'] in c for r in subset) for c in components]
        feeds=Counter(tuple(r['feed']) for r in subset);cats=Counter(tuple(r['category']) for r in subset); n=len(subset)
        card=len(nx.algorithms.matching.max_weight_matching(net,maxcardinality=True))
        independent={'pairs':n,'articles':net.number_of_nodes(),'components':len(components),'largest_component_pairs':max(counts,default=0),'largest_component_share':max(counts,default=0)/n if n else 0,'matching':card,'feed_combinations':len(feeds),'max_feed_share':max(feeds.values(),default=0)/n if n else 0,'category_combinations':len(cats),'max_category_share':max(cats.values(),default=0)/n if n else 0,'title_equivalent_pairs':sum(r['equiv'] for r in subset),'both_usable_rate':1.0 if n else None,'logical_capacity_gate':card>=5}
        for field, inv in [('pairs','V07_RESIDUAL_UNIVERSE_CONSTRUCTION'),('articles','V07_RESIDUAL_UNIVERSE_CONSTRUCTION'),('components','V20_COMPONENT_CONSTRUCTION'),('largest_component_pairs','V20_COMPONENT_CONSTRUCTION'),('largest_component_share','V20_COMPONENT_CONSTRUCTION'),('matching','V21_MAX_MATCHING_CARDINALITY'),('feed_combinations','V22_FEED_PAIR_AGGREGATES'),('max_feed_share','V22_FEED_PAIR_AGGREGATES'),('category_combinations','V23_CATEGORY_PAIR_AGGREGATES'),('max_category_share','V23_CATEGORY_PAIR_AGGREGATES'),('title_equivalent_pairs','V24_TITLE_EQUIVALENCE_AGGREGATES'),('both_usable_rate','V06_BOTH_ENDPOINTS_USABLE'),('logical_capacity_gate','V25_LOGICAL_COUNT_CLOSURE_GATE')]:
            require(inv, summary[field]==independent[field])
    require('V25_LOGICAL_COUNT_CLOSURE_GATE', frontier['feasible']==any(x['matching']>=5 for x in frontier['strategies'].values()))
    capacities={name:value['matching'] for name,value in frontier['strategies'].items()}
    require('V26_DOMINANCE_FRONTIER',frontier['non_dominated']==independent_non_dominated(independent_dominance_descriptors(qs),capacities))


def validate_input_pins(contract, manifest):
    """Independently map scientific roles to allowed sources and recompute their hashes."""
    import hashlib
    import run_expansion as r
    roles={
        'pair_universe':r.F/'p3-crossfeed-24h-pairs.csv',
        'p2_features':r.P2/'fresh-p3-feature-universe-v1.jsonl',
        'p2_manifest':r.P2/'feature-p2-manifest-v1.json',
        'p3_freeze_manifest':r.P3/'freeze-manifest-v1.json',
        'old_dev_identities':r.P3/'dev/audit-sidecar-v1.json',
        'blind_identities':r.P3/'blind/audit-sidecar-v1.json',
        'graph_dev_identities':r.GD/'targeted-dev-graph-sidecar-v1.jsonl',
        'graph_selection_manifest':r.GD/'targeted-dev-graph-selection-manifest-v1.json',
        'graph_context_features':r.G/'fresh-graph-context-features-v1.jsonl',
        'd2e2_capability':r.C/'miniflux-content-capability-v1.jsonl',
        'd2e2_capability_summary':r.C/'miniflux-content-capability-summary-v1.json',
        'd2f1_pool':r.POOL/'fresh-positive-candidate-pool-v1.jsonl',
        'd2f1_capacity_frontier':r.POOL/'fresh-positive-capacity-frontier-v1.json',
        'd2f1_receipt':r.POOL/'fresh-positive-pool-receipt-v1.json',
        'd2f1_manifest':r.POOL/'fresh-positive-pool-manifest-v1.json',
        'd2f2_selected_pack':r.PACK}
    require('V30_MANIFEST_INPUT_PINS', len(roles)==len(set(roles.values())) and set(roles.values())==set(r.INPUTS))
    expected={}
    for role,path in roles.items():
        require('V02_SOURCE_FILE_MODES',path.stat().st_mode & 0o777 == 0o444)
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        require('V01_SOURCE_HASHES',actual==r.INPUTS[path])
        expected[role]=actual
    require('V30_MANIFEST_INPUT_PINS',contract.get('input_sha256')==expected and manifest.get('input_sha256')==expected)


def validate_thresholds(strategies, independently_recomputed_quantiles):
    required={'pairs','articles','components','largest_component_pairs','largest_component_share','matching','feed_combinations','max_feed_share','category_combinations','max_category_share','title_equivalent_pairs','both_usable_rate','logical_capacity_gate','QWEN_THRESHOLD_USED','QWEN_THRESHOLD_POLICY'}
    require('V07A_STRATEGY_METRICS_SCHEMA_COMPLETENESS',set(strategies)=={'B0','B1','B2','B3','B4','B5'})
    for row in strategies.values():
        require('V07A_STRATEGY_METRICS_SCHEMA_COMPLETENESS',set(row)==required)
    for name, label, key in [('B1','Q70','.7'),('B2','Q60','.6'),('B3','Q80','.8'),('B4','Q80','.8')]:
        row=strategies[name]
        require('V07B_QWEN_THRESHOLD_POLICY_SEMANTIC_CORRECTNESS',type(row['QWEN_THRESHOLD_USED']) in (int,float) and row['QWEN_THRESHOLD_USED']==independently_recomputed_quantiles[key] and row['QWEN_THRESHOLD_POLICY']=={'kind':'DIRECT_RESIDUAL_QUANTILE','quantile_id':label})
    b0={'kind':'INHERITED_D2F1_LANE_SPECIFIC','source':'FROZEN_D2F1_POOL','lane_quantile_policy':{'STRONG_CONSENSUS':'D2F1_Q90','GRAPH_SUPPORTED_EVENT':'D2F1_Q75','CROSS_SOURCE_PARAPHRASE':'D2F1_Q90','POSITIVE_BOUNDARY':'D2F1_Q90'}}
    b5={'kind':'UNION_OF_STRATEGIES','constituents':['B1_GRAPH_Q70','B2_GRAPH_Q60_ANCHORED','B3_CONSENSUS_Q80','B4_PARAPHRASE_Q80']}
    for name,policy in [('B0',b0),('B5',b5)]:
        require('V07B_QWEN_THRESHOLD_POLICY_SEMANTIC_CORRECTNESS',strategies[name]['QWEN_THRESHOLD_USED'] is None and strategies[name]['QWEN_THRESHOLD_POLICY']==policy)


def independent_non_dominated(descriptors, capacities):
    require('V26_DOMINANCE_FRONTIER',set(descriptors)==set(capacities))
    dominated=set()
    for target in descriptors:
        t=descriptors[target]
        if t['kind']!='DIRECT':continue
        for challenger in descriptors:
            if target==challenger:continue
            c=descriptors[challenger]
            if c['kind']!='DIRECT' or c['lexical_family']!=t['lexical_family']:continue
            if capacities[challenger]<capacities[target] or c['qwen']<t['qwen'] or c['support']<t['support'] or c['anchor']<t['anchor']:continue
            if capacities[challenger]>capacities[target] or c['qwen']>t['qwen'] or c['support']>t['support'] or c['anchor']>t['anchor']:
                dominated.add(target);break
    return sorted(set(descriptors)-dominated)


def independent_dominance_descriptors(q):
    return {
        'B0':{'kind':'INHERITED_D2F1_LANE_SPECIFIC'},
        'B1':{'kind':'DIRECT','qwen':q['.7'],'support':2,'anchor':False,'lexical_family':'ANY'},
        'B2':{'kind':'DIRECT','qwen':q['.6'],'support':2,'anchor':True,'lexical_family':'ANY'},
        'B3':{'kind':'DIRECT','qwen':q['.8'],'support':0,'anchor':True,'lexical_family':'GE_FLOOR'},
        'B4':{'kind':'DIRECT','qwen':q['.8'],'support':1,'anchor':True,'lexical_family':'LT_FLOOR'},
        'B5':{'kind':'UNION_OF_STRATEGIES'},
    }
