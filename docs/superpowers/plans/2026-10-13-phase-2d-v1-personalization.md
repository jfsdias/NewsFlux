# Phase 2D V1 Deterministic Home Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Home-only personalization from the bounded
currently-starred Miniflux corpus while preserving Phase 2C candidate,
session, mutation, All/Unread, privacy, and editorial guarantees.

**Architecture:** Keep `getHomeEntries`, `useArticleList`, and the Phase 2C
candidate stream unchanged. Build a bounded in-memory profile from the
existing starred-entry API helper, apply it only to Secondary Highlights and
Recent inside calibrated freshness groups, and commit one projection at the
canonical Home snapshot boundary. Use the exact Phase 2C projection whenever
the profile is unavailable, unusable, stale, or late; show an explanation only
when the visible Secondary/Recent order actually changes.

**Tech Stack:** React 19.3, React Router 8.4, Nanostores, Vite 8, Node.js
22.22+, pnpm 11.21, Node's built-in `node:test`, ESLint 9, and Prettier 3.

**Spec:**
docs/superpowers/specs/2026-10-13-phase-2d-v1-personalization-design.md

## Global Constraints

- The approved specification at `62eb9ba0d1b66cdb34caf1c1f4e4bc3b91f2c2a8` is authoritative. Do not edit it or reinterpret its product contract.
- Keep `getHomeEntries`, the unread-only `published_at` descending candidate request, totals, cursor, page size, pagination, eligibility, and candidate preparation unchanged.
- Reuse `getStarredEntries`; pass an explicit approved limit and `filterDate: null`. The profile request is ranking context only and never supplies Home candidates.
- Preserve the exact Phase 2C projection for zero/empty/no-match/hidden-only/failed/stale/deadline-missed profiles. Do not add profile-driven retries or wait beyond the canonical snapshot-ready event.
- Keep the profile and generation state in React/session memory only. Guard each response by normalized server URL, Miniflux user ID, `sessionRevision`, Home request identity, and generation identity.
- The only production calibration values are `HOME_STARRED_PROFILE_LIMIT` and `HOME_PERSONALIZATION_FRESHNESS_WINDOW` (or an equally explicit named boundary). Neither value is selected in this plan; both require PM approval before functional work.
- Keep the newest eligible unread candidate as Primary. Personalize only Secondary Highlights and Recent, with simple occurrence counts, candidate self-exclusion, current-item star as a separate direct signal, source affinity ahead of category affinity, freshness boundaries, source-before-category diversity, and stable entry-ID ties. Do not introduce a weighted score.
- Use the existing feed-level hidden visibility model. Do not infer new category semantics. A narrow read-only export of the already-derived hidden-feed set is allowed only to make that existing rule available to the profile builder.
- Do not change All/Unread, auth, Miniflux mutations, global mutation machinery, `Content`, `ArticleList`, API behavior, Liquid Glass, cards, search, or settings. If implementation evidence makes a warning surface necessary, stop and report before editing it.
- No persistent profile, local storage, telemetry, ML, backend, new settings, recommendation badges, or card restyling.
- Every functional task starts with a named failing test and exact command, specifies the interface and minimal change, gives the passing command, and ends with its own focused commit. No unrelated cleanup.

## Frozen Profile Deadline Contract

```text
PROFILE_WAIT_POLICY=NO_ADDITIONAL_WAIT
PROFILE_DEADLINE_EVENT=CANONICAL_HOME_SNAPSHOT_READY
WALL_CLOCK_TIMEOUT=NONE
TIMER_REQUIRED=NO
THIRD_CALIBRATION_VALUE=NO
```

At the initial or explicit-refresh generation's canonical snapshot-ready event, use a valid profile only if it has already resolved and still matches the active server/user identity, `sessionRevision`, Home request key, and generation. Otherwise commit the exact Phase 2C projection immediately. A profile that resolves after this event is discarded and cannot trigger another projection, reorder, explainer, request, or retry. For tests, `PROFILE_TIMEOUT_FALLS_BACK` means holding the auxiliary profile promise pending until the canonical snapshot is resolved, asserting immediate baseline projection and one composition, then resolving the profile and asserting no visible change. There is no timer, wall-clock wait, `AbortController`, or third calibration value.

## Review Focus

