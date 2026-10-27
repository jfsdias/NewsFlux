import csv
import io
import unittest
import prepare_session as p

def row(i):
    return dict(annotation_id=f'A{i:03}',pair_key=f'{i*2+1}:{i*2+2}',feed_a='Feed A',feed_b='Feed B',title_a='Title A',title_b='Title B',published_at_a='2026-01-01T00:00:00Z',published_at_b='2026-01-01T01:00:00Z',label_options=p.LABELS,human_decision='')

class SessionTests(unittest.TestCase):
    def test_neutral_mapping_and_replay(self):
        dev=[row(i) for i in range(80)];blind=[row(i) for i in range(80,128)]
        a=p.derive(dev,blind);b=p.derive(dev,blind)
        self.assertEqual(a,b)
        visible=list(csv.DictReader(io.StringIO(a['review-session-v1.csv'].decode())))
        self.assertEqual(len(visible),128)
        self.assertEqual([r['annotation_id'] for r in visible],[f'R{i:03}' for i in range(1,129)])
        self.assertEqual(tuple(visible[0]),p.COLUMNS)
        self.assertTrue(all(r['human_decision']=='' and r['label_options']==p.LABELS for r in visible))
        self.assertNotIn('pair_key',visible[0]);self.assertNotIn('source_pack',visible[0])
        self.assertEqual(len(a['review-session-map-v1.jsonl'].splitlines()),128)
    def test_existing_decision_rejected(self):
        d=[row(i) for i in range(80)];b=[row(i) for i in range(80,128)];d[0]['human_decision']='x'
        with self.assertRaises(ValueError):p.derive(d,b)
    def test_cross_pack_article_overlap_rejected(self):
        d=[row(i) for i in range(80)];b=[row(i) for i in range(80,128)];b[0]['pair_key']=f"1:{b[0]['pair_key'].split(':')[1]}"
        with self.assertRaises(ValueError):p.derive(d,b)
    def test_private_freeze(self):
        from pathlib import Path
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'root';root.mkdir()
            with patch.object(p,'ROOT',root):
                with self.assertRaises(ValueError):p.freeze(Path(t)/'outside',{'x':b'x'})
                hashes=p.freeze(root/'new',{'x':b'x'})
                self.assertEqual(hashes['x'],p.sha(b'x'))
                self.assertEqual((root/'new/x').stat().st_mode&0o777,0o444)

if __name__=='__main__':unittest.main()

class MoreSessionTests(unittest.TestCase):
    def test_mapping_bijection_and_order_independent_of_pack(self):
        import json
        d=[row(i) for i in range(80)];b=[row(i) for i in range(80,128)]
        one=p.derive(d,b);two=p.derive(list(reversed(d)),list(reversed(b)))
        self.assertEqual(one,two)
        maps=[json.loads(x) for x in one['review-session-map-v1.jsonl'].splitlines()]
        self.assertEqual(len({x['pair_key'] for x in maps}),128)
        self.assertEqual(len({x['annotation_id'] for x in maps}),128)
        self.assertEqual(sum(x['source_pack']=='DEV' for x in maps),80)
    def test_invalid_label_options_and_duplicate_rejected(self):
        d=[row(i) for i in range(80)];b=[row(i) for i in range(80,128)]
        d[0]['label_options']='other'
        with self.assertRaises(ValueError):p.derive(d,b)
        d[0]=row(0);b[0]['pair_key']=d[0]['pair_key']
        with self.assertRaises(ValueError):p.derive(d,b)
    def test_mining_fields_cannot_leak(self):
        d=[row(i) for i in range(80)];b=[row(i) for i in range(80,128)]
        for r in d+b:r.update(search_rank_v2='secret-marker',source_pack='secret-marker',qwen_score='secret-marker')
        output=p.derive(d,b)['review-session-v1.csv']
        self.assertNotIn(b'secret-marker',output)

class IntegrityTests(unittest.TestCase):
    def test_frozen_input_hash_and_mode_guard(self):
        from pathlib import Path
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);f=root/'synthetic';f.write_bytes(b'input');f.chmod(0o444)
            with patch.object(p,'P3',root),patch.object(p,'HASHES',{'synthetic':p.sha(b'input')}):
                p.checked_inputs()
                f.chmod(0o644)
                with self.assertRaises(ValueError):p.checked_inputs()
                self.assertEqual(f.read_bytes(),b'input')
    def test_guide_does_not_disclose_pack_identity(self):
        guide=p.GUIDE.decode().lower()
        for word in ('dev_augment','blind_challenge','search_rank','qwen_score'):
            self.assertNotIn(word,guide)
