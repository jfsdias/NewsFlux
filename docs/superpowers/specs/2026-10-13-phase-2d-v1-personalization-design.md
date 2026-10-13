# NewsFlux Phase 2D V1 — Deterministic Home Personalization

- **Status:** Product and architecture design approved; implementation not authorized
- **Date:** 2026-10-13
- **Repository base:** `main` at `8cf6fe253e2c96480e1643b0a96fc5b8ea25702f`
- **Scope:** Deterministic, transient personalization of Home Secondary Highlights and Recent using Miniflux's currently-starred entries

## 1. Purpose and non-goals

Phase 2D V1 adds a small, explainable personalization layer to the existing Phase 2C editorial Home. It uses only the entries that are currently starred in Miniflux to derive source and category affinity. The profile exists only in memory for a Home session or an explicitly refreshed Home projection.

The feature must preserve the existing editorial product: the newest eligible unread article remains Primary, Home continues to use one canonical candidate stream, and All/Unread remain chronological and predictable.

This is a design specification, not implementation authorization. It does not authorize a coding task, implementation plan, pull request, deployment, or merge.

V1 does not introduce a NewsFlux backend or database, client-local affinity persistence, behavioral telemetry, machine learning, embeddings, a topic model, or a recommendation service. It does not use read history, opens, dwell time, scroll depth, dismissals, or ignore history as preference signals.

## 2. Existing Phase 2C baseline

Phase 2C provides the deterministic baseline that personalization must extend without replacing:

- Home is an unread-oriented editorial cover.
- The canonical candidate request is unread-only, ordered by `published_at` descending, and follows the existing visibility, pagination, cursor, and session rules.
- One loaded candidate set supplies up to three Highlights and the remaining Recent entries. Highlights do not fetch additional candidates.
- The Primary is the newest eligible unread candidate.
- Secondary selection favors source and category diversity, then freshness, with a stable `entry.id` tie-break.
- Recent uses the remaining loaded candidates and the same pagination chain.
- Highlights remain stable across scrolling, load-more, reader visits, and ordinary entry mutations. A successful explicit refresh can replace the projection.
- Miniflux remains the source of truth for entries, read/unread, stars, feeds, categories, and counts.

The existing Phase 2C projection is the exact fallback for every unavailable or unusable preference profile. Its behavior and ordering must remain available as a deterministic baseline.

## 3. Product invariants

The implementation must satisfy all of the following:

1. Personalization is deterministic for equivalent candidate, starred-corpus, identity, and session inputs.
2. Only Secondary Highlights and Recent ordering may be personalized.
3. The Primary is always the newest eligible unread Home candidate.
4. Freshness and diversity are explicit editorial constraints; affinity cannot override them through accumulated points.
5. The candidate set, unread total, cursor, pagination, and entry eligibility remain the canonical Phase 2C values.
6. Current-item star is a direct item-level signal, separate from aggregate source/category affinity.
7. Hidden feeds do not contribute to the profile.
8. A candidate is excluded from its own source/category affinity aggregate.
9. All and Unread are unchanged and remain chronological/predictable.
10. Profile data is ephemeral and never written to NewsFlux-owned persistent storage.
11. Failure, timeout, or stale responses fall back to the exact Phase 2C projection.
12. No late response may reorder already-visible Highlights or Recent entries.
13. No personalization badges or card restyling are introduced.
14. No new settings UI is introduced.

## 4. Data and source-of-truth model

NewsFlux remains a frontend-only SPA with no NewsFlux backend or database. Miniflux remains authoritative for feeds, categories, read state, and starred state.

The profile input is a bounded, read-only Miniflux query for entries whose current state is starred. It is not a historical log of star and unstar actions. An entry that is unstarred is absent from the corpus used by a future Home session or approved refresh.

The existing Miniflux entries API helper can provide starred entries and entry/feed/category metadata. The existing entry preparation pipeline preserves the original entry fields while adding presentation data. This phase should reuse those capabilities unless implementation evidence proves a narrow helper adjustment is necessary.

