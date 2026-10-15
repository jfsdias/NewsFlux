# NewsFlux Roadmap

- **Status:** reconciled canonical roadmap candidate; UX/UI red-team round 2 incorporated; ready for documentation PR review.
- **Created:** 2026-10-15.
- **Reconciled against:** `main` at `14bc2646e66e972c54beee924d1200f68c730b44`.
- **Purpose:** keep product direction, execution order, architectural holds, and backlog in one place.

This document is the canonical **roadmap**, not an implementation authorization. Detailed visual decisions remain in `NEWSFLUX_DESIGN_DIRECTION_V1.md`, `NEWSFLUX_HOME_VISUAL_01.md`, and `NEWSFLUX_READER_VISUAL_01.md`. Implementation plans remain in `docs/superpowers/plans/`.

No roadmap item may bypass project governance: one identifiable purpose per PR, no merge without explicit user authorization, no implicit upstream sync, no redesign mixed with functional work, and no new persistent state without an explicit source-of-truth decision.

---

## 1. Product north star

NewsFlux is a consciously maintained ReactFlux fork for Miniflux. The product direction is:

- **editorial rather than dashboard-like**;
- **OLED-aware**, with restrained near-black surfaces rather than indiscriminate absolute black;
- **predictable for RSS workflows**, especially All/Unread/feed/category scopes;
- **single-pane-first** on phone, tablet, and foldable layouts;
- **focused in the reader**, with content remaining opaque and chrome carrying any glass treatment;
- **selectively synchronized with ReactFlux upstream**, preserving functional correctness without surrendering NewsFlux product identity;
- **deterministic before intelligent**, especially for personalization and ranking;
- **provider-aware**, with Miniflux remaining the source of truth for feeds, categories, read/unread, and starred state.

### Non-negotiable behavior boundaries

- Do not introduce silent ranking into **All** or **Unread**.
- Do not make a permanent three-pane layout the default product architecture.
- Do not use translucent/glass content cards or reader surfaces.
- Do not create `Later`, `Bookmarks`, `Boards`, tags, or another persistent saved state until storage/sync/privacy are explicitly decided.
- Do not conflate Miniflux `starred` with a new persistent state.
- Do not broaden a PR because an adjacent file is already open.

---

## 2. Reference-product interpretation

Reference products are inputs, not a checklist.

| Reference | Learn from | Do not copy blindly |
| --- | --- | --- |
| Apple News | Editorial hierarchy, focused reading, refresh expectations, touch-first chrome | Opaque ranking, subscription assumptions |
| NetNewsWire | RSS clarity, source organization, next-unread flow, keyboard-driven triage | Permanent three-pane architecture |
| Fusion | Predictable navigation state, URL-backed reader state | Provider/state semantics that conflict with Miniflux |
| Feedly | Scoped mark-as-read undo, multi-select triage | Paid/AI assumptions, premature Boards |
| Inoreader | Explicit search/filter state, tags/library concepts | Complex IA before storage architecture exists |
| NewsBlur | Per-feed preferences, explicit user relevance controls | Learned relevance in All/Unread |
| ReadKit / Reeder | Saved-state taxonomy and smart-folder ideas | New state without a defined source of truth |

Current decisions from the red-team review:

- **ADOPT:** multi-select; mark-selected-as-read; keyboard navigation expansion.
- **ADAPT:** Favorites as Miniflux `starred`; density control using existing local settings.
- **HOLD:** Saved umbrella, Read Later, Bookmarks, Boards, Tags, Smart folders, per-feed layout, swipe-save, user relevance rules, story clustering.

---

## 3. Status vocabulary

- **COMPLETED** — merged and validated.
- **IN PROGRESS** — active implementation or validation track.
- **NEXT** — accepted high-priority target; may still carry an explicit decision gate.
- **PLANNED** — accepted and ordered later.
- **HOLD — ARCHITECTURE** — blocked on product/storage/sync/privacy/source-of-truth architecture.
- **BACKLOG** — accepted but not ordered.
- **BASELINE / ONGOING** — maintenance state, not a feature phase.

---

## 4. Current product state

### 4.1 Completed design and product phases

| Item | Status | Notes |
| --- | --- | --- |
| Phase 1 | **COMPLETED** | Single-pane foundation |
| Phase 2A | **COMPLETED** | Full-width browsing |
| Phase 2B / 2B.1 | **COMPLETED** | Editorial cards + content intelligence |
| Phase 2B.2A | **COMPLETED** | OLED visual foundation |
| Phase 2B.2B | **COMPLETED** | Liquid Glass chrome + article scroll underlay |
| Phase 2B.2C | **COMPLETED** | Rounded cards, text-only treatment, read-state polish |
| Phase 2C | **COMPLETED** | Editorial Home |
| Phase 2D V1 | **COMPLETED** | Deterministic Home personalization |
| NAV-02 | **COMPLETED** | Unread-first source navigation |
| HOME-VISUAL-01 | **COMPLETED** | Primary hierarchy refinement |
| READER-VISUAL-01 | **COMPLETED** | Reading ergonomics refinement |
| UX/UI red-team round 2 | **COMPLETED** | Verdict `GOOD_WITH_DEBT`: 0 P0, 3 P1, 13 P2, 8 P3. Broad audit on `401d949`; mark-all/undo delta re-probed on `14bc264` |

