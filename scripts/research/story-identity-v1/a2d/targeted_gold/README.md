# STORY-02-A2D2 targeted Gold design

This versioned tool designs `DEV_AUGMENT` and `BLIND_CHALLENGE` together from
the immutable Home-200, Gold V2, and pair-universe inputs. It reads only Gold
pair keys and article IDs; labels are not loaded into the sampler. It does not
annotate, train, evaluate, fit a final model, or change product/runtime state.
The existing human-label artifact is fingerprinted by SHA only; its contents
are not parsed or used by A2D2.

## Frozen input and mining contract

- Gold V2 pair keys are canonicalized as `min(id_a,id_b):max(id_a,id_b)` and
  excluded before feature thresholds or selection.
- Candidate features are label-free: Qwen similarity, lexical overlap,
  temporal delta, entity/number/date overlap, retrieval rank, candidate A/B/C
  predictions, source pair, category, and cross-feed structure.
- The A2D2 candidate selection pool is restricted to the existing P3 temporal
  ceiling of 24 hours. Pairs outside the window remain counted in the eligible
  non-Gold universe but are excluded before thresholds and selection.
- Quantiles are computed once from the eligible non-Gold pair universe using
  deterministic linear interpolation. The lexical distribution is sparse, so
  positive lexical evidence uses the fixed feature floor `0.05`; the quantile
  values are still retained in the private sidecar.
- The primary mining buckets are not labels. Priority is:
  `POSITIVE_SEEKING`, `HARD_NEGATIVE_SEEKING`, `BOUNDARY_DISAGREEMENT`, then
  `DIVERSITY_CONTROL`.
- Positive seeking includes upper-quartile semantic similarity plus lexical,
  entity, number, or date corroboration, and the high-semantic / short-time
  region even where lexical evidence is low. This deliberately samples an
  A2D blind spot without claiming a positive label.
- Hard-negative seeking includes high semantic similarity without
  corroboration, low-semantic lexical alias risk, same-entity feature
  collisions, and temporally divergent plausible pairs.
- A/B/C outputs use the frozen A2D median settings only as mining descriptors:
  A `0.625 / 0.35`, B `0.75 / 8h`, C `0.70`. They are not expected labels and
  are hidden from reviewers.
- Required S1–S10 tags are assigned from the feature rules in `sampler.py`.
  Each selected pair receives one primary bucket for quota accounting and may
  carry multiple private mining tags.

The preregistered feature regions are:

| Tag | Feature-only region                                                    |
| --- | ---------------------------------------------------------------------- |
| S1  | Qwen at/above eligible-pool q90 and lexical overlap ≥0.05              |
| S2  | Qwen q75–q90 and lexical overlap ≥0.05                                 |
| S3  | Qwen at/above q90 and lexical overlap <0.05                            |
| S4  | Entity-anchor overlap >0 with absent number or date overlap            |
| S5  | Lexical overlap ≥0.05 below Qwen q50                                   |
| S6  | Qwen q75+ with entity-anchor overlap and absent number or date overlap |
| S7  | Qwen q75+ or lexical overlap ≥0.05 with temporal gap >4h               |
| S8  | Disagreement among frozen candidate A/B/C predictions                  |
| S9  | Qwen q75+, corroboration (lexical/number/date/entity), and gap ≤8h     |
| S10 | The residual diversity-control region when no other tag applies        |

Primary bucket priority is positive seeking first; then hard-negative seeking;
then boundary/disagreement; then diversity control. Positive seeking also
includes high Qwen q90+ pairs within 8h even when lexical evidence is low, so
the high-semantic/low-lexical blind spot is represented without claiming a
class label. Hard-negative seeking covers unsupported high-semantic pairs,
low-semantic lexical aliases, same-entity feature collisions, and plausible
pairs with a gap over 8h.

## Quotas, isolation, and ordering

DEV target composition is `28/28/16/8`; BLIND target composition is `16/16/8/8`
for positive seeking / hard-negative seeking / boundary-disagreement /
diversity-control. The historical V1 selection allowed DEV spillover:

- positive-seeking shortfall → boundary/disagreement, then diversity-control;
- hard-negative-seeking shortfall → boundary/disagreement, then
  diversity-control.

There is no spillover in the R2 exact search. It jointly explores BLIND edges
and DEV choices, with chain groups and independent pairs determined by the
selected graph rather than fixed in advance. Six qualifying chains must occupy
separate connected components. BLIND endpoints must be absent from Gold V2;
DEV and BLIND must be article-disjoint. Pair, source, category, component,
and exact bucket constraints remain hard gates.

The bounded branch-and-bound search uses seed `20261026` and chooses the bucket
with the smallest remaining raw-candidate-to-deficit ratio. It maximizes unique
sources followed by unique articles over both packs, with a stable hash
tie-break. Only a completed search can certify that objective. A node limit
returns `SEARCH_LIMIT_REACHED`, even if a feasible witness was found; it is not
a proof of infeasibility and cannot authorize a freeze.

Selection is deterministic with seed `20261026`. The human review order is
deterministically shuffled separately for DEV and BLIND. Reviewer CSVs expose
only annotation ID, canonical pair key, feed names, titles, timestamps, label
options, and an empty decision field. Mining strata, model outputs, selection
reason, and DEV/BLIND identity remain private in sidecars.

The BLIND state machine is:

`SELECTED → FROZEN → ANNOTATED_SEALED → OPENED_FOR_FINAL_EVALUATION → RETIRED_AS_BLIND`.

Only `OPENED_FOR_FINAL_EVALUATION` is consumable by final evaluation. A2D2
stops at `FROZEN` if all freeze gates pass; R2 has not frozen V2 and no human
label file is generated.

## Private execution

Run `run_design.py` for an aggregate-only feasibility report. The deterministic
node limit defaults to 500,000 and can be set with `--search-limit`. `--freeze`
requires a completed feasible search, repeats the canonical run, compares
selection and artifact bytes, and writes only to the separate V2 private path.
The V1 freeze is verified before and after writing. Never add private packs,
sidecars, manifests, pair IDs, titles, URLs, or labels to Git.
