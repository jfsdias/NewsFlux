# STORY-02-A0 R4: Final Stack Fidelity & Accounting Closure

## 1. Executive Summary

In **STORY-02-A0 R4**, we complete the final accounting closure and stack fidelity verification for Story Identity architecture on NewsFlux, guaranteeing that every metric and decision in the final A0 scorecard is derived from the **exact executable stack** it describes on full `home-200`, rather than an isolated Gold subgraph:

1. **Two Distinct Safety Surfaces Established**:
   - **`PAIR_SCORER_GOLD_SUBGRAPH_SAFETY` (Diagnostic)**: Evaluates pairwise scoring on the isolated 156-pair Gold subgraph (D0: 4 Different Event contaminations; D1: 1 Different Event contamination).
   - **`FULL_STACK_GOLD_OBSERVATION` (Canonical Architecture Safety)**: Derived from running the complete 200-article Home feed through candidate retrieval (RF0R / RF1), pair scoring, P3 clustering (24h temporal policy), and checking whether any of the 156 Gold pairs become co-clustered (directly or indirectly via intermediate non-Gold articles).
     - **Stack Z (Zero Model)**: Captures **26/57 Same Event** pairs (45.61%), **0 Related Topic** contaminations, **5 Different Event** contaminations, and **0 False Family Merges**.
     - **Stack Q (Qwen Direct, STRICT 0.6850)**: Captures **19/57 Same Event** pairs (33.33%), **0 Related Topic** contaminations, **1 Different Event** contamination, and **0 False Family Merges**.
2. **D1 Retrieved Pair Count Single Source of Truth (`RF1_QWEN_TOP_K`)**:
   - Reconciled discrepancy: In R3 handoff text, "605" was a historical typo/stale literal from a subset run.
   - On full `home-200`, $K=10$ Qwen cosine candidate retrieval produces exactly **1,650 unique undirected pairs** ($200 \times 10 = 2,000$ directed edges $\to 1,650$ unique pairs after canonical deduplication, achieving **91.29% reduction** from 18,953 cross-feed pairs).
   - 1,650 is enforced as the single source of truth across all code, tests, and scorecards.
3. **True 10-Family Macro Recall**:
   - Replaced the approximate two-bucket average `(duo + non_duo)/2` with true macro recall across all 10 positive episode families:
     - **D0 Title Overlap Direct**:
       - True 10-Family Macro Recall: **0.7690**
       - Non-Duo Family Macro Recall: **0.7778**
       - Duo Pair Recall: **0.6905**
       - Non-Duo Pair Recall: **0.8667**
     - **D1 Qwen Cosine Direct**:
       - True 10-Family Macro Recall: **0.6333**
       - Non-Duo Family Macro Recall: **0.5926**
       - Duo Pair Recall: **1.0000**
       - Non-Duo Pair Recall: **0.4000** (Sparse Non-Duo Generalization Evidence)
4. **Unknown Feed Safety Contract (`UNKNOWN_FEED_NOT_ELIGIBLE`)**:
   - Candidate retrieval strictly requires both feeds to be known and non-empty: `feed_a_known && feed_b_known && feed_a !== feed_b`.
   - Unknown vs known and unknown vs unknown pairs are strictly rejected from candidate generation. Articles with missing feeds remain safe, unclustered singletons (fail-open).
5. **4-Way Cryptographic Parity Verified (Python $\leftrightarrow$ Node.js)**:
   - Verified 100% bit-for-bit equality across all four pipeline stages on Home-200:
     - **Candidate Set SHA256**: `5a3d36d6f1cbc2341be511bdb72c7a8eaddab8b90f86b86f35c1f18431fb7fd2` (558 pairs)
     - **Pair Score SHA256**: `e58557dbf79266e1aa448c0356f1f852ab7f1aa73721bacaadb65e8616f4e4b9`
     - **Cluster Membership SHA256**: `0f695257fa3f8260eed113ad378e3212a8f74637e7897ccca87532b90ac15c52` (180 stories)
     - **Story Projection Semantic SHA256**: `0b8bc7bf3ab2ded2525e0e726160cf10cf9957e56bdbde52f396e0f5a941318a`
