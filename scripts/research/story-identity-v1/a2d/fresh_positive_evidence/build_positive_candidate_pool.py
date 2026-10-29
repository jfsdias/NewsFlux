"""Preregistered label-blind positive-likelihood pool; no article-text access."""
from collections import Counter
import math
import networkx as nx

if nx.__version__ != '3.4.2':
    raise RuntimeError('networkx 3.4.2 is required')

LANES=('STRONG_CONSENSUS','GRAPH_SUPPORTED_EVENT','CROSS_SOURCE_PARAPHRASE','POSITIVE_BOUNDARY')


def key(a,b):
    a,b=int(a),int(b)
    if a==b or min(a,b)<=0:raise ValueError('invalid pair identity')
    return f'{min(a,b)}:{max(a,b)}'


def quantile(values,q):
    values=sorted(values)
    if not values:return None
    index=(len(values)-1)*q;lo=math.floor(index);hi=math.ceil(index)
    return values[lo]+(values[hi]-values[lo])*(index-lo)


def components(rows):
    parent={}
    def find(x):
        parent.setdefault(x,x)
        while parent[x]!=x:
            parent[x]=parent[parent[x]];x=parent[x]
        return x
    for row in rows:
        a,b=row['article_id_a'],row['article_id_b'];ra,rb=find(a),find(b)
        if ra!=rb:parent[max(ra,rb)]=min(ra,rb)
    roots=sorted({find(x) for x in parent}); names={x:f'C{i+1:04d}' for i,x in enumerate(roots)}
    for row in rows:row['component_id']=names[find(row['article_id_a'])]


def build(features,graph,capabilities,excluded_articles,excluded_pairs):
    eligible=[];seen=set()
    for x in features:
        if any(k in x for k in ('human_decision','label','normalized_content','content','title','url')):raise ValueError('forbidden field in feature input')
        a,b=int(x['article_a_id']),int(x['article_b_id']);k=key(a,b)
        if x['pair_key']!=k or k in seen:raise ValueError('invalid feature identity')
        seen.add(k)
        if a in excluded_articles or b in excluded_articles or k in excluded_pairs:continue
        if x['feed_a_id']==x['feed_b_id'] or not 0<=x['temporal_delta_hours']<=24:raise ValueError('invalid scope')
        if a not in capabilities or b not in capabilities:raise ValueError('missing content metadata')
        if capabilities[a]['content_status']!='USABLE' or capabilities[b]['content_status']!='USABLE':continue
        for field in ('qwen_score','lexical_overlap','entity_anchor_overlap','number_overlap','date_overlap','temporal_delta_hours'):
            if isinstance(x[field],bool) or not isinstance(x[field],(int,float)) or not math.isfinite(x[field]):raise ValueError('invalid numeric feature')
        eligible.append(x)
    q75=quantile([x['qwen_score'] for x in eligible],.75);q90=quantile([x['qwen_score'] for x in eligible],.90)
    rows=[]
    for x in eligible:
        a,b=int(x['article_a_id']),int(x['article_b_id']);k=key(a,b);g=graph.get(k,{})
        support=g.get('shared_support_feed_count',0); lexical=x['lexical_overlap'];anchor=x['entity_anchor_overlap']>0 or x['number_overlap']>0 or x['date_overlap']>0
        lanes=[]
        if x['qwen_score']>=q90 and lexical>=.05 and anchor:lanes.append(LANES[0])
        if x['qwen_score']>=q75 and support>=2:lanes.append(LANES[1])
        if x['qwen_score']>=q90 and lexical<.05 and (x['number_overlap']>0 or x['date_overlap']>0) and support>=1:lanes.append(LANES[2])
        if x['qwen_score']>=q90 and lexical<.05 and x['temporal_delta_hours']<=4 and x['entity_anchor_overlap']>0 and x['number_overlap']==0 and x['date_overlap']==0:lanes.append(LANES[3])
        if not lanes:continue
        equivalent=capabilities[a]['content_equals_title'] is True or capabilities[b]['content_equals_title'] is True
        effective=not (capabilities[a]['content_equals_title'] is True and capabilities[b]['content_equals_title'] is True)
        row={'pair_key':k,'article_id_a':min(a,b),'article_id_b':max(a,b),'lane_membership':lanes,'lane_primary':lanes[0],
             'deterministic_rank':None,'component_id':None,'both_content_usable':True,'title_equivalent_article_present':equivalent,
             'effective_content_gain_possible':effective,'source_diversity_metadata':sorted([x['feed_a_id'],x['feed_b_id']]),
             'category_diversity_metadata':sorted([x['category_a'],x['category_b']]),'temporal_gap_hours':x['temporal_delta_hours'],'shared_support_feed_count':support,'frozen_feature_provenance':['P2_FEATURES','FROZEN_GRAPH_CONTEXT']}
        rank=(-x['qwen_score'],-support,-lexical,x['temporal_delta_hours'],min(a,b),max(a,b))
        rows.append((rank,row))
    rows.sort(key=lambda item:item[0]);rows=[r for _,r in rows]
    for i,row in enumerate(rows,1):row['deterministic_rank']=i
    components(rows)
    return rows


