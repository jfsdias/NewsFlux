# NewsFlux — Quality & Product Design Review (QD01–QD05)

- **Date:** 2026-11-26
- **Repository:** jfsdias/NewsFlux
- **Reviewed baseline:** `664e404197e1eb9d9aeb52f921690a95b6559190` (PR #321 on `main`)
- **Status:** documentary review + synthetic browser practice. Not physical validation.
- **Authorship:** the Sol/Terra/Luna team was executed in this session (PM/review, analysis + practice, benchmark). There was no independent second reviewer for the final opinion.

## 0. Scope and limits of the evidence

| Type of evidence         | What was done                                                                                                                                                         | Limit                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Code and tests           | Clean clone at `664e404`; `pnpm install --frozen-lockfile`; `pnpm test:src` = **796/796 PASS**; `pnpm build` = OK                                                     | E2E was not re-run (the ledger reports 94/94 ×3 on PR #320/#321). Prettier and Knip were red on the base, already recorded in the ledger. |
| Browser (synthetic)      | Production build served with the repository's own Miniflux mock. Login by API token, Home at 319×907 (foldable closed) and 884×1104 (foldable open), reading an entry | Synthetic data ("News N", flat images). Does not measure real images, Fetch Content on real sites, nor Safari/iOS.                        |
| Physical devices         | **None.**                                                                                                                                                             | iPhone and Galaxy Fold were not tested. The ledger records "physical device smoke pending" for #312 and #320/#321.                        |
| Documentation and ledger | Repository Roadmap/Project State, NewsFlux card and decisions in `jfsdias/homeserver` (private, read via gh), PR #290 and #291 (drafts)                               | The repository's canonical documents stop at 2026-11-08 (#193).                                                                           |
| Benchmark                | External research (WebSearch/WebFetch) on Feedly, Inoreader, Readwise Reader, NetNewsWire, Reeder, Fluent Reader and Safari Reader                                    | Items marked UNVERIFIED were not confirmed (see section 5).                                                                               |

Production was not inspected live. No deployment, merge, push or service change was made.

---

## 1. Executive opinion (QD05)

**1. Current maturity.** NewsFlux is a solid Miniflux reader in code, with high unit and E2E test coverage and a readable browser reading flow. It is not yet mature as a daily product: the Home starts with control panels before the content, validation on iPhone and Galaxy Fold has been pending since the latest deliveries, and the repository's own roadmap is 321 commits out of date. Overall classification: **functional product in a stabilization phase, not mature**.

**2. Highest-value features.**

- Editorial Home with Highlights and categories (#186, #187), which is the core of "what deserves my attention".
- Focused reading, with Reader, optimized reading and preserved editorial caption (#316, #319).
- Per-account reading continuity (#303) and PWA update without automatic reload (#312).
- Favorites and read state always kept in Miniflux, with no own persistence. This is a correct architecture choice.

**3. Features that exist but are of little use today.**

- "Editorial tools" and "Recommend sources" cards at the top of the Home. They occupy the first fold and deliver no content.
- Article Intelligence controls and LiteLLM administrative settings in the same configuration space as reading (default off, but visible to the administrator). They deliver little value to the reader and increase the surface.
- Feed Health as a panel: useful for diagnosis, but not part of the reading flow.

**4. What needs to be simplified.**

- First fold of the Home: remove or collapse the two tool cards; move discovery actions to a single point (header or Settings).
- Lead story in Highlights: limit the image height on phone and foldable so that at least two headlines appear on the first screen.
- AI/administration surface: separate it from the reader. LiteLLM administration, release scripts and auditors should not make up the reading experience nor sit in the same product repository without a clear separation.

**5. What still needs to be developed.**

- Physical validation on iPhone (Safari and installed PWA) and Galaxy Fold (closed and open), with evidence attached to the ledger.
- Non-mutating deduplication (remove implicit read-state changes) and a published story-grouping rule, with opt-out.
- Smart Views with named queries and a decided storage model.
- Interface language: pending decision between the "English-only" policy (#287) and the later approval of pt-BR. Without this decision, Discovery in Portuguese cannot move forward.
- Offline mode with full text and offline search, which is a gap against Inoreader and Readwise (today roadmap E07, not planned for the short term).

**6. Next five deliveries of highest impact.**

1. **Home first fold:** collapse "Editorial tools" and "Recommend sources" out of the reading flow; limit the lead story. Effort S. Criterion: on phone 319×907 and foldable 884×1104, at least two Highlights headlines visible without scrolling.
2. **Closing S0 with physical evidence:** smoke matrix on iPhone (Safari and installed PWA) and Galaxy Fold, for #312 and for the current release. Effort S, but requires the owner with the devices. Without it, no new feature should be merged.
3. **Non-mutating dedup (S1, PR #295):** guarantee that displaying duplicates does not change reading state. Effort M. Criterion: E2E test confirming that no read state changes when opening or grouping.
4. **Documentary reconciliation:** a single canonical roadmap (today `docs/` diverges as of 2026-11-08, the ledger as of 2026-11-26, and PRs #290/#291). Effort S.
5. **Language and AI scope decision:** decide pt-BR versus English-only and separate AI administration from the reader. Effort S for the decision, M for execution. Unblocks Discovery V4 in Portuguese.

---

## 2. Product audit (QD01)

Classifications: MATURE, FUNCTIONAL_NEEDS_UX, PARTIAL, NOT_IMPLEMENTED, BLOCKED, CANDIDATE_FOR_CONSOLIDATION, CANDIDATE_FOR_RETIREMENT. The presence of code or a button is not enough for MATURE; no feature was classified as MATURE because there is no physical validation.

| #   | Feature                                                                | Current state                                               | Problem                                                                                                      | Evidence                                                        | Priority | Proposed solution                                              | Effort |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------- | -------------------------------------------------------------- | ------ |
| 1   | Editorial Home and Highlights                                          | FUNCTIONAL_NEEDS_UX                                         | Tool cards before the content; lead story occupies the first fold                                            | Browser 319×907 and 884×1104; Home text                         | P0       | Collapse tools; limit lead height                              | S      |
| 2   | Story Groups and deduplication                                         | PARTIAL                                                     | Conservative grouping by unit tests; implicit read-state mutation when opening (PR #295); rule not published | Commits "Test conservative story grouping", PR #295; roadmap S1 | P0       | Do not mutate reading; document rule and opt-out               | M      |
| 3   | Smart Views                                                            | FUNCTIONAL_NEEDS_UX                                         | MVP merged (#302) but not polished; local storage still with a pending decision                              | Smart Views MVP commit; roadmap S2                              | P1       | Named queries and supported filters; storage decision          | M      |
| 4   | Discovery and source recommendation                                    | PARTIAL                                                     | Catalog expanded but V4 postponed; Portuguese sources depend on the language decision                        | PR #314/#310; ledger "catalog expansion deferred"               | P1       | Decide language; curated catalog with review                   | M      |
| 5   | Reader and optimized reading                                           | FUNCTIONAL_NEEDS_UX                                         | Readable at 884 px; double floating bar; hero fills the whole screen (with synthetic image)                  | Browser; #319                                                   | P0       | Validate on iPhone and foldable; adjust hero height            | S      |
| 6   | Fetch Content                                                          | PARTIAL                                                     | Open access by DOI merged (#315); presentation (#316); Readability comparison in Draft (#313, #318)          | Ledger; PRs                                                     | P1       | Explain "incomplete content" state and legitimate alternatives | M      |
| 7   | Article Intelligence                                                   | PARTIAL                                                     | Default off; consent and cost handled; growing administration surface                                        | Summary, D1, LiteLLM commits                                    | P2       | Keep opt-in; separate administration from the reader           | M      |
| 8   | Search and filters                                                     | FUNCTIONAL_NEEDS_UX                                         | Not assessed in depth in this review; only presence in E2E                                                   | e2e/search-and-sort.spec.js                                     | P2       | Dedicated audit                                                | S      |
| 9   | Favorites and history                                                  | FUNCTIONAL_NEEDS_UX                                         | Favorites = Miniflux starred (correct); history present; not assessed on device                              | Roadmap §1                                                      | P2       | Review naming and access                                       | S      |
| 10  | Reading continuity                                                     | PARTIAL                                                     | Per account, without validation across devices                                                               | #303; roadmap S3                                                | P0       | Validate between iPhone and desktop                            | S      |
| 11  | PWA and multiplatform                                                  | PARTIAL                                                     | Foreground check (#312); old versions persisted in desktop QA (ledger); iPhone not verified                  | Ledger NF-PWA-R1                                                | P0       | Physical smoke; confirm predictable update                     | S      |
| 12  | Personalization and settings                                           | FUNCTIONAL_NEEDS_UX; CANDIDATE_FOR_CONSOLIDATION (AI panel) | Settings grow with AI administration                                                                         | AI Settings and LiteLLM commits                                 | P2       | Consolidate in a separate administration section               | M      |
| 13  | Feed Health                                                            | FUNCTIONAL_NEEDS_UX                                         | Useful diagnostic panel, outside the reading flow                                                            | #305                                                            | P2       | Move to a secondary access point                               | S      |
| 14  | Briefing ("Essential of Today")                                        | PARTIAL                                                     | Briefing diversity in code; roadmap S6 still planned                                                         | Commit "Diversify briefing"                                     | P1       | Complete in S6 after S1                                        | M      |
| 15  | Focus (explicit signals)                                               | NOT_IMPLEMENTED                                             | Planned in S5                                                                                                | Roadmap                                                         | P1       | After S4                                                       | L      |
| 16  | Offline reading with full text                                         | NOT_IMPLEMENTED                                             | Gap against Inoreader and Readwise                                                                           | Benchmark §5                                                    | P2       | Assess after S8                                                | L      |
| 17  | "Editorial tools" on the Home                                          | CANDIDATE_FOR_CONSOLIDATION                                 | Duplicates Discovery and Settings                                                                            | Home text                                                       | P0       | Move to a single point                                         | S      |
| 18  | LiteLLM administrative panel in the reader UI                          | CANDIDATE_FOR_CONSOLIDATION                                 | Operational complexity in the reading interface                                                              | Commits #259–#263                                               | P2       | Move to administration                                         | M      |
| 19  | Release scripts, auditors and QA harness inside the product repository | CANDIDATE_FOR_RETIREMENT from the product repository        | Not reader features; increase maintenance                                                                    | Commits of S5-R1/R3, release and Caddy                          | P2       | Move to an operations repository                               | M      |

Consistency note: the feature list reflects what is in `main`. The repository documents describe items as "HOLD" or "BACKLOG" that have already been implemented (for example, story clustering appears as HOLD in the 2026-11-08 roadmap and as conservative grouping in the commits). This confirms the documentation problem in section 4.

---

## 3. UX/UI audit (QD02)

Synthetic browser evidence, at two sizes.

**Login (319×907).** Clear flow: server, token or user/password, and the option to create a dedicated API key instead of storing the password locally. Positive behavior and aligned with privacy. Observation: when switching to "API Token" mode, the server field was cleared; it is a small, reproducible friction.

**Home, phone (319×907).**

- Top: isolated search icon, without a visible context title.
- First fold: "Editorial tools / Enable editorial tools" card, then "Recommend sources / Recommend sources", only then "Highlights".
- The two control cards take up about a quarter of the first fold before any content.
- Lead story fills almost the whole first fold; only one complete story appears before scrolling.
- Bottom bar with Home, All (150), Today (38), Starred and Feeds. Clear and recognizable pattern.
- "Login successfully" toast overlaps the first card. Transitory, with no relevant impact.

**Home, foldable open (884×1104).**

- Compact side navigation on the left (Home, All, Today, Starred, Feeds). Makes good use of the usable area.
- The same two control cards at the top, now full width, occupying a large part of the header.
- Highlights in a grid: lead takes full width with image on the left; two cards below; then "Technology" with a list. Good hierarchy.
- Tool cards take about 14% of the viewport height; the lead about 21%. With real images, the lead tends to grow.

**Reader (884×1104).**

- Title, source, category, date, reading time and "Optimized reading" chip centered. Clear editorial structure.
- Floating top bars in two capsules (navigation on the left; actions on the right). Consistent, but two simultaneous capsules with many icons increase density.
- Hero fills the first full screen (with synthetic placeholder). It should have its height limited on small screens.

**Items not assessed in this session:** light and OLED themes on device, keyboard navigation in real interaction, iPhone Safari, installed PWA, real error and empty states, Fetch Content on real sites, Galaxy Fold folded (only 319 px as an approximation).

**UX proposals (hypotheses to validate, not confirmed defects):**

- H1: Move "Editorial tools" and "Recommend sources" to a single access point (header or Settings). Reduces the first fold by about a quarter (estimate to validate).
- H2: Maximum height of the lead story (for example, 40% of the viewport height on phone) to show two headlines without scrolling.
- H3: Empty state of Fetch Content explaining "incomplete content" and alternatives (open on the original site, summary if enabled).
- H4: One floating bar at a time in the reader on small screens.

---

## 4. Documentation, governance and reconciliation (input for QD04)

**Confirmed:**

- The repository's roadmap and Project State (`docs/NEWSFLUX_ROADMAP.md`, `docs/NEWSFLUX_PROJECT_STATE.md`) were reconciled on 2026-11-08 (#193). Since then, `main` has advanced 321 commits up to `664e404`.
- There are two competing roadmaps outside `main`: PR #290 (reconciliation of 2026-11-21, open) and PR #291 (S0–S8+ approved by the owner, Draft). They overlap, and PR #291 itself asks to avoid two canonical roadmaps.
- Production is not verified: the ledger records a Reader deployment by the operator at SHA `664e404…` and a pinned image, but parity was not confirmed live in this review.
- The ledger has pending language decisions: "English-only" (#287) and pt-BR recommended in the 2026-11-21 audit, without reconfirmation.

**Recommendation:** a single canonical roadmap (the one from PR #291, with the history sections preserved), updated to `664e404` and with the delta of #194–#321 summarized by epic. PR #290 can be closed as superseded, after the owner's decision.

---

## 5. Benchmark and gap analysis (QD03)

Source: external research in this session. Verified = read on an official page or repository on 26/11/2026. Not verified = third-party snippet or not found.

**Already satisfactory in NewsFlux:**

- Favorites as Miniflux `starred` (no duplicated persistence), consistent with the project's own architecture rule.
- Chronological list in All/Unread, with no silent ranking. Feedly and Inoreader offer ranking and AI by default, and NewsFlux differentiates itself by not doing so.
- Home with categories and highlights, more editorial than most RSS readers.
- Login with a dedicated API key option, in line with privacy best practices.

**Below the references:**

- **Deduplication with a published rule and opt-out.** Feedly documents: overlap above 85%, a 31-day window, only between different sources, enabled by default and can be disabled; marking one version as read marks the others (VERIFIED: docs.feedly.com, document dated 03/07/2025). NewsFlux does not yet publish an equivalent rule.
- **Documented shortcuts.** Feedly documents J/K, N/P, M, X, Shift+A, S, T, B, with a note about Caps Lock (VERIFIED). NetNewsWire has single-key shortcuts (VERIFIED). NewsFlux has hotkeys, but no equivalent help page in this review.
- **Explicit offline mode and offline search.** Inoreader lists "Offline mode" and "Full content" (VERIFIED: inoreader.com/features). Readwise Reader has offline reading and search (VERIFIED: readwise.io/read). NewsFlux does not.
- **In-app feed discovery.** Inoreader has "Find RSS feeds" and "Discover feeds" (VERIFIED). NewsFlux has discovery through Miniflux, with a confirmation flow. It is on the right path, but the catalog is still limited.
- **Persistent typographic controls.** Safari Reader remembers font, theme and zoom (VERIFIED: Apple guide). NewsFlux has optimized reading, but persistence of the controls needs to be confirmed.
- **OPML import and export.** Readwise Reader imports OPML from Feedly, Inoreader and Feedbin (VERIFIED). No OPML reference was found in NewsFlux in this review (UNVERIFIED in code).

**Real differentiation opportunities:**

- **Self-hosted, open-source reader on top of Miniflux, syncing through the own instance.** Reeder and NetNewsWire sync through iCloud or SaaS services; Feedly and Readwise are paid SaaS (Readwise price verified: US$ 9.99/month annual or US$ 12.99/month monthly).
- **Controllable AI with transparency of origin and cost.** Safari Summarize is opaque and depends on region and language. NewsFlux already has consent and opt-in; the differentiation depends on keeping this simple and explained in the interface.

**Reusable open-source components (license verified in the repository):**

- Mozilla Readability — Apache-2.0, compatible with an MIT fork (keep the copyright notice).
- feedsmith — MIT, RSS/Atom/RDF/JSON Feed/OPML in TypeScript.
- Workbox — MIT; vite-plugin-pwa — MIT (already in use in the project, check version).
- date-fns and i18next — MIT.
- Fluent Reader — BSD-3-Clause (requires attribution); low practical use.
- NetNewsWire — MIT, Swift; UX reference only.
- Postlight Parser — license not confirmed in the file; do not use without verifying.

---

## 6. Revised roadmap (QD04)

Epics aligned with the queue approved by the owner (PR #291: S0–S8+). Proposed adjustments are marked with ▲.

| Sprint | Epic                       | Scope                                                                                                                     | Dependencies           | Acceptance criteria                                               | Tests                           | Priority | Risks                            | Reusable components             |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- | ------------------------------- | -------- | -------------------------------- | ------------------------------- |
| 0      | NF-E00 Foundation          | Close open PRs (#288 consent, #289 gate removal, #260 privacy); release identity; ▲ physical iPhone and Galaxy Fold smoke | Owner decision         | Smoke matrix with attached evidence; no regression in E2E         | Physical smoke + E2E 94/94      | P0       | Delay due to device availability | Existing harness                |
| 1      | NF-E01 Dedup               | Remove implicit read mutation (PR #295); reversible grouping                                                              | S0                     | Opening a group changes no read state; undo restores presentation | Unit + new E2E                  | P0       | Regression in All/Unread         | Existing `duplicate-projection` |
| 2      | NF-E02 Smart Views         | Named queries, supported filters, decided storage                                                                         | S1                     | Create, rename, delete and restore a query                        | Existing Smart Views E2E        | P1       | New storage without decision     | Existing filters                |
| 3      | NF-E02/E03 Continuity      | Reader and list resume; Smart Views polish                                                                                | S2                     | Resume reading after device switch                                | Continuity E2E + physical smoke | P0/P1    | Per-account local storage        | Existing continuity (#303)      |
| 3c     | NF-E04 Locale              | pt-BR only after reconfirmation of #287                                                                                   | Owner decision         | —                                                                 | —                               | HOLD     | Policy conflict                  | —                               |
| 4      | NF-E05 Story Groups        | Conservative relations only on the Home; published rule; opt-out                                                          | S1                     | Rule documented; opt-out persistent                               | Grouping unit tests             | P1       | False positives                  | Story research (#134–#140)      |
| 5      | NF-E05 Focus               | Explicit and reversible signals                                                                                           | S4                     | Preference visible and undoable                                   | Unit + E2E                      | P1       | Silent ranking (forbidden)       | —                               |
| 6      | NF-E05 Briefing            | Deterministic "Essential of Today"                                                                                        | S1, S4                 | Reproducible order                                                | Unit                            | P1       | Duplicating the Home             | Existing briefing               |
| 7      | NF-E06 Feed quality        | Provider-backed diagnostics                                                                                               | S0                     | Error state explained                                             | Feed Health E2E                 | P2       | Load on Miniflux                 | Feed Health (#305)              |
| 8+     | NF-E07 Advanced            | Offline, rules, integrations                                                                                              | Architecture decisions | —                                                                 | —                               | P2/P3    | New persistent state             | —                               |
| ▲      | Home first fold            | Collapse tools; limit lead                                                                                                | None                   | Two headlines visible without scrolling at 319×907 and 884×1104   | Visual capture + height test    | P0       | Low                              | Existing card component         |
| ▲      | Separate AI administration | Move LiteLLM panel to administrative area                                                                                 | Decision               | Reader has no administrative panel                                | Settings E2E                    | P2       | Admin route breakage             | —                               |

Recommended order: ▲ Home first fold can start now, in parallel with S0, because it does not depend on a decision. Do not merge new features before the S0 physical smoke.

---

## 7. Quality opinion and record

- **Tests:** 796/796 unit PASS; production build OK. E2E was not re-run in this review (ledger: 94/94 ×3 on #320/#321).
- **CI debts recorded in the ledger:** Prettier red on 10 base files plus a new spec; Knip with 5 base findings. Not introduced by #321.
- **Golden rule preserved:** Miniflux as source of truth; All and Unread chronological; no new persistent state.

**Record (pending authorization):** this document was saved locally. To record it in the NewsFlux repository and in the central ledger, explicit authorization is still needed for push or PR (public repository) and for writing to `jfsdias/homeserver` (private). No push was made.

---

## Execution addendum (2026-11-26)

This addendum records what was executed after the review above, using the facts verified on 2026-11-26. It does not change the review's findings; where a fact moved, the addendum states the new state.

### What was done

- **Integration candidate.** Branch `qd/integration` (head `b2633a99`) merges the workstreams that address the review: `qd/docs-reconcile` (canonical state to post-#321 and the S0–S8 queue); `qd/english-only` (translated READMEs and the interface language picker removed; non-English comments and documentation prose removed); `qd/home-vitruvian` (a single collapsed "Home tools" entry replaces the two tool cards; lead highlight capped at 24vh on compact and medium layouts; scenarios NF-E05-3..5); `qd/dedup-295-validation` (Home crash fix when mark-read-on-scroll is enabled, where HomeEditorial called the `useReadOnScroll` result object as a function; 14 duplicate-integrity E2E scenarios; 3 store tests); `qd/optimize` (Arco CSS per component, LazyMotion, lazy DatePicker, dead exports removed); `qd/repo-separation` (`ops/`, `research/`, `tests/aux/`, `archive/` and `REPOSITORY_LAYOUT.md`). Coordinator commits add E2E contract v23 (111 identities), removal of the unused `markDuplicatesAsRead` mutation path and its string, removal of the upstream-only translator workflow, a module-private Home tools panel id, and the simulated device-matrix harness (`tests/aux/device-matrix/`).
- **Sprint 0 and Sprint 1 closeout.** The owner accepted closing Sprint 0 with simulated smoke on 2026-11-26; physical-device smoke remains an evidence gap in the backlog. Sprint 1 (NF-E01) is complete with the 14 duplicate-integrity E2E scenarios (`NF-E01-DUP-1..13` and `NF-E01-HOME-1`), 3 store tests, and removal of the `markDuplicatesAsRead` mutation path.
- **Simulated smoke.** The device matrix was run on baseline `main` `664e404` and on the candidate, in Dark and Light. Details and limits are in [`docs/qa/S0_SIMULATED_SMOKE_2026-11-26.md`](../qa/S0_SIMULATED_SMOKE_2026-11-26.md).
- **Documentation.** The canonical roadmap and Project State were updated to the verified PR states below; the S0/S1 checkpoints and the integration candidate are recorded there.

### Verified results

- **Gates on the integration candidate** (commit `fa56a12b`, before the harness-only commit): unit tests src 803/803, scripts 258/258, ops 2/2, research 58/58; ESLint 0 errors; production build OK; `knip:check` PASS with 27 accepted findings, none new and none stale (it failed on `main` `664e404`); canonical verified Playwright E2E 111/111 PASSED, contract v23, run id `31f6cbcf-22b5-4980-a441-d4417922d9e7`.
- **Python suites on `main` `664e404`**, with a venv (Python 3.14.7) installing `services/article_intel_summary/requirements.txt`: article_intel_auth 30 OK; article_intel_summary 432 OK (4 skipped); content_fallback 151 OK; reader-wallhop-p1-r2 13 OK.
- **Load cost** (cold load at 390×844, bytes fetched per phase), `main` → candidate: Login raw 1,380,608 → 1,223,726 (−11.4%), gzip 311,337 → 293,139 (−5.8%); Home (added) raw 1,064,643 → 942,314 (−11.5%), gzip 333,093 → 299,690 (−10.0%); Reader (added) unchanged (about 173 KB raw). hls.js, highlight.js, plyr and littlefoot already load lazily.
- **Visual parity:** 34 of 42 screenshots are pixel-identical; the other 8 differ only in relative-time text.
- **Simulated S0 smoke:** baseline `main` `664e404` run 1: 11/12, run 2: 12/12; candidate run 1: 12/12, run 2: 11/12, run 3 (final harness): 12/12. The only failures, in both baseline and candidate, are an intermittent WebKit page error "… due to access control checks." on iPhone Duo profiles. It was never reproduced twice in a row. It is recorded as a hypothesis to verify in real iOS Safari, not as a defect. No horizontal overflow on Home, Reader or All in any profile.
- **Headlines fully visible on the first Home screen** (baseline → candidate): iPhone Duo closed 466×678: 0 → 2; iPhone Duo open 626×890: 2 → 3; Galaxy Z Fold 8 closed 416×657: 0 → 2; Galaxy Z Fold 8 open 924×1224: 8–9 → 9; reference phone 390×844: 1 → 2; reference foldable 884×1104: 6 → 8. Tool cards before Highlights: true in every baseline profile, false in every candidate profile. The iPhone Duo and Z Fold 8 viewports are derived from published panel sizes with an assumed device pixel ratio, so their confidence is low until measured on hardware.
- **Read-only S0 review** found no consent, cost or data-transfer defect on `main`. Automatic summaries require both `aiSummaryAutoOnOpen` and the separate `aiSummaryAutoConsent` (both default false); consent is re-checked after the catalog fetch and before the POST; the revocation listener aborts pending work; there is one automatic attempt per cache key; the in-memory LRU cache (50 entries) is keyed by auth session, session revision, entry hash and shaping settings, and is cleared on `resetData()`.

### Pull request states

Verified on GitHub on 2026-11-26:

- Open PRs: #318 (Draft), #313 (Draft), #296 (Draft), #295 (Draft), #294 (Draft), #293, #292 (Draft), #291 (Draft), #290, #260 (Draft).
- No longer open: #188 and #134–#140.
- Merged: #312, squash commit `22ffa6b7` ("NF-PWA-R1: check for updates when the app returns to foreground").

Planned dispositions, to be executed by the coordinator after this documentation update (planned at the time of writing, not yet executed):

- Close #295 as superseded by #299 plus the validation in the integration candidate.
- Close #292 and #296 as superseded by `main`: the summary consent and session hardening is already on `main` via #300 (commits `53167910`, `ac3f5a4c`, `c4a23cd1`).
- Close #293 as superseded by #297; its six files are byte-identical on `main`.
- Keep #294 open as NEEDS_OWNER_DECISION: it would revert the owner's 2026-11-21 decision to drop runtime evidence expiry.
- Keep #260 open and parked (HOLD_ARCHITECTURE).

### Product decisions recorded 2026-11-26

- The interface stays English-only. pt-BR (NF-0304) is SUPERSEDED. This resolves the language question in section 1, item 5, and the blocker for Discovery in Portuguese.
- Sprint 0 may be closed with simulated smoke.
- Open question for the owner (HOLD_PRODUCT): with the Home tools panel collapsed by default, an enabled editorial briefing is also hidden until the panel is opened.

### What remains

- Physical-device smoke on iPhone Duo and Galaxy Z Fold 8, with measured viewports (EVIDENCE_GAP).
- Verification of the two WebKit hypotheses on real Safari: the intermittent access-control page error, and the compact bottom navigation showing content beneath it without blur (the CSS already declares `-webkit-backdrop-filter`; headless WebKit likely does not composite it; reduced-transparency mode already switches to an opaque fill).
- The PR dispositions listed above, and the owner decision on #294.
- Live production parity: `PRODUCTION_SHA_VERIFIED` remains `UNKNOWN_IN_THIS_AUDIT`.
- Competitor claims in section 5 remain UNVERIFIED: external research could not reach official sources (DNS failures). OPML import/export, mark-read-on-scroll, age-based mark-as-read and save-to-integration already exist in NewsFlux, so those items are not gaps.