1. **Profile result misses the canonical deadline or belongs to a prior identity.** The generation tests in Task 4 must prove immediate baseline composition, stale-result discard, and no late recomposition.
2. **A candidate boosts itself or hidden-feed stories enter affinity counts.** The profile tests in Task 1 must prove stable-ID self-exclusion and exact use of the existing feed-hidden set.
3. **Affinity crosses freshness or diversity constraints.** The projection tests in Task 2 must cover the frozen anchor-based freshness groups, exact inclusive boundaries, the anti-chaining case, invalid-timestamp singletons, source-first/category-second diversity, and source affinity before category affinity.
4. **A refresh partially replaces a still-valid Home or composes twice.** The generation tests and browser gate in Tasks 4 and 6 must prove the old projection stays visible in flight and exactly one replacement is committed at snapshot readiness.
5. **The explainer claims personalization when the visible order did not change or harms the heading at tablet width.** The projection/UI and viewport gates in Tasks 2, 5, and 6 must verify the exact truth condition, accessible disclosure, opacity, and 884×1104 geometry.

## Pre-Implementation Calibration Gate

This is a blocking evidence and PM-review gate, not a code task. Do not start any functional task until both values below have evidence and explicit PM approval. Do not select either value while writing or executing this plan.

### Starred-profile sample limit

- [ ] Use the existing read-only Miniflux starred-entry request and representative currently-starred account data. Do not mutate stars, persist entry-level data, or emit telemetry. Keep only aggregate measurements needed for review; discard raw response data after measurement.
- [ ] Record the actual query shape: `/v1/entries`, `starred=true`, `order=changed_at`, explicit `direction=desc`, the tested `limit`, no status constraint, no search term, and no date range. `filterDate: null` must explicitly prevent inheritance of the current list date filter.
- [ ] Record total starred corpus size, returned sample size, request latency, response bytes, and the source/category occurrence counts observed at each tested bounded limit. Include a corpus below the proposed limit and one at or above it when available.
- [ ] Compare bounded samples ordered by the existing `changed_at` ordering. Show where increasing the sample stops adding useful source/category evidence and document the latency/payload trade-off. Confirm deterministic behavior for corpus smaller than, equal to, and larger than the proposed limit, including stable tie behavior.
- [ ] Do not page through all starred history. Do not use a publication-date cutoff. If representative read-only evidence is unavailable, stop and request sanitized evidence rather than guessing.
- [ ] Return `PROPOSED_HOME_STARRED_PROFILE_LIMIT=<integer>`, `RATIONALE=<measured coverage/latency/payload evidence>`, and `PM_APPROVAL_REQUIRED=YES`.

### Freshness boundary

- [ ] Inspect representative canonical Home candidate `published_at` distributions and the age deltas around Primary, both Secondary slots, and Recent across the agreed page sizes. Use sanitized aggregate distributions and editorial examples; do not retain user-level data.
- [ ] Compare the proposed deterministic groups against stories just below, exactly at, and just above each boundary. Demonstrate that a preference cannot move a materially older story ahead of a fresher group and that useful within-group choices remain possible.
- [ ] Freeze the grouping algorithm as `FRESHNESS_GROUP_ALGORITHM=ANCHOR_BASED`. Its input is the exact Phase 2C baseline order for the candidate sequence. The first ungrouped entry anchors a group; parse that anchor's `published_at`; include each later candidate only when `anchorTimestamp - candidateTimestamp <= PM_APPROVED_HOME_PERSONALIZATION_FRESHNESS_WINDOW` (inclusive). The first candidate outside the window starts the next group. Never chain from the previous neighbor, use absolute epoch buckets, or extend a group transitively. A missing/invalid timestamp is a singleton that cannot be crossed. For a Secondary slot, the group containing its baseline slot/candidate is the only permitted personalization region. For Recent, partition the exact baseline Recent order by the same algorithm and reorder only inside each group. Primary stays fixed.
- [ ] Specify deterministic treatment for missing/invalid timestamps and verify Primary remains the newest eligible unread candidate regardless of group membership. Add tests for below/equal/above the approved boundary, the three-entry anti-chaining case (A–B and B–C within the window but A–C outside, so C starts a new group), an invalid-timestamp singleton, and exact Phase 2C parity when no preference affects a group.
- [ ] Return `PROPOSED_HOME_PERSONALIZATION_FRESHNESS_WINDOW=<duration or explicit boundary>`, `RATIONALE=<timestamp distribution and editorial evidence>`, and `PM_APPROVAL_REQUIRED=YES`.

### Blocking decision

