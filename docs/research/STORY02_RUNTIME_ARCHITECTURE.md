# STORY-02-A0: Runtime Architecture Reconciliation & End-to-End Feasibility

## 1. Executive Summary

The STORY-01B track established the algorithmic feasibility of Story Identity on the frozen `home-200` corpus:

- Pair classification with precision > 0.90
- Conservative clustering (P3 multi-member support) eliminating transitive chain collapses
- Strict abstention (Q1 crossfit unanimity / Q3 high consensus) eliminating cross-story and different-event contamination
- Downstream projection yielding 9.5% feed noise reduction with zero disruption to All or Unread views

The goal of **STORY-02-A0** is to reconcile these algorithmic findings with the **actual runtime architecture** of NewsFlux. Specifically:

1. Auditing the existing `services/story_ranker` dormant infrastructure in `main`.
2. Determining whether heavy neural models (cross-encoders, Mistral cloud embeddings) are truly necessary or whether simpler, lighter, privacy-preserving architectures achieve comparable product value.
3. Investigating why previous simulations showed `TOP_20_STORY_CARD_COUNT = 0` and resolving it through editorial ordering policies.
4. Defining a single, coherent, production-feasible architecture that preserves Miniflux as the exclusive source of truth with zero database persistence.

---

## 2. Audit of Existing Story Infrastructure in `main`

An end-to-end inspection of `main` (`938e16ce`) revealed the exact status of current story-related code:

| Component            | Path / Location                        | Current Status          | Notes                                                                              |
| :------------------- | :------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------- |
| **Sidecar Service**  | `services/story_ranker/`               | `PRESENT_DORMANT`       | Standalone Python 3 HTTP server (`server.py`, port 8787).                          |
| **Docker Compose**   | `docker-compose.yml`                   | `NOT_DEPLOYED`          | Only `reactflux` container is present. `story-ranker` is NOT in compose.           |
| **Reverse Proxy**    | `Caddyfile`                            | `CONFIGURED_FAIL_OPEN`  | Proxies `/api/story-candidates/*` to `{$STORY_RANKER_UPSTREAM:story-ranker:8787}`. |
| **Frontend State**   | `src/store/storyCandidateState.js`     | `DORMANT_NANOSTORE`     | Manages `idle`, `pending`, `ready`, `failed` candidate states.                     |
| **Frontend Runtime** | `src/utils/story-candidate-runtime.js` | `DISABLED_BY_DEFAULT`   | Active only when `VITE_STORY_CANDIDATE_RANKING === "1"`.                           |
| **Home Component**   | `src/components/Home/HomeRecent.jsx`   | `FAIL_OPEN_PASSTHROUGH` | Renders standard `ArticleGridCard`s even when candidates are fetched.              |

### Key Architectural Invariants Already Enforced

1. **Zero Persistence**: Neither the sidecar nor the frontend writes to any SQL database, Redis, or local storage.
2. **Fail-Open Home**: If the sidecar is unreachable, timed out, or returns an error, Home renders standard unclustered articles with zero user disruption.
3. **All / Unread Untouched**: Story candidate logic is strictly confined to Home (`/home`). Standard RSS views (`All`, `Unread`, `Starred`, feeds, categories) are 100% untouched.

---

## 3. Feature Source & Feasibility Matrix

We cataloged the operational requirements, dependencies, and privacy profile for all candidate features:

| Feature Name                | Primary Source    | Available in Browser | Available in Miniflux | Available in Sidecar | Model Dependency  | Latency Profile | Privacy Profile         | Feasible Today? |
| :-------------------------- | :---------------- | :------------------: | :-------------------: | :------------------: | :---------------- | :-------------- | :---------------------- | :-------------: |
| `title_overlap_coefficient` | Lexical overlap   |       **YES**        |        **YES**        |       **YES**        | None              | < 0.01 ms       | Perfect (On-Device)     |     **YES**     |
| `title_jaccard_similarity`  | Lexical overlap   |       **YES**        |        **YES**        |       **YES**        | None              | < 0.01 ms       | Perfect (On-Device)     |     **YES**     |
| `title_token_intersection`  | Lexical overlap   |       **YES**        |        **YES**        |       **YES**        | None              | < 0.01 ms       | Perfect (On-Device)     |     **YES**     |
| `entity_anchor_overlap`     | Lexical heuristic |       **YES**        |        **YES**        |       **YES**        | None              | < 0.02 ms       | Perfect (On-Device)     |     **YES**     |
| `number_overlap`            | Numeric regex     |       **YES**        |        **YES**        |       **YES**        | None              | < 0.01 ms       | Perfect (On-Device)     |     **YES**     |
| `date_overlap`              | Date regex        |       **YES**        |        **YES**        |       **YES**        | None              | < 0.01 ms       | Perfect (On-Device)     |     **YES**     |
| `published_delta_hours`     | Entry metadata    |       **YES**        |        **YES**        |       **YES**        | None              | < 0.001 ms      | Perfect (On-Device)     |     **YES**     |
| `same_domain`               | URL parse         |       **YES**        |        **YES**        |       **YES**        | None              | < 0.005 ms      | Perfect (On-Device)     |     **YES**     |
| `same_category`             | Feed metadata     |       **YES**        |        **YES**        |          NO          | None              | < 0.001 ms      | Perfect (On-Device)     |     **YES**     |
| `qwen_embedding_cosine`     | Ollama daemon     |          NO          |          NO           |       **YES**        | Qwen3-0.6B Embed  | 25-150 ms       | High (Local Daemon)     |     **YES**     |
| `reranker_score_mean`       | PyTorch sidecar   |          NO          |          NO           |       **YES**        | Qwen3-0.6B Rerank | 300-1500 ms     | High (Local Sidecar)    |     **YES**     |
| `mistral_embedding_cosine`  | Mistral Cloud API |          NO          |          NO           |          NO          | Mistral Embed     | 200-800 ms      | **POOR (Cloud Egress)** |     **NO**      |

---

## 4. Production Feature Ablation & Mistral Removal Finding

We performed an article-disjoint Leave-One-Family-Out (LOFO) ablation benchmark comparing four candidate feature sets:

- **PF0 (Lexical Only)**: 15 lexical and temporal features. Zero embedding models.
- **PF1 (Lexical + Qwen)**: PF0 + Qwen3-Embedding-0.6B cosine similarity.
- **PF2 (Lexical + Sidecar)**: PF1 + Qwen3-Reranker-0.6B cross-encoder score.
- **PF3 (Full Research B4 Reference)**: PF1 + Mistral cloud embedding cosine (research ceiling).

### Empirical Results (Strict Article-Disjoint LOFO on Gold-v1)

| Feature Set                 | Features | Precision | Recall |    F0.5    |   PR-AUC   | Related Topic FPR | Different Event FPR | Family Macro Recall | Non-Duo Recall |
| :-------------------------- | :------: | :-------: | :----: | :--------: | :--------: | :---------------: | :-----------------: | :-----------------: | :------------: |
| **PF0 (Lexical Only)**      |    15    |  0.8281   | 0.9298 | **0.8466** | **0.8886** |   0.2105 (4/19)   |    0.0875 (7/80)    |       0.8929        | 0.9333 (14/15) |
| **PF1 (Lexical + Qwen)**    |    16    |  0.9167   | 0.9649 | **0.9259** | **0.9755** |   0.1579 (3/19)   |    0.0250 (2/80)    |       0.9600        | 0.8667 (13/15) |
| **PF2 (Lexical + Sidecar)** |    17    |  1.0000   | 0.7018 | **0.9217** | **0.9757** |   0.0000 (0/19)   |    0.0000 (0/80)    |       0.9243        | 0.8667 (13/15) |
| **PF3 (Research B4 Ref)**   |    17    |  0.9138   | 0.9298 | **0.9170** | **0.9527** |   0.1579 (3/19)   |    0.0250 (2/80)    |       0.9729        | 0.9333 (14/15) |

### Critical Architectural Findings

