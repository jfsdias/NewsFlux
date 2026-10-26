# STORY-02-A0 R3: Runtime Contract Fidelity & Final Spike Gate

## 1. Executive Summary

In **STORY-02-A0 R3**, we enforce strict runtime contract fidelity between offline research algorithms and executable runtime implementations, closing all methodological gaps identified during review:

1. **Canonical Cross-Feed Contract Enforced (`CROSS_FEED_ONLY = YES`)**:
   - Implemented canonical `getFeedIdentity(article)` across Python and Node.js.
   - Out of 19,900 total pairs on the frozen `home-200` corpus, exactly 947 same-feed pairs are strictly excluded, leaving exactly **18,953 cross-feed pairs** (`CANONICAL_TOTAL_CROSSFEED_PAIRS = 18953`), matching the canonical research pair universe 100%.
   - Runtime candidate retrieval strictly rejects same-feed pairs (`SAME_FEED_PAIRS_RETRIEVED = 0`).
2. **Symmetric Per-Article Candidate Retrieval (`RF0R_RUNTIME_LEXICAL_TOP_K`)**:
   - Replaced directional indexing (`otherAid > aid`) with symmetric per-article candidate ranking: every article independently ranks all eligible cross-feed neighbors and selects top-K candidates.
   - Deterministic tie-breaking: 1. `title_overlap_coefficient` DESC, 2. `canonical_pair_key` ASC.
   - Higher numeric ID articles correctly select lower-ID neighbors.
   - Systematically evaluated $K \in \{3, 5, 10, 20, 30, 50\}$ against Gold:
     - **Pareto Champion $K=10$**: 558 candidate pairs (**97.06% pair reduction**), **100.0% Same Event pair recall** (57/57), **100.0% family connectivity recall** (10/10).
3. **Unified 24h Temporal Clustering Policy (`RESEARCH_POLICY_24H`)**:
   - Unified temporal span across Python, Node, tests, and artifacts to `R3_P3_MAX_TEMPORAL_SPAN_HOURS = 24.0`.
   - Verified that pairs with $\Delta t = 25\text{h}$ are rejected, while $\Delta t = 23\text{h}$ are eligible.
4. **Elimination of Magic Safety Thresholds**:
   - Removed arbitrary heuristic thresholds (e.g., `de_contamination <= 4 -> SAFE_ENOUGH`).
   - Replaced with strict descriptive classifications: `ZERO_OBSERVED_HARD_NEGATIVE_CONTAMINATION`, `NONZERO_HARD_NEGATIVE_CONTAMINATION`, `TOO_LOW_COVERAGE`, `INCONCLUSIVE`.
   - D0 STRICT exhibits 0 Related Topic and 4 Different Event contaminations on Gold, classified strictly as **`NONZERO_HARD_NEGATIVE_CONTAMINATION`**.
   - D1 STRICT exhibits 0 Related Topic and 1 Different Event contamination on Gold, classified as **`NONZERO_HARD_NEGATIVE_CONTAMINATION`** and **`HIGH_PAIRWISE_PRECISION_BUT_SPARSE_NON_DUO_GENERALIZATION_EVIDENCE`** (Duo recall: 1.0000, Non-Duo recall: 0.4000).
5. **False-Merge Review Pack Correction**:
   - Fixed R2 score-source bug: D0 clusters now strictly use `title_overlap_coefficient`, while D1 clusters use `qwen_embedding_cosine`.
   - Review pack regenerated as `false-merge-review-pack-v2.csv` with 12 canonical fields, reducing candidate review pairs from 25 down to **exactly 5 distinct divergent pairs** (SHA256: `90ad2bd10cdbeb99256fb98d08b2ab80c92edc78c55ecc5fb0775a2b27ec73af`).
6. **Recalculated Home-200 Compression Value**:
   - Discarded R2's 170 / 15.0% figures (which inadvertently included same-feed pairs).
   - Corrected cross-feed numbers:
     - Home items before: **200**, Home items after: **180**
     - Multi-article stories: **12**
     - Duplicate articles compressed: **20** (**10.0% noise reduction**)
     - Top-10 story cards: **1**, Top-20: **1**, Top-50: **6**, Top-100: **10**.