Record both values and their evidence in the execution review, then obtain:

```text
PM_APPROVAL_HOME_STARRED_PROFILE_LIMIT=YES
PM_APPROVAL_HOME_PERSONALIZATION_FRESHNESS_WINDOW=YES
```

The approved values become `PM_APPROVED_HOME_STARRED_PROFILE_LIMIT` and `PM_APPROVED_HOME_PERSONALIZATION_FRESHNESS_WINDOW` inputs to the implementation tasks; they are not chosen in this plan.

**NO FUNCTIONAL IMPLEMENTATION TASK MAY BEGIN UNTIL PM APPROVES BOTH VALUES.** The sample limit (`N`) and freshness window are the only two calibration values; `N` and the freshness window remain unset in this plan. No third calibration value, wall-clock timeout, or additional wait is permitted. After approval, put the approved values in the named constants specified in Task 2 and cover their exact boundaries in tests.

## Expected Implementation and Test Files

The following is the planned maximum scope. Do not add files outside it without first reporting why the approved scope is insufficient.

**Product files:**

- `src/store/dataState.js` — export the existing derived globally-hidden feed-ID set without changing its derivation or visibility behavior.
- `src/utils/home-personalization-constants.js` — the two PM-approved named calibration values only.
- `src/utils/home-personalization-profile.js` — transient profile construction and per-candidate raw signals.
- `src/utils/home-personalization-projection.js` — deterministic freshness groups and constrained Secondary/Recent projection.
- `src/utils/home-personalization-generation.js` — pure generation/deadline/staleness transitions.
- `src/utils/home-editorial-session.js` — accept the committed initial projection and retain its Recent ordering while preserving existing mutation/backfill behavior.
- `src/components/Home/HomeEditorial.jsx` — own one auxiliary query per canonical Home generation and commit exactly one projection at snapshot readiness.
- `src/components/Home/HomeHighlights.jsx` and `src/components/Home/HomeEditorial.css` — truthful accessible information affordance; no card changes.
- `src/locales/de-DE.json`, `src/locales/en-US.json`, `src/locales/es-ES.json`, `src/locales/fr-FR.json`, `src/locales/ja-JP.json`, and `src/locales/zh-CN.json` — localized explanation strings using the existing locale shape.

**Test and harness files:**

- `src/store/dataState.test.js`
- `src/utils/home-personalization-profile.test.js`
- `src/utils/home-personalization-projection.test.js`
- `src/utils/home-personalization-generation.test.js`
- `src/utils/home-editorial-session.test.js`
- `src/utils/home-editorial-locales.test.js`
- `scripts/tests/fixtures/phase2c-editorial-home.js`
- `scripts/tests/phase2c-editorial-home.jsx`

The existing `getStarredEntries` helper is reused. No `src/apis/**`, `Content.jsx`, `ArticleList.jsx`, `useArticleList`, auth, mutation, route, setting, or All/Unread implementation file is in scope.

## Task 1: Expose the existing hidden-feed set and build a transient profile

**Files:** `src/store/dataState.js`, `src/store/dataState.test.js`, `src/utils/home-personalization-profile.js`, `src/utils/home-personalization-profile.test.js`.

- [ ] **Failing tests first:** Add tests for the current feed-level `hide_globally` rule and profile aggregation. Cover duplicate IDs, missing feed/category metadata, a hidden feed that is not counted, and two candidates sharing a feed/category where each candidate's own entry is excluded. Prove current-item starred is returned separately from aggregate signals.

```bash
node --test src/store/dataState.test.js src/utils/home-personalization-profile.test.js
```

- [ ] **Minimal implementation/interface:** Export the already-computed `globallyHiddenFeedIdSetState` from `dataState.js` under a read-only name such as `globallyHiddenFeedIdsState`; do not change its inputs or category-derived behavior. Add `createHomePersonalizationProfile({ entries, hiddenFeedIds })` returning in-memory starred IDs and raw source/category count maps, plus `getCandidatePreferenceSignals(candidate, profile)` returning `{ currentItemStarred, sourceAffinity, categoryAffinity }`. Deduplicate by stable entry ID, exclude hidden-feed entries before counting, and subtract/exclude the candidate's own ID from both aggregate counts. Missing IDs provide zero support and never change candidate eligibility.

- [ ] **Passing tests:**

```bash
node --test src/store/dataState.test.js src/utils/home-personalization-profile.test.js
```

