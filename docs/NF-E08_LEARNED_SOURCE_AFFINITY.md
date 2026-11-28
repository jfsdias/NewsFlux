# NF-E08 Learned source affinity

- Status: PLANNED. NF-0901 (this document and [ADR 0002](./adr/0002-reading-signals-service.md)) is the only authorized item; every later story needs ADR 0002 accepted and its own gate.
- Date: 2026-11-27
- Owner direction: learning runs server-side on the owner's OMV host, in its own service; Home stays the only personalized surface.
- Unblocks: §3.9 "User-controlled learned relevance", §3.14 STATS-03 (behavioral analytics), the NF-E06 "telemetry-gated relevance review" and part of DISC-03 (similar-feed suggestions).

## Problem

NewsFlux should learn which sources the owner values from how they read, then use that to qualify the Home, suggest similar sources and flag sources that are never read. Personalization must stay explicit, explainable and reversible.

## Evidence: Miniflux read timestamps are not enough

A read-only measurement on 2026-11-27 (60 days, 93 reading sessions, 88 feeds) tested three rules built only on Miniflux `changed_at`:

| Rule | Idea                                                                               | Result                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Mean position of each item inside its reading session; batch actions count as last | Penalized high-volume sources the owner values                                                                                                                                               |
| 2    | Order in which each source is first reached in a session                           | Ranked categories in sidebar order. The owner confirmed they follow the sidebar out of convenience, not priority: it measures navigation, not preference                                     |
| 3    | Open rate among items seen (batch size separates open, scroll, bulk)               | About 90% of items become read in requests of 16+ items. "Mark all as read" after glancing at a list hides how many titles were seen, so high-volume sources look more clicked than they are |

What held: absolute opened items per source, and the bulk-cleared share as a noise signal. The missing piece is **exposure**: only the client knows which cards were actually on screen and how far an article was read. Generalist news sources were also confirmed as wanted for a **panorama** of local, national and world events, not as thematic preference.

## Goals

1. Measure exposure, opens and reading depth per source, with the owner's opt-in.
2. Derive a per-source affinity that does not depend on volume or navigation order, with a transparent table the owner can check against intuition before it influences anything.
3. Use affinity only on Home: a bounded, explained weight with an off switch.
4. Separate a Home **panorama** band (local, national, world) chosen by multi-outlet coverage, not by affinity.
5. Suggest similar sources and flag never-read sources, suggest-only.

## Non-goals

- No ranking, hiding or reordering in All, Unread, categories, feeds, search or Smart Views.
- No Miniflux mutation of any kind (read, star, feed, category, rules) from learning.
- No storage of titles, URLs, article text or per-entry history on the server.
- No remote model or third-party analytics. No cross-user learning.
- No change to the owner's reading habits as a prerequisite.

## Signals

| Signal              | Definition (client)                                                                                                                        | Use                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Impression          | A list or Home card at least 50% visible for at least 1 s, counted once per entry per device per day                                       | Exposure denominator                                    |
| Open                | Reader opened for the entry                                                                                                                | Primary positive signal                                 |
| Read to end         | Reader body scrolled to at least 85% with dwell at least 30% of the estimated reading time (reuses the reading-continuity scroll tracking) | Strong positive signal                                  |
| Star                | Existing Miniflux star toggled on in NewsFlux                                                                                              | Explicit positive signal                                |
| Explicit preference | Existing reversible Home category preferences (#301)                                                                                       | Overrides learned weight                                |
| Unseen bulk read    | Marked read with no impression                                                                                                             | No signal. An unseen item says nothing about the source |

Impressions reuse the `IntersectionObserver` pattern of `useReadOnScroll`; read depth reuses `useReaderContinuity`. The client aggregates locally and sends **per-source daily counters** only (see ADR 0002).

## Model

- Per source and day, store counts: impressions, opens, read-to-end, stars.
- Affinity = smoothed open rate: `(opens + k·p) / (impressions + k)`, where `p` is the account-wide open rate and `k = 20`, over a 30-day half-life exponential decay. Read-to-end rate is reported alongside and enters the weight as a secondary term after the NF-0904 validation.
- Minimum evidence: a source needs at least 30 decayed impressions before it leaves neutral. Below that it is "learning" and gets no weight.
- Panorama sources (categories the owner marks as panorama) are excluded from affinity weighting.
- Explicit preferences always win over learned weight.

## Home use

- **For you:** Home highlights and category strips may apply a bounded multiplier (at most ±30% of the existing V1 score) from affinity. Each boosted card shows its reason, for example "You open most stories you see from this source". A Home tools switch turns learned weighting off without deleting data.
- **Panorama:** a separate band per panorama scope (local, national, world) that shows the stories covered by the most distinct outlets in the window, using NF-E05 Story Groups. No affinity weight.

## Transparency and control

- Setting "Learn from my reading", **off by default**. Off means no impression tracking and no requests.
- "Your reading" page: per source, seen, opened, read to end, affinity, state (learning, neutral, boosted, rarely opened), window, and the exact reason text used on Home.
- Pause learning, reset learning (deletes all server aggregates for the account) and export (JSON of the aggregates).

## Stories

| ID      | Story                                                                                                                                                                        | Depends on          | Material gate                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| NF-0901 | Epic and ADR 0002 (docs only)                                                                                                                                                | —                   | Owner accepts ADR 0002                                                                                                                     |
| NF-0902 | `reading_signals` service: SQLite aggregate store, Miniflux-token auth reuse, counters/affinity/reset/export API, tests, image, release-governance entry disabled by default | 0901                | Unit tests; no entry-level fields accepted; reset/export verified                                                                          |
| NF-0903 | Client instrumentation: opt-in setting, impression/open/read-to-end capture, local daily aggregation and batched flush, pause/reset                                          | 0902                | E2E: no requests when off; no Miniflux mutations; All/Unread order unchanged; counts match fixtures on narrow, wide and foldable viewports |
| NF-0904 | "Your reading" transparency page                                                                                                                                             | 0903                | **Owner validation:** after at least 14 days of data the table matches intuition, or the rule is adjusted before any ranking               |
| NF-0905 | Home "For you" weighting with reasons and off switch                                                                                                                         | 0904                | Bounded multiplier; reason on every boosted card; off restores V1 output exactly                                                           |
| NF-0906 | Home panorama band                                                                                                                                                           | NF-E05 Story Groups | Deterministic; expand every source; no affinity weight                                                                                     |
| NF-0907 | Source suggestions and "rarely opened" health hints                                                                                                                          | 0904                | Suggest-only; links to existing Add feed and FILTER-RULES-01; no silent unsubscribe or pause                                               |

Each story is a separate PR with one purpose.

## Risks

- Impression accuracy on foldable and dual-screen layouts: covered by viewport cases in NF-0903.
- Several devices count the same entry: per-device daily deduplication can inflate impressions slightly; open rate is affected in both terms and stays comparable.
- Feed deletion or server change: aggregates are keyed by account digest and Miniflux feed ID; orphaned feed IDs are purged on reconciliation (ADR 0002).
- Read-on-scroll users: impressions come from visibility, not from read state, so read-on-scroll does not change the signal.