1. **Dropping Mistral is Mandatory and Superior**:
   - `DOES_B4_REQUIRE_MISTRAL_FOR_INFERENCE = YES` in research, but `CURRENT_RUNTIME_MISTRAL_AVAILABLE = NO`.
   - Removing Mistral does **not** degrade performance: **PF1 (Lexical + Qwen) achieves PR-AUC 0.9755 vs PF3's 0.9527 (+0.0228 improvement)** while eliminating third-party cloud egress, API billing, and network latency.
2. **The Reranker is Not Justified for Production**:
   - PF2 (with cross-encoder reranker) achieves 100% precision on retrieved pairs, but at the cost of 500-1500 ms CPU latency, 1.5 GB extra RAM, and a drop in recall (from 96.5% down to 70.2% because pairs outside Top-250 lack scores).
   - PF1 (without reranker) matches PF2 on PR-AUC (0.9755 vs 0.9757) and F0.5 (0.9259 vs 0.9217) in a fraction of the time (< 150 ms vs > 850 ms).
3. **PF0 (Lexical Only) is a Highly Viable Zero-Model Tier**:
   - Achieves 0.8886 PR-AUC and 0.8466 F0.5 with **zero models, zero containers, and zero latency**. It correctly identifies 14/15 non-Duo positive events and captures 93% recall.

---

## 5. Candidate Retrieval Feasibility

Candidate retrieval trims the $O(N^2)$ pair space (18,953 pairs on Home-200) before pair scoring. We evaluated four runtime classes:

| Class   | Method                             | Runtime Dependencies       | Pair Reduction | Same-Event Pair Recall | Positive Family Recall | Latency Profile | Feasible Today? |
| :------ | :--------------------------------- | :------------------------- | :------------: | :--------------------: | :--------------------: | :-------------- | :-------------: |
| **RF0** | Client Title-Overlap Top-K (K=10)  | **None (Pure JS)**         |   **92.06%**   |    **100% (57/57)**    |    **100% (10/10)**    | **< 1.5 ms**    |     **YES**     |
| **RF1** | Qwen Embedding Cosine Top-K (K=10) | Ollama (Local Daemon)      |   **91.29%**   |    **100% (57/57)**    |    **100% (10/10)**    | 25-150 ms       |     **YES**     |
| **RF2** | Hybrid Semantic + Guards (R6 K=5)  | Ollama + Client JS         |   **98.96%**   |    **100% (57/57)**    |    **100% (10/10)**    | 30-160 ms       |     **YES**     |
| **RF3** | Existing Story Ranker (K=250)      | Ollama + PyTorch Container |   **98.68%**   |    **100% (57/57)**    |    **100% (10/10)**    | 400-1800 ms     |     **YES**     |

**Conclusion**: RF0 (pure lexical retrieval in JS) achieves a **92.06% reduction in pair evaluations while preserving 100% of true event pairs and 100% of family connectivity** in under 1.5 ms on the client. Heavy semantic retrieval (RF2) pushes reduction to 98.96%, but RF0 is more than sufficient for client-side processing of Home-200.

---

## 6. Home Feed Top-20 Deep Dive & Ordering Policy Resolution

In Stage C11 shadow simulation, a puzzling finding emerged:
`TOP_20_STORY_CARD_COUNT = 0`

### Root Cause Analysis

By tracing the 11 multi-member clusters back to their Home-200 entry positions, we discovered:

- Story 1 (iPhone Duo, 10 articles) had members spanning positions: `[19, 24, 93, 113, 135, 136, 140, 181, 191, 194]`.
- Story 7 had members at positions `[8, 74]`.
- **Position 8 is in the Top 10, and position 19 is in the Top 20!**
- Under Stage C11's default policy (`H0_REPRESENTATIVE_POSITION`), the representative was chosen via `R4_HYBRID_MEDOID` (an early breaking article, at position 194 for Story 1 and position 74 for Story 7).
- Because `H0` placed the composite Story Card at the representative's position, the Story Cards were rendered down at positions 74 and 181. Meanwhile, the newer member articles at positions 8 and 19 were treated as alternatives and absorbed downwards.
- This created the illusion that Story Identity did not affect the top of the feed, when in fact it was collapsing top-ranked breaking updates down into earlier background articles!

