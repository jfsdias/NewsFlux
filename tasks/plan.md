# NewsFlux — product roadmap execution plan (2026-11-21; status reconciled 2026-11-26)

**Reconciliation note (2026-11-26):** this plan is carried from PR #291 with statuses reconciled to `main` `664e404197e1eb9d9aeb52f921690a95b6559190` (post-PR #321). It supersedes the planning content of PR #291; PR #291 is not closed or merged by this change. Per-sprint statuses are in [todo.md](todo.md) and in the roadmap queue table. The reconciled epic statuses are: NF-E00 IN_PROGRESS; NF-E01 IN_PROGRESS (#299); NF-E02 COMPLETED for MVP (#302); NF-E03 IN_PROGRESS (continuity delivered by #303); NF-E04 SUPERSEDED (owner English-only decision reconfirmed 2026-11-26); NF-E05 IN_PROGRESS (partially delivered by #301); NF-E06 IN_PROGRESS (#305, #306); NF-E07 HOLD_ARCHITECTURE.

**Planning basis:** owner endorsed the full Red Team / RSS benchmark direction on 2026-11-21 and requested epics and sprints. Original source baseline: `86922a91d4aa7b4d0540072a521dd8410cca2b93` (post-PR #287). This is a planning approval, not authorization to implement, merge, deploy, enable providers, or make persistent-state architecture changes. The previous audit at `08929008` is historical; current release identity is not inspected. Canonical queue: [roadmap](../docs/NEWSFLUX_ROADMAP.md). Task/checkpoint tracker: [todo.md](todo.md). GitHub Issues are disabled; track tasks here until a deliberate tracker choice.

## Direction and boundaries

- Maximize information consumed per unit of attention, not feature count. Reuse existing Miniflux APIs, source state, Reader, search/filter stack, V1 affinity, Story research, LiteLLM, and existing QA.
- Keep Miniflux authoritative for feeds, categories, read/unread and starred. All/Unread stay chronological. Editorial ranking and related coverage belong to Home or explicitly chosen views. No silent read mutations; groups are reversible and expose individual sources.
- Preserve OLED/editorial identity, opaque content, glass chrome only, single-pane-first, and 884×1104 Fold gate. Upstream sync, design, features, and infrastructure remain distinct PR purposes; review upstream selectively before each implementation sprint, never blindly merge it.
- Local-only first where practical. A new persistent model requires explicit storage/identity/isolation/sync/privacy/retention/export/deletion decision. Never treat a recommendation as a feature activation; no new sidecar by default. LiteLLM remains model/cost authority.
- No new production changes to NPM111, PR188, Miniflux or held infrastructure. WallHop A/B remain independent and gated; #257 merged, #275–277 closed without merge. Closure is not provider approval or activation.
- Real evidence: distinguish source tests, emulated browser, actual device, reported runtime and direct runtime. No repeated review loops without material risk or failed criteria; queue minor findings separately.

## Cadence and prioritization

Each sprint is a **relative delivery timebox**, suggested 1 week, not a committed calendar date; split into small scoped PRs and move on when material exit criteria are satisfied. Sprint 0 closes existing work; no new implementation lane starts until scope and GO are agreed. Sprint 1–6 deliver highest-yield slices. Sprint 7+ is conditional, not a commitment. Priority P0 = product integrity or operational continuity; P1 = high yield; P2 = valuable follow-up; P3 = optional. Effort S/M/L is relative scope, not promised duration.

| Epic                          | Priority            | Sprint        | Objective                                                                           |
| ----------------------------- | ------------------- | ------------- | ----------------------------------------------------------------------------------- |
| NF-E00 Foundation closeout    | P0                  | 0             | Reliable existing release, focused QA and source/runtime clarity                    |
| NF-E01 Dedup integrity        | P0                  | 1             | Non-destructive duplicate presentation                                              |
| NF-E02 Smart Views            | P1                  | 2–3           | Save and reuse explicit searches across supported scopes                            |
| NF-E03 Reading continuity     | P1                  | 3             | Resume Reader and lists locally                                                     |
| NF-E04 Interface locale       | P1 candidate / HOLD | 3 conditional | pt-BR only if the explicit English-only decision is reconfirmed/revised             |
| NF-E05 Editorial intelligence | P1                  | 4–6           | Story Groups, Focus, then briefing                                                  |
| NF-E06 Feed quality           | P2                  | 7             | Actionable health/quality diagnostics                                               |
| NF-E07 Advanced workflows     | P2/P3               | 8+            | Architecture-gated offline, automation, integrations, newsletters, annotations, TTS |

## Sprint exit gates and dependencies

| Sprint                            | Outcome                                      | Material exit gate                                                                                                                                                                                                           | Dependency                                        |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0 Foundation                      | Existing release fit for use                 | #288 consent/cost/automatic behavior independently reviewed; #289 preserves useful QA; #260 separately dispositioned; exact candidate SHA + release smoke plan; current state reconciled; real-device checks when authorized | Existing PRs; owner GO for any merge/deploy       |
| 1 Dedup                           | No implicit Mark Read from display filtering | Zero unauthorized read/star changes across list reload, page append, filters, duplicate/starred cases; visible reversible groups; counts correct; chronology remains                                                         | 0 scoped baseline                                 |
| 2 Smart Views MVP                 | Open a named reusable query                  | Search semantics unchanged; account/storage decision approved; CRUD and clear empty/error states; no canonical mutations                                                                                                     | 1; storage gate                                   |
| 3 Continuity / Smart Views polish | Reopen view/article without losing context   | Restore list anchor and article position safely; session/account isolation; keyboard/touch navigation; locale separately gated                                                                                               | 2; storage decision                               |
| 4 Story Groups                    | Group related Home coverage                  | Deterministic, expand every source, false-positive/false-negative fixture checks, no implicit read mutation                                                                                                                  | 1; existing research evaluation                   |
| 5 Focus                           | Explicit preference controls                 | Explainable and reversible; quiet-source diversity; comparison against V1; no All/Unread ranking                                                                                                                             | 4; preference storage decision                    |
| 6 Briefing                        | Essential-of-today view                      | Deterministic and useful without IA; optional authorized summary only; bounded source/time scope; no background inference                                                                                                    | 4–5                                               |
| 7 Feed quality                    | Actionable health review                     | Provider-backed facts with unavailable data labeled; no silent unsubscribe; no intrusive tracking                                                                                                                            | 6; analytics gate if frequency/usage state needed |
| 8+ Advanced                       | Evidence-driven expansion                    | Individual product/architecture decision and independent gates for each feature                                                                                                                                              | 7; not automatically scheduled                    |

### Sprint 0 live reconciliation

At the 2026-11-21 planning baseline, #286 and #287 were merged; #288 and #289 were then open. Reconciled 2026-11-26: #288 (merged 2026-11-21) and #289 (merged 2026-11-21) are in main history; #260 local-only consent has no merge record and its disposition is EVIDENCE_GAP. The sentences below record the original planning review criteria for #288 and #289 and remain applicable to the residual Sprint 0 verification. #288 includes automatic summaries default-on and modified evidence freshness; verify separate consent/cost boundaries, explicit preference behavior and current English-only string requirements before merge; do not imply design rejection or provider approval. #289 is a distinct maintenance PR; ensure archived local gates remain reproducible and any future WallHop activation requires applicable requalification. #270–285 release history is not evidence that the latest main is deployed. #190 merged as an offline evaluation, not V2 launch. No reactivation of closed PRs merely because roadmap mentions them.

## Definition of Ready / Done

For each task: pin current main and upstream conflict surfaces; confirm no overlap with open PRs; identify reuse and scope; agree material acceptance and authority. Build and run focused regression tests, `pnpm test:src`, `pnpm test:scripts`, `pnpm build`, lint/format/knip as applicable; use local/isolated alternatives where CI funds are unavailable and label evidence accurately. For UI, verify harness and physical iPhone/Safari (and installed PWA if relevant), Fold 884×1104, narrow phone and desktop, accessible keyboard/touch, light/dark where relevant. No new expensive global QA or repeated review without substantive reason.

Every PR carries BASE/HEAD/SCOPE/CHANGED_FILES, CODE_GATE, HARNESS_GATE, REAL_DEVICE_GATE as applicable, residual risk, and next gate. Explicit user approval required before merge and separate exact-SHA production deployment. Central Home Server ledger and source readback for consequential decisions. No claim of released behavior from source merge alone.

## Success metrics (baseline before implementation, no fabricated target)

Use consented synthetic or local aggregate measures; no automatic telemetry or new persistent collection without approval. Compare median time/steps to repeat a query, return to interrupted article, review a representative news batch, number of distinct sources in Home, duplicate false matches and canonical state mutations. Record real model request latency/error class separately; no content or credentials in logs. First sprint establishes baseline for subsequent measures.

## Open decisions

- NF-E02/E03/E05: exact account-scoped local preference semantics, storage lifecycle and portability; cross-device sync later.
- NF-E04: #287 records explicit owner decision to simplify with English only. The owner reconfirmed English-only on 2026-11-26; NF-E04 pt-BR locale is SUPERSEDED/CLOSED unless the owner reopens it. UI locale differs from summary language.
- NF-E05: evaluate existing V1 and Story code before adopting experimental functionality; reject silent ranking and auto-read.
- NF-E07: demand and architecture proof before offline cache, persistent notes or automatic mutations.
- WallHop HOLD remains intact; provider/source policy and real-device gate independent from Summary priority.
