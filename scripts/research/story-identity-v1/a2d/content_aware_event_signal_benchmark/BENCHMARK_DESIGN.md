# D2F content-aware event signal benchmark: design only

## Question and scientific boundary

On identical eligible pair identities, does frozen article content improve
identification of the same occurrence without unacceptable false merges of
related but distinct occurrences? `SAME_EVENT` is merge-positive;
`RELATED_TOPIC` and `DIFFERENT_EVENT` are merge-negative. A shared person,
organization, ongoing story, tournament or subject is not sufficient to
establish the same occurrence. `UNCERTAIN` is excluded from confusion-matrix
label denominators and reported separately. False-merge cost exceeds false-split
cost. No production policy, winning candidate, model or numeric threshold is
selected here.

## Reference and pair universe

The reproducible reference is the frozen title-only Qwen feature pipeline and
A2D candidate specification, including their documented local Qwen model digest,
preprocessing and train-only candidate selection. The V2 signal specification
retains title-only semantic, lexical, entity, number, date, temporal and graph
evidence as a frozen research reference. These are not a deployed production
baseline, and the historical analyses did not select a final policy. Therefore
no unapproved fixed threshold is called a current production threshold.

The fixed fresh universe is the frozen cross-feed P3 pair artifact: 33,135
unique canonical `min(id):max(id)` pairs with publication-time separation at
most 24 hours. The contract pins its SHA-256. It inherits the frozen corpus,
source and category identities, deterministic ordering and prior pack
exclusions; it must not be regenerated or reselected to favor a candidate.
Compare reference and candidates on exactly the same frozen identities, with a
separate full-universe coverage denominator and explicitly named eligible and
scoreable subsets. Freeze each evaluated pair-set hash before labels are opened.

The fresh corpus was explicitly constructed disjoint from Home-200 and Gold V2.
Historical Gold results therefore cannot be presented as a paired comparison
against the 500-record D2E3 sidecar: its historical article content is not in
that sidecar. Historical reference evidence is contextual only unless a later
separately approved, matching-content dataset exists. This is a hard evidence
boundary, not a reason to fetch more content now.

## Representations and candidate families

The D2E3 sidecar is the only future article-content input. A usable record
provides normalized content under D2E1; the future V2 representation is
normalized title, one newline and normalized content, capped deterministically
at 8,192 Unicode code points for the combined representation. No title is
inserted into the stored sidecar. Any model-specific limit, tokenizer and
preprocessing must be fixed and approved before the future run. Missing content
is not substituted with another article, publisher, search result or generated
summary.

- **A — content-aware semantic confirmation.** A locally executed multilingual
  bi-encoder is proposed to provide event-similarity evidence. Similarity can
  retrieve or corroborate; semantic similarity alone cannot prove identity.
  Qwen is a reproducible title-only reference, not an automatically selected
  content model. Freeze model, tokenizer, artifact digest, language coverage,
  license and backend only after PM review.
- **B — event-anchor fingerprint.** A versioned deterministic extractor is
  proposed for typed entities and event actions, dates, quantities, locations,
  case/version identifiers and explicit contradictions. Separate the actor
  from what happened. Missing anchors remain unknown. No language-specific
  extractor, lexicon or NER model is approved by this design.
- **C — hybrid.** The preferred proposal uses semantic gating plus independent
  event-anchor confirmation and explicit contradiction vetoes. Compare an
  anchor-first gate and a weighted alternative only if preregistered before
  labels. Do not silently average scores, treat missing evidence as agreement,
  or fit vetoes on held-out errors. Measure false vetoes as well as false merges.
- **D — pairwise reranker reference.** HOLD. A local cross-encoder or NLI-style
  reference could be studied later, but no model is selected, downloaded or
  called. Release requires separate PM authorization, privacy and license
  review, pinned model artifacts, reproducibility and measured cost/latency.

All three proposed candidates remain design-only. Before model selection, PM
must approve local execution and the model and license, Portuguese and other
multilingual coverage, CPU compatibility and memory footprint. Measure model
artifact size, extraction time, peak RAM, throughput and per-pair latency;
unknown costs are not presented as measurements. Embeddings, anchors and
pair-level scores are private if they can expose content or identities.

## Missingness and title-equivalence

