# STORY-02-A2C R1 — Operating-point safety and reproducibility

PR #145 remains a draft. This review changes research tooling only.
`MERGE=NO`, `DEPLOY=NO`, `CANARY=NO`, `FULL_GOLD_FINAL_FIT=NO`,
`PRODUCTION_MODEL_ARTIFACT=NO`.

## Decision

```text
RESEARCH_RECOMMENDATION=NO_CLEAR_WINNER
SCOREPROVIDER_SELECTION=DEFERRED_NO_CLEAR_WINNER
LIGHTWEIGHT_MODEL_ARTIFACT_DECISION_REQUIRED=DEFERRED
NEXT_RECOMMENDED_TRACK=MORE_SCORER_RESEARCH
```

No existing D0/D1 operating point combines zero false-family merges, zero
cross-family clusters, zero observed hard-negative contamination, and at least
15 captured SAME_EVENT pairs. The existing 15-pair coverage policy is unchanged;
false splits have a real cost. A future change to that boundary is a separate PM
methodology decision. No provider is activated or integrated by this PR.

## Frozen inputs and split

- Gold V2 SHA256:
  `3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4`.
- 233 pairs, 153 articles: 57 SAME_EVENT, 27 RELATED_TOPIC, 149 DIFFERENT_EVENT.
- No Gold rows, labels, positive families, or fold assignments changed.
- `COMPONENT_GROUP_3FOLD`, fold pair counts `[190, 26, 17]`.
- Fold-assignment fingerprint:
  `6a2526e9de76ee9f1fec6159a0b105ea35b5df48f637507fc443d465e313d75f`.
- Article, pair and family leakage are checked, including negative tests; all are
  zero. The largest component has 190/233 pairs and 51/57 positives, limiting the
  amount of independent evidence.

## Threshold semantics

`OOF_THRESHOLD_STRATEGY=INNER_TRAIN_ONLY_PER_OUTER_FOLD` for both direct scorers
and PF1. Each held-out pair's binary OOF decision uses its fold's threshold,
selected without the outer-test data. Pooled OOF precision/recall/F0.5 below are
from those fold-specific decisions, **not** a single STRICT threshold.

| Scorer     | Fold thresholds        |    MIN | MEDIAN |    MAX |
| ---------- | ---------------------- | -----: | -----: | -----: |
| D0 lexical | 0.5625, 0.3541, 0.3541 | 0.3541 | 0.3541 | 0.5625 |
| D1 Qwen    | 0.6313, 0.6909, 0.6909 | 0.6313 | 0.6909 | 0.6909 |

Research points retain the existing definitions and four-decimal thresholds:
STRICT=MAX, MEDIAN=MEDIAN, PERMISSIVE=MIN. They are descriptive fixed-threshold
Gold/P3 and Home shadows; they are not additional unbiased OOF estimates.

| Scorer | Pooled OOF precision | Pooled OOF recall | Pooled OOF F0.5 |
| ------ | -------------------: | ----------------: | --------------: |
| D0     |               0.7778 |            0.1228 |          0.3763 |
| D1     |               0.7619 |            0.8421 |          0.7767 |
| PF1    |               0.8077 |            0.3684 |          0.6522 |

## D0/D1 P3 operating-point frontier

Hard negatives are the sum of RELATED_TOPIC and DIFFERENT_EVENT Gold pairs
co-clustered after P3, including indirect joins. Family recall and non-Duo recall
here also use final P3 membership at the stated fixed point, not pooled OOF
pairwise recall. P3 retains maximum size 10, maximum span 24h, strong multi-member
support and no bridging between established multi-member clusters.

| Scorer / point | Threshold | SAME capture / 57 |   Rate | Related | Different | Hard neg. | False family | Cross-family | Stories | Clustered articles | Classification                      |
| -------------- | --------: | ----------------: | -----: | ------: | --------: | --------: | -----------: | -----------: | ------: | -----------------: | ----------------------------------- |
| D0 STRICT      |    0.5625 |                 4 | 0.0702 |       0 |         0 |         0 |            0 |            0 |       4 |                  8 | TOO_LOW_COVERAGE                    |
| D0 MEDIAN      |    0.3541 |                35 | 0.6140 |       0 |         4 |         4 |            0 |            0 |      11 |                 30 | NONZERO_HARD_NEGATIVE_CONTAMINATION |
| D0 PERMISSIVE  |    0.3541 |                35 | 0.6140 |       0 |         4 |         4 |            0 |            0 |      11 |                 30 | NONZERO_HARD_NEGATIVE_CONTAMINATION |
| D1 STRICT      |    0.6909 |                19 | 0.3333 |       0 |         1 |         1 |            0 |            0 |      11 |                 26 | NONZERO_HARD_NEGATIVE_CONTAMINATION |
| D1 MEDIAN      |    0.6909 |                19 | 0.3333 |       0 |         1 |         1 |            0 |            0 |      11 |                 26 | NONZERO_HARD_NEGATIVE_CONTAMINATION |
| D1 PERMISSIVE  |    0.6313 |                22 | 0.3860 |       2 |         2 |         4 |            0 |            0 |      13 |                 32 | NONZERO_HARD_NEGATIVE_CONTAMINATION |

