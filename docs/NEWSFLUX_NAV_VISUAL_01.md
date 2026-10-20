# NAV-VISUAL-01 — Adaptive navigation contract

- **Status:** approved contract; PR0 and PR1 implemented; remaining NAV-VISUAL slices are deferred.
- **Reconciled:** 2026-10-20, against `main` / production SHA `d01e34fc2eb76da39467d1de9799b12194faec9c`.
- **Implementation authorization:** PR0 / PR1 are completed; future slices remain unauthorized by this document.
- **Product implementation authorization:** NO for remaining slices.
- **Merge authorization:** NO.
- **Production deployment authorization:** NO for future changes; PR #71 is already promoted.
- **Real-device gates:** required where specified below; the critical 884×1104 viewport remains mandatory.

This document preserves the approved historical design contract and separately records the post-PR71 implementation baseline. PR #71 was accepted and merged as the current compact-navigation product baseline. `NAV_CONTRACT_DRIFT_01` is resolved as `RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION`: the historical compact contract is solid, while PR #71 uses NewsFlux glass tokens and `backdrop-filter`, accepted as the current baseline. Preserve both facts; future glass eligibility gates are not waived.

## Post-PR71 implementation state

- PR0 / #69 completed the window-class foundation (`cf37807a4d3b9da39d3c438861fac358d936fdaa`).
- PR1 / #71 completed the compact-navigation renderer and Reader/Drawer focus and resize hardening; merge and current production baseline are `d01e34fc2eb76da39467d1de9799b12194faec9c`.
- The compact bar currently uses `--nf-glass-*` tokens and `backdrop-filter`.
- Medium Rail / PR4, including the 884×1104 slice and `TABLET-HEADER-WIDTH-01`, remains deferred until PR #70 closes.
- `NAV-PR1-HARNESS-DESKTOP-MODEL-01` remains a P3 finding.
- `NAV-PR1-ROUTE-FOCUS-01` remains a P3 finding.
- `MOBILE-SCROLL-FLICKER-01` remains a distinct open finding. It and future glass-expansion gates are not waived by PR #71 acceptance.

```text
NAV_CONTRACT_DRIFT_01=RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION
HISTORICAL_APPROVED_COMPACT_NAV_V1=SOLID
CURRENT_PR71_COMPACT_BASELINE=GLASS_TOKENS_AND_BACKDROP_FILTER
HISTORICAL_CONTRACT_PRESERVED=YES
CURRENT_PR71_BASELINE_ACCEPTED=YES
FUTURE_GLASS_GATES_WAIVED=NO
MOBILE_SCROLL_FLICKER_01=OPEN
PR0_STATUS=COMPLETED / PR #69
PR1_STATUS=COMPLETED / PR #71
MEDIUM_RAIL_STATUS=DEFERRED / PR4 / AFTER_PR70
NAV-PR1-HARNESS-DESKTOP-MODEL-01=OPEN_P3
NAV-PR1-ROUTE-FOCUS-01=OPEN_P3
FUTURE_SLICES_AUTHORIZED=NO
```

## Window classes and architecture

```text
COMPACT=width < 600px AND height >= 480px
MEDIUM=600px <= width < 993px OR (width < 600px AND height < 480px)
DESKTOP=width >= 993px
EXPANDED=not a navigation class
884×1104=MEDIUM
LEGACY_768PX_CONTENT_DENSITY_AXIS=SEPARATE
ARCHITECTURE=shared navigation model + separate renderers
PRIMARY_NAV_OWNERSHIP=app shell, not Content
COMPACT=bottom bar
MEDIUM=rail
DESKTOP=existing Sider
```

The 768px content-density axis remains independent of these navigation classes. Do not infer a navigation class from `EXPANDED` or migrate the legacy axis in this work.

## Compact contract

This is the **historical approved contract** as of 2026-10-19. Its solid-surface requirement remains in the design record and does not describe the merged PR #71 implementation.

Reference viewport: **390×844**.

The compact bottom bar renders the same shared five-destination model:

1. Home
2. All
3. Today
4. Starred
5. Sources/Browse — the label remains an open decision.

```text
COMPACT_NAV_V1=SOLID
COMPACT_READER_PRIMARY_NAV=HIDDEN
```

FooterPanel remains owned by Content and stays in normal flow above compact navigation where applicable. Home has no FooterPanel. Do not portal FooterPanel into the app shell.

## Medium contract

The **884×1104** viewport is a mandatory medium-class acceptance case.

```text
MEDIUM_RAIL_WIDTH=80px
MEDIUM_RAIL_SURFACE=OPAQUE
MEDIUM_DESTINATIONS=shared navigation model
MEDIUM_READER_PRIMARY_NAV=HIDDEN
MEDIUM_COLLAPSED_OR_EXPANDED_MODE=PROHIBITED
```

The fifth destination opens or reuses the existing source browser/Sidebar content. The rail does not add a new persisted navigation mode.

## Desktop contract

At widths `>=993px`, the existing desktop Sider initially remains. The initial NAV-VISUAL slices do not redesign desktop navigation. Preserve existing Sider behavior when the reader takes over.

## Reader takeover and state continuity

```text
COMPACT_READER_PRIMARY_NAV=HIDDEN
MEDIUM_READER_PRIMARY_NAV=HIDDEN
DESKTOP_READER_SIDER=EXISTING_BEHAVIOR_PRESERVED
NEW_PERSISTED_NAVIGATION_STATE=NO
```

Window-class transitions must not unnecessarily remount or reset:

- Main;
- the reader;
- the list session;
- FooterPanel;
- the Mark-All operation;
- Undo state.

```text
MAIN_REMOUNT_ON_WINDOW_CLASS_CHANGE=PROHIBITED
```

## FooterPanel ownership

```text
FOOTERPANEL_OWNERSHIP=Content
FOOTERPANEL_PORTAL=PROHIBITED
```

Rejected alternatives:

- moving FooterPanel to an app-shell portal;
- merging FooterPanel into primary navigation;
- moving FooterPanel wholesale into the header.

Keep its contextual action semantics and Mark-All/Undo state continuity.

## DG-1 compact density gate

At 390×844, compare the same device, orientation, and content state:

```text
POST_NAV_VISIBLE_LIST_HEIGHT / BASELINE_VISIBLE_LIST_HEIGHT >= 0.90
```

If the ratio fails, stop and return to PM/Design. Do not automatically relocate or remove controls to pass the gate.

## Historical glass eligibility gate and future glass expansion

The approved historical contract specified a solid compact V1. PR #71 nevertheless merged the compact bar with NewsFlux glass tokens and `backdrop-filter`; this is `NAV_CONTRACT_DRIFT_01`, and PR #71 establishes the current product baseline. This does not imply that every glass eligibility gate passed or that future glass expansion is approved. `MOBILE-SCROLL-FLICKER-01` and future expansion gates remain distinct.

The original PR6 glass eligibility gate remains:

```text
MOBILE-SCROLL-FLICKER-01_ROOT_CAUSE=KNOWN_OR_CLEARED
IOS_REAL_DEVICE_GATE=PASS
SCROLL_UNDERLAY=PASS
SAFE_AREA=PASS
VIRTUALIZATION_SENTINEL=PASS
```

The original PR6 proposal considered glass ineligible until these gates passed. PR #71 establishes the current implementation baseline but does not provide evidence that these independent future-expansion gates passed. Content surfaces remain opaque; glass remains chrome-only.

## Accessibility contract

- One primary navigation landmark in compact and medium.
- Use links for destinations and `aria-current="page"` for the current destination.
- Use a button for the source-browser opener.
- New navigation targets are at least 48×48 px.
- Preserve ordinary Tab order, safe focus transfer, and focus restoration.
- Support 200% text, right-to-left layout, and reduced motion.
- Include VoiceOver and TalkBack real-device gates.

## PR0–PR7 decomposition

The following is the **historical approved plan snapshot from 2026-10-19**. PR0 and PR1 are now complete; the remaining entries preserve the planned scope and gates.

```text
PR0=WINDOW-CLASS-FOUNDATION
PR1=NAVIGATION-MODEL
PR2=SOURCES-PANEL
PR3=COMPACT-BOTTOM-BAR / SOLID
PR4=MEDIUM-RAIL / 884×1104 mandatory
PR5=RESIZE-FOLD-FOCUS-POLISH
PR6=OPTIONAL GLASS UNDERLAY / blocked by MOBILE-SCROLL-FLICKER-01
PR7=OPTIONAL SIDEBAR MODEL ALIGNMENT
PR0–PR7=PLANNED (HISTORICAL SNAPSHOT)
PR0–PR7_IN_PROGRESS=NONE (HISTORICAL SNAPSHOT)
NAV_VISUAL_IMPLEMENTATION=NOT_STARTED (HISTORICAL SNAPSHOT)
```

Current implementation status is recorded above. PR #71 acceptance/merge establishes the current compact-navigation baseline; remaining slices continue to require their own scope, authorization and gates.

## Nine open design decisions

Keep exactly these nine decisions open; do not replace them with visual packages or backlog categories:

1. Fifth destination label: Sources vs Browse.
2. Fold/tablet behavior at widths `>=993px`.
3. Whether compact navigation hides on scroll.
4. Sources Drawer vs a future bottom sheet.
5. Glass underlay eligibility and treatment.
6. Profile placement in the medium rail.
7. Compact Mark-All chip ordering.
8. Toast/Undo placement relative to bottom navigation.
9. Migration of the legacy 768px content-density axis.

All nine remain `OPEN`; the approved contract records boundaries without deciding these questions.

## Open findings retained

- `MOBILE-SCROLL-FLICKER-01` — OPEN. Reproduction is blocked by the harness precondition `MISSING_GENERATED_VERSION_INFO`; a physical iPhone gate was not run and root cause remains unknown. Future optional PR6 glass expansion remains blocked.
- `TABLET-HEADER-WIDTH-01` — CONFIRMED. The narrow header was observed without overflow at 768×1024, 884×1104, 900×1100 and 992×1104. Fix now: NO; target: PR4 MEDIUM-RAIL.
- `DOCS-LINT-01` — OPEN; preserve unrelated documentation/superpowers formatting debt.
- `HOME-HARNESS-STABILITY-01` — OPEN; deterministic baseline failures must remain separate from intermittent stability failures and are not part of NAV-VISUAL implementation.

`ABOUT-RUNTIME-REVISION-01` is resolved by PR #63 and `ABOUT-ACCESSIBLE-BRAND-01` is resolved by PR #65; neither is an open finding.

## Governance

- Miniflux remains the source of truth for feeds, categories, read state, and starred state.
- Navigation adds no persistent NewsFlux state.
- Keep All/Unread chronological and predictable.
- Mobile, tablet, and Fold remain single-pane-first.
- Deploy only an exact approved SHA; this documentation change does not authorize deployment.
- PR #62 was documentation-only and is merged; its completion does not authorize NAV-VISUAL implementation or merge.
