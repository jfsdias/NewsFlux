# STORY-02 graph-context retrieval audit

Canonical audit completed with immutable private inputs and no model inference. The historical source contains 18,953 pairs; its observed published-time span is approximately 6.95 hours, so 18,953 pairs also enter the 24-hour historical graph in this corpus. These counts have different meanings and are not required to be equal. Fresh source count is 33,135; after reviewed-article exclusion, 10,274 eligible pairs remain among 288 unused articles.

Historical feature and fresh feature derivations were repeated byte-for-byte, and both historical context and strategy catalog were frozen before Gold label parsing. The functional bridge verifies 200/200 historical vectors, 18,953 exact scores and Spearman 1.0. An additional comparison with the historical CSV matched all 18,953 stored scores after rounding to its eight decimal places; the maximum unrounded difference was approximately 5e-9. BLIND human labels remained sealed and unread.

## R2A coverage evidence

The original R2 run correctly measured the observed intersections, but its compatibility gate did not prove full Gold coverage. R2A adds that proof without changing the strategy catalog, graph features, or scientific results. All 233 distinct Gold pairs occur in both the historical source and historical graph context; all 153 Gold articles occur in Home-200 (200 articles). The coverage validator runs before family and strategy diagnostics. The immutable private receipt contains only aggregate counts and hashes of the identity sets.

Historical vector/score compatibility, Gold pair coverage, and Gold article containment are independent gates. Gold containment in Home-200 supports a future transitive isolation proof using a fresh corpus independently verified disjoint from Home-200.

R2A receipt SHA-256: `dc1eecd8b8ddf502ef3f2aa22ec7a23e2e6597f419f85ae80253f15f0cd966f3`.

## Historical Gold strategy diagnostics

Gold contains 10 SAME_EVENT connected families. Counts are challenge-set diagnostics, not population or production performance estimates.

| Strategy | SAME_EVENT | Families | RELATED_TOPIC | DIFFERENT_EVENT |
| -------- | ---------: | -------: | ------------: | --------------: |
| E0       |         39 |       10 |            12 |              33 |
| E1       |         57 |       10 |            22 |             122 |
| E2       |         51 |        9 |            19 |             113 |
| E3       |         57 |       10 |            14 |              50 |
| E4       |         56 |        9 |            22 |             119 |
| E5       |         57 |       10 |            20 |              57 |
| N0       |          0 |        0 |             0 |               0 |
| N1       |          0 |        0 |             4 |               3 |

## Fresh label-blind capacity

| Strategy | Raw pairs | Disjoint maximum | Unique articles | Unique feeds | Unique source pairs |
| -------- | --------: | ---------------: | --------------: | -----------: | ------------------: |
| E0       |       167 |               80 |             186 |           40 |                 108 |
| E1       |      1175 |               98 |             199 |           41 |                 358 |
| E2       |       971 |               74 |             150 |           39 |                 319 |
| E3       |       267 |               73 |             148 |           41 |                 158 |
| E4       |      1400 |              133 |             270 |           42 |                 388 |
| E5       |        57 |               31 |              70 |           28 |                  41 |
| N0       |         2 |                2 |               4 |            4 |                   2 |
| N1       |        62 |               37 |              85 |           23 |                  36 |

## Template feasibility

| Event | Near | G40            | G48            |
| ----- | ---- | -------------- | -------------- |
| E0    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E0    | N1   | FEASIBLE       | INFEASIBLE     |
| E1    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E1    | N1   | FEASIBLE       | FEASIBLE       |
| E2    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E2    | N1   | FEASIBLE       | FEASIBLE       |
| E3    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E3    | N1   | FEASIBLE       | FEASIBLE       |
| E4    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E4    | N1   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E5    | N0   | INFEASIBLE_RAW | INFEASIBLE_RAW |
| E5    | N1   | FEASIBLE       | FEASIBLE       |

Graph-context signal gate: **PASS**. Feasible G40 configurations: 5; feasible G48: 4. Event strategies meeting the Gold floor: E0, E1, E2, E3, E4, E5; near-miss strategies meeting it: N1.
Non-dominated feasible configurations for PM review: E0/N1/G40, E3/N1/G40, E3/N1/G48. This is not a final selection or policy freeze.

## Existing DEV diagnostic

| Strategy | SAME_EVENT | RELATED_TOPIC | DIFFERENT_EVENT | UNCERTAIN |
| -------- | ---------: | ------------: | --------------: | --------: |
| E0       |          0 |             0 |               9 |         0 |
| E1       |          0 |             1 |              38 |         0 |
| E2       |          0 |             1 |              33 |         0 |
| E3       |          0 |             1 |              23 |         0 |
| E4       |          0 |             1 |              41 |         0 |
| E5       |          0 |             1 |               5 |         0 |
| N0       |          0 |             0 |               0 |         0 |
| N1       |          0 |             0 |               1 |         0 |

Existing DEV is a stratified challenge set with no SAME_EVENT labels, so absence of false splits there cannot establish recall. Historical Gold diagnostics are likewise not production estimates. No new candidates were selected, and no human annotation was performed.

## Private artifact hashes

- fresh_graph_context_sha256: `fe0f3372cca91d8ccbc775dac7ba97e3855c076b6ae79ae032a32b27d49223b9`
- historical_graph_context_sha256: `4f9d53f6f3443e403b67f69c818e8d74d15d2874fc3990450bef65e674af5d16`
- graph_strategy_catalog_sha256: `70dd2bcb55bbd36a9bf4327ef8bd3c980e5a10b9a5f4af0ade4e12472f2b8a9c`
- strategy_diagnostics_sha256: `9214b1c5aecc308fae8d06344b291a20aedd77cb00786d0b439df16893fbeb35`
- pack_feasibility_sha256: `42ab2a1d611183bf7a96d5873cfdff55b7dedc11a979e2277a249a5bc55ac815`
- graph_context_audit_sha256 (R2A): `2358b4f51c6b71f9cc5b0f36f0e662a46588812250cd8dba4970a5ca33892e8d`
- graph_context_manifest_sha256 (R2A): `429c4c06b6c57ca52f2ea6d5cab707aadcdf2b95b8027ff2950943e054d901fb`
