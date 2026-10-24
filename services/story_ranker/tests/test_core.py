import unittest

from services.story_ranker.core import rank_story_candidates


class FakeEmbedder:
    def __init__(self, vectors_by_title):
        self.vectors_by_title = vectors_by_title
        self.calls = []

    def embed(self, titles):
        self.calls.append(list(titles))
        return [self.vectors_by_title[title] for title in titles]


class FakeReranker:
    def __init__(self, scores):
        self.scores = iter(scores)
        self.calls = []

    def score(self, pairs):
        pairs = list(pairs)
        self.calls.append(pairs)
        return [next(self.scores) for _ in pairs]


class StoryRankerCoreTests(unittest.TestCase):
    def test_filters_same_feed_and_pairs_outside_168_hours(self):
        entries = [
            {"id": 1, "feed_id": 10, "published_at": "2026-10-20T00:00:00Z", "title": "A"},
            {"id": 2, "feed_id": 10, "published_at": "2026-10-28T00:00:00Z", "title": "B"},
            {"id": 3, "feed_id": 20, "published_at": "2026-10-20T02:00:00Z", "title": "C"},
            {"id": 4, "feed_id": 10, "published_at": "2026-10-28T01:00:01Z", "title": "D"},
        ]
        embedder = FakeEmbedder(
            {
                "A": [1.0, 0.0],
                "B": [1.0, 0.0],
                "C": [1.0, 0.0],
                "D": [1.0, 0.0],
            }
        )
        reranker = FakeReranker([2.0, 4.0])

        result = rank_story_candidates(entries, embedder=embedder, reranker=reranker)

        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["entry_a_id"], result[0]["entry_b_id"]), (1, 3))

    def test_uses_embedding_similarity_for_top_k_then_symmetric_reranking(self):
        entries = [
            {"id": 1, "feed_id": 10, "published_at": "2026-10-20T00:00:00Z", "title": "A"},
            {"id": 2, "feed_id": 20, "published_at": "2026-10-20T01:00:00Z", "title": "B"},
            {"id": 3, "feed_id": 30, "published_at": "2026-10-20T02:00:00Z", "title": "C"},
        ]
        embedder = FakeEmbedder(
            {
                "A": [1.0, 0.0],
                "B": [0.9, 0.1],
                "C": [0.0, 1.0],
            }
        )
        # For candidate_k=2 the core scores two AB pairs, then the same two BA pairs.
        reranker = FakeReranker([2.0, 8.0, 6.0, 4.0])

        result = rank_story_candidates(
            entries,
            embedder=embedder,
            reranker=reranker,
            candidate_k=2,
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(len(reranker.calls), 2)
        self.assertEqual(reranker.calls[1], [(b, a) for a, b in reranker.calls[0]])
        # Means are 4.0 and 6.0, so the second embedding candidate must become rank 1.
        self.assertEqual(result[0]["reranker_score"], 6.0)
        self.assertEqual(result[0]["rank"], 1)
        self.assertEqual(result[1]["reranker_score"], 4.0)
        self.assertEqual(result[1]["rank"], 2)

    def test_output_contains_ranking_only_not_story_identity_decisions(self):
        entries = [
            {"id": 1, "feed_id": 10, "published_at": "2026-10-20T00:00:00Z", "title": "A"},
            {"id": 2, "feed_id": 20, "published_at": "2026-10-20T01:00:00Z", "title": "B"},
        ]
        embedder = FakeEmbedder({"A": [1.0, 0.0], "B": [1.0, 0.0]})
        reranker = FakeReranker([3.0, 5.0])

        [candidate] = rank_story_candidates(entries, embedder=embedder, reranker=reranker)

        self.assertEqual(
            set(candidate),
            {"entry_a_id", "entry_b_id", "rank", "qwen_score", "reranker_score"},
        )
        self.assertNotIn("same_story", candidate)
        self.assertNotIn("merge", candidate)
        self.assertNotIn("label", candidate)


if __name__ == "__main__":
    unittest.main()
