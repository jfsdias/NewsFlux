# Event identity signal candidates V2 — preregistration

Research design only. The title-only semantic, lexical, entity, number, date, temporal and graph features remain the **FROZEN_REFERENCE** baseline. The observed graph result is limited to its selected fresh challenge: it does not establish that these signals are globally useless. No thresholds, weights, models or production policies are selected here.

Principle: EVENT_IDENTITY_NEEDS_EVENT_SPECIFIC_CORROBORATION, NOT_TOPIC_SIMILARITY_ALONE. FALSE_MERGE_COST > FALSE_SPLIT_COST. GRAPH_CONTEXT_ROLE=CORROBORATION_NOT_PRIMARY_IDENTITY_SIGNAL. A shared entity or topic is insufficient to establish the same event.

## A_CONTENT_AWARE_SEMANTIC_CONFIRMATION

**Inputs:** title plus a locally frozen article content, summary, description, body, excerpt or text field when available. Use the first eligible source in that declared order; title alone is the explicit empty-content fallback. No URL fetch or generated summary.

**Deterministic text contract:** parse HTML to text without executing scripts or styles, discard script/style content, decode HTML entities, normalize Unicode to NFC, collapse whitespace, and join normalized title and normalized text using a fixed newline separator. Cap text deterministically at 8,192 Unicode code points after normalization; no token-based truncation or language-dependent heuristics. A future benchmark must version and test parser behavior before use. Qwen embeddings are a future local candidate only; this stage performs no inference or model download.

**Dependencies and privacy:** local HTML parsing and an already available local embedding runtime would be required; article text remains private and is not sent to a remote API. **Train-only parameters:** any candidate threshold is selected only inside training folds, never here. **Role:** candidate generation/semantic corroboration. **Risks:** absent content, publisher boilerplate, truncation and topic similarity. **Eligibility:** later benchmark only after the input text contract and coverage route are resolved.

## B_EVENT_ANCHOR_FINGERPRINT

**Inputs:** local title and available article text. Apply the same normalization; preserve entity identity separately from EVENT_ACTION_ANCHOR (what happened). Candidate classes include named subjects, actions/developments, numbers and percentages, dates, versions, case/process IDs, CVE IDs, explicit locations and quoted proper names. Actions conceptually include launch, announce, release, approve, reject, rule, suspend, acquire, sell, resign, appoint, outage, restore, breach, fine, investigate, file, settle, update, delay and cancel. This is illustrative, not a complete lexicon.

**Deterministic extraction contract:** version a fixed language-aware lexicon and pattern set before benchmark labels are accessed; extract normalized literal tokens and explicit identifiers with their types and provenance, preserving entity versus event-action roles. Never infer an action solely from shared entities. Unknown language or missing anchors must remain missing, not a positive match. No label-derived lexicon edits or pair-specific rules.

**Dependencies and privacy:** local deterministic parsing; no remote lookup. Keep text and extracted anchors private. **Train-only parameters:** any comparison rule/threshold must be chosen only within training folds. **Role:** event-specific corroboration. **Risks:** multilingual morphology, ambiguity, omitted context and negation. **Eligibility:** later benchmark after a versioned extractor and leakage-safe evaluation are authorized.

## C_CONTENT_EVENT_ANCHOR_HYBRID

**Inputs:** A semantic evidence and B event-anchor evidence. Apply the same fixed text and anchor contracts. **Expected role:** semantic similarity retrieves candidates; event-anchor corroboration is additionally required before an event-identity claim. Missing anchor evidence cannot silently become positive confirmation.

**Dependencies and privacy:** union of A and B, local only. **Train-only parameters:** any calibrated decision threshold or combination must be chosen on training data only; none are chosen here. **Risks:** content coverage and ambiguous or missing anchors may reduce recall. **Eligibility:** later benchmark only after A and B input contracts are available. Graph context may provide secondary corroboration but is not the primary identity signal.

## D_PAIRWISE_RERANKER_REFERENCE_HOLD

**State: HOLD.** A later local cross-encoder, NLI-style classifier or equivalent may be considered using the same reproducible text contract. No model is selected, downloaded or called here. Release from HOLD requires an explicit model identity and digest, local execution, privacy review, runtime/cost measurement, reproducible preprocessing and no external API.

**Train-only parameters:** only within authorized training folds. **Role:** reference reranker. **Risks:** privacy, runtime, calibration and domain shift. **Eligibility:** not eligible until all HOLD conditions and a separate authorization are satisfied.

## Future benchmark governance

Preregister D2F with historical labeled evidence and leakage-safe component-group evaluation. Outer test data must never be passed into candidate or parameter selection; select parameters inside training folds only. Prioritize false-family and hard-negative safety before SAME_EVENT capture. No full-Gold final fit and no pair-specific rules. Frozen fresh graph DEV labels may only be used as a NEGATIVE_CHALLENGE_CHECK after candidate and threshold selection are frozen; they must not tune D2F thresholds. BLIND_STATE=ANNOTATED_SEALED; no BLIND label access or evaluation is authorized.

FRESH_SAME_EVENT_PREVALENCE=UNKNOWN. No SAME_EVENT was found among the 120 human-labeled targeted fresh DEV pairs; this does not imply the fresh corpus contains none. FRESH_POSITIVE_IDENTIFIABILITY_RISK remains: a better signal cannot be proven on fresh data until fresh SAME_EVENT evidence is actually observed.
