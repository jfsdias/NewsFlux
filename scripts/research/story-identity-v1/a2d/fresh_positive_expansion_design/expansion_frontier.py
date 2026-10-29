"""Pure label-free predicates and capacity helpers for the preregistered frontier."""
import builtins
import contextlib
import io
import math
import os
from pathlib import Path
import socket
from collections import Counter
from unittest.mock import patch
import networkx as nx

if nx.__version__ != '3.4.2': raise RuntimeError('NetworkX 3.4.2 required')


def quantile(values, q):
    values=sorted(values)
    if not values: raise ValueError('empty quantile universe')
    n=(len(values)-1)*q; lo=math.floor(n); hi=math.ceil(n)
    return values[lo]+(values[hi]-values[lo])*(n-lo)


def memberships(x, q):
    anchor=any(x[k]>0 for k in ('entity','number','date'))
    out=set()
    if x['qwen']>=q['.7'] and x['support']>=2: out.add('B1')
    if x['qwen']>=q['.6'] and x['support']>=2 and anchor: out.add('B2')
    if x['qwen']>=q['.8'] and x['lexical']>=.05 and anchor: out.add('B3')
    if x['qwen']>=q['.8'] and x['lexical']<.05 and x['support']>=1 and anchor: out.add('B4')
    if out: out.add('B5')
    return out


def rank(x): return (-x['qwen'],-x['support'],-x['lexical'],x['gap'],x['a'],x['b'])
def eligible_ids(a,b,excluded,universe): return a not in excluded and b not in excluded and f'{a}:{b}' in universe

def comparable(a,b):
    return a != b and {a,b} <= {'B1','B2'}

def closure(capacity): return capacity >= 5


def metrics(rows):
    g=nx.Graph(); g.add_edges_from((x['a'],x['b']) for x in rows)
    comps=list(nx.connected_components(g)); mapping={a:i for i,c in enumerate(comps) for a in c}
    sizes=Counter(mapping[x['a']] for x in rows)
    feeds=Counter(tuple(x['feed']) for x in rows); categories=Counter(tuple(x['category']) for x in rows)
    n=len(rows)
    return {'pairs':n, 'articles':g.number_of_nodes(), 'components':len(comps), 'largest_component_pairs':max(sizes.values(),default=0), 'largest_component_share':max(sizes.values(),default=0)/n if n else 0, 'matching':len(nx.max_weight_matching(g,maxcardinality=True)), 'feed_combinations':len(feeds), 'max_feed_share':max(feeds.values(),default=0)/n if n else 0, 'category_combinations':len(categories), 'max_category_share':max(categories.values(),default=0)/n if n else 0, 'title_equivalent_pairs':sum(x['equiv'] for x in rows), 'both_usable_rate':1.0 if n else None, 'logical_capacity_gate':closure(len(nx.max_weight_matching(g,maxcardinality=True)))}


@contextlib.contextmanager
def firewall(allowed):
    permitted={str(Path(p).resolve()) for p in allowed}
    def wrap(fn):
        def check(path,*args,**kwargs):
            if not isinstance(path,int):
                resolved = str(Path(path).resolve())
                forbidden = ('p4-fresh-positive-gate-analysis', 'human-label', 'human-completed', 'normalized-content', 'content-enrichment-v1', 'source-payloads')
                if any(x in resolved.lower() for x in forbidden) or resolved not in permitted: raise PermissionError('source not allowlisted')
            return fn(path,*args,**kwargs)
        return check
    def deny(*args,**kwargs):raise PermissionError('network disabled')
    with patch.object(builtins,'open',wrap(builtins.open)), patch.object(io,'open',wrap(io.open)), patch.object(os,'open',wrap(os.open)), patch.object(socket,'create_connection',deny), patch.object(socket.socket,'connect',deny), patch.object(socket.socket,'connect_ex',deny), patch.object(socket,'getaddrinfo',deny):
        yield


def safe_metrics(row):
    allowed={'pairs','articles','components','largest_component_pairs','largest_component_share','matching','feed_combinations','max_feed_share','category_combinations','max_category_share','title_equivalent_pairs','both_usable_rate','logical_capacity_gate'}
    if set(row) != allowed: raise ValueError('non-aggregate output')
    if any(not isinstance(v,(int,float,bool,type(None))) for v in row.values()): raise ValueError('invalid aggregate value')
    return dict(row)


def threshold_metadata(strategy, quantiles):
    direct={'B1':('Q70','.7'),'B2':('Q60','.6'),'B3':('Q80','.8'),'B4':('Q80','.8')}
    if strategy in direct:
        label,key=direct[strategy]
        return {'QWEN_THRESHOLD_USED':quantiles[key], 'QWEN_THRESHOLD_POLICY':{'kind':'DIRECT_RESIDUAL_QUANTILE','quantile_id':label}}
    if strategy=='B0':
        policy={'kind':'INHERITED_D2F1_LANE_SPECIFIC','source':'FROZEN_D2F1_POOL','lane_quantile_policy':{'STRONG_CONSENSUS':'D2F1_Q90','GRAPH_SUPPORTED_EVENT':'D2F1_Q75','CROSS_SOURCE_PARAPHRASE':'D2F1_Q90','POSITIVE_BOUNDARY':'D2F1_Q90'}}
    elif strategy=='B5':
        policy={'kind':'UNION_OF_STRATEGIES','constituents':['B1_GRAPH_Q70','B2_GRAPH_Q60_ANCHORED','B3_CONSENSUS_Q80','B4_PARAPHRASE_Q80']}
    else:raise ValueError('unknown strategy')
    return {'QWEN_THRESHOLD_USED':None,'QWEN_THRESHOLD_POLICY':policy}
