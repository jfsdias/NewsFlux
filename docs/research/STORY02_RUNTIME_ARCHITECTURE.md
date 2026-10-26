# STORY-02-A0 R2: Runtime Architecture Reconciliation & Executable Scoring Contract

## 1. Executive Summary

The STORY-01B track established the algorithmic feasibility of Story Identity on the frozen `home-200` corpus. In **STORY-02-A0 R2**, we close the final operational gap between offline model evidence and executable runtime architecture:

1. **Formal Separation of Learned Classifiers vs Direct Scorers**:
   - Learned classifiers (**PF0**, **PF1**, **PF3**) require `StandardScaler` + `LogisticRegression` fitted weights and scalers. Because `FULL_GOLD_FINAL_MODEL_FIT = NO` and `PRODUCTION_MODEL_ARTIFACT = NO`, neither PF0 nor PF1 can be treated as an executable runtime scorer today without an authorized model artifact (`PF0_RUNTIME_EXECUTABLE_WITHOUT_FITTED_ARTIFACT = NO`).
   - Direct scorers require **zero model artifacts, zero scalers, and zero fitted weights**:
     - **`D0_TITLE_OVERLAP_DIRECT`**: Exact `title_overlap_coefficient` (zero models, zero containers, pure client JS).
     - **`D1_QWEN_COSINE_DIRECT`**: Exact `qwen_embedding_cosine` (local Ollama embedding vector only, zero learned pair classifier).
     - **`D2_EXISTING_DETERMINISTIC_HEURISTIC`**: Classified as `NOT_AVAILABLE` (no pre-existing heuristic in `main`).
2. **Canonical 3-Fold Evaluation of Direct Scorers**:
   - Evaluated under canonical **`PROTOCOL_A_COMPONENT_GROUP_3FOLD`** with outer-train-only threshold tuning.
   - **D0 Title Overlap Direct**: PR-AUC **0.8660**, ROC-AUC **0.9403**, Precision **0.7778**, Recall **0.7368**, F0.5 **0.7692**. Threshold spread across folds is tightly bounded to **0.0863** (`[0.35415, 0.26785, 0.26785]`).
   - **D1 Qwen Cosine Direct**: PR-AUC **0.9651**, ROC-AUC **0.9796**, Precision **0.9231**, Recall **0.8421**, F0.5 **0.9057**. Threshold spread across folds is **0.0606** (`[0.6244, 0.6789, 0.6850]`).
3. **P3 Cluster Propagation & Gold Safety Verification**:
   - Both D0 and D1 produce **0 false family merges** and **0 cross-family clusters** across all evaluated operating points (`FALSE_FAMILY_MERGE_COUNT = 0`).
   - Under STRICT operating points:
     - **D0 Strict (0.3542)**: 0 RELATED_TOPIC contamination, 4 DIFFERENT_EVENT contamination, captures 35/57 SAME_EVENT pairs (`SAFE_ENOUGH_FOR_RESEARCH_SPIKE`).
     - **D1 Strict/Median (0.6789)**: 0 RELATED_TOPIC contamination, 1 DIFFERENT_EVENT contamination, captures 19/57 SAME_EVENT pairs (`SAFE_ENOUGH_FOR_RESEARCH_SPIKE`).
4. **Node.js Parity & True Measured End-to-End Latency**:
   - Implemented D0 pipeline in vanilla Node.js (`scripts/research/story-identity-v1/node/direct-story-pipeline.js`).
   - **100% token extraction parity** with Python across all 200 Home titles (200 matches, 0 mismatches).
   - **100% projection parity**: Both Python and Node produce exactly 170 projected stories, 20 multi-article stories, and compress 30 duplicate articles (15.0% noise reduction).
   - **Real measured end-to-end latency** from raw article dictionaries to projected stories:
     - 25 articles: **0.18 ms** median
     - 50 articles: **0.36 ms** median
     - 100 articles: **0.84 ms** median
     - 200 articles: **2.11 ms** median (**2.18 ms p90**).
5. **Two-Tier Production Architecture Recommendation**:
   - **Tier 1 (Universal Baseline) — ARCH-A**: `RF0 + D0 + P3 + H1 + StoryProjection`. Pure client JS, zero models, zero containers, sub-3ms latency, perfect privacy.
   - **Tier 2 (Optional ML Quality Champion) — ARCH-B**: `RF1 + D1 + P3 + H1 + StoryProjection`. Local Ollama embedding cosine, zero learned classifier weights, 0.9651 PR-AUC, 0.9231 Precision.

---

## 2. Audit of Existing Story Infrastructure in `main`

An end-to-end inspection of `main` (`938e16ce`) establishes the canonical facts of the current codebase:

