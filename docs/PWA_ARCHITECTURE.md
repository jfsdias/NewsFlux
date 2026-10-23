# NewsFlux PWA Foundation — Architecture Contract

- **Status:** planning and architecture contract. This document does not authorize implementation, merge or deployment.
- **Created:** 2026-10-22, against GitHub `main` at `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc`.
- **Last reconciled:** 2026-10-23, against GitHub `main` at `96bd1fe563571bfa322b2fd79f6fc12f49107a76`; current implementation and audit status is recorded in §15.
- **Track:** PWA Foundation architecture; the PWA-03A2 runtime sequence is complete in the current production app, while installability decisions remain open.
- **Amended:** 2026-10-22, after the PM review of PR #86 (PASS WITH DOCUMENTATION AMENDMENTS): the production topology is partially recorded (D4, `PM_REPORTED`), the authorization state of PWA-00 and PWA-01A is recorded, and a priority rule for PWA-03A is added. No product code changed.
- **Companion documents:** [`NEWSFLUX_ROADMAP.md`](./NEWSFLUX_ROADMAP.md) (sequencing), [`NEWSFLUX_PROJECT_STATE.md`](./NEWSFLUX_PROJECT_STATE.md) (operational state), [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (NetNewsWire UX research track), [`NEWSFLUX_NAV_VISUAL_01.md`](./NEWSFLUX_NAV_VISUAL_01.md) (window classes and navigation contract), [`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md) (PWA-00 measurement record).

```text
STATUS_SNAPSHOT_DATE=2026-10-22
STATUS_SNAPSHOT_SUPERSEDED_BY_SECTION_15=YES
PWA_FOUNDATION=PLANNING_SNAPSHOT
PWA_IMPLEMENTATION_AUTHORIZED=NO
PWA_00_AUTHORIZED_PLANNING_VALIDATION_CANDIDATE=YES
PWA_00_STARTED=YES
PWA_00_RESULT=LOCAL_AND_REPO_BASELINE_RECORDED__PUBLIC_ORIGIN_NOT_MEASURED
MID_READING_UPDATE_DISRUPTION=CONFIRMED_LOCAL_EXPERIMENT
PWA_03A_PRIORITY_RECOMMENDATION=YES
PWA_01A_AUTHORIZED=NO
PWA_03A_OUTRANKS_PWA_01A_IF_PWA_00_CONFIRMS_MIDREAD_RELOAD=YES
PRODUCTION_TOPOLOGY=PARTIALLY_RESOLVED_PM_REPORTED
MINIFLUX_SAME_ORIGIN_AS_NEWSFLUX_ASSUMED=NO
PWA_PARTIALLY_EXISTS_IN_MAIN=YES
PWA_01_IS_GREENFIELD=NO
PWA_INSTALLABILITY_EQUALS_OFFLINE_DATA_ARCHITECTURE=NO
CORRECT_FRESH_RUNTIME_OVER_AGGRESSIVE_OFFLINE_CACHING=YES
MINIFLUX_REMAINS_SOURCE_OF_TRUTH=YES
NEW_PERSISTENT_NEWSFLUX_STATE_AUTHORIZED=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

The original planning and audit sections below preserve their 2026-10-22 evidence and decisions. Their sequencing/authorization snapshot is historical; §15 records the current merged runtime and the later PWA-01A/01B audit outcomes. The architecture constraints and open PM decisions remain in force unless explicitly resolved there.

## 1. Purpose and boundaries

NewsFlux should be installable and well-behaved on the two ecosystems its owner uses — Android and the Apple ecosystem (iOS, iPadOS) — as **one product base**, without forking behavior per platform.

This document:

- records what PWA machinery **already exists** in `main` (it is more than the planning request assumed — see §3);
- defines principles, constraints, phases, gates, dependencies, risks and a suggested implementation order;
- separates **installability** from **offline data architecture**, which are different problems with different risk profiles;
- defines the future pull-request boundaries so PWA architecture, visual redesign, upstream sync and functional feed behavior never mix.

Non-goals of this document: implementing a manifest, service worker, icon, CSS or component change; deciding product semantics that the roadmap holds for the PM; creating any NewsFlux-owned persistent state.

### Evidence labels

Claims below carry one of these labels so reviewers can tell what was verified from what is expected.

| Label                | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CODE_VERIFIED`      | Read directly in the repository at the SHA above.                                                              |
| `BUILD_VERIFIED`     | Observed in a build output produced from that SHA (manifest, `sw.js`, bundle), including a non-root base path. |
| `PLATFORM_KNOWLEDGE` | General browser/OS behavior that is **not** verified on devices here; must be re-checked in PWA-00.            |
| `INFERENCE`          | Reasoned from the above; flagged so it is not mistaken for a measurement.                                      |
| `PM_REPORTED`        | Stated by the PM (for example production state); not independently verifiable from the repository.             |

PWA-00 ([`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md) §2.1) adds `LIVE_OBSERVED` (seen on the real production runtime), `LOCAL_EXPERIMENT` (seen in a controlled local experiment, never a statement about production) and `NOT_MEASURED`; its `REPO_VERIFIED` covers `CODE_VERIFIED` and `BUILD_VERIFIED`.

## 2. Principles (invariants for every PWA PR)

1. **`CORRECT_FRESH_RUNTIME > AGGRESSIVE_OFFLINE_CACHING`.** A PWA must not leave users trapped on an old build. When freshness and offline convenience conflict, freshness wins.
2. **`PWA installability != offline data architecture`.** A manifest, icons and display mode make the app installable. Caching authenticated data, queuing offline mutations or syncing state is a separate architecture decision (§5).
3. **Miniflux remains the source of truth** for feeds, categories, read/unread and starred. A PWA does not authorize a parallel persistent database.
4. **No essential function may depend on an API exclusive to one ecosystem.** Platform APIs are progressive enhancement only.
5. **Capability-detect, never user-agent-sniff**, for optional features. Every optional feature degrades to the normal web behavior.
6. **Browser tab ≠ standalone.** Behavior is validated separately for browser and installed modes on each platform; equivalence is never assumed.
7. **Time-to-content must not regress.** The PWA is not a justification for a slower first useful paint or slower first article (§9.2).
8. **One purpose per PR.** Never mix PWA architecture, visual redesign, upstream sync and functional feed behavior in one PR.
9. **Rollback is defined before shipping.** Every phase states how it is reversed, and what cannot be reversed on already-installed devices (§11).
10. **No indiscriminate caching of authenticated responses.** Caching is allow-list based, never "cache what the network returned".
11. **Existing NewsFlux contracts are preserved:** OLED-aware, editorial, Material interactions, Liquid Glass only as chrome, opaque content surfaces, single-pane-first on mobile/tablet/Fold, critical viewport `884×1104`, All/Unread chronological and predictable.

## 3. Repository and PWA audit baseline (2026-10-22)

The repository already ships a partial PWA. **PWA-01 is therefore an audit-and-harden problem, not a greenfield one.**

### 3.1 What exists