Do not read settings or persist profile data in this helper. Do not add hidden-category policy; consume only the exact set already derived by the store.

- [ ] **Commit:** `feat: derive transient starred source profile`

## Task 2: Add calibrated freshness groups and constrained editorial projection

**Files:** `src/utils/home-personalization-constants.js`, `src/utils/home-personalization-projection.js`, `src/utils/home-personalization-projection.test.js`.

- [ ] **Failing tests first:** Build deterministic fixtures for newest Primary, two baseline Secondary slots, and Recent. Cover zero profile, no useful match, hidden-only effective profile, self-exclusion, direct star, source-versus-category affinity, source/category diversity, stable ID ties, and timestamps just below, exactly at, and just above the approved boundary. Include the three-entry anti-chaining case (A–B and B–C are within the window but A–C is outside, so C starts a new group), an invalid-timestamp singleton, and exact Phase 2C baseline parity when no permitted signal changes an ordering decision.

```bash
node --test src/utils/home-personalization-projection.test.js
```

- [ ] **Minimal implementation/interface:** After the calibration approvals, define only `HOME_STARRED_PROFILE_LIMIT` and `HOME_PERSONALIZATION_FRESHNESS_WINDOW` in the constants file with the approved values. Implement:

```js
projectHomePersonalization({
  entries,
  baselineHighlightIds,
  baselineRecentIds,
  profile,
  freshnessWindow,
}) // => { highlightIds, recentIds, personalizationApplied }
```

Treat the supplied Phase 2C arrays as the authoritative fallback and the exact input order for group formation. Freeze `FRESHNESS_GROUP_ALGORITHM=ANCHOR_BASED`: the first ungrouped entry anchors a group; later entries join only when `anchorTimestamp - candidateTimestamp <= freshnessWindow` (inclusive); the first outside candidate starts the next group. Do not chain from the previous neighbor, use absolute epoch buckets, or extend groups transitively. Missing/invalid timestamps form singleton groups that cannot be crossed. Keep `baselineHighlightIds[0]` fixed as Primary. A Secondary replacement may come only from the group containing that baseline Secondary slot/candidate; constrain choices by source diversity first and category diversity second, then compare current-item star, raw source affinity, raw category affinity, and stable entry ID. Partition the exact baseline Recent order with the same algorithm and reorder only within each resulting group, preserving broad freshness progression. If the effective profile has no useful signal for a group, keep its exact baseline order. Compute `personalizationApplied` by comparing the visible concatenated Secondary and Recent IDs with the exact baseline order; never derive it from profile availability.

- [ ] **Passing tests:**

```bash
node --test src/utils/home-personalization-projection.test.js
```

These tests own `PRIMARY_ALWAYS_NEWEST_ELIGIBLE_UNREAD`, `PHASE2C_BASELINE_PARITY` for zero/no-match/hidden-only profiles, `CANDIDATE_SELF_EXCLUDED_FROM_AFFINITY`, `HIDDEN_FEEDS_EXCLUDED_FROM_PROFILE`, `CURRENT_STAR_DIRECT_SIGNAL`, `SOURCE_AFFINITY_PRECEDES_CATEGORY_AFFINITY`, `FRESHNESS_BOUNDS_PERSONALIZATION`, `DIVERSITY_BOUNDS_PERSONALIZATION`, `STABLE_ENTRY_ID_TIEBREAK`, and projection-level `PERSONALIZATION_EXPLAINER_TRUTHFUL`.

- [ ] **Commit:** `feat: rank Home sections within editorial constraints`

## Task 3: Carry the committed projection through the existing Home session

**Files:** `src/utils/home-editorial-session.js`, `src/utils/home-editorial-session.test.js`.

- [ ] **Failing tests first:** Extend the existing Node tests to prove the default session still has byte-for-byte equivalent Phase 2C highlight/recent order; an explicitly supplied initial projection is retained; read-state filtering does not reshuffle surviving Recent entries; new load-more entries append in the existing canonical chronological order; and the current targeted one-slot read backfill still behaves as before.

```bash
node --test src/utils/home-editorial-session.test.js
```

- [ ] **Minimal implementation/interface:** Add an optional `initialProjection: { highlightIds, recentIds }` input to `createHomeEditorialSession`. When omitted, use the current Phase 2C selection unchanged. Store the committed Recent ID order in the session. Update `projectHomeSession` to retain that order for IDs in the committed projection, filter read/pending entries as it does today, and append previously unseen eligible load-more entries using the existing `byPublishedAt` ordering. Keep `transitionHomeSession`'s existing bounded mutation/backfill semantics; do not rebuild the profile or run the personalized projection on a status/star event.

