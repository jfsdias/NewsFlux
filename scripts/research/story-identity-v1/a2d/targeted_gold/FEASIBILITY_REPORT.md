# STORY-02-A2D2 feasibility report

This report records a label-blind design run on the exact frozen inputs. The
sampler did not load or use historical Gold decisions, and no new decisions
were created. Private row-level artifacts remain outside Git.

The V1 results below are a historical snapshot. PM review superseded that
freeze before labeling because its BLIND graph collapsed into one component.
The V1 files remain intact and their manifest SHA is
`1a263efa48392146c24c44069fd2f31ce8fcd70ddbae833e0d6f07f0e85b7c6b`.

## Input and candidate coverage

| Measure                                                   |                                       Observed |
| --------------------------------------------------------- | ---------------------------------------------: |
| Home-200 articles                                         |                                            200 |
| Gold V2 pairs excluded by canonical pair key              |                                            233 |
| Gold V2 unique articles                                   |                                            153 |
| Home-200 articles unseen in Gold V2                       |                                             47 |
| Eligible non-Gold pair universe                           |                                         18,720 |
| Eligible pairs within the P3 24-hour ceiling              |                                         18,720 |
| Blind-eligible pairs with both articles unseen in Gold V2 |                                          1,003 |
| Input SHA gates                                           | PASS, all four; human-label artifact hash only |

The Qwen feature quantiles over the eligible unlabeled universe were q50
`0.26494259`, q75 `0.35303430`, and q90 `0.43751195`. Lexical q50/q75/q90
were all zero because the feature distribution is sparse. The sampler uses a
predeclared lexical evidence floor of `0.05`; it does not tune this floor from
human decisions.

The canonical human-label artifact matched its expected SHA256. Only its bytes
were hashed for provenance; the file was not parsed, and no label values were
used.

## V1 — historical frozen composition, superseded before labeling

Both packs were selected in one seeded run (`20261026`) before any new
annotation.

| Measure                             | DEV_AUGMENT | BLIND_CHALLENGE |
| ----------------------------------- | ----------: | --------------: |
| Target                              |          80 |              48 |
| Selected                            |          80 |              48 |
| Unique articles                     |          98 |              39 |
| Unique feeds                        |          29 |              17 |
| Unique source pairs                 |          66 |              32 |
| Positive-seeking mining bucket      |          28 |              16 |
| Hard-negative-seeking mining bucket |          28 |              16 |
| Boundary/disagreement mining bucket |          16 |               8 |
| Diversity-control mining bucket     |           8 |               8 |
| Multi-pair components               |           9 |               1 |
| Max single-feed endpoint share      |      11.87% |          18.75% |
| Max source-pair share               |       5.00% |           8.33% |
| Category dominance warning (>50%)   |          NO |              NO |

Category composition is reported as descending article-count histograms with
category names omitted to keep private source metadata out of the repository:
DEV `41, 18, 17, 14, 3, 2, 2, 1` (98 articles); BLIND `17, 12, 3, 2, 2, 2, 1`
(39 articles). The largest category is below 50% in both packs. DEV has 10
independent pairs and 9 multi-pair components; BLIND has 0 independent pairs,
1 multi-pair component, and 6 vertex-disjoint chain groups.

Selected temporal bands were:

| Band  | DEV_AUGMENT | BLIND_CHALLENGE |
| ----- | ----------: | --------------: |
| 0–1h  |          27 |              17 |
| 1–4h  |          43 |              23 |
| 4–8h  |          10 |               8 |
| 8–24h |           0 |               0 |

BLIND_CHALLENGE contains six vertex-disjoint two-edge chain groups mined only
from candidate retrieval topology and rank; each group remains entirely in the
challenge pack. The group construction makes no assertion about event labels.

## V1 — historical isolation, blinding, and governance

- DEV/BLIND pair overlap: 0.
- DEV/BLIND article overlap: 0.
- BLIND/Gold V2 pair overlap: 0.
- BLIND/Gold V2 article overlap: 0.
- Source-feed caps: PASS; source-pair caps: PASS.
- DEV quota spillover: none.
- Reviewer CSV fields are restricted to the approved annotation view; mining
  strata, model outputs, selection reasons, and dataset identity are kept in
  private sidecars.
