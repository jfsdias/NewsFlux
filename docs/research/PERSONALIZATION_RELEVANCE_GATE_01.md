# Personalization Relevance Gate 01

## Purpose and decision boundary

This research gate asks whether the current Home Personalization V1 has demonstrated editorial benefit over the deterministic Phase 2C composition, and what evidence would be needed before considering V2. It does not authorize V2, change ranking behavior, or establish that a proxy metric is a user benefit.

**Audited base:** `0faedf939f6c97867d6fac6c019f48476163d629`.

**Research inputs:** the PR #190 offline evaluator and its 12 fixed synthetic scenarios, including the final-composition disclosure behavior integrated with PR #191. The original PR #190 reports and source were not edited. A new deterministic receipt contains only the added relevance metrics and points to the exact base used for this run.

**Isolation:** no `src/` changes, Miniflux access, private/account data, external AI, persistent state, production mutation, or deployment. All/Unread are outside the evaluator and remain on their existing chronological request path. The current implementation is Home-only.

## Current implementation and existing evaluation

Home presents the final composition in this order: Highlights, category lanes, then Latest. The current V1 projection uses up to 75 starred entries to derive source and category affinity, retains the primary highlight, and applies a 60-minute freshness window with deterministic tie-breaking. The evaluator composes both Phase 2C and V1 through the existing production Home/session/category helpers; it does not create a second ranking implementation.

The predecessor evaluator already records:

- Top-N set before evaluation: first 12 article IDs in final visual order (up to 3 Highlights plus 9 category-lane slots).
- The same 12 scenario identities for Phase 2C and V1.
- 101 local composition timing samples per arm. These repetitions are timing measurements, not 101 independent editorial observations.
- Distinct sources/categories, adjacent same-source pairs, longest same-source run, age displacement, freshness boundary, primary highlight, coverage, duplicate IDs, category identity, Reader order, disclosure parity, and session stability.
- Synthetic fallbacks for empty, invalid, late, and stale profiles, plus Load More, read/star/unstar, refresh, Reader return, generation/revision fencing, category identity, and freshness boundary checks.

The gap addressed here is a reproducible distribution view: the article share attributed to each source, source concentration, and representation of eligible source/category identities in the final Top-N. These are descriptive composition metrics only.

## Metric definitions

All Top-N measurements use the first `min(12, displayed article slots)` IDs in the **final visual order**. Eligibility is the fixture's unread entries. Feed and category identity use IDs, never display titles. Missing source/category IDs are reported as unidentified slots and are not invented as identities.