6. **Full-Stack Review Pack (`false-merge-full-stack-review-pack-v1.csv`)**:
   - Contains 14 canonical fields: `pair_key, gold_label, candidate_retrieved_stack_z, d0_score, merged_in_stack_z, candidate_retrieved_stack_q, d1_score, merged_in_stack_q, title_a, title_b, feed_a, feed_b, cluster_members_stack_z, cluster_members_stack_q`.
   - Contains exactly 6 review pairs:
     - Stack Z contaminated pairs (5): `17692:17807`, `17709:17847`, `17809:17939`, `17692:17771`, `17689:17807`.
     - Stack Q contaminated pair (1): `17742:17830` (Jack Dorsey Block speech model vs Dessa speech model).
7. **Scorecard Traceability & Elimination of Hardcoded Literals**:
   - `architecture-r4-scorecard-v1.json` derives every field dynamically from executed artifacts and includes complete `source_receipts`.
   - Stack Q evaluates operating point `STRICT` (0.6850), retaining `sensitivity_median` (0.6789) as secondary diagnostic sensitivity only.
8. **Final Spike Recommendation**:
   - Recommended spike outcome: **`A1_PLUMBING_ONLY_READY`**.
   - Advances frontend score provider interface, Web Worker runtime, P3 clustering, H1 placement, StoryProjection, feature flag gate, and fail-open with fixture testing, without exposing end users to hard negative merges.

---

## 2. Full-Stack Home-200 Safety vs Gold Subgraph Safety

In offline ML research, pairwise classifiers are often evaluated on isolated test graphs consisting solely of labeled pairs. In production, however, articles are clustered in a dense real-world feed where unlabeled intermediate articles can bridge separate events.

To guarantee zero false claims, R4 maintains two explicitly distinct safety surfaces:

| Dimension                          | PAIR_SCORER_GOLD_SUBGRAPH_SAFETY  | FULL_STACK_GOLD_OBSERVATION                                                             |
| :--------------------------------- | :-------------------------------- | :-------------------------------------------------------------------------------------- |
| **Execution Surface**              | Isolated Gold 156-pair graph      | Full 200-article Home feed                                                              |
| **Candidate Retrieval**            | None (Gold pairs scored directly) | RF0R ($K=10$, 558 pairs) / RF1 ($K=10$, 1650 pairs)                                     |
| **Clustering Context**             | Gold articles only                | All 200 Home articles clustered with P3 (24h)                                           |
| **Transitive Bridges**             | Only Gold edges                   | Real intermediate articles in Home feed                                                 |
| **Stack Z Different Event Contam** | 4 pairs                           | **5 pairs** (`17692:17807`, `17709:17847`, `17809:17939`, `17692:17771`, `17689:17807`) |
| **Stack Q Different Event Contam** | 1 pair                            | **1 pair** (`17742:17830`)                                                              |
| **False Family Merges**            | 0                                 | **0** (Both stacks preserve 100% cross-family isolation)                                |
| **Purpose**                        | Diagnostic model evaluation       | **Canonical Product Architecture Safety**                                               |

### Root Cause Analysis of Stack Z Full-Stack Contaminations

Stack Z exhibits 5 Different Event contaminations under full-stack execution:

1. `17692:17807` & `17689:17807` & `17692:17771`: iPhone Duo review articles co-clustered with a Brazilian tech podcast summarizing the launch ("MacMagazine no Ar #705: pré-venda do iPhone Duo"). While related to the broader topic of iPhone Duo, Gold ground truth strictly marks podcast roundups as DIFFERENT_EVENT from individual hardware reviews.
2. `17709:17847`: 1990s PC gaming retrospectives merged with handheld emulation videos ("SteamOS e JOGOS DE PC RODANDO no CELULAR").
3. `17809:17939`: Garmin battery drain articles merged due to generic keywords ("Quick Study" vs "Quick Fix").

Stack Q exhibits only 1 Different Event contamination:

- `17742:17830`: Block's conversational speech model merged with Dessa's full-duplex speech model. Both articles discuss speech AI models released on the same day with strong semantic cosine similarity (0.7362 > 0.6850), leading to an erroneous merge.

---

## 3. Coherent Executable Stacks Benchmark (R4)

