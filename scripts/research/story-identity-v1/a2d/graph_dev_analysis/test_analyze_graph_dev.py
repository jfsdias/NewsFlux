import unittest
import analyze_graph_dev as a

class AnalysisTests(unittest.TestCase):
    def fixture(self):
        labs=[];side=[]
        for i in range(1,41):
            lane='event' if i<=20 else ('near' if i<=32 else 'control');label='RELATED_TOPIC' if i in (1,21) else 'DIFFERENT_EVENT'
            labs.append({'source_annotation_id':f'G{i:03}','review_annotation_id':f'R{i:03}','pair_key':f'{2*i-1}:{2*i}','human_decision':label})
            row={'annotation_id':f'G{i:03}','pair_key':f'{2*i-1}:{2*i}','selection_lane':lane};row.update({k:float(i) for k in a.FEATURES});side.append(row)
        return labs,side
    def test_join_metrics_and_null_recall(self):
        labs,side=self.fixture();joined=a.join(labs,side);x=a.analyze(joined)
        self.assertEqual(len(joined),40);self.assertEqual(x['matrix']['event']['RELATED_TOPIC'],1)
        self.assertEqual(x['proxy']['fp_related'],1);self.assertEqual(x['proxy']['fp_different'],19)
        self.assertEqual(x['proxy']['precision'],0);self.assertIsNone(x['proxy']['recall'])
        self.assertEqual(x['combined']['total'],120);self.assertEqual(x['combined']['RELATED_TOPIC'],3)
        self.assertEqual(x['recommendation'],'GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV')
    def test_missing_duplicate_and_lane_rejected(self):
        for mode in ('missing','duplicate','lane'):
            labs,side=self.fixture()
            if mode=='missing':side.pop()
            elif mode=='duplicate':side[1]['pair_key']=side[0]['pair_key']
            else:side[0]['selection_lane']='control'
            with self.subTest(mode=mode),self.assertRaises(ValueError):a.join(labs,side)
    def test_null_and_uncertain_excluded(self):
        self.assertIsNone(a.divide(0,0));self.assertEqual(a.divide(1,2),.5)
        self.assertEqual(a.merge_proxy([{'selection_lane':'event','human_decision':'UNCERTAIN'}])['precision'],None)
    def test_replay_and_recommendation(self):
        labs,side=self.fixture();one=a.analyze(a.join(labs,side));two=a.analyze(a.join(labs,side));self.assertEqual(a.canonical(one),a.canonical(two))
        self.assertEqual(a.recommendation(0,3,120),'GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV')
        self.assertEqual(a.recommendation(1,3,120),'GRAPH_CONTEXT_PARTIAL_SIGNAL_EVIDENCE_STILL_INSUFFICIENT')
        self.assertEqual(a.recommendation(8,8,120),'DEV_EVIDENCE_SUFFICIENT_FOR_NEXT_SCORER_STAGE')
    def test_guard(self):
        import builtins,io,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            allowed=Path(d)/'graph-dev-human-labels-v1.jsonl';allowed.write_text('ok')
            with a.label_guard():
                self.assertEqual(allowed.read_text(),'ok')
                for n in a.FORBIDDEN:
                    f=Path(d)/n
                    for read in (lambda:builtins.open(f),lambda:io.open(f),lambda:f.open(),lambda:f.read_text(),lambda:f.read_bytes()):
                        with self.assertRaises(PermissionError):read()

    def test_confusion_semantics_include_related_as_negative(self):
        rows=[{'selection_lane':'event','human_decision':'SAME_EVENT'},{'selection_lane':'event','human_decision':'RELATED_TOPIC'},{'selection_lane':'event','human_decision':'DIFFERENT_EVENT'},{'selection_lane':'event','human_decision':'UNCERTAIN'},{'selection_lane':'near','human_decision':'SAME_EVENT'},{'selection_lane':'control','human_decision':'RELATED_TOPIC'},{'selection_lane':'control','human_decision':'UNCERTAIN'}]
        x=a.merge_proxy(rows);self.assertEqual((x['tp'],x['fp_related'],x['fp_different'],x['fn'],x['tn']),(1,1,1,1,1));self.assertEqual(x['precision'],1/3);self.assertEqual(x['recall'],.5)
        self.assertIsNone(a.merge_proxy([{'selection_lane':'near','human_decision':'DIFFERENT_EVENT'}])['precision'])

    def test_independent_validator_rejects_tampering(self):
        from unittest.mock import patch
        labs,side=self.fixture();joined=a.join(labs,side);result=a.analyze(joined)
        with patch.object(a,'join',side_effect=AssertionError('not independent')),patch.object(a,'analyze',side_effect=AssertionError('not independent')):
            a.validate_analysis(joined,labs,side,result)
            result['proxy']['fp_related']+=1
            with self.assertRaises(ValueError):a.validate_analysis(joined,labs,side,result)

    def test_deterministic_summary_missing_values(self):
        labs,side=self.fixture();side[0]['support_burst_span_hours']=None;result=a.analyze(a.join(labs,side));summary=result['feature_summaries']['by_lane']['event']['support_burst_span_hours']
        self.assertEqual(summary['n'],20);self.assertEqual(summary['available_n'],19)
        self.assertEqual(result['feature_summaries']['by_human_decision']['RELATED_TOPIC']['sample_caution'],'VERY_SMALL_N_NO_INFERENTIAL_CLAIM')
        self.assertIsNone(result['feature_summaries']['by_human_decision']['SAME_EVENT']['features']['qwen_score']['median'])

    def test_freeze_readback(self):
        import tempfile,hashlib
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.json';data=a.canonical({'b':2,'a':1});h=a.freeze(p,data)
            self.assertEqual(h,hashlib.sha256(data).hexdigest());self.assertEqual(p.stat().st_mode&0o777,0o444)
            with self.assertRaises(FileExistsError):a.freeze(p,data)

    def test_independent_rejects_bad_primary_gate(self):
        labs,side=self.fixture();rows=a.join(labs,side);x=a.analyze(rows);x['graph_dev_strict_positive_recovery_gate']='PASS'
        with self.assertRaises(ValueError):a.validate_analysis(rows,labs,side,x)

    def test_pinned_inputs_manifest_and_old_aggregate(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);old=root/'old';old.mkdir();d2c=root/'d2c';d2c.mkdir()
            report=old/'DEV_ANALYSIS_REPORT.md';report.write_text('0 SAME_EVENT, 1 RELATED_TOPIC, 79 DIFFERENT_EVENT and 0 UNCERTAIN')
            protocol=old/'DEV_ANALYSIS_PROTOCOL.md';protocol.write_text('at least eight SAME_EVENT, eight RELATED_TOPIC, 60 non-UNCERTAIN records')
            manifest=d2c/'graph-human-label-ingestion-manifest-v1.json';state={'annotation_state':'ANNOTATED_INGESTED_FROZEN','analysis_state':'NOT_RUN','human_label_source':'MANUAL_HUMAN_REVIEW','agent_generated_labels':0,'row_count':40};manifest.write_text(json.dumps(state));manifest.chmod(0o444)
            blobs={protocol.read_bytes():'d47e44013456c2252afa22d81afb0e282d8d23a4',report.read_bytes():'35d5ae17746771c139905d09a7854ce54debe7c6'};hashes={manifest:a.sha(manifest.read_bytes())}
            with patch.object(a,'OLD',old),patch.object(a,'D2C',d2c),patch.object(a,'HASHES',hashes),patch.object(a,'gitblob',side_effect=lambda b:blobs[b]):
                a.verify_inputs()
                manifest.chmod(0o644);state['analysis_state']='ALREADY_RUN';manifest.write_text(json.dumps(state));manifest.chmod(0o444);hashes[manifest]=a.sha(manifest.read_bytes())
                with self.assertRaisesRegex(ValueError,'ingestion state'):a.verify_inputs()
                hashes[manifest]='0'*64
                with self.assertRaisesRegex(ValueError,'input integrity'):a.verify_inputs()