| Metric                                                                                            | Definition and formula                                                                                                                                                                                             | Unit / source                                                               | Interpretation and limitation                                                                                                    | Expected direction / decision relevance                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Distinct sources                                                                                  | Count of distinct non-null `feed.id` values in Top-N.                                                                                                                                                              | Sources; final composition IDs joined to synthetic entries.                 | Structural variety; does not say whether sources are useful, trustworthy, or relevant.                                           | No universally preferred direction. Context for review, not a standalone approval metric.         |
| Distinct categories                                                                               | Count of distinct non-null `feed.category.id` values in Top-N.                                                                                                                                                     | Categories; same source.                                                    | Structural category breadth; does not measure topical distance or category quality.                                              | No universally preferred direction.                                                               |
| Per-source Top-N share                                                                            | For source `s`, `articles from s / Top-N slots with an identified source`. Shares sum to 1 over identified source slots. Unknown-source slots are separately counted.                                              | Fraction per source; same source.                                           | Shows how visible positions are allocated; affected by the synthetic fixture's supply and by Top-N size.                         | No universal target. Inspect alongside user judgment and eligibility distribution.                |
| Largest source share                                                                              | `max(per-source Top-N share)`.                                                                                                                                                                                     | Fraction; derived from source shares.                                       | A simple concentration signal; it can fall while the experience becomes less useful.                                             | Lower means less source concentration, not higher relevance.                                      |
| Source concentration HHI                                                                          | `sum(share(s)^2)` over identified-source Top-N slots.                                                                                                                                                              | Unitless, 0–1; derived from source shares.                                  | Lower values indicate a more even source distribution. It ignores article meaning, quality, supply, and preferences.             | Descriptive proxy only; not an optimization objective by itself.                                  |
| Eligible source representation                                                                    | `distinct eligible feed IDs represented in Top-N / distinct eligible feed IDs`.                                                                                                                                    | Fraction, or unavailable if denominator is zero; fixture entries and Top-N. | Indicates whether available sources appear at all; does not weight their eligible article counts.                                | Higher is broader coverage, not necessarily better curation.                                      |
| Eligible category representation                                                                  | `distinct eligible category IDs represented in Top-N / distinct eligible category IDs`.                                                                                                                            | Fraction, or unavailable if denominator is zero; fixture entries and Top-N. | Same limitation as source representation; category IDs are preserved even when titles collide.                                   | No universal target; use as a coverage diagnostic.                                                |
| Adjacent same-source pairs                                                                        | Count positions `i` where `feedId[i] == feedId[i+1]`, excluding missing IDs.                                                                                                                                       | Pair count; final Top-N order.                                              | Detects local repetition, not whether two neighboring stories are actually duplicates.                                           | Fewer can reduce source repetition, but may be undesirable if the stories are unusually relevant. |
| Longest same-source run                                                                           | Maximum consecutive run with the same known feed ID; missing IDs break a run.                                                                                                                                      | Article slots; final Top-N order.                                           | Detects a sustained source streak not captured by distinct-source count.                                                         | Descriptive; no standalone threshold.                                                             |
| Promotion age displacement                                                                        | For an article moved upward, its rank before/after and age from the primary; at each changed rank, `age(V1 item) - age(Phase 2C item)`. The receipt preserves the evaluator's positive “V1 item is older” measure. | Rank, minutes; `published_at` in synthetic fixtures.                        | Quantifies freshness trade-offs in the fixtures; does not infer importance or urgency.                                           | Smaller displacement can protect recency, but the acceptable trade-off is a product decision.     |
| Primary highlight / coverage / uniqueness / category identity / Reader parity / disclosure parity | Existing evaluator booleans: primary unchanged; every eligible ID appears exactly once; category IDs remain distinct; Reader order equals visual order; disclosure matches committed final composition.            | Pass/fail per scenario; existing production helpers.                        | Correctness guardrails, not relevance evidence.                                                                                  | Must remain passing before editorial comparisons are interpretable.                               |
| Session stability                                                                                 | Existing deterministic transitions for Load More, read/star/unstar, refresh, Reader return, stale/late/invalid profile and generation/revision handling.                                                           | Pass/fail; existing evaluator helpers.                                      | Synthetic local state contract, not a browser, network, or real-account race test.                                               | Must remain passing.                                                                              |
| Freshness boundary                                                                                | Existing 60-minute boundary fixture and helper test at 60 versus 61 minutes.                                                                                                                                       | Minutes; fixed synthetic timestamps.                                        | Verifies the stated rule at a boundary; does not establish that 60 minutes is the right editorial window.                        | Correctness guard only; the window itself is not recalibrated here.                               |
| Local projection latency                                                                          | Existing 101-run median/p95 for projection, composition, disclosure helpers.                                                                                                                                       | Milliseconds; local Node process.                                           | Excludes API/network, browser layout, rendering, device, and user-perceived response. The new receipt omits noisy timing values. | Engineering diagnostic only, not editorial value.                                                 |

**Objective measures** are IDs, counts, shares, ranks, timestamps, and local timings computed from fixed fixtures. **Proxy measures** are diversity, concentration, source repetition, and age displacement when used as stand-ins for experience. **Human judgment** would be a participant's comparative assessment; none was collected. **Unmeasured assumptions** include whether starred sources express current intent, whether a source streak is unwanted, and whether any structural distribution change feels more useful.

## Offline evaluation and measured findings

The reproducible supplementary calculation is in `scripts/tests/personalization-relevance-gate-01.js`, with a test in `scripts/personalization-relevance-gate-01.test.js` and receipt in `scripts/tests/reports/personalization-relevance-gate-01.json`. Re-run with:

```sh
node scripts/personalization-relevance-gate-01-report.js 0faedf939f6c97867d6fac6c019f48476163d629
node --test scripts/personalization-relevance-gate-01.test.js
```

It reads the existing evaluator's 12 fixed scenarios and final compositions; it does not edit or rewrite the predecessor's report. Metric output is deterministic. The separate predecessor report still contains timing samples, which naturally vary by run.

Observed in these 12 fixtures:

- All 12 preserve the primary highlight, eligible article coverage, unique IDs, category identity, Reader order, and final-composition disclosure parity.
- Distinct Top-N source count increased in 2 scenarios and was unchanged in 10; it did not decrease.
- The source HHI proxy decreased in 2 scenarios and was unchanged in 10; it did not increase.
- Eligible-source representation increased in 2 scenarios and was unchanged in 10. Eligible-category representation was unchanged in all 12.
- Adjacent same-source pairs improved in 2 scenarios, were unchanged in 9, and worsened in 1.
- The source-concentrated profile fixture changed HHI from `0.708333` to `0.375000` and largest source share from `0.833333` to `0.583333`.
- The category-concentrated profile fixture changed HHI from `0.708333` to `0.180556` and largest source share from `0.833333` to `0.250000`.
- In `secondary_highlight_changed_by_current_star`, source HHI remained `0.183673`, source representation stayed 6/6, and category representation stayed 6/6. The adjacent same-source pair count increased from 0 to 1 and the longest run from 1 to 2. The primary remained ID 5001; ID 5007 moved from position 7 to 2 and was 25 minutes older than the item it displaced at rank 2.
- The exact freshness fixture produced a maximum 50-minute older-at-same-rank comparison. This is a fixture result, not a global upper bound or a recommended tolerance.

