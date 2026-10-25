# STORY01B Research: Audited NewsBlur Reference Architecture

- **Track:** STORY-01B-R
- **Topic:** Audited Reference Architecture — NewsBlur Story Clustering
- **NewsBlur Reference HEAD:** `d7c61b5b3ed7a991a2385b1991449085029711d6` (`samuelclay/NewsBlur`)
- **NewsFlux Base Commit:** `dc4154d7729204c65c8a1abaa50f9bfc9f92be64`
- **Date:** 2026-10-25
- **Status:** COMPLETE / RESEARCH ONLY
- **Runtime Activation:** NONE (`NO PRODUCT ACTIVATION`, `MERGE=NO`, `DEPLOY=NO`)

---

## 1. Executive Summary

This document presents an architectural audit of the story clustering implementation in `samuelclay/NewsBlur` (commit `d7c61b5b3ed7a991a2385b1991449085029711d6`), evaluating its two-tier clustering engine, storage model, client presentation, and graph merging characteristics to inform the future NewsFlux **Story Identity Engine**.

NewsBlur introduced duplicate story clustering in March 2026 to group cross-feed duplicate stories and related coverage in its "River of News" view. NewsBlur's source code explicitly recognizes transitive title-chain behavior and contains guardrails and render-time re-evaluation around it. For NewsFlux's stricter `SAME_EVENT` objective, this union-find topology is considered too permissive.

For NewsFlux, where the future product projection is **strict Home editorial grouping** with **zero corruption of chronological All/Unread views**, unrestricted union-find is explicitly **rejected**. NewsFlux adopts an asymmetric loss policy:

$$\text{Cost}(\text{False Merge}) \gg \text{Cost}(\text{False Split})$$

---

## 2. NewsBlur Clustering Pipeline Overview

NewsBlur implements duplicate clustering in two primary files:

- `apps/clustering/models.py` (core clustering logic, union-find algorithms, Redis storage, river view folding)
- `apps/clustering/tasks.py` (Celery background tasks, candidate selection, feed-level orchestration)
- Supporting context: `blog/_posts/2026-03-18-story-clustering.md` (rationale and user-facing design)

```mermaid
flowchart TD
    subgraph Ingestion["Celery Task (compute-story-clusters)"]
        FeedUpdate["Feed Update Event"] --> Task["ComputeStoryClusters(feed_id)"]
        Task --> CandidateGather["Fetch Candidates (shared archive subscribers, lookback=120h)"]
        CandidateGather --> Unclustered["Filter unclustered stories"]
    end

    subgraph TwoTier["Two-Tier Clustering Engine"]
        Unclustered --> Tier1["Tier 1: Title Exact Match + Lexical Overlap (Overlap Coeff >= 0.6)"]
        Unclustered --> Tier2["Tier 2: Elasticsearch more_like_this (Title only)"]
        Tier2 --> MLTGuard["Guardrail: Title Overlap >= 4 words & Overlap Coeff >= 0.45"]
        Tier1 --> UnionFind["Union-Find Disjoint Set Merge"]
        MLTGuard --> UnionFind
    end

    subgraph Storage["Redis Storage (TTL=14d)"]
        UnionFind --> Store["store_clusters_to_redis()"]
        Store --> SCL["sCL:{story_hash} -> cluster_id (STRING)"]
        Store --> ZCL["zCL:{cluster_id} -> [story_hashes] (ZSET, score=tier)"]
    end

    subgraph Presentation["River View Render (apply_clustering_to_stories)"]
        RiverReq["User River Request"] --> ReadRedis["Read sCL & zCL from Redis"]
        ReadRedis --> PickRep["Pick Representative: max(user_classifier_score) on page"]
        PickRep --> DynamicCheck["Dynamic Re-evaluation: sibling_tier_vs_representative()"]
        DynamicCheck --> Fold["Fold Secondary Stories under Representative"]
    end
```

---

## 3. Audited Constants and Parameters

The exact production constants audited in `apps/clustering/models.py` and `apps/clustering/tasks.py` are:

