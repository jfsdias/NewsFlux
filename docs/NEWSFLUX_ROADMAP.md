# NewsFlux Roadmap

- **Status:** reconciled canonical roadmap candidate; UX/UI red-team round 2, provider-backed opportunity review, and visual-cohesion supplement incorporated; ready for documentation PR review.
- **Created:** 2026-10-15.
- **Reconciled against:** `main` at `14bc2646e66e972c54beee924d1200f68c730b44`.
- **Purpose:** keep product direction, execution order, provider-backed opportunities, visual-cohesion packages, architecture/product holds, and backlog in one place.

This document is the canonical **roadmap**, not an implementation authorization. Detailed visual decisions remain in `NEWSFLUX_DESIGN_DIRECTION_V1.md`, `NEWSFLUX_HOME_VISUAL_01.md`, and `NEWSFLUX_READER_VISUAL_01.md`. Implementation plans remain in `docs/superpowers/plans/`.

No roadmap item may bypass project governance: one identifiable purpose per PR, no merge without explicit user authorization, no implicit upstream sync, no redesign mixed with functional work, and no new persistent NewsFlux state without an explicit source-of-truth decision.

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
- **provider-aware**, preferring Miniflux-backed state/capabilities over NewsFlux-owned persistence where that produces a coherent product contract;
- **cohesive before decorative**: Home, lists, Reader and chrome should share one editorial visual language without adding gratuitous controls or effects.

### Non-negotiable behavior boundaries

- Do not introduce silent ranking into **All** or **Unread**.
- Do not make a permanent three-pane layout the default product architecture.
- Do not use translucent/glass content cards or reader surfaces.
- Do not create a NewsFlux-owned `Later`, `Bookmarks`, `Boards`, tags, or another persistent saved state until storage/sync/privacy are explicitly decided.
- Do not conflate Miniflux `starred` with a new persistent state.
- Provider-backed features may advance without new NewsFlux storage only when ownership, limitations, and failure semantics are explicit.
- Do not broaden a PR because an adjacent file is already open.
- Visual packages may be decomposed into independently testable PRs; a package name is not permission to batch unrelated CSS, behavior and navigation changes.

---

## 2. Reference-product interpretation

Reference products are inputs, not a checklist.

| Reference | Learn from | Do not copy blindly |
| --- | --- | --- |
| Apple News | Editorial rhythm, edition header, focused reading, clear end states, touch-first chrome | Oversized promotional imagery, ad-like blocks, opaque ranking |
| NetNewsWire | RSS clarity, source organization, redundant read-state cues, next-unread flow, keyboard-driven triage | Permanent three-pane architecture |
| Fusion | Predictable navigation state, URL-backed reader state | Provider/state semantics that conflict with Miniflux |
| Feedly | Scoped mark-as-read undo, multi-select/range triage, compact action feedback | Toolbar proliferation, paid/AI assumptions, premature Boards |
| Inoreader | Explicit search/filter state, rules, tags/library concepts | Dashboard-heavy IA and too many simultaneous controls |
| NewsBlur | Per-feed preferences, explicit user rules/relevance controls | Learned relevance in All/Unread and excessive visual density |
| ReadKit / Reeder | External read-later handoff, list/reader continuity, progress, typography, saved-state taxonomy | New internal state without a defined source of truth |
| Material 3 | Adaptive navigation patterns, verb-first confirmations, snackbar behavior, container transitions | Adaptive navigation without a Fold/device decision and real-device evidence |

Current decisions:

- **ADOPT:** multi-select; mark-selected-as-read; keyboard navigation expansion; provider-backed range mark-as-read; visible feed-health signaling; stronger list/read-state redundancy; editorial typography/details that do not alter behavior.
- **ADAPT:** Favorites as Miniflux `starred`; density control using existing local settings; Miniflux block/keep rules; external-save/read-later handoff through Miniflux integrations; category rhythm on Home; Material-style confirmations/snackbars only where they preserve NewsFlux scope semantics.
- **PLANNED WITH PRODUCT DECISION:** HOME-VISUAL-02 composition; FILTER-01A search contract; NAV-VISUAL-01 adaptive navigation; contextual chrome consolidation.
- **HOLD:** NewsFlux-owned Saved umbrella, internal Read Later queue, internal Bookmarks, Boards, Tags, Smart folders, per-feed layout sync, swipe-save to an undefined target, story clustering, ML.
- **DO NOT COPY:** Apple News ad-like blocks/oversized imagery; Feedly/Inoreader toolbar density; NewsBlur visual density; glass over content; permanent three-pane UI; algorithmic For You outside Home.

---

## 3. Status vocabulary

- **COMPLETED** — merged and validated.
- **IN PROGRESS** — active implementation or validation track.
- **NEXT** — accepted high-priority target; may still carry an explicit decision gate.
- **PLANNED** — accepted and ordered later.
- **HOLD — PRODUCT** — technically feasible but blocked on explicit product semantics/copy/interaction choice.
- **HOLD — ARCHITECTURE** — blocked on storage/sync/privacy/source-of-truth architecture.
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
| UX/UI red-team round 2 | **COMPLETED** | `GOOD_WITH_DEBT`: 0 P0, 3 P1, 13 P2, 8 P3; broad audit on `401d949`, mark-all/undo re-probed on `14bc264` |

### 4.2 Functional behavior and defect tracks

| Item | Status | Priority / dependency | Notes |
| --- | --- | --- | --- |
| BULK-01 — Footer Mark All Read Undo | **COMPLETED** | PR #20 | One-shot 8 s undo; repeated-operation behavior validated |
| BULK-01F — footer focus return | **NEXT** | R2-08, P2 | After confirm, focus must not land on Starred radio |
| BULK-01C — scoped undo copy | **PLANNED** | R2-09, product copy decision | Name affected scope/count; optional restored confirmation |
| BULK-01B — Sidebar context Mark All | **NEXT** | R2-01, **P1** | Unify confirmation + undo contract for feed/category context actions; dedicated PR |
| BULK-03 — range/age mark-as-read | **PLANNED** | Provider-backed; after BULK-01B, before or alongside BULK-02 | Mark above/below current entry and optionally items older than X; Miniflux remains source of truth; reuse acknowledged-ID batching, partial-failure reconciliation and Undo |
| FILTER-01A — search scope rules | **NEXT** | R2-02, **P1**, product decision required | Decide reset-on-scope-change vs visible persistent/global search chip |
| FILTER-01B — date/status filter behavior | **PLANNED** | After FILTER-01A | Define visible scoped state and transition matrix |
| FILTER-RULES-01 — provider-backed block/keep rules | **PLANNED** | After FILTER-01; no NewsFlux persistence | Expose Miniflux per-feed `blocklist_rules` / `keeplist_rules`; product spec must decide simple keyword UX vs advanced rule editor |
| BULK-02 — Multi-select | **PLANNED** | Blocked by BULK-01B + FILTER-01A | Explicit Select mode; visible-only/session selection; mark selected read; Undo always |
| READER-KEY-01 — layered Escape | **NEXT** | R2-05, P2 | Escape closes topmost menu/popover before reader |
| STATE-ERR-01 — unavailable entry route | **NEXT** | R2-06, P2, copy/behavior decision | Explicit unavailable state or safe redirect with feedback |
| CONTENT-01 — untitled entry fallback | **NEXT** | R2-07, P2, fallback-copy decision | Preserve accessible name and unread cue for untitled/microblog entries |
| HOME-01 — refresh/focus/reconnect | **PLANNED** | R2-12 | Refresh must not reshuffle an active Phase 2D session unexpectedly; pull-to-refresh may be specified here for touch devices |
| NAV01 — reader previous/next + next unread | **PLANNED** | R2-14 / B2 | Preserve canonical originating-scope order; after clearing a source, offer next unread source using Miniflux counts |
| NAV-02F — navigation follow-ups | **PLANNED** | R2-13/R2-17/R2-18, product decisions | Long source names, optional Unread grouping, mode persistence semantics |
| FEED-HEALTH-01 — visible feed health | **PLANNED** | Provider-backed; schedule near NAV-02F | Surface Miniflux `parsing_error_count`/feed error state in sidebar and feed header; keep separate from navigation semantics |