### Policy Comparison on Home-200

| Placement Policy         | Rule Description                              | Top 10 Story Cards | Top 20 Story Cards | Top 30 Story Cards | Top 50 Story Cards | Top 100 Story Cards |
| :----------------------- | :-------------------------------------------- | :----------------: | :----------------: | :----------------: | :----------------: | :-----------------: |
| **H0 (Representative)**  | Placed at representative article position     |         0          |         0          |         0          |         0          |          4          |
| **H1 (Highest-Ranked)**  | **Placed at position of newest / top member** |   **1** (pos 8)    | **2** (pos 8, 19)  |       **4**        |       **6**        |       **10**        |
| **H2 (Newest Member)**   | Placed at newest publication timestamp        |       **1**        |       **2**        |       **4**        |       **6**        |       **10**        |
| **H3 (Earliest Member)** | Placed at oldest publication timestamp        |         0          |         0          |         0          |         0          |          1          |

### Editorial Resolution

Adopting **`H1_HIGHEST_RANKED_MEMBER_POSITION`** ensures that when an ongoing story has fresh updates, the composite Story Card appears at the **top** of the user's feed (where the freshest article would have appeared), compressing redundant coverage in place rather than burying the story below the fold.

---

## 7. End-to-End Latency & Performance Breakdown

The `7.22 ms` figure reported in Overnight V2 represents **downstream Node/JS clustering and projection on pre-computed scores**, NOT full end-to-end inference.

Here is the realistic end-to-end latency breakdown across architecture tiers:

```
+---------------------------------------------------------------------------------------+
| ARCH-A: Pure Client Lexical (Zero Models, Zero Containers)                             |
| [Fetch: 0ms] -> [Tokenize: 0.8ms] -> [RF0 Retrieval: 1.2ms] -> [P3 Cluster: 4.8ms]   |
| Total Latency: ~6.8 ms (Runs directly in Web Worker)                                   |
+---------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------+
| ARCH-B: Qwen Embedding + Client Story Engine                                          |
| [Fetch: 10ms] -> [Ollama Embed 200 titles: 120ms] -> [Cosine/RF1: 15ms] -> [P3: 5ms]   |
| Total Latency: ~150 ms (Acceptable for initial Home load)                             |
+---------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------+
| ARCH-C: Existing Story Ranker (Embedding + Cross-Encoder Reranker)                    |
| [Fetch: 10ms] -> [Ollama: 120ms] -> [Rerank 250 pairs on CPU: 800ms] -> [P3: 5ms]      |
| Total Latency: ~935 ms (Too slow for interactive UI without background caching)       |
+---------------------------------------------------------------------------------------+
```

---

## 8. Stack & Architecture Evaluation

We compared five coherent end-to-end architectures:

| Architecture | Description                                        | Quality (PR-AUC) |  Safety   |   Latency   | Server RAM |    Containers     | Operational Complexity |      Feasibility Status       |
| :----------- | :------------------------------------------------- | :--------------: | :-------: | :---------: | :--------: | :---------------: | :--------------------: | :---------------------------: |
| **ARCH-A**   | Pure Client Lexical (RF0 + PF0 + P3 in Web Worker) |      0.8886      | Very High | **< 10 ms** |  **0 MB**  |       **0**       |      **Minimal**       |       **FEASIBLE_NOW**        |
| **ARCH-B**   | Qwen Embedding + Client Story Engine               |    **0.9755**    | Very High |   ~150 ms   |   850 MB   |    1 (Ollama)     |          Low           | **FEASIBLE_WITH_SMALL_DELTA** |
| **ARCH-C**   | Existing Ranker Sidecar + Client Clustering        |      0.9757      | Very High |   ~935 ms   |  2400 MB   | 2 (Ranker+Ollama) |          High          | **FEASIBLE_WITH_SMALL_DELTA** |
| **ARCH-D**   | Extended Sidecar (Custom Python Endpoints)         |      0.9755      | Very High |   ~200 ms   |  1500 MB   |         2         |          High          | **FEASIBLE_WITH_SMALL_DELTA** |
| **ARCH-E**   | Server-Side Story Projection (Server clusters)     |      0.9755      | Very High |   ~250 ms   |  1500 MB   |         2         |       Very High        |      **NOT_RECOMMENDED**      |