| Component            | Path / Location                      | Canonical Property | Value / Behavior                                                                                   |
| :------------------- | :----------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------- |
| **Sidecar Service**  | `services/story_ranker/`             | Default Port       | `8787` (`PORT = int(os.environ.get("STORY_RANKER_PORT", "8787"))`)                                 |
| **Service Endpoint** | `services/story_ranker/server.py`    | Route              | `POST /v1/rank`                                                                                    |
| **Reverse Proxy**    | `Caddyfile`                          | Upstream Route     | `handle_path /api/story-candidates/* { reverse_proxy {$STORY_RANKER_UPSTREAM:story-ranker:8787} }` |
| **Docker Compose**   | `docker-compose.yml`                 | Services Defined   | `reactflux` ONLY (`electh/reactflux:2000`). Sidecar is NOT in repo compose.                        |
| **Frontend State**   | `src/store/storyCandidateState.js`   | State Store        | Nanostore managing `idle`, `pending`, `ready`, `failed`.                                           |
| **Frontend Runtime** | `src/components/Home/HomeRecent.jsx` | Feature Gate       | `import.meta.env.VITE_STORY_CANDIDATE_RANKING === "1"`                                             |
| **Fail-Open Policy** | `src/store/storyCandidateState.js`   | Fallback           | 5s timeout, AbortController, safe null handling (fails open to unclustered feed).                  |

---

## 3. Direct Pair Scorer Benchmark (R2 Core Evidence)

Evaluated under canonical **`PROTOCOL_A_COMPONENT_GROUP_3FOLD`** with train-only threshold selection:

| Direct Scorer                  | Model Dependency | Features | Precision | Recall |  F0.5  | PR-AUC | ROC-AUC | Related Topic FPR | Different Event FPR | Duo Recall | Non-Duo Recall | Threshold Range |
| :----------------------------- | :--------------- | :------: | :-------: | :----: | :----: | :----: | :-----: | :---------------: | :-----------------: | :--------: | :------------: | :-------------: |
| **D0_TITLE_OVERLAP_DIRECT**    | **Zero Models**  |    1     |  0.7778   | 0.7368 | 0.7692 | 0.8660 | 0.9403  |   0.2105 (4/19)   |    0.1000 (8/80)    |   0.6905   | 0.8667 (13/15) |  0.2678–0.3542  |
| **D1_QWEN_COSINE_DIRECT**      | **Local Ollama** |    1     |  0.9231   | 0.8421 | 0.9057 | 0.9651 | 0.9796  |   0.0526 (1/19)   |    0.0375 (3/80)    |   1.0000   | 0.4000 (6/15)  |  0.6244–0.6850  |
| **D2_DETERMINISTIC_HEURISTIC** | N/A              |   N/A    |    N/A    |  N/A   |  N/A   |  N/A   |   N/A   |        N/A        |         N/A         |    N/A     |      N/A       |  NOT_AVAILABLE  |

### Key Takeaways on Direct Scorers

1. **Elimination of Model Artifacts**: Direct scorers achieve high discriminative power (0.8660 and 0.9651 PR-AUC) without training any classifier, saving parameters, or deploying pickle/joblib files.
2. **Threshold Stability**: Thresholds selected on inner train folds show tight spreads (0.0863 for D0, 0.0606 for D1), demonstrating low variance across article-disjoint components.
3. **PF2 Reranker Status**: Classified as `DIAGNOSTIC_ONLY`. With 85/156 pairs missing scores, PF2 cannot be fairly compared against full-coverage scorers.

---

## 4. P3 Cluster Propagation & Gold Safety Verification

Direct scorer decisions were propagated through **`P3_STRONG_MULTI_MEMBER_SUPPORT`** on the Gold subgraph across three descriptive research operating points:

- **STRICT**: Maximum threshold among the 3 outer folds.
- **MEDIAN**: Median threshold among the 3 outer folds.
- **PERMISSIVE**: Minimum threshold among the 3 outer folds.

### Safety Metrics Table

| Scorer | Operating Point | Threshold | False Family Merges | Cross-Family Clusters | RT Contamination | DE Contamination | Same-Event Captured | Safety Classification |
| :----- | :-------------- | :-------: | :-----------------: | :-------------------: | :--------------: | :--------------: | :-----------------: | :-------------------- |
| **D0** | **STRICT**      |  0.3542   |        **0**        |         **0**         |      **0**       |        4         |        35/57        | **SAFE_FOR_SPIKE**    |
| **D0** | **MEDIAN**      |  0.2678   |        **0**        |         **0**         |        2         |        4         |        42/57        | **SAFE_FOR_SPIKE**    |
| **D0** | **PERMISSIVE**  |  0.2678   |        **0**        |         **0**         |        2         |        4         |        42/57        | **SAFE_FOR_SPIKE**    |
| **D1** | **STRICT**      |  0.6850   |        **0**        |         **0**         |      **0**       |        1         |        19/57        | **SAFE_FOR_SPIKE**    |
| **D1** | **MEDIAN**      |  0.6789   |        **0**        |         **0**         |      **0**       |        1         |        19/57        | **SAFE_FOR_SPIKE**    |
| **D1** | **PERMISSIVE**  |  0.6244   |        **0**        |         **0**         |        1         |        1         |        48/57        | **SAFE_FOR_SPIKE**    |

