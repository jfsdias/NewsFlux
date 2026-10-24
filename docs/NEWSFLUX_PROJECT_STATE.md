# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-24 (post-PR #108).
- **Current snapshot:** GitHub `main` at `bc9f175a3447a67b06d7deee12c6e19374bb7664` (PR #108 merge). Production is deployed at `bc9f175a3447a67b06d7deee12c6e19374bb7664` (image `newsflux-local:bc9f175a3447`, container `newsflux`, verified live via read-only SSH); main and production are in full parity (`MAIN_PRODUCTION_PARITY=YES`).
- **Previous snapshot (historical):** GitHub `main` at `fa27a4cec1cae1e887041ee3999622c5b8f76681` (PR #96 merge) on 2026-10-23; production was at `96bd1fe563571bfa322b2fd79f6fc12f49107a76`. The earlier 2026-10-22 and 2026-10-21 snapshots are preserved below.
- **Related planning documents:** [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) and [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (planning only; no implementation authorized).

## Current state (post-PR #108, 2026-10-24)

GitHub merge facts and production runtime state are verified live from the repository and read-only SSH container inspection. PR #108 is merged into `main` and promoted to production at SHA `bc9f175a3447a67b06d7deee12c6e19374bb7664`. The production container `newsflux` is running `newsflux-local:bc9f175a3447` with OCI revision `bc9f175a3447a67b06d7deee12c6e19374bb7664`, 0 restarts, internal HTTP 200, public root HTTP 200, public `/all` SPA fallback HTTP 200, and static 404 canary returning true 404. Main and production have full parity. PR #106 remains an open parallel draft track and is incomplete.

```text
DOCS_DATE=2026-10-24
CURRENT_MAIN=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCT_MAIN_BASELINE=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_SHA=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_IMAGE=newsflux-local:bc9f175a3447
PRODUCTION_VERIFICATION=LIVE_VERIFIED_READ_ONLY_SSH_EXACT_SHA
PRODUCTION_CONTAINER=newsflux
PRODUCTION_CONTAINER_STARTED_AT=2026-10-24T04:41:41Z
PRODUCTION_RESTART_COUNT=0
PRODUCTION_IMAGE_REVISION=PASS_bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_COMPOSE_CONFIG=/dockerdata/compose/newsflux/compose.yaml
PRODUCTION_INTERNAL_HTTP=PASS_200
PRODUCTION_PUBLIC_HTTP=200
PRODUCTION_PUBLIC_ALL_HTTP=200
PRODUCTION_ASSET_404_CANARY=PASS_404
MAIN_PRODUCTION_PARITY=YES
PR108_DEPLOYED=YES

PR97_STATUS=MERGED_DOCUMENTATION
PR97_MERGE_SHA=a02dd5e7f3aa30253e228c40180f1c8b9e2972b1
PR98_STATUS=MERGED_DEPENDABOT_GOVERNANCE
PR98_MERGE_SHA=231809c7a74b833718a87e0cb78091f89dd00570
PR99_STATUS=MERGED_NNW01P_SOURCE_ICON_PRIVACY
PR99_MERGE_SHA=cb0b200eb5cfd4d8b7e8af3b97a4fa57008b814f
PR100_STATUS=MERGED_NNW01A_SOURCEMARK_PRIMITIVE
PR100_MERGE_SHA=1430674d4322a1703e946bd5fc69c8c3f5bc2fee
PR101_STATUS=MERGED_NNW01B_SOURCEMARK_ADOPTION_SIDEBAR_LISTS
PR101_MERGE_SHA=c7dd7835f90f433323d2c0360c2d34528f95ab61
PR102_STATUS=MERGED_NNW01C_SOURCEMARK_ADOPTION_READER_SETTINGS
PR102_MERGE_SHA=6316f0993c4e45cc84459d84d46a955f2a021dae
PR103_STATUS=MERGED_NNW01D_SOURCEMARK_ADOPTION_FEED_HEADER
PR103_MERGE_SHA=36a78492fec4a673394a7b2b03f4b0a48cde987e
PR104_STATUS=MERGED_NNW02A_NAVIGATION_DENSITY_AUDIT
PR104_MERGE_SHA=b3dcb3c29ad1bb2352381cf79065a8f07167346c
PR105_STATUS=MERGED_NAV_VISUAL_MEDIUM_RAIL
PR105_MERGE_SHA=06e76dcef0f29ed4a104bfe5a3a935719ec46575
PR106_STATUS=OPEN_PARALLEL_STORY_CANDIDATE_RANKING_INCOMPLETE
PR106_HEAD=8f8e59cc1151680cfce3f8475a99aa671de4829b
PR106_DRAFT=YES
PR107_STATUS=MERGED_DESKTOP_COARSE_POINTER_SAFETY
PR107_MERGE_SHA=e50a6b9c494e9fd5c47baa24791249c3f30f5906
PR108_STATUS=MERGED_NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS
PR108_MERGE_SHA=bc9f175a3447a67b06d7deee12c6e19374bb7664

NNW01_SOURCE_IDENTITY=COMPLETED_THROUGH_SLICES_P_A_B_C_D
NNW02A_NAVIGATION_DENSITY_AUDIT=COMPLETED
NAV_VISUAL_MEDIUM_RAIL=COMPLETED
DESKTOP_COARSE_POINTER_SAFETY=COMPLETED
NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS=COMPLETED
PR106_STORY_CANDIDATE_RANKING=PARALLEL_OPEN_INCOMPLETE

NON_NEGOTIABLE_BOUNDARIES=MINIFLUX_IS_SOURCE_OF_TRUTH;NO_NEW_PERSISTENT_STATE_WITHOUT_DECISION;CHRONOLOGICAL_UNREAD_ALL_NO_SILENT_RANKING;GLASS_CHROME_ONLY_OPAQUE_CONTENT;SINGLE_PANE_FIRST_MOBILE_TABLET_FOLD;CRITICAL_MEDIUM_884X1104;NO_BLIND_UPSTREAM_SYNC;EXACT_SHA_DEPLOY_ONLY

PRESERVED_FINDINGS=REACT19_ARCO_ELEMENT_REF;RESIZEOBSERVER_LOOP;MOBILE_SCROLL_FLICKER_01;FOOTERPANEL_CLIPPING;HOME_PAGINATION_CURSOR_STALL_01_NOT_REPRODUCED

CURRENT_PHASE=POST_PR108_CANONICAL_RECONCILIATION
LAST_COMPLETED_FUNCTIONAL=NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS / PR #108
RECOMMENDED_NEXT_TRACK=NNW-05_RESEARCH_STUDY
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
PRODUCTION_MUTATIONS=NO
```

### Live PR inventory (PRs #97 – #108)

| PR   | Title                                                                | Status       | Merge / Head SHA                           | Description                                                      |
| ---- | -------------------------------------------------------------------- | ------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| #97  | docs: reconcile post-PR96 and overnight NewsFlux state               | MERGED       | `a02dd5e7f3aa30253e228c40180f1c8b9e2972b1` | Post-PR96 documentation reconciliation                           |
| #98  | chore(ci): integrate upstream Dependabot governance                  | MERGED       | `231809c7a74b833718a87e0cb78091f89dd00570` | Upstream Dependabot configuration & governance                   |
| #99  | fix(source-identity): remove third-party favicon fallback            | MERGED       | `cb0b200eb5cfd4d8b7e8af3b97a4fa57008b814f` | NNW01-P privacy/network source icon baseline (no 3P leakage)     |
| #100 | feat(source-identity): add SourceMark primitive                      | MERGED       | `1430674d4322a1703e946bd5fc69c8c3f5bc2fee` | NNW01-A SourceMark reusable primitive                            |
| #101 | feat(source-identity): adopt SourceMark in Sidebar and article lists | MERGED       | `c7dd7835f90f433323d2c0360c2d34528f95ab61` | NNW01-B SourceMark adoption in Sidebar and article lists         |
| #102 | feat(source-identity): complete Reader source identity adoption      | MERGED       | `6316f0993c4e45cc84459d84d46a955f2a021dae` | NNW01-C SourceMark adoption in Reader and Settings               |
| #103 | feat(source-identity): add SourceMark to Feed header                 | MERGED       | `36a78492fec4a673394a7b2b03f4b0a48cde987e` | NNW01-D SourceMark adoption in Feed header                       |
| #104 | docs(nav): audit navigation density baseline                         | MERGED       | `b3dcb3c29ad1bb2352381cf79065a8f07167346c` | NNW-02A navigation density and tap-target audit                  |
| #105 | feat(nav): add medium navigation rail                                | MERGED       | `06e76dcef0f29ed4a104bfe5a3a935719ec46575` | 80px Medium Navigation Rail for viewports 768px-991px            |
| #106 | feat(story): integrate local candidate ranking pipeline              | OPEN (Draft) | `8f8e59cc1151680cfce3f8475a99aa671de4829b` | Story Candidate Ranking parallel lane (INCOMPLETE, DO NOT TOUCH) |
| #107 | fix: ensure 48px navigation targets for coarse pointers              | MERGED       | `e50a6b9c494e9fd5c47baa24791249c3f30f5906` | Desktop and coarse-pointer safety overrides (min 48px targets)   |
| #108 | feat(a11y): use native sidebar navigation semantics                  | MERGED       | `bc9f175a3447a67b06d7deee12c6e19374bb7664` | Native links, button disclosures, and keyboard semantics         |

### Next-track decision matrix

| Candidate | Track Name                    | Status   | Dependencies                         | Decision Required                                                                                                                 | Overlap with PR #106 | Recommended Next             | Rationale                                                                                                          |
| --------- | ----------------------------- | -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A         | PR106_STORY_CANDIDATE_RANKING | PARALLEL | None (open draft PR #106)            | PM runtime-parity review & gate closure                                                                                           | YES (is PR #106)     | NO                           | Active parallel lane; must remain isolated without duplication or modification.                                    |
| B         | NAV-02F                       | HOLD     | NAV-02 R2 baseline (PR105, 107, 108) | Product decisions on: unread category grouping, desktop sidebar width, showUnreadFeedsOnly persistence, unread count badge format | NO                   | NO                           | Unresolved product decisions; guessing semantics violates core project boundaries.                                 |
| C         | NNW-02B                       | HOLD     | NNW-02A audit (PR104)                | None (PM decided NOT to pursue general density/count-group redesign now)                                                          | NO                   | NO                           | Preserves explicit PM decision to defer general density redesign.                                                  |
| D         | NNW-03 / CHROME-01            | HOLD     | None                                 | Product decisions on contextual control consolidation across top bar and reader header                                            | NO                   | NO                           | `HOLD_PRODUCT_DECISION`. Contextual chrome consolidation remains unresolved.                                       |
| E         | NNW-05                        | READY    | None                                 | PM authorization for bounded research study                                                                                       | NO                   | **YES (Recommended)**        | Bounded research-only study of multi-pane and reference architectures strictly within single-pane-first boundary.  |
| F         | PWA-01A Installability        | HOLD     | PWA-00 baseline                      | Product/design decisions on D1 (manifest ID), D2 (manifest theme colors), D3 (maskable icon art)                                  | NO                   | NO                           | Implementation blocked on open PM decisions D1, D2, D3.                                                            |
| G1        | AUTH_APIKEY_01                | HOLD     | Approved consent lifecycle           | PM authorization to begin implementation                                                                                          | NO                   | NO                           | Implementation on hold preserving consent/verification lifecycle.                                                  |
| G2        | SECURITY_HEADERS_01           | READY    | None                                 | Confirmation of Caddy security header policy (CSP, X-Content-Type-Options, etc.)                                                  | NO                   | ALTERNATIVE (Implementation) | Bounded, identifiable scope in Caddyfile/compose; alternative next implementation track once CSP policy is locked. |

## Historical state (post-PR #96, 2026-10-23; superseded by post-PR #108 section above)

GitHub merge facts are verified from the live repository. The production receipt for PR #95 is owner-provided (`PM_REPORTED`): it records the exact image/revision, internal and public HTTP checks including the asset-404 canary as passing, and preservation of the rollback image and compose backup. A separate fresh-browser About check reported the same production revision. The supplied receipt did not include a restart count. PR #96 is merged into `main` but has not been deployed; the historical snapshots below remain dated evidence and do not override this current state.

```text
DOCS_DATE=2026-10-23
CURRENT_MAIN=fa27a4cec1cae1e887041ee3999622c5b8f76681
PRODUCT_MAIN_BASELINE=fa27a4cec1cae1e887041ee3999622c5b8f76681
PRODUCTION_ABOUT_REVISION=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_IMAGE=newsflux-local:96bd1fe56357
PRODUCTION_RECEIPT=PM_REPORTED_OWNER_PROVIDED_PR95_EXACT_SHA
PRODUCTION_IMAGE_REVISION=PASS
PRODUCTION_INTERNAL_HTTP=PASS
PRODUCTION_PUBLIC_HTTP=200
PRODUCTION_ASSET_404_CANARY=PASS
PRODUCTION_ROLLBACK_IMAGE_AND_COMPOSE_BACKUP=PRESERVED
PRODUCTION_RESTART_COUNT=NOT_REPORTED
MAIN_PRODUCTION_PARITY=NO
PR96_DEPLOYED=NO

PR88_STATUS=MERGED
PR88_MERGE_SHA=3a1b2db07d9df08b8dde9f3148a02e6eb703ec7c
PR90_STATUS=MERGED_PWA03A1
PR90_MERGE_SHA=5ea21363676dd93dde97fd5ff8548e89864495ec
PR91_STATUS=MERGED_PWA03A2A
PR91_MERGE_SHA=de8b4645df1b8ce17b4b02c2d54adb694af25109
PR92_STATUS=MERGED_DOCUMENTATION
PR92_MERGE_SHA=f630fe8843a16a9ff810662632a7b6f253285151
PR93_STATUS=MERGED_PWA03A2C
PR93_MERGE_SHA=950ae61b71433a6fd9c11fed9ed266a17fee3185
PR94_STATUS=MERGED_PWA03A2C1
PR94_MERGE_SHA=6a8068e9809cafdecce0c695c78dcb151d95d4a4
PR95_STATUS=MERGED_PWA03A2B
PR95_MERGE_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PWA03A2A=COMPLETE_MERGED
PWA03A2C=COMPLETE_MERGED
PWA03A2C1=COMPLETE_MERGED
PWA03A2B=COMPLETE_MERGED
PWA03A2=COMPLETE_IN_PRODUCTION_AT_96bd1fe

PR96_STATUS=MERGED
PR96_FEATURE_HEAD=98a1f93f9a9ccb411230c041726c4dece1f4e1b9
PR96_MERGE_SHA=fa27a4cec1cae1e887041ee3999622c5b8f76681
API_NONIDEMPOTENT_RETRY_01=COMPLETE
PR96_SIDE_EFFECTING_GET_UPDATE_CONTENT_TRUE=RETRY_FALSE
PR96_POST_PUT_MUTATIONS=RETRY_FALSE_BY_DEFAULT
PR96_RAW_POST_PUT_PATCH_DELETE=RETRY_FALSE_BY_DEFAULT
PR96_EXPLICIT_RETRY_OPT_IN=PRESERVED
PR96_SAFE_GET_RETRIES=PRESERVED
PR96_FOCUSED_API_TESTS=20_OF_20_PASS
PR96_FULL_NODE=513_PASS_2_SKIPPED
PR96_LINT_PRETTIER_BUILD_DIFF_CHECK=PASS
PR96_LIVE_MINIFLUX_WRITES=0

UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_INTEGRATED_UPSTREAM_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_UPSTREAM_SYNC_PR=85
LAST_UPSTREAM_SYNC_MERGE_SHA=d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc
UPSTREAM_CYCLE=CLOSED

PWA01A_AUDIT=COMPLETE
PWA01A_IMPLEMENTATION=HOLD_PM_DECISIONS_D1_MANIFEST_ID_AND_D3_MASKABLE_ICON
PWA01A_PHYSICAL_INSTALL_AND_DEEP_LINK_GATES=NOT_RUN
PWA01B_AUDIT=COMPLETE
PWA01B_IMPLEMENTATION=HOLD_PM_DECISION_D2_MANIFEST_THEME_AND_BACKGROUND_POLICY
PWA01B_RUNTIME_THEME_META=ALREADY_UPDATES_DURING_THEME_CHANGE
STATS01_READINESS=HOLD_PRODUCT_DEFINITION_REQUIRED
STATS01_IMPLEMENTED=NO
STATS01_NEW_PERSISTENCE=NO

STORY00R2B_STATUS=COMPLETE_REJECT
STORY00R2B_MODEL=MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7_FULL_ONNX_FP32
STORY00R2B_PRIMARY_POOLED_S1_AUC=0.647_FAIL_BELOW_0.70
STORY00R2B_SECOND_MODEL=NO
STORY00R2B_LEXICAL_STAGE0_AUC=0.904_DEVELOPMENT_EVIDENCE_ONLY_NOT_ADOPTED
STORY00R2B_POSITIVES_NEVER_CANDIDATES=47_OF_113
STORY00R2B_POSITIVES_VETOED=7
STORY00R2B_PERFECT_VERIFIER_RECALL_CEILING=0.522
STORY00R2B_NEXT=STORY00_R3A_CANDIDATE_GENERATION_FORENSICS

STORY01_ARCHITECTURE=DETERMINISTIC_CONSERVATIVE_V1
STORY01_P1=APPROVED_B_UNREAD_NEWEST_PUBLISHED_LOWEST_ID
STORY01_P2=APPROVED_A_FROZEN_BLIND_SAMPLE_GE72_AUTO_MERGES_0_FALSE_MERGES
STORY01_P3=APPROVED_A_FOR_ENGINE_B_FOR_RELEASE
STORY01_P4=HOLD_PENDING_HOME_COVERAGE_MEASUREMENT
STORY01_IMPLEMENTATION_AUTHORIZED=NO

AUTO01_D1=RESOLVED
AUTO01_V1=MINIFLUX_NATIVE_BLOCK_KEEP_RULES__NEW_ENTRIES_WEBHOOK_TO_N8N__SAVE_ENTRY_WEBHOOK_TO_N8N
NEWSFLUX_TO_N8N_DIRECT_PATH=NO
AUTO01_NEW_PERSISTENCE=NO
AUTO01_D5=RESOLVED_BY_PR96
AUTO01_D3_D4=ENVIRONMENT_DIAGNOSTICS

NNW01_D7=NO_THIRD_PARTY_FAVICON_LOOKUP
NNW01_ICON_PRIORITY=MINIFLUX_PROVIDER_ICON__LOCAL_DETERMINISTIC_MONOGRAM__LOCAL_DEFAULT_ICON
NNW01_READY_FOR_DESIGN=YES
NNW01_IMPLEMENTATION_AUTHORIZED=NO

AUTH_APIKEY_01=ARCHITECTURE_APPROVED_IMPLEMENTATION_HOLD
AUTH_APIKEY_01_LIFECYCLE=CONSENT_PASSWORD_LOGIN_CREATE_KEY_VERIFY_V1_ME_STORE_TOKEN_AND_KEY_ID_THEN_DROP_PASSWORD_LOGOUT_REVOKES_OWN_KEY_FIRST
SECURITY_HEADERS_01=SEPARATE_BACKLOG
SECURITY_HEADERS_01_MIX_WITH_NNW_OR_PWA=NO
STATS01_STATUS=HOLD_PRODUCT_DEFINITION_REQUIRED

HOME_PAGINATION_CURSOR_STALL_01=NOT_REPRODUCED_AFTER_PR87
HOME_CURSOR_HARNESS=10_OF_10_PASS
HOME_TIE_RECOVERY=23_OF_23_INCLUDING_PREVIOUSLY_OMITTED_ID
HOME_DUP_ROOT_CAUSE_01=SEPARATE_INITIAL_DUPLICATE_ID_FINDING_CLOSED_BY_PR77
HOME_IMPLEMENTATION_CHANGED_IN_THIS_QUEUE=NO

PR97_STATUS=OPEN_DRAFT_DOCUMENTATION_RECONCILIATION
CURRENT_DOCS_PR=97

PWA_FOUNDATION=IMPLEMENTED_RUNTIME_AND_OPEN_INSTALLABILITY_DECISIONS
NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT
PWA_PARTIALLY_EXISTS_IN_MAIN=YES
NNW_IMPLEMENTATION_AUTHORIZED=NO
SOURCE_IDENTITY_DEFINITION=CONFIRMED_PUBLISHER_FEED_SOURCE_LEVEL_VISUAL_IDENTITY
STORY_IDENTITY_IN_NNW01=NO

CURRENT_PHASE=POST_PR96_DOCUMENTATION_RECONCILIATION
CURRENT_PRIMARY_TRACK=PR97_DOCUMENTATION_RECONCILIATION
LAST_COMPLETED_FUNCTIONAL=API_NONIDEMPOTENT_RETRY_01 / PR #96
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
PRODUCTION_MUTATIONS=NO

PWA_DOCUMENTATION_DECISIONS_OPEN=D1_MANIFEST_ID;D2_MANIFEST_COLORS;D3_MASKABLE_ICON_ART
STATS01_BLOCKER=METRIC_DEFINITION_AND_PRESENTATION_SEMANTICS
DOCUMENTATION_ACTION=UPDATE_IN_SCOPE
DOCUMENTATION_TARGETS=NEWSFLUX_PROJECT_STATE.md;NEWSFLUX_ROADMAP.md;PWA_ARCHITECTURE.md
PROJECT_STATE_RECONCILED=YES_PENDING_DRAFT_REVIEW
```

The prior post-PR #95 block and all earlier dated snapshots remain historical evidence. Their PR #96 open-state, head, STORY-00R2B and production-parity values describe those snapshots only; they are superseded by this current block. PR #96 is merged, while PR #97 is this documentation-only Draft.

The historical `PWA_FOUNDATION=PLANNED` and current `NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT` values describe planning/design scope only; neither authorizes implementation, merge or deployment. Remaining PWA decisions are D1 (manifest ID), D2 (manifest theme/background policy), D3 (maskable icon art), D5 (`ID-DEPLOY-01` or waiver), D6 (update policy) and D9 (offline reading); D4 production topology is partially resolved as noted below. AUTH_APIKEY_01's architecture is approved while implementation remains on hold, preserving its consent and verification lifecycle. NNW-01 D7 is resolved: no third-party favicon lookup, with provider icon → local deterministic monogram → local default icon. The sections below that carry 2026-10-21 and 2026-10-22 values are retained as historical records and are superseded by this section.

### Production topology (D4 — partially resolved, `PM_REPORTED`)

Operational evidence supplied by the PM; **not** verified from the repository. PWA-00 (2026-10-22) could not reach the public origin from its environment (egress policy), so this block stays `PM_REPORTED`; the runbook that closes it is `PWA_00_BASELINE.md` §4.4. Details and consequences: `PWA_ARCHITECTURE.md` §3.4.

- Public NewsFlux origin: `https://news.jfsdias.ddns.net/`.
- TLS / reverse proxy: Nginx Proxy Manager; Docker network `npm-proxyyml_default`; internal NewsFlux service `http://newsflux:2000`.
- Production image contract: the exact `newsflux-local:<shortcommit>` SHA, never an implicit `latest` or a moving branch.
- The Miniflux API origin remains user-configurable and is treated as potentially cross-origin. **NewsFlux and Miniflux are not assumed to share an origin** unless PWA-00 measures it.

## Historical state (2026-10-21 snapshot; superseded by the section above)

The GitHub, product and production values in the original 2026-10-21 pre-reconciliation snapshot below remain an immutable historical record. At that snapshot, GitHub `main` was `313991e80c2b54a99819c2e267ef90a35a959752`; product and production were at PR #81 merge SHA `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`; runtime, HTTP and exact image/revision checks passed; no restart count was included in the receipt; and GitHub had no open PRs before that reconciliation began. The live candidate state checked on 2026-10-22 is recorded separately below.

```text
DOCS_DATE=2026-10-21
DOCUMENTATION_SNAPSHOT_BASE_SHA=313991e80c2b54a99819c2e267ef90a35a959752
GITHUB_MAIN_AT_RECONCILIATION=313991e80c2b54a99819c2e267ef90a35a959752
CURRENT_PRODUCT_BASELINE=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PRODUCTION_SHA=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PRODUCTION_IMAGE=newsflux-local:dc72a6ed0069
PRODUCTION_IMAGE_ID=sha256:3ada4fb3ef18c3fd1398a67aa6ce5118c8cb88c6533775e534779cb820bde83b
PRODUCTION_STATUS=running
INTERNAL_HTTP=PASS
PUBLIC_HTTP=200
PRODUCTION_REVISION_LABEL=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
EXACT_IMAGE_REVISION=PASS
PRODUCT_PRODUCTION_PARITY=PASS
MAIN_AHEAD_OF_RUNTIME_REASON=DOCUMENTATION_ONLY_PR79
DEPLOY_REQUIRED_FOR_PR79=NO
OPEN_PRS_AT_SNAPSHOT=NONE
CURRENT_PR_AT_SNAPSHOT=NONE_BEFORE_THIS_RECONCILIATION

PR70_STATUS=MERGED
PR70_MERGE_SHA=2a858ede20e02c2c6532fa32bae4468cb64c30ea
PR75_STATUS=MERGED
PR75_SCOPE=DOCS_LINT_01_FORMATTING_ONLY
PR75_MERGE_SHA=8807469296db5815b9fc6e961d4f12275234574b
PR79_STATUS=MERGED
PR79_SCOPE=docs/research/**_ONLY
PR79_HEAD=4e25d25ba945666adbe741b98483ef54cd64682f
PR79_MERGE_SHA=313991e80c2b54a99819c2e267ef90a35a959752
PR79_PURPOSE=DURABLE_RESEARCH_ARCHIVE_AND_POST_PR81_RECONCILIATION
PR80_STATUS=CLOSED_WITHOUT_MERGE
PR80_HEAD=5dda6c6abb47bf829dafc646e33fa6c6713ad9c1
PR80_PURPOSE=RESEARCH_ONLY_DISCOVERY_BENCHMARK_V1_HARNESS
PR80_PRODUCT_AUTHORITY=NO
PR80_CORPUS_SUFFICIENCY=PASS_FOR_CONTINUED_RESEARCH
PR80_G1_CANDIDATE_GENERATION=VIABLE_RESEARCH_SIGNAL
PR80_G1_RECALL_AT_5=0.075
PR80_G1_RECALL_AT_10=0.125
PR80_G1_MRR=0.057
PR80_G2=NO_USEFUL_SIGNAL
PRODUCT_RANKING_ADOPTION=NO
BROAD_SOURCE_DISCOVERY=HOLD
PR80_RAW_PRIVATE_BENCHMARK_ARTIFACTS_COMMITTED=NO
PR81_STATUS=MERGED_DEPLOYED_VALIDATED
PR81_FEATURE=ADD-FEED-DISCOVER-01
PR81_MERGE_SHA=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PR81_WEBSITE_URL_DISCOVERY=SHIPPED
PR81_EXPLICIT_CONFIRMATION_OR_SELECTION=YES
PR81_SUBSCRIBE_ONLY_AFTER_CONFIRMATION=YES
PR81_DIRECT_FEED_URL_PATH_PRESERVED=YES
PR81_CATEGORY_AND_CRAWLER_PRESERVED=YES
PR81_AUTOMATED_SAFARI_FOCUS_AND_CANARY_GATES=PASS
PR81_CANARY_CLEANUP=ABSENT_BY_ID_AND_URL_COUNT_RESTORED
PR81_DELETE_STATUS_FINDING=HTTP_404_NEEDS_REPRO_NON_BLOCKING
CURRENT_OPEN_FINDINGS=ADD_FEED_DISCOVERY_DUPLICATE_URL_01;MINIFLUX_DELETE_STATUS_01;MOBILE_SCROLL_FLICKER_01;HOME_PAGINATION_CURSOR_STALL_01;HOME_DUP_ROOT_CAUSE_01;FOOTERPANEL_CLIPPING;NAV_HARNESS_DESKTOP_MODEL;REACT19_ARCO_ELEMENT_REF;RESIZEOBSERVER;SOURCE_IDENTITY;STORY_IDENTITY;PREFERENCE_STORAGE
ADD_FEED_DISCOVERY_DUPLICATE_URL_01=LOW_NON_BLOCKING_VISUAL_POLISH
MINIFLUX_DELETE_STATUS_01=NEEDS_REPRO_NON_BLOCKING
BROAD_SOURCE_DISCOVERY=HOLD
PERSONALIZED_RANKING=DO_NOT_BROADEN_WITHOUT_EXPLICIT_AUTHORIZATION
PREFERENCE_STORAGE=ARCHITECTURE_SOURCE_OF_TRUTH_PRIVACY_DECISION_REQUIRED

MINIFLUX_FETCH_SECURITY_MIGRATION=PASS
GLOBAL_PRIVATE_NETWORK_FETCH_ALLOWANCE=DISABLED
RSS_BRIDGE_PRIVATE_ACCESS=DEDICATED_PROXY_ALLOWING_ONLY_rss-bridge:80

UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_UPSTREAM_SYNC_SET=PR11_AA68CB53_6963069B_B587A964_0887F714
UPSTREAM_MAIN=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_INTEGRATED_UPSTREAM_SHA=0887f714c36cc6c999f8b4559fa14c7948598629
LAST_UPSTREAM_SYNC_PR=11
LAST_UPSTREAM_SYNC_MERGE_SHA=cef9d8faf543d297e3393b1de314c57b01d99af9
PR11_AA68CB53=INTEGRATED_FILTERED_EMPTY_COUNTS
PR11_6963069B=INTEGRATED_MARK_ALL_FILTER_SESSION_HARDENING
PR11_B587A964=INTEGRATED_MUTATION_TOTAL_REFRESH
PR11_0887F714=RETAINED_IN_UPSTREAM_ANCESTRY
PR11_SEARCH_AUTOFOCUS_TREE_CHANGE=SKIPPED_EQUIVALENT_BEHAVIOR_ALREADY_EXISTED
NEXT_UPSTREAM_ITEM=ADAPT_3b2b08fb_EMPTY_CAPTION_ELEMENT_RENDERING
NEXT_UPSTREAM_ITEM_INTEGRATED=NO
3b2b08fb_NOT_INTEGRATED=YES
UPSTREAM_INTEGRATION_STATUS=QUEUED_FOR_DEDICATED_SYNC_NOT_INTEGRATED
ARTICLE_LIST_MUTATION_HARDENING=NO_NEW_CHANGE_IN_LATEST_RANGE
MARK_ALL_READ_REGRESSION_GATES=UNAFFECTED_BY_LATEST_RANGE

CURRENT_PHASE=PROJECT_STATE_RECONCILIATION
CURRENT_PRIMARY_TRACK=DOCUMENTATION_MAINTENANCE
CURRENT_PR=NONE_AT_PRE_RECONCILIATION_SNAPSHOT
LAST_COMPLETED_FUNCTIONAL=ADD-FEED-DISCOVER-01 / PR #81
LAST_COMPLETED_DOCUMENTATION=RESEARCH_ARCHIVE / PR #79
NEXT_FUNCTIONAL_TRACK=DEDICATED_UPSTREAM_SYNC
DOCS_LINT_01_STATUS=COMPLETED_BY_PR75
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

## Historical: active parallel candidates (checked 2026-10-22 morning; superseded)

PR #82 remains the open Draft documentation reconciliation. Two isolated, PM-reviewed Draft candidates are active behind it: PR #84 for backend delete-contract hardening and PR #83 for duplicate-URL discovery presentation polish after the backend refresh. Neither candidate is merged or deployed.

```text
LIVE_GITHUB_MAIN=313991e80c2b54a99819c2e267ef90a35a959752
PR82_STATUS=OPEN_DRAFT
PR83_STATUS=OPEN_DRAFT
PR83_TRACK=ADD-FEED-DISCOVERY-UX-01
PR83_HEAD=07883336becf7f16855af5736da4dafb33a34146
PR83_PM_REVIEW=PASS
PR83_MERGED=NO
PR83_DEPLOYED=NO
ADD_FEED_DISCOVERY_DUPLICATE_URL_01=ACTIVE_CANDIDATE_PR83_NOT_YET_RESOLVED_IN_MAIN
PR84_STATUS=OPEN_DRAFT
PR84_TRACK=MINIFLUX-DELETE-CONTRACT-01
PR84_HEAD=1328e5f469b322c6059e7e998a1dff9aa8eb4f00
PR84_PM_REVIEW=PASS
PR84_MERGED=NO
PR84_DEPLOYED=NO
MINIFLUX_DELETE_STATUS_01=ACTIVE_CANDIDATE_PR84_NOT_YET_RESOLVED_IN_MAIN
MINIFLUX_DELETE_RETRY_HAZARD_CONFIRMED=YES
HISTORICAL_404_CAUSATION=HIGH_CONFIDENCE_NOT_PROVEN
ACTIVE_PARALLEL_CANDIDATES=PR83_ADD_FEED_DISCOVERY_UX_01;PR84_MINIFLUX_DELETE_CONTRACT_01
CURRENT_INTEGRATION_ORDER=PR82_DOCUMENTATION;PR84_BACKEND;PR83_DESIGN_AFTER_REFRESH;DEDICATED_UPSTREAM_SYNC_3b2b08fb
NEXT_ORDERED_MAINTENANCE_AFTER_ACTIVE_CANDIDATES=DEDICATED_UPSTREAM_SYNC_3b2b08fb
UPSTREAM_3b2b08fb_STATUS=QUEUED_NOT_INTEGRATED
```

Main may advance through documentation-only merges without changing the product/runtime baseline or requiring deployment. The 2026-10-21 snapshot remains historical. As of the live 2026-10-22 check, PR #83 and PR #84 are active, isolated Draft candidates and neither is merged or deployed. The current integration order is PR #82 documentation, PR #84 backend, PR #83 design after refresh, then the dedicated upstream sync for `3b2b08fb`. That upstream item remains queued, not integrated, and is sequenced after the active candidates rather than cancelled or permanently deprioritized.

**Superseded:** PR #82, PR #83, PR #84 and the dedicated upstream item (PR #85) are all merged; see the current state above.

## Historical snapshot: PR #73 reconciliation (2026-10-20)

The following block preserves the previous snapshot and the material reconciled at that time. Its current-state values have been superseded by the 2026-10-21 snapshot above; headings and sequencing inside this block are historical and are not current directives.

At the PR #73 reconciliation snapshot on 2026-10-20, GitHub `main` was `32244fa07b57c8bb3f5682f27b4d94917384ce63`, while the product and production baseline was `d01e34fc2eb76da39467d1de9799b12194faec9c`. PR #72 and PR #73 are documentation-only; such merges may advance GitHub `main` without changing the product/runtime baseline or requiring deployment. Product/production parity remains intact. PR #73 completes the post-PR72 reconciliation. PR #70 remains the open draft functional candidate, sequenced after the separate DOCS-LINT-01 PR.

```text
DOCS_DATE=2026-10-20
DOCUMENTATION_SNAPSHOT_BASE_SHA=32244fa07b57c8bb3f5682f27b4d94917384ce63
GITHUB_MAIN_AT_RECONCILIATION=32244fa07b57c8bb3f5682f27b4d94917384ce63
CURRENT_PRODUCT_BASELINE=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCT_PRODUCTION_PARITY=PASS
MAIN_MAY_ADVANCE_WITH_DOCS_ONLY_COMMITS=YES
DEPLOY_REQUIRED_FOR_DOCS_ONLY_COMMITS=NO
PR72_STATUS=COMPLETED
PR72_MERGE_SHA=32244fa07b57c8bb3f5682f27b4d94917384ce63
PR72_SCOPE=DOCUMENTATION_ONLY
PR73_SCOPE=DOCUMENTATION_ONLY
POST_PR72_MAIN_PRODUCT_BASELINE_RECONCILIATION=COMPLETED_BY_PR73

PR62_STATUS=COMPLETED
PR62_HEAD_SHA=f6d25046ec455eb2b9be664394e14d7e83a36d73
PR62_BASE_SHA=405e9d7b1a3097dacef50c7908abf83d480d64dd
PR62_BRANCH=docs/post-input01a-nav-visual-contract
PR62_MERGE_SHA=389ed58731c38ffff8ceda0d0347222336960f3a

PR57_STATUS=COMPLETED
PR57_MERGE_SHA=85b9590bbc9f4d3488fd30694b0b45553fefda5b
PR58_STATUS=COMPLETED
PR58_MERGE_SHA=df4bea4dde5cca86a4b822d2e82f01156bb96f1a
PR59_STATUS=COMPLETED
PR59_MERGE_SHA=114eed13c5f66cd57a4448ece935de6cb5f4a11e
PR60_STATUS=COMPLETED
PR60_MERGE_SHA=31c95ff835da3e716acfd6eb115db5c3b68dd71c
PR61_STATUS=COMPLETED
PR61_MERGED=YES
PR61_DRAFT=NO
PR61_BASE_SHA=31c95ff835da3e716acfd6eb115db5c3b68dd71c
PR61_HEAD_SHA=e2cbab710f00eb84c77b3df4ddc9701839a677d9
PR61_MERGE_SHA=194a1db007902411abe91459b45a19b10c76e701
PR63_STATUS=COMPLETED
PR63_FEATURE_HEAD=9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8
PR63_MERGE_SHA=723bdbb96e4445d267b443422a0be7a83e5b4f8a
PR63_PERMANENT_PROMOTION=PASS
ABOUT-RUNTIME-REVISION-01_STATUS=COMPLETED / RESOLVED
PR64_STATUS=COMPLETED
PR64_FEATURE_HEAD=ee412912ad43d4902459b12151bad81c570d58cf
PR64_MERGE_SHA=23474d3f83c01c4355c892f46c77d2f66b046af0
PR64_PERMANENT_PROMOTION=PASS
INPUT_PARITY_ESCAPE_FOCUS_STATUS=COMPLETED
PR65_STATUS=COMPLETED
PR65_FEATURE_HEAD=8a4d1cf358d39524e95027b13e10c0205b9aea27
PR65_MERGE_SHA=405e9d7b1a3097dacef50c7908abf83d480d64dd
PR65_PERMANENT_PROMOTION=PASS
ABOUT-ACCESSIBLE-BRAND-01_STATUS=COMPLETED / RESOLVED
PR66_STATUS=COMPLETED
PR66_FEATURE_HEAD=1b6449597179ab3c832d0c658048d46f8bddda93
PR66_MERGE_SHA=0553119de95ab5b9c2e131bbb4b2ef1d0ef58456
PR67_STATUS=COMPLETED
PR67_FEATURE_HEAD=ec15233215043d6a054cb6fb5eb43eebe8b1442e
PR67_MERGE_SHA=7b6e474fcd50bb891e429a632849da371e126590
INPUT_PARITY_TOUCH_TARGET_01_STATUS=COMPLETED
PR68_STATUS=COMPLETED
PR68_FEATURE_HEAD=104671b51f99d0ad7c33d3514f8d4b2ad3558aee
PR68_MERGE_SHA=b6b814c77160c2e61dedc7c10958f0712f59d728
PR69_STATUS=COMPLETED
PR69_FEATURE_HEAD=b550634066ed129e4bb0e9b3ca18842469cb493e
PR69_MERGE_SHA=cf37807a4d3b9da39d3c438861fac358d936fdaa
NAV_VISUAL_PR0_STATUS=COMPLETED
PR70_STATUS=OPEN_DRAFT
PR70_BRANCH=codex/reader-media-01a-lazy-player-lifecycle
PR70_HEAD_SHA=0cda102f4e57e2beddfec8d4517fd9b8b4893fb2
PR70_BASE_SHA=cf37807a4d3b9da39d3c438861fac358d936fdaa
PR70_BASE_STALE=YES
PR70_TRACK=READER-MEDIA-01A
PR70_NEXT_FUNCTIONAL_CANDIDATE=YES
PR71_STATUS=COMPLETED
PR71_FEATURE_HEAD=4712b3e49c94f560c0e83ce7c8519eb6bda9cba0
PR71_MERGE_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PR71_PERMANENT_PROMOTION=PASS
NAV_VISUAL_PR1_STATUS=COMPLETED

PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_IMAGE=newsflux-local:d01e34fc2eb7
PRODUCTION_IMAGE_ID=sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c
PRODUCTION_REVISION_LABEL=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SOURCE_LABEL=https://github.com/jfsdias/NewsFlux
PRODUCTION_STATUS=running
PRODUCTION_RESTART_COUNT=0
HTTP_GATE=200
CANONICAL_COMPOSE_IMAGE=newsflux-local:d01e34fc2eb7
CANDIDATE_OVERRIDE_ACTIVE=NO
CANDIDATE_OVERRIDE_PRESERVED=YES
PERMANENT_PROMOTION=PASS
ROLLBACK_USED=NO
PRODUCT_PRODUCTION_PARITY=PASS
CANONICAL_RUNTIME_PARITY=PASS
RUNTIME_CANONICAL_PARITY=PASS

CURRENT_PRIMARY_TRACK=DOCS_LINT_01
CURRENT_PHASE=DOCUMENTATION_MAINTENANCE
CURRENT_TRACK=DOCS_LINT_01_FORMATTING_ONLY
INPUT_01A_STATUS=COMPLETED
INPUT_PARITY_ESCAPE_FOCUS_STATUS=COMPLETED
INPUT_PARITY_TOUCH_TARGET_01_STATUS=COMPLETED
KEYBOARD_TOUCH_PARITY_STATUS=COMPLETED
NEXT_FUNCTIONAL_CANDIDATE=READER-MEDIA-01A / PR #70
NEXT_FUNCTIONAL_CANDIDATE_STATUS=OPEN_DRAFT_REQUIRES_REFRESH
PR70_BASE_REFRESH_REQUIRED=YES
MARK_ALL_UNDO_JUMP_01_STATUS=INVESTIGATED_NO_REPRODUCTION_ON_CURRENT_BASE
MARK_ALL_UNDO_JUMP_01_DISPOSITION=HOLD_FOR_REAL_REPRO_EVIDENCE
LAST_COMPLETED_FUNCTIONAL=INPUT-PARITY-TOUCH-TARGET-01 / PR #67
LAST_COMPLETED_NAVIGATION=COMPACT_NAVIGATION / NAV-VISUAL PR1 / PR #71
LAST_PRODUCTION_PROMOTION=NAV-VISUAL PR1 / PR #71 / d01e34fc2eb76da39467d1de9799b12194faec9c

NAV_VISUAL_01_STATUS=IN_PROGRESS
NAV_VISUAL_01_IMPLEMENTATION=PARTIALLY_IMPLEMENTED
NAV_VISUAL_01_IMPLEMENTATION_AUTHORIZED=NO_FOR_REMAINING_SLICES
NAV_VISUAL_PR0=COMPLETED / PR #69 / cf37807a4d3b9da39d3c438861fac358d936fdaa
NAV_VISUAL_PR1=COMPLETED / PR #71 / d01e34fc2eb76da39467d1de9799b12194faec9c
NAV_VISUAL_NEXT_SLICE=MEDIUM_RAIL / PR4 / AFTER_PR70
NAV_CONTRACT_DRIFT_01=RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION
NAV-PR1-HARNESS-DESKTOP-MODEL-01=OPEN_P3
NAV-PR1-ROUTE-FOCUS-01=OPEN_P3
MOBILE_SCROLL_FLICKER_01=OPEN
MOBILE_SCROLL_FLICKER_01_SCOPE=SEPARATE_FUTURE_GLASS_GATE
TABLET_HEADER_WIDTH_01=CONFIRMED / TARGET_MEDIUM_RAIL

RUNTIME_IDENTITY_02_STATUS=CLOSED_NON_PRODUCT
RUNTIME_IDENTITY_02_CLASSIFICATION=OLD_DOCUMENT_SESSION
RUNTIME_IDENTITY_02_PRODUCT_DEFECT=NO
DOCS_LINT_01_STATUS=OPEN_BASELINE_DEBT

DOCUMENTATION_SCOPE=DOCUMENTATION_ONLY
NAV_CONTRACT_DRIFT_01_DISPOSITION=RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION
HISTORICAL_APPROVED_COMPACT_NAV_V1=SOLID
CURRENT_PR71_COMPACT_BASELINE=GLASS_TOKENS_AND_BACKDROP_FILTER
HISTORICAL_CONTRACT_PRESERVED=YES
CURRENT_PR71_BASELINE_ACCEPTED=YES
FUTURE_GLASS_GATES_WAIVED=NO
NEXT_RECOMMENDED_ACTION=DOCS_LINT_01_FORMATTING_ONLY_PR
PR70_SEQUENCE=AFTER_DOCS_LINT_01
MEDIUM_RAIL_SEQUENCE=AFTER_PR70_CLOSE
MERGE_AUTHORIZED=NO
PERMANENT_PROMOTION_AUTHORIZED=NO
```

PR #73 records the post-PR72 snapshot distinction: documentation-only merges can advance GitHub `main` without changing the product/runtime baseline, so they do not require deployment. The reconciliation preserves the accepted NAV contract disposition without reopening the design decision. It does not authorize future product implementation, merge, or promotion. DOCS-LINT-01 is the next recommended action; PR #70 remains sequenced after that separate formatting-only step.

## Recently completed

- **PR #20 / BULK-01:** Footer Mark All Read Undo with acknowledged-ID batching, one-shot memory-only Undo and generation-scoped notification IDs.
- **PR #21 / ID-01R:** repository/document provenance reconciliation.
- **PR #22:** canonical roadmap red-team R2 reconciliation.
- **PR #23 / A11Y-RT-01:** reduced-transparency dark/OLED specificity fix.
- **PR #24 / LIST-VISUAL-01 monogram subset:** deterministic fallback monograms for missing favicons.
- **PR #25 / CHROME-01A DatePicker subset:** NewsFlux token styling for DatePicker.
- **PR #26 / upstream sync:** adapted upstream article code-block experience; integrated upstream baseline through `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`.
- **PR #27 / BULK-01F:** deterministic footer Mark All Read focus restoration.
- **PR #28 / LIST-VISUAL-01A:** read-state and metadata/source hierarchy cohesion across Column/Card/List.
- **PR #29 / documentation:** roadmap and project-state reconciliation after LIST-VISUAL-01A production promotion.
- **PR #30 / BULK-01B:** Sidebar Feed/Category Mark All confirmation + safe shared Undo, including one shared Mark-All/Undo operation coordinator and source-scoped reconciliation. Merged as `b94c10926ae787382da4918e394c0821785f9c10` and deployed exactly as `newsflux-local:b94c10926ae7` with internal HTTP `200`. This was the previous production baseline before PR #32.
- **PR #32 / ID-RUNTIME-01:** runtime identity and NewsFlux-safe update/About/issues links; approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`, merged and deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`. Post-merge browser smoke and exact merge-SHA deployment passed. The initial candidate readiness attempt was `DEPLOY_HARNESS_STARTUP_RACE_CONFIRMED`; bounded retry passed, with no product regression.
- **PR #34 / A11Y-01:** main landmark, heading hierarchy, named navigation and skip navigation; approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`, merged as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`, tree parity PASS, exact merge-SHA production promotion PASS and authenticated post-merge browser smoke PASS.
- **PR #36 / HARNESS-UNDO-ID-01:** test-only repair; head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`, merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; all 29 focused list regression gates passed.
- **PR #37 / FILTER-01A:** active-source-scoped search; source changes clear search, while same-scope reader return/refresh/pagination preserve it; no global search or new persistence. Merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078`.
- **PR #38 / RUNTIME-BASE-01:** Dockerfile-only Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 digest pins; head `07237ba7e8c773e9de88e9c533296b9700dde287`, merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`. Isolated build/runtime gates passed; production was not switched.
- **PR #39 / FILTER-01B:** source/date/search transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`.
- **PR #40 / FEED-HEALTH-01A:** Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`.
- **PR #41 / READER-VISUAL-02A1:** editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`.
- **PR #42:** NAV-02 Mark All harness maintenance; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`.
- **PR #43 / BULK-03A:** mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`.
- **PR #44 / READER-MEASURE-01:** bounded responsive prose measure; merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. Automated Reader Measure, RV01, 02A1 and protected-surface gates passed; exact-SHA promotion, provenance, Node/Caddy base parity and default-width-75 visual parity passed. The CPL sandbox reached exactly 74 characters.
- **PR #45 / documentation:** prior post-Reader Measure reconciliation, merged as `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation.
- **PR #46 / READER-KEY-01:** layered Escape complete; feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`, merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`.
- **PR #47 / STATE-ERR-01:** unavailable-entry 404 behavior complete; feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`, merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`.
- **PR #48 / CONTENT-01:** deterministic untitled fallback complete; feature head `1032b5409298629382685a85935b85fdc2292f85`, merge `9f521edfd5f031e8e833a4854d896acc42a22fae`.
- **PR #49 / READER-VISUAL-02A2:** quiet editorial header aligned to the production prose column; feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`, merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`.
- **PR #50 / BULK-03B:** 1/7/30-day age presets, full discovery before writes, strict `published_at` cutoff, scope preservation, acknowledged-only Undo, shared Today time snapshot and focus restoration; feature head `dd9e68650f3f40080199b90107c2b35722166697`, merge `a8dbe15497f7d526298f223188955b82589a84a4`. No production promotion.
- **PR #51 / documentation:** reconciled project state and roadmap after BULK-03B; merged as `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`.
- **PR #52 / FEED-HEALTH-01B:** provider-reported error detail, provider-owned `checked_at`/`parsing_error_count`, accessible details and Retry, stale-session fencing, and one final metadata reconciliation after bulk refresh; feature head `1b03865311993f7e72df0632ea662bbe94e926e9`, merged as `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`. No production promotion.
- **PR #53 / selective upstream maintenance:** integrated pnpm build-script hardening and adapted setup-node pins; feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`, merged as `046cd647c65583cdfdc7ab282701be79d4b34294`. No production promotion.
- **PR #55 / FILTER-RULES-01:** provider-backed per-feed raw Miniflux `blocklist_rules` / `keeplist_rules` editor; feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`, merge `1021cd5746eba2b3b90b1a863bada9043f126be1`; no NewsFlux rule persistence.
- **PR #57 / BULK-02:** session multi-select completed; merge `85b9590bbc9f4d3488fd30694b0b45553fefda5b`.
- **PR #58 / MARK-ALL-REFRESH-01:** suppresses the transient empty state during the next-unread jump; merge `df4bea4dde5cca86a4b822d2e82f01156bb96f1a`. The separate Undo-after-jump concern was investigated on the current baseline and is now held for real reproduction evidence rather than treated as the next functional unit.
- **PR #59 / HOME-01:** refresh, focus, reconnect and session continuity completed; merge `114eed13c5f66cd57a4448ece935de6cb5f4a11e`.
- **PR #60 / NAV01:** canonical reader previous/next and next-unread continuity completed; merge `31c95ff835da3e716acfd6eb115db5c3b68dd71c`.
- **PR #61 / INPUT-01a:** shared reader-command ownership completed; head `e2cbab710f00eb84c77b3df4ddc9701839a677d9`, merge `194a1db007902411abe91459b45a19b10c76e701`.
- **PR #63 / ABOUT-RUNTIME-REVISION-01:** deterministic build revision identity; feature head `9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8`, merge `723bdbb96e4445d267b443422a0be7a83e5b4f8a`; exact `SOURCE_COMMIT` is embedded in frontend metadata and the OCI revision label. Live About validation and permanent promotion passed.
- **PR #64 / INPUT-PARITY-ESCAPE-FOCUS:** FooterPanel “Mark older articles as read” Escape now closes the menu and restores focus to the trigger; feature head `ee412912ad43d4902459b12151bad81c570d58cf`, merge `23474d3f83c01c4355c892f46c77d2f66b046af0`; live canary passed at 390×844, 884×1104 and 1280×800 and exact merge-SHA promotion passed.
- **PR #65 / ABOUT-ACCESSIBLE-BRAND-01:** the NewsFlux GitHub link accessible name now names NewsFlux in all six shipped locales; feature head `8a4d1cf358d39524e95027b13e10c0205b9aea27`, merge `405e9d7b1a3097dacef50c7908abf83d480d64dd`; runtime-identity gates and exact merge-SHA production promotion passed.
- **PR #66 / Mark All cold-loaded All:** current-list identity and filtered unread total reconciliation; feature head `1b6449597179ab3c832d0c658048d46f8bddda93`, merge `0553119de95ab5b9c2e131bbb4b2ef1d0ef58456`.
- **PR #67 / INPUT-PARITY-TOUCH-TARGET-01:** compact interaction targets corrected while preserving inert gaps; feature head `ec15233215043d6a054cb6fb5eb43eebe8b1442e`, merge `7b6e474fcd50bb891e429a632849da371e126590`.
- **PR #68 / harness maintenance:** stale provider and button assumptions corrected in browser harnesses; feature head `104671b51f99d0ad7c33d3514f8d4b2ad3558aee`, merge `b6b814c77160c2e61dedc7c10958f0712f59d728`.
- **PR #69 / NAV-VISUAL PR0:** window-class foundation; feature head `b550634066ed129e4bb0e9b3ca18842469cb493e`, merge `cf37807a4d3b9da39d3c438861fac358d936fdaa`.
- **PR #70 / READER-MEDIA-01A:** open draft at head `0cda102f4e57e2beddfec8d4517fd9b8b4893fb2`, on stale base `cf37807a4d3b9da39d3c438861fac358d936fdaa`; next active functional candidate, refresh required.
- **PR #71 / NAV-VISUAL PR1:** compact navigation renderer plus Reader/Drawer focus and resize hardening; feature head `4712b3e49c94f560c0e83ce7c8519eb6bda9cba0`, merge and exact product/production promotion `d01e34fc2eb76da39467d1de9799b12194faec9c`.
- **PR #72 / documentation:** post-PR71 canonical reconciliation; docs-only merge `32244fa07b57c8bb3f5682f27b4d94917384ce63`; no production deployment was required.

## FILTER-RULES-01 closure

- Miniflux remains the source of truth. The per-feed editor round-trips raw `blocklist_rules` and `keeplist_rules`; explicit empty strings clear a rule, while absent fields preserve provider values. Advanced entry-filter fields remain untouched, and provider responses are authoritative; stale-session fencing and bounded ambiguous-failure reconciliation protect edits.
- Miniflux 2.3.3 clears its recorded feed error when a feed is updated. NewsFlux accepts that provider behavior and discloses it when filter rules are dirty; a successful rule save does not mean the feed is healthy. `FEED_ERROR_RESET_DECISION=ACCEPT_PROVIDER_BEHAVIOR_WITH_EXPLICIT_DISCLOSURE`.
- Validation: API tests 5/5; FILTER-RULES-01 browser harness 21/21; full Node 276/276; Feed Health unit regression 4/4. FEED-HEALTH-01A base/head parity: 16/16 each at 1280×720, 390×844 and 884×1104. FEED-HEALTH-01B base/head results matched: desktop 42/42; mobile/tablet 41/41 plus a native-input-only focus gate. `PR55_REGRESSION_EVIDENCE=NO`.
- Live Miniflux writes were 0; a live non-empty rule round-trip canary was not executed. `FILTER_RULES_NATIVE_MOBILE_FOCUS_RETURN=NOT_PHYSICALLY_VALIDATED`; no physical gate is claimed. `MUTATION_OBSERVER_INITIAL_FAILURE=NOT_REPRODUCED`. `REACT_19_ELEMENT_REF_WARNING=PREEXISTING_NON_BLOCKING`.
- **Open, non-blocking finding — `FEED_EDIT_ERROR_RESET_DISCLOSURE`:** ordinary feed edits can also clear provider-recorded errors; FILTER-RULES-01 discloses this only on its own surface. Track a separate maintenance/UX decision. This is not a confirmed FILTER-RULES-01 defect and does not reopen FEED-HEALTH-01.

## A11Y-01 closure

Status: **COMPLETED** in PR #34.

- Candidate and merge trees matched at `124a4e5c62649a3ffd9229ec03c490e94f6874c5`.
- Exact merge-SHA image `newsflux-local:7b0a7e04d1e1` was built and promoted; image ID: `sha256:c5d64a7a9686aec005490882e24cabb03c664afd60cc5ea82e51e6bb730be5c4`.
- Compose image identity, running-container identity, internal HTTP, served NewsFlux identity, runtime provenance and post-deploy stability gates passed. The container remained running with restart count `0`.
- PR gates passed: focused tests `9/9`, aggregate Node tests `29/29`, ESLint (three pre-existing warnings in unchanged files), Prettier, build and diff check. The browser matrix passed at `390`, `884×1104` and `1280` in light/dark themes, plus forced-colors Chromium emulation and Reader/Sidebar layout regression. A physical-device gate was not required.
- Authenticated post-merge browser smoke passed at Home and an already-read article. At `884×1104`, the page had one main landmark and one h1; the skip link received keyboard focus and activated the main landmark. At `1280×800`, the named desktop navigation was present. No horizontal overflow or candidate-specific console errors were found. No unread item was opened or mutated.
- Source-heading normalization passed structurally, but a live feed with a dedicated source-heading fixture was not exercised. This remains a validation limitation, not a confirmed defect.
- The PR browser matrix observed one unattributed HTTP 404 Image response among 82 responses, with zero failed image loads or visibly broken images; it was non-blocking. Three pre-existing React hydration warnings were not attributed to candidate behavior. A Today count changed by one during the browser session without an explicit read action; it was not attributed to this PR.
- An initial production-promotion attempt stopped before service replacement because its wrapper treated an expected diff result as a failed assertion; the candidate runtime was restored and rechecked, then exact merge-SHA promotion passed. No production swap occurred during the aborted attempt.

## BULK-01B closure

Status: **COMPLETED**.

Delivered:

- Sidebar Feed and Category Mark All now use the existing confirmation preference contract;
- source scope remains Feed-wide or Category-wide and does not inherit list search/date/status filters;
- hidden-feed category visibility semantics are preserved;
- acknowledged-ID batching provides exact one-shot Undo;
- Footer and Sidebar share one Mark-All/Undo concurrency coordinator;
- Sidebar Mark All does not jump to another source;
- partial failure, stale-session protection and counts/list reconciliation are covered by automated/browser gates;
- the PM-discovered Undo-during-active-Mark-All race was fixed before merge.

Validation closure:

- focused tests: `19/19` PASS;
- full applicable Node tests: `132/132` PASS;
- ESLint, Prettier, build and `git diff --check`: PASS;
- dedicated BULK-01B browser harness: PASS;
- legacy aggregate harness: baseline `20/29`, candidate `20/29`, same nine known `HARNESS-UNDO-ID-01` failures;
- authenticated critical viewport `884×1104`: layout, Feed context menu, confirmation, cancel/no-mutation, Mark All count reconciliation, route stability and scroll stability validated;
- physical-device touch gate: `WAIVED_BY_OWNER`; a physical touch PASS is **not** claimed. Residual risk is limited to physical long-press ergonomics, gesture-scroll feel and Fold-specific hardware/browser behavior on this exact head.

The temporary canary entry used during viewport validation was restored through normal product UI before closure; residual test-data risk is `NO`.

## Completed visual package status

### LIST-VISUAL-01

Status: **COMPLETED**.

Delivered:

- deterministic favicon monogram fallback;
- redundant read/unread presentation;
- source kicker hierarchy;
- metadata cohesion across Column/Card/List;
- long source truncation in article Column presentation.

Rehomed rather than silently completed:

- human-readable unread-count labels -> `NAV-02F`;
- untitled-entry semantics -> `CONTENT-01`.

Not authorized by package completion:

- new trailing-thumbnail/card redesign.

## Historical open-work snapshot (2026-10-22; current queue above)

### P1

- None currently recorded.

### Current track

- **Keyboard/touch parity — COMPLETED.** PR #64 completed Escape/focus return and PR #67 completed the bounded `INPUT-PARITY-TOUCH-TARGET-01` interaction-target correction.

### Next functional candidate

- **INPUT-PARITY-TOUCH-TARGET-01 — COMPLETED / PR #67.** Effective interaction-target corrections are merged; visual icon dimensions remain independent from target size.
- **MARK-ALL-UNDO-JUMP-01 — HOLD.** Current-base reproduction passed at 1280, 390 and 884; no current defect was proven. Reopen only with real reproduction evidence including runtime SHA, viewport/device, originating scope, setting, sequence, expected and actual behavior.

## Historical planned functional tracks (2026-10-22; superseded by current queue above)

- BULK-01C — scoped Undo copy.
- INPUT-PARITY-TOUCH-TARGET-01 — completed in PR #67.
- READER-MEDIA-01A / PR #70 — active open draft functional candidate; refresh onto current main after documentation and DOCS-LINT-01.
- MARK-ALL-UNDO-JUMP-01 — HOLD for real reproduction evidence; not the next functional unit.
- NAV-02F — navigation follow-ups including human-readable unread-count labels.
- READER-MEDIA-01 — architecture gate after input parity; real-device gate remains required when implementation is later authorized.
- CHROME-01 remaining subsets — confirmation, snackbar and raw-Arco work stay decomposed.

## Visual / presentation backlog

- **CHROME-01 — PLANNED:** DatePicker subset is complete; remaining confirmation/snackbar/raw-Arco work stays decomposed.
- **READER-VISUAL-02A — COMPLETED:** 02A1 in PR #41, Measure in PR #44 and 02A2 / Quiet Column in PR #49.
- **READER-VISUAL-02B — PLANNED:** auto-hide + Next only after interaction/NAV dependencies.
- **HOME-VISUAL-02 — HOLD — PRODUCT.**
- **NAV-VISUAL-01 — IN PROGRESS.** PR0 / #69 and PR1 / #71 are complete; compact navigation is implemented. Medium Rail and remaining slices are deferred; each future slice retains its own authorization and real-device gates.
- **READER-COVER-01 — HOLD — PRODUCT.**
- **READER-FONT-01 — HOLD — PRODUCT.**
- **HOME-SKEL-01 — BACKLOG.**
- **READER-MEASURE-01 — COMPLETED:** PR #44 merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`.
- **HARNESS-VIS-01 — BACKLOG (test debt).**
- **TEST-ENV-01 — BACKLOG (verification required).**
- **MOTION-01 — BACKLOG.**

Nine incomplete design packages remain recorded above; no unrelated product or architecture decision is implied or closed.

## PWA Foundation and NetNewsWire UX planning snapshot (2026-10-22; current execution status is above and in `PWA_ARCHITECTURE.md` §16)

Documented in [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) and [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md); roadmap detail is in `NEWSFLUX_ROADMAP.md` Section 3.13. **Planning only — nothing here authorizes implementation.**

- **Key finding:** a partial PWA already exists in `main` (generated manifest, Workbox service worker with `skipWaiting` + `clientsClaim` + auto-update, iOS head metadata, a standalone viewport workaround). The plan therefore starts with a measurement phase, `PWA-00`, and treats `PWA-01` as hardening, not greenfield. `THEME-CHROME-01` is absorbed by `PWA-01B`; `APP-BADGE-01` becomes `PWA-04A`.
- **Principles:** `CORRECT_FRESH_RUNTIME > AGGRESSIVE_OFFLINE_CACHING`; `PWA installability != offline data architecture`; Miniflux remains the source of truth; no authenticated-response caching; no new persistent NewsFlux state without an architecture decision; no essential feature depends on one ecosystem's API.
- **Phases:** `PWA-00` baseline audit; `PWA-01A/B/C` manifest and icons, theme and display-mode, serving contract (01C gated by `ID-DEPLOY-01`); `PWA-VAL-01` device validation; `PWA-02A/B` Android and Apple adaptation (defect-driven); `PWA-03A/B/C/D` update safety, offline/error states, kill switch, controlled cache (03D held); `PWA-04A–E` optional capabilities (04E held).
- **NetNewsWire UX tracks:** `NNW-01` source identity, `NNW-02` navigation density, `NNW-03` contextual toolbar, `NNW-04` reader source header, `NNW-05` multi-pane reference (research only). Each separates `REFERENCE_PATTERN` from `NEWSFLUX_PRODUCT_DECISION`; the single-pane, opaque-content, glass-as-chrome and `884×1104` contracts are unchanged.
- **Pending PM inputs:** `D1`–`D9` in `PWA_ARCHITECTURE.md` §12. `D4` (production topology) is **partially resolved** (`PM_REPORTED`; see the topology subsection above); the Miniflux origin is not assumed same-origin. Still open: `D1` manifest `id`, `D2` theme/background color policy, `D3` maskable icon art, `D5` `ID-DEPLOY-01` or waiver, `D6` update policy, `D7` third-party icon fallback, `D8` token-only auth guidance, `D9` offline reading. `SOURCE_IDENTITY` is **confirmed** as publisher/feed/source-level visual identity; `STORY_IDENTITY` stays out of `NNW-01`.
- **Authorization state (PM review of PR #86):** `PWA-00` is the next authorized planning/validation candidate (evidence-only, no product code); **`PWA-01A` is not yet authorized**; no implementation PR is currently authorized. **Priority rule:** if `PWA-00` confirms a mid-reading reload or update disruption, `PWA-03A` outranks icon/manifest polish — correctness before cosmetic installability hardening.
- **PWA-00 result (2026-10-22; [`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md)):** measured against `main` `68b39798fa6d823b2e5b1286aa42d4309c21c2ca` (PR #87 merged; production is `PM_REPORTED`; the post-#85 `CURRENT_MAIN` values above are not updated by PWA-00). A service worker update **reloads the reading page automatically**, losing scroll, in-memory state and an open dialog with typed text (`LOCAL_EXPERIMENT` on metadata-verified builds and on builds without a commit date; production frequency `NOT_MEASURED`), so `MID_READING_UPDATE_DISRUPTION=CONFIRMED` and `PWA_03A_PRIORITY_RECOMMENDATION=YES` — a recommendation only: `PWA-01A` remains **not authorized** and no implementation PR is authorized. New finding `I1`: the runtime cache stores HTML under `.js` URLs after a missing-asset fallback. `UPDATE_CHECK_BUILD_METADATA_01` (`PM_REPORTED`, `NEEDS_DIAGNOSTIC`): a missing commit date does **not** disable the in-app update check or the service worker update; the build warning has been stale since commit `07989972`. The public origin, NPM headers and the real Miniflux origin are `NOT_MEASURED` (egress denied); iOS and Android gates are `NOT_RUN`.

## Personalization / saved-state architecture

- Phase 2D V1 is complete and Home-only.
- All/Unread remain chronological and predictable.
- Phase 2D V2 remains deterministic-only until architecture is proven.
- Story clustering, learned relevance and ML remain architecture-gated.
- Miniflux remains source of truth for feeds, categories, read/unread and starred.
- First-party Later/Bookmarks/Boards/Tags/Saved/Smart folders/per-feed synced layout require explicit storage/sync/privacy/source-of-truth decisions.
- Provider-backed external save, feed rules, range mark-as-read and feed health may advance without creating a second persistent NewsFlux database when their semantics are explicit.

## Upstream state

```text
UPSTREAM_REPOSITORY=electh/ReactFlux
UPSTREAM_INTEGRATION_MODE=SELECTIVE_NON_LINEAR
UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_INTEGRATED_UPSTREAM_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_UPSTREAM_SYNC_PR=85
LAST_UPSTREAM_SYNC_MERGE_SHA=d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc
UPSTREAM_CYCLE=CLOSED
PR85_3B2B08FB=INTEGRATED_ADAPT_EMPTY_CAPTION_RENDERING
PREVIOUS_INTEGRATED_UPSTREAM_SHA=0887f714c36cc6c999f8b4559fa14c7948598629
PREVIOUS_UPSTREAM_SYNC_PR=11
PREVIOUS_UPSTREAM_SYNC_MERGE_SHA=cef9d8faf543d297e3393b1de314c57b01d99af9
PREVIOUS_UPSTREAM_SYNC_SET=PR11_AA68CB53_6963069B_B587A964_0887F714
PR11_AA68CB53=INTEGRATED_FILTERED_EMPTY_COUNTS
PR11_6963069B=INTEGRATED_MARK_ALL_FILTER_SESSION_HARDENING
PR11_B587A964=INTEGRATED_MUTATION_TOTAL_REFRESH
PR11_0887F714=RETAINED_IN_UPSTREAM_ANCESTRY
PR11_SEARCH_AUTOFOCUS_TREE_CHANGE=SKIPPED_EQUIVALENT_BEHAVIOR_ALREADY_EXISTED
NEXT_UPSTREAM_AUDIT_FROM=3b2b08fb6036ef94f92a757ac6f3df889be8515c
SELECTIVELY_INTEGRATED=e46d92ab64adcbd0bb8ac2caf6048fa37f527939
SELECTIVELY_ADAPTED=0c28762de6987c980306b8553753e549e753b4e0
HOLD_VITE=4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe (8.3.1 to 8.3.4; lockfile/Rolldown churn, harness sensitivity, dedicated regression gate)
HOLD_FRAMER_MOTION=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036 (14.0.0 to 14.2.0; production motion dependency, dedicated visual/motion regression gate)
```

PR #53 completed selective maintenance: `e46d92ab64adcbd0bb8ac2caf6048fa37f527939` was integrated as `allowBuilds.plyr=false` in `pnpm-workspace.yaml`; `0c28762de6987c980306b8553753e549e753b4e0` was adapted by updating only `actions/setup-node` from 7.0.0 to 7.1.0 in five equivalent workflows, preserving NewsFlux customizations. The reviewed frontier is not a linear integration claim. Holds remain unapproved for implementation.

PR #85 adapted `3b2b08fb` (`fix(article): render empty caption elements without children`) with the guard inserted in `processFigcaptionContent`; the upstream cycle is closed and the next cycle begins from a live check of the upstream head. The upstream repository is tracked only through this document and the roadmap (`docs/UPSTREAM_TRACKING.md` does not exist).

The specialized upstream monitor must live-check the current upstream head before auditing. New commits are classified `INTEGRATE / ADAPT / SKIP / HOLD`; never blindly Sync fork or merge upstream/main.

## Historical findings register (2026-10-22 snapshot; current dispositions are above)

- **Workflow repository guard finding:** existing `github.repository == 'electh/ReactFlux'` guards remain an open, non-blocking finding. Track a separate maintenance decision; do not change them as part of upstream reconciliation.
- `HARNESS-UNDO-ID-01` was resolved by PR #36; the nine stale fixed-ID assertions were repaired and the focused list gate passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is not open on the current runtime baseline; PR #38 reports `CODEBLOCK_SSR_GATE=PASS` in the full Node suite on both main and candidate.
- **Historical `ARTICLE_CODE_BLOCK_CONTROLS` diagnostic (baseline `d7c0fc8e…`; not revalidated on current main):** the focused `scripts/article-code-block-controls.test.js` passed 3/3 and `node --test scripts/*.test.js` passed 48/48 in the latest backend diagnostic on that baseline. A prior cloud-container run (Node v22.22.0, pnpm 11.21.0) failed on pristine `16311d0d…` and `d7c0fc8e…` with a Vite SSR error resolving the named export `Select` from `@arco-design/web-react` inside `CodeBlock.jsx`. The 46-vs-48 counts differ because a file that fails to load counts as one failure instead of its three tests (45 + 3 = 48). Environment/toolchain sensitivity remains possible; the cause is not established.
- The React 19 `element.ref` warning remains an incidental harness warning and non-blocking backlog. No fix is claimed here.

## Historical open findings / residual risks (2026-10-22; reconcile current disposition with the snapshot above)

- **READER-MEASURE-01 real-device gate:** not executed; nonblocking. A physical `884×1104` Fold/tablet and a phone remain recommended for long-form comfort and OLED review.
- **Reader header/body alignment:** completed by READER-VISUAL-02A2 / PR #49 using the real `.article-header-column` production element; edge alignment passed within 0.02 px across 390×844, 768×1024, 884×1104, 1024×768, 1280×800 and 1440×900 in both themes.
- **Search focus observation:** during production smoke, Search initially focused “Search syntax help” rather than the input. Search functionality worked; this was not investigated and is not a confirmed regression. Keep as an open finding for a dedicated reproduction.
- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This remains an accepted validation limitation rather than an open blocker.
- PR #30 completed with `REAL_DEVICE_GATE=WAIVED_BY_OWNER`; physical touch PASS is not claimed for the exact PR #30 head. Full automated/browser coverage and authenticated `884×1104` evidence passed where tooling was deterministic. This is an accepted residual validation limitation, not an open product defect.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.
- Repository Prettier hooks normalized Markdown table alignment in this PR; PM accepted the formatting. This creates a residual auditability limitation when comparing prior table edits; no formatter bypass or manual reversal was used.
- **MOBILE-SCROLL-FLICKER-01 — OPEN:** reproduction is currently blocked by the harness precondition `MISSING_GENERATED_VERSION_INFO`; a physical iPhone gate was not run and root cause remains unknown. This continues to block future optional NAV-VISUAL PR6 glass expansion.
- **TABLET-HEADER-WIDTH-01 — CLOSED by PR #76** (PM review of PR #86; in current production ancestry, `PM_REPORTED`). Historical record preserved: at 768×1024, 884×1104, 900×1100 and 992×1104 the header was approximately 370 px wide with unused space and no overflow; the earlier plan was fix-later in NAV-VISUAL-01 / PR4 MEDIUM-RAIL, superseded by the PR #76 change to `Content.jsx`.
- **DOCS-LINT-01 — OPEN:** preserve the existing documentation/superpowers formatting debt; do not expand this reconciliation to unrelated files.
- **HOME-HARNESS-STABILITY-01 — OPEN:** keep deterministic baseline failures separate from intermittent stability failures. Deterministic 10/10 failures: `LIST_SEARCH_DATE_SORT_PRESERVED`, `READER_MEASURE_01_CPL`. Intermittent 6/10 failures: `READER_VISUAL_01_WIDE_IMAGE`, `READER_MEASURE_01_DEFAULT_75_PARITY`, `READER_MEASURE_01_MEDIA_PROTECTION`. Root cause remains unknown; no product fix is claimed here.
- **READER-MEDIA-01A — OPEN / DRAFT PR #70:** next active functional candidate; its base is stale and must be refreshed onto current main before candidate and authenticated Reader/media gates.
- **ABOUT-ACCESSIBLE-BRAND-01 — COMPLETED:** resolved by PR #65; it is no longer an open finding.
- **RUNTIME-IDENTITY-02 — CLOSED / NON-PRODUCT:** classified as `OLD_DOCUMENT_SESSION`; fresh-document validation showed the prior tab retained old JavaScript while new requests served the R5 asset. Server, asset, Service Worker and Cache Storage were not the cause; no product or deployment defect was found.

- **PWA findings F2–F9 (classified, not fixed; details in `PWA_ARCHITECTURE.md` §4):** manifest/runtime theme-color mismatch; no maskable icon; update-aggressive service worker with an in-page reload path (runtime effect unmeasured); SPA fallback masks missing assets as HTML and no explicit `Cache-Control` for `sw.js`/manifest (header behavior unmeasured); navigation route without a denylist (NewsFlux has its own HTTPS origin per the `PM_REPORTED` topology; sharing with another app is unmeasured); plaintext `password` in `localStorage` (pre-existing); third-party icon fallback discloses followed hostnames and `getSecondHostname` mishandles multi-part public suffixes (`www.bbc.co.uk` → `co.uk`); per-profile `localStorage` means an installed iOS app does not share Safari's state.

## Documentation drift register (reconciled 2026-10-22)

Facts verified from git history. The closures below were confirmed by the PM review of PR #86 (`PM_REPORTED`). Stale historical text was **not** rewritten wholesale to avoid unsolicited edits; it is retained as history and labelled.

| Item                                                                                         | Evidence                                                                 | Handling                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRs #74, #76, #77 merged in git but absent from earlier snapshots                            | Merge commits `b6b72466`, `831ff514`, `e1c1285e`                         | Recorded as completed in the current state and roadmap Section 3.2 (PM review of PR #86).                                                                                                                                           |
| `TABLET-HEADER-WIDTH-01` still listed "CONFIRMED / fix now NO / target PR4" in Open findings | PR #76 `fix: expand tablet list header to content width` (`Content.jsx`) | **Closed by PR #76** (PM review of PR #86); the historical bullet is retained and relabelled.                                                                                                                                       |
| `NAV-PR1-ROUTE-FOCUS-01` listed as an open P3 finding                                        | PR #74 `fix(nav): restore meaningful focus after drawer navigation`      | PR #74 recorded as completed historical NAV route-focus work (PM review of PR #86). `NEWSFLUX_NAV_VISUAL_01.md` keeps its 2026-10-20 "OPEN_P3" and "TABLET-HEADER-WIDTH-01 CONFIRMED" text as history and is not edited in this PR. |
| `HOME_DUP_ROOT_CAUSE_01` listed as backlog                                                   | PR #77 `fix: deduplicate initial Home entries by id`                     | **Closed for the initial canonical Home duplicate-ID root cause** (PM review of PR #86). Unrelated pagination/cursor findings (`HOME_PAGINATION_CURSOR_STALL_01`) are **not** closed.                                               |
| `READER-MEDIA-01A / PR #70` described as an open draft in several sections                   | The same document records `PR70_STATUS=MERGED` (`2a858ede…`)             | Stale text retained as history; the header block and roadmap Section 3.2 are authoritative.                                                                                                                                         |
| `DOCS-LINT-01 — OPEN` bullet in Open findings                                                | The same document records `DOCS_LINT_01_STATUS=COMPLETED_BY_PR75`        | Roadmap Section 9 already marks it completed; PM may schedule a cleanup of this bullet.                                                                                                                                             |
| "Next recommended action" referenced DOCS-LINT-01 and PR #70                                 | See above                                                                | Replaced in this reconciliation.                                                                                                                                                                                                    |
| `docs/UPSTREAM_TRACKING.md` does not exist                                                   | Absent from the repository                                               | No file created; upstream state lives in this document and the roadmap.                                                                                                                                                             |

## Product decisions and accepted baseline exceptions

- HOME-VISUAL-02 composition.
- SAVE-EXT-01 wording and placement.
- NAV-02F grouping, mode persistence and count presentation.
- CHROME-01 contextual control consolidation.
- ID-DEPLOY-01 local-build versus registry/deployer architecture.
- NAV-VISUAL-01 has an approved design contract. PR0 and PR1 are complete; PR #71 establishes the current compact-navigation product baseline. Remaining slices, including Medium Rail, are deferred and retain their real-device gates.
- `NAV_CONTRACT_DRIFT_01` is resolved as an accepted current-baseline exception. The historical approved contract specifies a solid compact bar; merged PR #71 uses NewsFlux glass tokens and `backdrop-filter`, and this current baseline is accepted. Preserve both facts; future glass gates are not waived, and `MOBILE-SCROLL-FLICKER-01` remains open.

## Completed finding — ABOUT-RUNTIME-REVISION-01

```text
TYPE=RUNTIME_IDENTITY / DEPLOY_PROVENANCE
STATUS=COMPLETED / RESOLVED
PR=63
FEATURE_HEAD=9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8
MERGE_SHA=723bdbb96e4445d267b443422a0be7a83e5b4f8a
RESULT=PASS
RESOLUTION=NewsFlux receives the exact SOURCE_COMMIT as deterministic build identity. The same SHA is embedded in frontend build metadata and used in the OCI org.opencontainers.image.revision label.
LIVE_VALIDATION=PASS
ABOUT_COMMIT=exact promoted merge SHA, displayed in shortened form
UNKNOWN_COMMIT=RESOLVED
```

## Historical next recommended action (2026-10-22; superseded by the current queue above)

Current sequence: this planning documentation PR (`PWA_ARCHITECTURE.md`, `DESIGN_REFERENCES.md` and this reconciliation) was reviewed by the PM as PASS WITH DOCUMENTATION AMENDMENTS and remains a Draft. After it, **`PWA-00` is the next authorized planning/validation candidate** — an evidence-only baseline audit of the PWA that already exists, including whether the configured Miniflux origin is same- or cross-origin. **`PWA-01A` is not yet authorized.** If `PWA-00` confirms a mid-reading reload or update disruption, `PWA-03A` outranks manifest/icon polish. `MARK-ALL-UNDO-JUMP-01` remains held for real reproduction evidence. The earlier sequence that referenced `DOCS-LINT-01` and PR #70 is complete and superseded. This documentation does not authorize product implementation, merge or promotion.

## Historical deployment receipt and enduring deployment governance

- Deploy only an exact approved product/runtime SHA.
- Never deploy `latest` or a moving branch implicitly.
- Historical live production receipt from 2026-10-20: image `newsflux-local:d01e34fc2eb7`, image ID `sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c`, revision label `d01e34fc2eb76da39467d1de9799b12194faec9c`, source label `https://github.com/jfsdias/NewsFlux`, status `running`, restart count `0`. It is not the current production state.
- At that historical deployment, internal HTTP returned `200`; canonical Compose referenced `newsflux-local:d01e34fc2eb7`, no candidate override was active, and the archived candidate override remained preserved.
- At that historical point, `PRODUCT_PRODUCTION_PARITY=PASS` and `CANONICAL_RUNTIME_PARITY=PASS`; PR #71 merge SHA `d01e34fc2eb76da39467d1de9799b12194faec9c` was the product and production SHA. Later PWA runtime PRs supersede that state.
- The historical promotion recorded `PERMANENT_PROMOTION=PASS`; `ROLLBACK_USED=NO`.
- The historical PR #44 promotion remains in the completion history. Current production state is recorded above.
- Docs-only work does not need a production deployment.
- Do not delete rollback images or backups incidentally.