The profile is derived data. It must not be sent to a new service, stored in a database, or treated as a second source of truth.

## 5. Profile semantics

The profile is built from the currently-starred corpus returned for the active Miniflux identity and filtered according to the hidden-feed rule in §15.

For each candidate, compute simple occurrence counts over the bounded, currently-starred Miniflux sample:

- `SOURCE_AFFINITY`: the number of other sampled currently-starred entries with the same feed ID;
- `CATEGORY_AFFINITY`: the number of other sampled currently-starred entries with the same category ID.

Exclude the candidate's own entry ID before calculating either count. A missing feed ID provides no source-affinity support; a missing category ID provides no category-affinity support. Missing metadata never changes candidate eligibility. The candidate's current starred boolean is a separate direct signal.

These raw occurrence counts are the only V1 affinity aggregation algorithm. Do not apply recency decay, publication-date weighting, logarithmic weighting, rank-changing normalization, or another scoring algorithm. A representation may be normalized only when it is mathematically order-preserving and leaves the raw-count ordering unchanged. Source affinity has precedence over category affinity as specified in §9; do not define numeric weights.

Affinity represents repeated explicit stars in a bounded current corpus. It is not a claim that the user has a durable preference, nor does it imply that all items from that source or category should outrank current news. The only open calibration values are the sample limit N and freshness-comparable boundaries in §§23–24.

## 6. Identity, lifetime, and storage

The profile identity is the normalized Miniflux server URL plus Miniflux user ID. Every asynchronous response must also be guarded by the current data/session revision and the active Home request identity.

Profile lifetime is one Home composition generation: the initial Home session or one explicitly refreshed Home projection. Keep it only in React/session memory. Discard it when the Home session is invalidated, on reload, logout, account switch, server switch, or session-revision change.

Do not store the profile or its affinity values in localStorage, sessionStorage, IndexedDB, a service worker cache, a NewsFlux backend, or Miniflux. Existing authentication and ordinary settings persistence are outside this feature and must not be expanded for personalization.

## 7. Canonical Home candidate stream

The Phase 2C candidate query remains unchanged:

- unread only;
- `published_at` descending;
- existing visibility policy;
- existing page size and pagination;
- existing cursor and mutation/session protections.

The starred-corpus request is auxiliary ranking context only. It must not:

- add entries to Home;
- become another candidate list;
- change unread totals or counts;
- change eligibility;
- change the canonical cursor or pagination;
- trigger a fetch to fill a Highlight slot;
- mutate Miniflux;
- alter All or Unread.

All and Unread remain chronological and retain their existing filters, sort behavior, counts, mutations, and navigation.

## 8. Primary Highlight

Primary is always the newest eligible unread candidate in the canonical Home result, using `published_at` and the approved stable `entry.id` tie-break for equal timestamps.

No profile signal may replace, demote, or select Primary. This rule applies on initial composition and approved refresh. Affinity, current-item star, image presence, source diversity, and category diversity cannot override it.

## 9. Secondary Highlights

Personalization may influence the order and selection of Secondary Highlights only within the freshness-comparable candidate set defined by the calibrated freshness mechanism.

Within that set:

- current-item starred is the strongest direct preference signal;
- source affinity takes precedence over category affinity;
- source diversity is preserved before category diversity;
- do not repeat a source or category while freshness-comparable alternatives remain;
- relax diversity only when those alternatives are exhausted;
- resolve remaining ties with the stable `entry.id` order.

Affinity preferences do not make an entry eligible or ineligible. They cannot promote a materially older candidate across a freshness boundary. The Secondary cards remain visually equivalent and retain existing card and action semantics.

## 10. Recent ordering

Recent retains the same candidate set, loaded-page boundary, pagination model, and broad freshness progression as Phase 2C.

Personalization may reorder entries only inside deterministic freshness-comparable groups. It must not promote materially older stories above meaningfully fresher news. It must not remove entries, add candidates, alter the cursor, or create a second Recent stream.

