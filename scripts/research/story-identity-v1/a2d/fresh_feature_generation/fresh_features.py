"""Label-blind Story V2 pair materialization from frozen private inputs."""
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


def published(value):
    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('timestamp must include timezone')
    return value.timestamp()


def validate_pairs(pairs, corpus, expected):
    if len(pairs) != expected or len(set(pairs)) != expected:
        raise ValueError('pair count or uniqueness mismatch')
    for a, b in pairs:
        if a >= b or a not in corpus or b not in corpus:
            raise ValueError('invalid pair key or missing article')
        if corpus[a]['feed_id'] == corpus[b]['feed_id']:
            raise ValueError('same-feed pair')
        if abs(published(corpus[a]['published_at']) - published(corpus[b]['published_at'])) > 86400:
            raise ValueError('pair outside P3')
    return pairs


def jsonl_bytes(rows):
    return b''.join((json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode() for row in rows)


def raw_capacity(counts):
    return all(counts.get(key, 0) >= target for key, target in {
        'POSITIVE_SEEKING': 44, 'HARD_NEGATIVE_SEEKING': 44,
        'BOUNDARY_DISAGREEMENT': 24, 'DIVERSITY_CONTROL': 16}.items())


def materialize(articles, pairs, vectors):
    research = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(research))
    sys.path.insert(0, str(research / 'a2d' / 'fresh_feature_v2'))
    from harness import FeatureExtractor
    from feature_contract import cosine, validate_vectors
    from a2d.targeted_gold.sampler import compute_feature_thresholds, classify_candidate, add_frozen_model_predictions, add_feature_buckets

    corpus = {a['id']: a for a in articles}
    validate_pairs(pairs, corpus, len(pairs))
    validate_vectors(vectors, len(articles))
    embeddings = {article['id']: vector for article, vector in zip(articles, vectors)}
    rows = []
    for a_id, b_id in pairs:
        a, b = corpus[a_id], corpus[b_id]
        ts_a, ts_b = published(a['published_at']), published(b['published_at'])
        inp = {'id_a': str(a_id), 'id_b': str(b_id), 'feed_id_a': str(a['feed_id']), 'feed_id_b': str(b['feed_id']),
               'title_a': a['title'], 'title_b': b['title'], 'feed_a': a.get('feed_title') or '', 'feed_b': b.get('feed_title') or '',
               'published_at_a': str(ts_a), 'published_at_b': str(ts_b), 'qwen_score': '0'}
        features = FeatureExtractor.extract_features(inp, corpus_lookup=corpus)
        score = cosine(embeddings[a_id], embeddings[b_id])
        if not math.isfinite(score):
            raise ValueError('nonfinite cosine')
        rows.append({'pair_key': f'{a_id}:{b_id}', 'article_a_id': a_id, 'article_b_id': b_id,
                     'feed_a_id': a['feed_id'], 'feed_b_id': b['feed_id'],
                     'category_a': str(a.get('category_id', '')), 'category_b': str(b.get('category_id', '')),
                     'published_at_a': a['published_at'], 'published_at_b': b['published_at'],
                     'qwen_score': score, 'lexical_overlap': features['title_overlap_coefficient'],
                     'temporal_delta_hours': features['published_delta_hours'],
                     'entity_anchor_overlap': features['entity_anchor_overlap'],
                     'number_overlap': features['number_overlap'], 'date_overlap': features['date_overlap']})
    add_frozen_model_predictions(rows)
    thresholds = compute_feature_thresholds(rows)
    for row in rows:
        row.update(classify_candidate(row, thresholds))
    add_feature_buckets(rows, thresholds)
    return rows, thresholds


def capacity_audit(rows, thresholds):
    buckets = {}
    strata = Counter()
    adjacency = defaultdict(set)
    for row in rows:
        strata.update(tag.split('_', 1)[0] for tag in row['mining_strata'])
        a, b = row['article_a_id'], row['article_b_id']
        adjacency[a].add(b)
        adjacency[b].add(a)
    for name in ('POSITIVE_SEEKING', 'HARD_NEGATIVE_SEEKING', 'BOUNDARY_DISAGREEMENT', 'DIVERSITY_CONTROL'):
        group = [r for r in rows if r['primary_bucket'] == name]
        buckets[name] = {'pairs': len(group), 'articles': len({x for r in group for x in (r['article_a_id'], r['article_b_id'])}),
                         'feeds': len({x for r in group for x in (r['feed_a_id'], r['feed_b_id'])}),
                         'source_pairs': len({tuple(sorted((r['feed_a_id'], r['feed_b_id']))) for r in group}),
                         'temporal_bands': dict(Counter(r['temporal_bucket'] for r in group))}
    unseen = set(adjacency)
    component_sizes = []
    while unseen:
        todo = [unseen.pop()]
        members = set(todo)
        while todo:
            for nxt in adjacency[todo.pop()] & unseen:
                unseen.remove(nxt)
                members.add(nxt)
                todo.append(nxt)
        component_sizes.append(sum(len(adjacency[x] & members) for x in members) // 2)
    return {'thresholds': thresholds, 'buckets': buckets, 'strata': dict(sorted(strata.items())),
            'chain_seed_count': sum(len(v) * (len(v) - 1) // 2 for v in adjacency.values()),
            'component_count': len(component_sizes), 'max_component_pairs': max(component_sizes, default=0),
            'raw_capacity_pass': raw_capacity({k: v['pairs'] for k, v in buckets.items()})}