7. **D1 Stack Fidelity (`STACK_Q`)**:
   - Evaluated D1 with actual candidate retrieval (`RF1_QWEN_TOP_K`, $K=10$) applied before P3 clustering:
     - Home items after: **183**, Multi-article stories: **13**, Duplicate articles compressed: **17** (**8.5% noise reduction**).
8. **Final Spike Recommendation**:
   - Recommended spike outcome: **`A1_PLUMBING_ONLY_READY`**.
   - Builds frontend score provider interface, Web Worker runtime, P3 clustering, H1 placement, StoryProjection, and fail-open with fixture testing, without exposing end users to unverified negative merges.
   - `A1_ZERO_MODEL_READY` is provisional pending explicit PM acceptance of the 4 DIFFERENT_EVENT cluster contaminations on Gold.

---

## 2. Cross-Feed Candidate Contract & RF0R Retrieval

### 2.1 Feed Identity Contract

In `main`, articles in the Home feed originate from RSS subscriptions. The canonical feed identifier is resolved via `getFeedIdentity(article)`:

```typescript
function getFeedIdentity(article: Article): string {
  if (article.feed_id !== undefined && article.feed_id !== null) {
    return String(article.feed_id)
  }
  if (article.feed && typeof article.feed === "object" && article.feed.id != null) {
    return String(article.feed.id)
  }
  if (typeof article.feed === "string" || typeof article.feed === "number") {
    return String(article.feed)
  }
  if (article.feed_title) {
    return String(article.feed_title)
  }
  return ""
}
```

Two articles $u$ and $v$ are cross-feed iff `getFeedIdentity(u) !== getFeedIdentity(v)`. Same-feed pairs are strictly excluded from Story Identity candidate generation.

### 2.2 RF0R Algorithm & K Search

The runtime retrieval algorithm `RF0R_RUNTIME_LEXICAL_TOP_K` operates symmetrically:

1. For each article $A$, collect all cross-feed candidates sharing $\ge 1$ significant word via an inverted index.
2. Score candidate neighbors by `title_overlap_coefficient`.
3. Deterministic tie-break: 1. `title_overlap_coefficient` DESC, 2. `canonical_pair_key` ASC.
4. Retain top-$K$ neighbors for article $A$.
5. Canonicalize all pairs as `min(idA, idB)_max(idA, idB)` and union across all articles.

Evaluation of $K \in \{3, 5, 10, 20, 30, 50\}$ against Gold:

|  $K$   | Retrieved Pairs | Reduction (%) | Same Event Recall | Captured / Total | Family Conn. Recall | Preserved / Total | RT Cand. Rate | DE Cand. Rate |
| :----: | :-------------: | :-----------: | :---------------: | :--------------: | :-----------------: | :---------------: | :-----------: | :-----------: |
|   3    |       345       |    98.18%     |      0.6667       |     38 / 57      |        0.900        |      9 / 10       |    0.7895     |    0.3000     |
|   5    |       450       |    97.63%     |      0.8947       |     51 / 57      |        0.900        |      9 / 10       |    0.7895     |    0.3750     |
| **10** |     **558**     |  **97.06%**   |    **1.0000**     |   **57 / 57**    |      **1.000**      |    **10 / 10**    |    0.8947     |    0.4000     |
|   20   |       595       |    96.86%     |      1.0000       |     57 / 57      |        1.000        |      10 / 10      |    0.8947     |    0.4250     |
|   30   |       604       |    96.81%     |      1.0000       |     57 / 57      |        1.000        |      10 / 10      |    0.8947     |    0.4250     |
|   50   |       604       |    96.81%     |      1.0000       |     57 / 57      |        1.000        |      10 / 10      |    0.8947     |    0.4250     |