| Area                  | Finding                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Plugin                | `vite-plugin-pwa` with `registerType: "autoUpdate"`, Workbox `generateSW`, `devOptions.enabled: false` (`vite.config.js`).                                                                                                                                                                                                                                       | `CODE_VERIFIED`                                                    |
| Manifest              | Generated `manifest.webmanifest`: `name`, `short_name` = `NewsFlux`, `description`, `start_url` and `scope` = base path, `display: standalone`, `lang: en`, `theme_color #1F2327`, `background_color #ffffff`.                                                                                                                                                   | `BUILD_VERIFIED`                                                   |
| Icons                 | `favicon.ico`, `logo192.png` (10,246 B), `logo512.png` (47,887 B). **No `purpose: "maskable"`**, no dedicated maskable asset, no `id`, no `screenshots`, `shortcuts`, `share_target`, `categories` or `orientation`.                                                                                                                                             | `BUILD_VERIFIED`                                                   |
| Theme colors          | Manifest `theme_color #1F2327` and `background_color #ffffff` **do not match** the runtime palette: `index.html` declares `#F2F3F5` (light) / `#0B0D10` (dark) and `useTheme` rewrites the `theme-color` metas at runtime.                                                                                                                                       | `CODE_VERIFIED`                                                    |
| Apple head metadata   | `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` (starts `black`, synced by `useTheme`), `viewport-fit=cover`, `apple-touch-icon` → `logo192.png`. No `apple-mobile-web-app-title`; touch icon is 192 px, not 180.                                                                                              | `CODE_VERIFIED`                                                    |
| Standalone handling   | `navigator.standalone` toggles an `installed-pwa` class and a `--installed-app-viewport-height` workaround in `main.jsx`; `display-mode` (standalone and fullscreen) media blocks exist in `App.css`, `Sidebar.css` and `index.css`; a `.pwa-status-bar` element lives in `index.html`; `env(safe-area-inset-*)` is used across 13 CSS files.                    | `CODE_VERIFIED`                                                    |
| Service worker        | `skipWaiting()` **and** `clientsClaim()`; precache of 12 entries (≈ 900.5 KiB): `index.html`, two `styles/*.css`, `assets/index-*.{js,css}`, `assets/react-*.js`, runtime and workbox-window chunks, icons, manifest.                                                                                                                                            | `BUILD_VERIFIED`                                                   |
| Navigation handling   | A single `NavigationRoute` bound to precached `index.html` with **no denylist**: every in-scope navigation is served the app shell.                                                                                                                                                                                                                              | `BUILD_VERIFIED`                                                   |
| Runtime caching       | `CacheFirst` for `/assets/*.{js,css}` (30 days, 80 entries) and `/fonts/*.woff2` (1 year, 40 entries). **No API/runtime caching of authenticated responses.**                                                                                                                                                                                                    | `BUILD_VERIFIED`                                                   |
| Update behavior       | Registration runs in an idle callback. In the built register code, an `activated` or `controlling` event with `isUpdate` calls `window.location.reload()` unless a custom callback is supplied (none is). `vite:preloadError` triggers a reload guarded by a 10 s `sessionStorage` cooldown. After control, loaded runtime assets are re-fetched into the cache. | `BUILD_VERIFIED` / `CODE_VERIFIED`                                 |
| Base path             | `VITE_BASE_PATH` is a **build-time** value. A `/newsflux/` build rewrites the manifest `start_url`/`scope`, the `<link>` tags and the SW registration scope consistently. One image serves exactly one base path.                                                                                                                                                | `BUILD_VERIFIED`                                                   |
| Reverse proxy         | `Caddyfile` serves static files and falls back to `index.html` for any unmatched path; it sets **no explicit `Cache-Control`**. The repository `docker-compose.yml` still references the upstream `electh/reactflux` image; production uses a local build, with Caddy as the internal `newsflux:2000` upstream behind Nginx Proxy Manager (`PM_REPORTED`; §3.4). | `CODE_VERIFIED` (config); production build is `PM_REPORTED` / docs |
| Auth and storage      | `authState` is a `persistentAtom` in `localStorage` holding `{ server, token, username, password }`. No cookies, no IndexedDB, no Cache Storage for user data. Requests go from the browser directly to the user-supplied Miniflux server.                                                                                                                       | `CODE_VERIFIED`                                                    |
| Other persisted state | `settings`, `hotkeys`, `desktopSidebarCollapsed`, `expandedCategories` (all `localStorage`), plus an update-notification timestamp and a `sessionStorage` reload cooldown.                                                                                                                                                                                       | `CODE_VERIFIED`                                                    |
| Feed icons            | Fetched via `GET /v1/icons/{id}` into an **in-memory** store; optional `external_icon_id` URL; third-party fallback (see §4, F8).                                                                                                                                                                                                                                | `CODE_VERIFIED`                                                    |
| Prior runtime history | `RUNTIME-IDENTITY-02` was closed as `OLD_DOCUMENT_SESSION`: a stale loaded document, not the server, asset, Service Worker or Cache Storage. This is the failure class PWA update work must not reintroduce.                                                                                                                                                     | `CODE_VERIFIED` (docs)                                             |

### 3.2 What does **not** exist

- No offline data, no offline mutation queue, no background sync, no push, no Badging, no Share Target, no shortcuts, no install-prompt UX.
- Production topology is only partially documented: the public origin, TLS/reverse proxy and internal service are `PM_REPORTED` (§3.4). How the configured Miniflux origin relates to the NewsFlux origin is **not** known and is **not** assumed.

### 3.3 Consequence for the requested plan

The original proposal treated the manifest and service worker as future work. They are present. The plan below therefore **adds a measurement phase first (PWA-00)**, **reframes PWA-01 as hardening of an existing shell**, and recognises that **the existing service worker already has update-aggressive settings** that belong to the resilience track and may need to move earlier (§8).

### 3.4 Production topology (`PM_REPORTED`; D4 partially resolved)

Recorded from the PM review of PR #86. This is operational evidence supplied by the PM, **not** verified from the repository; PWA-00 re-measures it.

| Item                      | Value (`PM_REPORTED`)                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Public NewsFlux origin    | `https://news.jfsdias.ddns.net/`                                                        |
| TLS / reverse proxy       | Nginx Proxy Manager (NPM)                                                               |
| Docker network            | `npm-proxyyml_default`                                                                  |
| Internal NewsFlux service | `http://newsflux:2000` (the repository `Caddyfile` listens on `:2000`, `CODE_VERIFIED`) |
| Production image contract | Exact `newsflux-local:<shortcommit>` SHA; never an implicit `latest` or a moving branch |
| Miniflux API origin       | User-configurable; **treated as potentially cross-origin**                              |

Consequences and rules:

- NewsFlux is served at the root path of its own HTTPS origin, so base path `/` applies and a secure context is expected (`PLATFORM_KNOWLEDGE`). PWA-00 verifies the certificate chain, HSTS and redirects.
- **NewsFlux and Miniflux are not assumed to share an origin** unless PWA-00 measures it for the configured server. Cross-origin use depends on Miniflux's CORS behavior; the service worker must stay allow-list based either way (§6).
- NPM sits in front of Caddy, so the headers a browser receives are the combination of Caddy's and NPM's. Serving-contract work (PWA-01C) must be verified **through NPM**; optional proxy-level asset caching could interfere with `sw.js` and manifest revalidation (`PLATFORM_KNOWLEDGE`; to be measured).
- The exact-SHA image contract is already deployment governance (`NEWSFLUX_PROJECT_STATE.md`); no PWA change may weaken it.

Still unknown and **not assumed** until measured in PWA-00: whether any other application is served on the same origin or path; the exact headers NPM adds, overrides or caches; the Miniflux origin(s) users configure and their CORS behavior.

## 4. Findings and classification

