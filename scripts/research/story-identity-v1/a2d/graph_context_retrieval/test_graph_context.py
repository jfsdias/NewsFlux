import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path

import graph_context as g
import audit_graph_retrieval as a


def row(pair_key, a, b, fa, fb, q=.5, hours=2, lex=0, ent=0, num=0, date=0,
        ca='A', cb='B', ta=None, tb=None):
    if ta is None: ta=f'2026-10-28T{a%20:02d}:00:00+00:00'
    if tb is None: tb=f'2026-10-28T{b%20:02d}:00:00+00:00'
    return {
        'pair_key': pair_key,
        'article_a_id': a, 'article_b_id': b,
        'feed_a_id': fa, 'feed_b_id': fb,
        'category_a': ca, 'category_b': cb,
        'published_at_a': ta, 'published_at_b': tb,
        'qwen_score': q, 'temporal_delta_hours': hours,
        'lexical_overlap': lex, 'entity_anchor_overlap': ent,
        'number_overlap': num, 'date_overlap': date,
    }


class GraphFeatureTests(unittest.TestCase):
    def test_catalog_hash_stable(self):
        self.assertEqual(g.strategy_catalog_hash(), g.strategy_catalog_hash())
        self.assertEqual(set(g.STRATEGY_CATALOG['event']), {f'E{i}' for i in range(6)})
        self.assertEqual(set(g.STRATEGY_CATALOG['near']), {'N0', 'N1'})

    def test_blind_guard_blocks_all_common_read_paths(self):
        import builtins, io
        p = Path('/tmp/blind-human-labels-sealed-v1.jsonl')
        with g.blind_guard():
            calls = [
                lambda: builtins.open(p), lambda: io.open(p), lambda: p.open(),
                lambda: p.read_text(), lambda: p.read_bytes(),
            ]
            for fn in calls:
                with self.assertRaises(PermissionError): fn()

    def test_neighbor_ranking_and_reciprocal_rank(self):
        rows = [
            row('1:2',1,2,10,20,q=.50,hours=2),
            row('1:3',1,3,10,30,q=.60,hours=3),
            row('2:3',2,3,20,30,q=.55,hours=1),
        ]
        ctx = g.materialize_graph_context(rows, excluded_articles=set())
        by = {r['pair_key']: r for r in ctx}
        self.assertEqual(by['1:2']['rank_a_to_b'], 2)
        self.assertEqual(by['1:2']['rank_b_to_a'], 2)
        self.assertEqual(by['1:2']['reciprocal_rank_max'], 2)

    def test_shared_support_requires_third_feed(self):
        rows = [
            row('1:2',1,2,10,20,q=.40,hours=2),
            row('1:3',1,3,10,30,q=.50,hours=2),
            row('2:3',2,3,20,30,q=.50,hours=2),
            row('1:4',1,4,10,10,q=.50,hours=2),  # same feed as A: cannot support pair 1:2
            row('2:4',2,4,20,10,q=.50,hours=2),
        ]
        ctx = g.materialize_graph_context(rows, excluded_articles=set())
        r = {x['pair_key']: x for x in ctx}['1:2']
        self.assertEqual(r['shared_support_article_count'], 1)
        self.assertEqual(r['shared_support_feed_count'], 1)

    def test_common_topk_only_third_source(self):
        rows = [
            row('1:2',1,2,10,20,q=.4,hours=1),
            row('1:3',1,3,10,30,q=.7,hours=1),
            row('2:3',2,3,20,30,q=.7,hours=1),
            row('1:4',1,4,10,10,q=.8,hours=1),
            row('2:4',2,4,20,10,q=.8,hours=1),
        ]
        r = {x['pair_key']:x for x in g.materialize_graph_context(rows,set())}['1:2']
        self.assertEqual(r['common_top5_count'],1)
        self.assertEqual(r['common_top10_count'],1)

    def test_support_degree_and_burst_span(self):
        rows = [
            row('1:2',1,2,10,20,q=.4,hours=1,
                ta='2026-10-28T10:00:00+00:00',tb='2026-10-28T11:00:00+00:00'),
            row('1:3',1,3,10,30,q=.5,hours=2,
                ta='2026-10-28T10:00:00+00:00',tb='2026-10-28T12:00:00+00:00'),
            row('2:3',2,3,20,30,q=.5,hours=1,
                ta='2026-10-28T11:00:00+00:00',tb='2026-10-28T12:00:00+00:00'),
        ]
        r = {x['pair_key']:x for x in g.materialize_graph_context(rows,set())}['1:2']
        self.assertEqual(r['support_degree_a'],2)
        self.assertEqual(r['support_degree_b'],2)
        self.assertEqual(r['min_support_degree'],2)
        self.assertAlmostEqual(r['support_burst_span_hours'],2)

    def test_excluded_article_cannot_be_candidate_or_hidden_support(self):
        rows = [
            row('1:2',1,2,10,20,q=.4,hours=1),
            row('1:3',1,3,10,30,q=.5,hours=1),
            row('2:3',2,3,20,30,q=.5,hours=1),
            row('1:4',1,4,10,40,q=.5,hours=1),
            row('2:4',2,4,20,40,q=.5,hours=1),
        ]
        ctx = g.materialize_graph_context(rows,{3})
        self.assertNotIn('1:3',{x['pair_key'] for x in ctx})
        r={x['pair_key']:x for x in ctx}['1:2']
        self.assertEqual(r['shared_support_article_count'],1)

    def test_shared_support_feed_deduplication(self):
        rows = [
            row('1:2',1,2,10,20,q=.4,hours=1),
            row('1:3',1,3,10,30,q=.5,hours=1), row('2:3',2,3,20,30,q=.5,hours=1),
            row('1:4',1,4,10,30,q=.5,hours=1), row('2:4',2,4,20,30,q=.5,hours=1),
        ]
        r={x['pair_key']:x for x in g.materialize_graph_context(rows,set())}['1:2']
        self.assertEqual(r['shared_support_article_count'],2)
        self.assertEqual(r['shared_support_feed_count'],1)

    def test_graph_context_replay_is_byte_identical(self):
        rows=[row('1:2',1,2,10,20,q=.4,hours=1),row('1:3',1,3,10,30,q=.5,hours=1),row('2:3',2,3,20,30,q=.5,hours=1)]
        one=g.canonical_json_bytes(g.materialize_graph_context(rows,set()))
        two=g.canonical_json_bytes(g.materialize_graph_context(list(reversed(rows)),set()))
        self.assertEqual(one,two)

    def test_event_and_near_predicates_include_direct_floor(self):
        base = row('1:2',1,2,10,20,q=g.Q90,hours=4,lex=.2)
        base.update(reciprocal_rank_max=20, shared_support_feed_count=0,
                    common_top10_count=0)
        self.assertTrue(g.matches_strategy(base,'N0'))
        low=dict(base,qwen_score=g.Q75-.001)
        self.assertFalse(g.matches_strategy(low,'N0'))

    def test_positive_families_connected_components(self):
        gold=[
            {'pair_key':'1:2','human_decision':'SAME_EVENT'},
            {'pair_key':'2:3','human_decision':'SAME_EVENT'},
            {'pair_key':'4:5','human_decision':'SAME_EVENT'},
            {'pair_key':'6:7','human_decision':'DIFFERENT_EVENT'},
        ]
        fam=g.same_event_families(gold)
        self.assertEqual(len(fam),2)
        self.assertEqual(sorted(map(len,fam)),[2,3])

    def test_matching_max(self):
        rows=[row('1:2',1,2,10,20),row('1:3',1,3,10,30),row('4:5',4,5,40,50)]
        self.assertEqual(g.article_disjoint_max(rows),2)

    def test_pack_feasibility_exact_quota_and_no_spillover(self):
        rows=[]
        # 4 event, 3 near, 3 control, all article disjoint, unique source pairs.
        for i in range(4):
            r=row(f'{2*i+1}:{2*i+2}',2*i+1,2*i+2,100+2*i,101+2*i,q=.6,hours=1)
            r.update(reciprocal_rank_max=1,shared_support_feed_count=1,common_top10_count=1)
            rows.append(r)
        off=20
        for i in range(3):
            r=row(f'{off+2*i+1}:{off+2*i+2}',off+2*i+1,off+2*i+2,200+2*i,201+2*i,q=.5,hours=1,lex=.2)
            r.update(reciprocal_rank_max=20,shared_support_feed_count=0,common_top10_count=0)
            rows.append(r)
        off=40
        for i in range(3):
            r=row(f'{off+2*i+1}:{off+2*i+2}',off+2*i+1,off+2*i+2,300+2*i,301+2*i,q=.31,hours=20)
            r.update(reciprocal_rank_max=20,shared_support_feed_count=0,common_top10_count=0)
            rows.append(r)
        result=g.pack_feasible(rows,'E1','N0',{'event':4,'near':3,'control':3},time_limit=10)
        self.assertEqual(result['status'],'FEASIBLE')
        self.assertEqual(result['counts'],{'event':4,'near':3,'control':3})

    def _template_rows(self, event_count, near_count, control_count):
        rows=[]; article=1; feed=1000
        for _ in range(event_count):
            r=row(f'{article}:{article+1}',article,article+1,feed,feed+1,q=.6,hours=1)
            r.update(reciprocal_rank_max=1,shared_support_feed_count=1,common_top10_count=1)
            rows.append(r); article+=2; feed+=2
        for _ in range(near_count):
            r=row(f'{article}:{article+1}',article,article+1,feed,feed+1,q=.5,hours=1,lex=.2)
            r.update(reciprocal_rank_max=20,shared_support_feed_count=0,common_top10_count=0)
            rows.append(r); article+=2; feed+=2
        for _ in range(control_count):
            r=row(f'{article}:{article+1}',article,article+1,feed,feed+1,q=.31,hours=20)
            r.update(reciprocal_rank_max=20,shared_support_feed_count=0,common_top10_count=0)
            rows.append(r); article+=2; feed+=2
        return rows

    def test_g40_feasibility(self):
        result=g.pack_feasible(self._template_rows(20,12,8),'E1','N0',g.STRATEGY_CATALOG['templates']['G40'],time_limit=10)
        self.assertEqual(result['status'],'FEASIBLE')

    def test_g48_feasibility(self):
        result=g.pack_feasible(self._template_rows(24,16,8),'E1','N0',g.STRATEGY_CATALOG['templates']['G48'],time_limit=10)
        self.assertEqual(result['status'],'FEASIBLE')

    def test_nondominated(self):
        configs=[
            dict(id='a',same=10,families=5,different=8,related=4,feasible=True),
            dict(id='b',same=9,families=4,different=9,related=3,feasible=True),
            dict(id='c',same=10,families=5,different=7,related=4,feasible=True),
            dict(id='d',same=11,families=4,different=7,related=5,feasible=False),
        ]
        ids={x['id'] for x in g.nondominated(configs)}
        self.assertEqual(ids,{'c','d'})


