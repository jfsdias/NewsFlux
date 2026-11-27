"""Deterministic offline processing of a read-only, pre-cutoff Miniflux crawl.

Input is supplied on stdin; this module performs no network requests.
"""
import csv
import hashlib
import io
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path


def instant(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('timestamp lacks timezone')
    return dt.astimezone(timezone.utc)


def normalize(rows, known_feeds, old_ids, gold_ids, cutoff, max_entry_id=None):
    seen = set()
    eligible = []
    stats = dict(old=0, gold=0, unknown=0, malformed=0, after_cutoff=0, older_than_window=0, above_ceiling=0)
    boundary = instant(cutoff)
    for row in rows:
        ident = row.get('id')
        if ident in seen:
            raise ValueError('duplicate article ID')
        seen.add(ident)
        if max_entry_id is not None and isinstance(ident, int) and ident > max_entry_id:
            stats['above_ceiling'] += 1
            continue
        if ident in old_ids:
            stats['old'] += 1
            continue
        if ident in gold_ids:
            stats['gold'] += 1
            continue
        if row.get('feed_id') not in known_feeds:
            stats['unknown'] += 1
            continue
        try:
            if not isinstance(ident, int) or ident <= 0 or not row.get('title', '').strip():
                raise ValueError('invalid article')
            published = instant(row['published_at'])
            if published > boundary:
                stats['after_cutoff'] += 1
                continue
            if published < boundary - timedelta(hours=168):
                stats['older_than_window'] += 1
                continue
        except (ValueError, TypeError, KeyError):
            stats['malformed'] += 1
            continue
        eligible.append({key: row.get(key) for key in ('id', 'feed_id', 'feed_title', 'category_id', 'title', 'url', 'published_at', 'created_at', 'language')})
    eligible.sort(key=lambda x: (instant(x['published_at']), x['id']), reverse=True)
    return eligible, stats


def pairs(rows, hours):
    output = []
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if a['feed_id'] != b['feed_id'] and abs((instant(a['published_at']) - instant(b['published_at'])).total_seconds()) <= hours * 3600:
                output.append(tuple(sorted((a['id'], b['id']))))
    if len(output) != len(set(output)):
        raise ValueError('duplicate pair')
    return sorted(output)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def pair_bytes(value):
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(('entry_a_id', 'entry_b_id'))
    writer.writerows(value)
    return out.getvalue().encode()


def validate_replay(rows, replay_ids, complete):
    if complete is not True or [row['id'] for row in rows] != replay_ids:
        raise ValueError('complete snapshot replay required')


def keyset_params(cutoff, max_entry_id, before_entry_id, limit):
    if not (0 < before_entry_id <= max_entry_id + 1 and limit > 0):
        raise ValueError('invalid snapshot ceiling, cursor or page size')
    second = int(instant(cutoff).timestamp())
    return {'globally_visible': True, 'order': 'id', 'direction': 'desc',
            'before_entry_id': before_entry_id, 'published_after': second - 604801,
            'published_before': second + 1, 'limit': limit}


def systematic_sample(rows, size):
    if size < 2 or len(rows) < size:
        raise ValueError('insufficient eligible rows')
    indices = [i * (len(rows) - 1) // (size - 1) for i in range(size)]
    if len(set(indices)) != size:
        raise ValueError('duplicate sample positions')
    return [rows[i] for i in indices]


def write_frozen(destination, artifacts, validated):
    if validated is not True or not artifacts:
        raise ValueError('all freeze gates must pass')
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    hashes = {}
    for name, content in artifacts.items():
        if Path(name).name != name:
            raise ValueError('invalid artifact name')
        temp, final = destination / (name + '.tmp'), destination / name
        with temp.open('xb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, final)
        expected = hashlib.sha256(content).hexdigest()
        if hashlib.sha256(final.read_bytes()).hexdigest() != expected:
            raise ValueError('artifact verification failed')
        final.chmod(0o444)
        if hashlib.sha256(final.read_bytes()).hexdigest() != expected:
            raise ValueError('post-chmod verification failed')
        hashes[name] = expected
    return hashes


def derive(data):
    rows, stats = normalize(data['rows'], set(data['known_feeds']), set(data['old_ids']), set(data['gold_ids']), data['cutoff'], data['max_entry_id'])
    if len(rows) < 500:
        raise ValueError('capture does not meet 500 article target')
    rows = systematic_sample(rows, 500)
    count = len(rows)
    if (instant(rows[0]['published_at']) - instant(rows[-1]['published_at'])).total_seconds() < 86400:
        raise ValueError('temporal coverage under 24 hours')
    pair168, pair24 = pairs(rows, 168), pairs(rows, 24)
    if len(pair24) < 5000:
        raise ValueError('insufficient 24h pair capacity')
    if len(pair168) <= len(pair24):
        raise ValueError('pair windows do not differ')
    by_id = {x['id']: x for x in rows}
    feed_counts = Counter(x['feed_id'] for x in rows)
    category_counts = Counter(x['category_id'] for x in rows)
    def bands(values, thresholds):
        return [sum(low <= x < high for x in values) for low, high in zip([0] + thresholds, thresholds + [float('inf')])]
    ages = [(instant(rows[0]['published_at']) - instant(x['published_at'])).total_seconds() / 3600 for x in rows]
    pair_ages = [abs((instant(by_id[a]['published_at']) - instant(by_id[b]['published_at'])).total_seconds()) / 3600 for a, b in pair24]
    def universe(ps):
        ids = {i for pair in ps for i in pair}
        return {'pairs': len(ps), 'articles': len(ids), 'feeds': len({by_id[i]['feed_id'] for i in ids})}
    audit = {'stats': stats, 'article_count': count, 'unique_feeds': len(feed_counts), 'unique_categories': len(category_counts),
             'earliest': rows[-1]['published_at'], 'latest': rows[0]['published_at'], 'span_hours': ages[-1],
             'temporal_bands_hours_1_4_8_24_48': bands(ages, [1, 4, 8, 24, 48]),
             'max_feed_share': max(feed_counts.values()) / count, 'max_category_share': max(category_counts.values()) / count,
             'feed_count_histogram': dict(sorted(Counter(feed_counts.values()).items())),
             'category_count_histogram': dict(sorted(Counter(category_counts.values()).items())),
             'pair168': universe(pair168), 'pair24': universe(pair24),
             'pair24_bands_hours_1_4_8_24': bands(pair_ages, [1, 4, 8, 24]),
             'home_overlap': len(set(data['old_ids']) & set(by_id)), 'gold_overlap': len(set(data['gold_ids']) & set(by_id))}
    if audit['home_overlap'] or audit['gold_overlap']:
        raise ValueError('freshness overlap')
    return {'fresh-home-corpus-v1.jsonl': b''.join(json_bytes(x) for x in rows),
            'all-crossfeed-168h-pairs.csv': pair_bytes(pair168), 'p3-crossfeed-24h-pairs.csv': pair_bytes(pair24),
            'corpus-audit-v1.json': json_bytes(audit)}, audit


FREEZE_READY = False


def main():
    data = json.load(sys.stdin)
    validate_replay(data['rows'], data['replay_ids'], data['complete'])
    if not FREEZE_READY:
        raise RuntimeError('freeze disabled pending complete acquisition and atomic-write validation')
    first, audit = derive(data)
    second, _ = derive(data)
    if first != second:
        raise ValueError('offline derivation is not deterministic')
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    receipt = dict(data['receipt'], cutoff=data['cutoff'], raw_rows_seen=len(data['rows']), exclusions=audit['stats'], final_article_count=audit['article_count'])
    first['capture-receipt-v1.json'] = json_bytes(receipt)
    hashes = {name: hashlib.sha256(content).hexdigest() for name, content in first.items()}
    manifest = dict(data['provenance'], capture_cutoff_utc=data['cutoff'], hashes=hashes, audit=audit,
                    artifact_paths={name: str(destination / name) for name in first},
                    miniflux_writes=0, new_human_labels=0, model_inference=0)
    first['freeze-manifest-v1.json'] = json_bytes(manifest)
    hashes['freeze-manifest-v1.json'] = hashlib.sha256(first['freeze-manifest-v1.json']).hexdigest()
    for name, content in first.items():
        path = destination / name
        with path.open('xb') as output:
            output.write(content)
        if hashlib.sha256(path.read_bytes()).hexdigest() != hashes[name]:
            raise ValueError('written artifact hash mismatch')
        path.chmod(0o444)
    print(json.dumps({'audit': audit, 'hashes': hashes}, sort_keys=True))


if __name__ == '__main__':
    main()
