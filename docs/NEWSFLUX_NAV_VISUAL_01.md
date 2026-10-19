# NAV-VISUAL-01 — Adaptive navigation contract

- **Status:** design contract approved; implementation not started.
- **Reconciled:** 2026-10-19, against `main` / production SHA `405e9d7b1a3097dacef50c7908abf83d480d64dd`.
- **Implementation authorization:** NO.
- **Product implementation authorization:** NO.
- **Merge authorization:** NO.
- **Production deployment authorization:** NO.
- **Real-device gates:** required where specified below; the critical 884×1104 viewport is mandatory.

This is the complete approved design contract. Recording it does not authorize implementation, resolve open decisions, or change navigation behavior.

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

## Glass eligibility gate

Compact V1 remains solid. PR6 glass is eligible only after every gate passes:

```text
MOBILE-SCROLL-FLICKER-01_ROOT_CAUSE=KNOWN_OR_CLEARED
IOS_REAL_DEVICE_GATE=PASS
SCROLL_UNDERLAY=PASS
SAFE_AREA=PASS
VIRTUALIZATION_SENTINEL=PASS
```

Until then, glass is not eligible for this navigation surface. Content surfaces remain opaque; glass is chrome-only.

## Accessibility contract

- One primary navigation landmark in compact and medium.
- Use links for destinations and `aria-current="page"` for the current destination.
- Use a button for the source-browser opener.
- New navigation targets are at least 48×48 px.
- Preserve ordinary Tab order, safe focus transfer, and focus restoration.
- Support 200% text, right-to-left layout, and reduced motion.
- Include VoiceOver and TalkBack real-device gates.

## PR0–PR7 decomposition

```text
PR0=WINDOW-CLASS-FOUNDATION
PR1=NAVIGATION-MODEL
PR2=SOURCES-PANEL
PR3=COMPACT-BOTTOM-BAR / SOLID
PR4=MEDIUM-RAIL / 884×1104 mandatory
PR5=RESIZE-FOLD-FOCUS-POLISH
PR6=OPTIONAL GLASS UNDERLAY / blocked by MOBILE-SCROLL-FLICKER-01
PR7=OPTIONAL SIDEBAR MODEL ALIGNMENT
PR0–PR7=PLANNED
PR0–PR7_IN_PROGRESS=NONE
NAV_VISUAL_IMPLEMENTATION=NOT_STARTED
```

Each slice keeps one purpose per PR and follows the governance gates in the roadmap. This plan does not authorize any slice.

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

- `MOBILE-SCROLL-FLICKER-01` — OPEN. Reproduction is blocked by the harness precondition `MISSING_GENERATED_VERSION_INFO`; a physical iPhone gate was not run and root cause remains unknown. Optional PR6 glass stays blocked.
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
- PR #62 is documentation-only, remains draft, and does not authorize NAV-VISUAL implementation or merge.