- [ ] **Passing tests:**

```bash
node --test src/utils/home-editorial-session.test.js
```

- [ ] **Commit:** `feat: preserve personalized ordering in Home sessions`

## Task 4: Bind one profile request to each canonical Home generation

**Files:** `src/utils/home-personalization-generation.js`, `src/utils/home-personalization-generation.test.js`, `src/components/Home/HomeEditorial.jsx`.

- [ ] **Failing tests first:** Add pure transition tests for one generation, profile-ready-before-snapshot, pending/failed profile at snapshot, late profile, stale session revision, stale normalized server/user identity, failed canonical refresh, and explicit-refresh replacement. In particular, hold the profile promise pending, resolve the canonical snapshot, assert immediate exact baseline and exactly one projection, then resolve the profile and assert no second projection, reorder, or explainer.

```bash
node --test src/utils/home-personalization-generation.test.js
```

- [ ] **Minimal implementation/interface:** Use a pure generation helper with explicit `{ generationId, requestKey, identityKey, sessionRevision, status, profile }` state and transitions for profile resolution, canonical snapshot readiness, canonical failure, and invalidation. A snapshot-ready transition returns one immutable projection decision and closes that generation to further changes. In `HomeEditorial`, start `getStarredEntries(null, { limit: HOME_STARRED_PROFILE_LIMIT, direction: "desc", filterDate: null })` once for initial Home and once when the existing canonical readiness lifecycle identifies an explicit refresh/new Home generation. Tag the result with `getHomeIdentityKey(homeIdentityState.get())`, `getDataSessionRevision()`, the existing Home `requestKey`, and a generation ID. Build the profile with `globallyHiddenFeedIdsState.get()`.

The current `useArticleList`/`contentState` lifecycle is sufficient: while the Home list owner is mounted, `isArticleListReady` becomes false for a canonical request and `articleListSnapshotRevision` changes only when that canonical response is committed. Use those existing signals, plus the current Home request identity and an idempotent generation guard, to pair the auxiliary request with a generation. Do not start a request after Home unmounts or when `content.infoFrom !== "home"`. Do not change `Content.jsx`, `useArticleList`, or stores other than the narrow existing-hidden-set export in Task 1. At snapshot readiness, use a successfully resolved, still-current profile if already available; otherwise commit the exact Phase 2C projection immediately. A late profile is discarded. A failed refresh leaves the previously committed Home projection visible. No timer, wall-clock timeout, `AbortController`, extra wait, or automatic retry is introduced.

Do not start a query on render, load-more, star/unstar, status settlement, reader open/close, or unrelated state updates. Do not let a profile response mutate `contentState`, counts, candidates, pagination, or the current session.

- [ ] **Passing tests:**

```bash
node --test src/utils/home-personalization-generation.test.js
```

The integration request-count and refresh checks are completed in Task 6. This task owns `PROFILE_FAILURE_FALLS_BACK`, `PROFILE_TIMEOUT_FALLS_BACK` as a canonical-deadline miss, `LATE_PROFILE_DOES_NOT_RECOMPOSE`, `STALE_SESSION_PROFILE_DISCARDED`, `STALE_ACCOUNT_PROFILE_DISCARDED`, `NO_PROFILE_RETRY_LOOP`, and `EXPLICIT_REFRESH_SINGLE_RECOMPOSITION` at the pure transition level.

- [ ] **Commit:** `feat: bind Home profile to snapshot generations`

## Task 5: Add the truthful, localized Highlights explanation

**Files:** `src/components/Home/HomeHighlights.jsx`, `src/components/Home/HomeEditorial.css`, all six `src/locales/*.json` files listed above, and `src/utils/home-editorial-locales.test.js`.

- [ ] **Failing tests first:** Extend the locale test to require all explanation strings in each shipped locale and verify existing section labels remain unchanged.

```bash
node --test src/utils/home-editorial-locales.test.js
```

- [ ] **Minimal implementation/interface:** Pass the committed `personalizationApplied` boolean from `HomeEditorial` to `HomeHighlights`. Render a small information button beside the existing Highlights heading only when it is true. The button controls a localized, opaque, non-modal disclosure using `aria-expanded` and `aria-controls`; it must work by keyboard and touch, close on Escape, and not take part in document flow or shrink/wrap the heading. Use the existing surface/text tokens and no Liquid Glass classes. The explanation must say starred sources may influence Secondary Highlights and Recent, Primary remains freshness-driven, and All/Unread remain chronological. Do not modify any card, action, or ranking presentation.

