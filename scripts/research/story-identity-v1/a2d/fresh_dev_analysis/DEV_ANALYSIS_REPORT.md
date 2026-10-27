# Fresh DEV challenge analysis

DEV contains 80 labeled pairs: 0 SAME_EVENT, 1 RELATED_TOPIC, 79 DIFFERENT_EVENT and 0 UNCERTAIN. It is a targeted challenge sample, not a random sample of 33,135 pairs. Class prevalence is not corpus prevalence; challenge precision is not production precision and challenge recall is not population recall.

Evidence sufficiency **FAIL**: SAME_EVENT 0/8, RELATED_TOPIC 1/8, non-UNCERTAIN 80/60, positive buckets 0/2. Targeted label-blind DEV expansion is needed; do not freeze a policy.

## Frozen candidate metrics

| Candidate |  TP | FP related | FP different |  FN |  TN | Uncertain merge / no merge | Challenge precision | Challenge recall |
| --------- | --: | ---------: | -----------: | --: | --: | -------------------------: | ------------------: | ---------------: |
| A         |   0 |          0 |            1 |   0 |  79 |                      0 / 0 |                 0.0 |        undefined |
| B         |   0 |          0 |            0 |   0 |  80 |                      0 / 0 |           undefined |        undefined |
| C         |   0 |          0 |            0 |   0 |  80 |                      0 / 0 |           undefined |        undefined |

B and C make no merge predictions; their zero false-split count is vacuous because DEV contains no positive labels. Recall is undefined for all three.

## Selection buckets

| Bucket                | Total | Same | Related | Different | Uncertain |
| --------------------- | ----: | ---: | ------: | --------: | --------: |
| BOUNDARY_DISAGREEMENT |    16 |    0 |       0 |        16 |         0 |
| DIVERSITY_CONTROL     |     8 |    0 |       0 |         8 |         0 |
| HARD_NEGATIVE_SEEKING |    28 |    0 |       0 |        28 |         0 |
| POSITIVE_SEEKING      |    28 |    0 |       1 |        27 |         0 |

## Overlapping strata

Strata overlap; their totals must not be summed.

| Stratum | Total | Same | Related | Different | Uncertain |
| ------- | ----: | ---: | ------: | --------: | --------: |
| S1      |     7 |    0 |       1 |         6 |         0 |
| S2      |     2 |    0 |       0 |         2 |         0 |
| S3      |    24 |    0 |       0 |        24 |         0 |
| S4      |     3 |    0 |       1 |         2 |         0 |
| S5      |     0 |    0 |       0 |         0 |         0 |
| S6      |     3 |    0 |       1 |         2 |         0 |
| S7      |    38 |    0 |       1 |        37 |         0 |
| S8      |     1 |    0 |       0 |         1 |         0 |
| S9      |     3 |    0 |       0 |         3 |         0 |
| S10     |    30 |    0 |       0 |        30 |         0 |

## Qwen thresholds and Pareto frontier

The deterministic sweep contains 161 thresholds. The DEV Pareto comparison retains 3 candidates; no final policy was selected.

| Candidate | Threshold | False merges | False splits |
| --------- | --------- | -----------: | -----------: |
| B         | n/a       |            0 |            0 |
| C         | n/a       |            0 |            0 |
| QWEN      | inf       |            0 |            0 |

## Descriptive feature summaries

Values are DEV-only: minimum, 25th percentile, median, 75th percentile and maximum; absent classes have no estimates.

| Feature               | Label           |   N |      Min |      Q25 |   Median |      Q75 |      Max |
| --------------------- | --------------- | --: | -------: | -------: | -------: | -------: | -------: |
| date_overlap          | DIFFERENT_EVENT |  79 |        0 |        0 |        0 |        0 |        0 |
| date_overlap          | RELATED_TOPIC   |   1 |        0 |        0 |        0 |        0 |        0 |
| date_overlap          | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| date_overlap          | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| entity_anchor_overlap | DIFFERENT_EVENT |  79 |        0 |        0 |        0 |        0 |      0.5 |
| entity_anchor_overlap | RELATED_TOPIC   |   1 |        1 |        1 |        1 |        1 |        1 |
| entity_anchor_overlap | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| entity_anchor_overlap | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| lexical_overlap       | DIFFERENT_EVENT |  79 |        0 |        0 |        0 |        0 |      0.5 |
| lexical_overlap       | RELATED_TOPIC   |   1 |    0.125 |    0.125 |    0.125 |    0.125 |    0.125 |
| lexical_overlap       | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| lexical_overlap       | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| number_overlap        | DIFFERENT_EVENT |  79 |        0 |        0 |        0 |        0 |        0 |
| number_overlap        | RELATED_TOPIC   |   1 |        0 |        0 |        0 |        0 |        0 |
| number_overlap        | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| number_overlap        | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| qwen_score            | DIFFERENT_EVENT |  79 | 0.157262 | 0.331726 | 0.400208 | 0.473537 | 0.690855 |
| qwen_score            | RELATED_TOPIC   |   1 | 0.452284 | 0.452284 | 0.452284 | 0.452284 | 0.452284 |
| qwen_score            | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| qwen_score            | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| search_rank_v2        | DIFFERENT_EVENT |  79 |      229 |   8110.5 |    19701 |  36135.5 |   106946 |
| search_rank_v2        | RELATED_TOPIC   |   1 |    10799 |    10799 |    10799 |    10799 |    10799 |
| search_rank_v2        | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| search_rank_v2        | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |
| temporal_delta_hours  | DIFFERENT_EVENT |  79 |   0.0103 |   3.5665 |   7.7592 |  17.1117 |  23.8864 |
| temporal_delta_hours  | RELATED_TOPIC   |   1 |   8.2256 |   8.2256 |   8.2256 |   8.2256 |   8.2256 |
| temporal_delta_hours  | SAME_EVENT      |   0 |        — |        — |        — |        — |        — |
| temporal_delta_hours  | UNCERTAIN       |   0 |        — |        — |        — |        — |        — |

BLIND remained sealed and unread. No model inference, training, final policy selection or product change occurred.
