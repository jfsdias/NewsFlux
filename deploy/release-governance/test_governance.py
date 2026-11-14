import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('governance', Path(__file__).with_name('governance.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

class GovernanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = [self.root / 'base.yaml', self.root / 'override.yaml']
        for i, path in enumerate(self.files): path.write_text(f'file-{i}')
        self.manifest = {'approved_sha':'a'*40, 'candidate_image':'sha256:'+'b'*64, 'previous_image':'sha256:'+'c'*64,
          'compose_files':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in self.files],
          'protected_containers':{'reader':'id-reader','miniflux':'id-miniflux'}, 'rollback_file':str(self.root/'rollback.json'),
          'summary_networks':['private','gateway'],'summary_mounts':['/data','/run/secrets/key']}
        (self.root/'rollback.json').write_text('{}')
        self.manifest['rollback_sha256'] = hashlib.sha256((self.root/'rollback.json').read_bytes()).hexdigest()
        self.effective = {'services':{'summary-api':{'image':self.manifest['candidate_image'],'environment':{'NEWSFLUX_AI_INFERENCE_ENABLED':'false','NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER':'false','NEWSFLUX_AI_ALLOW_PAID_INFERENCE':'false','NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK':'false'},'networks':{'private':{},'gateway':{}},'volumes':[{'target':'/data'},{'target':'/run/secrets/key'}]}}}

    def test_preflight_accepts_exact_snapshot(self):
        g.validate(self.manifest,self.files,self.effective,{'reader':'id-reader','miniflux':'id-miniflux'})

    def test_rejects_missing_changed_or_reordered_compose_files(self):
        with self.assertRaises(g.GateError): g.validate(self.manifest,self.files[::-1],self.effective,{'reader':'id-reader','miniflux':'id-miniflux'})
        self.files[0].write_text('changed')
        with self.assertRaises(g.GateError): g.validate(self.manifest,self.files,self.effective,{'reader':'id-reader','miniflux':'id-miniflux'})

    def test_rejects_modified_rollback_artifact(self):
        (self.root/'rollback.json').write_text('{"altered":true}')
        with self.assertRaises(g.GateError):
            g.validate(self.manifest,self.files,self.effective,{'reader':'id-reader','miniflux':'id-miniflux'})

    def test_rejects_mutable_image_enabled_inference_and_other_service_drift(self):
        for change in ('image','policy','protected','ports','network'):
            with self.subTest(change=change):
                effective=json.loads(json.dumps(self.effective)); ids={'reader':'id-reader','miniflux':'id-miniflux'}
                if change=='image': effective['services']['summary-api']['image']='latest'
                if change=='policy': effective['services']['summary-api']['environment']['NEWSFLUX_AI_INFERENCE_ENABLED']='true'
                if change=='protected': ids['reader']='changed'
                if change=='ports': effective['services']['summary-api']['ports']=[{'published':'1234'}]
                if change=='network': effective['services']['summary-api']['networks']['public']={}
                with self.assertRaises(g.GateError): g.validate(self.manifest,self.files,effective,ids)

    def test_simulated_release_and_rollback_are_idempotent_and_refuse_drift(self):
        state={'summary-api':self.manifest['previous_image'],'reader':'id-reader','miniflux':'id-miniflux'}
        release=g.SimulatedRelease(self.manifest,state)
        release.promote(); self.assertEqual(state['summary-api'],self.manifest['candidate_image'])
        release.rollback(); release.rollback(); self.assertEqual(state['summary-api'],self.manifest['previous_image'])
        release.promote(); state['reader']='modified'
        with self.assertRaises(g.GateError): release.rollback()
        self.assertEqual(state['summary-api'],self.manifest['candidate_image'])
