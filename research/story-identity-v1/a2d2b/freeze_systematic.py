"""Verify two private projected passes, then freeze a systematic research sample."""
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import capture

OLD_SHA = '0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0'
GOLD_SHA = '3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def policy_metrics(rows):
    ages = [(capture.instant(rows[0]['published_at']) - capture.instant(x['published_at'])).total_seconds() / 3600 for x in rows]
    feeds, categories = Counter(x['feed_id'] for x in rows), Counter(x['category_id'] for x in rows)
    p24, p168 = capture.pairs(rows, 24), capture.pairs(rows, 168)
    return {'article_count': len(rows), 'span_hours': ages[-1], 'unique_feeds': len(feeds),
            'unique_categories': len(categories), 'max_feed_share': max(feeds.values()) / len(rows),
            'max_category_share': max(categories.values()) / len(rows), 'pair24': len(p24), 'pair168': len(p168),
            'pairs_over24': len(p168) - len(p24), 'pair24_share': len(p24) / len(p168),
            'age_bands_0_1_4_8_24_48_168': [sum(lo <= v < hi for v in ages) for lo, hi in zip([0, 1, 4, 8, 24, 48], [1, 4, 8, 24, 48, 169])]}


def prepare(pass1_path, pass2_path, old_path, gold_path):
    if sha(old_path) != OLD_SHA or sha(gold_path) != GOLD_SHA:
        raise ValueError('historical source hash mismatch')
    one, two = json.loads(Path(pass1_path).read_bytes()), json.loads(Path(pass2_path).read_bytes())
    if any(one[k] != two[k] for k in ('cutoff', 'max_entry_id', 'known_feeds')):
        raise ValueError('snapshot metadata mismatch')
    p1, p2 = one['pass1'], two['pass2']
    rows1, rows2 = p1['rows'], p2['rows']
    for p, rows in ((p1, rows1), (p2, rows2)):
        ids = [r['id'] for r in rows]
        if p.get('terminal_empty') is not True or len(ids) != len(set(ids)) or any(a <= b for a, b in zip(ids, ids[1:])) or any(i > one['max_entry_id'] for i in ids):
            raise ValueError('invalid or incomplete keyset traversal')
    capture.validate_replay(rows1, [r['id'] for r in rows2], True)
    old = {json.loads(line)['id'] for line in Path(old_path).read_text().splitlines() if line.strip()}
    with open(gold_path, newline='') as f:
        gold = {int(row[key]) for row in csv.DictReader(f) for key in ('entry_a_id', 'entry_b_id')}
    args = (set(one['known_feeds']), old, gold, one['cutoff'], one['max_entry_id'])
    eligible1, stats1 = capture.normalize(rows1, *args)
    eligible2, stats2 = capture.normalize(rows2, *args)
    if [r['id'] for r in eligible1] != [r['id'] for r in eligible2] or stats1 != stats2:
        raise ValueError('eligible replay mismatch')
    chosen1, chosen2 = capture.systematic_sample(eligible1, 500), capture.systematic_sample(eligible2, 500)
    if chosen1 != chosen2:
        raise ValueError('selected article replay mismatch')
    first_args = {'rows': rows1, 'known_feeds': one['known_feeds'], 'old_ids': list(old), 'gold_ids': list(gold),
                  'cutoff': one['cutoff'], 'max_entry_id': one['max_entry_id']}
    second_args = dict(first_args, rows=rows2)
    outputs, audit = capture.derive(first_args)
    repeat, _ = capture.derive(first_args)
    replay, _ = capture.derive(second_args)
    if outputs != repeat or outputs != replay:
        raise ValueError('offline byte identity failed')
    comparison = {'newest_500': policy_metrics(eligible1[:500]), 'systematic_500': policy_metrics(chosen1)}
    audit.update(sampling_policy='SYSTEMATIC_RANK_OVER_FULL_168H_ELIGIBLE_POPULATION',
                 eligible_population_count=len(eligible1), sample_size=500,
                 sampling_formula='floor(i*(N-1)/(K-1))', sampling_randomness='none',
                 canonical_order='published_at_desc_article_id_desc', policy_comparison=comparison)
    outputs['corpus-audit-v1.json'] = capture.json_bytes(audit)
    if outputs['corpus-audit-v1.json'] != capture.json_bytes(dict(audit)):
        raise ValueError('audit byte identity failed')
    return one, p1, p2, outputs, audit, {'raw_pass1_sha256': sha(pass1_path), 'raw_pass2_sha256': sha(pass2_path)}


def main():
    if len(sys.argv) != 6:
        raise SystemExit('Usage: freeze_systematic.py PASS1 PASS2 HOME200 GOLD DESTINATION')
    one, p1, p2, outputs, audit, raw_hashes = prepare(*sys.argv[1:5])
    receipt = {'capture_cutoff_utc': one['cutoff'], 'snapshot_max_entry_id': one['max_entry_id'],
               'source_query_semantics': 'STATUS_NEUTRAL_GLOBAL_VISIBLE_ID_KEYSET', 'freshness_window_hours': 168,
               'pass1_pages': p1['pages'], 'pass2_pages': p2['pages'], 'raw_count': len(p1['rows']),
               'race_guard': 'PASS_BOUNDED_ID_KEYSET_REPLAY', 'raw_hashes': raw_hashes, 'miniflux_writes': 0}
    outputs['capture-receipt-v1.json'] = capture.json_bytes(receipt)
    manifest = {'design_version': 'STORY_02_A2D2B_R3B', 'main_sha': 'b960c194dea7a4c8b77a54a800e5a57f8a8701c7',
                'upstream_sha': 'f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b', 'capture': receipt,
                'old_home200_sha': OLD_SHA, 'gold_v2_sha': GOLD_SHA, 'audit': audit,
                'hashes': {name: hashlib.sha256(content).hexdigest() for name, content in outputs.items()},
                'new_human_labels': 0, 'model_inference': 0, 'miniflux_writes': 0}
    outputs['freeze-manifest-v1.json'] = capture.json_bytes(manifest)
    hashes = capture.write_frozen(Path(sys.argv[5]), outputs, True)
    print(json.dumps({'hashes': hashes, 'audit': audit, 'raw_hashes': raw_hashes}, sort_keys=True))


if __name__ == '__main__':
    main()