### 4.3 Accessibility and interaction foundation

| Item | Status | Notes |
| --- | --- | --- |
| A11Y-RT-01 — reduced transparency dark-mode fix | **NEXT** | R2-04; CSS specificity bug; no product decision required |
| A11Y-01 — landmarks / heading / skip navigation | **NEXT** | R2-03, **P1**; `<main>`, named navigation, one h1 per view, reader heading hierarchy, skip link; re-run harness selectors |
| Keyboard/touch parity | **PLANNED** | R2-05/R2-11/R2-16; touch hit areas >=44 px while visual icon size may remain smaller |
| SWIPE-ENTRY-01 — swipe read/star | **BACKLOG** | Miniflux-backed; real-device gate mandatory because Fold/back gestures may conflict |
| READER-MEDIA-01 | **PLANNED** | R2-15/R2-19; iframe border CSS-only, edge-to-edge image scaling needs real-device gate |
| READER-MEASURE-01 | **BACKLOG** | R2-22/R2-23/R2-24; width minimum, phone semantics, left-aligned title geometry |
| READER-PROGRESS-01 | **BACKLOG** | Stateless reading progress / time remaining only; do not persist reading position without a storage decision |
| READER-PRESETS-01 | **BACKLOG** | Group existing local typography/width/theme settings into understandable presets after READER-MEASURE-01 |

### 4.4 Visual-cohesion packages

These are umbrella packages for sequencing. Each may be split into smaller dedicated PRs when behavior, real-device validation, or product decisions differ.

| Package | Status | Scope | Dependency / gate |
| --- | --- | --- | --- |
| **LIST-VISUAL-01** | **NEXT** | Redundant read state (dot + weight + secondary text), shared Home/list secondary-row language, explicit unread-count labels, favicon fallback monograms, source kicker consistency | Mostly CSS + small JSX; no new state; verify All/Unread chronology and text-only/untitled cases |
| **CHROME-01** | **PLANNED** | Verb-first confirmations, bottom reachable snackbar, NewsFlux-token styling for raw Arco controls; investigate glass only when content actually passes beneath chrome | Split behavior from visual tokens; scroll-aware glass and snackbar movement require interaction/device validation; no glass over content |
| **HOME-VISUAL-02** | **HOLD — PRODUCT** | Edition header, deterministic category sections, alternating section formats, compact text-only Summary, explicit “caught up” end state | Requires HOME-01 for trustworthy “updated ago”; decide category/Latest relationship; real-device gate at 884×1104 |
| **READER-VISUAL-02** | **PLANNED** | Source kicker → title → author/date/reading-time hierarchy, hero alignment, blockquote/caption/link typography, stateless progress; later auto-hide chrome and “Next” card | CSS-only subset may advance independently; auto-hide requires reduced-motion/focus behavior; “Next” card depends on NAV01 |
| **NAV-VISUAL-01** | **HOLD — PRODUCT** | Stronger smart-feed grouping and counts; evaluate Material 3 adaptive bottom bar / rail / drawer without creating a second pane | Adaptive navigation needs explicit product decision + real Fold/884×1104 gate; do not mix with NAV01 functional ordering |
| **MOTION-01** | **BACKLOG** | Card → Reader View Transition/container transform with reduced-motion fallback | Last among visual packages; performance + real-device gate required |

#### LIST-VISUAL-01 contract