| Parameter                         | Value                 | Definition / Purpose in NewsBlur                                                          |
| :-------------------------------- | :-------------------- | :---------------------------------------------------------------------------------------- |
| `CLUSTER_TTL_SECONDS`             | `1,209,600` (14 days) | Redis TTL for cluster membership keys (`sCL:`, `zCL:`, `sCLt:`, `zCLt:`).                 |
| `CLUSTER_LOOKBACK_HOURS`          | `120` (5 days)        | Temporal lookback window for candidate generation across related feeds.                   |
| `CLUSTER_MAX_SIZE`                | `10`                  | Maximum number of stories allowed in a single cluster.                                    |
| `TITLE_MIN_LENGTH`                | `10`                  | Minimum character length for normalized titles to enter clustering.                       |
| `FUZZY_MIN_WORDS`                 | `5`                   | Minimum significant words in title required for fuzzy lexical matching.                   |
| `FUZZY_SIMILARITY_THRESHOLD`      | `0.6`                 | Minimum title overlap coefficient for Tier 1 fuzzy match (`overlap coefficient >= 0.6`).  |
| `FUZZY_MIN_INTERSECTION`          | `3`                   | Minimum intersecting significant words for Tier 1 fuzzy match.                            |
| `SEMANTIC_MIN_TITLE_INTERSECTION` | `4`                   | Guardrail: Minimum title word intersection to accept an ES MLT match.                     |
| `SEMANTIC_MIN_OVERLAP_COEF`       | `0.45`                | Guardrail: Minimum overlap coefficient to accept an ES MLT match.                         |
| `CANDIDATE_FEED_BATCH_SIZE`       | `50`                  | Pipeline batch size for querying Redis candidate hashes (`zF:`).                          |
| `CLUSTER_KEY_PREFIX_RELATED`      | `"sCL"`               | Redis key prefix for merged title + related cluster pointer (`sCL:<hash> -> cluster_id`). |
| `CLUSTER_ZKEY_PREFIX_RELATED`     | `"zCL"`               | Redis sorted set prefix for merged cluster members (`zCL:<cluster_id>`).                  |
| `CLUSTER_KEY_PREFIX_TITLE`        | `"sCLt"`              | Redis key prefix for title-only cluster pointer (`sCLt:<hash> -> cluster_id`).            |
| `CLUSTER_ZKEY_PREFIX_TITLE`       | `"zCLt"`              | Redis sorted set prefix for title-only cluster members (`zCLt:<cluster_id>`).             |
| `CLUSTER_TIER_TITLE_SCORE`        | `1`                   | ZSET score designating Tier 1 title-match sibling.                                        |
| `CLUSTER_TIER_RELATED_SCORE`      | `2`                   | ZSET score designating Tier 2 semantic related sibling.                                   |

---

## 4. Deep Dive: The Two-Tier Clustering Engine

### 4.1 Tier 1: Title-Based Lexical Clustering

1. **Exact Title Matching ($O(N)$):**
   - Titles are normalized: lowercased, non-alphanumeric punctuation stripped, whitespace collapsed.
   - Filtered by `TITLE_MIN_LENGTH >= 10`.
   - Exact string matches across different resolved feeds (`feed_id != other_feed_id`) are unioned.
   - Branched feeds sharing an `original_feed_id` are treated as identical feeds to prevent self-clustering.
2. **Fuzzy Significant-Word Matching:**
   - Stopwords (standard English stopword set) and feed title tokens (`feed_title_map`) are stripped.
   - Requires $\ge 5$ significant words (`FUZZY_MIN_WORDS`).
   - Pairs are indexed via an inverted word index with a frequency cap (words appearing in $>50$ candidates are skipped).
   - Candidate pairs must have $\ge 3$ intersecting words (`FUZZY_MIN_INTERSECTION`).
   - Rather than standard Jaccard ($\frac{|A \cap B|}{|A \cup B|}$), NewsBlur explicitly computes the **overlap coefficient**:
     $$\text{Overlap}(A, B) = \frac{|A \cap B|}{\min(|A|, |B|)}$$
   - _Rationale in NewsBlur code comments:_ Aggregators (e.g. Techmeme, Google News) append source attribution and context, making headlines $2\times$ to $3\times$ longer. Standard Jaccard heavily penalizes asymmetric headline lengths, whereas the overlap coefficient allows a concise headline to match an aggregated headline if most of the concise headline's words appear in the longer headline.
   - Threshold: $\text{Overlap}(A, B) \ge 0.6$ (`FUZZY_SIMILARITY_THRESHOLD`).

### 4.2 Tier 2: Elasticsearch `more_like_this` Semantic Clustering

1. **Candidate Scope:**
   - Evaluates only unclustered stories (`cluster_checked=False`).
   - Targets candidate feeds subscribed to by active archive subscribers of the current feed (capped at 50 users, 200 feeds).
2. **Query Construction:**
   - Query text: **Title only** (content is excluded from the query body to prevent topical noise from sprawling body text).
   - Fields searched: `["title", "content"]` in the Elasticsearch index.
   - Parameters: `min_term_freq=1`, `min_doc_freq=2`, `min_word_length=3`, `max_query_terms=25`, `size=5`.