Within a comparable group, use current-item star, source affinity, and weaker category affinity subject to the same freshness and diversity constraints as Secondary selection. Keep stable ordering for otherwise tied candidates. The exact freshness group boundary is gated by §24.

Recent must continue to read as a news progression, not a static recommendation feed.

## 11. Freshness constraint model

Freshness is a hard editorial boundary, not a numeric component in a composite score.

The implementation must use an explicit, named freshness-band/window constant such as `HOME_PERSONALIZATION_FRESHNESS_WINDOW` (or an equivalently explicit named boundary set) and deterministic boundary behavior. Affinity can reorder candidates only within the same freshness-comparable group. It cannot accumulate enough abstract points to cross a boundary.

This design intentionally does not set production threshold values. The later calibration and approval procedure is specified in §24. The feature cannot ship until the chosen named value and its rationale are approved by PM and covered at the exact boundary.

## 12. Diversity and repetition control

Source diversity is considered before category diversity. When selecting a Secondary, prefer a freshness-comparable candidate from a source not already represented whenever such a candidate exists. Among source-diverse choices, prefer a category not already represented when possible. Relax each preference only when no eligible comparable alternative remains.

The same principle constrains affinity: it may choose among candidates that preserve the highest available diversity opportunity, but cannot cause repeated-source or repeated-category selections while comparable alternatives are available.

Diversity is a soft selection constraint, not an eligibility requirement. Missing source/category metadata does not remove an otherwise eligible article. Stable `entry.id` is the final deterministic tie-break after the approved constraints and signals.

## 13. Current-item star semantics

A candidate currently marked starred in Miniflux carries the strongest direct item-level preference signal. This signal is evaluated independently from source/category aggregates.

It may influence Secondary or Recent order only within the permitted freshness group and subject to diversity. It never changes Primary. A candidate's own entry ID is excluded from the aggregate source/category corpus, so its direct star does not artificially increase the affinity used to rank itself.

The existing star UI remains the only visible star treatment. No recommendation badge, new card decoration, or new mutation behavior is introduced.

## 14. Source and category affinity

Source affinity is the simple occurrence count of other sampled currently-starred entries with the candidate's feed ID. Category affinity is the simple occurrence count of other sampled currently-starred entries with the candidate's category ID. The candidate's own entry ID is excluded from both counts.

When comparing affinity signals, source affinity precedes category affinity; category remains the weaker, broader signal. Current-item starred remains a separate stronger direct signal. Do not add weights or transform the counts in a way that changes their ordering. Ties proceed through the approved diversity constraints and stable `entry.id` tie-break.

## 15. Hidden-feed rules

Entries whose feed is hidden under the existing feed-visibility model must not contribute to either affinity count, even if an ordinary-navigation setting exposes hidden feeds in a list.

Enforce the exclusion using existing feed-level visibility data. Do not infer feed visibility from category IDs or redefine any category-visibility behavior. Category affinity continues to group entries from allowed feeds by category ID. If existing category visibility behavior affects feed visibility, report that separately for implementation review; this Phase 2D contract does not expand or redefine it.

The canonical Home candidate query keeps its existing visibility behavior. The profile-specific feed exclusion must not silently change which Home candidates are visible.

If every sampled currently-starred entry belongs to a hidden feed, the effective profile is empty and Home uses the exact Phase 2C projection.

## 16. Candidate self-exclusion

Before calculating aggregate affinity for a candidate, exclude that candidate's entry ID from the currently-starred corpus. This prevents an entry from creating its own source/category boost.

Current-item starred state remains available as the separate direct signal in §13. Exclusion applies to source and category aggregates, whether the candidate is starred or not. Entry identity comparisons must use the repository's stable entry ID semantics.

## 17. Auxiliary query lifecycle

Home orchestration owns the profile query. The initial Home session starts at most one auxiliary query, which may run in parallel with the canonical Home candidate request. An explicit Home refresh is a new projection generation and may start at most one replacement profile query. Renders, load-more, status settlement, star, and unstar never duplicate or initiate a query. The profile query does not belong in global ArticleList, All, or Unread state.

