#!/usr/bin/env python3
"""
STORY-01B-C7: Incremental Story Engine Primitive (Stage 3 & 4)

Pure in-memory, streaming story projection engine for news articles arriving chronologically.
Maintains state incrementally without hidden or external persistence.
Fully reconstructible from scratch from any sequence of articles.

Key Capabilities:
- Streaming admission under conservative cluster policies (P1..P4)
- Established cluster merge policies (L0..L3)
- Real-time representative tracking and churn detection (R0..R4)
- Alternatives selection (A0..A2)
- Ephemeral lifecycle stage derivation (ACTIVE, COOLING, STALE)
"""

import hashlib
import statistics
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple


class IncrementalStoryEngine:
    """Pure in-memory streaming story identity engine."""

    def __init__(
        self,
        cluster_policy: str = "P3_STRONG_MULTI_MEMBER_SUPPORT",
        representative_policy: str = "R0_EARLIEST",
        alternative_policy: str = "A2_DIVERSE_TOP_K",
        merge_policy: str = "L0_NEVER_MERGE_ESTABLISHED_CLUSTERS",
        threshold: float = 0.3787,
        max_cluster_size: int = 10,
        cooling_hours: float = 3.0,
        stale_hours: float = 12.0,
    ):
        self.cluster_policy = cluster_policy
        self.representative_policy = representative_policy
        self.alternative_policy = alternative_policy
        self.merge_policy = merge_policy
        self.threshold = threshold
        self.max_cluster_size = max_cluster_size
        self.cooling_hours = cooling_hours
        self.stale_hours = stale_hours

        # In-memory ephemeral state
        self.articles: Dict[int, Dict[str, Any]] = {}
        self.pairwise_scores: Dict[Tuple[int, int], float] = {}
        self.pairwise_lexical: Dict[Tuple[int, int], float] = {}

        # Cluster storage: story_internal_id -> set of article_ids
        self.clusters: Dict[str, Set[int]] = {}
        self.article_to_story: Dict[int, str] = {}
        self.story_representatives: Dict[str, int] = {}
        self.story_created_at: Dict[str, float] = {}
        self.rep_churn_history: Dict[str, List[Tuple[float, int, int]]] = defaultdict(list)

        self._story_counter = 0

    def _pair_key(self, u: int, v: int) -> Tuple[int, int]:
        return (min(u, v), max(u, v))

    def get_score(self, u: int, v: int) -> Optional[float]:
        return self.pairwise_scores.get(self._pair_key(u, v))

    def _select_representative(self, member_ids: List[int]) -> int:
        """Select representative article according to configured policy."""
        if len(member_ids) == 1:
            return member_ids[0]

        pub_map = {m: float(self.articles[m].get("published_at", 0.0)) for m in member_ids}

        if self.representative_policy == "R0_EARLIEST":
            # Earliest published article, tie-break on smaller article_id
            return min(member_ids, key=lambda m: (pub_map.get(m, 0.0), m))

        elif self.representative_policy == "R1_LATEST":
            # Latest published article, tie-break on larger article_id
            return max(member_ids, key=lambda m: (pub_map.get(m, 0.0), m))

        elif self.representative_policy in ("R2_LEXICAL_MEDOID", "R4_HYBRID_MEDOID"):
            # Medoid maximizing average pairwise similarity to other members
            best_art = member_ids[0]
            best_avg = -1.0
            for cand in member_ids:
                sims = []
                for other in member_ids:
                    if cand == other:
                        continue
                    pk = self._pair_key(cand, other)
                    sc = self.pairwise_scores.get(pk, 0.0)
                    sims.append(sc)
                avg_sim = statistics.mean(sims) if sims else 0.0
                if avg_sim > best_avg or (avg_sim == best_avg and pub_map.get(cand, 0.0) < pub_map.get(best_art, 0.0)):
                    best_avg = avg_sim
                    best_art = cand
            return best_art

        else:
            return min(member_ids, key=lambda m: (pub_map.get(m, 0.0), m))

    def _select_alternatives(self, member_ids: List[int], representative_id: int, max_k: int = 3) -> List[int]:
        """Select alternative articles according to configured policy."""
        candidates = [m for m in member_ids if m != representative_id]
        if not candidates:
            return []

        if self.alternative_policy == "A0_ALL":
            return sorted(candidates)

        rep_feed = self.articles[representative_id].get("feed_title", "")
        # Pick from distinct publisher feeds first
        distinct_feed_cands = []
        same_feed_cands = []

        for c in candidates:
            c_feed = self.articles[c].get("feed_title", "")
            if c_feed != rep_feed:
                distinct_feed_cands.append((c, c_feed))
            else:
                same_feed_cands.append((c, c_feed))

        selected = []
        seen_feeds = set()
        for c, feed in distinct_feed_cands:
            if feed not in seen_feeds:
                selected.append(c)
                seen_feeds.add(feed)
            if len(selected) >= max_k:
                break

        if len(selected) < max_k:
            remaining = [c for c in candidates if c not in selected]
            for c in remaining:
                selected.append(c)
                if len(selected) >= max_k:
                    break

        return sorted(selected)

    def add_article(
        self,
        article: Dict[str, Any],
        scores_to_existing: Optional[Dict[int, float]] = None,
        lexical_to_existing: Optional[Dict[int, float]] = None,
    ) -> Dict[str, Any]:
        """Add an incoming article to the engine in streaming fashion.

        Args:
            article: dict with keys {"id", "published_at", "feed_title", "title", ...}
            scores_to_existing: map of {existing_article_id: b4_ensemble_score}
            lexical_to_existing: optional map of {existing_article_id: b0_lexical_overlap}

        Returns:
            transition_event dict describing actions taken.
        """
        aid = int(article["id"])
        pub = float(article.get("published_at", 0.0))
        self.articles[aid] = article

        # Register pairwise scores
        if scores_to_existing:
            for other_id, sc in scores_to_existing.items():
                self.pairwise_scores[self._pair_key(aid, int(other_id))] = float(sc)
        if lexical_to_existing:
            for other_id, ov in lexical_to_existing.items():
                self.pairwise_lexical[self._pair_key(aid, int(other_id))] = float(ov)

        # Check existing stories for compatible admission
        candidate_stories: List[Tuple[float, str]] = []

        for sid, members in self.clusters.items():
            if len(members) >= self.max_cluster_size:
                continue

            rep = self.story_representatives[sid]
            rep_sc = self.get_score(aid, rep)

            # Must have positive edge to representative
            if rep_sc is None or rep_sc < self.threshold:
                continue

            # Policy checks
            if self.cluster_policy == "P1_REPRESENTATIVE_GUARD":
                candidate_stories.append((rep_sc, sid))

            elif self.cluster_policy == "P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY":
                # No observed negative edge (< threshold) to any cluster member
                has_neg = any((self.get_score(aid, m) is not None and self.get_score(aid, m) < self.threshold) for m in members)
                if not has_neg:
                    candidate_stories.append((rep_sc, sid))

            elif self.cluster_policy == "P3_STRONG_MULTI_MEMBER_SUPPORT":
                # If cluster >= 2 members, candidate must have positive edge to at least 2 distinct members
                if len(members) >= 2:
                    pos_count = sum(1 for m in members if (self.get_score(aid, m) or 0.0) >= self.threshold)
                    if pos_count < 2:
                        continue
                candidate_stories.append((rep_sc, sid))

            elif self.cluster_policy == "P4_CONTRADICTION_VETO":
                # No contradiction (< 0.70 * threshold)
                has_contradiction = any((self.get_score(aid, m) is not None and self.get_score(aid, m) < (self.threshold * 0.70)) for m in members)
                if not has_contradiction:
                    candidate_stories.append((rep_sc, sid))

        event: Dict[str, Any] = {
            "article_id": aid,
            "action": "STANDALONE_CREATED",
            "story_id": None,
            "representative_changed": False,
            "previous_representative": None,
            "new_representative": None,
        }

        if not candidate_stories:
            # Standalone story creation
            self._story_counter += 1
            sid = f"story_{self._story_counter:04d}"
            self.clusters[sid] = {aid}
            self.article_to_story[aid] = sid
            self.story_representatives[sid] = aid
            self.story_created_at[sid] = pub
            event["action"] = "NEW_STORY_CREATED"
            event["story_id"] = sid
            event["new_representative"] = aid
            return event

        # Pick best compatible story (highest affinity to representative)
        candidate_stories.sort(key=lambda x: x[0], reverse=True)
        best_sc, best_sid = candidate_stories[0]

        # Check if bridge article attempts to merge multiple established multi-article clusters
        if len(candidate_stories) > 1 and self.merge_policy == "L0_NEVER_MERGE_ESTABLISHED_CLUSTERS":
            # Conservative: Join only the single best compatible story, leave other cluster untouched
            pass

        # Admit to best_sid
        self.clusters[best_sid].add(aid)
        self.article_to_story[aid] = best_sid

        # Update representative
        old_rep = self.story_representatives[best_sid]
        new_rep = self._select_representative(list(self.clusters[best_sid]))
        self.story_representatives[best_sid] = new_rep

        rep_changed = (old_rep != new_rep)
        if rep_changed:
            self.rep_churn_history[best_sid].append((pub, old_rep, new_rep))

        event["action"] = "ARTICLE_JOINED_EXISTING_STORY"
        event["story_id"] = best_sid
        event["representative_changed"] = rep_changed
        event["previous_representative"] = old_rep
        event["new_representative"] = new_rep
        return event

    def get_projection(self, current_time: Optional[float] = None) -> List[Dict[str, Any]]:
        """Export current story projection list.

        Args:
            current_time: optional timestamp for ephemeral lifecycle calculation.
        """
        projections = []

        # Sort stories deterministically by (last_published_at DESC, story_id ASC)
        for sid, members in self.clusters.items():
            member_list = sorted(list(members))
            pub_times = [float(self.articles[m].get("published_at", 0.0)) for m in member_list]
            last_pub = max(pub_times) if pub_times else 0.0
            first_pub = min(pub_times) if pub_times else 0.0

            rep_id = self.story_representatives[sid]
            alt_ids = self._select_alternatives(member_list, rep_id, max_k=3)
            feeds = {self.articles[m].get("feed_title", "") for m in member_list}

            # Ephemeral lifecycle calculation
            ref_time = current_time if current_time is not None else max((float(a.get("published_at", 0.0)) for a in self.articles.values()), default=0.0)
            age_hours = (ref_time - last_pub) / 3600.0 if ref_time >= last_pub else 0.0

            if age_hours <= self.cooling_hours:
                lifecycle_stage = "ACTIVE"
            elif age_hours <= self.stale_hours:
                lifecycle_stage = "COOLING"
            else:
                lifecycle_stage = "STALE"

            # Canonical story ID based on member hash
            canonical_member_str = ",".join(str(m) for m in member_list)
            stable_story_id = f"story_{hashlib.sha256(canonical_member_str.encode('utf-8')).hexdigest()[:16]}"

            confidence = "UNVERIFIED_MULTI_MEMBER" if len(member_list) > 1 else "STANDALONE"

            projections.append({
                "story_id": stable_story_id,
                "internal_cluster_id": sid,
                "representative_article_id": rep_id,
                "alternative_article_ids": alt_ids,
                "member_article_ids": member_list,
                "member_count": len(member_list),
                "source_count": len(feeds),
                "first_published_at": first_pub,
                "last_published_at": last_pub,
                "lifecycle_stage": lifecycle_stage,
                "age_hours": round(age_hours, 2),
                "confidence": confidence,
                "cluster_policy": self.cluster_policy,
                "representative_policy": self.representative_policy,
                "alternative_policy": self.alternative_policy,
            })

        # Sort projections descending by last_published_at
        projections.sort(key=lambda p: (p["last_published_at"], -p["representative_article_id"]), reverse=True)
        return projections