3. **Lexical Guardrails on Semantic Matches:**
   - To prevent matching on shared broad terms (e.g., matching any two articles that contain common domain keywords), NewsBlur enforces two mandatory lexical guardrails before accepting an ES hit:
     1. Shared significant title words $\ge 4$ (`SEMANTIC_MIN_TITLE_INTERSECTION`).
     2. Title overlap coefficient $\ge 0.45$ (`SEMANTIC_MIN_OVERLAP_COEF`).
   - Pairs passing both guardrails are unioned into the cluster graph.

---

## 5. Storage and Client Presentation Layer

### 5.1 Redis Dual Namespace

NewsBlur maintains two parallel cluster universes in Redis:

- `sCLt:` and `zCLt:` (Title-only matches, Tier 1)
- `sCL:` and `zCL:` (Merged Title + Related matches, Tier 1 + Tier 2)

Each cluster entry has a 14-day TTL (`CLUSTER_TTL_SECONDS`). When an incoming story matches an existing cluster, the story is appended to the existing cluster's sorted set (`ZADD`) and the TTL on the entire cluster is refreshed.

### 5.2 River View Folding (`apply_clustering_to_stories`)

When a user loads their river feed:

1. NewsBlur fetches the page of stories.
2. It queries Redis `sCL:` for all story hashes on the page.
3. For any clustered stories, it pulls the complete cluster membership from `zCL:`.
4. **Representative Selection:**
   - NewsBlur sorts all on-page cluster members by the user's **intelligence score** (`score` computed from user classifier feeds, authors, tags, and titles).
   - The member with the highest intelligence score is designated the **cluster representative**.
5. **Presentation:**
   - The non-representative on-page members are removed from the river stream.
   - Sibling metadata is attached to the representative in `cluster_stories`.
   - In the frontend, the representative is rendered as the primary card, with an expandable badge indicating duplicate/related articles.

---

## 6. Structural Analysis: Graph Merging and Fact vs. Inference Boundary

To maintain rigorous research standards, this section strictly separates verified code observations from architectural inferences and NewsFlux risk assessments.

### 6.1 `CODE_VERIFIED` Observations

1. **Union-Find Structure:**
   In `apps/clustering/models.py` (lines 248–260, 440–453, 658–670), clustering uses disjoint-set union-find (`find(x)`, `union(a, b)`).
2. **Merge-Time Validation Check:**
   In `apps/clustering/models.py` (lines 834–837), when adding stories to an existing cluster, NewsBlur checks:
   ```python
   has_overlap = any(
       len(new_words & ew) >= FUZZY_MIN_INTERSECTION for ew in existing_title_words
   )
   ```
   The source comments explicitly note:
   `"This prevents unrelated stories from accumulating in a cluster through transitive chains across runs."`
3. **Render-Time Dynamic Re-evaluation:**
   In `apps/clustering/models.py` (lines 976–978, 1176–1180), the code recomputes sibling tier against the representative at river render time:
   `"The sorted-set score isn't read here because sibling tier is recomputed at render time against the chosen representative..."`
4. **Same-Feed Guard:**
   In `apps/clustering/models.py` (lines 1208–1216), the source handles same-feed related stories:
   ```python
   # A different story from the representative's own feed that only matches it as "related"
   # is not a duplicate. It keeps its own row and is never listed as a sibling, so a feed
   # doesn't look like it deduplicated its own story. Same-feed title matches
   # (duplicate headline reposts) still fold under the representative.
   if sib_feed_id == rep_feed_id and member_tier != CLUSTER_TIER_TITLE:
       same_feed_related_hashes.add(member_hash)
   ```
5. **Classifier-Dependent Representative:**
   In `apps/clustering/models.py` (lines 1167–1170), the representative is chosen using `page_group.sort(key=lambda s: s.get("score", 0), reverse=True)`.

### 6.2 `ARCHITECTURAL_INFERENCE`

- **Transitive Closure Property:**
  In an undirected union-find graph, connected components form equivalence classes. If pair $(A, B)$ satisfies the merge predicate and pair $(B, C)$ satisfies the merge predicate, $A$ and $C$ will belong to the same disjoint set even if $(A, C)$ has never been evaluated or would fail the pairwise threshold.
- **Merge Guard Permissiveness:**
  Because the merge-time check evaluates `any(...)` against existing members rather than requiring similarity to a cluster centroid or all members, a series of additions across runs can structurally admit chaining paths: $A \leftrightarrow B \leftrightarrow C \leftrightarrow D$.