- [ ] **Passing tests:**

```bash
node --test src/utils/home-editorial-locales.test.js src/utils/home-personalization-projection.test.js
```

The UI visibility, keyboard/touch, opacity, and heading geometry checks are owned by Task 6. Keep all locale JSON valid and use the existing `home_page` key pattern.

- [ ] **Commit:** `feat: explain Home personalization when applied`

## Task 6: Extend the real-route Phase 2C harness for Phase 2D

**Files:** `scripts/tests/fixtures/phase2c-editorial-home.js`, `scripts/tests/phase2c-editorial-home.jsx`.

- [ ] **Failing test first:** Add a named Phase 2D browser suite before wiring the implementation. Its initial run must fail because the current harness has no starred-profile request behavior or personalized projection assertions.

```bash
pnpm dev --host 127.0.0.1
```

Open `http://127.0.0.1:5173/scripts/tests/phase2c-editorial-home.html`, select the Phase 2D suite in the existing viewport/theme harness, and record the failing gate names before implementation. After wiring, rerun the same suite at each required viewport/theme. The harness must mock `starred=true` separately from canonical Home requests, support resolved, failed, and deferred profile responses, and count each request type.

- [ ] **Minimal implementation/interface:** Add fixtures and integration scenarios for:

- exactly one auxiliary profile query on initial Home and one on explicit refresh; no extra query on rerender, load-more, star/unstar, status settlement, or reader return;
- unchanged canonical Home URL/query and no second candidate stream; starred entries never appear as Home candidates solely due to the profile;
- exact Phase 2C fallback for zero, no-match, hidden-only, failed, stale, and deadline-missed profiles;
- pending profile at canonical readiness followed by a late result with no second composition, reorder, or explainer;
- stale identity/session rejection and refresh failure preserving the last valid projection;
- Primary remains newest; visible order/explainer truth; star/unstar and read-state mutations preserve current-generation ordering; load-more retains pagination and appends without requery;
- All and Unread request, order, counts, and mutation behavior remain unchanged;
- opaque localized explanation, keyboard/touch operation, and no card redesign or Liquid Glass conflict.

Preserve and run all current Phase 2C Home, mutation, count, pagination, reader-return, and stale-session scenarios. Do not replace or weaken existing harness gates.

- [ ] **Passing check:** Use the same command and harness suite described above; require every Phase 2D scenario and every retained Phase 2C scenario to pass. The named behavioral gates in the user handoff map as follows: `CANONICAL_HOME_QUERY_UNCHANGED`, `NO_SECOND_CANDIDATE_STREAM`, `ALL_UNREAD_UNCHANGED`, `STAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION`, `UNSTAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION`, `ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION`, and integration-level `EXPLICIT_REFRESH_SINGLE_RECOMPOSITION` are asserted here. `PERSONALIZATION_EXPLAINER_TRUTHFUL` is asserted for changed, unchanged, profile-available/no-effect, and deadline-fallback states.

- [ ] **Commit:** `test: cover Phase 2D Home personalization behavior`

## Task 7: Whole-branch verification, candidate handoff, and device gates

This is a verification and release-governance gate after Tasks 1–6, not an additional product change. Do not repair unrelated findings in this task. Emulated browser coverage and physical-device validation are separate gates; passing one never implies the other.

- [ ] Run the complete focused unit set:

```bash
node --test src/store/dataState.test.js src/utils/home-personalization-profile.test.js src/utils/home-personalization-projection.test.js src/utils/home-personalization-generation.test.js src/utils/home-editorial-session.test.js src/utils/home-editorial-locales.test.js
```

- [ ] Run lint, formatting, build, and whitespace validation on the exact changed-code scope:

```bash
pnpm exec eslint src/store/dataState.js src/store/dataState.test.js src/utils/home-personalization-constants.js src/utils/home-personalization-profile.js src/utils/home-personalization-profile.test.js src/utils/home-personalization-projection.js src/utils/home-personalization-projection.test.js src/utils/home-personalization-generation.js src/utils/home-personalization-generation.test.js src/utils/home-editorial-session.js src/utils/home-editorial-session.test.js src/components/Home/HomeEditorial.jsx src/components/Home/HomeHighlights.jsx src/utils/home-editorial-locales.test.js scripts/tests/phase2c-editorial-home.jsx scripts/tests/fixtures/phase2c-editorial-home.js
pnpm exec prettier --check src/store/dataState.js src/store/dataState.test.js src/utils/home-personalization-constants.js src/utils/home-personalization-profile.js src/utils/home-personalization-profile.test.js src/utils/home-personalization-projection.js src/utils/home-personalization-projection.test.js src/utils/home-personalization-generation.js src/utils/home-personalization-generation.test.js src/utils/home-editorial-session.js src/utils/home-editorial-session.test.js src/components/Home/HomeEditorial.jsx src/components/Home/HomeHighlights.jsx src/components/Home/HomeEditorial.css src/utils/home-editorial-locales.test.js src/locales/de-DE.json src/locales/en-US.json src/locales/es-ES.json src/locales/fr-FR.json src/locales/ja-JP.json src/locales/zh-CN.json scripts/tests/phase2c-editorial-home.jsx scripts/tests/fixtures/phase2c-editorial-home.js
pnpm build
git diff --check
```

### A. Automated / emulated viewport gate

- [ ] Run the existing Phase 2C browser harness plus the Phase 2D suite in light and dark/OLED as applicable at `390×844`, `768×1024`, `884×1104`, `1024×768`, `1280×800`, and `1440×900`. At `884×1104`, explicitly verify Primary dominance, balanced Secondary selection, Recent freshness progression, no overflow, no heading compression, opaque explainer surface, and separation from Liquid Glass. Also verify single-pane behavior, Home return, explicit refresh, star/unstar, read-state mutations, and a late profile. Record viewport, theme, gate, and screenshot evidence.
- [ ] Record `EMULATED_VIEWPORT_GATE=PASS` only after all matrix and retained Phase 2C scenarios pass. This is browser/emulated evidence only and must not be described as physical-device validation.

### B. Exact candidate SHA handoff

- [ ] After code, unit, build, harness, and emulated viewport gates all pass, require a clean worktree, record the exact implementation candidate `HEAD` SHA, and push the implementation branch only to the `jfsdias/NewsFlux` fork. Do not push to `electh/ReactFlux`.
- [ ] Stop functional work after the push and return the exact SHA to PM. Do not deploy implicitly, deploy branch-latest, open a PR, or merge. The handoff must state:

```text
CODE_GATE=PASS
HARNESS_GATE=PASS
EMULATED_VIEWPORT_GATE=PASS
CANDIDATE_SHA=<exact SHA>
READY_FOR_EXACT_SHA_DEPLOY=YES
REAL_DEVICE_GATE=PENDING
```

`READY_FOR_EXACT_SHA_DEPLOY=YES` means only that the candidate is ready for PM review and a separately authorized exact-SHA deployment; it is not deployment approval.

### C. PM-controlled exact-SHA deployment

- [ ] Deploy only after explicit PM authorization naming the exact approved candidate SHA. Implementation-plan execution does not itself authorize deployment. Use the approved NewsFlux deployment governance:

```text
STACK=/dockerdata/compose/newsflux
REPO=/dockerdata/compose/newsflux/repo
CONTAINER=newsflux
IMAGE=newsflux-local:<shortcommit>
NETWORK=npm-proxyyml_default
```

- [ ] Build/run the image from that exact approved commit. Never deploy branch latest or substitute a different SHA. If PM authorization or exact-SHA identity is missing, stop before deployment.

### D. Physical real-device gate

- [ ] After the exact-SHA deployment, validate on physical devices: narrow/mobile single-pane; tablet/Fold opened geometry; dark/OLED; Primary dominance; balanced Secondaries; Recent remains news-like; no horizontal overflow; explainer does not compress the Highlights heading; explainer remains opaque and distinct from Liquid Glass chrome; explainer touch accessibility; star/unstar do not reorder the current generation; reader open/return does not unexpectedly recompose; explicit refresh performs one coherent replacement; and no visible late-profile reshuffle.
- [ ] If a physical device can reproduce `884×1104`, validate that viewport directly. Otherwise keep the exact `884×1104` browser result as emulated evidence and separately validate the closest physical Fold/tablet state; do not conflate the two.
- [ ] Require `REAL_DEVICE_GATE=PASS` before the implementation is considered ready for PR. No merge authorization is implied.

