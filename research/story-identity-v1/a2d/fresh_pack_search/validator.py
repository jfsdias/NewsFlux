"""Independent validation of selected edges, not solver-internal state."""
from collections import Counter, defaultdict

DEV = {'POSITIVE_SEEKING':28,'HARD_NEGATIVE_SEEKING':28,'BOUNDARY_DISAGREEMENT':16,'DIVERSITY_CONTROL':8}
BLIND = {'POSITIVE_SEEKING':16,'HARD_NEGATIVE_SEEKING':16,'BOUNDARY_DISAGREEMENT':8,'DIVERSITY_CONTROL':8}
CEILING = 15036


def vertices(row): return {int(row['article_a_id']), int(row['article_b_id'])}


def validate(dev, blind, groups, *, universe=None, historical_articles=frozenset(), historical_pairs=frozenset()):
    def check(rows, quota):
        if Counter(r['primary_bucket'] for r in rows) != Counter(quota): raise ValueError('quota')
        keys=set(); articles=set(); feeds=Counter(); sources=Counter(); categories={}
        for r in rows:
            a,b=int(r['article_a_id']),int(r['article_b_id']); k=f'{a}:{b}'
            if a>=b or r['pair_key']!=k or k in keys: raise ValueError('identity')
            if r['feed_a_id']==r['feed_b_id']: raise ValueError('same feed')
            if 'temporal_delta_hours' in r and not 0<=float(r['temporal_delta_hours'])<=24: raise ValueError('temporal')
            if universe is not None and (k not in universe or r!=universe[k]): raise ValueError('provenance')
            keys.add(k); articles.update((a,b)); feeds.update((str(r['feed_a_id']),str(r['feed_b_id'])))
            sources[tuple(sorted((str(r['feed_a_id']),str(r['feed_b_id']))))]+=1
            for side in ('a','b'):
                x=int(r[f'article_{side}_id']); cat=str(r[f'category_{side}'])
                if x in categories and categories[x]!=cat: raise ValueError('inconsistent category')
                categories[x]=cat
        if keys & historical_pairs or articles & historical_articles: raise ValueError('historical overlap')
        f=max(feeds.values())/(2*len(rows)); s=max(sources.values())/len(rows)
        c=max(Counter(categories.values()).values())/len(categories)
        if f>0.2 or s>0.1 or c>0.5: raise ValueError('diversity')
        return keys,articles,dict(feed_share=f,source_pair_share=s,category_share=c,articles=len(articles))
    dk,da,dd=check(dev,DEV);bk,ba,bd=check(blind,BLIND)
    if dk & bk or da & ba: raise ValueError('cross pack overlap')
    bykey={r['pair_key']:r for r in blind}; adj=defaultdict(set)
    for r in blind:
        a,b=vertices(r);adj[a].add(b);adj[b].add(a)
    components=[]; unseen=set(adj)
    while unseen:
        todo=[unseen.pop()]; comp=set(todo)
        while todo:
            for x in adj[todo.pop()] & unseen:
                unseen.remove(x);comp.add(x);todo.append(x)
        edges={k for k,r in bykey.items() if vertices(r)<=comp};components.append((comp,edges))
    singles=sum(len(e)==1 for _,e in components);multi=sum(len(e)>1 for _,e in components)
    if len(components)<8 or singles<8 or multi<6 or any(len(a)>8 or len(e)>8 for a,e in components): raise ValueError('components')
    if len(groups)!=6: raise ValueError('chain count')
    used=set(); group_vertices=[]; chain_ranks=[]
    for group in groups:
        if len(group)!=2 or len(set(group))!=2 or not set(group)<=bk or set(group)&used: raise ValueError('chain edges')
        first,second=(bykey[k] for k in group); va,vb=vertices(first),vertices(second); vs=va|vb
        if len(vs)!=3 or not va&vb or any(vs&prior for prior in group_vertices): raise ValueError('chain shape')
        if any(int(r['search_rank_v2'])>CEILING or int(r['search_rank_v2'])<1 for r in (first,second)): raise ValueError('chain rank')
        used.update(group);group_vertices.append(vs);chain_ranks.extend(int(r['search_rank_v2']) for r in (first,second))
    bridge=sum(1 for r in blind if any(vertices(r)&x and vertices(r)&y for i,x in enumerate(group_vertices) for y in group_vertices[i+1:]))
    if bridge: raise ValueError('chain bridge')
    return dict(dev=dd,blind=bd,chains=len(groups),bridge=bridge,components=len(components),independent=singles,
                multi=multi,max_pairs=max(len(e) for _,e in components),max_articles=max(len(a) for a,_ in components),
                max_chain_rank=max(chain_ranks))