def maximum_matching(rows):
    graph=nx.Graph()
    for row in sorted(rows,key=lambda x:(x['article_id_a'],x['article_id_b'])):
        graph.add_edge(row['article_id_a'],row['article_id_b'],weight=len(rows)+1-row['deterministic_rank'])
    matches=nx.max_weight_matching(graph,maxcardinality=True,weight='weight')
    keys={key(a,b) for a,b in matches}
    return sorted((r for r in rows if r['pair_key'] in keys),key=lambda r:r['deterministic_rank'])


def frontier(rows,eligible_total,scoreable_total,effective_total):
    matched=maximum_matching(rows); comp=Counter(r['component_id'] for r in rows)
    lanes=Counter(lane for r in rows for lane in r['lane_membership']);primary=Counter(r['lane_primary'] for r in rows)
    feed_pairs=Counter(tuple(r['source_diversity_metadata']) for r in rows);category_pairs=Counter(tuple(r['category_diversity_metadata']) for r in rows)
    options={}
    for n in (40,80):
        selected=matched[:n]
        if len(selected)<n:options[str(n)]={'article_disjoint_feasible':False};continue
        options[str(n)]={'article_disjoint_feasible':True,'pair_count':n,'article_count':2*n,'component_count':len({r['component_id'] for r in selected}),
                         'feed_count':len({f for r in selected for f in r['source_diversity_metadata']}),
                         'category_count':len({c for r in selected for c in r['category_diversity_metadata']}),
                         'primary_lanes':dict(Counter(r['lane_primary'] for r in selected)),'content_scoreable_share':1.0}
    def concentration(counter):
        return {'unique_count':len(counter),'max_share':max(counter.values())/len(rows) if rows else 0,
                'frequency_histogram':dict(sorted(Counter(counter.values()).items()))}
    return {'total_eligible_after_exclusions':eligible_total,'total_content_scoreable':scoreable_total,
            'total_effective_content_gain_candidates':effective_total,'lane_membership_counts':dict(lanes),'lane_primary_counts':dict(primary),
            'union_unique_pair_count':len(rows),'article_count':len({i for r in rows for i in (r['article_id_a'],r['article_id_b'])}),
            'component_count':len(comp),'largest_component_pair_count':max(comp.values(),default=0),'component_pair_size_distribution':dict(sorted(Counter(comp.values()).items())),
            'max_article_disjoint_pair_count':len(matched),'max_component_diverse_pair_count':len(comp),'review_options':options,
            'content_scoreable_pair_count':len(rows),'title_equivalent_pair_count':sum(r['title_equivalent_article_present'] for r in rows),
            'effective_content_gain_pair_count':sum(r['effective_content_gain_possible'] for r in rows),
            'feed_pair_distribution':concentration(feed_pairs),'category_pair_distribution':concentration(category_pairs),
            'lane_overlap_count':sum(len(r['lane_membership'])>1 for r in rows),
            'temporal_gap_distribution':dict(Counter('0_TO_4H' if r['temporal_gap_hours']<=4 else 'OVER_4_TO_12H' if r['temporal_gap_hours']<=12 else 'OVER_12_TO_24H' for r in rows)),
            'multi_feed_support_distribution':dict(sorted(Counter(r['shared_support_feed_count'] for r in rows).items()))}