The frozen corpus contains 486 usable and 14 nonusable/identity-failure
records, with the original article denominator fixed at 500. Report full-corpus
coverage, content-eligible-pair coverage and scoreable-pair coverage separately.
The primary content candidate is unavailable when required content is missing;
a title-only fallback is a separately named and separately measured variant.
No silent drop or silent fallback is allowed.

Fourteen usable records have normalized content equal to normalized title. Keep
them under the frozen D2E3 classification and report their count, contribution
to eligible-pair coverage, effective-information-gain coverage and future score
distribution. Do not assume they provide new information. No pair-level value
is calculated during this design.

## Labels, selection and blind firewall

No component accesses human labels in this stage. A future authorized
calibration may use only approved DEV data inside component-group training folds;
freeze feature definitions, label-independent pair selection, model and
preprocessing before label access. The historical protocol uses component-group
three-fold outer evaluation and training-only inner selection; apply it only
where its frozen identities and fingerprints are valid. Never substitute
historical labels into the disjoint fresh corpus.

The existing fresh targeted DEV evidence has no observed SAME_EVENT in 120
reviewed pairs. This is a challenge sample, not prevalence evidence. It cannot
establish positive recall or support a positive-selection claim. A credible
fresh positive-evidence and component-disjoint calibration plan requires PM
approval and, where necessary, separately authorized labeling before a run.
The graph DEV set is a frozen negative challenge after selection, not a tuning
set. Do not use its observed errors to revise features or thresholds.

BLIND remains `ANNOTATED_SEALED`. Before at most one future BLIND evaluation,
require PM authorization plus frozen candidate, model/tokenizer, thresholds,
code SHA, pair-universe hash, split and DEV results. BLIND cannot guide model,
feature, taxonomy or threshold choices. Any opening changes its governance
state; do not treat an opened set as reusable blind evidence.

## Metrics and proposed advancement rule

Predeclare SAME_EVENT precision, recall and F1; false-merge and false-split
counts; RELATED_TOPIC false-merge rate; confusion matrix; predicted-merge rate;
and full, eligible and scoreable coverage. Counts expose harms; rates support
comparison when denominators exist. Undefined rates remain undefined. Report
paired candidate-versus-reference differences on identical pairs, component-
level bootstrap intervals where component counts permit, and predefined
strata. Precision-recall or average precision is secondary and cannot substitute
for reporting related-topic false merges. Stratified challenge results are not
population prevalence or production precision estimates.

A candidate may advance only with evidence of improved event identification
on the same pairs and no unacceptable deterioration in false-merge behavior,
including RELATED_TOPIC, with uncertainty and unavailable cases reported.
Evidence insufficient to assess either side means **no advancement**. Numeric
acceptance deltas, minimum evidence and uncertainty treatment require PM
approval before execution; no new number is invented here.

## Error taxonomy and controls

Freeze the following conceptual taxonomy before observing results:
`FALSE_MERGE_RELATED_TOPIC`, `FALSE_MERGE_SHARED_ENTITY`,
`FALSE_MERGE_CONTINUING_STORY`, `FALSE_MERGE_NEAR_TIME_DIFFERENT_EVENT`,
`FALSE_SPLIT_PARAPHRASE`, `FALSE_SPLIT_LOW_CONTENT`,
`FALSE_SPLIT_CROSS_SOURCE`, `CONTENT_UNAVAILABLE`, and
`CONTENT_TITLE_EQUIVALENT`. Multiple tags can describe one error; do not sum
them as mutually exclusive counts. Extend or revise only before a future run,
with PM approval, never by inspecting BLIND errors.

A future run must pin the base and code SHA, corpus and D2E1/D2E3 hashes,
frozen pair and approved label hashes, split fingerprints, candidate config,
model and tokenizer digests, versions, seeds, backend and thresholds. Distinguish
frozen-data reproducibility, model reproducibility and run reproducibility from
unknown future live-source stability. No live Miniflux, publisher or external
article-data request is part of the benchmark. Tracked reports contain only
aggregates, hashes and methodology; content and potentially identifying
intermediates remain private.

## Unresolved gates

PM must approve a fresh positive-evidence plan, label access, candidate/model
and preprocessing, the numeric acceptance and uncertainty rules, and the
execution itself. The existing D2F identifier is
`STORY_02_A2D2C_P4_D2F_CONTENT_AWARE_EVENT_SIGNAL_BENCHMARK`; this PR covers
its design only. It does not release any of those gates.