| Dimension                            | STACK_Z_ZERO_MODEL       | STACK_Q_QWEN_DIRECT (STRICT) | STACK_Q (MEDIAN Sensitivity) | Learned PF1 (Reference) |
| :----------------------------------- | :----------------------- | :--------------------------- | :--------------------------- | :---------------------- |
| **Retrieval Method**                 | RF0R ($K=10$ Lexical)    | RF1 ($K=10$ Qwen)            | RF1 ($K=10$ Qwen)            | Full Pair Universe      |
| **Retrieved Pairs**                  | **558** (97.06% red.)    | **1,650** (91.29% red.)      | **1,650** (91.29% red.)      | 18,953                  |
| **Score Method**                     | D0 Title Overlap Direct  | D1 Qwen Cosine Direct        | D1 Qwen Cosine Direct        | LogReg + StandardScaler |
| **Learned Weights / Scaler**         | **ZERO**                 | **ZERO**                     | **ZERO**                     | Scaler + Coefficients   |
| **Operating Threshold**              | **0.3541**               | **0.6850**                   | **0.6789**                   | 0.5000                  |
| **Gold Pair PR-AUC**                 | 0.8660                   | 0.9651                       | 0.9651                       | 0.9102                  |
| **Gold Pair Precision**              | 0.7778                   | 0.9231                       | 0.9231                       | 0.7818                  |
| **True 10-Family Macro Recall**      | **0.7690**               | **0.6333**                   | **0.6333**                   | Reference               |
| **Non-Duo Family Macro Recall**      | **0.7778**               | **0.5926**                   | **0.5926**                   | Reference               |
| **Duo Pair Recall**                  | 0.6905                   | 1.0000                       | 1.0000                       | Reference               |
| **Non-Duo Pair Recall**              | **0.8667**               | **0.4000**                   | **0.4000**                   | Reference               |
| **Generalization Classification**    | High Non-Duo Recall      | Sparse Non-Duo Evidence      | Sparse Non-Duo Evidence      | Reference               |
| **Full Home Same Event Capture**     | **26 / 57 (45.61%)**     | **19 / 57 (33.33%)**         | 19 / 57 (33.33%)             | Reference               |
| **Full Home Related Topic Contam**   | **0**                    | **0**                        | 0                            | Reference               |
| **Full Home Different Event Contam** | **5**                    | **1**                        | 1                            | Reference               |
| **Full Home False Family Merges**    | **0**                    | **0**                        | 0                            | Reference               |
| **Home-200 Stories After**           | **180** (from 200)       | **185** (from 200)           | **183** (from 200)           | 170                     |
| **Duplicate Articles Compressed**    | **20**                   | **15**                       | **17**                       | 30                      |
| **Noise Reduction (%)**              | **10.0%**                | **7.5%**                     | **8.5%**                     | 15.0%                   |
| **Top-20 Story Cards**               | **1**                    | **2**                        | 2                            | 2                       |
| **Measured Median Latency**          | **3.36 ms**              | ~150 ms (batch embed)        | ~150 ms (batch embed)        | N/A                     |
| **Container Count**                  | **0**                    | 1 (Ollama daemon)            | 1 (Ollama daemon)            | 1 (Sidecar)             |
| **Model Count**                      | **0**                    | 1 (`qwen3-embedding`)        | 1 (`qwen3-embedding`)        | 2 (Embed + LR)          |
| **Privacy Profile**                  | Perfect (100% on-device) | High (local daemon)          | High (local daemon)          | High                    |

---

## 4. Unknown Feed Safety Contract

In feed aggregation architectures, missing metadata must never cause accidental co-clustering. NewsFlux enforces:

```typescript
function isPairEligible(feedA: string, feedB: string): boolean {
  return Boolean(feedA) && Boolean(feedB) && feedA !== feedB
}
```

- If either article's feed identity cannot be resolved (evaluates to `""`), the pair is ineligible for candidate retrieval.
- Unidentified articles bypass pair scoring and clustering, passing directly through to the Home feed as unclustered singletons (`member_count = 1`).
- This guarantees fail-open safety under incomplete RSS ingest.

---

## 5. Python $\leftrightarrow$ Node.js Cryptographic Parity Contract

To eliminate translation discrepancies between Python research harnesses and Node.js runtime code, R4 verifies 4-way cryptographic SHA256 parity on the canonical `home-200` corpus:

1. **Canonical Candidate Set SHA256**:
   - `5a3d36d6f1cbc2341be511bdb72c7a8eaddab8b90f86b86f35c1f18431fb7fd2`
   - Formed by sorting canonical candidate keys `min(u, v)_max(u, v)` joined by `\n`. Exactly 558 pairs.
