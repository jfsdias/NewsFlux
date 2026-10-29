"""Offline, frozen-input positive evidence analysis. No content or network access."""
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

LABEL_HASH = '68857fac89d4f9ae98f53f0d2ab7f343d09037307036c8c55fc6c01964ae72fb'
PACK_HASH = 'a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90'
AUDIT_HASH = 'f6997bf02bb0bcdd74283d189697c643df178d67f23ea5907fe48710a6731548'
MANIFEST_HASH = 'f0d1cfff3b8338de2551c9c5947cd84318b6af0bfba61c033e2bc19e3527e082'
CONTRACT_HASH = 'b498c26be5b667d91c1f9df338dea81a91dfed0edb334affeefd8434fcd43999'
LABELS = {'SAME_EVENT', 'RELATED_TOPIC', 'DIFFERENT_EVENT', 'UNCERTAIN'}


def verified(path, digest):
    path = Path(path)
    if path.stat().st_mode & 0o777 != 0o444:
        raise ValueError('input is not frozen')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('input hash mismatch')
    return data


def analyze(labels, pairs, strict=True):
    decisions = {}
    for row in labels:
        if set(row) != {'review_annotation_id', 'pair_key', 'human_decision'} or row['human_decision'] not in LABELS or row['pair_key'] in decisions:
            raise ValueError('invalid label row')
        decisions[row['pair_key']] = row['human_decision']
    mapping = {p['pair_key']: p for p in pairs}
    if len(mapping) != len(pairs) or set(mapping) != set(decisions):
        raise ValueError('pair set mismatch')
    totals = Counter(decisions.values())
    components = Counter(p['component_id'] for p in pairs)
    articles = {p[k] for p in pairs for k in ('article_id_a', 'article_id_b')}
    if strict and (len(labels) != 40 or len(articles) != 80 or sorted(components.values()) != [1, 1, 17, 21] or any(totals[x] != n for x, n in [('SAME_EVENT', 7), ('RELATED_TOPIC', 1), ('DIFFERENT_EVENT', 32), ('UNCERTAIN', 0)])):
        raise ValueError('canonical integrity mismatch')
    comp, primary, member = defaultdict(Counter), defaultdict(Counter), defaultdict(Counter)
    related = []
    for key, label in decisions.items():
        p = mapping[key]
        comp[p['component_id']][label] += 1
        primary[p['lane_primary']][label] += 1
        for lane in set(p['lane_membership']):
            member[lane][label] += 1
        if label == 'RELATED_TOPIC':
            related.append({k: p[k] for k in ('component_id', 'lane_primary', 'lane_membership', 'title_equivalent_article_present')})
    positive = [c['SAME_EVENT'] for c in comp.values() if c['SAME_EVENT']]
    count = totals['SAME_EVENT']
    largest = max(positive, default=0)
    share = largest / count if count else 0
    flags = [count >= 12, len(positive) >= 3, bool(count) and share <= .5]
    result = {'global_counts': {k: totals[k] for k in sorted(LABELS)}, 'discovery_pass': count >= 1, 'fresh_same_event_prevalence': 'UNKNOWN', 'positive_component_count': len(positive), 'largest_positive_component_count': largest, 'largest_positive_component_share': share, 'same_event_component_coverage': len(positive) / len(components) if components else 0, 'legacy_calibration_conditions': flags, 'legacy_calibration_pass': all(flags), 'calibration_governance_status': 'LEGACY_HEURISTIC_NOT_AUTOMATIC_BENCHMARK_AUTHORIZATION'}
    detail = {'components': dict(comp), 'primary_lanes': dict(primary), 'membership_lanes_nonexclusive': dict(member), 'related_topic_strata': related}
    return result, detail


def load_inputs(label, pack, audit, manifest, contract):
    # Verify all inputs before parsing any of them.
    blobs = [verified(p, h) for p, h in zip((label, pack, audit, manifest, contract), (LABEL_HASH, PACK_HASH, AUDIT_HASH, MANIFEST_HASH, CONTRACT_HASH))]
    return [[json.loads(line) for line in b.splitlines()] for b in blobs[:2]]
