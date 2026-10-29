"""Lexicographic exact-cardinality matching using a capacity-only oracle."""
import networkx as nx

if nx.__version__ != '3.4.2':
    raise RuntimeError('networkx 3.4.2 is required')


def capacity(edges):
    graph = nx.Graph()
    graph.add_edges_from((e['article_id_a'], e['article_id_b']) for e in edges)
    return len(nx.max_weight_matching(graph, maxcardinality=True))


def exact_k_matching(edges, k):
    if not isinstance(k, int) or isinstance(k, bool) or k < 0:
        raise ValueError('invalid target')
    edges = sorted(edges, key=lambda e: e['deterministic_rank'])
    identities, ranks = set(), set()
    for edge in edges:
        a, b, rank = edge['article_id_a'], edge['article_id_b'], edge['deterministic_rank']
        identity = tuple(sorted((a, b)))
        if a == b or identity in identities or rank in ranks:
            raise ValueError('invalid edge or duplicate rank')
        identities.add(identity)
        ranks.add(rank)
    if capacity(edges) < k:
        raise ValueError('infeasible target')
    selected, occupied, trace = [], set(), []
    for index, edge in enumerate(edges):
        if len(selected) == k:
            break
        a, b = edge['article_id_a'], edge['article_id_b']
        if a in occupied or b in occupied:
            trace.append({'rank':edge['deterministic_rank'],'decision':'occupied'})
            continue
        remaining = k - len(selected) - 1
        blocked = occupied | {a, b}
        future = [e for e in edges[index + 1:] if e['article_id_a'] not in blocked and e['article_id_b'] not in blocked]
        available = capacity(future)
        accept = available >= remaining
        trace.append({'rank':edge['deterministic_rank'],'decision':'selected' if accept else 'rejected','needed':remaining,'capacity':available})
        if accept:
            selected.append(edge)
            occupied.update((a, b))
    if len(selected) != k:
        raise RuntimeError('inconsistent feasibility oracle')
    return selected, trace
