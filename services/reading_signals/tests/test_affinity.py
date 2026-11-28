from __future__ import annotations

import unittest
from datetime import date, timedelta

from services.reading_signals.affinity import (
    HALF_LIFE_DAYS,
    MAX_WEIGHT_DELTA,
    MIN_DECAYED_IMPRESSIONS,
    DailyCounts,
    compute_affinity,
)

TODAY = date(2026, 11, 28)


def rows(feed_id: int, days: int, impressions: int, opens: int, read_to_end: int = 0, stars: int = 0):
    return [
        DailyCounts(feed_id, TODAY - timedelta(days=offset), impressions, opens, read_to_end, stars)
        for offset in range(days)
    ]


def by_feed(result):
    return {source["feed_id"]: source for source in result["sources"]}


class AffinityTests(unittest.TestCase):
    def test_affinity_is_volume_independent(self) -> None:
        result = by_feed(
            compute_affinity(rows(1, 20, impressions=200, opens=40) + rows(2, 20, impressions=10, opens=2), today=TODAY)
        )
        self.assertAlmostEqual(result[1]["affinity"], result[2]["affinity"], places=2)

    def test_more_selected_source_ranks_higher(self) -> None:
        result = by_feed(
            compute_affinity(rows(1, 20, impressions=20, opens=10) + rows(2, 20, impressions=20, opens=1), today=TODAY)
        )
        self.assertGreater(result[1]["affinity"], result[2]["affinity"])
        self.assertEqual(result[1]["state"], "preferred")
        self.assertEqual(result[2]["state"], "rarely_opened")
        self.assertGreater(result[1]["weight"], 1.0)
        self.assertLess(result[2]["weight"], 1.0)

    def test_sparse_source_stays_learning_and_neutral(self) -> None:
        result = by_feed(compute_affinity(rows(1, 20, 20, 5) + rows(2, 1, 5, 5), today=TODAY))
        self.assertEqual(result[2]["state"], "learning")
        self.assertEqual(result[2]["weight"], 1.0)
        self.assertLess(result[2]["decayed_impressions"], MIN_DECAYED_IMPRESSIONS)

    def test_weight_is_bounded(self) -> None:
        result = by_feed(
            compute_affinity(rows(1, 30, 50, 50) + rows(2, 30, 50, 0) + rows(3, 30, 500, 5), today=TODAY)
        )
        for source in result.values():
            self.assertGreaterEqual(source["weight"], 1 - MAX_WEIGHT_DELTA)
            self.assertLessEqual(source["weight"], 1 + MAX_WEIGHT_DELTA)

    def test_old_counts_decay(self) -> None:
        old = [DailyCounts(1, TODAY - timedelta(days=HALF_LIFE_DAYS), 100, 0, 0, 0)]
        fresh = [DailyCounts(1, TODAY, 100, 0, 0, 0)]
        decayed = by_feed(compute_affinity(old, today=TODAY))[1]["decayed_impressions"]
        current = by_feed(compute_affinity(fresh, today=TODAY))[1]["decayed_impressions"]
        self.assertAlmostEqual(decayed, current / 2, places=1)

    def test_reason_text_is_explicit(self) -> None:
        result = by_feed(compute_affinity(rows(1, 20, 20, 10) + rows(2, 20, 20, 1), today=TODAY))
        self.assertIn("open", result[1]["reason"])
        self.assertIn("rarely", result[2]["reason"])

    def test_empty_input(self) -> None:
        result = compute_affinity([], today=TODAY)
        self.assertEqual(result["sources"], [])
        self.assertEqual(result["account_open_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()
