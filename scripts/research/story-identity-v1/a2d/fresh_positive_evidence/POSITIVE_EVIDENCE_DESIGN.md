# D2F1 prospective positive-evidence pool

## Scope and separation

This preregistration seeks label-blind **positive-likelihood candidates** for a
future DEV augmentation. A candidate is not a positive pair. The pool is not a
prevalence sample, blind set, final test set or production metric estimate.
SAME_EVENT remains the only merge-positive class, RELATED_TOPIC remains
merge-negative, and false merges remain more costly than false splits.

The previously reviewed fresh DEV and graph DEV sets produced insufficient
positive evidence. Their aggregate reports motivate a positive-enrichment
objective, but no row-level human decision enters exclusions, feature selection,
lane thresholds or ranking. Prior challenge and graph retrieval contracts
emphasized boundary, near-miss and diverse challenge evidence; repeating their
exact selections would not constitute a new positive-enrichment strategy.

## Frozen sources and exclusions

Use the hash-pinned 33,135-pair cross-feed P3 universe with publication-time gap
at most 24 hours; P2 numeric features and graph-context features were frozen
before relevant human decisions. Graph support is corroborating evidence, not an
event-identity label. D2E2 capability metadata supplies status and title-
equivalence flags. Do not open D2E3 content, source payloads or human decisions.

Exclude every article and pair in the pre-label frozen 80-pair DEV, 48-pair
BLIND and 40-pair graph DEV sources. BLIND identities are used solely for
exclusion; its decisions remain sealed. Fresh corpus isolation from Home-200
and Gold is inherited from the pinned capture receipt, without opening Gold.
Every output must belong to the exact pinned universe. Require both endpoints
to be D2E2 USABLE; retain and separately count title-equivalent endpoints.

## Preregistered lanes

Compute Q75 and Q90 by linear interpolation over Qwen title-semantic scores in
the strictly article-disjoint, both-content-usable unlabeled universe. No human
label or old decision selects a threshold. The already frozen lexical floor is
0.05. A pair may belong to multiple lanes, but occurs once in the final pool:

1. **STRONG_CONSENSUS:** Qwen ≥ Q90, lexical overlap ≥ 0.05 and at least one
   positive entity, number or date overlap.
2. **GRAPH_SUPPORTED_EVENT:** Qwen ≥ Q75 and at least two supporting feeds.
3. **CROSS_SOURCE_PARAPHRASE:** Qwen ≥ Q90, lexical overlap < 0.05, number or
   date overlap and at least one supporting feed.
4. **POSITIVE_BOUNDARY:** Qwen ≥ Q90, lexical overlap < 0.05, time gap ≤ 4 h,
   entity overlap and no number or date overlap. This is a separately named
   boundary lane, not an assertion of event identity.

Primary-lane priority follows that order. Rank lexicographically by descending
Qwen score, descending supporting-feed count, descending lexical overlap,
ascending time gap and ascending numeric pair identity. These are existing
frozen features, not newly generated scores or inference. The thresholds and
rules are recorded before real identities are selected.

## Capacity, privacy and future review

Connected components are article-sharing components of the final pool, named
in ascending order of minimum member identity. Report component concentration,
unique articles, lane overlap, aggregate feed/category-pair concentration,
time-gap buckets, supporting-feed distribution, content eligibility and
potential information gain. No private identity, title or URL enters tracked
reports.

Compute the exact maximum article-disjoint matching using pinned Python 3.14.7
and NetworkX 3.4.2 maximum-weight maximum-cardinality matching. Component-
diverse capacity means at most one pair per disconnected pool component. For
40 and 80, feasibility means article-disjoint capacity only; aggregate component
and source diversity are reported for deterministic rank-prioritized matching
witnesses. These are diagnostic options, not an annotation budget, approved
quota or promise of positives. PM must decide budget, quotas and positive-
evidence sufficiency before any neutral reviewer pack or annotation.

All pool rows and selection identities remain private. Outputs contain no
article text, title, URL or human decision. Replay generates two independent
private copies and requires byte identity before atomic, read-only freeze and
independent validation. Model, benchmark and publisher gates remain closed.
The D2F combined-representation cap remains a separate model/preprocessing
approval question; this pool uses no D2E3 content or representation.
