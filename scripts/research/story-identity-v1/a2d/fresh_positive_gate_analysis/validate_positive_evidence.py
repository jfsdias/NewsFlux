"""Independent offline aggregate recomputation from hash-verified sources."""
import json
from collections import Counter, defaultdict
from analyze_positive_evidence import load_inputs


def validate(paths, result, detail):
    labels, pairs = load_inputs(*paths)
    by_key = {p['pair_key']: p for p in pairs}
    assert len(labels) == len(by_key) == 40
    assert len({r['pair_key'] for r in labels}) == 40
    assert {r['pair_key'] for r in labels} == set(by_key)
    counts = Counter(r['human_decision'] for r in labels)
    assert counts == {'SAME_EVENT': 7, 'RELATED_TOPIC': 1, 'DIFFERENT_EVENT': 32}
    comp, primary, membership = defaultdict(Counter), defaultdict(Counter), defaultdict(Counter)
    related = []
    for r in labels:
        p = by_key[r['pair_key']]
        label = r['human_decision']
        comp[p['component_id']][label] += 1
        primary[p['lane_primary']][label] += 1
        for lane in set(p['lane_membership']): membership[lane][label] += 1
        if label == 'RELATED_TOPIC': related.append({k: p[k] for k in ('component_id', 'lane_primary', 'lane_membership', 'title_equivalent_article_present')})
    assert sorted(sum(v.values()) for v in comp.values()) == [1, 1, 17, 21]
    assert len({p[k] for p in pairs for k in ('article_id_a', 'article_id_b')}) == 80
    positive = [v['SAME_EVENT'] for v in comp.values() if v['SAME_EVENT']]
    largest = max(positive, default=0)
    flags = [counts['SAME_EVENT'] >= 12, len(positive) >= 3, largest / counts['SAME_EVENT'] <= .5]
    assert result['global_counts'] == {k: counts[k] for k in ('DIFFERENT_EVENT', 'RELATED_TOPIC', 'SAME_EVENT', 'UNCERTAIN')}
    assert result['discovery_pass'] == (counts['SAME_EVENT'] >= 1)
    assert result['positive_component_count'] == len(positive)
    assert result['largest_positive_component_count'] == largest
    assert result['largest_positive_component_share'] == largest / counts['SAME_EVENT']
    assert result['same_event_component_coverage'] == len(positive) / 4
    assert result['legacy_calibration_conditions'] == flags and result['legacy_calibration_pass'] == all(flags)
    assert json.dumps(detail, sort_keys=True) == json.dumps({'components': dict(comp), 'primary_lanes': dict(primary), 'membership_lanes_nonexclusive': dict(membership), 'related_topic_strata': related}, sort_keys=True)
