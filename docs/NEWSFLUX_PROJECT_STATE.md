# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-21.
- **Reconciliation snapshot:** GitHub `main` at `313991e80c2b54a99819c2e267ef90a35a959752` on 2026-10-21.
- **Current product/production baseline at that snapshot:** `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`.

## Current state

As of the 2026-10-21 pre-reconciliation snapshot, GitHub `main` is `313991e80c2b54a99819c2e267ef90a35a959752`. Product and production are at the PR #81 merge SHA `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`; the runtime is running, internal HTTP passed, public HTTP returned 200, and exact image/revision identity passed. No restart count was included in the deployment receipt. Main is ahead of that runtime only because PR #79 is documentation-only. PR #79 is merged, PR #80 closed without merge, and PR #81 is merged, deployed and validated. GitHub reported no open PRs before this reconciliation PR was opened.

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

Main may advance through documentation-only merges without changing the product/runtime baseline or requiring deployment. The next functional maintenance track is a dedicated upstream-sync PR for the queued ADAPT item; this reconciliation does not claim it is integrated or authorize a merge.

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

## Open high-priority work

### P1

- None currently recorded.

### Current track

- **Keyboard/touch parity — COMPLETED.** PR #64 completed Escape/focus return and PR #67 completed the bounded `INPUT-PARITY-TOUCH-TARGET-01` interaction-target correction.

### Next functional candidate

- **INPUT-PARITY-TOUCH-TARGET-01 — COMPLETED / PR #67.** Effective interaction-target corrections are merged; visual icon dimensions remain independent from target size.
- **MARK-ALL-UNDO-JUMP-01 — HOLD.** Current-base reproduction passed at 1280, 390 and 884; no current defect was proven. Reopen only with real reproduction evidence including runtime SHA, viewport/device, originating scope, setting, sequence, expected and actual behavior.

## Planned functional tracks

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
LAST_INTEGRATED_UPSTREAM_SHA=0887f714c36cc6c999f8b4559fa14c7948598629
LAST_UPSTREAM_SYNC_PR=11
LAST_UPSTREAM_SYNC_MERGE_SHA=cef9d8faf543d297e3393b1de314c57b01d99af9
LAST_UPSTREAM_SYNC_SET=PR11_AA68CB53_6963069B_B587A964_0887F714
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

The specialized upstream monitor must live-check the current upstream head before auditing. New commits are classified `INTEGRATE / ADAPT / SKIP / HOLD`; never blindly Sync fork or merge upstream/main.

## Known test debt and incidental findings

- **Workflow repository guard finding:** existing `github.repository == 'electh/ReactFlux'` guards remain an open, non-blocking finding. Track a separate maintenance decision; do not change them as part of upstream reconciliation.
- `HARNESS-UNDO-ID-01` was resolved by PR #36; the nine stale fixed-ID assertions were repaired and the focused list gate passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is not open on the current runtime baseline; PR #38 reports `CODEBLOCK_SSR_GATE=PASS` in the full Node suite on both main and candidate.
- The React 19 `element.ref` warning remains an incidental harness warning and non-blocking backlog. No fix is claimed here.

## Open findings / residual risks

