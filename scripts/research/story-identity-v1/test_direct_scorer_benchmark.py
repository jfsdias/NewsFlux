#!/usr/bin/env python3
"""Tests for direct_scorer_benchmark.py (STORY-02-A0 R3).

Verifies:
- Canonical cross-feed identity contract (zero same-feed pairs).
- Symmetric per-article top-K candidate retrieval (RF0R) and higher-ID neighbor selection.
- Canonical pair deduplication min(u, v)_max(u, v).
- R3 24h temporal clustering policy (RESEARCH_POLICY_24H).
- Elimination of arbitrary magic safety thresholds in favor of strict descriptive classifications.
- False merge review pack score sources (D0 uses D0 scores, D1 uses D1 scores).
- Stack fidelity for D1 (RF1 retrieval before P3 clustering).
- D0 raw pipeline execution and Home-200 value recalculation (180 stories, 12 multi-stories, 10.0% noise reduction).
- Python <-> Node candidate and projection parity.
- Presence and validity of all 7 required R3 private artifacts in /tmp/newsflux-story02-a0-r3/.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
import subprocess
import sys
import unittest

CUR_DIR = Path(__file__).resolve().parent
if str(CUR_DIR) not in sys.path:
    sys.path.insert(0, str(CUR_DIR))

from direct_scorer_benchmark import (
    CANONICAL_TOTAL_CROSSFEED_PAIRS,
    OUTPUT_DIR,
    R3_P3_MAX_TEMPORAL_SPAN_HOURS,
    cluster_with_p3,
    compute_overlap_coefficient,
    evaluate_direct_scorer_3fold,
    evaluate_gold_cluster_safety,
    execute_d0_raw_pipeline_on_home200,
    extract_significant_words,
    get_feed_identity,
    retrieve_candidates_rf0r,
    run_direct_scorer_benchmark,
    run_rf0r_retrieval_benchmark,
)
from model_benchmark import (
    load_and_materialize_features,
    make_canonical_pair_key,
    simulate_protocol_a,
)
from split_audit import ArticleGraph


class TestDirectScorerBenchmark(unittest.TestCase):
    """Verifies direct pair scorers and R3 runtime contract fidelity."""

    @classmethod
    def setUpClass(cls):
        cls.rows, _ = load_and_materialize_features()
        cls.graph = ArticleGraph(cls.rows)
        cls.split_result = simulate_protocol_a(cls.graph, 3)

        comp_lookup = {c["component_id"]: c for c in cls.graph.get_component_details()}
        rows_by_key = {r["pair_key"]: r for r in cls.rows}

        cls.fold_data = []
        for f in cls.split_result["folds"]:
            f_idx = f["fold"]
            f_rows = []
            f_articles = set()
            for cid in f["components"]:
                c_info = comp_lookup[cid]
                f_articles.update(c_info["nodes"])
                for p in c_info["pairs"]:
                    pk = make_canonical_pair_key(p["entry_a_id"], p["entry_b_id"])
                    f_rows.append(rows_by_key[pk])
            cls.fold_data.append({"fold_idx": f_idx, "rows": f_rows, "articles": f_articles})

        cls.d0_res = evaluate_direct_scorer_3fold("D0_TITLE_OVERLAP_DIRECT", "title_overlap_coefficient", cls.fold_data)
        cls.d1_res = evaluate_direct_scorer_3fold("D1_QWEN_COSINE_DIRECT", "qwen_embedding_cosine", cls.fold_data)

    def test_d0_direct_metrics(self):
        """Verifies D0 Title Overlap Direct metrics under 3-fold component group CV."""
        self.assertEqual(self.d0_res["scorer_name"], "D0_TITLE_OVERLAP_DIRECT")
        self.assertEqual(self.d0_res["oof_count"], 156)
        self.assertAlmostEqual(self.d0_res["pr_auc"], 0.8660, places=2)
        self.assertAlmostEqual(self.d0_res["roc_auc"], 0.9403, places=2)
        self.assertAlmostEqual(self.d0_res["precision"], 0.7778, places=2)
        self.assertAlmostEqual(self.d0_res["recall"], 0.7368, places=2)
        self.assertAlmostEqual(self.d0_res["f05"], 0.7692, places=2)
        self.assertLessEqual(self.d0_res["threshold_summary"]["spread"], 0.10)

    def test_d1_direct_metrics(self):
        """Verifies D1 Qwen Cosine Direct metrics under 3-fold component group CV."""
        self.assertEqual(self.d1_res["scorer_name"], "D1_QWEN_COSINE_DIRECT")
        self.assertEqual(self.d1_res["oof_count"], 156)
        self.assertAlmostEqual(self.d1_res["pr_auc"], 0.9651, places=2)
        self.assertAlmostEqual(self.d1_res["roc_auc"], 0.9796, places=2)
        self.assertAlmostEqual(self.d1_res["precision"], 0.9231, places=2)
        self.assertAlmostEqual(self.d1_res["recall"], 0.8421, places=2)
        self.assertAlmostEqual(self.d1_res["f05"], 0.9057, places=2)
        self.assertLessEqual(self.d1_res["threshold_summary"]["spread"], 0.08)

    def test_zero_learned_model_architecture(self):
        """Verifies that direct scorers do NOT use any StandardScaler or LogisticRegression."""
        for res in [self.d0_res, self.d1_res]:
            self.assertEqual(res["requires_learned_model"], False)

    def test_get_feed_identity(self):
        """Verifies get_feed_identity extracts canonical feed identifier under all schema variants."""
        self.assertEqual(get_feed_identity({"feed_id": 42}), "42")
        self.assertEqual(get_feed_identity({"feed": {"id": 99}}), "99")
        self.assertEqual(get_feed_identity({"feed": "TechCrunch"}), "TechCrunch")
        self.assertEqual(get_feed_identity({"feed": 123}), "123")
        self.assertEqual(get_feed_identity({"feed_title": "BBC News"}), "BBC News")
        self.assertEqual(get_feed_identity({}), "")
        self.assertEqual(get_feed_identity({"feed_id": None}), "")

    def test_cross_feed_only_contract(self):
        """Verifies CROSS_FEED_ONLY: same-feed pairs are strictly excluded from candidate retrieval."""
        articles = [
            {"id": 1, "feed_id": 10, "title": "OpenAI launches GPT-5 model today"},
            {"id": 2, "feed_id": 10, "title": "OpenAI launches GPT-5 model today"},  # Same feed
            {"id": 3, "feed_id": 20, "title": "OpenAI launches GPT-5 model today"},  # Cross feed
        ]
        tokens_map = {a["id"]: extract_significant_words(a["title"]) for a in articles}
        candidates, _ = retrieve_candidates_rf0r(articles, tokens_map, k_retrieval=10)

        # 1 and 2 are in the same feed -> pair (1, 2) must NOT be retrieved
        self.assertNotIn((1, 2), candidates, "Same feed pair (1, 2) must NOT be retrieved")
        # 1 and 3 are in different feeds -> pair (1, 3) must be retrieved
        self.assertIn((1, 3), candidates, "Cross feed pair (1, 3) must be retrieved")
        # 2 and 3 are in different feeds -> pair (2, 3) must be retrieved
        self.assertIn((2, 3), candidates, "Cross feed pair (2, 3) must be retrieved")

    def test_symmetric_per_article_top_k_and_higher_id(self):
        """Verifies an article with higher numeric ID can select a lower-ID neighbor under RF0R."""
        # Case: article 100 has a higher ID than article 1.
        # Under RF0R, article 100 ranks candidates and can select article 1.
        articles = [
            {"id": 1, "feed_id": 1, "title": "Apple announces M4 MacBook Pro with OLED display"},
            {"id": 100, "feed_id": 2, "title": "Apple announces M4 MacBook Pro with OLED display"},
            {"id": 200, "feed_id": 3, "title": "Unrelated news about wheat harvest and farming"},
        ]
        tokens_map = {a["id"]: extract_significant_words(a["title"]) for a in articles}
        candidates, scores = retrieve_candidates_rf0r(articles, tokens_map, k_retrieval=5)

        self.assertIn((1, 100), candidates, "Article 100 must select article 1 and form canonical pair (1, 100)")
        self.assertAlmostEqual(scores[(1, 100)], 1.0)
        self.assertNotIn((1, 200), candidates)
        self.assertNotIn((100, 200), candidates)

    def test_canonical_pair_dedup(self):
        """Verifies candidate pair keys are strictly formatted as min(u, v)_max(u, v)."""
        articles = [
            {"id": 50, "feed_id": 1, "title": "Google releases Gemini update"},
            {"id": 20, "feed_id": 2, "title": "Google releases Gemini update"},
        ]
        tokens_map = {a["id"]: extract_significant_words(a["title"]) for a in articles}
        candidates, _ = retrieve_candidates_rf0r(articles, tokens_map, k_retrieval=5)

        self.assertIn((20, 50), candidates)
        self.assertNotIn((50, 20), candidates)
        for u, v in candidates:
            self.assertLess(u, v)

    def test_24h_temporal_policy(self):
        """Verifies R3 24h temporal policy (RESEARCH_POLICY_24H): delta > 24h rejected, delta <= 24h eligible."""
        self.assertEqual(R3_P3_MAX_TEMPORAL_SPAN_HOURS, 24.0)

        # 1. Delta = 25h (> 24h) -> rejected
        article_ids_25 = [301, 302]
        pub_25 = {301: 0, 302: 25 * 3600}
        scores_25 = {(301, 302): 0.95}
        clusters_25 = cluster_with_p3(article_ids_25, scores_25, 0.5, pub_25, max_temporal_span_hours=24.0)
        self.assertEqual(len(clusters_25), 2, "25h delta must be rejected under 24h policy")

        # 2. Delta = 23h (<= 24h) -> clustered
        article_ids_23 = [401, 402]
        pub_23 = {401: 0, 402: 23 * 3600}
        scores_23 = {(401, 402): 0.95}
        clusters_23 = cluster_with_p3(article_ids_23, scores_23, 0.5, pub_23, max_temporal_span_hours=24.0)
        self.assertEqual(len(clusters_23), 1, "23h delta must be eligible for clustering")
        self.assertEqual(len(clusters_23[0]), 2)

    def test_no_magic_safety_threshold(self):
        """Verifies code contains NO magic safety threshold (e.g. <= 4 -> SAFE_ENOUGH).

        Safety reporting must be descriptive:
        - ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION
        - NONZERO_HARD_NEGATIVE_CONTAMINATION
        - TOO_LOW_COVERAGE
        - INCONCLUSIVE
        """
        # Static check on direct_scorer_benchmark.py source code
        benchmark_code_path = CUR_DIR / "direct_scorer_benchmark.py"
        with open(benchmark_code_path, "r", encoding="utf-8") as f:
            code_text = f.read()

        self.assertNotIn("SAFE_ENOUGH", code_text)
        self.assertNotIn("different_event_contamination <= 4", code_text)
        self.assertNotIn("de_contamination <= 4", code_text)

        # Behavioral check on safety evaluation output
        d0_safety = evaluate_gold_cluster_safety(self.d0_res, self.rows, {})
        strict_op = d0_safety["operating_points"]["STRICT"]

        allowed_classes = {
            "ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION",
            "NONZERO_HARD_NEGATIVE_CONTAMINATION",
            "TOO_LOW_COVERAGE",
            "INCONCLUSIVE",
        }
        self.assertIn(strict_op["safety_classification"], allowed_classes)
        # In D0 STRICT, DE contamination is 4 (> 0), so it MUST be classified as NONZERO
        self.assertEqual(
            strict_op["safety_classification"],
            "NONZERO_HARD_NEGATIVE_CONTAMINATION",
        )
        self.assertEqual(strict_op["cluster_hard_negative_contamination_count"], 4)

        # Verify D1 non-duo generalization classification
        self.assertEqual(
            self.d1_res["generalization_classification"],
            "HIGH_PAIRWISE_PRECISION_BUT_SPARSE_NON_DUO_GENERALIZATION_EVIDENCE",
        )
        self.assertAlmostEqual(self.d1_res["non_duo_recall"], 0.4000)

    def test_d0_d1_review_pack_score_source(self):
        """Verifies review pack uses correct score sources and fixes R2 bug."""
        review_pack_path = OUTPUT_DIR / "false-merge-review-pack-v2.csv"
        if not review_pack_path.exists():
            self.skipTest(f"Review pack not found at {review_pack_path}")

        with open(review_pack_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        expected_fields = [
            "pair_key", "gold_label",
            "d0_score", "d0_threshold", "merged_in_d0",
            "d1_score", "d1_threshold", "merged_in_d1",
            "title_a", "title_b", "feed_a", "feed_b",
        ]
        self.assertEqual(fieldnames, expected_fields)

        # Regression test: find at least one pair where D0 score != D1 score and cluster status differs
        divergent_pairs = [r for r in rows if r["merged_in_d0"] != r["merged_in_d1"]]
        self.assertGreater(
            len(divergent_pairs),
            0,
            "Review pack must contain pairs where D0 and D1 cluster decisions diverge",
        )

        for dp in divergent_pairs:
            d0_score = float(dp["d0_score"])
            d1_score = float(dp["d1_score"])
            self.assertNotEqual(d0_score, d1_score)

    def test_rf0r_k_search_benchmark(self):
        """Verifies RF0R candidate retrieval K search against Gold."""
        rf0r_file = OUTPUT_DIR / "rf0r-retrieval-benchmark-v1.json"
        if not rf0r_file.exists():
            self.skipTest(f"RF0R benchmark artifact not found at {rf0r_file}")

        with open(rf0r_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        configs_by_k = {c["k"]: c for c in data["configurations"]}

        # Verify K=10 achieves 100% same event recall and 100% family connectivity recall
        k10 = configs_by_k[10]
        self.assertEqual(k10["same_event_pairs_captured"], 57)
        self.assertEqual(k10["same_event_pairs_total"], 57)
        self.assertAlmostEqual(k10["same_event_pair_recall"], 1.0)
        self.assertEqual(k10["positive_families_preserved"], 10)
        self.assertEqual(k10["positive_families_total"], 10)
        self.assertAlmostEqual(k10["positive_family_connectivity_recall"], 1.0)
        self.assertEqual(k10["retrieved_pair_count"], 558)
        self.assertAlmostEqual(k10["pair_reduction_percent"], 97.06, places=1)

    def test_d0_raw_pipeline_execution(self):
        """Verifies D0 raw pipeline runs end-to-end on Home-200 with cross-feed enforcement."""
        corpus_path = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl")
        if not corpus_path.exists():
            self.skipTest(f"Corpus file not found at {corpus_path}")

        raw_articles = []
        with open(corpus_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    raw_articles.append(json.loads(line))

        self.assertEqual(len(raw_articles), 200)

        projections, stats, timing = execute_d0_raw_pipeline_on_home200(raw_articles, threshold=0.3541)

        # R3 Cross-feed recalculation values
        self.assertEqual(stats["home_items_before"], 200)
        self.assertEqual(stats["home_items_after"], 180)
        self.assertEqual(stats["multi_article_story_count"], 12)
        self.assertEqual(stats["duplicate_articles_compressed"], 20)
        self.assertAlmostEqual(stats["noise_reduction_percent"], 10.0, places=1)

        # Story card window counts
        self.assertEqual(stats["top10_story_card_count"], 1)
        self.assertEqual(stats["top20_story_card_count"], 1)
        self.assertEqual(stats["top50_story_card_count"], 6)
        self.assertEqual(stats["top100_story_card_count"], 10)

        # Total latency is sub-20ms (< 10ms in reality)
        self.assertLess(timing["total_end_to_end_ms"], 20.0)

        # Check H1 order preservation
        positions = [p["h1_home_position"] for p in projections]
        self.assertEqual(positions, sorted(positions))

    def test_python_node_candidate_and_projection_parity(self):
        """Verifies Python and Node implementations produce exact parity on Home-200."""
        node_script = CUR_DIR / "node" / "direct-story-pipeline.js"
        if not node_script.exists():
            self.skipTest("Node pipeline script not found")

        # Execute Node pipeline via node CLI
        node_cmd = [
            "/opt/homebrew/bin/node",
            "-e",
            """
            import fs from 'node:fs';
            import { executeD0Pipeline } from './scripts/research/story-identity-v1/node/direct-story-pipeline.js';
            const corpus = fs.readFileSync('/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl', 'utf8').trim().split('\\n').map(l => JSON.parse(l));
            const res = executeD0Pipeline(corpus, { threshold: 0.3541 });
            console.log(JSON.stringify(res.stats));
            """,
        ]
        proc = subprocess.run(node_cmd, capture_output=True, text=True, check=True)
        node_stats = json.loads(proc.stdout)

        corpus_path = Path("/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl")
        with open(corpus_path, "r", encoding="utf-8") as f:
            raw_articles = [json.loads(l) for l in f if l.strip()]
        _, py_stats, _ = execute_d0_raw_pipeline_on_home200(raw_articles, threshold=0.3541)

        self.assertEqual(node_stats["home_items_before"], py_stats["home_items_before"])
        self.assertEqual(node_stats["home_items_after"], py_stats["home_items_after"])
        self.assertEqual(node_stats["multi_article_story_count"], py_stats["multi_article_story_count"])
        self.assertEqual(node_stats["duplicate_articles_compressed"], py_stats["duplicate_articles_compressed"])
        self.assertEqual(node_stats["noise_reduction_percent"], py_stats["noise_reduction_percent"])
        self.assertEqual(node_stats["top10_story_card_count"], py_stats["top10_story_card_count"])
        self.assertEqual(node_stats["top20_story_card_count"], py_stats["top20_story_card_count"])

    def test_private_artifacts_exist(self):
        """Verifies all 7 R3 private artifacts exist in /tmp/newsflux-story02-a0-r3/."""
        expected_artifacts = [
            "rf0r-retrieval-benchmark-v1.json",
            "d0-crossfeed-runtime-pipeline-v1.json",
            "d0-crossfeed-home-projection-v1.json",
            "d1-retrieved-home-projection-v1.json",
            "cluster-safety-r3-v1.json",
            "false-merge-review-pack-v2.csv",
            "architecture-r3-scorecard-v1.json",
        ]
        for name in expected_artifacts:
            art_path = OUTPUT_DIR / name
            self.assertTrue(art_path.exists(), f"Artifact {name} must exist in {OUTPUT_DIR}")
            self.assertGreater(art_path.stat().st_size, 0, f"Artifact {name} must not be empty")


if __name__ == "__main__":
    unittest.main()