The request is bounded by the named sample limit from §23 and queries only currently-starred entries. It is read-only. The implementation must not page through the entire starred corpus without a bound.

Tag the request with the normalized server/user identity, current session revision, and Home session/projection identity. Discard responses that no longer match. Do not inherit transient search or date filters from other Home-independent list state; when reusing a helper whose default reads a date filter, explicitly disable that filter. Apply the profile-specific hidden-feed rule and sample policy.

## 18. Allowed recomposition events

A new personalized projection may be created only for:

- a new Home session; or
- an explicit Home refresh.

Do not recompose because of a late auxiliary response, star/unstar action, status settlement, background mutation, load-more, reader open/close, or unrelated render.

When the initial profile result arrives within the approved bounded loading budget, it may be included in the initial projection. Once visible, that projection remains stable for the session.

## 19. Explicit refresh behavior

During explicit Home refresh, preserve the current valid Home content while requests are in flight. Fetch the new canonical candidate snapshot and auxiliary profile according to the approved lifecycle, then apply one coherent replacement projection.

Never progressively reshuffle visible Highlights or Recent as the two responses arrive. If the auxiliary query fails or exceeds its approved bounded wait budget, build the replacement projection using the exact Phase 2C baseline. A failed canonical refresh follows the existing Phase 2C behavior and preserves valid content and its current projection.

No automatic retry loop is allowed. A user-initiated refresh may start a new attempt.

## 20. Failure and fallback behavior

The exact Phase 2C deterministic projection is required for:

- zero profile;
- no matching affinity;
- profile containing only hidden-feed entries;
- profile fetch failure;
- profile timeout;
- stale account response;
- stale session response.

A weak or concentrated profile may have bounded influence only inside freshness and diversity constraints. If it cannot change a permitted ordering decision, baseline ordering remains.

Preference-query failure must not cause a global Home error, blank content, candidate clearing, count changes, pagination changes, retries, or late recomposition. Stale responses are discarded and cannot mutate a newer Home session.

## 21. Explainability and UI affordance

Cards receive no recommendation/personalization badges, new card styling, or new visual hierarchy. Existing star presentation remains unchanged.

The information affordance beside “Highlights” follows this mandatory truth condition for the same canonical snapshot:

`PERSONALIZATION_APPLIED = personalized visible Secondary/Recent entry order differs from the exact Phase 2C baseline visible order`

If `PERSONALIZATION_APPLIED=true`, the information affordance MUST be visible. If `PERSONALIZATION_APPLIED=false`, it MUST NOT be visible. Profile availability by itself MUST NOT show the affordance. This condition is based on presented entry order, not merely on profile availability.

The explanation communicates that starred sources may influence Secondary Highlights and Recent, Primary remains freshness-driven, and All/Unread remain chronological. It must be small, keyboard accessible, accessible by touch, opaque, non-blocking to editorial layout, and visually distinct from Liquid Glass chrome. It is not persistent navigation chrome and does not introduce card-level labels.

## 22. Privacy and cross-device implications

No NewsFlux-owned durable behavioral data is collected or retained. The profile is computed in browser memory from Miniflux data already held by the user's Miniflux account; it does not leave that memory as a NewsFlux profile. The query is sent to the configured Miniflux server using the existing authenticated API path.

Because the source is Miniflux's currently-starred corpus, the same account can provide similar preference evidence on multiple devices. Exact results are not guaranteed to match: candidate snapshots, request timing, loaded page contents, identity/session revisions, and NewsFlux visibility/page-size settings can differ.

The profile is an ephemeral inference and remains privacy-sensitive while in memory. Do not log affinity values, send them to analytics, or persist them. Unstarring removes evidence from a future profile; it does not rewrite an already-visible session projection.

No new NewsFlux database, export flow, or retained-profile deletion mechanism is introduced. Miniflux remains responsible for its authoritative starred data and its own account-level data handling.

