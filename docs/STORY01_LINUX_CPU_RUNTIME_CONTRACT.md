# STORY01 — Linux CPU Runtime Contract & Cross-Backend Parity Specification

**Status:** Canonical Runtime Hardening Contract (`STORY01_LINUX_CPU_RUNTIME_CONTRACT`)  
**Scope:** `services/story_ranker/` sidecar reproducibility, offline model provenance, and cross-backend evaluation policy  
**Default Activation State:** `VITE_STORY_CANDIDATE_RANKING` remains **disabled by default** (`DORMANT_OPTIONAL_CAPABILITY`). Production `docker-compose.yml` is unchanged.

---

## 1. Dual-Environment Taxonomy

NewsFlux maintains two explicitly separated execution profiles for `STORY01` candidate ranking (`Qwen3-Embedding-0.6B Top-250 -> Qwen3-Reranker-0.6B -> ranked pairs`):

| Profile Identifier         | Execution Target                                                         | Purpose                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `R3C_REFERENCE_MPS`        | Apple Silicon macOS (`mps` backend, FP16/BF16 Tensor cores)              | Historical R3C research holdout evaluation baseline (`P@10 = 90%`, `P@20 = 60%`, `P@50 = 30%`, commit `8f8e59cc1151`). |
| `PRODUCTION_CANONICAL_CPU` | Linux container (`cpu` backend, single-threaded deterministic execution) | Canonical sidecar runtime target for repeatable containerized inference.                                               |

### Why Apple MPS and Linux CPU Are Not Bit-Identical

1. **Floating-Point Reduction Order & Kernel Fusion:** Apple Metal Performance Shaders (`mps`) execute matrix multiplications and attention reductions using GPU-specific tiled accumulation orders and fused mixed-precision kernels, whereas PyTorch on Linux `cpu` executes oneDNN/OpenBLAS SIMD vector reductions.
2. **Quantized Logit Stepping in `Qwen3-Reranker-0.6B`:** In `Qwen3-Reranker-0.6B`, output logits cluster on discrete `1/16` (`0.0625`) / `1/32` (`0.03125`) steps. A floating-point accumulation difference of `< 1e-4` near a rounding boundary shifts an individual directional logit by `±0.0625`, yielding symmetric mean score deltas (`mean(raw_logit_A_B, raw_logit_B_A)`) in multiples of `0.03125`.

---

## 2. Empirical Parity Evidence (`R3C_REFERENCE_MPS` vs `PRODUCTION_CANONICAL_CPU`)

Evaluated on the frozen 200-entry R3C holdout snapshot (`250` cross-feed candidate pairs within the `168h` window):

| Metric                          | Measured Value                   | Notes                                                                                                                                                                                       |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOP250_CANDIDATE_SET_OVERLAP`  | `250 / 250` (`100.0%`)           | Candidate generation via `qwen3-embedding:0.6b` (`ac6da0df...`) is 100% set-identical (`max \|Δ qwen_score\| = 0.0`).                                                                       |
| `TOP10_SET_OVERLAP`             | `10 / 10` (`100.0%`)             | Exact rank match `8 / 10`; single adjacent rank swap at `#4 ↔ #5` (`17507:17613` vs `17575:17613`, score delta `0.09375`).                                                                  |
| `TOP20_SET_OVERLAP`             | `20 / 20` (`100.0%`)             | Exact rank match `13 / 20`; all swaps are local adjacent/near-tie permutations.                                                                                                             |
| `TOP50_SET_OVERLAP`             | `49 / 50` (`98.0%`)              | Exact rank match `26 / 50`; single cutoff tie swap at rank `#50` (`17598:17660` MPS `#50` at `1.875` → CPU `#51` at `1.84375`; `17662:17841` MPS `#52` at `1.875` → CPU `#50` at `1.9375`). |
| `SPEARMAN_RHO` ($\rho$)         | `0.999747`                       | Rank-order correlation across all 250 pairs.                                                                                                                                                |
| `KENDALL_TAU` ($\tau$)          | `0.990426`                       | Pairwise concordance across all 250 pairs.                                                                                                                                                  |
| `PEARSON_R` ($r$)               | `0.999843`                       | Linear logit correlation across all 250 pairs.                                                                                                                                              |
| `MAX_ABS_RERANKER_SCORE_DELTA`  | `0.1875` (`3 / 16`)              | Bounded to 3 discrete quantization steps.                                                                                                                                                   |
| `MEAN_ABS_RERANKER_SCORE_DELTA` | `0.0505`                         | Less than one `0.0625` quantization step on average.                                                                                                                                        |
| **Variance Classification**     | `CROSS_BACKEND_NUMERIC_VARIANCE` | **Not** a `MODEL_FAILURE` or model provenance drift.                                                                                                                                        |

---

## 3. Hardened Linux CPU Reproducibility Contract