These are measurements of deliberately constructed distributions. In particular, the improved HHI in the concentrated-profile fixtures demonstrates that V1's diversity ordering can spread those synthetic compositions. It does not show that participants prefer the resulting stories. The direct-star fixture demonstrates that an individual promotion can add adjacency repetition without changing source concentration or representation. There is no aggregate score and no statistical confidence interval: the 12 fixtures are fixed cases, not a random sample from readers or feeds.

## Scenario coverage and whether to add fixtures

The historical 12 scenario identities remain unchanged. Their roles and gaps are:

| Requested condition                            | Existing coverage                                              | Remaining limitation                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Many sources with similar subjects             | Several-source fixtures exist.                                 | Titles/content are synthetic and do not encode semantic similarity. Not covered as a topic-relevance test. |
| Dominant source in star history                | `star_profile_concentrated_in_one_source`.                     | One fixed synthetic source distribution; no real cadence or user preference.                               |
| Interest concentrated in a category            | `star_profile_concentrated_in_one_category`.                   | ID-level category affinity only; no semantic quality labels.                                               |
| Recent low-affinity versus older high-affinity | Exact 60-minute freshness boundary plus age displacement.      | No human judgment of an affinity/recency trade-off or calibration of the window.                           |
| Sources with different publication rates       | A concentrated-source fixture creates uneven source frequency. | No explicit longitudinal cadence model or representative rate distribution.                                |
| Very few eligible articles                     | Some fixtures display 6 or 7 eligible items.                   | No 0/1/2-item historical scenario. The metric helper separately guards an empty denominator.               |
| Strongly imbalanced distributions              | Source- and category-concentrated fixtures.                    | Synthetic, intentionally selected, and not prevalence estimates.                                           |
| Direct-star without diversity benefit          | `secondary_highlight_changed_by_current_star`.                 | One case; does not estimate frequency of this outcome.                                                     |
| Empty/insufficient profile                     | Empty, invalid, late, stale profile fallbacks.                 | Does not test every operational/browser timing failure.                                                    |

No new ranking scenarios were added. Additional synthetic distributions could test code boundaries but cannot close the semantic relevance gap, and adding fixtures without an agreed question could overstate evidence. A future, separately identified scenario set is justified only if it tests a pre-registered edge condition or addresses a documented limitation with a non-semantic claim.

## Human relevance protocol for a future authorized study

**Current result: `HUMAN_RELEVANCE_GATE=NOT_MEASURED`.** No ratings, preferences, or human conclusions are claimed here.

1. **Pre-register the decision.** State the product question, evaluation population, eligible-item rules, profile context, exclusions, rubric, analysis, and practical-difference threshold before confirmatory ratings. `THRESHOLD_NOT_ESTABLISHED` until the product owner chooses a meaningful difference; do not select a cutoff after seeing outcomes.
2. **Use paired, blinded presentations.** For each scenario, render the same eligible articles and same Highlights → Category Lanes → Latest structure in both arms. Randomize arm labels and counterbalance presentation order. Do not expose “personalized”, ranking details, or arm-specific metadata. Keep text, theme, and layout identical.
3. **Make preference context valid.** A public-content pilot with a participant-declared topic profile can test whether selections match that stated profile, but it is not a full test of the current star-history signal. Evaluating V1's actual inferred profile would need a separate, explicit authorization and privacy design. Do not read a real Miniflux account under this research gate.
4. **Ask paired questions.** Record `A`, `B`, `tie`, or `neither` for overall usefulness. Rate each arm on a fixed labeled scale for interest, relevance to the stated context, highlight quality, variety/affinity balance, unnecessary repetition, contextual freshness, organization clarity/predictability, and confidence. Provide “cannot judge” and a short reason. Do not collapse these dimensions into an unvalidated single score.
5. **Use independent judgments.** Have at least two independent reviewers assess the material when feasible, with disagreements retained. Adjudicate factual article/event labels separately from personal preference; do not force preference disagreement into consensus. Report agreement and the cases that drove disagreement.
6. **Protect data.** Prefer owner-approved public, preselected articles. Obtain participant consent, collect only the declared context and ratings needed, use a pseudonymous study key, prohibit external AI transfer, and set a retention/deletion date before collection. No account credentials, reading history, or persistent product profile. Any use of real account-derived signals requires separate authorization, purpose, minimization, retention, and discard rules.
7. **Analyze paired results.** Report the A/B/tie/neither rates and each rubric dimension by scenario and participant. Use participant-clustered paired bootstrap intervals for descriptive uncertainty when the sample supports it; disclose the interval method and limits. Do not use significance alone as a product gate. If sample size, independent judgments, or profile validity are insufficient, result is `EVIDENCE_INSUFFICIENT`.