## 23. BOUNDED_N sample calibration protocol

The profile sample is bounded by a named implementation constant, for example `HOME_STARRED_PROFILE_LIMIT`. This specification intentionally does not assign a numeric value.

Do not use `published_at` as a preference-history window: it records article publication, not when the user starred an entry. A currently-starred older article must not be excluded merely because it was published long ago.

Before implementation, the planning/calibration work must:

1. inspect Miniflux request cost and the existing starred-entry query behavior;
2. measure payload size and latency for representative starred-corpus sizes;
3. inspect observed starred-corpus sizes from representative accounts without retaining user-level telemetry;
4. evaluate whether additional sample entries still add useful source/category evidence;
5. select a simple finite upper bound and explain the trade-off between coverage, latency, and payload;
6. verify deterministic behavior when the corpus exceeds the bound, including stable query ordering and tie behavior;
7. define behavior for empty and smaller-than-limit corpora;
8. record the selected named constant and rationale in the implementation plan;
9. obtain PM approval before implementation.

No unbounded fetch, pagination through all starred history, or publication-date cutoff is permitted in V1.

## 24. Freshness-band calibration protocol

The implementation must define the named freshness boundary (for example, `HOME_PERSONALIZATION_FRESHNESS_WINDOW`) for freshness-comparable groups. This specification intentionally does not assign its production value.

Before implementation, the planning/calibration work must:

1. inspect real Home candidate timestamp distributions;
2. benchmark representative Home datasets and expected page sizes;
3. select a simple named boundary that allows useful local personalization without promoting materially older items over fresher news;
4. document why the boundary preserves the editorial meaning of Secondary Highlights and Recent;
5. define deterministic behavior for missing/invalid timestamps;
6. test candidates just below, exactly at, and just above every boundary;
7. verify the Primary remains the newest eligible unread candidate independent of bands;
8. obtain PM approval of the chosen value before implementation.

Boundaries must be explicit and testable. No hidden score or arbitrary per-entry magic threshold may substitute for the named mechanism.

## 25. Automated harness and regression contract

The Phase 2D test/harness work must cover at least:

- `PRIMARY_ALWAYS_NEWEST_ELIGIBLE_UNREAD`
- `PHASE2C_BASELINE_PARITY` for zero profile, no useful match, profile containing only entries from hidden feeds, fetch failure, and timeout
- `CANDIDATE_SELF_EXCLUDED_FROM_AFFINITY`
- `HIDDEN_FEEDS_EXCLUDED_FROM_PROFILE`: entries from hidden feeds contribute to neither affinity count
- `CURRENT_STAR_DIRECT_SIGNAL`
- `SOURCE_AFFINITY_PRECEDES_CATEGORY_AFFINITY`
- `FRESHNESS_BOUNDS_PERSONALIZATION`
- `DIVERSITY_BOUNDS_PERSONALIZATION`
- `STABLE_ENTRY_ID_TIEBREAK`
- `CANONICAL_HOME_QUERY_UNCHANGED`
- `NO_SECOND_CANDIDATE_STREAM`
- `ALL_UNREAD_UNCHANGED`
- `STAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION`
- `UNSTAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION`
- `LATE_PROFILE_DOES_NOT_RECOMPOSE`
- `STALE_SESSION_PROFILE_DISCARDED`
- `STALE_ACCOUNT_PROFILE_DISCARDED`
- `PROFILE_FAILURE_FALLS_BACK`
- `PROFILE_TIMEOUT_FALLS_BACK`
- `NO_PROFILE_RETRY_LOOP`
- `EXPLICIT_REFRESH_SINGLE_RECOMPOSITION`
- `PERSONALIZATION_EXPLAINER_TRUTHFUL`: changed visible order MUST show the affordance; unchanged order MUST hide it; profile availability alone MUST NOT show it
- `ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION`: one initial query, with no duplicate calls from renders or unrelated events; an explicit refresh may start one query for its replacement projection

