# Graph DEV retrieval analysis

The 40-pair graph pack was deliberately selected by a constrained retrieval design. Its label proportions are not corpus prevalence. Its challenge precision is not production precision; challenge recall is not population recall. No threshold tuning or production policy was selected.

## Lane × human label

| Lane    | SAME_EVENT | RELATED_TOPIC | DIFFERENT_EVENT | UNCERTAIN | Total |
| ------- | ---------: | ------------: | --------------: | --------: | ----: |
| EVENT   |          0 |             2 |              18 |         0 |    20 |
| NEAR    |          0 |             0 |              12 |         0 |    12 |
| CONTROL |          0 |             0 |               8 |         0 |     8 |
| TOTAL   |          0 |             2 |              38 |         0 |    40 |

Strict SAME yields: EVENT 0/20, NEAR 0/12, CONTROL 0/8. RELATED-or-SAME yields: EVENT 2/20, NEAR 0/12, CONTROL 0/8. The latter is **not a merge precision metric**: RELATED_TOPIC is merge-negative.

## EVENT merge proxy

EVENT_LANE_MERGE_PROXY_ONLY; NOT_PRODUCTION_CLASSIFIER. TP 0; false positives RELATED 2 and DIFFERENT 18; FN 0; TN 20. Challenge precision is 0/20 = 0.0; challenge recall is undefined because there are no SAME_EVENT examples. The EVENT negative share is 20/20 = 1.0 for this challenge sample, not a population false-positive rate.

## Combined evidence

The old tracked aggregate contains 80 records: 0 SAME, 1 RELATED, 79 DIFFERENT, 0 UNCERTAIN. Adding the graph DEV counts gives 120 total: 0 SAME, 3 RELATED, 117 DIFFERENT, 0 UNCERTAIN. The pre-registered SAME >=8 and RELATED >=8 gates fail; non-uncertain >=60 passes. Positive-bucket sufficiency is not comparable across the two selection designs. Overall comparable evidence sufficiency fails.

GRAPH_DEV_STRICT_POSITIVE_RECOVERY_GATE=FAIL; GRAPH_DEV_RELATED_BOUNDARY_EVIDENCE_GATE=FAIL. Recommendation: GRAPH_CONTEXT_DID_NOT_RESOLVE_STRICT_POSITIVE_SCARCITY_IN_FRESH_DEV. Next: STORY_02_A2D2C_P4_D2E_EVENT_IDENTITY_SIGNAL_REDESIGN. This recommends a future design task and does not authorize it or a threshold change here.

## Descriptive feature summaries

Each cell reports available N; minimum / median / maximum. Group N is shown in the heading; null indicates no available values. RELATED_TOPIC has N=2: VERY_SMALL_N, NO_INFERENTIAL_CLAIM.

### By lane

| Feature                      | control                         | event                             | near                               |
| ---------------------------- | ------------------------------- | --------------------------------- | ---------------------------------- |
| common_top10_count           | 8/8; 1 / 3 / 6                  | 20/20; 1 / 3 / 6                  | 12/12; 0 / 2 / 5                   |
| common_top5_count            | 8/8; 0 / 0.5 / 4                | 20/20; 0 / 2 / 4                  | 12/12; 0 / 0.5 / 2                 |
| min_support_degree           | 8/8; 0 / 11.5 / 21              | 20/20; 0 / 5.5 / 27               | 12/12; 1 / 2 / 6                   |
| qwen_score                   | 8/8; 0.3075 / 0.33869 / 0.50232 | 20/20; 0.3184 / 0.41754 / 0.60644 | 12/12; 0.34843 / 0.36397 / 0.40953 |
| rank_a_to_b                  | 8/8; 6 / 15.5 / 40              | 20/20; 1 / 2.5 / 5                | 12/12; 1 / 5.5 / 10                |
| rank_b_to_a                  | 8/8; 2 / 20.5 / 27              | 20/20; 1 / 3 / 5                  | 12/12; 1 / 6 / 10                  |
| reciprocal_rank_max          | 8/8; 10 / 22.5 / 40             | 20/20; 1 / 4 / 5                  | 12/12; 6 / 7 / 10                  |
| shared_support_article_count | 8/8; 0 / 7 / 15                 | 20/20; 0 / 2 / 22                 | 12/12; 0 / 0 / 0                   |
| shared_support_feed_count    | 8/8; 0 / 5 / 10                 | 20/20; 0 / 2 / 13                 | 12/12; 0 / 0 / 0                   |
| support_burst_span_hours     | 5/8; 10.917 / 13.083 / 22.626   | 13/20; 5.6167 / 11.545 / 20.735   | 0/12; — / — / —                    |
| support_degree_a             | 8/8; 3 / 13.5 / 25              | 20/20; 0 / 6 / 28                 | 12/12; 1 / 3.5 / 16                |
| support_degree_b             | 8/8; 0 / 12 / 24                | 20/20; 0 / 6.5 / 27               | 12/12; 1 / 4 / 8                   |
| temporal_delta_hours         | 8/8; 0.5372 / 5.1502 / 23.107   | 20/20; 0.3294 / 3.5022 / 10.388   | 12/12; 1.8503 / 7.5735 / 11.486    |