No sample-size target is set now because neither a practical difference nor rating variance has been established. A blinded pilot may estimate variance and feasibility; the owner must then set the minimum practically important difference before a confirmatory run. If that decision is not made, report the study as descriptive/inconclusive.

## Functional and privacy guardrails

The current synthetic evaluator reports all six per-scenario composition invariants as passing in 12/12 cases: primary highlight preserved, coverage, uniqueness, category identity, Reader order parity, and disclosure parity. The existing session-stability checks pass for their named synthetic transitions. The existing 60-minute freshness boundary tests remain unchanged.

All/Unread chronology is not an outcome of this Home experiment and was not ranked. This PR changes only research scripts, tests, a JSON receipt, and a research document; no production source, request builder, or sort setting changes. The existing article-list temporal ordering and request tests remain the relevant code contracts, and are included in the repository test gate.

Privacy checks: no real Miniflux reads or writes; no private or personal data; no new persistent state; no external AI transfer; no production mutation. Miniflux remains source of truth for feeds, categories, read/unread, and starred state.

## Decision matrix for future work

| State                        | Evidence required                                                                                                                                                              | Resulting action                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `EVIDENCE_INSUFFICIENT`      | Missing human ratings, invalid/too-small set, unrepresentative profile context, contradictory estimates, or unresolved uncertainty.                                            | Do not claim benefit or authorize V2; improve the evidence design only with owner agreement. |
| `V1_ACCEPTABLE`              | Functional guardrails pass, and independent human evidence does not reveal a repeated practically important harm under the pre-registered decision rule.                       | V1 may remain; this does not mean it is optimal or that V2 is prohibited.                    |
| `V1_IMPROVEMENT_OPPORTUNITY` | A specific, repeatable shortcoming is visible in offline cases and supported by human judgments, with the affected context identified.                                         | Define a narrow product question; no automatic implementation authorization.                 |
| `V2_RESEARCH_JUSTIFIED`      | Independent, relevant evidence shows a bounded user-valued opportunity over V1, with no unacceptable freshness, repetition, predictability, privacy, or correctness trade-off. | Authorize another research/experiment proposal only; not implementation.                     |
| `HOLD_PRODUCT`               | The value trade-off, user control, or priority is unresolved.                                                                                                                  | Wait for a product decision.                                                                 |
| `HOLD_ARCHITECTURE`          | Source of truth, storage, retention, privacy, reversibility, or local/server computation is unresolved.                                                                        | Wait for an architecture decision.                                                           |

No numeric acceptance thresholds are inferred here. `THRESHOLD_NOT_ESTABLISHED`. The owner should define the practical difference and acceptable trade-offs before confirmatory human data is unblinded. Any candidate must pass functional correctness first; a proxy-only improvement cannot approve V2.

## Current assessment

**V1:** `FUNCTIONALLY_STABLE_IN_THE_12_SYNTHETIC_FIXTURES; EDITORIAL_BENEFIT_NOT_DEMONSTRATED`. The offline metrics show source-spread changes in two intentionally concentrated fixtures and a repetition regression in the direct-star fixture. They do not establish reader relevance, satisfaction, population-level benefit, or production performance.

**V2:** `EVIDENCE_INSUFFICIENT`. The next meaningful evidence step is an owner-approved, blinded human relevance study with a valid preference context and pre-registered decision rule. V2 implementation and activation remain unauthorized. No V2 architecture, persistent state, or model is proposed by this gate.

## Open findings and residual risks

- No human preference or relevance judgments were collected.
- The synthetic titles do not encode semantic topic overlap, story duplication, trustworthiness, or article quality.
- Fixed fixtures do not model real source cadence, user history, profile sparsity, geography, language, or publication bursts.
- Source HHI and representation ignore semantic relevance and source quality.
- The metric Top-N is capped at 12, and some existing fixtures contain fewer than 12 eligible articles.
- Existing offline latency excludes network, React rendering, browser/device behavior, and service availability.
- The predecessor's session/fallback tests are deterministic local tests, not browser or live-account race tests.
- The repository's current All/Unread chronology remains out of scope; this work does not alter it.
- `docs/NEWSFLUX_ROADMAP.md` and `docs/NEWSFLUX_PROJECT_STATE.md` are intentionally untouched because PR #195 is a parallel documentation task. PM reconciliation may be needed later.