- **Representative Dependence:**
  Because `score` is calculated from user classifier rules, two users viewing the same set of stories may designate different representatives, leading to different pairwise comparisons in `sibling_tier_vs_representative`.

### 6.3 `NEWSFLUX_RISK_ASSESSMENT`

- **Conclusion for NewsFlux:**
  NewsBlur's source explicitly recognizes transitive title-chain behavior and incorporates guardrails and render-time re-evaluation around it. For NewsFlux's stricter `SAME_EVENT` objective, this union-find topology is considered too permissive.
- **Policy Decision:**
  NewsFlux requires that clustered articles represent the exact same underlying news event. Merging distinct events under an editorial cluster card impairs user trust. Consequently, unrestricted union-find graph merging is explicitly **rejected** for NewsFlux's final clustering layer (`UNRESTRICTED_UNION_FIND_FOR_FINAL_CLUSTERING=REJECTED`).

---

## 7. NewsBlur vs. NewsFlux Comparison Matrix

| Dimension                 | `samuelclay/NewsBlur`                                                                                                                  | `jfsdias/NewsFlux` (Native Architecture)                                                                                                          |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Product Scope**         | River of News (global feed stream)                                                                                                     | **Home only** (All and Unread remain strictly chronological and unclustered)                                                                      |
| **Semantic Goal**         | Broad related-story grouping ("River dedup")                                                                                           | **Strict Same-Event Identity** ("Did these outlets report the exact same news event?")                                                            |
| **Candidate Generation**  | Elasticsearch `more_like_this` (Title only)                                                                                            | Dense vector search via **Qwen 1024-dim embeddings** (cross-feed, 168h window)                                                                    |
| **Pairwise Verification** | Lexical overlap coefficient ($\ge 0.45$)                                                                                               | Cross-encoder **`Qwen3-Reranker-0.6B`** + deterministic lexical & temporal rules                                                                  |
| **Graph Topology**        | **Union-Find Disjoint Sets** (transitive merging with guardrails)                                                                      | **Strict Pairwise Thresholding**; unrestricted union-find is **EXPLICITLY REJECTED**                                                              |
| **Loss Asymmetry**        | `NEWSBLUR_LOSS_POLICY=NOT_EXPLICITLY_DOCUMENTED` (broad related-story grouping where false merges may be tolerated as related reading) | Asymmetric: **$\text{Cost}(\text{False Merge}) \gg \text{Cost}(\text{False Split})$** (Precision prioritized over recall)                         |
| **User Invariance**       | Non-invariant (representative depends on user classifiers and personal intelligence scores)                                            | **Completely Invariant** (`SAME_EVENT` is an objective property of the articles, independent of read state or user profile)                       |
| **Storage / State**       | Redis sorted sets (`sCL:`, `zCL:`) with 14d TTL                                                                                        | `STORY_IDENTITY_PRODUCTION_STORAGE=HOLD_ARCHITECTURE_DECISION`; `NEW_PRODUCTION_PERSISTENT_STATE_AUTHORIZED=NO`; Miniflux remains source-of-truth |
| **Miniflux Impact**       | N/A (NewsBlur is its own backend)                                                                                                      | **Zero writes** (`MINIFLUX_WRITES=0`); no category, feed, or entry mutations                                                                      |

---

## 8. Implications and Decisions for NewsFlux

1. **Rejection of Unrestricted Union-Find:**
   `UNRESTRICTED_UNION_FIND_FOR_FINAL_CLUSTERING=REJECTED`. NewsFlux must require clique completeness or strict medoid/representative similarity thresholds before forming any multi-article cluster.
2. **Decoupling from Personalization:**
   Editorial story identity (`SAME_EVENT`) must be determined purely by article content, publication timing, and source metadata. Read/unread status, star marks, user scoring, and feed affinities must not alter event boundaries.
3. **Temporal Bounds and Ground Truth:**
   NewsBlur uses a 120h candidate window. In NewsFlux's frozen `Home-200` corpus, the observed temporal span is approximately 6.95 hours (`HOME200_OBSERVED_TEMPORAL_SPAN≈6.95h`). The empirical distribution of `SAME_EVENT` coverage across time remains to be measured during dataset curation (`SAME_EVENT_TEMPORAL_DISTRIBUTION=NOT_MEASURED_PENDING_STORY_01B_D`). The 168h candidate window remains a research candidate-generation contract.
4. **Lexical Guardrail Retention:**
   NewsBlur's finding that lexical overlap is an essential safeguard against semantic model hallucinations is confirmed. Even with modern dense embeddings and rerankers, exact entity/keyword overlap serves as an indispensable precision filter.