class AuditTests(unittest.TestCase):
    def test_bridge_report_requires_exact_pinned_evidence(self):
        good = (
            '# Story 02 V2 historical functional bridge\n\n'
            'The prospective pinned contract produced 200 vectors with 1,024 dimensions. '
            'All 200 matched their corresponding stored historical vector values exactly. '\
            'Minimum cosine was `0.9999999999999998`; median cosine was `1.0`; '
            'the maximum and p99 absolute component errors were `0.0`.\n\n'
            'For 18,953 historical cross-feed pairs, all cosine-score differences were `0.0` '
            'and Spearman rho was `1.0`. The predeclared full-vector and score equivalence gates passed. '
            'Transfer of the designated fixed Qwen thresholds is authorized by full functional equivalence.\n\n'
            'This functional result does not recover historical model lineage or prove the original preprocessing implementation. '
            'No human decisions were read, no fresh-corpus features were generated, and no packs were selected.\n'
        ).encode()
        self.assertEqual(hashlib.sha256(good).hexdigest(), a.BRIDGE_REPORT_SHA256)
        self.assertEqual(a.verify_bridge_report_bytes(good)['pair_score_count'], 18953)
        with self.assertRaises(ValueError): a.verify_bridge_report_bytes(good.replace(b'18,953', b'18,952'))

    def test_find_unique_sha(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); data=b'abc'; digest=hashlib.sha256(data).hexdigest()
            (root/'x.bin').write_bytes(data)
            self.assertEqual(a.find_unique_sha(root,digest).name,'x.bin')
            (root/'y.bin').write_bytes(data)
            with self.assertRaises(ValueError): a.find_unique_sha(root,digest)

    def test_freeze_bytes_and_replay(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            sha=a.freeze_bytes(root/'x.json',b'{}\n')
            self.assertEqual(sha,hashlib.sha256(b'{}\n').hexdigest())
            self.assertEqual((root/'x.json').stat().st_mode & 0o777,0o444)
            with self.assertRaises(FileExistsError): a.freeze_bytes(root/'x.json',b'{}\n')

    def test_gold_schema_and_expected_counts(self):
        rows=[]
        for i,label in enumerate(['SAME_EVENT']*57+['RELATED_TOPIC']*27+['DIFFERENT_EVENT']*149):
            rows.append({'entry_a_id':str(2*i+1),'entry_b_id':str(2*i+2),'gold_label':label})
        parsed=a.validate_gold_rows(rows)
        self.assertEqual(len(parsed),233)
        bad=list(rows); bad[0]=dict(bad[0],gold_label='UNCERTAIN')
        with self.assertRaises(ValueError): a.validate_gold_rows(bad)

    def test_freeze_before_label_gate(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); data=b'{\"x\":1}\n'
            frozen=root/'context.json'
            with self.assertRaises(ValueError): a.require_frozen_match(frozen,data)
            a.freeze_bytes(frozen,data)
            a.require_frozen_match(frozen,data)
            frozen.chmod(0o644)
            with self.assertRaises(ValueError): a.require_frozen_match(frozen,data)

    def test_strategy_diagnostics_and_family_coverage(self):
        context=[
            dict(pair_key='1:2', qwen_score=.5, temporal_delta_hours=1, feed_a_id=1,feed_b_id=2,
                 reciprocal_rank_max=1,shared_support_feed_count=1,common_top10_count=1,
                 lexical_overlap=0,entity_anchor_overlap=0,number_overlap=0,date_overlap=0),
            dict(pair_key='3:4', qwen_score=.5, temporal_delta_hours=1, feed_a_id=3,feed_b_id=4,
                 reciprocal_rank_max=20,shared_support_feed_count=0,common_top10_count=0,
                 lexical_overlap=.2,entity_anchor_overlap=0,number_overlap=0,date_overlap=0),
        ]
        labels=[
            {'pair_key':'1:2','human_decision':'SAME_EVENT'},
            {'pair_key':'3:4','human_decision':'RELATED_TOPIC'},
        ]
        families=[{1,2},{10,11}]
        e=a.strategy_diagnostic(context,labels,'E1',families)
        n=a.strategy_diagnostic(context,labels,'N0',families)
        self.assertEqual(e['SAME_EVENT'],1); self.assertEqual(e['same_event_families'],1)
        self.assertEqual(n['RELATED_TOPIC'],1)

    def test_graph_signal_gate(self):
        event=[{'strategy':'E1','same':8,'families':4}]
        near=[{'strategy':'N0','related':4}]
        feas=[{'event':'E1','near':'N0','template':'G40','status':'FEASIBLE'}]
        self.assertTrue(a.graph_signal_gate(event,near,feas))
        self.assertFalse(a.graph_signal_gate([{'strategy':'E1','same':7,'families':4}],near,feas))

    def test_report_privacy_rejects_pair_keys_and_titles(self):
        good='aggregate only\nBLIND_HUMAN_LABEL_ACCESS=NO\n'
        a.validate_tracked_report_privacy(good)
        for bad in ('pair_key=1:2','title_a=secret','blind-human-labels-sealed-v1.jsonl: SAME_EVENT'):
            with self.assertRaises(ValueError): a.validate_tracked_report_privacy(bad)


if __name__=='__main__': unittest.main()

class HistoricalContextCountRegression(unittest.TestCase):
    def test_historical_source_and_24h_context_are_distinct(self):
        a.validate_context_counts(33135, 18953, 5000)
        for counts in ((33134,18953,5000),(33135,18952,5000),(33135,18953,19000),(33135,18953,-1)):
            with self.assertRaises(ValueError):
                a.validate_context_counts(*counts)

class HistoricalTimestampRegression(unittest.TestCase):
    def test_epoch_and_iso_resolve_to_same_utc_time(self):
        self.assertEqual(a.ts(1792792334.0), a.ts('2026-10-23T21:52:14+00:00'))
        self.assertEqual(a.ts('1792792334.0'), a.ts('2026-10-23T21:52:14Z'))

class GoldCoverageRegression(unittest.TestCase):
    def fixtures(self):
        keys=[f'{1+i//152}:{2+i%152}' for i in range(233)]
        ids={int(x) for k in keys for x in k.split(':')}
        return keys,ids,set(range(1,201)),set(keys) | {f"{1000+i}:999999" for i in range(18953-len(keys))},set(keys)

    def test_complete_coverage(self):
        result=a.validate_gold_graph_coverage(*self.fixtures())
        self.assertEqual(result['gold_graph_compatibility_gate'],'PASS')
        self.assertEqual(result['gold_article_count'],153)

    def test_missing_source_context_and_article_rejected(self):
        keys,ids,home,source,ctx=self.fixtures()
        for args in ((keys,ids,home,source-{keys[0]},ctx),(keys,ids,home,source,ctx-{keys[0]}),(keys,ids,home-{1},source,ctx),(keys[:-1]+keys[:1],ids,home,source,ctx),(keys,ids-{1},home,source,ctx)):
            with self.assertRaises(ValueError): a.validate_gold_graph_coverage(*args)

    def test_set_digests_are_order_independent(self):
        keys,ids,*_=self.fixtures()
        self.assertEqual(a.identity_digest(keys),a.identity_digest(reversed(keys)))
        self.assertEqual(a.identity_digest(ids),a.identity_digest(reversed(sorted(ids))))

    def test_failed_coverage_prevents_diagnostics(self):
        from unittest.mock import patch
        with patch.object(a,'frozen'),patch.object(a,'verify'),patch.object(a,'gold_rows',return_value=[{'pair_key':'1:2','human_decision':'SAME_EVENT'}]),patch.object(a,'validate_gold_graph_coverage',side_effect=ValueError('coverage'),create=True),patch.object(a,'diagnostic') as diag,patch.object(g,'same_event_families') as fam:
            with self.assertRaises(ValueError): a.audit([],[],[], 'hist','catalog')
            diag.assert_not_called();fam.assert_not_called()
