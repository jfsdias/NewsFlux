# STORY-02-A2D2B — LOCAL RESEARCH CHECKPOINT

```text
STATUS:
HISTORICAL LOCAL RESEARCH EVIDENCE — RECONCILED BELOW

NOT A PM DECISION
NOT A CANONICAL CORPUS
NOT A PROVIDER DECISION
DO NOT USE AS PRODUCT POLICY
```

## 1. Context & Purpose

This document preserves local research evidence produced during an accidental Gemini execution on the `codex/story-02-a2d2b-fresh-corpus-capture` task branch. Findings are not authoritative over the PM decisions below.

Its purpose is to preserve local findings, empirical distributions, and tooling state in version control so that Codex can subsequently reconcile them against the official project handoffs and PM direction before any canonical corpus capture or freeze occurs.

---

## 2. R1 Aggregate Findings (Unread-Only Semantics)

In R1, the baseline capture contract was evaluated:

- **Source Query Semantics**: `UNREAD + globally_visible = true`, ordered by `published_at DESC` with a fixed entry-ID ceiling, capture cutoff `2026-10-27T01:26:04.823Z`.
- **Preliminary Target**: 500 articles.
- **Raw Eligible Unread Seen**: 767 articles.
- **Fresh Articles (Published <= 168h)**: 453 articles.
- **Stale Articles (> 7d / 168h)**: 47 articles (9.4%).
  - Stale > 30d (720h): 41 articles (8.2%).
  - Stale > 90d (2160h): 27 articles (5.4%).
- **Published Span**: ~9,836.63 hours (~410 days, earliest published `2025-09-12T00:00:00-03:00`).
- **Home-200 Exclusion Overlap**: 0.
- **Gold V2 Exclusion Overlap**: 0.

### Stale Tail Concentration & Backfill Diagnostics

- **Category Isolation**: 100% of the stale tail (47/47 articles > 7d) belonged to a single category. All other 8 categories in the corpus contained zero articles older than 7 days.
- **Feed Concentration**: Exactly 3 feeds accounted for 100% of the stale articles:
  - One feed: 20 articles (all > 7d, median ingest skew ~5,496h).
  - A second feed: 15 articles (all > 7d, median ingest skew ~2,208h).
  - A third feed: 12 articles (median ingest skew ~240h).
- **Ingestion vs. Publication Timing**:
  - 35 of the 47 stale articles were ingested in a single sub-minute burst on `2026-10-20T23:42:28/32` with historic publication timestamps dating back months and years (`OLD_PUBLISHED_RECENT_CREATED`).
  - One source was traced to a local service reportedly responsible for backfilling 281 historical entries on initial creation.
  - Pattern classification: `BACKFILL_OR_IMPORT_PATTERN = SUPPORTED`.

---

## 3. Exploratory Status-Neutral Findings

An exploratory read-only probe was conducted against Miniflux without filtering by read/unread state:

```text
STATUS:
EXPLORATORY
NON-CANONICAL
UNFROZEN
```

- **Query Semantics**: `globally_visible = true`, no read/unread status constraint, a fixed entry-ID ceiling, publication window `<= 168h`.
- **API Reported Window Total**: ~3,289 visible articles in the 168h window.
- **Exploratory Top-500 Sample Metrics**:
  - Selected Articles: 500
  - Unique Feeds: 46 (vs. 38 in R1 unread-only)
  - Unique Categories: 11 (vs. 9 in R1 unread-only)
  - Status Breakdown: 427 unread (85.4%), 73 read (14.6%)
  - Max Feed Share: 0.0940
  - Max Category Share: 0.3780 (improved from 0.4180)
  - Candidate Pairs (<= 24h cross-feed): ~118,580 pairs
  - Candidate Pairs (<= 168h cross-feed): ~118,580 pairs

---

## 4. Local Gemini Recommendation & Official Status

In the local exploratory report, the following recommendation was drafted:

- **Local Recommendation**: `OPTION_1` (reduce target corpus size to ~450/453 to preserve unread-only semantics while enforcing a strict <= 7d freshness boundary).
- Status-neutral selection was cataloged as `OPTION_3`.

```text
GEMINI_RECOMMENDATION=
NOT_ADOPTED_BY_PM
```

The PM subsequently rejected unread-only as a valid Story Identity corpus definition because NewsFlux Home session identity does not depend on `showStatus`, and research corpora must not depend on an individual user's consumption pacing.

---

## 5. Subsequent PM / Codex Direction

The canonical project policy entering reconciliation is:

```text
SUBSEQUENT_PM_DIRECTION:
Story Identity corpus must be status-neutral (STATUS_NEUTRAL)
read/unread must not determine which articles exist for Story Identity research
published_at remains canonical event-time field
freshness window remains 168h
```

---

## 6. Official R2 Capture Failure Record

A subsequent status-neutral capture attempt encountered an unexpected uniqueness failure:

- **Source Query Semantics**: `STATUS_NEUTRAL_GLOBAL_VISIBLE_PUBLISHED_DESC_FIXED_ID_CEILING`
- **Source Status Filter**: `NONE`
- **Freshness Window**: 168h
- **API Reported Window Total**: ~3,311
- **Raw Rows Before Stop**: 920
- **Duplicate Article IDs Observed**: 6
- **Article ID Uniqueness Gate**: `FAIL`
- **Pagination Method**: Offset pagination (`&offset=...`)
- **Corpus Freeze**: `NO` (`FRESH_CORPUS_FREEZE = NO`)
- **Root Cause**: `ROOT_CAUSE = UNRESOLVED_IN_CHECKPOINT`

