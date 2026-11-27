"""Independent reconstruction of preregistered selection and exclusions."""
import math


def require(ok):
    if not ok:raise ValueError('independent pool validation failed')


def validate(features,graph,capabilities,excluded_articles,excluded_pairs,rows):
    bykey={x['pair_key']:x for x in features};require(len(bykey)==len(features))
    eligible=[]
    for x in features:
        a,b=int(x['article_a_id']),int(x['article_b_id']);key=f'{min(a,b)}:{max(a,b)}'
        require(key==x['pair_key'] and a!=b and x['feed_a_id']!=x['feed_b_id'] and 0<=x['temporal_delta_hours']<=24)
        require(a in capabilities and b in capabilities)
        if a in excluded_articles or b in excluded_articles or key in excluded_pairs:continue
        if capabilities[a]['content_status']=='USABLE' and capabilities[b]['content_status']=='USABLE':eligible.append(x)
    scores=sorted(x['qwen_score'] for x in eligible)
    def quantile(q):
        if not scores:return None
        x=(len(scores)-1)*q;return scores[math.floor(x)]+(scores[math.ceil(x)]-scores[math.floor(x)])*(x-math.floor(x))
    q75,q90=quantile(.75),quantile(.9)
    expected=[]
    for x in eligible:
        a,b=int(x['article_a_id']),int(x['article_b_id']);k=x['pair_key'];g=graph.get(k,{})
        support=g.get('shared_support_feed_count',0);lex=x['lexical_overlap'];e=x['entity_anchor_overlap'];n=x['number_overlap'];d=x['date_overlap'];score=x['qwen_score'];hours=x['temporal_delta_hours']
        conditions=[score>=q90 and lex>=.05 and (e>0 or n>0 or d>0),score>=q75 and support>=2,score>=q90 and lex<.05 and (n>0 or d>0) and support>=1,score>=q90 and lex<.05 and hours<=4 and e>0 and n==0 and d==0]
        lanes=[name for yes,name in zip(conditions,('STRONG_CONSENSUS','GRAPH_SUPPORTED_EVENT','CROSS_SOURCE_PARAPHRASE','POSITIVE_BOUNDARY')) if yes]
        if lanes:expected.append(((-score,-support,-lex,hours,min(a,b),max(a,b)),x,lanes,support))
    expected.sort(key=lambda z:z[0]);require(len(rows)==len(expected))
    allowed={'pair_key','article_id_a','article_id_b','lane_membership','lane_primary','deterministic_rank','component_id','both_content_usable','title_equivalent_article_present','effective_content_gain_possible','source_diversity_metadata','category_diversity_metadata','temporal_gap_hours','shared_support_feed_count','frozen_feature_provenance'}
    adjacency={}
    for rank,(row,(_,x,lanes,support)) in enumerate(zip(rows,expected),1):
        a,b=int(x['article_a_id']),int(x['article_b_id'])
        require(set(row)==allowed and row['pair_key']==x['pair_key'] and (row['article_id_a'],row['article_id_b'])==(min(a,b),max(a,b)))
        require(row['deterministic_rank']==rank and row['lane_membership']==lanes and row['lane_primary']==lanes[0])
        require(row['both_content_usable'] is True and row['temporal_gap_hours']==x['temporal_delta_hours'] and row['shared_support_feed_count']==support)
        require(row['title_equivalent_article_present']==(capabilities[a]['content_equals_title'] is True or capabilities[b]['content_equals_title'] is True))
        require(row['effective_content_gain_possible']==(not (capabilities[a]['content_equals_title'] is True and capabilities[b]['content_equals_title'] is True)))
        require(row['source_diversity_metadata']==sorted([x['feed_a_id'],x['feed_b_id']]) and row['category_diversity_metadata']==sorted([x['category_a'],x['category_b']]))
        require(row['frozen_feature_provenance']==['P2_FEATURES','FROZEN_GRAPH_CONTEXT'])
        adjacency.setdefault(a,set()).add(b);adjacency.setdefault(b,set()).add(a)
    groups=[];seen=set()
    for node in sorted(adjacency):
        if node in seen:continue
        stack=[node];members=set()
        while stack:
            current=stack.pop()
            if current in members:continue
            members.add(current);stack.extend(adjacency[current]-members)
        seen.update(members);groups.append(members)
    groups.sort(key=min)
    assigned={member:f'C{i+1:04d}' for i,group in enumerate(groups) for member in group}
    require(all(row['component_id']==assigned[row['article_id_a']] for row in rows))