Reported, classified and **not fixed** in this PR.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Class               | Severity   | Routing                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------- | ------------------------------------------------- |
| F1  | PWA exists in `main`; the planning assumption of a greenfield PWA-01 was wrong.                                                                                                                                                                                                                                                                                                                                                                                   | `ARCHITECTURE`      | Info       | Drives §8; no defect.                             |
| F2  | Manifest `theme_color`/`background_color` disagree with the runtime OLED/light palette. On Android the manifest `background_color` paints the launch splash, so a white splash on an OLED-dark app is expected (`PLATFORM_KNOWLEDGE`).                                                                                                                                                                                                                            | `PWA_THEME`         | Medium     | PWA-01B (absorbs `THEME-CHROME-01`).              |
| F3  | No maskable icon asset and no `purpose` on any icon; Android adaptive masking will inset or back the icon unpredictably (`PLATFORM_KNOWLEDGE`). Apple touch icon is 192 px rather than 180 px.                                                                                                                                                                                                                                                                    | `PWA_INSTALL`       | Medium     | PWA-01A.                                          |
| F4  | `autoUpdate` + `skipWaiting` + `clientsClaim` + an `isUpdate` → `window.location.reload()` path in the register code means a new SW takes control of an open document and may reload it mid-reading. Runtime effect (reader scroll, Mark-All Undo) is **not measured**.                                                                                                                                                                                           | `PWA_UPDATE`        | Medium     | PWA-00 measures; PWA-03A may pull forward (§8).   |
| F5  | Caddy SPA fallback returns `index.html` (HTTP 200) for any missing path, including a missing hashed `/assets/*` chunk, instead of a 404. A stale lazy chunk could therefore be answered with HTML where JavaScript is expected (`INFERENCE`; not exercised). No explicit `Cache-Control` for `sw.js`, `manifest.webmanifest` or `index.html`. Fallback behavior is read from the `Caddyfile` (`CODE_VERIFIED`); actual response headers are **not yet measured**. | `PWA_SERVING`       | Medium     | PWA-00 measures; PWA-01C (gated by ID-DEPLOY-01). |
| F6  | `NavigationRoute` has no denylist; if NewsFlux ever shares an origin with other apps (for example a Miniflux web UI on a sibling path), in-scope navigations would receive NewsFlux's shell. Topology is partially known (§3.4): NewsFlux has its own HTTPS origin, so sharing is unlikely but unmeasured.                                                                                                                                                        | `PWA_SCOPE`         | Low        | Input required (§12); PWA-01C.                    |
| F7  | `auth` persists a plaintext `password` (HTTP Basic) in `localStorage` alongside the optional token. Pre-existing; not introduced by PWA. Installed iOS apps are generally exempt from the Safari seven-day script-storage eviction, so credentials may persist longer (`PLATFORM_KNOWLEDGE`).                                                                                                                                                                     | `SECURITY`          | Medium     | Backlog; decision D8. Do not fix incidentally.    |
| F8  | `FeedIcon` falls back to `https://icons.duckduckgo.com/ip3/<host>.ico`, a **third-party request that discloses followed-site hostnames**. `getSecondHostname` returns the last two labels, so `www.bbc.co.uk` → `co.uk` (`CODE_VERIFIED`, reproduced with the function body).                                                                                                                                                                                     | `PRIVACY` / `BUG`   | Low–Medium | NNW-01B; decision D7.                             |
| F9  | State persistence is entirely per-browser-profile `localStorage`. An installed iOS web app has a separate storage container from Safari (`PLATFORM_KNOWLEDGE`), so `auth`, `settings`, `hotkeys` and sidebar state will **not** follow a user from Safari to the installed app. Not a defect; an expectation to document.                                                                                                                                         | `STATE_PERSISTENCE` | Info       | PWA-02B onboarding copy; **not** a sync feature.  |
| F10 | `docs/UPSTREAM_TRACKING.md` does not exist; upstream state lives only in the project-state and roadmap documents.                                                                                                                                                                                                                                                                                                                                                 | `DOCS`              | Info       | Recorded; no file created.                        |
| F11 | `PROJECT_STATE`/`ROADMAP` on `main` described PRs #82/#83/#84 as open and omitted merged PRs #74, #76 and #77. Reconciled in this PR (see the drift register in `NEWSFLUX_PROJECT_STATE.md`).                                                                                                                                                                                                                                                                     | `DOCS_DRIFT`        | Info       | Resolved by this documentation PR.                |

### 4.1 PWA-00 status of these findings

