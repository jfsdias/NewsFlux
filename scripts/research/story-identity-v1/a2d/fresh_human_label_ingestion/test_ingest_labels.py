import unittest
import ingest_labels as i

def fixture():
    blank=[];human=[];mapping=[];p3={'DEV':set(),'BLIND':set()}
    for n in range(1,129):
        ident=f'R{n:03}';pack='DEV' if n<=80 else 'BLIND';key=f'{2*n-1}:{2*n}'
        base=dict(annotation_id=ident,feed_a='synthetic',feed_b='synthetic',title_a='synthetic',title_b='synthetic',published_at_a='synthetic',published_at_b='synthetic',label_options=i.OPTIONS,human_decision='')
        blank.append(base);human.append(dict(base,human_decision='UNCERTAIN'))
        mapping.append(dict(annotation_id=ident,source_pack=pack,original_annotation_id=f'A{n:03}',pair_key=key));p3[pack].add(key)
    return blank,human,mapping,p3

class IngestTests(unittest.TestCase):
    def test_routing_and_replay(self):
        a=fixture();out=i.derive(*a)
        self.assertEqual(out,i.derive(*a))
        self.assertEqual(len(out['dev-human-labels-v1.jsonl'].splitlines()),80)
        self.assertEqual(len(out['blind-human-labels-sealed-v1.jsonl'].splitlines()),48)
    def test_blank_and_invalid_rejected(self):
        a=fixture();a[1][0]['human_decision']=''
        with self.assertRaises(ValueError):i.derive(*a)
        a=fixture();a[1][0]['human_decision']='wrong'
        with self.assertRaises(ValueError):i.derive(*a)
    def test_duplicate_id_rejected(self):
        a=fixture();a[1][1]['annotation_id']=a[1][0]['annotation_id']
        with self.assertRaises(ValueError):i.derive(*a)
    def test_mapping_and_p3_membership_rejected(self):
        a=fixture();a[2][0]['pair_key']=a[2][1]['pair_key']
        with self.assertRaises(ValueError):i.derive(*a)
        a=fixture();a[3]['DEV'].remove(a[2][0]['pair_key'])
        with self.assertRaises(ValueError):i.derive(*a)
    def test_no_blind_output(self):
        import contextlib,io
        buf=io.StringIO()
        with contextlib.redirect_stdout(buf):i.derive(*fixture())
        self.assertEqual(buf.getvalue(),'')

if __name__=='__main__':unittest.main()

class IntegrityTests(unittest.TestCase):
    def test_firewall_receipt_has_no_labels_keys_or_titles(self):
        import json
        receipt=json.dumps(i.public_receipt({'blind-human-labels-sealed-v1.jsonl':'a'*64}))
        for secret in ('UNCERTAIN','SAME_EVENT','RELATED_TOPIC','DIFFERENT_EVENT','271:272','secret title'):
            self.assertNotIn(secret,receipt)
    def test_input_visible_fields_are_immutable(self):
        a=fixture();a[1][3]['title_a']='modified'
        with self.assertRaises(ValueError):i.derive(*a)
    def test_extra_mapping_id_rejected(self):
        a=fixture();a[2][0]['annotation_id']='R999'
        with self.assertRaises(ValueError):i.derive(*a)
    def test_private_destination_mode_and_hash(self):
        from pathlib import Path
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'root';root.mkdir()
            with patch.object(i,'ROOT',root):
                with self.assertRaises(ValueError):i.freeze(Path(t)/'outside',{'test':b'x'})
                result=i.freeze(root/'output',{'test':b'x'})
                self.assertEqual(result['test'],i.sha(b'x'))
                self.assertEqual((root/'output/test').stat().st_mode&0o777,0o444)