**Finding**: $K=10$ achieves 100% Same Event recall and 100% positive family connectivity with a 97.06% candidate reduction (558 pairs).

---

## 3. Coherent Executable Stacks Benchmark

### 3.1 Stack Definitions

- **STACK_Z (Zero Model)**: `RF0R (K=10) + D0 (Strict 0.3541) + P3 (24h) + H1`.
- **STACK_Q (Qwen Direct)**: `RF1 (K=10) + D1 (Strict 0.6850) + P3 (24h) + H1`.
- **LEARNED_PF1**: Reference only (requires unauthorized fitted weights/scaler).
- **PF2_SIDECAR**: Diagnostic only (85/156 pairs unranked).
- **PF3_MISTRAL**: Research reference (rejected for production).

### 3.2 Stack Comparison Scorecard

| Dimension                         | STACK_Z (Zero Model)         | STACK_Q (Qwen Direct)          | Learned PF1 (Reference) |
| :-------------------------------- | :--------------------------- | :----------------------------- | :---------------------- |
| **Candidate Retrieval**           | RF0R ($K=10$ Lexical)        | RF1 ($K=10$ Qwen Cosine)       | Full Pair Universe      |
| **Pair Scorer**                   | D0 Title Overlap Direct      | D1 Qwen Cosine Direct          | Logistic Regression     |
| **Learned Weights / Scaler**      | **ZERO**                     | **ZERO**                       | StandardScaler + LogReg |
| **Gold PR-AUC**                   | 0.8660                       | 0.9651                         | 0.9102                  |
| **Gold Precision**                | 0.7778                       | 0.9231                         | 0.7818                  |
| **Gold F0.5**                     | 0.7692                       | 0.9057                         | 0.6204                  |
| **Gold Same-Event Capture**       | 35 / 57 (61.4%)              | 19 / 57 (33.3%)                | 43 / 57 (75.4%)         |
| **False Family Merges**           | **0**                        | **0**                          | 0                       |
| **Cross-Family Clusters**         | **0**                        | **0**                          | 0                       |
| **Related Topic Contamination**   | **0**                        | **0**                          | 0                       |
| **Different Event Contamination** | 4                            | 1                              | 3                       |
| **Safety Classification**         | `NONZERO_HARD_NEGATIVE`      | `NONZERO_HARD_NEGATIVE`        | Reference               |
| **Generalization Class**          | High Non-Duo Recall (0.8667) | Sparse Non-Duo (0.4000)        | Reference               |
| **Home-200 Stories After**        | **180** (from 200)           | **183** (from 200)             | 170                     |
| **Duplicate Articles Compressed** | **20**                       | **17**                         | 30                      |
| **Noise Reduction (%)**           | **10.0%**                    | **8.5%**                       | 15.0%                   |
| **Top-20 Story Cards**            | **1**                        | **1**                          | 2                       |
| **Measured Median Latency**       | **2.31 ms**                  | ~150 ms (batch embedding)      | N/A                     |
| **Container Count**               | **0**                        | 1 (Ollama)                     | 1 (Sidecar)             |
| **Model Count**                   | **0**                        | 1 (`qwen3-embedding`)          | 2 (Embed + LR)          |
| **Privacy Profile**               | Perfect (100% on-device)     | High (local HomeServer daemon) | High                    |

---

## 4. Separation of Concerns: Representative vs Placement

Story Identity strictly decouples article presentation from feed placement:

- **Representative Policy (`D0_LEXICAL_MEDOID`)**:
  - Determines **which article's headline and content is displayed** on the composite Story Card.
  - Calculated as the member with highest aggregate pairwise lexical similarity to other cluster members:
    $$\text{rep} = \arg\max_{u \in C} \sum_{v \in C, v \neq u} \text{score}(u, v)$$
- **Placement Policy (`H1_HIGHEST_RANKED_MEMBER_POSITION`)**:
  - Determines **where the composite Story Card appears in the Home feed**.
  - Always placed at the minimum position index among its members:
    $$\text{pos} = \min_{u \in C} \text{home\_order}(u)$$
  - This preserves ranking integrity and prevents breaking news updates from collapsing downward.

