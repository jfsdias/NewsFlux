# Targeted DEV capacity frontier

Catalog SHA-256: `5eea58b56ca860657a2ec32b3f9e5dec69c6fcfdaf090bf413bcf4d936cdda1f`. The frozen eligible universe has 10,274 pairs. The catalog was fixed before old-DEV diagnostics. No labels were used for candidate capacity.

All 48 tested configurations fail a necessary condition. A raw lane shortfall or an optimal strong-lane matching upper bound proves the specific quota infeasible. Diversity feasibility is not independently assessed after an earlier necessary condition fails.

| Strong | Text | Strong raw | Text after priority | Near | Control | Q64               | Q72               | Q80      |
| ------ | ---- | ---------: | ------------------: | ---: | ------: | ----------------- | ----------------- | -------- |
| S0     | T0   |         22 |                  17 |   62 |   10173 | STRONG_MATCH_FAIL | STRONG_MATCH_FAIL | RAW_FAIL |
| S0     | T1   |         22 |                   6 |   74 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S0     | T2   |         22 |                   5 |   75 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S0     | T3   |         22 |                   5 |   76 |   10171 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S1     | T0   |         25 |                  16 |   60 |   10173 | STRONG_MATCH_FAIL | STRONG_MATCH_FAIL | RAW_FAIL |
| S1     | T1   |         25 |                   5 |   72 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S1     | T2   |         25 |                   5 |   72 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S1     | T3   |         25 |                   2 |   76 |   10171 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S2     | T0   |         32 |                  13 |   56 |   10173 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S2     | T1   |         32 |                   5 |   65 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S2     | T2   |         32 |                   5 |   65 |   10172 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S2     | T3   |         32 |                   2 |   69 |   10171 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S3     | T0   |         24 |                  16 |   63 |   10171 | STRONG_MATCH_FAIL | STRONG_MATCH_FAIL | RAW_FAIL |
| S3     | T1   |         24 |                   5 |   75 |   10170 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S3     | T2   |         24 |                   5 |   75 |   10170 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |
| S3     | T3   |         24 |                   0 |   79 |   10171 | RAW_FAIL          | RAW_FAIL          | RAW_FAIL |

Maximum article-disjoint strong-lane matching bounds: S0=14, S1=15, S2=18, S3=15. The maximum total without lane quotas is 144, proved by an in-memory witness meeting diversity caps at the 288-article upper bound. These vectors describe that one maximum-total witness, not independent per-lane maxima.

| Config | Strong | Text | Near | Control | Total |
| ------ | -----: | ---: | ---: | ------: | ----: |
| S0/T0  |      1 |    0 |    0 |     143 |   144 |
| S0/T1  |      1 |    0 |    0 |     143 |   144 |
| S0/T2  |      1 |    0 |    0 |     143 |   144 |
| S0/T3  |      1 |    0 |    0 |     143 |   144 |
| S1/T0  |      1 |    0 |    0 |     143 |   144 |
| S1/T1  |      1 |    0 |    0 |     143 |   144 |
| S1/T2  |      1 |    0 |    0 |     143 |   144 |
| S1/T3  |      1 |    0 |    0 |     143 |   144 |
| S2/T0  |      1 |    0 |    0 |     143 |   144 |
| S2/T1  |      1 |    0 |    0 |     143 |   144 |
| S2/T2  |      1 |    0 |    0 |     143 |   144 |
| S2/T3  |      1 |    0 |    0 |     143 |   144 |
| S3/T0  |      0 |    0 |    1 |     143 |   144 |
| S3/T1  |      0 |    0 |    1 |     143 |   144 |
| S3/T2  |      0 |    0 |    1 |     143 |   144 |
| S3/T3  |      0 |    0 |    1 |     143 |   144 |

## Old DEV aggregate diagnostics

These are challenge-set diagnostics, not candidate labels or population estimates.

| Variant | Matches | Same | Related | Different | Uncertain |
| ------- | ------: | ---: | ------: | --------: | --------: |
| S0      |       0 |    0 |       0 |         0 |         0 |
| S1      |       0 |    0 |       0 |         0 |         0 |
| S2      |       0 |    0 |       0 |         0 |         0 |
| S3      |       0 |    0 |       0 |         0 |         0 |
| T0      |       5 |    0 |       0 |         5 |         0 |
| T1      |       3 |    0 |       0 |         3 |         0 |
| T2      |       1 |    0 |       0 |         1 |         0 |
| T3      |       0 |    0 |       0 |         0 |         0 |

No tested configuration is feasible; PM review is required for retrieval strategy redesign. No final contract or expansion pack was selected. BLIND human labels remain sealed and unread.