### 4.2 Functional behavior and defect tracks

| Item | Status | Priority / dependency | Notes |
| --- | --- | --- | --- |
| BULK-01 — Footer Mark All Read Undo | **COMPLETED** | PR #20 | One-shot 8 s undo; repeated-operation behavior validated |
| BULK-01F — footer focus return | **NEXT** | R2-08, P2 | After confirm, return focus to Mark-all/list/Undo; must not land on Starred radio |
| BULK-01C — scoped undo copy | **PLANNED** | R2-09, product copy decision | Name the affected scope/count; optional restored confirmation |
| BULK-01B — Sidebar context Mark All | **NEXT** | R2-01, **P1** | Unify confirmation + undo contract for feed/category context actions; dedicated PR |
| FILTER-01A — search scope rules | **NEXT** | R2-02, **P1**, product decision required | Decide: reset search on scope change vs explicit persistent/global search with visible removable chip |
| FILTER-01B — date/status filter behavior | **PLANNED** | After FILTER-01A | Define visible scoped state and transition matrix |
| BULK-02 — Multi-select | **PLANNED** | Blocked by BULK-01B + FILTER-01A | Explicit Select mode; visible-only/session selection; mark selected read; Undo always |
| READER-KEY-01 — layered Escape | **NEXT** | R2-05, P2 | Escape closes topmost menu/popover before reader |
| STATE-ERR-01 — unavailable entry route | **NEXT** | R2-06, P2, copy/behavior decision | Explicit unavailable state or safe redirect with feedback |
| CONTENT-01 — untitled entry fallback | **NEXT** | R2-07, P2, fallback-copy decision | Preserve accessible name and unread cue for untitled/microblog entries |
| HOME-01 — refresh/focus/reconnect | **PLANNED** | R2-12 | Refresh must not reshuffle an active Phase 2D session unexpectedly |
| NAV01 — reader previous/next + next unread | **PLANNED** | R2-14 | Preserve canonical originating-scope order and Miniflux counts |
| NAV-02F — navigation follow-ups | **PLANNED** | R2-13/R2-17/R2-18, product decisions | Long source names, optional Unread grouping, mode persistence semantics |

### 4.3 Accessibility and interaction foundation

| Item | Status | Notes |
| --- | --- | --- |
| A11Y-RT-01 — reduced transparency dark-mode fix | **NEXT** | R2-04; CSS specificity bug; no product decision required |
| A11Y-01 — landmarks / heading / skip navigation | **NEXT** | R2-03, **P1**; add `<main>`, named navigation, one h1 per view, reader heading hierarchy, skip link; re-run harness selectors |
| Keyboard/touch parity | **PLANNED** | R2-05/R2-11/R2-16; touch hit areas >=44 px while visual icon size may remain smaller |
| READER-MEDIA-01 | **PLANNED** | R2-15/R2-19; iframe border is CSS-only, edge-to-edge image scaling requires real-device gate |
| READER-MEASURE-01 | **BACKLOG** | R2-22/R2-23/R2-24; width minimum, phone width-setting semantics, left-aligned title geometry |

### 4.4 Home / presentation debt

| Item | Status | Notes |
| --- | --- | --- |
| HOME-SKEL-01 | **BACKLOG** | R2-20/R2-21; skeleton hierarchy parity + Recent text-only/content-box measurement |
| Home editorial hierarchy | **ACCEPTED** | Primary/secondary hierarchy holds; Latest remains intentionally more chronological/dashboard-like than Highlights |

### 4.5 Identity / distribution

| Item | Status | Notes |
| --- | --- | --- |
| ID-01R — repository/document identity | **COMPLETED** | PR #21 merged; docs/provenance reconciled |
| ID-RUNTIME-01 — visible runtime identity | **NEXT** | R2-10; visible product name, update check, About and issue links must target NewsFlux; upstream credit remains |
| GitHub metadata | **NEXT** | Description/homepage/topics remain a separate metadata write, not hidden in runtime/docs work |
| ID-DEPLOY-01 — distribution identity | **HOLD — ARCHITECTURE** | Choose local-build vs registry/deployer contract before changing checked-in distribution assumptions |

### 4.6 Upstream maintenance