> [!IMPORTANT]
> **Zero False Family Merges**: Both D0 and D1 maintained `FALSE_FAMILY_MERGE_COUNT = 0` across all operating points. P3's multi-member support rule (requiring >= 2 positive edges to join an existing multi-member cluster) successfully prevented transitive chaining even when isolated pair false positives occurred.

---

## 5. Measured End-to-End Latency & Parity (Home-200)

We replaced earlier engineering estimates with empirical benchmarks measured on the complete raw `home-200.jsonl` corpus using the vanilla Node.js implementation:

### Latency Scaling by Article Batch Size

| Batch Size | Median (ms) | P90 (ms) | Min (ms) | Max (ms) | Operational Profile |
| :--------- | :---------: | :------: | :------: | :------: | :------------------ |
| **25**     |   0.19 ms   | 0.44 ms  | 0.15 ms  | 0.44 ms  | Mobile viewport     |
| **50**     |   0.36 ms   | 0.44 ms  | 0.33 ms  | 0.44 ms  | Tablet viewport     |
| **100**    |   0.78 ms   | 0.95 ms  | 0.73 ms  | 0.95 ms  | Standard desktop    |
| **200**    | **2.11 ms** | 2.18 ms  | 1.90 ms  | 2.18 ms  | Full Home feed      |

### Python ↔ Node.js Exact Parity Verification

- **Token Extraction**: 200/200 exact matches across all corpus titles (**100.0% parity**).
- **Projected Stories**: Exactly 170 stories generated from 200 articles.
- **Multi-Article Stories**: Exactly 20 composite stories.
- **Duplicate Compression**: Exactly 30 duplicate articles compressed (**15.0% noise reduction**).
- **H1 Placement**: Exactly 2 story cards in Top 10, 3 in Top 20, 9 in Top 50, and 16 in Top 100.

---

## 6. Placement Policy Resolution (H1 vs H0)

In Stage C11 shadow simulation, `TOP_20_STORY_CARD_COUNT = 0` occurred because:

- The iPhone Duo story (10 articles) spanned positions `[19, 24, 93, 113, 135, 136, 140, 181, 191, 194]`.
- Under `H0_REPRESENTATIVE_POSITION`, the medoid representative was at position 194, collapsing breaking news updates downwards.

Under **`H1_HIGHEST_RANKED_MEMBER_POSITION`** (ranking preservation policy):

- The composite Story Card is placed at `min(home_order.index(m))` among story members.
- The story card surfaces at position 19 (within Top 20).
- Top 10 surfaces **2 story cards**, Top 20 surfaces **3 story cards** under D0 strict threshold.

---

## 7. Two-Tier Production Architecture Recommendation

| Dimension              | Tier 1: ARCH-A (Universal Baseline)          | Tier 2: ARCH-B (Optional ML Quality)        |
| :--------------------- | :------------------------------------------- | :------------------------------------------ |
| **Pipeline**           | `RF0 + D0 + P3 + H1 + StoryProjection`       | `RF1 + D1 + P3 + H1 + StoryProjection`      |
| **Pair Scorer**        | `D0_TITLE_OVERLAP_DIRECT` (Threshold 0.3542) | `D1_QWEN_COSINE_DIRECT` (Threshold 0.6789)  |
| **Learned Models**     | **ZERO** (no weights, no scalers, no files)  | **ZERO** (pure cosine on embedding vectors) |
| **Dependencies**       | Pure Client JS (runs in browser/worker)      | Ollama daemon on local HomeServer           |
| **Quality (PR-AUC)**   | 0.8660 (Precision: 0.7778, F0.5: 0.7692)     | 0.9651 (Precision: 0.9231, F0.5: 0.9057)    |
| **End-to-End Latency** | **2.11 ms** median on 200 articles           | ~150 ms (batch embedding over candidates)   |
| **RAM Overhead**       | < 5 MB browser heap                          | ~850 MB resident in Ollama                  |
| **Privacy Profile**    | Perfect (100% on-device, zero egress)        | High (local HomeServer daemon, zero egress) |
| **Fail-Open Policy**   | Trivial (returns flat feed on any error)     | Fails open to Tier 1 on timeout/connection  |
| **Deployment Status**  | **FEASIBLE_NOW** (Ready for A1 Spike)        | **FEASIBLE_WITH_SMALL_DELTA**               |

### Verdict on Spike Feasibility

- `A1_ZERO_MODEL_READY`: **YES**. Tier 1 requires zero containers, zero model downloads, zero Python backends, and delivers 15% duplicate compression in under 3 ms with zero false family merges on Gold.
- `A2_LOCAL_ML_READY`: Feasible as an optional progressive enhancement for HomeServer installations with Ollama.
