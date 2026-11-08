# Personalization Human Relevance Pilot Prep 01

**Repository:** `jfsdias/NewsFlux`

**Prepared against main:** `a9acc0280153d3b5ac4ffcda838b29381aa1a757`

**Mode:** research and study preparation only

**Human data collection:** not started and not authorized by this PR

**Personalization V2:** not implemented or authorized

## Decision boundary

This document prepares a blinded, paired pilot to compare the deterministic Phase 2C Home composition with the current Home Personalization V1 ordering. It does not claim that V1 is more relevant, does not establish a practical-benefit threshold, and does not authorize data collection, production changes, or V2.

PR #190's evaluator and reports, and PR #196's relevance metrics, remain unchanged. The existing work is useful for composition correctness and synthetic distribution diagnostics; it is not human relevance evidence. The parallel Draft PR #195 and `docs/NEWSFLUX_ROADMAP.md` / `docs/NEWSFLUX_PROJECT_STATE.md` are outside this change.

## Live audit and current contracts

- The audited GitHub `main` is `a9acc0280153d3b5ac4ffcda838b29381aa1a757`, matching the task baseline.
- PR #190 and PR #196 are merged. Their historical reports and 12 scenario identities remain on `main`.
- PR #195 is an open Draft documentation PR for ARTICLE-INTEL-01; it is not a personalization study or implementation overlap.
- Current Home structure is Highlights → category lanes → Latest. Phase 2C selects a deterministic editorial projection. V1 applies a deterministic preference projection to Home only; All and Unread remain on their existing chronological paths.
- V1 derives source/category affinities from a bounded set of starred-entry profile rows (limit: 75), with a 60-minute freshness window and stable tie-breaking. Miniflux remains the source of truth for starred/read state. The study must not read a live account or write to Miniflux.
- The existing evaluator uses the production projection/session helpers and 12 fixed synthetic scenarios. PR #196 adds descriptive Top-N source-share, concentration, representation, and adjacency metrics. All 12 synthetic cases passed the existing composition guardrails, but the contents are not semantic news examples and no participant preference was measured.

## Reuse assessment

No survey platform, participant-response backend, study randomizer, or research-data store is configured in the NewsFlux repository. The existing Home evaluation scripts and fixture browser harness are reusable as **offline stimulus-generation references**, not as a blind study system. No tool was installed or configured for this preparation.

