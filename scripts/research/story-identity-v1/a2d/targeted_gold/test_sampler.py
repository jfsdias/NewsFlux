import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from sampler import (
    HUMAN_REVIEW_COLUMNS,
    assert_private_output_path,
    assert_distinct_private_freeze_path,
    assert_challenge_consumable,
    build_dataset_artifacts,
    build_freeze_v2_artifacts,
    build_review_pack,
    component_aware_can_add,
    graph_component_stats,
    canonical_pair_key,
    classify_candidate,
    compute_feature_thresholds,
    filter_gold_pairs,
    select_chain_groups,
    select_joint_packs,
    serialize_csv,
    write_private_artifacts,
    load_gold_exclusions,
    next_challenge_state,
    pack_stats,
    validate_chain_group_isolation,
    validate_blind_component_diversity,
    validate_dataset_isolation,
    validate_reviewer_blinding,
    validate_source_diversity,
    verify_freeze_artifacts,
    verify_sha,
)


def candidate(a, b, *, q=0.25, lexical=0.0, rank=5000, feed_a=None, feed_b=None):
    return {
        "pair_key": canonical_pair_key(a, b),
        "article_a_id": a,
        "article_b_id": b,
        "feed_a_id": feed_a if feed_a is not None else f"F{a % 4}",
        "feed_b_id": feed_b if feed_b is not None else f"F{b % 4}",
        "feed_a": f"Feed {a % 4}",
        "feed_b": f"Feed {b % 4}",
        "category_a": str(a % 3),
        "category_b": str(b % 3),
        "title_a": f"Synthetic title {a}",
        "title_b": f"Synthetic title {b}",
        "published_at_a": "2026-10-01T10:00:00Z",
        "published_at_b": "2026-10-01T11:00:00Z",
        "qwen_score": q,
        "lexical_overlap": lexical,
        "temporal_delta_hours": 1.0,
        "entity_anchor_overlap": 0.0,
        "number_overlap": 0.0,
        "date_overlap": 0.0,
        "candidate_a": False,
        "candidate_b": False,
        "candidate_c": False,
        "best_rank": rank,
    }