### Why ARCH-E Loses

ARCH-E pushes product/UI layout concerns (representatives, alternatives, card grouping) into the Python backend. This tightly couples the backend to frontend UI revisions and creates severe fork-maintenance debt against upstream ReactFlux.

### Why ARCH-C Loses to ARCH-B

ARCH-C keeps the CPU-heavy cross-encoder reranker, requiring a 2.4 GB container that adds 800 ms of latency for a negligible 0.0002 PR-AUC gain over ARCH-B.

---

## 9. Cache vs Recompute Reconciliation

Overnight V2 recommended `OPTION_C_BOUNDED_EPHEMERAL_CACHE`. Our investigation shows that **persistent server caching (Redis / DB) is neither necessary nor desirable**:

1. **Request Recompute is Fast Enough**: Pure JS clustering completes in 6.8 ms. Running this client-side in a Web Worker costs essentially 0 ms of user-perceived lag.
2. **Ephemeral Request-Local Map**: A lightweight in-memory `Map` keyed by `home_identity_key + sessionRevision` avoids redundant recalculations during React re-renders without introducing cache invalidation bugs.
3. **Read/Star Invariant**: User mark-as-read and star mutations do **not** invalidate story groupings. Stories only need recomputation when new articles arrive or feeds refresh.

---

## 10. Single Recommended Architecture

We recommend a **Two-Tier Architecture**:

### Tier 1 (Baseline — Universal & Zero-Dependency): ARCH-A

- **Engine**: Pure JavaScript `story-engine.js` running in the browser (or Web Worker).
- **Inputs**: Standard Miniflux Home entries already received by the frontend.
- **Algorithm**: RF0 lexical candidate retrieval + PF0 lexical scoring + P3 conservative clustering + H1 ordering.
- **Deployment Impact**: **ZERO new containers, ZERO new ports, ZERO server configuration.** Works immediately on every NewsFlux deployment.
- **Value**: 9.5% feed noise reduction, 2 Top-20 story cards, sub-10ms response, 100% privacy.

### Tier 2 (Optional Enhancement — High-Precision Local ML): ARCH-B

- **Engine**: Tier 1 + local Qwen3-Embedding-0.6B via existing HomeServer Ollama.
- **Deployment Impact**: Requires only an active Ollama daemon. No Python sidecar or PyTorch reranker container required.
- **Value**: Lifts PR-AUC from 0.8886 to 0.9755.

---

## 11. Implementation Roadmap (STORY-02 PR Sequence)

To maintain disciplined engineering governance, the production rollout is decomposed into small, isolated, independently auditables PRs:

```
+---------------------------------------------------------------------------------+
| PR 1: Frontend Pure JS Story Engine Port                                        |
| Merge certified `story-engine.js` into `src/utils/story-engine/` with tests.    |
| Zero UI changes. Zero activation. Pure unit-tested utility.                     |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PR 2: Home Projection Integration behind Feature Flag                           |
| Add `VITE_STORY_IDENTITY=0` (default disabled). Wire ephemeral Web Worker        |
| projection into `HomeRecent.jsx`. Verify fail-open fallback.                    |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PR 3: Visual Story Card & Drawer UI                                             |
| Implement composite card layout, source badges, and alternative article drawer. |
| Strict adherence to NewsFlux design language.                                   |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PR 4: Optional Tier 2 Ollama Embedding Provider                                 |
| Add lightweight fetch adapter for Ollama embeddings when sidecar is available.  |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PR 5: Real-Device Gate & Production Activation                                  |
| Mobile performance validation, memory audit, and feature flag default flip.     |
+---------------------------------------------------------------------------------+
```