def validate_frontier(rows,front,eligible,scoreable,effective):
    from collections import Counter
    import networkx as nx
    require(front['total_eligible_after_exclusions']==eligible and front['total_content_scoreable']==scoreable and front['total_effective_content_gain_candidates']==effective)
    require(front['union_unique_pair_count']==len(rows) and front['article_count']==len({n for r in rows for n in (r['article_id_a'],r['article_id_b'])}))
    components=Counter(r['component_id'] for r in rows)
    require(front['component_count']==len(components) and front['largest_component_pair_count']==max(components.values(),default=0))
    require({str(k):v for k,v in front['component_pair_size_distribution'].items()}=={str(k):v for k,v in Counter(components.values()).items()})
    require(front['max_component_diverse_pair_count']==len(components))
    graph=nx.Graph()
    for row in sorted(rows,key=lambda r:(r['article_id_a'],r['article_id_b'])):
        graph.add_edge(row['article_id_a'],row['article_id_b'],weight=len(rows)+1-row['deterministic_rank'])
    matching=nx.max_weight_matching(graph,maxcardinality=True,weight='weight')
    require(front['max_article_disjoint_pair_count']==len(matching))
    require(front['content_scoreable_pair_count']==len(rows))
    require(front['title_equivalent_pair_count']==sum(r['title_equivalent_article_present'] for r in rows))
    require(front['effective_content_gain_pair_count']==sum(r['effective_content_gain_possible'] for r in rows))
    require(front['lane_overlap_count']==sum(len(r['lane_membership'])>1 for r in rows))
    require(front['lane_membership_counts']==dict(Counter(lane for row in rows for lane in row['lane_membership'])))
    require(front['lane_primary_counts']==dict(Counter(row['lane_primary'] for row in rows)))
    expected_time=dict(Counter('0_TO_4H' if r['temporal_gap_hours']<=4 else 'OVER_4_TO_12H' if r['temporal_gap_hours']<=12 else 'OVER_12_TO_24H' for r in rows))
    require(front['temporal_gap_distribution']==expected_time)
    support=Counter(r['shared_support_feed_count'] for r in rows)
    require({str(k):v for k,v in front['multi_feed_support_distribution'].items()}=={str(k):v for k,v in support.items()})
    def key(a,b):return f'{min(a,b)}:{max(a,b)}'
    keys={key(a,b) for a,b in matching}; selected=sorted((r for r in rows if r['pair_key'] in keys),key=lambda r:r['deterministic_rank'])
    for n in (40,80):
        option=front['review_options'][str(n)];require(option['article_disjoint_feasible']==(len(selected)>=n))
        if len(selected)>=n:
            chosen=selected[:n]
            require(option['pair_count']==n and option['article_count']==2*n)
            require(option['component_count']==len({r['component_id'] for r in chosen}))
            require(option['feed_count']==len({x for r in chosen for x in r['source_diversity_metadata']}))
            require(option['category_count']==len({x for r in chosen for x in r['category_diversity_metadata']}))
            require(option['primary_lanes']==dict(Counter(r['lane_primary'] for r in chosen)) and option['content_scoreable_share']==1.0)
    for field,metadata in [('feed_pair_distribution','source_diversity_metadata'),('category_pair_distribution','category_diversity_metadata')]:
        counts=Counter(tuple(r[metadata]) for r in rows); result=front[field]
        require(result['unique_count']==len(counts) and result['max_share']==(max(counts.values())/len(rows) if rows else 0))
        require({str(k):v for k,v in result['frequency_histogram'].items()}=={str(k):v for k,v in Counter(counts.values()).items()})
