# NewsFlux execution checklist — 2026-11-21 (status reconciled 2026-11-26; S0/S1 closeout 2026-11-26)

Statuses below were reconciled on 2026-11-26 against `main` `664e404197e1eb9d9aeb52f921690a95b6559190` (post-PR #321), and the Sprint 0 and Sprint 1 items were closed out on 2026-11-26 against the `qd/integration` candidate. They use the roadmap status vocabulary (section 2). Items were PLANNED on 2026-11-21 unless marked HOLD or an existing PR. Each bullet is a focused candidate PR/task; no implementation or release authorization is implied. S = small, M = medium scope. Verify focused tests and build per [plan](plan.md); checkpoint is a material decision, not a new arbitrary review round.

## Sprint 0 — NF-E00 Foundation closeout (P0)

- [x] **NF-0001 (S) — Summary review / existing #288.** `COMPLETED`: code-level consent, cost and cache criteria verified on `main` by read-only review. Automatic summaries require both the auto-on-open preference and the separate auto-consent; consent is re-checked before POST; revocation aborts pending work; one automatic attempt per cache key. Python summary suite 432 tests OK, 4 skipped. Live authorized-model smoke remains gated: `EVIDENCE_GAP`. Files: existing #288 scope. Depends: none.
- [ ] **NF-0002 (S) — Governance / existing #260.** `HOLD_ARCHITECTURE`: #260 (local-only consent) is parked; the flag baseline is OFF. Reopen only after the read-only key and egress audit and a rebase; verify fail-closed route binding and fallback, no new key or writes at that time. Depends: none.
- [x] **NF-0003 (S) — QA maintenance / existing #289.** `COMPLETED`: retained essential gates (#289) verified in `quality.yaml`. #293 is `SUPERSEDED` by #297 (its six files are byte-identical on `main`). No production permissions changed. Depends: none.
- [x] **NF-0004 (S) — Reconcile source vs runtime.** `COMPLETED` for source identity: the exact source state (`664e404`, post-PR #321) is recorded in the roadmap and project state, with open PR states verified on GitHub on 2026-11-26. Runtime parity remains `OPERATOR_REPORTED`; live parity is `NOT_VERIFIED` and needs authorized runtime evidence under its own gate. Depends: 0001–0003 dispositions.
- [x] **NF-0005 (M) — Reader journey smoke.** `COMPLETED` with simulated smoke: the device-matrix harness (`tests/aux/device-matrix/`) ran on baseline `664e404` and on the candidate, Dark and Light (see `docs/qa/S0_SIMULATED_SMOKE_2026-11-26.md`). Physical device smoke on iPhone (Safari and installed PWA) and Galaxy Fold remains `EVIDENCE_GAP` in the backlog. Depends: 0004.
- [x] **Checkpoint S0:** `COMPLETED`. Closed with simulated smoke by owner instruction on 2026-11-26; physical-device smoke recorded as an evidence gap.

## Sprint 1 — NF-E01 Dedup integrity (P0)

- [x] **NF-0101 (S) — Separate display from read-state mutation.** `COMPLETED`: delivered by #299 and validated in the `qd/integration` candidate. The implicit mark-read path in the display filter is removed; `markDuplicatesAsRead` was removed as an unused mutation path. Covered by the NF-E01 E2E scenarios and store tests. Depends: S0.
- [x] **NF-0102 (M) — Reversible duplicate UI.** `COMPLETED`: group count, expansion and individual sources are covered by `NF-E01-DUP-1..13` and `NF-E01-HOME-1` (14 E2E scenarios, canonical contract v23). Depends: 0101.
- [x] **NF-0103 (S) — Dedup regression.** `COMPLETED`: no unrequested canonical writes in the E2E scenarios and 3 store tests; description and documentation updated. Depends: 0102.
- [x] **Checkpoint S1:** `COMPLETED`. Zero unrequested canonical writes from the duplicate path; duplicate behavior visible, reversible and covered by evidence.

## Sprint 2 — NF-E02 Smart Views MVP (P1)

- [ ] **NF-0201 (S) — Storage/query decision (HOLD until owner GO).** `IN_PROGRESS`: a storage design document exists in `docs/SMART_VIEWS_STORAGE.md`; the owner GO is not re-verified here. Reuse existing search/filter/query representation; assess account isolation, local storage lifecycle, export/reset and no cross-device sync initially. Document supported predicates and unsupported provider search semantics. Verify architecture readback. Depends: S1.
- [x] **NF-0202 (M) — Save/open explicit query.** `COMPLETED` (MVP delivered by #302). Named query re-runs against Miniflux with existing filters/sort; no cached article replica. Verify same results as manual query, empty/offline/error states and account isolation. Files: search controls, query model, selected view route. Depends: 0201.
- [x] **NF-0203 (M) — Manage saved views.** `COMPLETED` (MVP delivered by #302). Rename/delete/reorder explicitly, sensible empty state; never mutate article status. Verify persistence, settings reset, keyboard/touch and isolation. Depends: 0202.
- [x] **Checkpoint S2:** `COMPLETED`. Create → open → edit/delete usable view, no Miniflux state duplication.

## Sprint 3 — NF-E02 polish / NF-E03 continuity / NF-E04 conditional locale (P1)

- [x] **NF-0301 (S) — Smart View shortcuts/polish.** `COMPLETED` (branch feat/nf-0301-smart-views-polish; verified E2E contract v24, 115/115 PASSED on head 131cfd11; NF-0301-1..4 repeated 3x green; pnpm test, lint 0 errors, knip:check and build green; no schema change, no new store; no hotkey added, see docs/SMART_VIEWS_STORAGE.md). Explicit selected scope, readable names, filter chips, navigation, no surprise jump after mark-read. Verify regressions. Depends: S2.
- [x] **NF-0302 (M) — Resume Reader.** `COMPLETED` (account-scoped continuity delivered by #303; device verification pending under the NF-0005 physical-device backlog). Approve scoped local position lifecycle; anchor position by identity/version, clamp or fall back on changed content; no read/star mutation, clear reset. Verify article close/reopen, changed content, account switch and recovery. Depends: S2 + storage gate.
- [x] **NF-0303 (M) — Resume article lists.** `COMPLETED` (delivered by #303; PWA update and scope-switch verification pending). Restore item anchor for same scope/query only, with fallback when removed; preserve new sorting/filter and next-unread semantics. Verify page refresh, PWA update, new entries and scope switch. Depends: 0302.
- [ ] **NF-0304 (S/M) — pt-BR UI.** `SUPERSEDED`: the owner reconfirmed English-only (#287) on 2026-11-26. Closed unless the owner reopens it. Original scope: reconfirm owner English-only #287 vs later roadmap endorsement; if approved, introduce locale in separate PR, validate coverage, settings migration, accessibility and summary-language independence. No broad revival of other translations.
- [x] **Checkpoint S3:** `COMPLETED` (NF-0301..0303 delivered; NF-0304 superseded; physical-device verification of resume remains in the NF-0005 backlog). Low-friction resume and Smart View navigation; locale only if authorized (it is not).

## Sprint 4 — NF-E05 Story Groups (P1)

- [ ] **NF-0401 (S) — Reuse-first Story research inventory.** `IN_PROGRESS`: #301 partially delivered conservative story grouping; the simplest-matching selection is not re-verified. Examine merged disabled Story code and #190 evaluation; pick simplest deterministic matching and bounded same-event timeframe. Verify known divergent stories and exact source duplicates in fixtures; no provider calls. Depends: S1.
- [ ] **NF-0402 (M) — Home visual related coverage.** `IN_PROGRESS`: partially delivered by #301. Group conservative matches, display source count and expanded individual articles; preserve non-grouped items and original status. Verify representative fixtures, deterministic order, no canonical writes. Depends: 0401.
- [ ] **NF-0403 (S) — Group UX quality.** `PLANNED`. Detail group provenance, keyboard/touch accessibility, false match controls; verify baseline diversity and performance in Home. Depends: 0402.
- [ ] **Checkpoint S4:** `IN_PROGRESS`. Deterministic, explainable, reversible visual grouping; no experimental ranker automatically enabled.

## Sprint 5 — NF-E05 Focus (P1)

- [ ] **NF-0501 (S) — Preference/storage decision (HOLD until owner GO).** `IN_PROGRESS`: reversible category preferences were added with #301; the storage decision is not re-verified. Define more/less source/topic signals, reset/expiration, account boundaries, compare V1 starred-affinity. Verify contract and privacy. Depends: S4.
- [ ] **NF-0502 (M) — Explicit source/topic preference.** `IN_PROGRESS`: partially delivered by #301. Add small visible controls, clear rationale and undo; apply only in Home/explicit Focus view. Verify control and stable chronological All/Unread. Depends: 0501.
- [ ] **NF-0503 (M) — Quiet-source diversity.** `PLANNED`. Bound repetition, boost infrequent eligible sources deterministically; compare representative synthetic feeds against V1. Verify no hidden read mutations and no silent opaque ranking. Depends: 0502.
- [ ] **Checkpoint S5:** `IN_PROGRESS`. Preference control transparent and reversible; no ML requirement.

## Sprint 6 — NF-E05 Briefing (P1)

- [ ] **NF-0601 (M) — Deterministic Essential of Today.** `IN_PROGRESS`: #301 diversified the briefing; the Essential-of-Today acceptance is not verified. Home-only explicit briefing with bounded recency, categories, diverse sources and grouped coverage; clear original links, no generated claims. Verify works with model unavailable. Depends: S4–S5.
- [ ] **NF-0602 (M) — Optional on-demand intelligence.** `PLANNED`: gated. Reuse Summary/LiteLLM, consent and existing budget/provider gates; optional summary with clear provenance, no automatic digest inference or external transfer. Verify disabled/error pathways and authorized synthetic cases. Depends: 0601 + S0 operational qualification + separate GO.
- [ ] **Checkpoint S6:** `PLANNED`. Briefing useful without IA; optional IA independently gated and failure nonblocking.

## Sprint 7 — NF-E06 Feed quality (P2)

- [x] **NF-0701 (M) — Feed health review.** `COMPLETED` (feed health dashboard delivered by #305). Reuse existing health/discovery APIs; surface errors, stale/inactive feeds, update frequency when actually available; label unavailable. Verify provider data and no side effects. Depends: S6.
- [ ] **NF-0702 (M, conditional) — Feed relevance review.** `PLANNED`: the telemetry-gated relevance review is not started. Note: #306 delivered a loaded-sample source review under the NF-0702 label; the scopes differ. Compare repeated coverage and usage only with approved metrics/storage; recommend review, not automatic removal. Verify no private data export or unrequested mutations. Depends: 0701 and telemetry gate.
- [ ] **Checkpoint S7:** `IN_PROGRESS`. Actionable quality review; no silent subscription changes.

## Sprint 8+ — NF-E07 Advanced workflows (P2/P3; HOLD_ARCHITECTURE)

Each item requires its own evidence-driven decision, then separate vertical slices and PRs; no default new service.

- [ ] **NF-0801:** `HOLD_ARCHITECTURE`. Offline read-only article cache, privacy/eviction/logout; offline mutations/sync separate HOLD. Verify no cross-account content and fresh runtime.
- [ ] **NF-0802:** `HOLD_ARCHITECTURE`. Reversible scoped rules/automation, preview + explicit action, Miniflux-backed where possible. Verify no silent Mark Read or delete.
- [ ] **NF-0803:** `HOLD_ARCHITECTURE`. Explicit productivity handoff/export using existing systems; no outbound automation without approval. Verify selection and privacy.
- [ ] **NF-0804:** `HOLD_ARCHITECTURE`. Newsletter/non-RSS inputs; assess existing components/reuse, lawful access, no new ingestion unless justified. Verify source health/consent.
- [ ] **NF-0805:** `HOLD_ARCHITECTURE`. Notes/highlights and annotations; define authority/export/ownership before persistence.
- [ ] **NF-0806:** `HOLD_ARCHITECTURE`. TTS; use native capabilities where appropriate, no external content transfer or cost by default.
- [ ] **Checkpoint S8+:** `HOLD_ARCHITECTURE`. Prioritize one at a time after actual usage; discard or park low-value items.

## Sprint 9 — NF-E08 Learned source affinity (P2)

Plan: [NF-E08](../docs/NF-E08_LEARNED_SOURCE_AFFINITY.md). Decision: [ADR 0002](../docs/adr/0002-reading-signals-service.md). NF-0702 relevance review can use NF-0904 output once it exists.

- [ ] **NF-0901 (S) — Epic and ADR 0002.** `IN_PROGRESS` (docs only). Verify owner acceptance of ADR 0002 before any later item.
- [ ] **NF-0902 (M) — `reading_signals` service.** `HOLD_ARCHITECTURE` until ADR 0002 is accepted. Aggregate-only SQLite store, Miniflux-key auth reuse, signals/affinity/export/reset API, release entry disabled by default. Verify entry-level fields are rejected.
- [ ] **NF-0903 (M) — Client instrumentation.** `HOLD_ARCHITECTURE`. Opt-in, off by default; impressions, opens, read to end; local daily aggregation and batched flush. Verify no requests when off, no Miniflux mutations, All/Unread order unchanged, foldable viewports.
- [ ] **NF-0904 (S) — "Your reading" transparency page.** `HOLD_ARCHITECTURE`. Verify owner validation after at least 14 days of data before any ranking.
- [ ] **NF-0905 (M) — Home "For you" weighting.** `HOLD_ARCHITECTURE`. Bounded, explained, switchable; off restores V1 exactly.
- [ ] **NF-0906 (M) — Home panorama band.** `HOLD_ARCHITECTURE`. Depends on NF-E05 Story Groups; no affinity weight.
- [ ] **NF-0907 (S) — Source suggestions and health hints.** `HOLD_ARCHITECTURE`. Suggest-only; no silent unsubscribe or pause.
- [ ] **Checkpoint S9:** `PLANNED`. Learned weight is explainable, reversible and Home-only.

## Independent standing lanes — not sprint scope creep

- Selective upstream audit/isolated sync with mark-all and source-state gates.
- Defensive hardening and operational risks as separately scoped review; no exploit testing.
- WallHop A/B: Path A explicit external open merged; Path B `HOLD_PRODUCT`. No activation; preserve NPM111/PR188 and source/provider admission contract. Track requalification only upon explicit GO.
- Minor visual refinements/design backlog and test debt: no incidental changes in feature PRs.
- Physical-device smoke on iPhone (Safari and installed PWA) and Galaxy Z Fold 8 with measured viewports: `EVIDENCE_GAP`, attach evidence to the ledger when performed.