| Item | Status | Notes |
| --- | --- | --- |
| Selective upstream maintenance model | **ONGOING** | Never blindly merge or sync upstream main |
| Last formally reviewed upstream | **BASELINE** | `0887f714c36cc6c999f8b4559fa14c7948598629` until the specialized upstream monitor advances it |
| Current observed upstream head | **AUDIT PENDING** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`; observation is not a reviewed baseline |
| New upstream drift audit | **NEXT** | Specialized monitor classifies each commit/group as INTEGRATE / ADAPT / SKIP / HOLD before any sync PR |

### 4.7 Personalization

| Item | Status | Notes |
| --- | --- | --- |
| Phase 2D V1 deterministic Home personalization | **COMPLETED** | Home-only; All/Unread remain predictable |
| Phase 2D V2 signal expansion | **PLANNED** | Deterministic signals only until architecture is proven |
| Story clustering | **HOLD — ARCHITECTURE** | After Personalization V2; Home only and opt-in if adopted |
| User-controlled relevance | **HOLD — ARCHITECTURE** | Requires rule storage and explicit user-visible behavior; never silently rank All/Unread |
| ML ranking | **HOLD — ARCHITECTURE** | Only after deterministic behavior, privacy, explainability, and storage/source-of-truth decisions |

### 4.8 Saved states / collections

| Item | Status | Notes |
| --- | --- | --- |
| Favorites | **ADAPT** | Treat as Miniflux `starred`; no separate persistent state |
| Saved umbrella/library | **HOLD — ARCHITECTURE** | No source of truth exists beyond current provider-backed starred state |
| Later / Read Later | **HOLD — ARCHITECTURE** | Must not reuse `starred`; requires durable queue semantics |
| Bookmarks | **HOLD — ARCHITECTURE** | Reject if semantically identical to starred; otherwise needs storage |
| Boards / collections | **HOLD — ARCHITECTURE** | Requires storage, ownership, privacy, export |
| Tags | **HOLD — ARCHITECTURE** | Verify writable Miniflux tag capability before designing NewsFlux-local state |
| Smart folders / saved searches | **HOLD — ARCHITECTURE** | Depends on FILTER-01 rules and saved-filter storage decision |
| Per-feed layout | **HOLD — ARCHITECTURE** | Decide per-scope preference source/sync after NAV-02F |
| Swipe-save | **HOLD — ARCHITECTURE** | Requires a defined save target and Fold gesture-conflict decision |

---

## 5. Red-team round 2 accepted findings

The red-team review found no P0 issues. The accepted P1 findings are:

1. **R2-01 / BULK-01B:** sidebar feed/category Mark all as read has no confirmation and no undo.
2. **R2-02 / FILTER-01A:** search silently carries across scopes without a visible scoped-state affordance.
3. **R2-03 / A11Y-01:** global shell lacks main landmark, h1 hierarchy and skip navigation; reader title is semantically too low.

High-value P2 work accepted into the roadmap:

- R2-04 reduced-transparency dark-mode specificity;
- R2-05 layered Escape behavior;
- R2-06 dead entry route feedback;
- R2-07 untitled entry fallback/accessibility;
- R2-08 mark-all focus return;
- R2-09 scoped undo wording;
- R2-10 runtime identity still routing to upstream ReactFlux;
- R2-11 touch target size;
- R2-12 Home refresh;
- R2-13 source-name truncation;
- R2-14 next-unread flow;
- R2-15 edge-to-edge reader image scaling;
- R2-16 category keyboard tab-stop follow-up (re-check before fixing).

P3 debt is retained under NAV-02F, HOME-SKEL-01 and READER-MEASURE-01 rather than implemented incidentally.

---

## 6. Recommended execution order

Priority and readiness are separate. A blocked P1 must not cause unrelated deterministic fixes to be folded into the same PR.

**Read-only work can run in parallel:** formal upstream drift audit from reviewed baseline `0887f714...` through observed head `3045a5f...`. No sync follows automatically.

Ordered implementation tracks:

1. **A11Y-RT-01** — isolated CSS accessibility correction.
2. **BULK-01F** — isolated footer focus-return correction.
3. **BULK-01B** — P1 sidebar confirmation/undo contract.
4. **ID-RUNTIME-01** — stop runtime update/issue flows from pointing users at upstream; keep upstream credit.
5. **A11Y-01** — P1 landmarks/headings/skip navigation.
6. **FILTER-01A** — P1, but only after explicit product choice: reset-on-scope-change vs visible persistent/global search.
7. **READER-KEY-01**, **STATE-ERR-01**, **CONTENT-01** — separate bugfix PRs; do not batch merely because they are small.
8. **HOME-01**, **NAV01**, **Keyboard/touch parity** — separate functional/interaction tracks.
9. **READER-MEDIA-01** — real-device gate required for edge-to-edge media behavior.
10. **FILTER-01B** — after search-scope semantics are settled.
11. **BULK-02** — only after BULK-01B + FILTER-01A; selection clears on route/scope/search/filter transition; no cross-page select-all; Undo always.
12. **NAV-02F**, **HOME-SKEL-01**, **READER-MEASURE-01**.
13. **ID-DEPLOY-01** after distribution architecture decision.
14. **Saved-state work** only after storage/sync/privacy/source-of-truth decisions.
15. **Personalization V2**.
16. **ML ranking** last.

`BULK-01C` may be scheduled once the copy decision is made, but it must remain a scoped footer-undo follow-up and not expand BULK-01B.

---

## 7. Product decisions required before implementation

### FILTER-01A
Choose one contract:

- **scope-local search:** clear search when scope changes; or
- **persistent/global search:** keep the query but expose it as a visible removable chip/filter state in the destination scope.

Do not implement BULK-02 until this is decided because “selected visible set” depends on a defined filtered scope.

### STATE-ERR-01
Choose the unavailable-entry contract:

- stay on the URL and show an explicit unavailable state with a route back; or
- redirect to the originating/default scope and show feedback.

### CONTENT-01
Define deterministic fallback text for untitled entries, preferably from cleaned summary/body lead and then source/time if needed. The accessible name and unread cue must never be empty.

### NAV-02F
Decide whether Unread source mode remains flat or gains optional grouping, whether desktop sidebar width may increase, and whether `showUnreadFeedsOnly` should remain persistent or become session-only.

### READER-MEASURE-01
Decide whether Article width 50 may have a CSS minimum prose measure and whether the width setting should affect phone layouts.

---

## 8. Architecture decisions required before saved-state work

Before implementing Later, Bookmarks, Boards, Tags, Saved umbrella, Smart folders, swipe-save, per-feed layout sync, or explicit relevance rules, answer:

1. **Source of truth:** Miniflux, NewsFlux-local, another service, or a defined hybrid?
2. **Sync:** single-device vs multi-device, conflict model, offline behavior.
3. **Privacy:** what behavioral/content metadata is stored and where?
4. **Identity:** how entries remain referentially stable across feed deletion or server changes.
5. **Export/portability:** how durable user collections can be migrated/recovered.
6. **Failure semantics:** how provider and NewsFlux-local partial failures reconcile.
7. **Relationship to Miniflux state:** especially `starred`, read/unread, feeds, categories, and History.

Until these are answered, those items remain HOLD.

---

## 9. BULK-02 contract

Before implementation, BULK-02 must preserve:

- explicit Select entry point;
- selection cleared on route, scope, search, or filter change;
- no select-all across unloaded/load-more pages;
- session-only selection state;
- acknowledged-ID mutation model;
- partial-failure reconciliation;
- stale-session protection;
- count refresh/current-list invalidation;
- one-shot Undo;
- keyboard and screen-reader semantics;
- mobile/Fold interaction without permanent clutter;
- batching/performance gates.

Preferred interaction from red-team: checkbox per selected row plus a bottom action bar showing count and actions such as `Mark N read`; long-press and keyboard entry may be added only with discoverable parity.

---

## 10. Definition of ready

An item should not enter implementation until it has:

- one-sentence user/problem outcome;
- explicit in-scope and out-of-scope boundaries;
- source-of-truth decision where state is involved;
- dependency/order declaration;
- acceptance gates;
- regression surfaces;
- browser/real-device gate where relevant;
- dedicated branch/PR plan.

A red-team finding being accepted into this roadmap does **not** itself authorize implementation or merge.

---

## 11. Governance invariants

- **No merge without explicit user authorization.**
- **No implicit deployment of `latest`; deploy exact approved SHA only.**
- **No upstream sync mixed with design or feature work.**
- **No design work mixed with unrelated functional fixes.**
- **Incidental findings are routed to roadmap/backlog.**
- **Miniflux remains source of truth for feeds, categories, read/unread, and starred.**
- **New persistent state requires an explicit architecture decision.**
- **All/Unread remain chronological and predictable.**
- **Glass is chrome; content remains opaque.**
- **Mobile/tablet/Fold remain single-pane-first.**

---

## 12. Roadmap promotion state

UX/UI red-team round 2 has been completed and reconciled into this document. The previous red-team HOLD is therefore cleared.

Promotion sequence from here:

1. PM reconciliation — **COMPLETED in this branch candidate**;
2. verify diff is documentation-only and based on current `main`;
3. open a dedicated documentation PR;
4. **do not merge without explicit user authorization**.

The roadmap should thereafter be updated when a phase closes, a major finding is accepted/rejected, or an architectural decision changes sequencing.