- **READER-MEASURE-01 real-device gate:** not executed; nonblocking. A physical `884×1104` Fold/tablet and a phone remain recommended for long-form comfort and OLED review.
- **Reader header/body alignment:** completed by READER-VISUAL-02A2 / PR #49 using the real `.article-header-column` production element; edge alignment passed within 0.02 px across 390×844, 768×1024, 884×1104, 1024×768, 1280×800 and 1440×900 in both themes.
- **Search focus observation:** during production smoke, Search initially focused “Search syntax help” rather than the input. Search functionality worked; this was not investigated and is not a confirmed regression. Keep as an open finding for a dedicated reproduction.
- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This remains an accepted validation limitation rather than an open blocker.
- PR #30 completed with `REAL_DEVICE_GATE=WAIVED_BY_OWNER`; physical touch PASS is not claimed for the exact PR #30 head. Full automated/browser coverage and authenticated `884×1104` evidence passed where tooling was deterministic. This is an accepted residual validation limitation, not an open product defect.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.
- Repository Prettier hooks normalized Markdown table alignment in this PR; PM accepted the formatting. This creates a residual auditability limitation when comparing prior table edits; no formatter bypass or manual reversal was used.
- **MOBILE-SCROLL-FLICKER-01 — OPEN:** reproduction is currently blocked by the harness precondition `MISSING_GENERATED_VERSION_INFO`; a physical iPhone gate was not run and root cause remains unknown. This continues to block future optional NAV-VISUAL PR6 glass expansion.
- **TABLET-HEADER-WIDTH-01 — CONFIRMED:** at 768×1024, 884×1104, 900×1100 and 992×1104 the header is approximately 370 px wide with unused space and no overflow. Fix now: NO. Target: NAV-VISUAL-01 / PR4 MEDIUM-RAIL.
- **DOCS-LINT-01 — OPEN:** preserve the existing documentation/superpowers formatting debt; do not expand this reconciliation to unrelated files.
- **HOME-HARNESS-STABILITY-01 — OPEN:** keep deterministic baseline failures separate from intermittent stability failures. Deterministic 10/10 failures: `LIST_SEARCH_DATE_SORT_PRESERVED`, `READER_MEASURE_01_CPL`. Intermittent 6/10 failures: `READER_VISUAL_01_WIDE_IMAGE`, `READER_MEASURE_01_DEFAULT_75_PARITY`, `READER_MEASURE_01_MEDIA_PROTECTION`. Root cause remains unknown; no product fix is claimed here.
- **READER-MEDIA-01A — OPEN / DRAFT PR #70:** next active functional candidate; its base is stale and must be refreshed onto current main before candidate and authenticated Reader/media gates.
- **ABOUT-ACCESSIBLE-BRAND-01 — COMPLETED:** resolved by PR #65; it is no longer an open finding.
- **RUNTIME-IDENTITY-02 — CLOSED / NON-PRODUCT:** classified as `OLD_DOCUMENT_SESSION`; fresh-document validation showed the prior tab retained old JavaScript while new requests served the R5 asset. Server, asset, Service Worker and Cache Storage were not the cause; no product or deployment defect was found.

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

## Next recommended action

Current sequence: complete the separate `DOCS-LINT-01` formatting-only PR, then refresh open draft PR #70 / `READER-MEDIA-01A` onto the exact current `main` and run its candidate/authenticated media gates. After PR #70 closes, resume NAV-VISUAL with Medium Rail / PR4; `TABLET-HEADER-WIDTH-01` remains targeted there. `MARK-ALL-UNDO-JUMP-01` remains held for real reproduction evidence. This documentation reconciliation does not authorize product implementation, merge or promotion.

## Deployment governance

- Deploy only an exact approved product/runtime SHA.
- Never deploy `latest` or a moving branch implicitly.
- Live production state reconciled on 2026-10-20: image `newsflux-local:d01e34fc2eb7`, image ID `sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c`, revision label `d01e34fc2eb76da39467d1de9799b12194faec9c`, source label `https://github.com/jfsdias/NewsFlux`, status `running`, restart count `0`.
- Internal HTTP gate returned `200`. The canonical Compose image is `newsflux-local:d01e34fc2eb7`; no candidate override is active, and the archived candidate override remains preserved.
- `PRODUCT_PRODUCTION_PARITY=PASS` and `CANONICAL_RUNTIME_PARITY=PASS`. PR #71 merge SHA `d01e34fc2eb76da39467d1de9799b12194faec9c` remains the current product and production SHA; PR #72 advanced GitHub `main` only because it was docs-only.
- `PERMANENT_PROMOTION=PASS`; `ROLLBACK_USED=NO`.
- The historical PR #44 promotion remains in the completion history. Current production state is recorded above.
- Docs-only work does not need a production deployment.
- Do not delete rollback images or backups incidentally.