2. **Canonical Pair Score SHA256**:
   - `e58557dbf79266e1aa448c0356f1f852ab7f1aa73721bacaadb65e8616f4e4b9`
   - Formed by sorting candidate keys with 4-decimal rounded scores `${key},${score.toFixed(4)}` joined by `\n`.
3. **Canonical Cluster Membership SHA256**:
   - `0f695257fa3f8260eed113ad378e3212a8f74637e7897ccca87532b90ac15c52`
   - Formed by canonicalizing inner cluster member IDs (sorted ASC) and sorting clusters by `(first_id, length)`.
4. **Canonical Story Projection Semantic SHA256**:
   - `0b8bc7bf3ab2ded2525e0e726160cf10cf9957e56bdbde52f396e0f5a941318a`
   - Formed by sorting projections by `(h1_home_position, story_id)` and emitting `{story_id, member_article_ids, representative_article_id, h1_home_position}`.

Both test runners (`test_direct_scorer_benchmark.py` and `test-direct-story-pipeline.js`) assert exact equality to these cryptographic benchmarks.

---

## 6. Runtime Spike Outcomes & Final Recommendations

### Spike Gate Evaluation

1. `A1_ZERO_MODEL_READY`: **PROVISIONAL_PENDING_PM_ACCEPTANCE**
   - **Pros**: Sub-4ms execution, zero machine learning containers, zero downloaded model weights, 10.0% noise reduction, 0 Related Topic contaminations, 0 False Family Merges.
   - **Cons**: Exhibits 5 Different Event cluster contaminations on full Home-200. Because false merge cost strictly exceeds false split cost (`FALSE_MERGE_COST > FALSE_SPLIT_COST`), deploying D0 directly to end users without human review carries negative-merge risk.
2. `A1_QWEN_DIRECT_READY`: **NOT_RECOMMENDED_FOR_SPIKE**
   - **Pros**: Only 1 Different Event contamination on full Home-200.
   - **Cons**: Sparse non-Duo generalization evidence (0.4000 recall on non-Duo families), requires local Ollama infrastructure, higher latency (~150ms).
3. `A1_PLUMBING_ONLY_READY`: **RECOMMENDED_BY_RESEARCH**
   - Advances frontend score provider interface, Web Worker runtime, conservative P3 clustering engine, H1 ranking preservation placement, StoryProjection data structures, feature flag gating (`VITE_STORY_IDENTITY_ENABLED = 0`), fail-open fallback, and fixture testing.
   - Enables complete engineering verification without exposing users to hard negative merges.

---

## 7. Artifact Manifest (R4)

All R4 private artifacts are stored in `/tmp/newsflux-story02-a0-r4/`:

| Artifact                                     | Size    | Description                                                                                  |
| :------------------------------------------- | :------ | :------------------------------------------------------------------------------------------- |
| `architecture-r4-scorecard-v1.json`          | 7.9 KB  | Complete A0 architecture scorecard with dynamic source receipts                              |
| `stack-z-full-home-gold-observation-v1.json` | 2.0 KB  | Stack Z full Home-200 gold safety observations (26/57 SE, 0 RT, 5 DE, 0 false family merges) |
| `stack-q-full-home-gold-observation-v1.json` | 2.0 KB  | Stack Q full Home-200 gold safety observations (19/57 SE, 0 RT, 1 DE, 0 false family merges) |
| `cluster-safety-r4-v1.json`                  | 10.3 KB | Full cluster safety breakdown across thresholds and operating points                         |
| `false-merge-full-stack-review-pack-v1.csv`  | 1.7 KB  | 14 canonical fields across 6 contaminated pairs in Stacks Z and Q                            |
| `family-recall-breakdown-v1.json`            | 2.9 KB  | True 10-family macro recall evaluation and per-family breakdown                              |
| `python-node-exact-parity-v1.json`           | 1.5 KB  | 4-way cryptographic SHA256 parity verification receipts                                      |
| `d0-crossfeed-runtime-pipeline-v1.json`      | 1.2 KB  | Benchmark latency and timing breakdown across batch sizes                                    |
| `d0-crossfeed-home-projection-v1.json`       | 65.8 KB | Full 180 StoryProjection objects on Home-200                                                 |
| `rf0r-retrieval-benchmark-v1.json`           | 5.1 KB  | Candidate retrieval K parameter search results ($K \in \{3, 5, 10, 20, 30, 50\}$)            |
