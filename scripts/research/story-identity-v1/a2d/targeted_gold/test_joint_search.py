import sys
import unittest
from dataclasses import replace
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from joint_search import SearchRules, candidate_inventory, search_joint_packs
from run_design import freeze_result
from sampler import canonical_pair_key, chain_group_bridging_count, graph_component_stats


def edge(a, b, bucket):
    return {
        "pair_key": canonical_pair_key(a, b),
        "article_a_id": a,
        "article_b_id": b,
        "feed_a_id": f"feed-{a}",
        "feed_b_id": f"feed-{b}",
        "category_a": str(a % 3),
        "category_b": str(b % 3),
        "primary_bucket": bucket,
        "best_rank": 1,
    }


def rules(*, components=0, independent=0):
    return SearchRules(
        min_components=components,
        min_independent_pairs=independent,
        min_multi_pair_components=0,
        min_chain_groups=0,
        max_component_pairs=8,
        max_component_articles=8,
        max_feed_share=1.0,
        max_source_pair_share=1.0,
        max_category_share=1.0,
    )


class JointConstraintSearchTests(unittest.TestCase):
    def test_greedy_trap_exact_search_finds_alternative(self):
        positive_first = edge(1, 2, "positive")
        positive_alternative = edge(3, 4, "positive")
        negative = edge(1, 5, "negative")
        self.assertLess(
            graph_component_stats([positive_first, negative])["independent_pair_count"], 2
        )

        result = search_joint_packs(
            [positive_first, positive_alternative, negative], [],
            blind_quotas={"positive": 1, "negative": 1}, dev_quotas={},
            rules=rules(components=2, independent=2), node_limit=10000,
        )

        self.assertEqual(result["status"], "FEASIBLE")
        self.assertTrue(result["search_complete"])
        self.assertEqual(
            {row["pair_key"] for row in result["blind"]}, {"3:4", "1:5"}
        )

    def test_exhaustive_fixture_certifies_infeasibility(self):
        result = search_joint_packs(
            [edge(1, 2, "positive"), edge(1, 5, "negative")], [],
            blind_quotas={"positive": 1, "negative": 1}, dev_quotas={},
            rules=rules(components=2, independent=2), node_limit=10000,
        )

        self.assertEqual(result["status"], "PROVEN_INFEASIBLE")
        self.assertTrue(result["search_complete"])
        self.assertGreater(result["certificate"]["nodes_explored"], 0)

    def test_joint_search_rejects_blind_choice_that_blocks_dev(self):
        result = search_joint_packs(
            [edge(1, 2, "blind"), edge(3, 4, "blind")], [edge(1, 7, "dev")],
            blind_quotas={"blind": 1}, dev_quotas={"dev": 1},
            rules=rules(components=1, independent=1), node_limit=10000,
        )

        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual([row["pair_key"] for row in result["blind"]], ["3:4"])
        self.assertEqual([row["pair_key"] for row in result["dev"]], ["1:7"])
        self.assertGreater(result["certificate"]["prune_dev_infeasible"], 0)

    def test_node_limit_never_claims_infeasibility(self):
        result = search_joint_packs(
            [edge(1, 2, "positive"), edge(3, 4, "positive")], [],
            blind_quotas={"positive": 1}, dev_quotas={},
            rules=rules(components=1, independent=1), node_limit=1,
        )

        self.assertEqual(result["status"], "SEARCH_LIMIT_REACHED")
        self.assertFalse(result["search_complete"])

    def test_bounded_search_with_witness_does_not_claim_optimal_freeze(self):
        result = search_joint_packs(
            [edge(1, 2, "positive"), edge(3, 4, "positive")], [],
            blind_quotas={"positive": 1}, dev_quotas={},
            rules=rules(components=1, independent=1), node_limit=3,
        )
        self.assertTrue(result["feasible_witness_found"])
        self.assertEqual(result["status"], "SEARCH_LIMIT_REACHED")
        self.assertEqual(result["objective_optimality"], "NOT_PROVEN")

    def test_chains_are_chosen_from_separate_final_components(self):
        rows = [edge(1, 2, "x"), edge(2, 3, "x"), edge(4, 5, "x"),
                edge(5, 6, "x"), edge(3, 4, "x")]
        graph_rules = replace(rules(components=2), min_multi_pair_components=2, min_chain_groups=2)
        result = search_joint_packs(
            rows, [], blind_quotas={"x": 4}, dev_quotas={},
            rules=graph_rules, node_limit=10000,
        )
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["chain_groups"]), 2)
        self.assertEqual(chain_group_bridging_count(result["blind"], result["chain_groups"]), 0)
        self.assertNotIn("3:4", {row["pair_key"] for row in result["blind"]})

    def test_complete_search_maximizes_source_diversity_before_tiebreak(self):
        first, second, dev = edge(1, 2, "blind"), edge(3, 4, "blind"), edge(5, 6, "dev")
        first.update(feed_a_id="shared-a", feed_b_id="shared-b")
        dev.update(feed_a_id="shared-a", feed_b_id="shared-b")
        result = search_joint_packs(
            [first, second], [dev], blind_quotas={"blind": 1}, dev_quotas={"dev": 1},
            rules=rules(components=1, independent=1), node_limit=10000,
        )
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertTrue(result["search_complete"])
        self.assertEqual([row["pair_key"] for row in result["blind"]], ["3:4"])

    def test_gold_pair_and_blind_gold_article_exclusions(self):
        result = search_joint_packs(
            [edge(1, 2, "blind"), edge(3, 4, "blind")],
            [edge(7, 8, "dev"), edge(9, 10, "dev")],
            blind_quotas={"blind": 1}, dev_quotas={"dev": 1},
            gold_article_ids={1}, gold_pair_keys={"7:8"},
            rules=rules(components=1, independent=1), node_limit=10000,
        )
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual([row["pair_key"] for row in result["blind"]], ["3:4"])
        self.assertEqual([row["pair_key"] for row in result["dev"]], ["9:10"])

    def test_small_graphs_match_exhaustive_independent_oracle(self):
        fixtures = [
            [edge(1, 2, "x"), edge(2, 3, "x"), edge(4, 5, "x")],
            [edge(1, 2, "x"), edge(2, 3, "x"), edge(3, 4, "x")],
            [edge(1, 2, "x"), edge(3, 4, "x"), edge(5, 6, "x")],
        ]
        for rows in fixtures:
            with self.subTest(keys=[row["pair_key"] for row in rows]):
                exists = any(
                    graph_component_stats(pair)["independent_pair_count"] >= 2
                    for pair in combinations(rows, 2)
                )
                result = search_joint_packs(
                    rows, [], blind_quotas={"x": 2}, dev_quotas={},
                    rules=rules(components=2, independent=2), node_limit=10000,
                )
                self.assertTrue(result["search_complete"])
                self.assertEqual(result["status"] == "FEASIBLE", exists)

    def test_inventory_counts_capacity_and_chain_composition(self):
        rows = [edge(1, 2, "x"), edge(2, 3, "y"), edge(4, 5, "x")]
        inventory = candidate_inventory(rows, {"x": 2, "y": 1})
        self.assertEqual(inventory["blind_pool_pair_count"], 3)
        self.assertEqual(inventory["bucket_capacity"]["x"]["unique_article_count"], 4)
        self.assertEqual(inventory["chain_candidate_count"], 1)
        self.assertEqual(inventory["chain_bucket_composition_histogram"], {"x + y": 1})
        self.assertEqual(inventory["raw_bucket_capacity_gate"], "PASS")
        self.assertEqual(candidate_inventory(rows, {"x": 3})["raw_bucket_capacity_gate"], "FAIL")

    def test_source_pair_cap_and_category_gate_are_enforced(self):
        first, second, alternative = edge(1, 2, "x"), edge(3, 4, "x"), edge(5, 6, "x")
        first.update(feed_a_id="same-a", feed_b_id="same-b", category_a="one", category_b="one")
        second.update(feed_a_id="same-a", feed_b_id="same-b", category_a="one", category_b="one")
        alternative.update(category_a="two", category_b="two")
        constrained = replace(rules(components=2, independent=2), max_source_pair_share=0.5, max_category_share=0.5)
        result = search_joint_packs(
            [first, second, alternative], [], blind_quotas={"x": 2}, dev_quotas={},
            rules=constrained, node_limit=10000,
        )
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertIn("5:6", {row["pair_key"] for row in result["blind"]})
        self.assertGreater(result["certificate"]["prune_source_cap"], 0)

    def test_category_dominance_is_checked_independently_of_source_caps(self):
        first, second, alternative = edge(1, 2, "x"), edge(3, 4, "x"), edge(5, 6, "x")
        first.update(category_a="one", category_b="one")
        second.update(category_a="one", category_b="one")
        alternative.update(category_a="two", category_b="two")
        constrained = replace(rules(components=2, independent=2), max_category_share=0.5)
        result = search_joint_packs(
            [first, second, alternative], [], blind_quotas={"x": 2}, dev_quotas={},
            rules=constrained, node_limit=10000,
        )
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertIn("5:6", {row["pair_key"] for row in result["blind"]})
        self.assertGreater(result["certificate"]["prune_other"], 0)

    def test_freeze_rejects_limited_search_even_with_witness(self):
        with self.assertRaisesRegex(ValueError, "PACK_FREEZE_V2=NO"):
            freeze_result({"search": {"status": "SEARCH_LIMIT_REACHED", "search_complete": False}, "r1": {}})


if __name__ == "__main__":
    unittest.main()
