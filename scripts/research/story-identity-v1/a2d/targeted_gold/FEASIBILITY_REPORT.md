# STORY-02-A2D2 feasibility report

This report records a label-blind design run on the exact frozen inputs. The
sampler did not load or use historical Gold decisions, and no new decisions
were created. Private row-level artifacts remain outside Git.

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

## Joint pack feasibility and frozen composition

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

## Isolation, blinding, and governance

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

## Recommendation

The existing Home-200 corpus satisfies both pack targets, article isolation,
source diversity, and the six-chain challenge requirement. A fresh corpus is
not required for this design. DEV_AUGMENT is ready for the next annotation
stage. BLIND_CHALLENGE remains frozen and sealed until candidate/scorer and
operating point are fixed after DEV work; its labels must not be used for
feature selection or tuning.

No provider, product, persistent state, or Miniflux changes are part of this
work.