### By human decision

| Feature                      | DIFFERENT_EVENT                   | RELATED_TOPIC                    | SAME_EVENT     | UNCERTAIN      |
| ---------------------------- | --------------------------------- | -------------------------------- | -------------- | -------------- |
| common_top10_count           | 38/38; 0 / 3 / 6                  | 2/2; 3 / 3 / 3                   | 0/0; — / — / — | 0/0; — / — / — |
| common_top5_count            | 38/38; 0 / 1 / 4                  | 2/2; 1 / 2 / 3                   | 0/0; — / — / — | 0/0; — / — / — |
| min_support_degree           | 38/38; 0 / 4 / 27                 | 2/2; 1 / 4.5 / 8                 | 0/0; — / — / — | 0/0; — / — / — |
| qwen_score                   | 38/38; 0.3075 / 0.36594 / 0.60644 | 2/2; 0.45097 / 0.47497 / 0.49898 | 0/0; — / — / — | 0/0; — / — / — |
| rank_a_to_b                  | 38/38; 1 / 4 / 40                 | 2/2; 1 / 2 / 3                   | 0/0; — / — / — | 0/0; — / — / — |
| rank_b_to_a                  | 38/38; 1 / 4.5 / 27               | 2/2; 2 / 3 / 4                   | 0/0; — / — / — | 0/0; — / — / — |
| reciprocal_rank_max          | 38/38; 1 / 6 / 40                 | 2/2; 2 / 3 / 4                   | 0/0; — / — / — | 0/0; — / — / — |
| shared_support_article_count | 38/38; 0 / 0 / 22                 | 2/2; 0 / 2 / 4                   | 0/0; — / — / — | 0/0; — / — / — |
| shared_support_feed_count    | 38/38; 0 / 0 / 13                 | 2/2; 0 / 1.5 / 3                 | 0/0; — / — / — | 0/0; — / — / — |
| support_burst_span_hours     | 17/38; 5.6167 / 12.768 / 22.626   | 1/2; 20.735 / 20.735 / 20.735    | 0/0; — / — / — | 0/0; — / — / — |
| support_degree_a             | 38/38; 0 / 6 / 28                 | 2/2; 2 / 5 / 8                   | 0/0; — / — / — | 0/0; — / — / — |
| support_degree_b             | 38/38; 0 / 6.5 / 27               | 2/2; 1 / 5.5 / 10                | 0/0; — / — / — | 0/0; — / — / — |
| temporal_delta_hours         | 38/38; 0.3781 / 5.3554 / 23.107   | 2/2; 0.3294 / 3.6906 / 7.0519    | 0/0; — / — / — | 0/0; — / — / — |

## Private artifact hashes

- joined_sha256: `f01cf15e65308d2fc7415182f4bc841b70bd489ec8f319925952d37911c07e25`
- lane_diagnostics_sha256: `5a27a2ba05c85810a5c32ed7d174db2449e1e8994a4cd493d7fc2bcbab3e21d0`
- analysis_sha256: `3f653c07cb8b652600947b58ef82f0a2bd129899372bc1d2895c953daf1358a7`
- manifest_sha256: `bf259d92c97d3d6637508d7e18b3237c3f4854e64dff7ab3510b2a679467a1cb`

No new labels, model calls, BLIND evaluation, product change, deployment or canary occurred.
