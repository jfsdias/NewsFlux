"""Recover historical rank semantics and derive a prospective, label-free rank."""
import collections
import math


def historical(rows):
    if not rows:
        raise ValueError('empty historical universe')
    directions = {}
    for model in ('qwen', 'mistral'):
        score, rank_name = model + '_score', model + '_rank'
        ranks = [int(r[rank_name]) for r in rows]
        if sorted(ranks) != list(range(1, len(rows) + 1)):
            raise ValueError('historical rank range or base invalid')
        scores = [float(r[score]) for r in rows]
        if not all(math.isfinite(s) for s in scores):
            raise ValueError('invalid score')
        ties = len(set(scores)) != len(scores)
        valid = []
        for reverse in (False, True):
            ordered = sorted(rows, key=lambda r: r['pair_key'], reverse=reverse)
            ordered.sort(key=lambda r: float(r[score]), reverse=True)
            if all(int(r[rank_name]) == i for i, r in enumerate(ordered, 1)):
                valid.append('desc' if reverse else 'asc')
        if not valid:
            raise ValueError('historical ordering cannot be reconstructed')
        directions[model + '_tie_direction'] = valid[0] if ties else 'unobservable_no_score_ties'
    if any(int(r['best_rank']) != min(int(r['qwen_rank']), int(r['mistral_rank'])) or
           int(r['rank_sum']) != int(r['qwen_rank']) + int(r['mistral_rank']) for r in rows):
        raise ValueError('historical rank formula mismatch')
    q = {r['pair_key'] for r in rows if int(r['qwen_rank']) <= 1250}
    m = {r['pair_key'] for r in rows if int(r['mistral_rank']) <= 1250}
    frontier = sum(int(r['best_rank']) <= 1250 for r in rows)
    if len(q | m) != frontier:
        raise ValueError('frontier union mismatch')
    return dict(directions, frontier=frontier, total=len(rows), qwen_top=len(q), mistral_top=len(m), intersection=len(q & m))


def rank(pairs):
    if len({k for k, _ in pairs}) != len(pairs) or any(not math.isfinite(v) for _, v in pairs):
        raise ValueError('invalid pair scores')
    return [dict(pair_key=k, qwen_score=v, search_rank_v2=i) for i, (k, v) in
            enumerate(sorted(pairs, key=lambda x: (-x[1], x[0])), 1)]


def ceiling(numerator, denominator, total):
    if not 0 <= numerator <= denominator or denominator <= 0 or total < 0:
        raise ValueError('invalid frontier')
    return (numerator * total + denominator - 1) // denominator


def join(rows, ranks):
    by_key = {r['pair_key']: r for r in ranks}
    if len(by_key) != len(ranks) or len({r['pair_key'] for r in rows}) != len(rows):
        raise ValueError('duplicate keys')
    out = []
    for row in rows:
        r = by_key.get(row['pair_key'])
        if r is None or ('qwen_score' in row and row['qwen_score'] != r['qwen_score']):
            raise ValueError('missing key or inconsistent score')
        out.append(dict(row, search_rank_v2=r['search_rank_v2']))
    return out


def diagnostics(rows, limit):
    selected = [r for r in rows if r['search_rank_v2'] <= limit]
    neighbors = collections.defaultdict(set)
    for r in selected:
        a, b = r['article_a_id'], r['article_b_id']
        neighbors[a].add(b); neighbors[b].add(a)
    return dict(pairs=len(selected), articles=len(neighbors),
                feeds=len({x for r in selected for x in (r['feed_a_id'], r['feed_b_id'])}),
                source_pairs=len({tuple(sorted((r['feed_a_id'], r['feed_b_id']))) for r in selected}),
                chain_seeds=sum(len(v)*(len(v)-1)//2 for v in neighbors.values()),
                buckets=dict(collections.Counter(r['primary_bucket'] for r in selected)))
