# Story 02 fresh V2 feature capacity

The frozen 500-article research corpus and its 33,135 cross-feed P3 pairs were processed without human decisions or pack selection. Two independent V2 embedding passes and two offline feature derivations produced identical bytes. The existing `FeatureExtractor`, A/B/C scoring functions, and `targeted_gold` quantile, strata and bucket implementations are reused.

Input corpus SHA256: `3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206`. P3 input SHA256: `056d5bb76e5f0d4cf036fa7d3da8f973f5516bf006f7d4ac838a87ced742efec`. P1 canary receipt SHA256: `540eb9f303262370e1ace5ab702dbbb99ec62b631d3089b66cf1263679a43d68`.

Qwen q50/q75/q90: `0.26359951165666157`, `0.3500810927505601`, `0.4396519774747374`. Lexical q50/q75/q90: `0`, `0`, `0`; the pre-existing `0.05` lexical floor remains unchanged.

| Primary bucket        |  Pairs | Articles | Feeds | Source pairs | 0–1h |  1–4h |  4–8h | 8–24h |
| --------------------- | -----: | -------: | ----: | -----------: | ---: | ----: | ----: | ----: |
| Positive seeking      |  1,854 |      388 |    49 |          358 |  260 |   678 |   571 |   345 |
| Hard negative seeking |  6,710 |      483 |    52 |          692 |  336 |   898 |   894 | 4,582 |
| Boundary disagreement |  8,181 |      500 |    52 |          758 |  531 | 1,501 | 1,371 | 4,778 |
| Diversity control     | 16,390 |      500 |    52 |          732 |  944 | 2,861 | 2,844 | 9,741 |

S1–S10 counts: `447, 148, 2867, 390, 177, 345, 6414, 45, 294, 25735`. Strata may overlap. Each pair has one primary bucket. Raw numerical capacities meet the combined future quotas; this is not a witness of structural feasibility.

The full P3 graph has one connected component with 33,135 edges and 4,633,473 two-edge chain seeds. These aggregate diagnostics do not select chains or packs and do not establish feasibility of a future disjoint design.

Embedding SHA256: `1fd1f5335117a28549df669ee7fe0cd4b93a3d442efd970d5ca6e06cbfd31380`.

Feature universe SHA256: `0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da`.

Capacity audit SHA256: `336b092b354b34fb1e471b089ca4bd8b38c11fddbaea898bb056f3ad4e05ce36`.

Manifest SHA256: `0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e`.
