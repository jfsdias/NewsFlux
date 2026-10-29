import copy
import unittest
from pathlib import Path
import review_core as c
import validate_neutral_review as v

def fixture():
    pairs=[{'pair_key':f'{2*i+1}:{2*i+2}','article_id_a':2*i+1,'article_id_b':2*i+2,'selection_position':i+1,'b1_rank':i+1} for i in range(11)]
    corpus=[{'id':i,'title':f'Title <{i}> &', 'feed_title':'Source','published_at':'2026-01-01'} for i in range(1,23)]
    return pairs,corpus

def render(rows,sid):
    template=Path(__file__).with_name('review-ui-template.html').read_text()
    import json
    return template.replace('__DATA__',c.html_data(rows)).replace('__STORAGE__',json.dumps('newsflux-story02-d2f8-'+sid)).encode()

class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.p,self.c=fixture();self.n=b'a'*32;self.rows,self.map=c.derive(self.p,self.c,self.n)
    def test_replay_and_sample(self):
        self.assertEqual((self.rows,self.map),c.derive(self.p,self.c,self.n));self.assertEqual({p['pair_key'] for p in self.p},{m['pair_key'] for m in self.map})
        self.assertEqual(len({m['review_id'] for m in self.map}),11)
    def test_nonce_can_change_order_and_sides(self):
        candidates=[c.derive(self.p,self.c,bytes([n])*32) for n in range(1,5)]
        self.assertTrue(any([m['pair_key'] for m in x[1]] != [m['pair_key'] for m in self.map] for x in candidates))
    def test_rank_does_not_derive_review_ids(self):
        shuffled=copy.deepcopy(self.p)
        for x in shuffled:x['b1_rank']+=100
        self.assertEqual([m['review_id'] for m in c.derive(shuffled,self.c,self.n)[1]],[m['review_id'] for m in self.map])
        self.assertEqual([m['pair_key'] for m in c.derive(shuffled,self.c,self.n)[1]],[m['pair_key'] for m in self.map])
    def test_visible_schema_escape_preserves_title(self):
        self.assertEqual(tuple(self.rows[0]),c.COLUMNS)
        self.assertIn('<',self.rows[0]['left_title']);self.assertNotIn('<',c.html_data(self.rows))
        v.validate(self.p,self.c,self.n,self.rows,self.map,c.csv_bytes(self.rows),render(self.rows,'synthetic'),'synthetic')
    def test_missing_metadata_sentinels(self):
        for x in self.c:x.pop('feed_title');x.pop('published_at')
        rows,_=c.derive(self.p,self.c,self.n)
        self.assertTrue(all(x['left_source']=='SOURCE_UNAVAILABLE' and x['right_published_at']=='PUBLISHED_AT_UNAVAILABLE' for x in rows))
    def test_duplicate_or_missing_articles(self):
        with self.assertRaises(ValueError):c.derive(self.p,self.c+[self.c[0]],self.n)
        with self.assertRaises(ValueError):c.derive(self.p,self.c[:-1],self.n)
    def test_decision_and_csv_gates(self):
        rows=copy.deepcopy(self.rows);rows[0]['human_decision']='SAME_EVENT'
        with self.assertRaises(ValueError):v.check_csv(c.csv_bytes(rows))
        rows[0]['human_decision']='INVALID'
        with self.assertRaises(ValueError):v.check_csv(c.csv_bytes(rows))
        for row in rows:row['human_decision']='UNCERTAIN'
        rows[0]['human_decision']='';self.assertFalse(c.complete(rows))
        rows[0]['human_decision']='SAME_EVENT';self.assertTrue(c.complete(rows));v.check_csv(c.csv_bytes(rows),initial=False)
        with self.assertRaises(ValueError):v.check_csv(c.csv_bytes(rows).replace(b'review_id,',b'unknown,'),initial=False)
    def test_bad_namespace_or_external_reference(self):
        html=render(self.rows,'synthetic')
        with self.assertRaises(ValueError):v.check_html(html,self.rows,'other')
        with self.assertRaises(ValueError):v.check_html(html+b'<script src="https://bad.test/a.js"></script>',self.rows,'synthetic')

    def test_no_identity_or_feature_columns(self):
        data=c.csv_bytes(self.rows)
        for forbidden in (b'pair_key',b'article_id',b'b1_rank',b'selection_position',b'qwen_score',b'strategy_membership'):
            self.assertNotIn(forbidden,data)
    def test_invalid_mapping_rejected(self):
        mapping=copy.deepcopy(self.map);mapping[0]['left_article_id']=999
        with self.assertRaises(ValueError):v.validate(self.p,self.c,self.n,self.rows,mapping,c.csv_bytes(self.rows),render(self.rows,'synthetic'),'synthetic')
    def test_title_escape_blocks_script_end(self):
        for row in self.c:row['title']='</script><script>alert(1)</script>'
        rows,_=c.derive(self.p,self.c,self.n)
        self.assertNotIn('</script>',c.html_data(rows))
        self.assertEqual(rows[0]['left_title'],'</script><script>alert(1)</script>')
    def test_completed_export_requires_exactly_eleven(self):
        rows=copy.deepcopy(self.rows)
        for row in rows:row['human_decision']='RELATED_TOPIC'
        self.assertTrue(c.complete(rows));self.assertFalse(c.complete(rows[:-1]))

class RendererProvenanceTests(unittest.TestCase):
    def test_template_drift_rejected_before_byte_replay(self):
        import hashlib
        before=b'<p>same</p>';after=b'<p> same </p>'
        self.assertNotEqual(before,after)
        guard=getattr(v,'validate_renderer_template',lambda *_:None)
        with self.assertRaisesRegex(ValueError,'TEMPLATE_HASH_MISMATCH'):
            guard(hashlib.sha256(before).hexdigest(),after)