---

## 5. False Merge Review Pack (V2)

The R2 review pack bug (where D0 clusters used Qwen scores) has been corrected. D0 now strictly uses `title_overlap_coefficient`, and D1 uses `qwen_embedding_cosine`.

Regenerated `false-merge-review-pack-v2.csv` contains exactly 5 divergent candidate pairs:

| Pair Key    | Gold Label      | D0 Score | D0 Thresh | Merged D0 | D1 Score | D1 Thresh | Merged D1 | Title A                                              | Title B                                                |
| :---------- | :-------------- | :------: | :-------: | :-------: | :------: | :-------: | :-------: | :--------------------------------------------------- | :----------------------------------------------------- |
| `2798_2800` | DIFFERENT_EVENT |  0.4000  |  0.3541   | **True**  |  0.4851  |  0.6850   | **False** | Sandra Hüller em 'Vingadores: Apocalipse'            | Novo trailer de Vingadores destaca retorno de heróis   |
| `2800_2801` | DIFFERENT_EVENT |  0.3333  |  0.3541   | **False** |  0.7021  |  0.6850   | **True**  | Novo trailer de Vingadores destaca retorno de heróis | Vingadores: Guerra Secreta ganha nova data de estreia  |
| `2795_2796` | DIFFERENT_EVENT |  0.4444  |  0.3541   | **True**  |  0.5210  |  0.6850   | **False** | Rumor indica novo jogo da franquia Mass Effect       | Diretor comenta cancelamento de projeto de Mass Effect |
| `2788_2790` | DIFFERENT_EVENT |  0.3750  |  0.3541   | **True**  |  0.5890  |  0.6850   | **False** | Exército investiga transmissão não autorizada        | TSE notifica canais por veiculação de propaganda       |
| `2789_2791` | DIFFERENT_EVENT |  0.4286  |  0.3541   | **True**  |  0.5412  |  0.6850   | **False** | TSE abre inquérito sobre live em quartel             | Defesa envia relatório sobre urnas eletrônicas         |

---

## 6. PR #137 Claim Reconciliation

PR #137 previously stated:

> "Q1 eliminates DIFFERENT_EVENT with zero loss 38/38"

We explicitly clarify the denominator:

- Q1 retains **38/38 base-model true positives**.
- Total Gold SAME_EVENT pairs are **57**.
- Thus, Q1 captures **38/57 total Gold SAME_EVENT pairs (66.7% recall)**.

---

## 7. Runtime Spike Outcomes & Recommendations

### Spike Gate Status

- `A1_ZERO_MODEL_READY`: **PROVISIONAL_PENDING_PM_ACCEPTANCE**
  - Requires zero models, zero containers, runs in 2.3 ms with 10.0% noise reduction.
  - However, exhibits 4 DIFFERENT_EVENT cluster contaminations on Gold. Research does not label this "SAFE_ENOUGH" on its own authority; PM must determine risk tolerance.
- `A1_QWEN_DIRECT_READY`: **NOT_RECOMMENDED**
  - Exhibits sparse non-Duo generalization evidence (0.4000 recall on non-Duo families) and requires local Ollama infrastructure.
- `A1_PLUMBING_ONLY_READY`: **RECOMMENDED_BY_RESEARCH**
  - Focuses the upcoming STORY-02-A1 spike on runtime plumbing:
    1. Score Provider Interface (supporting mock, lexical, and future semantic providers).
    2. Web Worker background execution.
    3. Conservative P3 clustering engine.
    4. H1 ranking preservation placement.
    5. StoryProjection data structures.
    6. Feature flag gating (`VITE_STORY_IDENTITY_ENABLED = 0`).
    7. Fail-open fallback to unclustered feed.
    8. Interactive verification via synthetic fixtures.

This approach delivers the complete architectural pipeline safely, without exposing users to hard negative merges in production.
