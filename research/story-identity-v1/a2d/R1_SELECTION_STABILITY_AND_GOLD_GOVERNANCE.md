# STORY-02-A2D R1 — Selection Stability and Gold Governance

## Scope and invariants

This is a post-hoc diagnosis of the frozen A2D results, not another scorer search. No candidate family, feature, threshold grid, Gold label, fold, or baseline result changed. Gold V2 remains an immutable historical benchmark. The R1 audit is aggregate-only; pair IDs, titles, URLs, and row-level outputs remain outside Git.

- Gold V2 SHA: `3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4`.
- Gold V2 labels: 57 SAME_EVENT pairs across 10 positive families.
- Frozen component-group fold counts: `[190, 26, 17]`.
- Frozen fold assignment SHA: `6a2526e9de76ee9f1fec6159a0b105ea35b5df48f637507fc443d465e313d75f`.
- Article, pair, and family leakage: zero.
- D0, D1, and PF1 baseline replay parity: PASS.

## Giant component and outer-training evidence

The 190-pair component is in outer fold 0. It contains 51 of the 57 SAME_EVENT pairs. With that component held out, the remaining outer-training data contains only 43 pairs, including 6 SAME_EVENT pairs from 4 positive families and 37 hard negatives (12 RELATED_TOPIC and 25 DIFFERENT_EVENT). The other outer-training configurations include the giant component and contain 53 or 55 SAME_EVENT pairs from 8 positive families.

|         Outer fold | Test pairs | Train pairs | Train SAME | Train RELATED | Train DIFFERENT | Train positive families |
| -----------------: | ---------: | ----------: | ---------: | ------------: | --------------: | ----------------------: |
| 0 (giant held out) |        190 |          43 |          6 |            12 |              25 |                       4 |
|                  1 |         26 |         207 |         53 |            22 |             132 |                       8 |
|                  2 |         17 |         216 |         55 |            20 |             141 |                       8 |

## Per-fold selection audit

Parameter selection is train-only. Direct rules select parameters using only the two non-test folds. The logistic reference keeps its existing inner cross-fit and selects its threshold only from inner-training scores. Outer-test outcomes below are evaluation results, never tuning inputs. `P3 capture/HN` means SAME_EVENT capture and hard-negative contamination after P3.

| Candidate | Fold | Selected parameters        | Inner capture/HN | Outer-test TP/FP/FN | Outer-test P3 capture/HN |
| --------- | ---: | -------------------------- | ---------------: | ------------------: | -----------------------: |
| A         |    0 | semantic .625; lexical .30 |              5/0 |             37/3/14 |                     36/1 |
| A         |    1 | semantic .625; lexical .35 |             37/0 |               3/0/1 |                      2/0 |
| A         |    2 | semantic .625; lexical .35 |             38/0 |               1/0/1 |                      1/0 |
| B         |    0 | semantic .625; delta 8h    |              5/0 |             47/16/4 |                     34/3 |
| B         |    1 | semantic .75; delta 8h     |             13/0 |               1/0/3 |                      1/0 |
| B         |    2 | semantic .75; delta 8h     |             14/0 |               0/0/2 |                      0/0 |
| C         |    0 | semantic .625              |              5/0 |              47/9/4 |                     34/1 |
| C         |    1 | semantic .70               |             22/0 |               2/0/2 |                      2/0 |
| C         |    2 | semantic .70               |             24/0 |               0/0/2 |                      0/0 |
| D         |    0 | threshold .603010          |              5/0 |             27/1/24 |                      8/0 |
| D         |    1 | threshold .632683          |             28/0 |               4/1/0 |                      4/1 |
| D         |    2 | threshold .592941          |             12/0 |               1/0/1 |                      1/0 |

## Parameter stability

The direct-rule classification is relative to each candidate's preregistered grid: identical selections are stable; one varying parameter spanning one grid step is moderately unstable; multiple varying parameters or a span greater than one grid step is highly unstable. This is descriptive and does not change selection.

| Candidate              | Values by outer fold      | Range                   | Median  | Stability                                                                                  |
| ---------------------- | ------------------------- | ----------------------- | ------- | ------------------------------------------------------------------------------------------ |
| A semantic             | .625, .625, .625          | .625–.625               | .625    | STABLE                                                                                     |
| A lexical              | .30, .35, .35             | .30–.35 (1 grid step)   | .35     | MODERATELY_UNSTABLE                                                                        |
| B semantic             | .625, .75, .75            | .625–.75 (5 grid steps) | .75     | HIGHLY_UNSTABLE                                                                            |
| B delta hours          | 8, 8, 8                   | 8–8                     | 8       | STABLE                                                                                     |
| C semantic             | .625, .70, .70            | .625–.70 (3 grid steps) | .70     | HIGHLY_UNSTABLE                                                                            |
| D inner-only threshold | .603010, .632683, .592941 | .592941–.632683         | .603010 | MODERATELY_UNSTABLE; refit-specific probability thresholds differ and are descriptive only |

## Post-hoc parameter transfer diagnostic

This matrix applies an already selected fold parameter set to other folds only to diagnose stability. It is explicitly `POST_HOC_PARAMETER_TRANSFER_DIAGNOSTIC_ONLY`: it is not a new generalization estimate, is not used for parameter selection, and does not replace original OOF results. Values are `SAME_EVENT_CAPTURE/HARD_NEGATIVES`.