- Repeated selection, reviewer order, manifests, and sidecars were byte
  identical for the same inputs and seed.
- The private freeze verifier checked pack hashes, schema, blank decision
  fields, isolation counts, sealed-state metadata, and absence of human-label
  files.
- Both datasets were selected and frozen together before any new annotation;
  no new human labels were created.
- Both packs are frozen. No annotation or new human label file exists.

## V1 — historical recommendation, superseded

The V1 recommendation treated the pack targets, isolation, source diversity,
and six-chain requirement as sufficient. It considered DEV ready for
annotation and BLIND sealed for later evaluation. That recommendation was
superseded before any labels because those six chains were joined into a single
component. Neither V1 pack is authorized for annotation under the R2 contract.

No provider, product, persistent state, or Miniflux changes are part of this
work.

## R1 — component-aware greedy selection

R1 preserved the frozen inputs and obtained 35/48 BLIND pairs, with bucket
counts `5/14/8/8`. The partial graph had 15 components, 9 independent pairs,
6 multi-pair components, at most 8 pairs and 7 articles per component, and
6 designated chain groups with zero bridges. Its structural gates passed;
the exact quota gate failed. No V2 pack was written. The greedy result does not
prove that an exact 48-pair design is infeasible.

## R2 — joint bounded search

The frozen BLIND-eligible pool contains 1,003 pairs. The following counts are
aggregate, label-blind capacities before topology or joint DEV constraints:
No embedding or model inference was run. The existing frozen A/B/C feature
predicates were re-evaluated in memory against the same frozen scores for bucket
assignment; no prediction artifact was created.

| Bucket                | Pairs | Unique articles | Unique feeds | Unique source pairs | Quota |
| --------------------- | ----: | --------------: | -----------: | ------------------: | ----: |
| Positive seeking      |    45 |              22 |           11 |                  23 |    16 |
| Hard-negative seeking |    91 |              37 |           17 |                  47 |    16 |
| Boundary/disagreement |   226 |              46 |           16 |                  85 |     8 |
| Diversity control     |   641 |              47 |           17 |                 107 |     8 |

All raw bucket capacities meet their numerical quota. There are 425 eligible
two-edge chain candidates, with the following bucket compositions:

| Chain bucket composition      | Count |
| ----------------------------- | ----: |
| Boundary + boundary           |     5 |
| Boundary + diversity          |    75 |
| Boundary + hard negative      |     4 |
| Boundary + positive           |     5 |
| Diversity + diversity         |   246 |
| Diversity + hard negative     |    28 |
| Diversity + positive          |    10 |
| Hard negative + hard negative |     1 |
| Hard negative + positive      |     1 |
| Positive + positive           |    50 |

Each of the 1,003 individual eligible edges can form a singleton before any
other edge is selected; this count is not a claim that all can be independent
simultaneously. Their bucket counts are the same as the raw counts above.

The deterministic joint branch-and-bound search uses seed `20261026`, keeps
chains and singleton edges unfixed, checks component and source caps while
searching, and searches DEV after each structurally valid BLIND selection.
Two independent canonical runs returned byte-identical aggregate output:

| Search certificate                  |    Result |
| ----------------------------------- | --------: |
| Node limit                          |   500,000 |
| Nodes explored                      |   500,000 |
| Branches pruned                     | 2,434,156 |
| Bucket-capacity prunes              |   248,519 |
| Component-limit prunes              | 2,099,993 |
| Chain-bridge prunes                 |         0 |
| Source-cap prunes                   |    85,644 |
| DEV-infeasible prunes               |         0 |
| Other prunes                        |         0 |
| Maximum partial BLIND pairs reached |        31 |
| Complete BLIND candidates reached   |         0 |

`SEARCH_STATUS=SEARCH_LIMIT_REACHED`; the search is incomplete and did not
find a complete witness. It does not prove that the frozen corpus or the
constraints are infeasible. `PACK_FREEZE_V2=NO`; no V2 pack, sidecar, manifest,
or label was written. The next research step is a search-method review, not a
fresh-corpus requirement. The prior 8–24h coverage gap remains a non-blocking
residual and was not forced into the sample.