Also retain the applicable Phase 2C Home, All/Unread, mutation, count, pagination, reader-return, and stale-session regression gates. The profile must not change those contracts.

## 26. Real-device gate

Before a future implementation PR can merge, validate:

- 390×844;
- 768×1024;
- 884×1104;
- 1024×768;
- 1280×800;
- 1440×900;

in light and dark/OLED themes where applicable.

At the critical 884×1104 viewport, verify editorial hierarchy, no overflow or density regression, Primary dominance, balanced Secondaries, Recent as a news continuation, and that the information affordance does not compress the heading. Its explanatory surface must be legible and opaque, must not compete with Liquid Glass chrome, and must remain accessible.

Interaction checks include star, unstar, Home return, explicit refresh, and late-profile behavior. Confirm single-pane behavior on mobile/tablet/Fold and preserve the existing NewsFlux visual contract: Liquid Glass is chrome-only; cards and content surfaces remain opaque.

## 27. Fork scope and conflict governance

Expected implementation conflict surface is limited to:

- Home orchestration;
- Home editorial projection;
- Phase 2D-specific helpers;
- Phase 2D tests/harness;
- reuse of the existing starred-entry API helper, with only a narrowly justified helper adjustment if required.

Changes to Content, ArticleList, All/Unread, authentication, global mutation machinery, Miniflux mutation semantics, or the Liquid Glass system are architectural warnings. They must not be silently added to Phase 2D scope.

Report incidental findings separately; do not fix them as part of Phase 2D.

## 28. Residual risks

- A star can mean “save for later,” not a durable source preference.
- A bounded corpus can omit older currently-starred entries when the account exceeds the chosen limit.
- Feed/category metadata can be missing or broad, reducing affinity quality.
- Hidden-feed semantics must be enforced consistently even if ordinary list settings expose hidden feeds.
- A bounded wait budget balances personalized initial ordering against Home responsiveness.
- Cross-device candidate sets and local settings can differ even when Miniflux identity and starred corpus are shared.
- Freshness bands and sample size require evidence and PM approval before implementation.

These risks do not authorize widening the design to read history, local persistence, or machine learning.

## 29. Explicitly deferred work

Defer to later product decisions or phases:

- numeric sample limit and freshness boundary values until the calibration protocols are completed;
- numeric weights or a combined affinity score;
- topic/tags affinity;
- read/open/dwell/scroll/dismiss behavior;
- persistent profile, preference editor, or personalization settings;
- recommendation badges or card redesign;
- personalization outside Home;
- any changes to All/Unread, authentication, global mutations, reader/navigation, or Liquid Glass;
- implementation details and code changes.

The separately requested implementation plan must resolve technical integration choices without changing this approved product contract. This document does not create that plan.

## 30. Acceptance criteria

The Phase 2D V1 design is satisfied when a future implementation:

1. derives source/category affinity only from a bounded currently-starred Miniflux corpus;
2. keeps the profile in memory for one Home session or approved refresh and guards it by server, user, and session revision;
3. excludes hidden-feed entries and each candidate from its own simple occurrence counts;
4. never changes the canonical Home candidate stream, counts, cursor, pagination, or mutation semantics;
5. keeps Primary as the newest eligible unread candidate;
6. personalizes only Secondary Highlights and Recent within approved freshness groups and diversity constraints;
7. uses current-item star as the strongest direct signal, source affinity ahead of weaker category affinity, and a stable ID tie-break;
8. uses exact Phase 2C ordering for every defined fallback condition;
9. never reorders visible content in response to a late profile, star/unstar, status settlement, load-more, or unrelated render;
10. recomposes once for a new Home session or explicit refresh, applying one coherent projection;
11. shows the truthful explanation affordance only when the presented Secondary/Recent order actually changes;
12. adds no persistent personalization state, telemetry, ML, or settings UI;
13. passes the required automated and real-device gates;
14. remains localized to the approved Home implementation surfaces and preserves all applicable Phase 2C regressions.

Numeric sample and freshness values are not accepted until their calibration protocols, tests, and PM approvals are complete.
