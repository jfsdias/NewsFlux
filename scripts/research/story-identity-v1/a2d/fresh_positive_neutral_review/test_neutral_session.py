import json, pathlib, tempfile, unittest
import prepare_session as p
import select_review_pack as s

class NeutralSessionTests(unittest.TestCase):
    def test_human_label_firewall(self):
        with p.firewall():
            for name in p.FORBIDDEN:
                with self.assertRaises(PermissionError):pathlib.Path('/tmp',name).read_bytes()
    def test_external_network_firewall(self):
        import socket
        with socket.socket() as connection, p.firewall(), self.assertRaises(PermissionError):connection.connect(('127.0.0.1',1))
    def test_preselection_pack_required_before_metadata(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(FileNotFoundError):p.run(d)
    def test_source_hash_mismatch_is_rejected(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            pth=pathlib.Path(d)/'attempt-1';pth.mkdir()
            with patch.object(s,'ROOT',pathlib.Path(d)):
                with self.assertRaises(ValueError):s.source()
    def test_template_is_local_and_private_map_not_served(self):
        t=p.review.TEMPLATE.read_text()
        self.assertNotIn('fetch(',t);self.assertNotIn('neutral-review-map-v1',t);self.assertNotIn('https://',t)
    def test_existing_guide_neutral(self):
        for x in (b'positive evidence',b'calibration gate',b'qwen_score',b'component_id'):
            self.assertNotIn(x,p.review.GUIDE.lower())
    def test_reviewer_csv_blank_and_schema(self):
        rows=[dict(annotation_id=f'R{i:03}',feed_a='Feed A',feed_b='Feed B',title_a='A',title_b='B',published_at_a='2026',published_at_b='2026',label_options=p.review.LABELS,human_decision='') for i in range(1,41)]
        data=p.review.csv_bytes(rows)
        self.assertEqual(len(data.splitlines()),41)
        self.assertEqual(set(rows[0]),set(p.review.COLUMNS))
        self.assertTrue(all(not r['human_decision'] for r in rows))
    def test_content_and_labels_forbidden(self):
        self.assertIn('d2e3',p.FORBIDDEN);self.assertIn('blind-human-labels',p.FORBIDDEN)
if __name__=='__main__':unittest.main()

class SyntheticSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import itertools
        cls.rows=[];rank=0
        for component,start,n,edge_count in [('A',1,70,408),('B',101,34,115),('C',201,2,1),('D',301,2,1)]:
            vertices=list(range(start,start+n))
            pairs=[(vertices[i],vertices[i+1]) for i in range(0,n,2)]
            used=set(pairs)
            pairs += [p for p in itertools.combinations(vertices,2) if p not in used][:edge_count-len(pairs)]
            for a,b in pairs:
                rank+=1
                cls.rows.append({'article_id_a':a,'article_id_b':b,'pair_key':f'{a}:{b}','component_id':component,'deterministic_rank':rank,'lane_primary':'GRAPH_SUPPORTED_EVENT','lane_membership':['GRAPH_SUPPORTED_EVENT'],'both_content_usable':True,'title_equivalent_article_present':False})
        cls.selected,cls.proof=s.select(cls.rows)
    def test_exactly_40_unique_pairs(self):self.assertEqual(len({x['pair_key'] for x in self.selected}),40)
    def test_80_distinct_articles(self):self.assertEqual(len({i for x in self.selected for i in (x['article_id_a'],x['article_id_b'])}),80)
    def test_all_four_components(self):self.assertEqual({x['component_id'] for x in self.selected},{'A','B','C','D'})
    def test_both_singletons(self):self.assertEqual(sum(x['component_id'] in ('C','D') for x in self.selected),2)
    def test_closest_balance(self):
        from collections import Counter
        count=Counter(x['component_id'] for x in self.selected)
        self.assertEqual((count['A'],count['B']),(21,17))
    def test_pack_contains_no_titles_or_decisions(self):
        self.assertTrue(all(not ({'title','url','content','human_decision'} & set(x)) for x in self.selected))
    def test_deterministic_replay(self):self.assertEqual((self.selected,self.proof),s.select(self.rows))
    def test_source_component_drift_rejected(self):
        with self.assertRaises(ValueError):s.select(self.rows[:-1])
