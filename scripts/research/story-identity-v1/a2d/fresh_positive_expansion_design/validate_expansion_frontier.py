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