Measured 2026-10-22 ([`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md) §10). Where the table above says a runtime effect is "not measured" (F4, F5), this section supersedes it. Identifiers are unchanged.

```text
F2=CONFIRMED            # manifest colors disagree with the runtime palette (values observed)
F3=CONFIRMED            # no maskable icon, no purpose on any icon
F4=CONFIRMED            # a service worker update reloads the reading page: scroll, in-memory state and typed dialog text are lost (LOCAL_EXPERIMENT; production frequency NOT_MEASURED)
F5=PARTIALLY_CONFIRMED  # missing asset answered with HTML 200 and no Cache-Control on internal Caddy (LOCAL_EXPERIMENT); through NPM NOT_MEASURED
F6=NOT_MEASURED         # live origin topology; the public origin was not reachable from the measurement environment
F7=CONFIRMED            # plaintext password in localStorage after a username/password login
F8=CONFIRMED            # icon fallback requested https://icons.duckduckgo.com/ip3/co.uk.ico for a bbc.co.uk feed
F9=PARTIALLY_CONFIRMED  # localStorage and caches observed; the iOS storage container split is PLATFORM_KNOWLEDGE
```

New incidental findings `I1`–`I9` (for example the runtime cache keeping HTML under `.js` URLs, and two reload paths that can fire back to back) are in `PWA_00_BASELINE.md` §11.

## 5. Architecture decisions

### 5.1 Allowed without a new architecture decision

| Capability                                                                             | Why it is safe                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Manifest fields, icons (including maskable), `id`, theme/background colors             | Static metadata; no user data.                                    |
| `display-mode` / safe-area / viewport handling                                         | Presentation only.                                                |
| Precaching the **static app shell** and hashed build assets                            | Public, versioned, content-addressed; already the case.           |
| Update detection and an update UX                                                      | Operates on code, not user data.                                  |
| An offline/error **screen** that shows no user content                                 | Static.                                                           |
| Capability-detected Web Share, Badging from already-fetched counts, manifest shortcuts | Optional enhancements over data NewsFlux already holds in memory. |

### 5.2 Requires an explicit architecture decision first

| Capability                                                                 | Why it is blocked                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Caching **any** authenticated API response (entries, feeds, counts, icons) | Leaks one user's data across logout/server switch; staleness vs Miniflux truth; privacy.                       |
| IndexedDB/Cache mirror of feeds or entries (offline reading)               | Second source of truth; conflict, eviction and privacy rules required (`ROADMAP` §6).                          |
| Offline mutation queue, background sync, periodic sync                     | Partial-failure reconciliation, idempotency and stale-session protection already proved for online paths only. |
| Web Push / notifications                                                   | Needs a server component and subscription storage; Miniflux provides none.                                     |
| Persisting feed icons beyond the HTTP cache                                | New persistent state (`SOURCE_IDENTITY` architecture gate).                                                    |
| Any new persisted key in `localStorage`/IndexedDB for PWA purposes         | `ROADMAP` §12: new persistent NewsFlux state requires explicit architecture.                                   |

The decision, when needed, is recorded as its own architecture PR (documentation) **before** any implementation PR.

## 6. Authentication, session and security in standalone mode

| Topic                  | Current model (`CODE_VERIFIED`)                                                                                                                                            | Standalone consequence / rule                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential storage     | `localStorage["auth"]` = `{ server, token, username, password }`.                                                                                                          | Per-profile. On iOS the installed app and Safari are separate (`PLATFORM_KNOWLEDGE`); the user logs in again. On Android Chrome an installed app generally shares the browser profile (`PLATFORM_KNOWLEDGE`). Verify in PWA-00. |
| Request authentication | `X-Auth-Token` header or `Authorization: Basic`, sent browser → Miniflux server. **No cookies.**                                                                           | No cookie/session expiry, no CSRF surface for header-auth. The Miniflux origin is user-configurable and is treated as potentially cross-origin; same-origin is **not** assumed unless PWA-00 measures it (§3.4).                |
| Service worker reach   | SW matches only same-origin `/assets/*` and `/fonts/*`; API calls are not intercepted or cached.                                                                           | **Invariant:** the SW remains allow-list based. Any future route must never match a request carrying `Authorization` or `X-Auth-Token`, and must be proven by a test.                                                           |
| Logout / expiry        | `clearSession()` resets auth and in-memory stores; an HTTP 401 for the current session triggers it and navigates to `/login` carrying the interrupted path (`state.from`). | Any future cache must be cleared on logout **and** on server change (`sessionRevision` exists for in-memory state). Cache Storage is not cleared by `clearSession()` today (nothing user-specific is in it).                    |
| Deep links             | `createBrowserRouter` with `basename = BASE_URL`; the login flow preserves a `location.state.from` return path.                                                            | Standalone launches and OS-level link capture must keep the post-login return path and accept **same-origin relative paths only** (no open redirect). Gate `PWA_DEEP_LINK_LAUNCH`.                                              |
| Scope / same-origin    | Manifest `scope` = base path.                                                                                                                                              | Links to article sources are external to scope; they must leave the app predictably and keep `rel="noopener"`. Gate `PWA_NAV_ESCAPE`.                                                                                           |
| Third-party requests   | Feed icon fallback contacts `icons.duckduckgo.com`; `referrer` is `no-referrer`.                                                                                           | Discloses followed hostnames; decision D7 before extending identity work (NNW-01B).                                                                                                                                             |
| Plaintext password     | Stored in `localStorage` for Basic auth.                                                                                                                                   | Pre-existing (F7). PWA does not worsen exposure but may lengthen residency. Prefer token auth in guidance; decision D8. No cache of authenticated responses may be introduced to "improve offline".                             |

## 7. Phases

Each phase card states goal, non-goals, candidate files (indicative, not authorization), architecture assumptions, prerequisites, exact gates, device/browser matrix, rollback and residual risks, with the recommended PR boundaries. Gate identifiers are defined in §9; matrix identifiers (M1–M9) in §10.

### PWA-00 — Baseline audit of the existing PWA (new)

- **GOAL:** measure and record what the shipped PWA actually does, on real devices, before changing it.
- **NON_GOALS:** any product-code, manifest, icon, CSS or service-worker change; fixing findings.
- **CANDIDATE_FILES:** none in product code. Evidence recorded in a docs-only update to this file and `NEWSFLUX_PROJECT_STATE.md`.
- **AUTHORIZATION:** the PM review of PR #86 names PWA-00 as the next authorized planning/validation candidate after this documentation PR. It is evidence-only and contains no product code.
- **STATUS (2026-10-22):** executed and recorded in [`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md). Local and repository baseline recorded against `main` `68b39798`; the public origin, Nginx Proxy Manager headers and the real Miniflux origin are `NOT_MEASURED` (egress denied); real-device gates are `NOT_RUN`. `PWA_SW_NO_MIDSESSION_RELOAD` fails locally, so the priority rule below applies.
- **ARCHITECTURE_ASSUMPTIONS:** the public origin is `https://news.jfsdias.ddns.net/` behind Nginx Proxy Manager (`PM_REPORTED`, §3.4); installability and service workers require a secure context (`PLATFORM_KNOWLEDGE`), which PWA-00 verifies. The Miniflux origin is **not** assumed to be same-origin.
- **PREREQUISITES:** access to the production URL, an Android phone with Chrome, an iPhone and an iPad (Safari), the `884×1104` foldable/tablet, and a desktop browser with DevTools.
- **GATES:** `PWA_MANIFEST_VALID`, `PWA_INSTALL_ANDROID`, `PWA_INSTALL_IOS`, `PWA_INSTALL_IPADOS`, `PWA_STANDALONE_LAUNCH`, `PWA_SPLASH_NO_FLASH` (record), `PWA_SW_SCOPE`, `PWA_SW_NO_MIDSESSION_RELOAD` (record), `PWA_STALE_ASSET_RECOVERY` (record), `PWA_AUTH_PERSISTENCE` (record), `PWA_SERVING_HEADERS` (record, through NPM), `PWA_TOPOLOGY_MEASURED` (record), baseline performance numbers (§9.2).
- **PRIORITY_RULE:** if PWA-00 confirms a mid-reading reload or update disruption (`PWA_SW_NO_MIDSESSION_RELOAD` fails), PWA-03A outranks PWA-01A/01B (§8).
- **MATRIX:** M1–M9 (record, do not pass/fail what is not yet specified).
- **ROLLBACK:** none needed (read-only).
- **RESIDUAL_RISKS:** device availability; results are a snapshot of one build.
- **PR_BOUNDARIES:** evidence-only; one docs PR (`PWA-00B`) records the numbers. No code PR.

### PWA-01 — Installable shell (reframed as hardening)

Goal: make installation correct and consistent with the OLED/editorial identity **without** introducing an aggressive offline strategy.

#### PWA-01A — Manifest and icons

- **GOAL:** a complete, stable manifest and an icon set that masks correctly.
- **NON_GOALS:** screenshots, shortcuts, share target, service-worker changes, theme-color changes (01B).
- **CANDIDATE_FILES:** `vite.config.js` (manifest block), new icon assets under `public/`, a manifest static test (test-only).
- **ARCHITECTURE_ASSUMPTIONS:** a maskable icon needs a safe zone (artwork inside the central region) and its own asset; `id` must be chosen once because changing it later creates a second install identity (`PLATFORM_KNOWLEDGE`).
- **PREREQUISITES:** **not yet authorized by the PM (`PWA_01A_AUTHORIZED=NO`)**; PWA-00 evidence; decisions D1 (`id`), D3 (maskable art direction; use the `design-assets` brief); and no confirmed update disruption pending — if PWA-00 confirms a mid-reading reload, PWA-03A goes first (§8).
- **GATES:** `PWA_MANIFEST_VALID`, `PWA_ICON_MASKABLE_SAFE_ZONE`, `PWA_ICON_PAYLOAD`, `PWA_BASE_PATH` (root and one non-root base), `PWA_INSTALL_ANDROID`, `PWA_INSTALL_IOS` (icon), plus the standard regression and accessibility gates.
- **MATRIX:** M4, M6, M8 (installed) and M5/M7/M9 (browser) for before/after; M1–M3 smoke.
- **ROLLBACK:** revert the PR. Android re-reads the manifest on its own schedule; **iOS does not refresh an installed icon** — an icon change cannot be rolled out to existing iOS installs without re-adding the app (`PLATFORM_KNOWLEDGE`). Treat the icon as effectively one-way for iOS.
- **RESIDUAL_RISKS:** art quality across launchers; iOS icon permanence.
- **PR_BOUNDARIES:** one PR, metadata and assets only.

#### PWA-01B — Theme and display-mode integration (absorbs `THEME-CHROME-01`)

- **GOAL:** one coherent chrome identity across manifest, head metas, runtime theme, splash and safe areas.
- **NON_GOALS:** visual redesign, glass changes, navigation changes, new persisted state.
- **CANDIDATE_FILES:** `index.html`, `src/hooks/useTheme.js`, `src/index.css`, `src/App.css`, `src/components/Sidebar/Sidebar.css`, `src/main.jsx`, `public/styles/loading.css`, `vite.config.js` (colors only).
- **ARCHITECTURE_ASSUMPTIONS:** the manifest accepts a single `theme_color`/`background_color`; dark/light adaptation continues to come from the runtime metas (`PLATFORM_KNOWLEDGE`). The `display-mode` blocks and the `installed-pwa` workaround are inventoried before being consolidated, not rewritten blind.
- **PREREQUISITES:** PWA-01A merged; decision D2 (background/theme color policy for an OLED-first app); PWA-00 measurements of splash and status-bar behavior.
- **GATES:** `PWA_THEME_PARITY`, `PWA_SPLASH_NO_FLASH`, `PWA_SAFE_AREA`, `PWA_STANDALONE_LAUNCH`, `A11Y_CONTRAST`, `PWA_FOLD_TABLET` at `884×1104`, existing `A11Y-RT-01` reduced-transparency gate, `MOBILE-SCROLL-FLICKER-01` remains open and blocks any glass expansion.
- **MATRIX:** M1, M2, M4, M5, M6, M7, M8, M9.
- **ROLLBACK:** revert the PR; no data or cache involved.
- **RESIDUAL_RISKS:** iOS status-bar styles behave differently in browser vs standalone; interaction with the open `MOBILE-SCROLL-FLICKER-01`.
- **PR_BOUNDARIES:** one PR. Do **not** combine with any visual redesign.

#### PWA-01C — Serving contract (deployment-sensitive)

- **GOAL:** make the web server honor the PWA contract: `Cache-Control: no-cache` for `sw.js`, `manifest.webmanifest` and `index.html`; a real 404 for missing `/assets/*`; verified behavior under a non-root base path.
- **NON_GOALS:** changing application code, adding caching, changing the registry/deployer model.
- **CANDIDATE_FILES:** `Caddyfile` (and, only if unavoidable, `Dockerfile`).
- **ARCHITECTURE_ASSUMPTIONS:** production topology is `PM_REPORTED` (§3.4): Nginx Proxy Manager terminates TLS and proxies to `http://newsflux:2000`; header behavior must be verified **through NPM**. The repository `docker-compose.yml` is not the production definition.
- **PREREQUISITES:** `ID-DEPLOY-01` (HOLD — ARCHITECTURE) decided **or** an explicit PM waiver for this checked-in distribution change; PWA-00 header measurements; decision D5.
- **GATES:** `PWA_SERVING_HEADERS`, `PWA_STALE_ASSET_RECOVERY`, `PWA_BASE_PATH`, `PWA_SW_SCOPE`, plus the existing runtime/provenance gates (`ABOUT-RUNTIME-REVISION-01` identity must remain intact).
- **MATRIX:** M3, M5, M7 (HTTP behavior) and one installed device per platform.
- **ROLLBACK:** redeploy the previous exact image SHA (existing deployment governance).
- **RESIDUAL_RISKS:** Nginx Proxy Manager in front of Caddy may add, override or cache headers (including optional proxy-level asset caching, `PLATFORM_KNOWLEDGE`); a wrong 404 rule could break SPA deep links.
- **PR_BOUNDARIES:** its own PR and its own deployment window. Never bundled with 01A/01B.

### PWA-VAL-01 — Runtime/device validation (gate stage)

- **GOAL:** prove 01A/01B (and 01C if shipped) on the full matrix after promotion.
- **NON_GOALS:** new code.
- **GATES:** every `PWA_*` gate listed for 01A–01C, executed on devices, plus the `A11Y_*` set. Results recorded with runtime SHA, device, OS/browser version and mode (browser vs installed).
- **ROLLBACK/RISKS:** a failed gate returns to the owning PR; physical gates not run stay "not run" — never reported as PASS.
- **PR_BOUNDARIES:** evidence-only docs PR.

### PWA-02 — Platform adaptation

Defect-driven: each sub-phase starts from PWA-VAL-01 findings. If validation finds nothing, the sub-phase is a documented no-op.

#### PWA-02A — Android standalone

- **GOAL:** correct back-button, history, external-link and keyboard behavior in the installed Android app; optional capability-detected install UX.
- **NON_GOALS:** Share Target, shortcuts, notifications (PWA-04).
- **CANDIDATE_FILES:** `src/routes.jsx`, `src/components/Article/SidebarDrawerHost.jsx`, reader close/back handling, `src/main.jsx`; a new install-prompt hook only if approved.
- **ARCHITECTURE_ASSUMPTIONS:** system Back must close transient layers (drawer, lightbox, reader) before leaving the app; `beforeinstallprompt` is Chromium-only and optional (`PLATFORM_KNOWLEDGE`).
- **PREREQUISITES:** PWA-VAL-01 Android findings.
- **GATES:** `PWA_BACK_NAV`, `PWA_NAV_ESCAPE`, `PWA_DEEP_LINK_LAUNCH`, `A11Y_KEYBOARD`, `A11Y_FOCUS`, `PWA_FOLD_TABLET`, `READER-KEY-01` Escape gate preserved.
- **MATRIX:** M4 (primary), M5 (control), M2.
- **ROLLBACK:** revert the PR.
- **RESIDUAL_RISKS:** device/OS fragmentation; WebAPK update latency.
- **PR_BOUNDARIES:** one PR; no Apple code.

#### PWA-02B — Apple standalone (iOS and iPadOS)

- **GOAL:** correct safe-area, status-bar, viewport, keyboard/focus and navigation behavior in installed iOS/iPadOS web apps; clear first-run guidance that the installed app does not share Safari's session.
- **NON_GOALS:** any sync of settings/credentials between Safari and the installed app (that would be a persistence architecture change).
- **CANDIDATE_FILES:** `src/main.jsx` (installed-app viewport workaround), `src/index.css`, `src/pages/Login.*`, locale files (all six).
- **ARCHITECTURE_ASSUMPTIONS:** standalone storage is isolated from Safari (`PLATFORM_KNOWLEDGE`); `100vh`/`dvh` and the keyboard `visualViewport` need explicit validation.
- **PREREQUISITES:** PWA-VAL-01 Apple findings; `i18n` rule: every new string ships in `de-DE`, `en-US`, `es-ES`, `fr-FR`, `ja-JP`, `zh-CN`.
- **GATES:** `PWA_SAFE_AREA`, `PWA_AUTH_PERSISTENCE`, `PWA_NAV_ESCAPE`, `PWA_BACK_NAV` (swipe-back), `A11Y_*`, `PWA_FOLD_TABLET`/iPad split-view widths, `MOBILE-SCROLL-FLICKER-01` real-device gate remains required before any glass work.
- **MATRIX:** M6, M8 (primary), M7, M9 (control), M2.
- **ROLLBACK:** revert the PR.
- **RESIDUAL_RISKS:** iOS release-to-release behavior changes; no automated iOS standalone testing here.
- **PR_BOUNDARIES:** one PR; no Android code.

### PWA-03 — Resilience (plan only; nothing here is authorized)

Principle: `CORRECT_FRESH_RUNTIME > AGGRESSIVE_OFFLINE_CACHING`.

#### PWA-03A — Update safety

- **GOAL:** a deliberate, safe update flow: no surprise reload while reading or with Undo pending, no user trapped on an old build, and graceful recovery from stale lazy chunks.
- **NON_GOALS:** adding any cache; changing what is cached.
- **CANDIDATE_FILES:** `vite.config.js` (`registerType`, `skipWaiting`/`clientsClaim`), `src/main.jsx` registration, a new update-notice component, locale files (all six).
- **ARCHITECTURE_ASSUMPTIONS:** options are (a) keep auto-activation but defer the reload to an idle/safe moment, or (b) prompt the user. The choice is decision D6. The existing `preloadError` guard and runtime-asset warm-up are **kept** unless PWA-00 proves them wrong.
- **PREREQUISITES:** PWA-00 update/stale-chunk measurements; D6; PWA-01C if the fix needs a real 404 for missing assets.
- **GATES:** `PWA_SW_UPDATE_LATENCY`, `PWA_SW_NO_MIDSESSION_RELOAD`, `PWA_STALE_ASSET_RECOVERY`, `PWA_NO_AUTH_CACHE`, the Mark-All-Read regression gates (Undo must survive), `A11Y_*`.
- **MATRIX:** M3, M4, M6 (update across two real builds).
- **ROLLBACK:** SW kill switch (§11) then revert.
- **RESIDUAL_RISKS:** SW changes are the highest-blast-radius change in this track.
- **PR_BOUNDARIES:** one PR. **Outranks PWA-01A/01B if PWA-00 confirms a mid-reading reload or update disruption** (§8: correctness before cosmetic installability hardening); otherwise it follows PWA-VAL-01.

#### PWA-03B — Offline and error states (no data cache)

- **GOAL:** an explicit offline/unreachable-server screen and reconnect behavior, showing no cached user content.
- **NON_GOALS:** offline reading, caching of API data.
- **CANDIDATE_FILES:** error/empty-state components, an online/offline hook, locale files.
- **PREREQUISITES:** 03A; decision on copy; clarify what the precached shell does offline today (it boots, then API calls fail).
- **GATES:** `PWA_OFFLINE_STATE`, `PWA_RECONNECT`, `A11Y_*`.
- **ROLLBACK:** revert the PR.
- **PR_BOUNDARIES:** one PR.

#### PWA-03C — Kill switch and rollback runbook

- **GOAL:** a proven way to neutralize a bad service worker for installed users.
- **CANDIDATE_FILES:** `vite.config.js`, a documented self-unregistering SW variant, a runbook in this file.
- **GATES:** `PWA_KILL_SWITCH` — a deliberately broken build is recovered on a real device without reinstalling.
- **PR_BOUNDARIES:** one PR (or folded into 03A if PM prefers); runbook is documentation.

#### PWA-03D — Controlled cache policy (HOLD — ARCHITECTURE)

Any cache of authenticated or user-specific data is **blocked** until the architecture decision in §5.2 is made. Not scheduled.

### PWA-04 — Optional native-like capabilities (research and plan)

Every feature is capability-detected, optional, progressive enhancement and not required for normal use. Each is its own PR.

| ID  | Feature                        | Notes                                                                                                                                                                                       | State                              |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 04A | Badging API (`APP-BADGE-01`)   | Use already-fetched Miniflux unread counts; updates only while the app runs; permission and installed-only rules differ by platform (`PLATFORM_KNOWLEDGE`).                                 | PLANNED; after PWA-VAL-01          |
| 04B | Share Target → Add Feed        | Manifest `share_target` opening Add Feed pre-filled so the existing discovery flow (`ADD-FEED-DISCOVER-01`) handles it. Android-oriented; Apple lacks it. Touches Add Feed → functional PR. | RESEARCH; needs route/param design |
| 04C | Manifest shortcuts             | Deep links to Today, Unread, Add Feed; Android-oriented. Depends on deep-link gate.                                                                                                         | RESEARCH                           |
| 04D | Web Share                      | The reader already exposes a Share action; this item is an audit of capability detection only.                                                                                              | AUDIT                              |
| 04E | Push, background/periodic sync | Requires a push server and/or offline mutation queue.                                                                                                                                       | HOLD — ARCHITECTURE                |

## 8. Recommended order and rationale

Requested sequence: documentation → PWA-01 → validation → PWA-02 → NNW-01 → NNW-02 → NNW-03 → NNW-04 → PWA-03 → PWA-04.

Refined sequence (changes explained below):

```text
0  Documentation / architecture contract            (this PR)
1  PWA-00   baseline audit of the existing PWA       (evidence)          [added; next authorized candidate]
2  PWA-01A  manifest and icons                        [NOT yet authorized]
3  PWA-01B  theme and display-mode (absorbs THEME-CHROME-01)
4  PWA-VAL-01 runtime/device validation
5  PWA-03A  update safety                            [outranks 01A/01B on a confirmed update defect — see C]
6  PWA-02A / PWA-02B platform adaptation (defect-driven)
7  NNW-01A  source identity foundation
8  NNW-04   reader source header                     [moved before NNW-02/03]
9  NNW-02   navigation density                       [gated by NAV-02F / NAV-VISUAL]
10 NNW-03   contextual toolbar                       [gated by CHROME-01]
11 PWA-03B / PWA-03C offline-error states, kill switch
12 PWA-04   optional capabilities, one at a time
   PWA-01C  serving contract                         [parallel track; gated by ID-DEPLOY-01]
   NNW-05   multi-pane research (REA only)           [parallel; no PR]
```

| Change                                                    | Reason (from the code, not preference)                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** PWA-00 added before PWA-01                         | The manifest, service worker, iOS metas and a standalone viewport workaround already exist (§3). Changing them without a measured baseline would repeat the "stale document" class of problem and cannot satisfy the time-to-content gate.                                                                                                                                                                           |
| **B.** PWA-01 split and `THEME-CHROME-01` absorbed        | The roadmap's `THEME-CHROME-01` ("align browser/PWA theme surface") is the same work as the manifest/runtime color mismatch (F2). Serving headers (01C) touch distribution artifacts and are gated separately.                                                                                                                                                                                                       |
| **C.** PWA-03A outranks PWA-01A/01B on a confirmed defect | The shipped service worker is already update-aggressive (F4). **PM rule (review of PR #86):** if PWA-00 confirms a mid-reading reload or update disruption, PWA-03A is handled as correctness ahead of icon/manifest polish (cosmetic installability hardening), and platform adaptation work would otherwise be confounded by update reloads. If PWA-00 does not confirm it, PWA-03A follows PWA-VAL-01 as planned. |
| **D.** NNW-04 before NNW-02 and NNW-03                    | NNW-04 depends only on the source-identity primitive (NNW-01A) and touches one surface. NNW-02 and NNW-03 depend on unresolved product decisions (`NAV-02F`, `NAV-VISUAL-01` PR2/PR4/PR7, `CHROME-01`). Do the unblocked work first.                                                                                                                                                                                 |
| **E.** NNW work after the PWA baseline                    | Visual changes to the sidebar/reader before PWA-00 would contaminate the baseline measurements and device validation.                                                                                                                                                                                                                                                                                                |
| **F.** PWA-01C and NNW-05 off the main line               | 01C is deployment-sensitive and gated by `ID-DEPLOY-01`; NNW-05 is research-only.                                                                                                                                                                                                                                                                                                                                    |

### Authorization state and first implementation PR

```text
RECOMMENDED_FIRST_IMPLEMENTATION_PR=NONE_AUTHORIZED
PWA_00_AUTHORIZED_PLANNING_VALIDATION_CANDIDATE=YES
PWA_01A_AUTHORIZED=NO
FIRST_IMPLEMENTATION_PR_IF_PWA_00_CONFIRMS_MIDREAD_RELOAD=PWA-03A
FIRST_IMPLEMENTATION_PR_OTHERWISE=PWA-01A_SUBJECT_TO_SEPARATE_PM_AUTHORIZATION
PWA_00_RECOMMENDS=PWA-03A   # MID_READING_UPDATE_DISRUPTION=CONFIRMED; a recommendation, not an authorization
```

Per the PM review of PR #86: **`PWA-00` is the next authorized planning/validation candidate** after this documentation PR (evidence-only, no product code) and **`PWA-01A` is not yet authorized**. If PWA-00 confirms a mid-reading reload or update disruption, **`PWA-03A` outranks icon/manifest polish** and becomes the first implementation candidate; otherwise `PWA-01A` is the first candidate, still requiring its own PM authorization and decisions D1/D3. **PWA-00 result (2026-10-22):** the mid-reading reload was confirmed locally ([`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md) §6), so `PWA-03A` is the **recommended** next candidate; it is not authorized until the PM says so, and `PWA-01A` remains not authorized.

## 9. Gates

### 9.1 Installation, runtime and security gates

| Gate                          | Definition                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PWA_MANIFEST_VALID`          | Manifest fetches (200, correct type), parses, and passes the browser's installability checks on the exact promoted SHA.                                                     |
| `PWA_INSTALL_ANDROID`         | Installs from Chrome on Android; correct name and icon; launches standalone.                                                                                                |
| `PWA_INSTALL_IOS` / `_IPADOS` | Add to Home Screen works; correct name and icon; launches standalone.                                                                                                       |
| `PWA_STANDALONE_LAUNCH`       | Installed launch reaches the expected start page, logged-in or login, with no chrome glitches.                                                                              |
| `PWA_DEEP_LINK_LAUNCH`        | An in-scope deep link opens the correct view; post-login return path preserved; only same-origin relative paths accepted.                                                   |
| `PWA_BASE_PATH`               | Manifest, icons, SW scope and navigation work at `/` **and** one non-root base.                                                                                             |
| `PWA_ICON_PAYLOAD`            | Added icon bytes within budget (§9.2); maskable icon artwork inside the safe zone.                                                                                          |
| `PWA_THEME_PARITY`            | Manifest, head metas and runtime theme agree for light and dark/OLED; no wrong-color flash.                                                                                 |
| `PWA_SPLASH_NO_FLASH`         | Installed launch shows no white flash on the dark/OLED theme.                                                                                                               |
| `PWA_SAFE_AREA`               | No content under notches, status bar, home indicator or navigation bar in both orientations.                                                                                |
| `PWA_BACK_NAV`                | System/gesture Back closes transient layers first, then navigates history; never traps and never exits unexpectedly.                                                        |
| `PWA_NAV_ESCAPE`              | External links leave the app predictably and the user can return.                                                                                                           |
| `PWA_SW_SCOPE`                | The SW controls only the intended scope; no other path on a shared origin is affected.                                                                                      |
| `PWA_SW_UPDATE_LATENCY`       | Time from deploy to a user running the new build is measured and within the policy chosen in D6.                                                                            |
| `PWA_SW_NO_MIDSESSION_RELOAD` | A SW update never reloads the page while the reader is open or an Undo is pending.                                                                                          |
| `PWA_STALE_ASSET_RECOVERY`    | A missing/stale hashed chunk recovers without a blank screen or an HTML-as-JS error.                                                                                        |
| `PWA_SERVING_HEADERS`         | `sw.js`, `manifest.webmanifest`, `index.html` revalidate; missing `/assets/*` returns 404; verified through every proxy layer.                                              |
| `PWA_TOPOLOGY_MEASURED`       | Records whether the configured Miniflux origin is same- or cross-origin, its CORS behavior and the headers Nginx Proxy Manager adds; nothing is carried forward unmeasured. |
| `PWA_NO_AUTH_CACHE`           | Cache Storage and IndexedDB contain no response that carried `Authorization`/`X-Auth-Token`; logout leaves no user data.                                                    |
| `PWA_AUTH_PERSISTENCE`        | Login survives app restart in standalone; behavior vs the browser profile is recorded per platform.                                                                         |
| `PWA_OFFLINE_STATE`           | With the server unreachable the app shows an explicit state, no stale user content, and recovers on reconnect (03B).                                                        |
| `PWA_KILL_SWITCH`             | A bad SW is neutralized on a real installed device without reinstalling (03C).                                                                                              |

### 9.2 Performance gates

Absolute numbers are **proposals until PWA-00 records the baseline**; acceptance is relative to that baseline.

| Gate                       | Definition                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PWA_TTC_NO_REGRESSION`    | Time-to-first-article after login at fixed throttling (cold, warm, installed launch), median of ≥ 10 runs. Proposed: > +5 % regression is advisory, > +10 % blocks. |
| `PWA_COLD_START`           | Cold start with no SW/cache; record TTFB, FCP, LCP and JS transferred; no regression versus PWA-00.                                                                 |
| `PWA_ICON_PAYLOAD`         | Proposed: ≤ 100 KiB of added icon bytes in total; manifest ≤ 2 KiB gzip.                                                                                            |
| `PWA_CACHE_STORAGE_BUDGET` | Precache (baseline ≈ 900.5 KiB / 12 entries at `d7c0fc8e`) and runtime caches measured with `navigator.storage.estimate()`; any growth needs PM approval.           |
| `PWA_SW_OVERHEAD`          | Install and activation time and main-thread cost of SW startup measured once a change touches the SW.                                                               |
| `PWA_LOW_MEMORY`           | No crash/reload loop and acceptable scroll on a low-memory phone with the reader and lightbox opened repeatedly.                                                    |
| `PWA_FOLD_TABLET`          | All installed-mode gates re-run at `884×1104` and in the folded/narrow state.                                                                                       |

### 9.3 Accessibility gates (every PR that changes UI or behavior)

`A11Y_KEYBOARD` (full operation, no traps), `A11Y_FOCUS` (visible, restored after dismissals), `A11Y_REDUCED_MOTION`, `A11Y_TOUCH_TARGET` (≥ 48×48 px for new navigation targets, ≥ 44 px form controls — existing contract), `A11Y_CONTRAST` (AA in light and dark/OLED), `A11Y_SR_NAMING` (VoiceOver and TalkBack names), `A11Y_ZOOM_TEXT_SIZE` (200 % text and browser zoom resilience), `PWA_NAV_ESCAPE`, `PWA_BACK_NAV`.

### 9.4 Existing regression gates preserved

Any PWA PR must keep passing the established gates that its diff can plausibly affect: the Mark-All-Read set (`MARK_ALL_READ_SUCCESS`, `MARK_ALL_READ_FILTER_SCOPE`, `MARK_ALL_READ_NO_JUMP_ON_FAILURE`, `MARK_ALL_READ_JUMP_TO_NEXT`, `STALE_SESSION_PROTECTION`, `PARTIAL_FAILURE_RECONCILIATION`, `COUNTS_REFRESH`) including `markAllReadJumpToNext`; reader navigation (`NAV01`), Escape (`READER-KEY-01`), reader measure and media gates, `A11Y-RT-01`, and the `884×1104` critical-viewport checks.

## 10. Browser and platform matrix

| ID  | Environment                     | Mode               | Used for                                                        |
| --- | ------------------------------- | ------------------ | --------------------------------------------------------------- |
| M1  | `390×844` mobile narrow         | Browser/emulation  | Layout, safe-area approximation, regression harnesses.          |
| M2  | `884×1104` critical tablet/Fold | Browser and device | Mandatory for every phase that touches layout or chrome.        |
| M3  | Desktop standard (`1280×800`)   | Browser            | HTTP/headers/SW behavior, DevTools measurements.                |
| M4  | Android phone                   | **Installed**      | Standalone behavior, back navigation, splash, WebAPK.           |
| M5  | Android phone (Chrome)          | Browser            | Control for M4; storage sharing, install prompt.                |
| M6  | iPhone                          | **Installed**      | Home-Screen behavior, safe-area, status bar, storage isolation. |
| M7  | iPhone (Safari)                 | Browser            | Control for M6.                                                 |
| M8  | iPad                            | **Installed**      | iPadOS adaptation, split widths, keyboard.                      |
| M9  | iPad (Safari)                   | Browser            | Control for M8.                                                 |

Installed and browser rows are **never** merged. A result from M5 is not evidence for M4, nor M7 for M6, nor M9 for M8. Fold gates use M2 plus the folded/narrow state of the same device.

## 11. Rollback and irreversibility

| Change                     | Reversible by                                               | Not reversible on already-installed devices                                                                             |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Manifest fields, colors    | Revert and redeploy.                                        | Android refreshes on its own schedule; iOS does not re-read an installed app's manifest data (`PLATFORM_KNOWLEDGE`).    |
| Icons                      | Revert and redeploy.                                        | **iOS home-screen icon stays** until the user removes and re-adds the app.                                              |
| `manifest.id`              | Not safely reversible.                                      | A changed `id` creates a second install identity — choose once (D1).                                                    |
| Head metas, CSS, safe-area | Revert and redeploy.                                        | Cached documents update on next load.                                                                                   |
| Service worker             | **Kill switch** first (self-unregistering SW), then revert. | A broken SW can serve a broken shell from its precache until a corrected SW is fetched; `sw.js` must always revalidate. |
| Server headers             | Redeploy previous exact image SHA.                          | Intermediate/CDN caches may retain old headers.                                                                         |

The `sw.js` URL must stay stable for the life of the product; moving it orphans installed workers.

## 12. Inputs required from the PM (open)

| ID  | Decision / input                                                                                                                                                                                                                                                                                                                                      | Needed by        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| D1  | Manifest `id` value (stable, base-path aware).                                                                                                                                                                                                                                                                                                        | PWA-01A          |
| D2  | `theme_color` / `background_color` policy for an OLED-first app, given a single manifest value.                                                                                                                                                                                                                                                       | PWA-01B          |
| D3  | Maskable icon art direction.                                                                                                                                                                                                                                                                                                                          | PWA-01A          |
| D4  | **Partially resolved (`PM_REPORTED`, §3.4).** Recorded: origin `https://news.jfsdias.ddns.net/`, Nginx Proxy Manager, network `npm-proxyyml_default`, `http://newsflux:2000`, exact `newsflux-local:<shortcommit>` image contract. Remaining: relation to the Miniflux origin (not assumed same-origin) and NPM header behavior — measured in PWA-00. | PWA-00           |
| D5  | `ID-DEPLOY-01` (local build vs registry/deployer) or an explicit waiver so PWA-01C may change `Caddyfile`.                                                                                                                                                                                                                                            | PWA-01C          |
| D6  | Update policy: deferred auto-reload vs user prompt.                                                                                                                                                                                                                                                                                                   | PWA-03A          |
| D7  | Third-party icon fallback (DuckDuckGo): keep, make opt-in, proxy through Miniflux, or remove.                                                                                                                                                                                                                                                         | NNW-01B          |
| D8  | Token-only authentication guidance vs retained plaintext password in `localStorage`.                                                                                                                                                                                                                                                                  | Security backlog |
| D9  | Whether any offline reading is ever wanted (it triggers §5.2).                                                                                                                                                                                                                                                                                        | Before PWA-03D   |

## 13. Relationship to existing roadmap items

| Existing item                        | Relationship                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `THEME-CHROME-01` (BACKLOG)          | Absorbed by PWA-01B.                                                                         |
| `APP-BADGE-01` (BACKLOG)             | Becomes PWA-04A.                                                                             |
| `ID-DEPLOY-01` (HOLD — ARCHITECTURE) | Gate for PWA-01C.                                                                            |
| `NAV-VISUAL-01`                      | Window classes and safe-area expectations are inputs; PWA work must not redefine navigation. |
| `MOBILE-SCROLL-FLICKER-01` (OPEN)    | Still blocks glass expansion; PWA-02B must not claim a fix.                                  |
| `RUNTIME-IDENTITY-02` (CLOSED)       | The stale-document failure class that PWA-03A must avoid reintroducing.                      |
| `ABOUT-RUNTIME-REVISION-01` (DONE)   | Build identity must remain exact through any PWA/serving change.                             |
| `ADD-FEED-DISCOVER-01` (DONE)        | Natural consumer of a future Share Target (PWA-04B).                                         |

## 14. Evidence inventory

Read for this document (all at `d7c0fc8e`): `vite.config.js`, `index.html`, `src/main.jsx`, `src/hooks/useTheme.js`, `src/index.css`, `src/App.css`, `src/components/Sidebar/Sidebar.css`, `src/store/authState.js`, `src/store/sidebarState.js`, `src/utils/session.js`, `src/apis/ofetch.js`, `src/routes.jsx`, `src/pages/Login.jsx`, `src/components/ui/FeedIcon.jsx`, `src/hooks/useFeedIcons.js`, `Caddyfile`, `Dockerfile`, `docker-compose.yml`; build outputs `manifest.webmanifest`, `sw.js` and the main bundle for the default base path and for `VITE_BASE_PATH=/newsflux/`; the existing documentation set. The PM review of PR #86 supplied the `PM_REPORTED` production topology (§3.4). No product file was modified.

## 15. Current implementation and audit status (2026-10-23)

The architecture and audit work was reconciled against live GitHub `main` at `96bd1fe563571bfa322b2fd79f6fc12f49107a76`. A fresh production browser document loaded successfully and About reported the same full revision. This confirms the served app identity; no Docker image ID or container restart count was independently inspected in this session.

```text
CURRENT_MAIN=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_ABOUT_REVISION=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_APP_LOAD=PASS
PRODUCTION_DOCKER_IMAGE_INSPECTION=NOT_PERFORMED

PR90=PWA03A1_MERGED
PR90_MERGE_SHA=5ea21363676dd93dde97fd5ff8548e89864495ec
PR91=PWA03A2A_MERGED
PR91_MERGE_SHA=de8b4645df1b8ce17b4b02c2d54adb694af25109
PR93=PWA03A2C_MERGED
PR93_MERGE_SHA=950ae61b71433a6fd9c11fed9ed266a17fee3185
PR94=PWA03A2C1_MERGED
PR94_MERGE_SHA=6a8068e9809cafdecce0c695c78dcb151d95d4a4
PR95=PWA03A2B_MERGED
PR95_MERGE_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PWA03A2A=COMPLETE_MERGED
PWA03A2C=COMPLETE_MERGED
PWA03A2C1=COMPLETE_MERGED
PWA03A2B=COMPLETE_MERGED
PWA03A2=COMPLETE_PRODUCTION_AT_ABOUT_REVISION

PWA01A_AUDIT=COMPLETE
PWA01A_IMPLEMENTED=NO
PWA01A_OPEN_DECISIONS=D1_MANIFEST_ID;D3_MASKABLE_ICON_ART
PWA01A_PHYSICAL_INSTALL_AND_DEEP_LINK_GATES=NOT_RUN
PWA01B_AUDIT=COMPLETE
PWA01B_IMPLEMENTED=NO
PWA01B_OPEN_DECISION=D2_MANIFEST_THEME_AND_BACKGROUND_POLICY
PWA01B_RUNTIME_THEME_META=UPDATES_DURING_THEME_CHANGE

MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

### PWA-01A — installability audit

The existing generated manifest already builds with base-path-correct `start_url` and `scope` at both `/` and `/newsflux/`; both builds passed. All referenced icons exist. The manifest does not explicitly configure `id`, and the icon set has no maskable asset. No implementation was made: D1 must choose a stable manifest ID and D3 must choose the maskable icon art direction. Physical installed-app, deep-link and platform installation gates were not run, so this audit does not claim installability on Android, iOS or iPadOS.

### PWA-01B — theme and installed chrome audit

The runtime updates the `theme-color` metadata when the app theme changes. The manifest still supplies a single static `theme_color` / `background_color` pair, which cannot encode both light and dark policy. No implementation was made; D2 must decide the manifest color policy. Browser runtime metadata evidence is not a substitute for installed-app splash/chrome validation.

The 2026-10-22 rollback snapshot and PWA-03A2C deployment blocker are closed by the subsequent merged work recorded above. The production browser identity matches current `main`; this section records no Docker/container inspection. D1, D2 and D3 remain product decisions, and this document authorizes no new implementation, merge or deployment.