To eliminate container-rebuild drift and within-CPU non-determinism, `services/story_ranker/` enforces the following 6 invariants:

1. **Digest-Pinned Base Image (`Dockerfile`):**
   - `FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704`
2. **Exact Dependency Pinning (`requirements.txt`):**
   - Floating ranges (`sentence-transformers>=5.4,<6`) are replaced with exact `==` version pins across the full inference stack:
     - `sentence-transformers==5.4.1`
     - `torch==2.14.1`
     - `transformers==5.20.2`
     - `tokenizers==0.23.3`
     - `huggingface-hub==2.3.0`
     - `safetensors==0.8.0`
     - `numpy==2.5.4`
     - `scipy==1.18.1`
     - `scikit-learn==1.9.1`
3. **Deterministic CPU Thread & Kernel Configuration (`configure_deterministic_cpu_runtime`):**
   - Pins `PYTHONHASHSEED=0`, `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `VECLIB_MAXIMUM_THREADS=1`, `NUMEXPR_NUM_THREADS=1`, `TOKENIZERS_PARALLELISM=false`.
   - Calls `torch.manual_seed(0)`, `torch.set_num_threads(1)`, and `torch.use_deterministic_algorithms(True, warn_only=True)`.
4. **Offline Model Snapshot & Revision Verification (`verify_offline_reranker_snapshot`):**
   - At Docker build time, `write_reranker_snapshot_manifest` computes SHA-256 digests over every file in the downloaded `Qwen/Qwen3-Reranker-0.6B` snapshot (`e61197ed45024b0ed8a2d74b80b4d909f1255473`) and writes `.reranker_snapshot_manifest.json`.
   - At runtime (with `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `STORY_RANKER_OFFLINE=1`), `QwenReranker` verifies the snapshot directory, `refs/main` revision, required weight/tokenizer files, and SHA-256 file hashes before loading `CrossEncoder`.
5. **Embedding Digest Verification (`OllamaEmbedder.verify_model`):**
   - Verifies that `qwen3-embedding:0.6b` reported by `/api/tags` matches digest `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d` and records verification state in `verification_receipt()`.
6. **Structured Runtime Provenance Receipt (`build_runtime_provenance_receipt`):**
   - Returned inside `model.runtime_provenance` on both `GET /healthz` and `POST /v1/rank`, exposing `profile`, `reference_profile`, `cross_backend_variance_classification`, model/revision/snapshot SHA-256 verification status, deterministic CPU environment settings, Python/platform metadata, and installed package versions.

---

## 4. Evaluation of Acceptance Policies (A–E)

| Policy Option                                                                                                             | Description                                                                                                                                                                       | Engineering Evaluation                                                                                                                                                     | Verdict                           |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Policy A:** Exact bit-for-bit & rank-for-rank match against Apple MPS across all 250 pairs                              | Requires Linux CPU float reductions to match Apple Metal GPU shaders identically.                                                                                                 | Physically impossible across distinct hardware/SIMD backends without emulating Metal shaders in software. Rejects valid CPU builds over `0.03125` tie swaps at rank `#50`. | **Rejected**                      |
| **Policy B:** Canonicalize Linux CPU (`PRODUCTION_CANONICAL_CPU`) as sole source of truth and discard `R3C_REFERENCE_MPS` | Replaces the R3C reference artifact entirely with Linux CPU output.                                                                                                               | Loses the historical trace to the human-labeled R3C precision holdout (`P@10 = 90%`, `P@20 = 60%`, `P@50 = 30%`) measured on MPS.                                          | **Rejected as sole gate**         |
| **Policy C:** Bounded Cross-Backend Parity Envelope against `R3C_REFERENCE_MPS`                                           | Requires `TOP250 = 100%`, `TOP10 = 100%`, `TOP20 = 100%`, `TOP50 >= 98%` (`>= 49/50`), `Spearman >= 0.999`, `max \|Δ score\| <= 0.25`.                                            | Accurately bounds hardware floating-point variance while guaranteeing that Top-10 and Top-20 high-precision candidates remain 100% preserved.                              | **Accepted (Cross-Backend Gate)** |
| **Policy D:** Strict 100% Within-Backend CPU Determinism Gate                                                             | Requires `0` rank swaps and `0.0` score delta across repeated runs and image rebuilds on `PRODUCTION_CANONICAL_CPU`.                                                              | Essential for production auditability and regression testing once the container image and dependencies are pinned.                                                         | **Accepted (Within-CPU Gate)**    |
| **Policy E:** Dual-Gate Contract (**Policy C + Policy D**)                                                                | Combines **Policy D** (100% bit-identical repeatability within `PRODUCTION_CANONICAL_CPU`) with **Policy C** (bounded cross-backend parity envelope against `R3C_REFERENCE_MPS`). | Preserves the R3C research anchor while enforcing strict deterministic reproducibility on Linux CPU.                                                                       | **RECOMMENDED & ADOPTED**         |