Compact Pareto frontier (duplicate fixed points combined for display):

| Point(s)               | False family / cross-family | Hard negatives | SAME capture | Family macro recall | Non-Duo pair recall | Non-Duo family macro recall | Runtime requirements |
| ---------------------- | --------------------------- | -------------: | -----------: | ------------------: | ------------------: | --------------------------: | -------------------- |
| D0 STRICT              | 0 / 0                       |              0 |            4 |              0.2357 |              0.2000 |                      0.2593 | Direct lexical       |
| D1 STRICT / MEDIAN     | 0 / 0                       |              1 |           19 |              0.5643 |              0.4000 |                      0.5926 | Direct Qwen scores   |
| D0 MEDIAN / PERMISSIVE | 0 / 0                       |              4 |           35 |              0.6200 |              0.4667 |                      0.6148 | Direct lexical       |
| D1 PERMISSIVE          | 0 / 0                       |              4 |           22 |              0.7310 |              0.6000 |                      0.7778 | Direct Qwen scores   |

All four distinct configurations are nondominated across the explicit dimensions.
This is a tradeoff frontier, not a promotion list. Promotion first requires all
three safety counts to be zero and coverage >=15; only then would higher capture,
family macro recall, non-Duo robustness and simpler runtime break ties in that
order. No arbitrary weighted scalar loss or F0.5-only winner is introduced.

## Reproducible PF1 cluster evaluation

`PF1_CLUSTER_EVALUATION=OOF_BINARY_EDGE_P3`.

The runner takes the 233 leak-free OOF binary decisions. Only `pred=1` supplies
one of the 26 candidate positive edges; `pred=0` supplies no edge. All positive
edges have weight 1; canonical article IDs resolve ties. P3's 0.5 cutoff encodes
binary presence/absence, not a learned global probability threshold. Separately
trained fold scores are never sorted or thresholded as one calibrated scale.

| Metric                                     | R1 binary-edge P3 |
| ------------------------------------------ | ----------------: |
| SAME_EVENT capture                         |    13/57 (0.2281) |
| RELATED_TOPIC contamination                |                 2 |
| DIFFERENT_EVENT contamination              |                 1 |
| Hard-negative contamination                |                 3 |
| False family merges                        |                 0 |
| Cross-family clusters                      |                 0 |
| Multi-article stories / clustered articles |           14 / 29 |
| Safety classification                      |  TOO_LOW_COVERAGE |

Family fragmentation: seven positive families occupy one cluster each; the other
three occupy 2, 3 and 10 clusters. The runner returns the full per-family mapping
privately, together with all required PF1 safety fields. The evaluation runs no
additional fit; the nine original inner/outer fits each use fewer than 233 rows.
There is no full-Gold PF1 fit, global PF1 operating point or production artifact.

Historical A2C results remain visible: D0 STRICT 4/57 with zero hard negatives;
D1 STRICT 19/57 with one; **PF1 previously reported 14/57 with one**. The old
versioned runner did not calculate PF1 cluster safety. The R1 result above
supersedes that PF1 evidence with an explicit reproducible evaluation construct;
it does not silently replace the historical report or claim equivalent methods.

## Component-aware uncertainty

These are the existing 95% percentile bootstrap intervals: 1,000 draws over the
fixed connected components, seed 42, using each pair's fixed OOF binary decision.

