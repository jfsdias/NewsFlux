import json
from pathlib import Path
import unittest

class TopologyTests(unittest.TestCase):
    def setUp(self):
        self.config=json.loads(Path(__file__).with_name('compose.candidate.json').read_text())

    def test_sidecar_is_private_and_disabled(self):
        service=self.config['services']['content-fallback']
        self.assertNotIn('ports',service)
        self.assertEqual(service['environment']['CONTENT_FALLBACK_READER_ENABLED'],'false')
        self.assertEqual(json.loads(service['environment']['CONTENT_FALLBACK_POLICIES_JSON']),{'enabled':False})
        self.assertEqual(set(service['networks']),{'wallhop_reader','wallhop_miniflux'})
        for network in service['networks']:
            self.assertTrue(self.config['networks'][network]['internal'])

    def test_dedicated_members_and_summary_unchanged(self):
        services=self.config['services']
        self.assertEqual(set(services),{'newsflux','miniflux','content-fallback'})
        self.assertEqual(services['newsflux']['networks'],['wallhop_reader'])
        self.assertEqual(services['miniflux']['networks'],['wallhop_miniflux'])
        self.assertNotIn('summary-api',services)