- Read/unread must be distinguishable by more than color alone.
- List rows should visually rhyme with Home secondary stories without becoming Home cards.
- Titles remain at most two lines where the existing list density requires it.
- Metadata uses a stable `source · time` pattern where appropriate.
- Thumbnail treatment should remain compact and consistent; a 4:3 trailing thumbnail is a candidate where the existing layout permits it.
- Unread counts should be human-readable labels where space permits (for example `18 unread`) rather than technical parenthetical counters.
- Missing favicons may use deterministic visual monograms; do not invent persistent per-feed styling state.
- Untitled entries must remain covered by CONTENT-01 and accessible fallback semantics.

#### CHROME-01 contract

- Prefer verb-first destructive confirmations such as `Mark 18 as read` / `Cancel` over generic `OK` / `Cancel`.
- Keep Undo reachable on touch devices; a single bottom snackbar is the preferred direction, but behavior must remain one-at-a-time and generation-safe.
- Raw Arco date selectors, popconfirms and notifications should be restyled using NewsFlux tokens instead of introducing a parallel component system.
- “Glass only when content passes beneath” is a candidate refinement, not authorization to add more blur. At page top, opaque chrome is acceptable; any transition must preserve reduced-transparency behavior.
- Do not consolidate header/footer controls into one contextual bar without a separate product decision; this is a larger information-architecture change.

#### HOME-VISUAL-02 contract

- Candidate edition header: date + new-story count + trustworthy refresh recency + refresh affordance.
- Candidate rhythm: lead/secondary section, category sections, then compact text-only Summary instead of one uniform grid.
- Candidate source kicker should be standardized across Home card types.
- Candidate end state: explicit `You’re caught up` / next-action treatment instead of an empty tail.
- All composition remains deterministic and Home-only; no effect on All/Unread order.

#### READER-VISUAL-02 contract

- Header hierarchy: source kicker → title → author/date/reading-time metadata → hero/content frame.
- Typography: blockquotes with restrained inset/rule, captions as secondary text, links clearly underlined with comfortable underline offset.
- Stateless reading progress is allowed; persisted reading position remains architecture-gated.
- Auto-hide reader chrome is a later subtrack: it must return on upward scroll/focus, respect `prefers-reduced-motion`, and never hide critical keyboard controls.
- `Next` card is a later subtrack dependent on NAV01 canonical ordering.

### 4.5 Home / presentation

| Item | Status | Notes |
| --- | --- | --- |
| HOME-SKEL-01 | **BACKLOG** | R2-20/R2-21; skeleton hierarchy parity + Recent text-only/content-box measurement |
| HOME-VISUAL-02 | **HOLD — PRODUCT** | Expanded visual package above; deterministic Home-only rhythm; category/Latest semantics still require decision |
| Home editorial hierarchy | **ACCEPTED** | Primary/secondary hierarchy holds; Latest remains intentionally more chronological than Highlights until HOME-VISUAL-02 is decided |

### 4.6 Identity / distribution

| Item | Status | Notes |
| --- | --- | --- |
| ID-01R — repository/document identity | **COMPLETED** | PR #21 merged; docs/provenance reconciled |
| ID-RUNTIME-01 — visible runtime identity | **NEXT** | R2-10; product name, update check, About and issue links must target NewsFlux; upstream credit remains; include NewsFlux logo surfaces where technically appropriate |
| GitHub metadata | **NEXT** | Description/homepage/topics remain a separate metadata write |
| ID-DEPLOY-01 — distribution identity | **HOLD — ARCHITECTURE** | Choose local-build vs registry/deployer contract before changing checked-in distribution assumptions |
| APP-BADGE-01 — unread app badge | **BACKLOG** | After ID-DEPLOY; use Miniflux unread counts, gated by browser/PWA capability |
| THEME-CHROME-01 — browser/PWA surface color | **BACKLOG** | Align `theme-color` and installable-app chrome with NewsFlux OLED/light surfaces without changing content surfaces |

### 4.7 Upstream maintenance