| Scorer | Precision CI95 | Recall CI95 | F0.5 CI95        | RELATED FPR CI95 | DIFFERENT FPR CI95 |
| ------ | -------------- | ----------- | ---------------- | ---------------- | ------------------ |
| D0     | [0, 1]         | [0, 1]      | [0, 1]           | [0, 0.1667]      | [0, 0.0520]        |
| D1     | [0, 1]         | [0, 0.8961] | [0, 0.8163]      | [0, 0.2500]      | [0, 0.0870]        |
| PF1    | [0.4, 1]       | [0.2976, 1] | [0.4545, 0.8655] | [0, 0.6667]      | [0, 0.0520]        |

The D0 precision 0.7778 versus D1 0.7619 difference is not supported as a
meaningful discriminator by this uncertainty. These intervals describe pairwise
OOF decisions, not the fixed-threshold P3 frontier. They do not include repeated
model-fitting or threshold-selection uncertainty. Dominance of one component and
the existing convention assigning zero to zero-denominator draws limit their
interpretation; R1 preserves that bootstrap policy rather than changing it.

## Home-200 shadows

Every point was run, including disqualified points for transparency. Counts use
the existing RF0R lexical K=10 / RF1 Qwen K=10 candidate retrieval before P3.
Hard-negative and family counts are observations on the 233 frozen Gold pairs
and known positive families, not exhaustive labels of every Home pair.

| Point         | Items after | Noise reduction | Story cards | Top20 cards | Top50 cards | Hard-negative merges | False family merges | Cross-family clusters |
| ------------- | ----------: | --------------: | ----------: | ----------: | ----------: | -------------------: | ------------------: | --------------------: |
| D0 STRICT     |         196 |            2.0% |           4 |           1 |           3 |                    0 |                   0 |                     0 |
| D0 MEDIAN     |         180 |           10.0% |          12 |           1 |           6 |                    9 |                   0 |                     0 |
| D0 PERMISSIVE |         180 |           10.0% |          12 |           1 |           6 |                    9 |                   0 |                     0 |
| D1 STRICT     |         185 |            7.5% |          11 |           2 |           6 |                    1 |                   0 |                     0 |
| D1 MEDIAN     |         185 |            7.5% |          11 |           2 |           6 |                    1 |                   0 |                     0 |
| D1 PERMISSIVE |         176 |           12.0% |          16 |           2 |           7 |                    5 |                   0 |                     0 |

Top20/Top50 preserve the existing definition: the story's highest original Home
member position is <20/<50 (H1); these are not counts in the first 20/50 items of
the compressed projection. Zero family merges do not imply zero negative-pair
merges. Full Home can introduce intermediary edges absent from the Gold subgraph.
`HOME_HARD_NEGATIVE_GATE=FAIL_FOR_PROMOTION`: only D0 STRICT has zero observed
hard negatives, and it remains below the Gold coverage boundary. This is a
research finding, not a failing implementation test or permission to activate it.

## Reproduction and tests

Reference environment: Python 3.13.15, NumPy 2.5.4, scikit-learn 1.9.1. The runner
records these versions. Existing canonical private inputs are required; it fails
fast on their hash mismatch. No input is downloaded, edited or regenerated.

```sh
python scripts/research/story-identity-v1/gold_v2_benchmark.py \
  --output /tmp/newsflux-story02-a2c-r1-private/r1-results.json \
  > /tmp/newsflux-story02-a2c-r1-private/r1-research-output.json
python -m unittest discover -s scripts/research/story-identity-v1 -p 'test_*.py'
```

Create the external private directory before redirecting stdout. Both output
files contain private evidence and must stay outside Git. The output writer
rejects repository destinations and symlinks resolving into the repository.
The tracked test fixtures are artificial boundary cases only, not additions or
repairs to Gold V2. Public evidence here consists only of aggregate statistics,
methodology, and fingerprints; no titles, URLs, raw pairs or model binaries.

Versioned tests cover Gold SHA fail-fast, exact frozen split fingerprint and
leakage rejection, all six frontiers/shadows, threshold meaning, PF1 binary-edge
reproduction and probability-invariance, P3 temporal/multi-member constraints,
coverage 14 vs 15, independent safety exclusions, Pareto tradeoffs, selection
order and artifact-decision semantics, all 15 uncertainty outputs, and private
output path protection.

Local verification: 124 research tests passed, including all 16 Gold V2/R1 tests.
An independent set-based PF1 binary-edge/P3 oracle also reproduced the safety
counts and per-family fragmentation. All original OOF predictions, thresholds,
confidence intervals, D0/D1 P3 safety counts and STRICT Home results match the
pre-R1 runner. Private inputs retained their original hashes after the full suite.