The failure was halted immediately without silent deduplication. Whether the duplicates stem from offset pagination instability, non-unique `published_at` ties, collector issues, or API behavior remains a subject for formal Codex reconciliation.

---

## 7. Bounds of This Checkpoint

This checkpoint strictly provides:

1. Preliminary offline capture tooling (`capture.py`, `test_capture.py`); it has not passed the complete R2 capture and freeze gates.
2. Sanitized aggregate documentation of exploratory evidence.

This checkpoint explicitly does NOT:

- Implement the PM's R3 keyset pagination proposal.
- Decide corpus policy or select between candidate options.
- Freeze any corpus JSON or pair artifacts.
- Freeze or mutate Gold/Dev sets.
- Change any product or runtime code.

---

## 8. Codex reconciliation and PM-aligned decision

| Finding                           | Checkpoint evidence                                                                                           | Official prior position                                                                  | Assessment and decision                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unread-only versus status-neutral | Option 1 proposed roughly 450/453 unread articles.                                                            | R2 rejects consumption-dependent membership.                                             | Conflict: preserve Option 1 historically; do not adopt it. Home session identity excludes `showStatus`, but the production Home fetch itself is explicitly unread-only. Research status neutrality is a PM decision, not a claim that Home fetches all statuses.              |
| Target and freshness              | Unread recent pool about 453.                                                                                 | Exactly 500 if available in the 168-hour window; do not extend the window.               | Keep 500; 400–499 requires PM review.                                                                                                                                                                                                                                         |
| Event time and backfill           | Old publication dates with recent creation, concentrated in several feeds, support a backfill/import pattern. | `published_at` defines research freshness and pair time; `created_at` is diagnostic.     | Compatible; the precise cause of each item is not proved.                                                                                                                                                                                                                     |
| Neutral window capacity           | API total around 3,289; exploratory top 500 includes read and unread entries and many cross-feed pairs.       | R2 saw total 3,311, then six duplicate IDs over 920 raw rows.                            | The source semantics and broad capacity signal are useful; exact counts, top-500 distribution and pair counts remain unverified until a complete stable enumeration. Totals can change and do not prove pagination completeness.                                              |
| R2 duplicates and offset          | Six duplicate IDs were observed in offset-paginated published order.                                          | Non-unique timestamps and offset movement are hypotheses.                                | Root cause unproven: concurrent changes, ties, collector or integration behavior remain possible. No silent deduplication.                                                                                                                                                    |
| Pagination repair                 | No working keyset implementation in the checkpoint.                                                           | R3 proposed descending ID cursor with fixed ceiling, followed by published-time sorting. | Adopt as the leading acquisition strategy, subject to complete read and identical replay. Initial live probe advanced 1,012 records without duplicate IDs, but the connector returned a 1 MiB response-limit error even at one entry. It does not prove complete enumeration. |
| Final size and pair capacity      | Exploratory 500 and approximately 118,580 cross-feed 24-hour pairs.                                           | 500 articles, span at least 24 hours and at least 5,000 P3 pairs.                        | No corpus freeze or capacity PASS without full enumeration, replay and determinism. A 24-hour span is independently required.                                                                                                                                                 |

**Current disposition:** status-neutral, globally visible, fixed ID ceiling and the 168-hour `published_at` window remain the research contract. The acquisition limit requires a safe supported read path before a full capture can be verified. No provider, model, labels, product state, deployment or merge is authorized by this checkpoint.

The offline normalizer now enforces the 168-hour window and ID ceiling, retains `created_at` for diagnostics, and rejects a missing or mismatched complete replay. It selects exactly 500 and rejects a span under 24 hours. A pure helper constructs fixed-window ID-keyset parameters, but a complete collector and atomic freeze have not been validated. The command-line freeze is explicitly disabled pending those gates; the seven focused tests are not a complete capture certification.

## 9. R3A direct transport attempt

A GET-only server-side collector read the bounded status-neutral population and replayed it with the same fixed ceiling, cutoff, window and page size. Both runs reached an empty terminal page after 164 requests and returned the same sequence of 3,258 IDs; IDs advanced strictly and had no overlaps. The largest HTTP response was 1,362,981 bytes, exceeding the previous connector's 1 MiB envelope. Article bodies were projected out before private transfer.

The exact 168-hour eligibility rules and historical exclusions left 3,072 entries. Both passes produced the same eligible ID set and the same newest 500 sequence. That sequence spans **23.126 hours**, below the required 24-hour minimum. Therefore no canonical corpus or pair universe was frozen, no threshold was widened, and the writer remains disabled. API totals are diagnostic; terminal keyset traversal and replay provide the acquisition evidence without claiming database snapshot isolation. The R2 duplicate cause remains unresolved.

## 10. R3B systematic rank decision

The PM authorized deterministic rank sampling over the full 168-hour eligible population: `floor(i*(N-1)/(K-1))`, with `N=3072` and `K=500`. It is uniform in eligible rank, not uniform in time. It does not use topic, source, category, status, scores or labels to select entries. Both historical projected passes produce the same ordered eligible population and the same sample.

The newest-500 comparison spans 23.126 hours and has 118,824 cross-feed pairs in each of the 24-hour and 168-hour windows. The systematic sample spans 167.161 hours, with 33,135 pairs within 24 hours and 119,384 within 168 hours. Its 500 positions are unique and both historical exclusion overlaps are zero. The six canonical outputs were derived twice, written atomically to a new private directory and verified after applying read-only permissions. The R3A projected passes remain private and unchanged. This result does not authorize labels, model inference or a product decision; the historical privacy gate remains open.
