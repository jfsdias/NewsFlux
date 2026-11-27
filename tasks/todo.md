# NewsFlux execution checklist — 2026-11-21 (status reconciled 2026-11-26)

Statuses below were reconciled on 2026-11-26 against `main` `664e404197e1eb9d9aeb52f921690a95b6559190` (post-PR #321), using local git history. They use the roadmap status vocabulary (section 2). Items were PLANNED on 2026-11-21 unless marked HOLD or an existing PR. Each bullet is a focused candidate PR/task; no implementation or release authorization is implied. S = small, M = medium scope. Verify focused tests and build per [plan](plan.md); checkpoint is a material decision, not a new arbitrary review round.

## Sprint 0 — NF-E00 Foundation closeout (P0)

- [ ] **NF-0001 (S) — Summary review / existing #288.** `IN_PROGRESS`: #288 merged 2026-11-21; independent review of consent, cost and automatic behavior is still required. Review cache isolation, expiry semantics, automatic summary preference/consent, bounded inference and error UX. Acceptance: no silent paid/external transfer, repeat opens honor settings/session, error and model provenance truthful. Verify negative and real authorized model smoke only under gate. Files: existing #288 scope. Depends: none.
- [ ] **NF-0002 (S) — Governance / existing #260.** `EVIDENCE_GAP`: #260 has no merge record in local history; its open or closed state is not verified. Disposition local-only consent separately; verify fail-closed route binding and fallback, no new key/writes. Verify existing focused Python negatives. Depends: none.
- [ ] **NF-0003 (S) — QA maintenance / existing #289.** `IN_PROGRESS`: #289 merged 2026-11-21; retained gates not re-verified here. Preserve essential required gates and reproducible retired tests; no production permissions changed. Verify workflow inventory and local equivalent. Depends: none.
- [ ] **NF-0004 (S) — Reconcile source vs runtime.** `IN_PROGRESS`: source state recorded in the roadmap and project state at `664e404`. Production is OPERATOR_REPORTED at `664e404`; live parity is NOT_VERIFIED. Document exact current release identity, flags, open/closed PRs, and protected dependencies; no inferred deployment. Verify readback, obtain authorized runtime evidence only within its own gate. Files: project state/ledger. Depends: 0001–0003 dispositions.
- [ ] **NF-0005 (M) — Reader journey smoke.** `EVIDENCE_GAP`: physical device smoke pending. Focused QA for full-text native extraction and understandable provenance/failed recovery, Safari/iPhone/PWA/Fold, alternate layouts, feed discovery/health/media; close blockers only, residuals backlog. Verify functional fixtures, harness, physical device as applicable. Depends: 0004.
- [ ] **Checkpoint S0:** `IN_PROGRESS`. Existing work materially closed or explicitly parked, exact candidate and evidence status recorded; no new flags or production changes without GO.

## Sprint 1 — NF-E01 Dedup integrity (P0)

- [ ] **NF-0101 (S) — Separate display from read-state mutation.** `IN_PROGRESS`: delivered by #299; residual validation pending. Inspect current dedup helper/callers; remove automatic mark-read in display path, preserve explicit read actions; test refresh, load-more, read/star state and disabled setting. Likely files: deduplicate, contentState, useArticleList/useLoadMore and focused tests (split callers if needed). Depends: S0.
- [ ] **NF-0102 (M) — Reversible duplicate UI.** `IN_PROGRESS`: delivered by #299; residual validation pending. Show group count/expand and individual sources; keep All/Unread order, status counts and explicit action scope. Test equal-title false matches, repeated pages, keyboard/touch and pagination. Depends: 0101.
- [ ] **NF-0103 (S) — Dedup regression.** `IN_PROGRESS`: regression verification pending. Verify no unexpected canonical mutations including starred, search, filters, session switches and Mark All / next-feed; update description and documentation. Depends: 0102.
- [ ] **Checkpoint S1:** `IN_PROGRESS`. Zero unrequested canonical writes; duplicate behavior visible, reversible and covered.

## Sprint 2 — NF-E02 Smart Views MVP (P1)

- [ ] **NF-0201 (S) — Storage/query decision (HOLD until owner GO).** `IN_PROGRESS`: a storage design document exists in `docs/SMART_VIEWS_STORAGE.md`; the owner GO is not re-verified here. Reuse existing search/filter/query representation; assess account isolation, local storage lifecycle, export/reset and no cross-device sync initially. Document supported predicates and unsupported provider search semantics. Verify architecture readback. Depends: S1.
- [x] **NF-0202 (M) — Save/open explicit query.** `COMPLETED` (MVP delivered by #302). Named query re-runs against Miniflux with existing filters/sort; no cached article replica. Verify same results as manual query, empty/offline/error states and account isolation. Files: search controls, query model, selected view route. Depends: 0201.
- [x] **NF-0203 (M) — Manage saved views.** `COMPLETED` (MVP delivered by #302). Rename/delete/reorder explicitly, sensible empty state; never mutate article status. Verify persistence, settings reset, keyboard/touch and isolation. Depends: 0202.
- [x] **Checkpoint S2:** `COMPLETED`. Create → open → edit/delete usable view, no Miniflux state duplication.

## Sprint 3 — NF-E02 polish / NF-E03 continuity / NF-E04 conditional locale (P1)

- [ ] **NF-0301 (S) — Smart View shortcuts/polish.** `PLANNED`: not verified as delivered. Explicit selected scope, readable names, filter chips, navigation, no surprise jump after mark-read. Verify regressions. Depends: S2.
- [x] **NF-0302 (M) — Resume Reader.** `COMPLETED` (account-scoped continuity delivered by #303; device verification pending under Sprint 0). Approve scoped local position lifecycle; anchor position by identity/version, clamp or fall back on changed content; no read/star mutation, clear reset. Verify article close/reopen, changed content, account switch and recovery. Depends: S2 + storage gate.
- [x] **NF-0303 (M) — Resume article lists.** `COMPLETED` (delivered by #303; PWA update and scope-switch verification pending). Restore item anchor for same scope/query only, with fallback when removed; preserve new sorting/filter and next-unread semantics. Verify page refresh, PWA update, new entries and scope switch. Depends: 0302.
- [ ] **NF-0304 (S/M) — pt-BR UI.** `SUPERSEDED`: the owner reconfirmed English-only (#287) on 2026-11-26. Closed unless the owner reopens it. Original scope: reconfirm owner English-only #287 vs later roadmap endorsement; if approved, introduce locale in separate PR, validate coverage, settings migration, accessibility and summary-language independence. No broad revival of other translations.
- [ ] **Checkpoint S3:** `IN_PROGRESS`. Low-friction resume and Smart View navigation; locale only if authorized (it is not).

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

## Independent standing lanes — not sprint scope creep

- Selective upstream audit/isolated sync with mark-all and source-state gates.
- Defensive hardening and operational risks as separately scoped review; no exploit testing.
- WallHop A/B: Path A explicit external open merged; Path B `HOLD_PRODUCT`. No activation; preserve NPM111/PR188 and source/provider admission contract. Track requalification only upon explicit GO.
- Minor visual refinements/design backlog and test debt: no incidental changes in feature PRs.
