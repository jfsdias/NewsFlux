import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from component_search import (
    dev_forward_capacity,
    generate_motifs,
    search_components,
    validate_witness,
)
from joint_search import SearchRules
from sampler import build_freeze_v2_artifacts, canonical_pair_key, verify_freeze_artifacts, write_private_artifacts
import test_sampler


def edge(a, b, bucket):
    return {
        "pair_key": canonical_pair_key(a, b), "article_a_id": a, "article_b_id": b,
        "feed_a_id": f"feed-{a}", "feed_b_id": f"feed-{b}",
        "category_a": str(a % 3), "category_b": str(b % 3),
        "primary_bucket": bucket, "best_rank": 1,
    }


def small_rules():
    return SearchRules(
        min_components=2, min_independent_pairs=1, min_multi_pair_components=1,
        min_chain_groups=1, max_component_pairs=8, max_component_articles=8,
        max_feed_share=1.0, max_source_pair_share=1.0, max_category_share=1.0,
    )


class ComponentSearchTests(unittest.TestCase):
    def synthetic_witness(self):
        result = test_sampler.TargetedGoldSamplerTests()._valid_v2_freeze_result()
        chain_keys = {key for group in result["chain_groups"] for key in group["pair_keys"]}
        for row in result["blind"]:
            if row["pair_key"] in chain_keys:
                row["best_rank"] = 1
        return result

    def test_motif_generation_preserves_connected_bucket_accounting(self):
        rows = [edge(1, 2, "x"), edge(2, 3, "y"), edge(3, 4, "x")]
        motifs, inventory = generate_motifs(rows, {"x": 2, "y": 1}, variants=3)
        self.assertEqual(inventory["singleton_motif_count"], 3)
        self.assertGreater(inventory["chain_seed_count"], 0)
        extended = [m for m in motifs if m["kind"] == "CHAIN_COMPONENT" and len(m["rows"]) == 3]
        self.assertTrue(extended)
        self.assertEqual(extended[0]["bucket_counts"], {"x": 2, "y": 1})
        self.assertEqual(len(extended[0]["article_ids"]), 4)

    def test_component_search_rejects_overlapping_motifs_and_finds_witness(self):
        blind = [edge(1, 2, "x"), edge(2, 3, "x"), edge(4, 5, "y"), edge(3, 6, "y")]
        dev = [edge(7, 8, "dev")]
        result = search_components(
            blind, dev, blind_quotas={"x": 2, "y": 1}, dev_quotas={"dev": 1},
            rules=small_rules(), node_limit=10000, restarts=1,
        )
        self.assertEqual(result["status"], "FEASIBLE_WITNESS_FOUND")
        self.assertEqual({r["pair_key"] for r in result["blind"]}, {"1:2", "2:3", "4:5"})
        validate_witness(result["blind"], result["dev"], blind_quotas={"x": 2, "y": 1},
                         dev_quotas={"dev": 1}, rules=small_rules())

    def test_dev_forward_capacity_rejects_blocked_bucket(self):
        dev = [edge(1, 8, "dev"), edge(2, 9, "dev")]
        self.assertFalse(dev_forward_capacity(dev, {1, 2}, {"dev": 1})["feasible"])
        self.assertTrue(dev_forward_capacity(dev, {10}, {"dev": 1})["feasible"])

    def test_infeasible_bounded_library_is_not_corpus_infeasibility(self):
        result = search_components(
            [edge(1, 2, "x")], [], blind_quotas={"x": 2}, dev_quotas={},
            rules=small_rules(), node_limit=100, restarts=1,
        )
        self.assertEqual(result["status"], "COMPONENT_SEARCH_LIMIT_REACHED")
        self.assertFalse(result["search_complete"])
        self.assertFalse(result["feasible_witness_found"])

    def test_greedy_trap_continues_after_blind_blocks_dev(self):
        blind = [edge(1, 2, "x"), edge(2, 3, "x"), edge(10, 11, "x"),
                 edge(11, 12, "x"), edge(20, 21, "y")]
        dev = [edge(1, 8, "dev")]
        result = search_components(
            blind, dev, blind_quotas={"x": 2, "y": 1}, dev_quotas={"dev": 1},
            rules=small_rules(), node_limit=10000, restarts=1,
        )
        self.assertEqual(result["status"], "FEASIBLE_WITNESS_FOUND")
        self.assertEqual({r["pair_key"] for r in result["blind"]}, {"10:11", "11:12", "20:21"})

    def test_search_prunes_blocking_dev_prefix_then_continues(self):
        blind = [edge(1, 2, "x"), edge(2, 3, "x"), edge(10, 11, "x"),
                 edge(11, 12, "x"), edge(20, 21, "y")]
        motifs, _ = generate_motifs(blind, {"x": 2, "y": 1})
        def vector(chain):
            selected = {tuple(sorted(chain)), ("20:21",)}
            return np.asarray([1.0 if motif["pair_keys"] in selected else 0.0 for motif in motifs])
        responses = [SimpleNamespace(x=vector(("1:2", "2:3")), mip_node_count=1),
                     SimpleNamespace(x=vector(("10:11", "11:12")), mip_node_count=1)]
        with patch("scipy.optimize.milp", side_effect=responses):
            result = search_components(
                blind, [edge(1, 8, "dev")], blind_quotas={"x": 2, "y": 1},
                dev_quotas={"dev": 1}, rules=small_rules(), node_limit=10000, restarts=1,
            )
        self.assertEqual(result["status"], "FEASIBLE_WITNESS_FOUND")
        self.assertEqual(result["certificate"]["prune_dev_capacity"], 1)

    def test_independent_validator_rejects_each_mutated_hard_constraint(self):
        valid = self.synthetic_witness()
        validate_witness(valid["blind"], valid["dev"])
        mutations = []
        quota = copy.deepcopy(valid); quota["blind"][0]["primary_bucket"] = "DIVERSITY_CONTROL"; mutations.append((quota, "BLIND_QUOTA_GATE"))
        overlap = copy.deepcopy(valid); overlap["dev"][0]["article_a_id"] = overlap["blind"][0]["article_a_id"]
        overlap["dev"][0]["pair_key"] = canonical_pair_key(overlap["dev"][0]["article_a_id"], overlap["dev"][0]["article_b_id"]); mutations.append((overlap, "ARTICLE_DISJOINT_GATE"))
        component = copy.deepcopy(valid); component["blind"][-1]["article_a_id"] = component["blind"][0]["article_a_id"]
        component["blind"][-1]["category_a"] = component["blind"][0]["category_a"]
        component["blind"][-1]["pair_key"] = canonical_pair_key(component["blind"][-1]["article_a_id"], component["blind"][-1]["article_b_id"]); mutations.append((component, "COMPONENT_SIZE_GATE"))
        source = copy.deepcopy(valid)
        for row in source["blind"]: row.update(feed_a_id="same-a", feed_b_id="same-b")
        mutations.append((source, "SOURCE_DIVERSITY_GATE"))
        chains = copy.deepcopy(valid)
        for row in chains["blind"]: row["best_rank"] = 5000
        mutations.append((chains, "CHAIN_GROUP_GATE"))
        for mutated, expected in mutations:
            with self.subTest(gate=expected):
                with self.assertRaisesRegex(ValueError, expected):
                    validate_witness(mutated["blind"], mutated["dev"])

    def test_valid_witness_freezes_without_global_optimality(self):
        result = self.synthetic_witness()
        validated = validate_witness(result["blind"], result["dev"])
        result["chain_groups"] = validated["chain_groups"]
        result["search"] = {
            "method": "COMPONENT_FIRST", "status": "FEASIBLE_WITNESS_FOUND",
            "search_complete": False, "node_limit": 10000,
            "global_optimality_required": False, "global_optimality_proven": False,
            "certificate": {
                "nodes_explored": 1, "nodes_pruned": 0,
                "prune_bucket_capacity": 0, "prune_component_requirement": 0,
                "prune_article_overlap": 0, "prune_source_cap": 0,
                "prune_category_cap": 0, "prune_dev_capacity": 0, "prune_other": 0,
            },
        }
        artifacts = build_freeze_v2_artifacts(result, input_shas={"gold": "a"})
        manifest = json.loads(artifacts["freeze-manifest-v2.json"])
        self.assertEqual(manifest["search_method"], "COMPONENT_FIRST")
        self.assertTrue(manifest["feasible_witness_found"])
        self.assertFalse(manifest["global_optimality_required"])
        self.assertFalse(manifest["global_optimality_proven"])
        self.assertEqual(manifest["independent_validator"], "PASS")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_private_artifacts(root / "v2", root / "repo", artifacts)
            self.assertTrue(verify_freeze_artifacts(root / "v2", freeze_manifest_name="freeze-manifest-v2.json"))


if __name__ == "__main__":
    unittest.main()