class TargetedGoldSamplerTests(unittest.TestCase):
    def _six_chain_seed_fixture(self):
        rows = []
        groups = []
        chain_group_by_article = {}
        for index in range(6):
            first = 100 + index * 10
            middle = first + 1
            last = first + 2
            group_rows = [candidate(first, middle), candidate(middle, last)]
            rows.extend(group_rows)
            groups.append({
                "article_ids": [first, middle, last],
                "pair_keys": [row["pair_key"] for row in group_rows],
                "structure_type": "CHAIN",
            })
            chain_group_by_article.update({first: index, middle: index, last: index})
        return rows, groups, chain_group_by_article

    def _valid_v2_freeze_result(self):
        def quota_buckets(quotas):
            return [bucket for bucket, count in quotas.items() for _ in range(count)]

        dev = []
        for index, bucket in enumerate(quota_buckets({
            "POSITIVE_SEEKING": 28,
            "HARD_NEGATIVE_SEEKING": 28,
            "BOUNDARY_DISAGREEMENT": 16,
            "DIVERSITY_CONTROL": 8,
        })):
            row = candidate(100000 + index * 2, 100001 + index * 2)
            row.update({
                "feed_a_id": f"DEV_A_{index}",
                "feed_b_id": f"DEV_B_{index}",
                "category_a": str((index * 2) % 5),
                "category_b": str((index * 2 + 1) % 5),
                "primary_bucket": bucket,
                "mining_strata": ["S10_DIVERSITY_CONTROL"],
            })
            dev.append(row)

        blind = []
        groups = []
        extra_edges_per_group = (5, 5, 5, 5, 4, 4)
        for index, extra_count in enumerate(extra_edges_per_group):
            first = 1000 + index * 100
            middle, last = first + 1, first + 2
            group_rows = [candidate(first, middle), candidate(middle, last)]
            blind.extend(group_rows)
            groups.append({
                "article_ids": [first, middle, last],
                "pair_keys": [row["pair_key"] for row in group_rows],
                "structure_type": "CHAIN",
            })
            for _ in range(extra_count):
                blind.append(candidate(last, last + 1))
                last += 1
        for index in range(8):
            blind.append(candidate(5000 + index * 2, 5001 + index * 2))

        buckets = quota_buckets({
            "POSITIVE_SEEKING": 16,
            "HARD_NEGATIVE_SEEKING": 16,
            "BOUNDARY_DISAGREEMENT": 8,
            "DIVERSITY_CONTROL": 8,
        })
        for index, (row, bucket) in enumerate(zip(blind, buckets)):
            row.update({
                "feed_a_id": f"BLIND_A_{index}",
                "feed_b_id": f"BLIND_B_{index}",
                "category_a": str(int(row["article_a_id"]) % 5),
                "category_b": str(int(row["article_b_id"]) % 5),
                "primary_bucket": bucket,
                "mining_strata": ["S10_DIVERSITY_CONTROL"],
            })

        return {
            "feasible": True,
            "exact_quotas_feasible": True,
            "dev": dev,
            "blind": blind,
            "chain_groups": groups,
            "gold_article_ids": set(),
            "gold_pair_keys": set(),
        }

    def test_blind_min_connected_components_gate(self):
        rows, groups, _ = self._six_chain_seed_fixture()
        self.assertEqual(graph_component_stats(rows)["connected_component_count"], 6)
        with self.assertRaisesRegex(ValueError, "BLIND_MIN_CONNECTED_COMPONENTS_GATE"):
            validate_blind_component_diversity(rows, groups)

    def test_blind_min_independent_pairs_gate(self):
        rows, groups, _ = self._six_chain_seed_fixture()
        for index in range(7):
            rows.append(candidate(1000 + index * 2, 1001 + index * 2))
        with self.assertRaisesRegex(ValueError, "BLIND_MIN_INDEPENDENT_PAIRS_GATE"):
            validate_blind_component_diversity(rows, groups)

    def test_blind_min_multi_pair_components_gate(self):
        rows, groups, _ = self._six_chain_seed_fixture()
        with self.assertRaisesRegex(ValueError, "BLIND_MIN_MULTI_PAIR_COMPONENTS_GATE"):
            validate_blind_component_diversity(
                rows[:10] + [candidate(1000 + index * 2, 1001 + index * 2) for index in range(8)],
                groups[:5],
            )

    def test_blind_max_component_pairs_gate(self):
        rows = [candidate(index, index + 1) for index in range(1, 10)]
        with self.assertRaisesRegex(ValueError, "BLIND_MAX_COMPONENT_PAIRS_GATE"):
            validate_blind_component_diversity(
                rows, [], min_connected_components=0, min_independent_pairs=0,
                min_multi_pair_components=0,
            )

    def test_blind_max_component_articles_gate(self):
        rows = [candidate(1, index) for index in range(2, 10)]
        with self.assertRaisesRegex(ValueError, "BLIND_MAX_COMPONENT_ARTICLES_GATE"):
            validate_blind_component_diversity(
                rows, [], min_connected_components=0, min_independent_pairs=0,
                min_multi_pair_components=0,
            )

    def test_chain_group_bridging_gate(self):
        rows, groups, _ = self._six_chain_seed_fixture()
        rows.append(candidate(102, 110))
        with self.assertRaisesRegex(ValueError, "CHAIN_GROUP_BRIDGING_GATE"):
            validate_blind_component_diversity(
                rows, groups, min_connected_components=0, min_independent_pairs=0,
                min_multi_pair_components=0,
            )

    def test_designated_chain_groups_must_be_vertex_disjoint(self):
        rows, groups, _ = self._six_chain_seed_fixture()
        overlapping_groups = [groups[0], {**groups[1], "article_ids": [groups[0]["article_ids"][0], *groups[1]["article_ids"][1:]]}]
        with self.assertRaisesRegex(ValueError, "CHAIN_GROUP_VERTEX_DISJOINT_GATE"):
            validate_blind_component_diversity(
                rows, overlapping_groups, min_connected_components=0,
                min_independent_pairs=0, min_multi_pair_components=0,
                min_chain_groups=0,
            )

    def test_chain_fill_bridge_rejection_gate(self):
        rows, groups, chain_group_by_article = self._six_chain_seed_fixture()
        bridge_candidates = [candidate(102 + index * 10, 110 + index * 10) for index in range(5)]
        naive = rows + bridge_candidates
        self.assertEqual(graph_component_stats(naive)["connected_component_count"], 1)
        selected = list(rows)
        rejected = 0
        for bridge in bridge_candidates:
            if component_aware_can_add(bridge, selected, chain_group_by_article=chain_group_by_article):
                selected.append(bridge)
            else:
                rejected += 1
        stats = graph_component_stats(selected)
        self.assertGreater(rejected, 0)
        self.assertEqual(stats["connected_component_count"], 6)
        self.assertEqual(validate_blind_component_diversity(
            selected + [candidate(2000 + index * 2, 2001 + index * 2) for index in range(8)],
            groups,
        )["chain_group_bridging_count"], 0)

    def test_joint_selector_reserves_independent_pairs_and_rejects_chain_bridges(self):
        rows, _, _ = self._six_chain_seed_fixture()
        for index, row in enumerate(rows, start=1):
            row["primary_bucket"] = "DIVERSITY_CONTROL"
            row["best_rank"] = index
        groups, _, _ = self._six_chain_seed_fixture()
        for group_index in range(6):
            last = 102 + group_index * 10
            rows.append(candidate(last, last + 10, rank=5000))
            rows.append(candidate(last, last + 1, rank=5000))
        for group_index in range(5):
            first = 100 + group_index * 10
            rows.append(candidate(first + 2, first + 10, rank=5000))
        for index in range(8):
            rows.append(candidate(5000 + index * 2, 5001 + index * 2, rank=5000))
        for row in rows:
            row["primary_bucket"] = "DIVERSITY_CONTROL"

        result = select_joint_packs(
            rows,
            gold_pair_keys=set(),
            gold_article_ids=set(),
            seed=20261026,
            dev_target=0,
            blind_target=26,
            dev_min=0,
            blind_min=26,
            dev_quotas={"DIVERSITY_CONTROL": 0},
            blind_quotas={"DIVERSITY_CONTROL": 26},
            chain_group_target=6,
            reserve_independent_blind_pairs=8,
            enforce_blind_component_diversity=True,
            require_exact_quotas=True,
        )

        self.assertTrue(result["feasible"], result["reason"])
        self.assertEqual(len(result["blind"]), 26)
        stats = validate_blind_component_diversity(result["blind"], result["chain_groups"])
        self.assertGreaterEqual(stats["independent_pair_count"], 8)
        self.assertEqual(stats["chain_group_bridging_count"], 0)
        selected_keys = {row["pair_key"] for row in result["blind"]}
        self.assertTrue(all(
            canonical_pair_key(102 + index * 10, 110 + index * 10) not in selected_keys
            for index in range(5)
        ))

    def test_frozen_v1_preservation_uses_distinct_v2_location(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            v1 = root / "story02-a2d2-v1"
            v2 = root / "story02-a2d2-v2"
            v1.mkdir()
            freeze_path = v1 / "freeze-manifest-v1.json"
            freeze_path.write_bytes(b"immutable-v1-freeze")
            before = freeze_path.read_bytes()
            self.assertTrue(assert_distinct_private_freeze_path(v2, v1))
            self.assertTrue(assert_private_output_path(v2, repo))
            with self.assertRaisesRegex(ValueError, "V1_FREEZE_PATH_PROTECTED"):
                assert_distinct_private_freeze_path(v1, v1)
            self.assertEqual(freeze_path.read_bytes(), before)

    def test_v2_freeze_is_deterministic_and_preserves_v1_artifacts(self):
        result = self._valid_v2_freeze_result()
        first = build_freeze_v2_artifacts(result, input_shas={"gold": "a"})
        second = build_freeze_v2_artifacts(result, input_shas={"gold": "a"})
        self.assertEqual(first, second)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            v1 = root / "story02-a2d2"
            v2 = root / "story02-a2d2-v2"
            v1.mkdir()
            v1_freeze = v1 / "freeze-manifest-v1.json"
            v1_freeze.write_bytes(b"frozen-v1")
            before = v1_freeze.read_bytes()
            write_private_artifacts(v2, root / "repo", first)
            self.assertTrue(verify_freeze_artifacts(v2, freeze_manifest_name="freeze-manifest-v2.json"))
            manifest = json.loads((v2 / "freeze-manifest-v2.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["supersedes_freeze_sha256"], "1a263efa48392146c24c44069fd2f31ce8fcd70ddbae833e0d6f07f0e85b7c6b")
            self.assertEqual(manifest["human_labels_at_supersession"], 0)
            self.assertEqual(v1_freeze.read_bytes(), before)

    def test_v2_freeze_rechecks_exact_bucket_quotas(self):
        result = self._valid_v2_freeze_result()
        result["blind"].pop()
        with self.assertRaisesRegex(ValueError, "EXACT_QUOTA_GATE=FAIL"):
            build_freeze_v2_artifacts(result, input_shas={"gold": "a"})

    def test_v2_freeze_refuses_infeasible_result(self):
        with self.assertRaisesRegex(ValueError, "PACK_FREEZE_V2=NO"):
            build_freeze_v2_artifacts({"feasible": False, "exact_quotas_feasible": False}, input_shas={})

    def test_pair_key_is_canonical_and_rejects_self_pairs(self):
        self.assertEqual(canonical_pair_key(9, 3), "3:9")
        with self.assertRaisesRegex(ValueError, "SELF_PAIR"):
            canonical_pair_key(3, 3)

    def test_gold_pair_exclusion_uses_canonical_pair_keys(self):
        rows = [candidate(1, 2), candidate(3, 4)]
        retained = filter_gold_pairs(rows, {"2:1"})
        self.assertEqual([row["pair_key"] for row in retained], ["3:4"])

    def test_gold_pair_reader_projects_only_pair_identity_columns(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "gold.csv"
            path.write_text(
                "pair_key,entry_a_id,entry_b_id,auxiliary\n2:1,1,2,UNUSED\n",
                encoding="utf-8",
            )
            pair_keys, article_ids = load_gold_exclusions(path)
        self.assertEqual(pair_keys, {"1:2"})
        self.assertEqual(article_ids, {1, 2})

    def test_feature_thresholds_are_deterministic_and_label_free(self):
        rows = [candidate(1, 2, q=0.2), candidate(3, 4, q=0.4), candidate(5, 6, q=0.8)]
        first = compute_feature_thresholds(rows)
        second = compute_feature_thresholds(list(reversed(rows)))
        self.assertEqual(first, second)
        self.assertNotIn("gold_label", first)

    def test_classification_uses_feature_regions_without_assigning_labels(self):
        thresholds = {"qwen_q50": 0.25, "qwen_q75": 0.35, "qwen_q90": 0.50, "lexical_positive": 0.05}
        row = candidate(1, 2, q=0.75, lexical=0.0)
        row["candidate_a"] = True
        result = classify_candidate(row, thresholds)
        self.assertEqual(result["primary_bucket"], "POSITIVE_SEEKING")
        self.assertIn("S3_HIGH_SEMANTIC_LOW_LEXICAL", result["mining_strata"])
        self.assertNotIn("label", result)

    def test_chain_groups_are_pair_and_article_disjoint(self):
        rows = [
            candidate(1, 2, rank=1), candidate(2, 3, rank=2), candidate(1, 3, rank=3),
            candidate(4, 5, rank=4), candidate(5, 6, rank=5), candidate(4, 6, rank=6),
        ]
        groups = select_chain_groups(rows, rank_ceiling=10, required_groups=2, seed=20261026)
        self.assertEqual(len(groups), 2)
        first_articles = set(groups[0]["article_ids"])
        second_articles = set(groups[1]["article_ids"])
        self.assertFalse(first_articles & second_articles)
        self.assertEqual(len(set(groups[0]["pair_keys"])), len(groups[0]["pair_keys"]))

    def test_joint_selection_keeps_dev_blind_and_gold_exclusions(self):
        rows = [
            candidate(1, 2, q=0.8, rank=1), candidate(2, 3, q=0.8, rank=2), candidate(1, 3, q=0.8, rank=3),
            candidate(4, 5, q=0.8, rank=4), candidate(5, 6, q=0.8, rank=5), candidate(4, 6, q=0.8, rank=6),
            candidate(7, 8, q=0.2, rank=100), candidate(8, 9, q=0.2, rank=101),
            candidate(10, 11, q=0.2, rank=102), candidate(11, 12, q=0.2, rank=103),
        ]
        for row in rows[:6]:
            row["primary_bucket"] = "DIVERSITY_CONTROL"
        for row in rows[6:]:
            row["primary_bucket"] = "POSITIVE_SEEKING"
        result = select_joint_packs(
            rows,
            gold_pair_keys={"12:13"},
            gold_article_ids={1, 2, 3, 4, 5, 6},
            seed=20261026,
            dev_target=2,
            blind_target=2,
            dev_min=2,
            blind_min=2,
            dev_quotas={"DIVERSITY_CONTROL": 2},
            blind_quotas={"POSITIVE_SEEKING": 2},
            chain_group_target=0,
        )
        dev = result["dev"]
        blind = result["blind"]
        validate_dataset_isolation(dev, blind, {1, 2, 3, 4, 5, 6}, {"12:13"})
        self.assertEqual(len(dev), 2)
        self.assertEqual(len(blind), 2)
        self.assertFalse({x for row in dev for x in (row["article_a_id"], row["article_b_id"])} &
                         {x for row in blind for x in (row["article_a_id"], row["article_b_id"])})

    def test_selection_respects_p3_24_hour_temporal_ceiling(self):
        rows = [candidate(1, 2), candidate(3, 4)]
        rows[0]["temporal_delta_hours"] = 24.01
        rows[0]["primary_bucket"] = "POSITIVE_SEEKING"
        rows[1]["primary_bucket"] = "POSITIVE_SEEKING"
        result = select_joint_packs(
            rows, gold_pair_keys=set(), gold_article_ids=set(), seed=1,
            dev_target=1, blind_target=1, dev_min=0, blind_min=0,
            dev_quotas={"POSITIVE_SEEKING": 1},
            blind_quotas={"POSITIVE_SEEKING": 1}, chain_group_target=0,
        )
        selected_keys = {row["pair_key"] for row in result["dev"] + result["blind"]}
        self.assertNotIn("1:2", selected_keys)
        self.assertEqual(result["eligible_non_gold_pair_count"], 2)
        self.assertEqual(result["eligible_within_p3_24h_count"], 1)

    def test_reviewer_projection_is_blinded_and_byte_deterministic(self):
        rows = [candidate(2, 1, q=0.8, lexical=0.1)]
        rows[0].update({"dataset": "BLIND_CHALLENGE", "model_score": 0.8, "sampling_stratum": "S1", "predicted_label": "SAME_EVENT"})
        pack_a = build_review_pack(rows, seed=20261026, dataset_salt="blind")
        pack_b = build_review_pack(rows, seed=20261026, dataset_salt="blind")
        self.assertEqual(serialize_csv(pack_a), serialize_csv(pack_b))
        self.assertEqual(set(pack_a[0]), set(HUMAN_REVIEW_COLUMNS))
        forbidden = {"dataset", "model_score", "sampling_stratum", "predicted_label", "qwen_score", "url"}
        self.assertFalse(forbidden & set(pack_a[0]))
        self.assertEqual(pack_a[0]["human_decision"], "")
        self.assertTrue(validate_reviewer_blinding(pack_a))

    def test_reviewer_blinding_rejects_mining_metadata(self):
        with self.assertRaisesRegex(ValueError, "HUMAN_VIEW_MINING_METADATA_BLINDING"):
            validate_reviewer_blinding([{"pair_key": "1:2", "qwen_score": 0.9}])

    def test_targeted_pack_artifacts_are_byte_deterministic(self):
        rows = [candidate(1, 2), candidate(3, 4)]
        for row in rows:
            row.update({"primary_bucket": "DIVERSITY_CONTROL", "mining_strata": ["S10_DIVERSITY_CONTROL"]})
        first = build_dataset_artifacts(rows, dataset="DEV_AUGMENT", seed=42, input_shas={"gold": "a"}, groups=[])
        second = build_dataset_artifacts(list(reversed(rows)), dataset="DEV_AUGMENT", seed=42, input_shas={"gold": "a"}, groups=[])
        self.assertEqual(first, second)
        self.assertNotIn(b"DEV_AUGMENT", first["pack"])
        self.assertIn(b"human_label_file_present", first["manifest"])

    def test_challenge_cannot_be_consumed_before_final_evaluation(self):
        self.assertEqual(next_challenge_state("SELECTED", "freeze"), "FROZEN")
        self.assertEqual(next_challenge_state("FROZEN", "seal_annotations"), "ANNOTATED_SEALED")
        with self.assertRaisesRegex(ValueError, "TARGETED_GOLD_NO_TUNING_EVAL_REUSE"):
            assert_challenge_consumable("ANNOTATED_SEALED")
        self.assertTrue(assert_challenge_consumable("OPENED_FOR_FINAL_EVALUATION"))

    def test_pack_stats_reports_temporal_and_category_aggregates(self):
        rows = [candidate(1, 2), candidate(2, 3)]
        rows[0].update({"category_a": "A", "category_b": "A", "temporal_bucket": "0_1H", "primary_bucket": "DIVERSITY_CONTROL"})
        rows[1].update({"category_a": "A", "category_b": "B", "temporal_bucket": "1_4H", "primary_bucket": "HARD_NEGATIVE_SEEKING"})
        stats = pack_stats(rows)
        self.assertEqual(stats["pair_count"], 2)
        self.assertEqual(stats["temporal_band_counts"], {"0_1H": 1, "1_4H": 1})
        self.assertEqual(stats["category_article_counts"], {"A": 2, "B": 1})

    def test_chain_groups_are_vertex_disjoint_and_can_be_complete(self):
        rows = [
            candidate(1, 2, rank=1), candidate(2, 3, rank=2), candidate(1, 3, rank=3),
            candidate(4, 5, rank=4), candidate(5, 6, rank=5), candidate(4, 6, rank=6),
        ]
        groups = select_chain_groups(rows, rank_ceiling=10, required_groups=2, seed=20261026)
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(group["structure_type"] == "CHAIN" for group in groups))
        self.assertTrue(all(len(group["pair_keys"]) == 2 for group in groups))

    def test_joint_selection_and_review_order_are_deterministic(self):
        rows = []
        for index, bucket in enumerate(("POSITIVE_SEEKING", "HARD_NEGATIVE_SEEKING", "BOUNDARY_DISAGREEMENT", "DIVERSITY_CONTROL"), 1):
            for offset in range(3):
                row = candidate(index * 10 + offset * 2, index * 10 + offset * 2 + 1)
                row["primary_bucket"] = bucket
                rows.append(row)
        kwargs = dict(gold_pair_keys=set(), gold_article_ids=set(), seed=20261026,
                      dev_target=2, blind_target=2, dev_min=2, blind_min=2,
                      dev_quotas={"DIVERSITY_CONTROL": 2},
                      blind_quotas={"POSITIVE_SEEKING": 2}, chain_group_target=0)
        first = select_joint_packs(rows, **kwargs)
        second = select_joint_packs(list(reversed(rows)), **kwargs)
        self.assertEqual([r["pair_key"] for r in first["dev"]], [r["pair_key"] for r in second["dev"]])
        self.assertEqual([r["pair_key"] for r in first["blind"]], [r["pair_key"] for r in second["blind"]])
        self.assertEqual(serialize_csv(build_review_pack(first["blind"], seed=20261026, dataset_salt="BLIND")),
                         serialize_csv(build_review_pack(second["blind"], seed=20261026, dataset_salt="BLIND")))

    def test_freeze_verifier_rejects_modified_private_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "dev").mkdir()
            (root / "blind").mkdir()
            artifact_paths = {
                "dev/annotation-pack-v1.csv": "dev_pack_sha256",
                "dev/audit-sidecar-v1.json": "dev_sidecar_sha256",
                "dev/selection-manifest-v1.json": "dev_manifest_sha256",
                "blind/annotation-pack-v1.csv": "blind_pack_sha256",
                "blind/audit-sidecar-v1.json": "blind_sidecar_sha256",
                "blind/selection-manifest-v1.json": "blind_manifest_sha256",
            }
            import hashlib
            freeze = {field: "" for field in artifact_paths.values()}
            freeze.update({"dev_blind_pair_overlap": 0, "dev_blind_article_overlap": 0,
                           "blind_gold_v2_article_overlap": 0, "blind_state": "FROZEN"})
            for relative, field in artifact_paths.items():
                path = root / relative
                content = (
                    (",".join(HUMAN_REVIEW_COLUMNS) + "\n").encode()
                    if relative.endswith("annotation-pack-v1.csv")
                    else b"[]\n"
                )
                path.write_bytes(content)
                freeze[field] = hashlib.sha256(content).hexdigest()
            (root / "freeze-manifest-v1.json").write_text(json.dumps(freeze), encoding="utf-8")
            self.assertTrue(verify_freeze_artifacts(root))
            (root / "blind/annotation-pack-v1.csv").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "FREEZE_SHA_GATE"):
                verify_freeze_artifacts(root)

    def test_frozen_input_hash_gate_passes_exact_and_rejects_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "input"
            path.write_bytes(b"frozen")
            expected = hashlib.sha256(b"frozen").hexdigest()
            self.assertTrue(verify_sha(path, expected, "INPUT_SHA_GATE"))
            with self.assertRaisesRegex(ValueError, "INPUT_SHA_GATE=FAIL"):
                verify_sha(path, "0" * 64, "INPUT_SHA_GATE")

    def test_private_writer_is_idempotent_and_never_replaces_frozen_pack(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "private"
            repo = Path(temporary) / "repo"
            pack = (",".join(HUMAN_REVIEW_COLUMNS) + "\n").encode()
            json_bytes = b"[]\n"
            artifacts = {
                "dev/annotation-pack-v1.csv": pack,
                "dev/audit-sidecar-v1.json": json_bytes,
                "dev/selection-manifest-v1.json": json_bytes,
                "blind/annotation-pack-v1.csv": pack,
                "blind/audit-sidecar-v1.json": json_bytes,
                "blind/selection-manifest-v1.json": json_bytes,
            }
            hashes = {
                "dev_pack_sha256": hashlib.sha256(pack).hexdigest(),
                "dev_sidecar_sha256": hashlib.sha256(json_bytes).hexdigest(),
                "dev_manifest_sha256": hashlib.sha256(json_bytes).hexdigest(),
                "blind_pack_sha256": hashlib.sha256(pack).hexdigest(),
                "blind_sidecar_sha256": hashlib.sha256(json_bytes).hexdigest(),
                "blind_manifest_sha256": hashlib.sha256(json_bytes).hexdigest(),
            }
            freeze = {**hashes, "dev_blind_pair_overlap": 0, "dev_blind_article_overlap": 0,
                      "blind_gold_v2_article_overlap": 0, "blind_state": "FROZEN"}
            artifacts["freeze-manifest-v1.json"] = json.dumps(freeze).encode()
            first = write_private_artifacts(root, repo, artifacts)
            second = write_private_artifacts(root, repo, artifacts)
            self.assertEqual(first, second)
            frozen_pack = (root / "blind/annotation-pack-v1.csv").read_bytes()
            changed = dict(artifacts)
            changed["blind/annotation-pack-v1.csv"] = pack + b"changed\n"
            with self.assertRaisesRegex(ValueError, "PRIVATE_OUTPUT_EXISTS_MISMATCH"):
                write_private_artifacts(root, repo, changed)
            self.assertEqual((root / "blind/annotation-pack-v1.csv").read_bytes(), frozen_pack)

    def test_isolation_gate_rejects_article_pair_and_gold_overlap(self):
        dev = [candidate(1, 2)]
        blind = [candidate(2, 3)]
        with self.assertRaisesRegex(ValueError, "ARTICLE_DISJOINT"):
            validate_dataset_isolation(dev, blind, set(), set())
        with self.assertRaisesRegex(ValueError, "GOLD_PAIR_OVERLAP"):
            validate_dataset_isolation([candidate(1, 2)], [], set(), {"2:1"})

    def test_blind_gold_article_disjointness_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "BLIND_GOLD_ARTICLE_OVERLAP"):
            validate_dataset_isolation([], [candidate(1, 2)], {1}, set())

    def test_source_diversity_gate_enforces_feed_and_source_pair_caps(self):
        balanced = [candidate(i * 2, i * 2 + 1, feed_a=f"A{i}", feed_b=f"B{i}") for i in range(10)]
        self.assertTrue(validate_source_diversity(balanced))
        concentrated = [candidate(i * 2, i * 2 + 1, feed_a="one", feed_b="two") for i in range(10)]
        with self.assertRaisesRegex(ValueError, "SOURCE_DIVERSITY_GATE"):
            validate_source_diversity(concentrated)

    def test_chain_groups_must_remain_wholly_in_blind(self):
        blind = [candidate(1, 2), candidate(2, 3)]
        group = [{"article_ids": [1, 2, 3], "pair_keys": ["1:2", "2:3"], "structure_type": "CHAIN"}]
        self.assertTrue(validate_chain_group_isolation(group, [], blind))
        with self.assertRaisesRegex(ValueError, "CHAIN_GROUP_CROSS_DATASET_OVERLAP"):
            validate_chain_group_isolation(group, [candidate(1, 2)], blind)

    def test_private_artifact_path_must_be_outside_repository(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertTrue(assert_private_output_path(root / "private", root / "repo"))
            with self.assertRaisesRegex(ValueError, "PRIVATE_DATA_GIT_GATE"):
                assert_private_output_path(root / "repo" / "packs", root / "repo")


if __name__ == "__main__":
    unittest.main()