| Candidate and train-derived parameter set | Eval fold 0 | Eval fold 1 | Eval fold 2 |
| ----------------------------------------- | ----------: | ----------: | ----------: |
| A, train fold 0 (.625/.30)                |        36/1 |         4/0 |         1/0 |
| A, train fold 1 (.625/.35)                |        36/0 |         2/0 |         1/0 |
| A, train fold 2 (.625/.35)                |        36/0 |         2/0 |         1/0 |
| B, train fold 0 (.625/8h)                 |        34/3 |         4/0 |         1/0 |
| B, train fold 1 (.75/8h)                  |        13/0 |         1/0 |         0/0 |
| B, train fold 2 (.75/8h)                  |        13/0 |         1/0 |         0/0 |
| C, train fold 0 (.625)                    |        34/1 |         4/0 |         1/0 |
| C, train fold 1 (.70)                     |        22/0 |         2/0 |         0/0 |
| C, train fold 2 (.70)                     |        22/0 |         2/0 |         0/0 |

For A, the parameter selected without the giant component (.30 lexical threshold) gives 36 captured and 1 hard negative on fold 0. Parameters selected in folds 1 and 2 with the giant component in training use .35; transferred post hoc to fold 0, they give the same 36 capture and zero observed hard negatives. This supports a threshold-selection instability diagnosis, but the transfer result is not unbiased validation and does not qualify A as a provider.

## Preserved original OOF results

The benchmark replay matched the prior candidate summaries; none of these OOF results was replaced by fixed-point or transfer diagnostics.

| Candidate | Pair precision | Pair recall | Pair F0.5 | Pair F1 | OOF P3 capture | RT false-positive | DE false-positive | Hard negatives | False-family merges | Cross-family clusters |
| --------- | -------------: | ----------: | --------: | ------: | -------------: | ----------------: | ----------------: | -------------: | ------------------: | --------------------: |
| A         |          .3409 |       .2632 |     .3219 |   .2970 |             39 |                 0 |                 1 |              1 |                   0 |                     0 |
| B         |          .3125 |       .3509 |     .3195 |   .3306 |             35 |                 1 |                 2 |              3 |                   0 |                     0 |
| C         |          .3276 |       .3333 |     .3287 |   .3304 |             36 |                 1 |                 0 |              1 |                   0 |                     0 |
| D         |          .3529 |       .2105 |     .3109 |   .2637 |             13 |                 1 |                 0 |              1 |                   0 |                     0 |

## Limiting-factor decision

`LIMITING_FACTOR=MIXED_THRESHOLD_AND_GOLD_LIMIT`.

The OOF hard negative alone does not establish `FEATURE_SEPARABILITY_LIMIT`. The parameter-transfer diagnostic finds an already-selected A parameter set with useful capture and zero observed hard negatives on the affected fold. At the same time, the giant component concentrates 51/57 positive pairs and leaves only 6 positives across 4 families for the corresponding outer-train selection. The evidence therefore points to threshold instability coupled with positive-family coverage concentration; it does not establish a deployable scorer.

Original OOF metrics remain unchanged. A's descriptive full-Gold strict/median point (.625 semantic, .35 lexical) captures 39/57 with zero observed hard negatives, but this point is not unbiased evidence and cannot override the OOF failure. `PROVIDER_CANDIDATE_FOUND=NO` remains mandatory.

## Prospective targeted Gold protocol — design only

`TARGETED_GOLD_EXPANSION_REQUIRED=YES` and `POSITIVE_GOLD_EXPANSION_REQUIRED=YES`. Do not annotate during this R1. Keep Gold V2 immutable as the historical benchmark; do not append new labels to it for both tuning and evaluation.

Before any annotation, define two separate sets:

- **DEV_AUGMENT**: prospective additional positives from underrepresented event families and targeted hard negatives. It may be used for development and parameter selection.
- **BLIND_CHALLENGE**: a separate prospective challenge set, opened only for one final evaluation and never reused for tuning.

Sampling is label-blind and may use only pre-annotation evidence such as score/feature regions, A/B/C disagreement, source diversity, and temporal diversity. Human reviewers remain blind to candidate family, score, mining stratum, expected label, and predicted label. No existing pair IDs, titles, company names, or product names are encoded as sampling rules.

Target article IDs and components disjoint between DEV_AUGMENT and BLIND_CHALLENGE where feasible; pair overlap is always forbidden. If component disjointness cannot be achieved, document that limitation before annotation. The test helper validates article/pair separation and that the challenge is not reused for tuning.

Priority strata may include high Qwen with moderate lexical support, high-Qwen same-entity/different-event risk, lexical-alias risk, product-topic-collision risk, low-lexical true-event candidates, and disagreement among A/B/C. These are general strata only, not pair-specific instructions.

## Gates and boundaries

- A2D baseline parity: PASS; original candidate OOF results unchanged.
- Per-fold selection audit: PASS.
- Giant-component diagnosis: PASS.
- Limiting-factor semantics: PASS; `_decision()` now receives explicit audit evidence and no longer maps any OOF hard negative directly to feature-separability failure.
- Fixed point cannot override OOF failure: PASS.
- Targeted Gold no-reuse protocol: PASS.
- Artificial Home-shadow success-path coverage: PASS; the benchmark still runs no Home shadow because no candidate qualifies OOF.
- Approved next-track vocabulary: PASS; unsupported diagnosis defaults to `OTHER` / `HOLD_FOR_PM`, and all classification branches emit an allowed track name.
- Private-data Git gate: PASS; report contains aggregate counts and no raw private rows.
- No new labels, feature, threshold grid, candidate family, product integration, persistent state, Miniflux write, deployment, or canary.