| Item | Status | Notes |
| --- | --- | --- |
| Selective upstream maintenance model | **ONGOING** | Never blindly merge or sync upstream main |
| Last formally reviewed upstream | **BASELINE** | `0887f714c36cc6c999f8b4559fa14c7948598629` until the specialized upstream monitor advances it |
| Current observed upstream head | **AUDIT PENDING** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`; observation is not a reviewed baseline |
| New upstream drift audit | **NEXT** | Specialized monitor classifies each commit/group as INTEGRATE / ADAPT / SKIP / HOLD before any sync PR |

### 4.8 Personalization and explicit rules

| Item | Status | Notes |
| --- | --- | --- |
| Phase 2D V1 deterministic Home personalization | **COMPLETED** | Home-only; All/Unread remain predictable |
| FILTER-RULES-01 provider-backed rules | **PLANNED** | Explicit user-authored Miniflux rules are preferred over learned relevance for filtering/muting |
| Phase 2D V2 signal expansion | **PLANNED** | Deterministic signals only until architecture is proven |
| Story clustering | **HOLD — ARCHITECTURE** | After Personalization V2; Home only and opt-in if adopted |
| User-controlled learned relevance | **HOLD — ARCHITECTURE** | Distinct from Miniflux rules; requires separate source-of-truth/privacy decision |
| ML ranking | **HOLD — ARCHITECTURE** | Only after deterministic behavior, privacy, explainability, and storage/source-of-truth decisions |

### 4.9 Saved states / external save

| Item | Status | Notes |
| --- | --- | --- |
| Favorites | **ADAPT** | Treat as Miniflux `starred`; no separate persistent state |
| SAVE-EXT-01 — external save / read-later handoff | **PLANNED** | Existing NewsFlux action posts to Miniflux `/v1/entries/{id}/save` when an integration is enabled; destination may be Wallabag/Instapaper/Readwise/etc. Product copy must say this is an external handoff, not a NewsFlux library |
| Internal Later / Read Later | **HOLD — ARCHITECTURE** | Still requires a durable queue only if NewsFlux must list/sync/undo/manage saved items itself; do not silently map it to `starred` |
| Saved umbrella/library | **HOLD — ARCHITECTURE** | No coherent first-party library source of truth yet |
| Bookmarks | **HOLD — ARCHITECTURE** | Reject if semantically identical to starred; otherwise needs storage |
| Boards / collections | **HOLD — ARCHITECTURE** | Requires storage, ownership, privacy, export |
| Tags | **HOLD — ARCHITECTURE** | Separate decision; do not infer a first-party tag library from feed block/keep rules |
| Smart folders / saved searches | **HOLD — ARCHITECTURE** | Depends on FILTER-01 rules and saved-filter storage decision |
| Per-feed layout | **HOLD — ARCHITECTURE** | Decide per-scope preference source/sync after NAV-02F |
| Swipe-save | **HOLD — ARCHITECTURE** | External-save target is possible, but gesture semantics and Fold conflicts must be decided before adoption |

### 4.10 Provider-backed capability inventory

The following opportunities do **not** require new persistent NewsFlux state:

| Item | Source of truth | Current capability / gap | Roadmap handling |
| --- | --- | --- | --- |
| BULK-03 range/age mark-as-read | Miniflux read state | NewsFlux already has batch ID mutation + Undo primitives; range semantics are new | **PLANNED**, before/alongside BULK-02 |
| FEED-HEALTH-01 | Miniflux feed metadata | Feed objects expose parsing-error information; NewsFlux does not surface it prominently | **PLANNED** near NAV-02F |
| FILTER-RULES-01 | Miniflux feed `blocklist_rules` / `keeplist_rules` | API supports the fields; current NewsFlux `updateFeed` does not expose them | **PLANNED** after FILTER-01 |
| HOME-VISUAL-02 | Miniflux categories + existing Home data | Deterministic editorial grouping; no new ranking state | **HOLD — PRODUCT** pending editorial decision |
| SAVE-EXT-01 | Miniflux third-party integrations | Existing action already sends the entry; NewsFlux cannot list destination items back | **PLANNED** as external handoff, not internal Read Later |

---

## 5. Red-team round 2 accepted findings

The red-team review found no P0 issues. Accepted P1 findings:

1. **R2-01 / BULK-01B:** sidebar feed/category Mark all as read has no confirmation and no undo.
2. **R2-02 / FILTER-01A:** search silently carries across scopes without a visible scoped-state affordance.
3. **R2-03 / A11Y-01:** global shell lacks main landmark, h1 hierarchy and skip navigation; reader title is semantically too low.

High-value P2 work accepted:

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

P3 debt remains under NAV-02F, HOME-SKEL-01 and READER-MEASURE-01 rather than being fixed incidentally.

---

## 6. Visual-cohesion supplement accepted findings

The design supplement is accepted as **direction**, not blanket implementation authorization.

### Safe/low-decision directions

- Standardize source kicker placement and metadata rhythm.
- Make read/unread state redundant and accessible rather than color-only.
- Align list-row visual language with Home secondary stories without turning lists into cards.
- Improve blockquote, caption and link typography in Reader.
- Add stateless Reader progress only if it does not persist position.
- Restyle raw Arco controls with NewsFlux tokens rather than introducing another UI library.
- Prefer verb-first confirmation labels.
- Add deterministic favicon fallback monograms if they do not create persistent per-feed style state.

### Product/real-device gated directions

- HOME-VISUAL-02 category/edition composition.
- Contextual consolidation of floating/header/footer controls.
- Scroll-aware switch between opaque and glass chrome.
- Auto-hiding Reader chrome.
- Material 3 adaptive bottom-bar/rail/sidebar navigation.
- Swipe list gestures.
- View Transition/container transform.
- Serif headline font unless self-hosted and validated for privacy/performance/readability.

### Dependency-gated directions

- “Updated N minutes ago” requires HOME-01 refresh semantics to be trustworthy.
- Reader `Next` card requires NAV01 ordering semantics.
- Reader auto-hide must respect reduced motion and keyboard focus.
- Pull-to-refresh belongs with HOME-01 rather than a visual-only PR.

---

## 7. Recommended execution order

Priority and readiness are separate. A blocked P1 must not cause unrelated deterministic fixes to be folded into the same PR.

**Read-only work can run in parallel:** formal upstream drift audit from reviewed baseline `0887f714...` through observed head `3045a5f...`. No sync follows automatically.

Ordered implementation tracks:

1. **A11Y-RT-01** — isolated CSS accessibility correction.
2. **BULK-01F** — isolated footer focus-return correction.
3. **LIST-VISUAL-01** — cohesive list/read-state presentation; split out any behavior discovered during implementation.
4. **BULK-01B** — P1 sidebar confirmation/undo contract.
5. **ID-RUNTIME-01** — stop runtime update/issue flows from pointing users at upstream; keep upstream credit.
6. **A11Y-01** — P1 landmarks/headings/skip navigation.
7. **FILTER-01A** — P1, but only after explicit product choice.
8. **READER-KEY-01**, **STATE-ERR-01**, **CONTENT-01** — separate bugfix PRs.
9. **READER-VISUAL-02A** — independent typography/header/progress subset only; do not include auto-hide or Next card yet.
10. **BULK-03** and **FEED-HEALTH-01** — provider-backed, no new persistence; separate PRs.
11. **HOME-01**, **NAV01**, **Keyboard/touch parity** — separate functional/interaction tracks.
12. **READER-MEDIA-01** — real-device gate required for edge-to-edge media behavior.
13. **FILTER-01B**, then **FILTER-RULES-01** — rules stay explicit/provider-backed.
14. **CHROME-01A** — token/copy subset only; defer scroll-aware glass, control consolidation and snackbar relocation if real-device evidence is unavailable.
15. **BULK-02** — only after BULK-01B + FILTER-01A; no cross-page select-all; Undo always.
16. **NAV-02F**, **HOME-SKEL-01**, **READER-MEASURE-01**.
17. **SAVE-EXT-01** may be scheduled once wording/placement are specified; it does not wait for storage architecture.
18. **HOME-VISUAL-02** only after explicit editorial product decision and HOME-01 dependency resolution.
19. **READER-VISUAL-02B** — auto-hide + Next card only after reduced-motion/focus contract and NAV01.
20. **NAV-VISUAL-01** only after explicit adaptive-navigation decision + real-device plan.
21. **ID-DEPLOY-01** after distribution architecture decision.
22. **First-party saved-state work** only after storage/sync/privacy/source-of-truth decisions.
23. **Personalization V2**.
24. **MOTION-01** after main interaction architecture stabilizes.
25. **ML ranking** last.

`BULK-01C` may be scheduled once the copy decision is made, but it must remain a scoped footer-undo follow-up and not expand BULK-01B.

---

## 8. Product decisions required before implementation

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

### BULK-03
Define exact semantics for “above”, “below”, and “older than X” under ascending/descending order, search/date/status filters, and virtualized/load-more lists. Mutation must operate only on the explicitly resolved ID set and record acknowledged IDs for Undo.

### FILTER-RULES-01
Choose between:

- a **simple** mute/keep editor for common title/content keyword use cases; or
- an **advanced** Miniflux rule editor exposing the provider syntax.

The rules themselves remain stored by Miniflux; NewsFlux should not create a parallel rule database.

### HOME-VISUAL-02
Decide whether category/edition sections:

- supplement Latest;
- replace part of Latest; or
- remain optional.

Also decide whether the edition header should show only deterministic local/provider facts (date, unread/new count, last successful refresh) or a more editorial label. All composition must remain Home-only and must not reorder All/Unread.

### SAVE-EXT-01
Product wording must distinguish:

- **Save externally / Send to read-later service** — already provider-backed and one-way from NewsFlux; versus
- **Read Later in NewsFlux** — a future first-party queue requiring storage/sync architecture.

Do not label the current one-way integration as a NewsFlux library unless NewsFlux can enumerate/manage that destination.

### NAV-02F
Decide whether Unread source mode remains flat or gains optional grouping, whether desktop sidebar width may increase, and whether `showUnreadFeedsOnly` remains persistent or becomes session-only.

### NAV-VISUAL-01
Decide whether NewsFlux should retain drawer/sidebar navigation at all responsive sizes or adopt a Material-style bottom bar on phones and icon rail on tablet/Fold. Any rail must remain navigation chrome rather than becoming a permanent second content pane. Real-device validation is mandatory before acceptance.

### CHROME-01 contextual consolidation
Decide whether footer pill and header controls remain separate context zones or become a single contextual action bar. Do not resolve this incidentally while restyling buttons/snackbars.

### READER-MEASURE-01
Decide whether Article width 50 may have a CSS minimum prose measure and whether the width setting should affect phone layouts.

---

## 9. Architecture decisions required before first-party saved-state work

Before implementing an internal Later queue, Bookmarks, Boards, Tags, Saved umbrella, Smart folders, per-feed layout sync, or learned relevance, answer:

1. **Source of truth:** Miniflux, NewsFlux-local, another service, or a defined hybrid?
2. **Sync:** single-device vs multi-device, conflict model, offline behavior.
3. **Privacy:** what behavioral/content metadata is stored and where?
4. **Identity:** how entries remain referentially stable across feed deletion or server changes.
5. **Export/portability:** how durable user collections can be migrated/recovered.
6. **Failure semantics:** how provider and NewsFlux-local partial failures reconcile.
7. **Relationship to Miniflux state:** especially `starred`, read/unread, feeds, categories, History, and provider integrations.

Provider-backed `SAVE-EXT-01`, `FILTER-RULES-01`, `BULK-03`, and `FEED-HEALTH-01` are **not** blocked by this architecture gate because they do not create a second persistent NewsFlux source of truth.

Offline reading, feed notifications, third-party AI summaries, and other new persistence/server services remain outside this provider-backed exception and require explicit architecture/privacy decisions.

---

## 10. BULK contracts

### BULK-02
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

Preferred interaction: checkbox per selected row plus a bottom action bar showing count and actions such as `Mark N read`; long-press and keyboard entry may be added only with discoverable parity.

### BULK-03
Range/age actions must reuse the same safety primitives but remain a separate PR from multi-select. They are deterministic shortcuts, not hidden selection.

---

## 11. Definition of ready

An item should not enter implementation until it has:

- one-sentence user/problem outcome;
- explicit in-scope and out-of-scope boundaries;
- source-of-truth decision where state is involved;
- dependency/order declaration;
- acceptance gates;
- regression surfaces;
- browser/real-device gate where relevant;
- dedicated branch/PR plan.

A red-team or reference-product idea being accepted into this roadmap does **not** itself authorize implementation or merge.

---

## 12. Overnight-safe execution policy

An unattended/overnight development session may advance only items that satisfy all of the following:

- no unresolved product, storage, privacy or architecture decision;
- no upstream sync;
- no merge or production deployment;
- no dependence on a real-device PASS for correctness;
- each independently meaningful change receives its own branch/PR;
- tests/build/static gates can run autonomously;
- browser/harness evidence may be collected when available, but absence of a physical-device gate must leave the PR unmerged;
- incidental discoveries are reported and routed back to the roadmap rather than fixed opportunistically.

Current overnight-safe candidates, subject to live revalidation before work begins:

1. **A11Y-RT-01** — deterministic CSS specificity fix.
2. **BULK-01F** — deterministic focus-return correction with regression tests.
3. **LIST-VISUAL-01** — only the low-decision cohesion subset; no date-sticky behavior, no new gestures, no navigation redesign.
4. **READER-VISUAL-02A** — typography/header/stateless progress subset; no auto-hide chrome and no Next card.
5. **CHROME-01A** — only NewsFlux token restyling and verb-first copy where semantics are already known; do not relocate snackbar or introduce scroll-aware glass without interactive evidence.

The overnight agent must stop rather than guess if any candidate unexpectedly requires product semantics, touches upstream-sensitive behavior, causes scope overlap with another active PR, or cannot be proven with available automated gates.

---

## 13. Governance invariants

- **No merge without explicit user authorization.**
- **No implicit deployment of `latest`; deploy exact approved SHA only.**
- **No upstream sync mixed with design or feature work.**
- **No design work mixed with unrelated functional fixes.**
- **Incidental findings are routed to roadmap/backlog.**
- **Miniflux remains source of truth for feeds, categories, read/unread, starred, and provider-backed feed/integration features used by NewsFlux.**
- **New persistent NewsFlux state requires an explicit architecture decision.**
- **All/Unread remain chronological and predictable.**
- **Glass is chrome; content remains opaque.**
- **Mobile/tablet/Fold remain single-pane-first.**
- **Critical visual acceptance remains 884×1104, with phone/tablet/desktop coverage where the track requires it.**

---

## 14. Roadmap promotion state

UX/UI red-team round 2, the provider-backed opportunity supplement, and the visual-cohesion supplement have been reconciled into this document. The previous red-team HOLD is cleared.

Promotion sequence:

1. PM reconciliation — **COMPLETED in this branch candidate**;
2. provider-backed capability verification — **COMPLETED for external save and Miniflux block/keep rules; remaining implementation details stay gated by their tracks**;
3. visual-cohesion supplement classification — **COMPLETED; safe subsets separated from product/real-device gated work**;
4. verify diff remains documentation-only and based on current `main`;
5. keep the dedicated documentation PR open for review;
6. **do not merge without explicit user authorization**.

The roadmap should thereafter be updated when a phase closes, a major finding/reference idea is accepted or rejected, or an architectural/product decision changes sequencing.