- [ ] Stop and report any failure outside the approved scope. Do not add a code fix during this gate; return it for a separately scoped decision.

## Upstream Gate Note

At PM review time, `electh/ReactFlux` main was revalidated at `0887f714c36cc6c999f8b4559fa14c7948598629`, matching the already-reviewed upstream baseline. No additional upstream reconciliation is currently required before Phase 2D execution. Before a future PR/merge, PM may recheck upstream if its main branch has moved. This is informational governance only; do not modify or sync upstream.

## Acceptance Gate Map

| Contract | Owning task and test |
|---|---|
| `PRIMARY_ALWAYS_NEWEST_ELIGIBLE_UNREAD`; `PHASE2C_BASELINE_PARITY` for zero/no-match/hidden-only; `CANDIDATE_SELF_EXCLUDED_FROM_AFFINITY`; `HIDDEN_FEEDS_EXCLUDED_FROM_PROFILE`; `CURRENT_STAR_DIRECT_SIGNAL`; `SOURCE_AFFINITY_PRECEDES_CATEGORY_AFFINITY`; `FRESHNESS_BOUNDS_PERSONALIZATION`; `DIVERSITY_BOUNDS_PERSONALIZATION`; `STABLE_ENTRY_ID_TIEBREAK` | Task 1 profile tests and Task 2 projection tests; integration parity also in Task 6. |
| `PROFILE_FAILURE_FALLS_BACK`; `PROFILE_TIMEOUT_FALLS_BACK` (canonical deadline miss); `LATE_PROFILE_DOES_NOT_RECOMPOSE`; `STALE_SESSION_PROFILE_DISCARDED`; `STALE_ACCOUNT_PROFILE_DISCARDED`; `NO_PROFILE_RETRY_LOOP`; `EXPLICIT_REFRESH_SINGLE_RECOMPOSITION` | Task 4 generation tests and Task 6 real-route scenarios. |
| `PERSONALIZATION_EXPLAINER_TRUTHFUL`: changed shows; unchanged, available/no-effect, or deadline fallback hides | Task 2 projection tests, Task 5 locale/UI, and Task 6 DOM assertions. |
| `ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION`; `CANONICAL_HOME_QUERY_UNCHANGED`; `NO_SECOND_CANDIDATE_STREAM`; `ALL_UNREAD_UNCHANGED`; `STAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION`; `UNSTAR_DOES_NOT_RECOMPOSE_CURRENT_SESSION` | Task 6 request-count and Phase 2C regression scenarios. |
| All applicable Phase 2C Home, count, mutation, pagination, reader-return, and stale-session gates | Task 6 and Task 7. |
| Six viewport sizes, light/dark-OLED, critical `884×1104`, accessible opaque explanation, and unchanged single-pane behavior | Task 6 and Task 7A automated/emulated matrix; physical validation is a separate Task 7D gate after exact-SHA deployment. |

## Plan Self-Review

- **Spec coverage:** Every acceptance criterion and required behavioral gate is assigned to Tasks 1–7 in the gate map.
- **Step scan:** Every functional task starts with a failing test and exact command, defines the minimal code change, gives its passing command, and ends in a focused commit. Task 7 is verification-only.
- **Interface consistency:** The profile, projection, generation, and session interfaces are explicit. The existing canonical request and API helper remain the source of candidate and profile data respectively.
- **Review Focus:** Exactly five high-risk cases are listed; each maps to an owning test in Tasks 1, 2, 4, 5, or 6.
- **Proportion:** The plan adds only a transient profile, constrained Home projection, generation guard, accessible explanation, and regression coverage. It leaves cards, All/Unread, APIs, auth, routes, mutations, settings, and global layout untouched.
- **Calibration/privacy:** `N` and the freshness window remain unset. There are exactly two calibration values; PM approval blocks all functional tasks. No third calibration gate, hidden category rule, weighted score, persistence, telemetry, or late recomposition is introduced.
- **Freshness grouping:** The anchor-based algorithm is deterministic, boundary-inclusive, non-transitive, and covered by the anti-chaining and invalid-timestamp tests; the numeric window remains a PM calibration value.
- **Release governance:** Automated/emulated evidence is distinct from the physical real-device gate; candidate SHA handoff precedes any PM-authorized exact-SHA deployment; no PR or merge is authorized by this plan.
- **Upstream:** The revalidated upstream SHA is informational; no upstream sync or write is part of this plan.
