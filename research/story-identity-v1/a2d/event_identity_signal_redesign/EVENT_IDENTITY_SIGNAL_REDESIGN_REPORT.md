# Event identity signal redesign — field audit

D2D remains a valid failure for the tested fresh challenge: title-level semantics plus local graph context did not recover SAME_EVENT. This does not establish that these signals are globally useless. No SAME_EVENT was found in the 120 human-labeled targeted fresh DEV pairs; fresh corpus SAME_EVENT prevalence remains UNKNOWN. FRESH_POSITIVE_IDENTIFIABILITY_RISK remains until fresh positive evidence is actually observed.

The frozen corpus contains 500 records and nine schema fields. The table gives presence/nonempty counts and aggregate string lengths, never article values. String lengths are raw character counts for nonempty values; p90 is nearest-rank.

| Field        | Present | Nonempty | Share | Types    | Consistent | Length min / median / p90 / max |
| ------------ | ------: | -------: | ----: | -------- | ---------- | ------------------------------- |
| category_id  |     500 |      500 | 1.000 | int: 500 | YES        | — / — / — / —                   |
| created_at   |     500 |      500 | 1.000 | str: 500 | YES        | 28 / 32.0 / 32 / 32             |
| feed_id      |     500 |      500 | 1.000 | int: 500 | YES        | — / — / — / —                   |
| feed_title   |     500 |      500 | 1.000 | str: 500 | YES        | 4 / 9.0 / 20 / 31               |
| id           |     500 |      500 | 1.000 | int: 500 | YES        | — / — / — / —                   |
| language     |     500 |      343 | 0.686 | str: 500 | YES        | 2 / 5 / 5 / 5                   |
| published_at |     500 |      500 | 1.000 | str: 500 | YES        | 25 / 25.0 / 25 / 32             |
| title        |     500 |      500 | 1.000 | str: 500 | YES        | 6 / 69.5 / 94 / 185             |
| url          |     500 |      500 | 1.000 | str: 500 | YES        | 25 / 98.5 / 127 / 287           |

No content, summary, description, body, excerpt, other captured article-text field, author or enclosures field is present. RICH_TEXT_AVAILABLE=NO; 0/500 have a recognized non-title article-text field. Median and p90 of absent rich text are undefined. The 80% routing boundary is not a scientific performance threshold.

The preregistered V2 families are content-aware semantic confirmation, event-anchor fingerprint, content-plus-anchor hybrid and a pairwise reranker reference on HOLD. Title-only signals remain a frozen reference. Graph context is corroboration, not the primary identity signal. Event-specific corroboration, rather than shared topic alone, is required; false merges remain more costly than false splits.

D2F is preregistered for leakage-safe component-group evaluation, train-only parameter selection and hard-negative safety first. Fresh graph DEV can only be a frozen negative challenge after selection; BLIND remains sealed. No candidate benchmark, model inference, threshold optimization, external article fetch, new label or production policy was performed.

NEXT_RECOMMENDED_TRACK=STORY_02_A2D2C_P4_D2E1_FRESH_CORPUS_CONTENT_ENRICHMENT_CONTRACT. This is a recommendation for a later contract, not authorization to enrich the corpus here.

## Aggregate artifact hashes

- Field audit: `eebe9ea3a1b7631b1bb5c1ff76ca34a44fafcd69102867f9223eaf088bf032ea`
- Design manifest: `7b4b41e356d7cdf42a37aa4412fb23e1c1ccba9ce4b1fc965689ec2b6a55e94c`