| Option                                                                  | What is reusable                                                                                                                 | Fit and limitations                                                                                                                                                                                                                                                                                                                                                                                                                       | License / cost / privacy assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LimeSurvey Community Edition (preferred candidate, conditional)**     | Self-hosted survey instrument; official manual documents question/group randomization and CSV export. The CE is GPL v2-or-later. | Good fit for the questionnaire and controlled response collection. It is not the Home renderer. The exact paired-stimulus display, stable participant-specific assignment, and export of the realized arm/order mapping still need a dummy-data rehearsal before selection is final. Use a separately generated, versioned allocation manifest; do not assume a randomization setting is auditable until its exported receipt is checked. | No CE software license charge under its GPL; hosting, upgrades, backup, security, and operator time still have costs. Responses can remain on an owner-controlled host if deployed and configured that way. No instance or deployment is authorized here. [License and CE/Cloud distinction](https://www.limesurvey.org/manual/LimeSurvey_Cloud_vs_LimeSurvey_CE/en), [randomization groups](https://www.limesurvey.org/manual/Creating_a_question_group), [response export](https://www.limesurvey.org/manual/Export_responses). |
| **Qualtrics (capable alternative, conditional on an approved account)** | Official documentation supports survey-flow randomizers, question/block ordering, and exporting randomized viewing order.        | Strongest documented turnkey randomization and audit trail among the reviewed form tools. It still does not guarantee pixel-identical NewsFlux Home stimuli without a separate controlled renderer.                                                                                                                                                                                                                                       | Commercial SaaS. The project has not verified an available license, price, data location, retention terms, or approval to transfer responses to this processor. Do not use before owner/privacy approval. [Survey Flow randomizer](https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/randomizer/), [randomization export](https://www.qualtrics.com/support/survey-platform/survey-module/block-options/question-randomization/).                                                     |
| **Nextcloud Forms**                                                     | Self-hosted questionnaire and CSV export; its project describes responses as kept private on the instance.                       | Suitable for a simple fixed response form. The reviewed project materials do not establish a controlled paired-arm randomizer or an exportable realized order, so use only after an external allocation manifest is tested.                                                                                                                                                                                                               | Requires an existing/approved Nextcloud host and its maintenance. No host availability or operational cost was verified. [Project capabilities](https://github.com/nextcloud/forms).                                                                                                                                                                                                                                                                                                                                              |
| **SurveyJS Form Library**                                               | Embeddable JSON-driven questionnaire renderer; the Form Library is MIT-licensed.                                                 | Flexible if a custom local study interface is unavoidable, but it is a library rather than a complete response service. Custom assignment, storage, export, access control, and retention would have to be built. Survey Creator is a separate commercial product.                                                                                                                                                                        | Avoid for the first pilot unless the existing survey tools fail the rehearsal: custom backend and operational responsibility outweigh the benefit of a custom form. [Library and license](https://github.com/surveyjs/survey-library), [Creator licensing](https://github.com/surveyjs/survey-creator/blob/master/docs/get-started-react.md).                                                                                                                                                                                     |

### Reuse recommendation

First run a **dummy-only instrument rehearsal** with LimeSurvey CE on an already approved isolated host, or Qualtrics only if an approved account and data-processing terms already exist. Keep the stimulus viewer separate from the NewsFlux application: use a frozen, offline HTML/PDF stimulus pack rendered from the same production Home helpers where feasible, and collect answers in the survey instrument. Do not add a NewsFlux route, telemetry, database, or production service.

If a tool cannot display the frozen stimuli faithfully and preserve the assignment/order receipt, the minimum missing component is an isolated static stimulus pack plus a small offline allocation-manifest generator. It is not a new survey product or NewsFlux feature. Approve that narrow support work separately after the dummy rehearsal; do not install or build it in this PR.

## Proposed pilot design

### Study question and contrast

**Question:** for a fixed set of public news articles and a study-only preference context declared by a participant, does the ordering produced by the current V1 projection receive a different perceived editorial assessment from deterministic Phase 2C?

This is a **within-participant paired comparison**. Internally, the conditions are `PHASE_2C_DETERMINISTIC` and `PERSONALIZATION_V1`. Participants see neutral labels `X` and `Y`; neither the page nor facilitator describes a version as personalized. The mapping is withheld from participants and from the analyst until response exclusions and the analysis script are locked.

### Preference-context validity boundary

The current V1 input is derived from the participant's Miniflux starred-entry history. A participant-declared topic profile is not that history. No real account, Miniflux API, credentials, read history, starred history, or persistent preference state may be accessed under this protocol.

A feasible privacy-bounded pilot can ask participants to declare broad topics and, before seeing either arrangement, select a small set of **public sample articles they would personally save/star**. Those choices may form an ephemeral, study-only synthetic star profile passed through the unchanged V1 projection. The selections and topic tags are study data, not Miniflux state. Results must be labeled `V1_ALGORITHM_WITH_STUDY_ONLY_DECLARED_PROFILE_PROXY`; they cannot establish how production V1 behaves for actual account-derived profiles.

If the owner wants a claim specifically about the current production profile signal, that requires a separate privacy/product decision and a new protocol. It is not an implicit extension of this pilot.

### Stimulus contract

Before any participant is recruited, freeze and hash a manifest containing the public-content snapshot, scenario IDs, locale, eligibility rules, renderer revision, both arm outputs, and article metadata. Use public, preselected articles only; record source URLs and capture dates in the restricted study manifest, not in the response dataset.

For each paired scenario:

- Both arms use the exact same eligible article IDs and article content, source identity, category identity, timestamps, image choice, card treatment, viewport, theme, and section headings.
- Each eligible article appears exactly once across the full composition in each arm. No article is inserted, removed, rewritten, or marked read/starred by the study.
- Only the ordering/placement produced by the approved Phase 2C and unchanged V1 helpers may differ. Preserve the same visual section structure: Highlights → category lanes → Latest.
- Hide all algorithm/version labels, personalization disclosure, read/star controls, and operational metadata that would reveal the arm. Do not change source names or category labels between versions.
- Keep the two presentations close enough for comparison but record their order. The full composition is available in both; any fixed initial-viewport Top-N analysis is a separate, predeclared structural measure.
- Never propagate read/star state between items. The pack is static and makes zero Miniflux requests or writes.

A public stimulus set, its usage/quotation limits, locale, article count, and fixed viewport must be selected and reviewed before preregistration. The synthetic PR #190/#196 fixtures cannot substitute for public semantic content in the human pilot.

### Participant flow

1. Show the consent page. If consent is not affirmative, end without recording study responses.
2. Collect only a coarse, optional topic-context selection from a predeclared controlled vocabulary. Offer “prefer not to say”; do not request political, health, religious, or other sensitive interests. The owner must approve the taxonomy and eligibility rules.
3. If the owner approves the proxy-profile variant, ask which public sample items the participant would save/star. Explain that this creates a temporary study profile and is not connected to NewsFlux or Miniflux.
4. Show each paired Home presentation in the assigned order. Ask per-arm ratings using the rubric below, then ask the paired preference. Use the same instructions and time context for both arms.
5. Offer an explicit “cannot evaluate” answer for every rating and allow skipped questions. Do not force a preference.
6. Close with a debrief that reveals the X/Y-to-arm mapping only after the participant submits or exits. The facilitator keeps the assignment key separate from responses.

The number of paired scenarios per participant is **not set**. Select it after the public stimulus manifest and a no-data usability rehearsal establish a tolerable session length. Do not manufacture a sample-size target from the 12 synthetic scenarios.

## Blinding and counterbalancing procedure

1. Freeze each pair's arm outputs and hash the manifest before generating assignments.
2. Generate pseudonymous session codes with a cryptographically secure random source; codes must not encode names, emails, account IDs, or contact information.
3. Use permuted blocks of four session assignments containing two `PHASE_2C_FIRST` and two `V1_FIRST` orders, shuffle each block, and retain the seed/assignment receipt in a restricted allocation file. The study operator must not edit assignments after enrollment begins.
4. Randomly map the two underlying arms to the visible labels X/Y per session, independently from presentation order. Keep the mapping in a separate key file; never include the algorithm names in participant-facing stimuli or response exports.
5. Within a session with multiple scenario pairs, balance order where possible and randomize scenario order from a precomputed manifest. Do not re-randomize on reload; a resumed session uses the same code and mapping or is marked incomplete.
6. Validate the complete assignment manifest before launch: each scenario has both arms, one X and one Y, a recorded order, no duplicate or missing article IDs, and the expected content/metadata hashes. Rehearse the survey export to prove the returned session code joins to exactly one allocation record.
7. Lock the de-identified response file, exclusions, and analysis code before revealing the condition mapping. Record the hash of the locked files, then unblind and join the key.

If the selected tool cannot preserve the session code and realized order/mapping in an export, it fails the blinding gate until the allocation/response join is solved and rehearsed. No manual after-the-fact guessing is allowed.

## Evaluation instrument and rubric

The response sheet is a draft instrument, not a validated scale. Use the same labeled 5-point response scale for directional ratings: `1 Not at all`, `2 Slightly`, `3 Moderately`, `4 Very`, `5 Extremely`, plus `Cannot judge` and optional skip. Ask participants to rate each arrangement separately before the final paired choice.

| Dimension                     | Prompt focus                                                                              | Interpretation boundary                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Relevance to declared context | How relevant are the displayed articles to the interests you declared for this session?   | Perceived fit to a declared study context, not relevance to a production star profile.                                        |
| Editorial usefulness          | How useful are the Highlights and the arrangement for deciding what to read?              | User judgment; not fact-checking or objective article quality.                                                                |
| Highlight interest            | How interested are you in opening the highlighted items?                                  | Separate from the overall preference.                                                                                         |
| Affinity/variety balance      | Does the arrangement balance your stated interests with exposure to other sources/topics? | Do not assume more diversity is always better.                                                                                |
| Unnecessary repetition        | How much does the arrangement repeat sources or topics in a way that feels unnecessary?   | Keep separate from objective source concentration and actual duplicate-story detection.                                       |
| Freshness adequacy            | Are the publication times appropriate for this news-reading context?                      | Recency is not automatically quality; retain item timestamps for audit.                                                       |
| Organization clarity          | How clear is the Highlights → categories → Latest organization?                           | UI structure is held constant; only placement/order may differ.                                                               |
| Predictability / findability  | How easy is it to predict where an item will appear and locate the newest item?           | Record the task outcome/time separately if the owner approves timed tasks; do not infer predictability from preference alone. |
| Confidence                    | How confident are you in the ratings for this arrangement?                                | Used to flag uncertainty, not to weight a composite score.                                                                    |

After both arms, ask: **“Which arrangement would you choose for this set?”** Responses: `X`, `Y`, `Tie`, `Neither`, `Cannot judge`. Include one optional short rationale with an instruction not to include personal or identifying information. Do not merge dimensions into an unvalidated total score. Do not ask users to judge factual truth unless a separate expert-review protocol is approved.

### Missing and inconclusive responses

- `Cannot judge` is an explicit answer and remains its own category.
- A skipped item is missing, not a neutral rating. Preserve it as `null`/absent and report the denominator for each dimension.
- A participant who withdraws before submitting contributes no completed preference outcome; retain an incomplete status only if consent and the approved retention policy permit it.
- Exclude a paired scenario from condition comparison if either arm is missing, the allocation receipt is invalid, or the pair fails stimulus-integrity checks. Preserve the exclusion reason code; never silently impute.
- Any invalid/missing mapping, unblinding before lock, or stimulus mismatch makes the affected pair non-evaluable and triggers an integrity review.

## Preregistration and analysis plan

| Preregistration field              | Proposed specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STUDY_QUESTION`                   | Paired perceived editorial comparison of Phase 2C and V1 under a fixed public-content snapshot and an approved, declared-profile context.                                                                                                                                                                                                                                                                                                                                                 |
| `PRIMARY_OUTCOME`                  | One participant-level final choice: prefer X, prefer Y, tie, neither, or cannot judge; unblind X/Y only after lock. Report the full category distribution and denominators. No forced binary choice.                                                                                                                                                                                                                                                                                      |
| `SECONDARY_OUTCOMES`               | Separate per-arm distributions for relevance, editorial usefulness, highlight interest, affinity/variety balance, repetition, freshness, clarity, predictability, confidence; optional task correctness/time; objective Top-N source/category counts and freshness descriptors. No aggregate score.                                                                                                                                                                                       |
| `FUNCTIONAL_GUARDRAILS`            | Identical eligible ID set/content/metadata per pair; each ID exactly once; source/category IDs preserved; structural sections same; renderer hash fixed; no Miniflux/network writes; mapping/order receipt valid; no user account data. Any failure blocks interpretation.                                                                                                                                                                                                                |
| `ELIGIBILITY_RULES`                | Must be fixed before recruitment: language comprehension, public-item/content date window, source/category inclusion, sensitive-content exclusions, article usability, participant eligibility, and topic-profile vocabulary. No live account eligibility checks.                                                                                                                                                                                                                         |
| `BLINDING_METHOD`                  | Neutral X/Y labels, mapping hidden from participant and analyst; key held separately until response/exclusion/analysis lock.                                                                                                                                                                                                                                                                                                                                                              |
| `COUNTERBALANCING_METHOD`          | Pre-generated shuffled permuted blocks of four with two orders each; random X/Y mapping independent of order; scenario order frozen per session.                                                                                                                                                                                                                                                                                                                                          |
| `ANALYSIS_PLAN`                    | Pilot: report feasibility, assignment balance, missingness, cannot-judge rates, completion, integrity, and all outcome distributions descriptively. No confirmatory significance claim. If a later confirmatory study is approved, pre-register participant-level estimands, confidence interval level/method, multiplicity policy, and clustering of repeated scenario ratings before unblinding. Do not weight dimensions or create a composite without a separate validated rationale. |
| `PRACTICALLY_IMPORTANT_DIFFERENCE` | `THRESHOLD_NOT_ESTABLISHED`. Owner decision required before any confirmatory data collection or decision rule.                                                                                                                                                                                                                                                                                                                                                                            |
| `STOP_CRITERIA`                    | Stop/pause on any consent failure, account/private-data exposure, Miniflux request/write, external transfer, version/mapping leak, assignment mismatch, missing/changed stimulus, unauthorized sensitive-interest collection, or inability to withdraw under the approved plan. No response or preference result can override an integrity stop.                                                                                                                                          |
| `DATA_RETENTION_POLICY`            | Proposed only: no direct identifiers; encrypted owner-controlled storage; raw response and allocation key kept separately; delete row-level responses and key within 30 days after owner accepts the final report; retain only non-identifying aggregates if separately approved. The owner must approve the duration, withdrawal cutoff, host, backups, contact, and deletion process before collection.                                                                                 |

### Sample-size and uncertainty boundary

No sample-size target, power, significance level, confidence level, or pass threshold is asserted. A feasibility pilot can estimate session burden, response completeness, rating distributions, and variance for planning; it cannot establish a population benefit or approve V2. Parameters still needed for a confirmatory calculation are: the owner-approved practically important difference, primary estimand, expected tie/neither/cannot-judge rates, participant-level variance, number and correlation of repeated scenarios, planned exclusions, attrition, recruitment population, and chosen confidence/error policy. If positive and negative preferences remain too sparse or uncertainty too broad, report `INCONCLUSIVE`.

## Privacy, consent, retention, and discard

Use public, frozen stimuli and the study-only declared-profile proxy only if approved. Collect no name, email, NewsFlux username, account token, Miniflux feed/article history, exact location, IP, persistent identifier, or raw browser fingerprint. Do not export participant responses to GitHub. Do not use external AI, analytics, advertising pixels, or remote session replay. Configure the chosen platform to disable IP/geolocation/contact metadata where possible and verify the actual export; otherwise do not use that platform for this pilot.

A participant may skip any rating or stop. Provide a random session code so the participant can request deletion until the response/assignment key is destroyed. Because the optional rationale could contain identifying details, warn against including them and review/redact before analysis; if that cannot be done safely, omit free text. Store consent records separately from ratings if a future approved process requires them; the response data must not include contact details.

The consent text and proposed 30-day retention limit are drafts requiring owner and privacy review. Applicable research/ethics, participant-age, publication, and contact requirements have not been assessed and remain approval questions; this document is not legal or institutional ethics approval.

## Empty result-data schema

`templates/personalization-human-relevance-pilot-01-data.schema.json` defines one **empty schema for one session record**. It contains no participant rows, answers, preference profile, or real article data. `sessionCode` is a random study code, not an identifier. The arm mapping is represented only by `allocationKey`; its lookup is kept in a separate restricted allocation file until unblinding. Incomplete ratings remain missing; `CANNOT_JUDGE` is distinct from missing.

## Owner decisions required before a pilot

1. Approve or reject the study-only declared-profile proxy, including the prompt that asks which public sample items the participant would save/star. This does not validate actual production V1 account signals.
2. If production-signal validity is required, decide separately whether a future consented participant may locally provide a limited account-derived profile. No such access is authorized here.
3. Approve participant eligibility, recruitment, language, content sensitivity policy, article set, locale, viewport, scenario count, study host, survey vendor, data controller/operator, consent contact, retention duration, withdrawal cutoff, backup deletion, and any institutional review required.
4. Decide whether the pilot is feasibility-only or intended to support a confirmatory decision; if confirmatory, establish the primary estimand, practically important difference, uncertainty policy, and sample-size calculation inputs before enrollment.
5. Approve LimeSurvey CE host and the dummy-data rehearsal, or confirm a pre-approved Qualtrics account/vendor. No installation or vendor account was authorized by this PR.
6. Approve whether timed “find the newest item” tasks are in scope; otherwise predictability remains a reported subjective dimension only.

## Readiness

- `RESEARCH_GATE=PASS`: prior implementation and evidence were audited at the exact main SHA; no human claim is carried forward as fact.
- `TOOL_REUSE_ASSESSMENT=PASS_WITH_REHEARSAL_REQUIRED`: LimeSurvey CE is the preferred self-hosted candidate for responses; no tool alone is yet verified for exact stimulus rendering plus auditable assignment export.
- `STUDY_DESIGN_GATE=PASS_DRAFT`: paired, fixed-stimulus, within-participant comparison is specified.
- `BLINDING_GATE=PASS_DRAFT`: X/Y concealment and separate key are specified; platform rehearsal remains a prelaunch condition.
- `COUNTERBALANCING_GATE=PASS_DRAFT`: allocation method is specified; no assignments were generated for real participants.
- `CONSENT_TEMPLATE_GATE=PASS_DRAFT_NOT_APPROVED`: see `templates/personalization-human-relevance-pilot-01-consent.md`.
- `PRIVACY_GATE=PASS_FOR_PREPARATION_ONLY`: no data were collected or transferred; operational privacy approval remains outstanding.
- `DATA_COLLECTION=NOT_STARTED`
- `HUMAN_RELEVANCE=NOT_MEASURED`
- `V2_IMPLEMENTATION=NOT_AUTHORIZED`

**Pilot readiness:** `YES_FOR_OWNER_APPROVAL_AND_DUMMY_REHEARSAL`; `NO_FOR_HUMAN_COLLECTION` until all owner/privacy decisions and instrument-integrity checks are complete.

## Sources

- LimeSurvey CE versus Cloud and license: https://www.limesurvey.org/manual/LimeSurvey_Cloud_vs_LimeSurvey_CE/en
- LimeSurvey question-group randomization: https://www.limesurvey.org/manual/Creating_a_question_group
- LimeSurvey response export: https://www.limesurvey.org/manual/Export_responses
- Qualtrics survey-flow randomizer and randomization export: https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/randomizer/ and https://www.qualtrics.com/support/survey-platform/survey-module/block-options/question-randomization/
- Nextcloud Forms capabilities: https://github.com/nextcloud/forms
- SurveyJS library license and product split: https://github.com/surveyjs/survey-library and https://github.com/surveyjs/survey-creator/blob/master/docs/get-started-react.md
