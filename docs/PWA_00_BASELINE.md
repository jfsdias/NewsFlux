# PWA-00 — Runtime measurement and validation baseline

- **Status:** measurement record. This document does not authorize implementation, merge or deployment.
- **Executed:** 2026-10-22. Started against `main` at `326f9be1dbc1c41d75cc3f76e149cc6bfa7db6c1` (the merge of PR #86); `main` advanced to `68b39798fa6d823b2e5b1286aa42d4309c21c2ca` (PR #87, `HOME_CURSOR_TIE_DRAIN_V1`) during the run. **Final base: `68b39798…`** (§2.2).
- **Scope:** `PWA-00` as defined in [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) §7: investigation, measurement, validation and documentation. No product code, manifest, icon, service worker, Caddy or Nginx Proxy Manager (NPM) change was made.
- **Companion documents:** [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) (architecture contract, findings F1–F11, phases), [`NEWSFLUX_PROJECT_STATE.md`](./NEWSFLUX_PROJECT_STATE.md), [`NEWSFLUX_ROADMAP.md`](./NEWSFLUX_ROADMAP.md).

```text
BASE_SHA=68b39798fa6d823b2e5b1286aa42d4309c21c2ca
BASE_ADVANCED_DURING_PWA00=YES
OLD_BASE=326f9be1dbc1c41d75cc3f76e149cc6bfa7db6c1
FINAL_BASE=68b39798fa6d823b2e5b1286aa42d4309c21c2ca
PR87_PWA_INFRA_IMPACT=NONE_IDENTIFIED                     # REPO_VERIFIED by diff: only nine Home pagination files changed
PWA_00_RESULT=LOCAL_AND_REPO_BASELINE_RECORDED__PUBLIC_ORIGIN_NOT_MEASURED
PUBLIC_ORIGIN_REACHABLE_FROM_MEASUREMENT_ENVIRONMENT=NO   # egress policy denied news.jfsdias.ddns.net:443
MID_READING_UPDATE_DISRUPTION=CONFIRMED                   # LOCAL_EXPERIMENT; production frequency NOT_MEASURED
PWA_03A_PRIORITY_RECOMMENDATION=YES                       # recommendation only
NEXT_RECOMMENDED=PWA-03A
PWA_01A_AUTHORIZED=NO
PWA_TOPOLOGY_MEASURED=PARTIAL
UPDATE_CHECK_BUILD_METADATA_01=NEEDS_DIAGNOSTIC           # PM_REPORTED; the warning is stale since 07989972 (REPO_VERIFIED); §6.8; not fixed here
UPDATE_CHECK_DEPENDS_ON_COMMIT_DATE=NO                    # REPO_VERIFIED + LOCAL_EXPERIMENT
SERVICE_WORKER_UPDATE_AFFECTED=NO                         # REPO_VERIFIED + LOCAL_EXPERIMENT (no-date build pair)
APP_REVISION_CHECK_AFFECTED=NO                            # only the About "Build date" row shows Unknown
CONTROL_BUILD_REVISION_METADATA_GATE=PASS
IOS_REAL_DEVICE_GATE=NOT_RUN
ANDROID_REAL_DEVICE_GATE=NOT_RUN
CODE_FILES_CHANGED=0
IMPLEMENTATION_AUTHORIZED=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

## 1. What this changes

1. **A service worker update reloads the page the user is reading, automatically and without notice.** Reproduced with the real production bundle built from the exact final SHA with verified revision metadata (§6.8), the real Workbox service worker, Caddy 2.11.7 with the repository `Caddyfile`, and Chromium 141, at 884×1104 and 390×844. The route survives; the reader scroll position, in-memory state and an open dialog with typed text do not (§6). A negative control (same build, no change) does not reload, so the cause is the update, not the update check. A second build pair **without a commit date** behaves identically (§6.8).
2. **A second, independent reload path exists and can fire first.** After a deploy, opening a feature whose lazy chunk was never loaded requests a chunk that no longer exists. Caddy answers `index.html` with HTTP 200, the browser rejects it as a module, `vite:preloadError` reloads the page, and the service worker update then reloads it again a few seconds later (§6.5).
3. **The runtime cache stores that HTML under the `.js` URL** (`CacheFirst`, 30 days) and keeps serving it after the real file exists again (§6.5). This is a new finding (`I1`), not previously classified.
4. **The reported build-metadata anomaly does not touch the update mechanisms.** A missing commit date changes one field in the About dialog. It does not disable the in-app update check and it does not affect the service worker (§6.8). The warning text printed by the build was true until 2026-10-15 and has been stale since commit `07989972`, which removed the date guard (§6.8).
5. **The public origin could not be measured.** The measurement environment's egress policy denies `news.jfsdias.ddns.net`. Everything about Nginx Proxy Manager, the real Miniflux origin and the production headers is `NOT_MEASURED`; §4.4 is an exact runbook to close it.
6. **No real-device evidence exists.** iOS and Android gates are `NOT_RUN`.

## 2. Baseline, environment and method

### 2.1 Evidence labels

PWA-00 uses the following labels. `REPO_VERIFIED` covers what [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) calls `CODE_VERIFIED` and `BUILD_VERIFIED`; `LIVE_OBSERVED` and `LOCAL_EXPERIMENT` are new and are never interchangeable.

| Label                | Meaning                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPO_VERIFIED`      | Read in the versioned repository or in a build of the exact SHA.                                                                                |
| `LIVE_OBSERVED`      | Observed directly on the real production runtime or origin. **Nothing in this document carries this label.**                                    |
| `LOCAL_EXPERIMENT`   | Observed in a controlled local experiment (real built bundle, real Caddy, real Chromium) with synthetic data. Not a statement about production. |
| `PM_REPORTED`        | Supplied by the PM; not measured here.                                                                                                          |
| `PLATFORM_KNOWLEDGE` | Documented or known platform behavior, not observed in this environment.                                                                        |
| `INFERENCE`          | Reasoned conclusion, not measured.                                                                                                              |
| `NOT_MEASURED`       | No sufficient evidence.                                                                                                                         |

### 2.2 Pre-flight and baseline advance

- At the start, `git fetch origin --prune` and the GitHub API agreed: `main` = `326f9be1…`; no open pull requests; no branch or pull request for `HOME_CURSOR_TIE_DRAIN_V1`.
- During the run the PM reported that PR #87 (`HOME_CURSOR_TIE_DRAIN_V1`, head `b622dce3679a501b4630892ad365a3734da48d7b`) was merged and published: `main` and production = `68b39798fa6d823b2e5b1286aa42d4309c21c2ca` (`PM_REPORTED` for production). `git diff --name-only 326f9be1..68b39798` lists exactly nine files, all Home pagination: `scripts/tests/phase2c-editorial-home.jsx`, `src/apis/entries.js`, `src/hooks/useArticleList.js`, `src/hooks/useLoadMore.js`, `src/utils/home-editorial-session.js` (+ test), `src/utils/home-entry-request.js` (+ test) and `src/utils/home-tie-drain.test.js`.
- **PWA and runtime infrastructure drift from PR #87: none** (`REPO_VERIFIED`). The diff touches no `vite.config.js`, `Caddyfile`, `Dockerfile`, `index.html`, `package.json`, lockfile, `public/`, `src/main.jsx`, `src/scripts/`, workflow or service-worker file.
- The branch `claude/pwa-00-runtime-measurement` was recreated from `origin/main` at `68b39798` before any commit existed on it. No history was rewritten.
- The Home/list lane (`HOME_CURSOR_TIE_DRAIN_V1`) was not touched, and no Home or list functional problem was observed.

Evidence is reported in tiers:

| Tier                                     | Meaning                                                                                                                                                                                                                    | Items                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Before the advance (`326f9be1`)          | First pass. The static audit stays valid because the diff touches none of the audited files. The first update experiments are **superseded** (see the method correction in §2.4).                                          | §3 audit; the F control and F8 observation (below); the first update run, whose figures were reproduced after the rebuild.      |
| Revalidated on `68b39798`                | Rebuilt from the exact tree with explicit revision metadata; every gate that depends on the built or served runtime was rerun with unchanged results.                                                                      | §4.2 headers, §5 service worker runtime, §6 update experiment, §7 manifest, §9 storage.                                         |
| Production after the deploy (`68b39798`) | `PM_REPORTED` only; **this run never reached production**. Runtime `newsflux-local:68b39798fa6d`; authenticated Home PASS; pagination PASS; no console errors; one React hydration warning; the commit-date build warning. | §6.8, §11 (`I8`, `I9`), §12.                                                                                                    |
| Not rerun on purpose                     | The code involved is not in the PR #87 diff (`REPO_VERIFIED`).                                                                                                                                                             | The no-CORS control (`Login`, the API client) and the icon-fallback observation (`FeedIcon`), both run on the `326f9be1` build. |

### 2.3 Environment

| Item           | Value                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host           | Cloud container, Linux 6.18, Node v22.22.0, pnpm 11.21.0.                                                                                                                                                                      |
| Browser        | Chromium **141.0.7390.37**, headless, driven by Playwright 1.56.1. A fresh context per scenario. No WebKit or Gecko engine was available.                                                                                      |
| Build          | `vite build` of the exact SHA: `vite-plugin-pwa` 2.0.0 (`generateSW`), Workbox 7.4.1, 12 precache entries, 900.54 KiB (`REPO_VERIFIED`; unchanged by PR #87).                                                                  |
| Static server  | Caddy module `github.com/caddyserver/caddy/v2` **v2.11.7** (the version pinned in the `Dockerfile`), compiled with `go install`. Its `caddy version` prints `unknown`; the version is taken from the embedded module metadata. |
| Caddyfile      | The repository `Caddyfile`, byte-identical except line 3 (`root * /srv` → the build directory), proven with `diff`. The container `/srv` was not modified.                                                                     |
| Miniflux       | A synthetic local server (60 entries, long articles), on a **different origin and port**, answering CORS preflights. Only synthetic credentials were used. No endpoint used by the PR #87 Home code was missing from it.       |
| Secure context | `http://127.0.0.1` is a secure context, so service workers run. Production is HTTPS (`PM_REPORTED`); TLS behavior is not exercised.                                                                                            |

**Egress.** The container reaches the internet through a policy-enforcing proxy. `https://news.jfsdias.ddns.net/` returned `403` on `CONNECT`; the proxy status endpoint recorded `connect_rejected` for `news.jfsdias.ddns.net:443`, and a second attempt after the baseline advance failed the same way. This is a property of the measurement environment, not a finding about production. It was not worked around.

### 2.4 Method

1. **Static audit** of the exact SHA and of the generated `sw.js`, manifest and entry bundle.
2. **Serving contract.** The build served by real Caddy; headers recorded for the ten required URL classes, discovered from the served HTML.
3. **Service worker runtime.** Fresh profile; lifecycle recorded from the Chrome DevTools Protocol `ServiceWorker` domain (authoritative state transitions) plus page navigations; Cache Storage listed by URL path only.
4. **Update experiment, with explicit revision metadata.** Every controlled build comes from `git archive` of `68b39798` (tracked files only, no `.git`, like the Docker build context), with the prebuild step run explicitly so that nothing is inherited from the working tree. Four builds exist:

   | Build | Metadata given to `src/scripts/version-info.js`                                                                                   | `gitDate` in the bundle    | Purpose                                                |
   | ----- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------ |
   | `A`   | `SOURCE_COMMIT=68b39798…`, `SOURCE_COMMIT_DATE=2026-10-22T11:58:06-03:00`, `NEWSFLUX_REQUIRE_BUILD_REVISION=1`                    | `2026-10-22T14:58:06.000Z` | The control: the exact SHA with the expected metadata. |
   | `B`   | `A` plus one added line in `src/main.jsx`; synthetic successor metadata `SOURCE_COMMIT=b0b0…b0`, date `2026-10-22T12:30:00-03:00` | `2026-10-22T15:30:00.000Z` | The "next deploy": new hashes and a new `sw.js`.       |
   | `XA`  | As `A`, **without** `SOURCE_COMMIT_DATE`                                                                                          | `null`                     | Reproduces the production build warning (§6.8).        |
   | `XB`  | As `B`, **without** `SOURCE_COMMIT_DATE`                                                                                          | `null`                     | The successor of `XA`.                                 |

   A "deploy" is an atomic `rename` of the symlink Caddy serves, so the old hashed files disappear exactly as they do when a container image is replaced. The reading session is: open `/all`, open the first entry, scroll the reader 2400 px, set a page-global marker. Reload is detected by the marker, `performance.timeOrigin` and navigation events.

   **Metadata gate.** After each build the generated `version-info.json` was read and the bundle was searched for the commit and the date: `A` and `B` contain both; `XA` and `XB` contain the commit and no date. `BUILD_REVISION_METADATA_GATE=PASS`.

5. **Manifest.** `Page.getAppManifest` and `Page.getInstallabilityErrors`, plus computed colors in light and dark.
6. **Storage.** Key names and value _shapes_ only. Credentials were never printed; boolean presence only.

**Method correction (disclosed).** The first controlled builds were produced with `vite build` directly, which skips the `prebuild` step of `package.json`. They therefore bundled a stale, git-ignored `src/version-info.json` left in the working tree from an earlier build (commit `16311d0d`, with a date): the revision metadata was present but belonged to another commit, and the exact-SHA claim did not hold for it. Those builds were discarded, and every figure in §5–§9 comes from the rebuilt `A`/`B` pair; the update figures were reproduced with the same outcome. A first version of the cache-persistence probe also used a chunk name hard-coded from the discarded build; it was replaced by a probe that reads the name from the build (§6.5).

The scripts live outside the repository and are **not committed** (`CODE_FILES_CHANGED=0`). §14 lists what each one does so the experiment can be rebuilt.

### 2.5 Fidelity limits

The experiment omits: NPM, TLS, network latency, real Miniflux data, WebKit and Gecko, and any physical device. It therefore proves a **mechanism** and a **data-loss consequence**; it does not measure how often production users meet it. It also never observed the production build: no conclusion here rests on the absence of an update in production.

## 3. Phase A — static PWA contract (`REPO_VERIFIED`)

```text
PWA_REGISTER_MODE=autoUpdate            # vite-plugin-pwa 2.0.0, generateSW; flag baked in the bundle (G = "true" === "true", self-destroying = false)
SKIP_WAITING=true                       # vite.config.js workbox.skipWaiting; sw.js calls self.skipWaiting() unconditionally
CLIENTS_CLAIM=true                      # sw.js calls clientsClaim()
UPDATE_CHECK_MODE=BROWSER_NATIVE_ONLY   # no registration.update(), no timer, no visibilitychange hook anywhere in src/
RELOAD_PATH_PRESENT=YES                 # three paths, below
NAVIGATION_FALLBACK=NavigationRoute -> createHandlerBoundToURL("index.html"), no denylist, no allowlist
RUNTIME_CACHING_RULES=CacheFirst /\/assets\/.*\.(?:css|js)$/ "runtime-build-assets" 30 d / 80 entries; CacheFirst /\/fonts\/.*\.woff2$/ "runtime-fonts" 1 y / 40 entries
AUTH_API_RUNTIME_CACHE_RULE=NONE        # no route matches /v1/*; a regex route only handles cross-origin URLs it matches at index 0 (workbox-routing RegExpRoute, REPO_VERIFIED)
BASE_PATH_BEHAVIOR=build-time VITE_BASE_PATH (validated pattern); manifest start_url/scope, router basename and Dockerfile copy path follow it; only base "/" was exercised here
```

The audit was done at `326f9be1`; the diff to `68b39798` touches none of the audited files, and the generated `sw.js`, manifest and 12-entry precache of the rebuilt build `A` match the first pass.

Reload paths in the code:

| #   | Path                                                                                                                                                                                                          | Source                                                          | User action? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| 1   | In `autoUpdate` mode the generated register code listens for the Workbox `activated` event and calls `window.location.reload()` when `isUpdate` or `isExternal` is true. `main.jsx` passes no `onNeedReload`. | `vite-plugin-pwa` template, confirmed in the built entry bundle | No           |
| 2   | `vite:preloadError` → `location.reload()`, guarded by a 10 s `sessionStorage` cooldown.                                                                                                                       | `src/main.jsx`                                                  | No           |
| 3   | Settings import → `location.reload()` after 600 ms.                                                                                                                                                           | `src/components/Settings/General.jsx`                           | Yes (import) |

Correction to earlier planning text: the reload in `autoUpdate` mode is bound to `activated`, not `controlling` (the `controlling` listener belongs to the non-auto mode).

Precache (12 entries, 900.54 KiB): `index.html`, `styles/loading.css`, `styles/fonts.css`, `assets/index-*.{js,css}`, `assets/react-*.js`, `assets/rolldown-runtime-*.js`, `assets/workbox-window*.js`, `favicon.ico`, `logo192.png`, `logo512.png`, `manifest.webmanifest`. Lazy chunks, the default feed icon and fonts are **not** precached. There is no separate registration script; the register code is bundled in the entry chunk.

Caddy (`Caddyfile`): existing file → `file_server`; everything else under the base path → `try_files {path} {path}/ <base>index.html` → `file_server`; the final `respond 404` is unreachable for base `/`. There is no `encode`, no `header` and no `Cache-Control` directive.

## 4. Phase B — HTTP serving contract

### 4.1 Public origin and Nginx Proxy Manager

```text
PUBLIC_HTTP_GATE=NOT_MEASURED   # egress policy denied news.jfsdias.ddns.net:443 (two attempts, one after the baseline advance)
NPM_HEADER_BEHAVIOR=NOT_MEASURED
PUBLIC_VS_INTERNAL_COMPARISON=NOT_MEASURED
```

### 4.2 Internal Caddy (`LOCAL_EXPERIMENT`, Caddy 2.11.7, repository `Caddyfile`, build `A` at `68b39798`)

The first pass at `326f9be1` produced the same rows. All rows below were `HTTP 200` with no redirect, `Vary: Accept-Encoding` and `Accept-Ranges: bytes`, and **no** `Cache-Control`, `Age`, `Service-Worker-Allowed`, `Content-Encoding` or security header.

| #   | URL class                                    | `Content-Type`                          | Validators              | Notes                                                  |
| --- | -------------------------------------------- | --------------------------------------- | ----------------------- | ------------------------------------------------------ |
| 1   | `/`                                          | `text/html; charset=utf-8`              | `ETag`, `Last-Modified` |                                                        |
| 2   | `/manifest.webmanifest`                      | **absent**                              | `ETag`, `Last-Modified` | See `I3`: depends on the host MIME database.           |
| 3   | `/sw.js`                                     | `text/javascript; charset=utf-8`        | `ETag`, `Last-Modified` | No `Service-Worker-Allowed` (scope `/` needs none).    |
| 4   | Workbox runtime `workbox-*.js`               | `text/javascript; charset=utf-8`        | `ETag`, `Last-Modified` | Content-hashed filename.                               |
| 5   | Hashed JS `assets/index-*.js`                | `text/javascript; charset=utf-8`        | `ETag`, `Last-Modified` |                                                        |
| 6   | Hashed CSS `assets/index-*.css`              | `text/css; charset=utf-8`               | `ETag`, `Last-Modified` |                                                        |
| 7   | `/logo192.png`, `/favicon.ico`               | `image/png`, `image/vnd.microsoft.icon` | `ETag`, `Last-Modified` |                                                        |
| 8   | Missing hashed JS and CSS                    | **`text/html; charset=utf-8`**          | `ETag`, `Last-Modified` | HTTP **200**, the body is `index.html`.                |
| 9   | Valid SPA route (`/all`, deep)               | `text/html; charset=utf-8`              | `ETag`, `Last-Modified` | Served by the fallback.                                |
| 10  | Non-existent route                           | `text/html; charset=utf-8`              | `ETag`, `Last-Modified` | HTTP **200**.                                          |
| –   | `/images/missing.png`, `/v1/me`              | `text/html; charset=utf-8`              | `ETag`, `Last-Modified` | The fallback ignores extension and `Accept`; HTTP 200. |
| –   | Conditional `GET` of `/sw.js`, manifest, `/` | –                                       | `ETag`                  | `304 Not Modified`: revalidation works when requested. |

Compression: a 354,496-byte chunk is the same size with and without `Accept-Encoding: gzip, br`. Internal Caddy does not compress.

### 4.3 Gates

```text
SW_CACHE_HEADER_SAFE=NOT_EXPLICIT              # no Cache-Control on sw.js (internal). The update fetch is mitigated by updateViaCache="imports" (observed on the registration, §5); effect PLATFORM_KNOWLEDGE. Public NOT_MEASURED.
MANIFEST_CACHE_HEADER_SAFE=NOT_EXPLICIT        # no Cache-Control; heuristic freshness possible (RFC 9111 §4.2.2, PLATFORM_KNOWLEDGE); low impact. Public NOT_MEASURED.
HASHED_ASSET_IMMUTABLE=NO                      # ETag + Last-Modified only; no max-age, no immutable. Public NOT_MEASURED.
MISSING_HASHED_ASSET_RETURNS_HTML=YES          # internal Caddy, LOCAL_EXPERIMENT. Public NOT_MEASURED.
SPA_FALLBACK_SCOPE=EVERY_PATH_THAT_IS_NOT_A_FILE   # any extension, API-shaped paths, no 404 under the base path
NPM_HEADER_BEHAVIOR=NOT_MEASURED
```

### 4.4 Runbook to close the public measurement

Run from any machine that can reach the origin. Nothing here changes production.

```bash
O=https://news.jfsdias.ddns.net
H() { curl -sS -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$@" \
  | grep -iE '^(HTTP/|content-type|cache-control|etag|last-modified|age|vary|service-worker-allowed|content-encoding|via|x-cache|server|strict-transport-security)'; }
HTML=$(curl -sS "$O/")
JS=$(printf '%s' "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'  | head -1)
CSS=$(printf '%s' "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.css' | head -1)
curl -sSIL -o /dev/null -w '%{num_redirects} redirects, final %{url_effective}\n' "$O/"
for p in / /manifest.webmanifest /sw.js "$JS" "$CSS" /logo192.png \
         /assets/index-DOESNOTEXIST000.js /all /this/route/does/not/exist; do
  echo "== $p"; H "$O$p"
done
```

To compare the internal layer, run the same loop with `O=http://newsflux:2000` from a container on the Docker network `npm-proxyyml_default` (`PM_REPORTED`). Record each row with `HTTP`, `Content-Type`, `Cache-Control`, `ETag`, `Last-Modified`, `Age`, `Vary`, `Service-Worker-Allowed`, `Content-Encoding` and any header NPM adds; then classify the differences.

To read what the production build itself reports, open the About dialog on the public origin: it shows the commit hash and the build date (`Unknown` when the date is missing, §6.8).

## 5. Phase C — service worker runtime (`LOCAL_EXPERIMENT`)

Fresh profile, 884×1104, build `A`, synthetic session. The first pass at `326f9be1` produced identical figures.

```text
SW_REGISTRATION=PASS            # registered ~75 ms after load; installing -> installed -> activating -> activated within ~185 ms of registration (no network latency)
SW_SCOPE=http://127.0.0.1:2000/ # equals the manifest scope; updateViaCache="imports"
PAGE_CONTROLLED=YES             # on the first visit, without a reload (skipWaiting + clientsClaim); every later navigation is controlled
CACHE_NAMES=workbox-precache-v2-<origin>/ (12), runtime-build-assets (32 after the first visit; lazy chunks); runtime-fonts absent in the measured view; IndexedDB "workbox-expiration"
AUTHENTICATED_API_IN_CACHE_STORAGE=NO   # 0 entries under /v1/, 0 cross-origin entries; token session and username/password session, cross-origin API
PRECACHE_BASELINE=12 entries, 900.54 KiB, matching the build output
OFFLINE_BASELINE=SHELL_BOOTS_FROM_PRECACHE_NO_DATA
```

- First visit: 37 responses from the service worker, 42 from the network. A controlled reload: 76 from the service worker, **1** from the network (`/default-feed-icon.png`, which no rule covers).
- A deep link (`/all/entry/1000`) is answered by `NavigationRoute` with the precached `index.html` (`documentServedBySW=true`).
- Offline (`context.setOffline`): the document is served by the service worker with HTTP 200 and the shell boots, then the Miniflux compatibility gate shows "Version check failed … Retry / Logout". There is no offline-specific state and no cached user content (consistent with the PWA-03B premise).
- Chromium logged `No HydrateFallback element provided to render during initial hydration` on every load (§11, `I9`).

## 6. Phase D — update and reload behavior

**Question.** Can a service worker update interrupt a reading session in progress?

### 6.1 Result

```text
MID_READING_UPDATE_DISRUPTION=CONFIRMED
PWA_03A_PRIORITY_RECOMMENDATION=YES
```

Classification scope: the **mechanism** and the **consequence** are `LOCAL_EXPERIMENT`-confirmed. **Frequency in production is `NOT_MEASURED`.** No `LIVE_OBSERVED` instance exists.

Why this represents the normal update path, and not an exceptional state:

1. The control builds carry the expected revision metadata, proven by the gate in §2.4 (`CONTROL_BUILD_REVISION_METADATA_GATE=PASS`).
2. A second pair built **without** a commit date, the condition reported for the production build, gives the same outcome in every scenario (§6.2).
3. The reload and update code has no dependency on the revision metadata (§6.8, `REPO_VERIFIED`).

### 6.2 Scenarios (final script; control pair `A → B`, no-date pair `XA → XB`)

| Pair      | Scenario               | Viewport | Trigger                                                     | Reload?        | Trigger → activated | Activated → reload | Route kept | Reader scroll     | Other state lost                         |
| --------- | ---------------------- | -------- | ----------------------------------------------------------- | -------------- | ------------------- | ------------------ | ---------- | ----------------- | ---------------------------------------- |
| `A → B`   | `second-nav`           | 884×1104 | A second page navigates to the origin (new tab, relaunch)   | **Yes**        | 4370 ms             | 29 ms              | Yes        | 2400 px → **0**   | JS marker                                |
| `A → B`   | `registration-update`  | 884×1104 | `registration.update()` from the reading page               | **Yes**        | 1086 ms             | 20 ms              | Yes        | 2400 px → **0**   | JS marker                                |
| `A → B`   | `registration-update`  | 390×844  | Same                                                        | **Yes**        | 1093 ms             | 20 ms              | Yes        | 2400 px → **0**   | JS marker                                |
| `A → B`   | `dialog-typed-text`    | 884×1104 | `registration.update()` with Add-a-feed open and text typed | **Yes**        | 1108 ms             | 32 ms              | Yes        | –                 | Dialog closed; typed URL **lost**        |
| `A → A`   | `control-no-change`    | 884×1104 | `registration.update()`, **no new build**                   | **No**         | –                   | –                  | Yes        | 2400 px → 2400 px | None; only worker version 0 ever existed |
| `A → B`   | `lazy-chunk-from-list` | 884×1104 | None for the worker; open Settings after the deploy         | **Yes, twice** | 5381 ms             | 23 ms              | Yes        | –                 | JS marker                                |
| `XA → XB` | `second-nav`           | 884×1104 | As above, **no commit date**                                | **Yes**        | 4158 ms             | 22 ms              | Yes        | 2400 px → **0**   | JS marker                                |
| `XA → XB` | `registration-update`  | 884×1104 | As above, **no commit date**                                | **Yes**        | 1072 ms             | 22 ms              | Yes        | 2400 px → **0**   | JS marker                                |
| `XA → XA` | `control-no-change`    | 884×1104 | As above, **no commit date**                                | **No**         | –                   | –                  | Yes        | 2400 px → 2400 px | None                                     |
| `XA → XB` | `lazy-chunk-from-list` | 884×1104 | As above, **no commit date**                                | **Yes, twice** | 4370 ms             | 18 ms              | Yes        | –                 | JS marker                                |

The page's running entry script matched the intended build in every row (for example `index-CR7vChQB.js` for `A`, `index-Dbp94Lrn.js` for `B`). The reader scroller was `.simplebar-content-wrapper` at 884 px and `.adaptive-scroll-area-native` at 390 px; both returned to 0. Timings carry no network latency and vary by a few milliseconds between runs; the ordering never varied.

### 6.3 Observed sequence (`second-nav`)

```text
reading session established on build A      scroll 2400, marker set
deploy B (old hashed files gone)
second navigation to the origin             browser starts its own update check
worker v1  installing -> installed
worker v0  redundant
worker v1  activating -> activated          skipWaiting + clientsClaim
page 1     framenavigated (29 ms later)     window.location.reload() from the register code
page 1     now runs build B                 URL unchanged, scroll 0, marker gone
```

No prompt, banner or other user action is involved: the register code calls `window.location.reload()` directly (§3, path 1).

### 6.4 What survives and what does not

| State                                  | After the reload                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| URL and open entry (`/all/entry/1000`) | Preserved; the router restores the entry from the location.                     |
| Reader scroll position                 | **Lost** (2400 → 0) at both viewports.                                          |
| In-memory page state                   | **Lost.**                                                                       |
| Open dialog and its typed text         | **Lost.**                                                                       |
| Mark-All-Read Undo (pending)           | `NOT_MEASURED` directly; in-memory, so it is expected to be lost (`INFERENCE`). |
| `localStorage` (`auth`, `settings`)    | Preserved by design.                                                            |

### 6.5 Second reload path and cache poisoning (`lazy-chunk-from-list`)

With **no** service worker update in progress, after build `B` replaced build `A`:

1. The user opens Settings. The page, still on build `A`, requests `assets/SettingsTabs-<old hash>.js`.
2. Caddy has no such file and answers `index.html`, HTTP 200, `text/html`.
3. Chromium refuses it: _Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"_. `vite:preloadError` fires; **27–43 ms later** the page reloads (path 2).
4. A few seconds later the browser finds build `B`, the worker activates, and the page reloads **again** (path 1).
5. The runtime cache `runtime-build-assets` now holds **two HTML responses stored under `.js` URLs** (`SettingsTabs-…` and `CustomLink-…`), in both build pairs.
6. Before the old file was restored, the cache already held `text/html` for the exact `SettingsTabs` URL. After the file was restored (a direct request that bypasses the worker returned it as `text/javascript`), a `fetch` of the same URL from the page **still returned `text/html`** from the cache.

Workbox `CacheFirst` caches any HTTP 200, and the expiration plugin only evicts by age (30 days) or count (80). The poisoned entries are keyed by old hashes, so a normal sequence never requests them again; the same mechanism applied to a _valid_ hash during a rolling deploy would be harder to recover (`INFERENCE`, not exercised). An earlier version of this probe used a hard-coded chunk name from a discarded build; the figures above come from the corrected probe that reads the name from the build.

### 6.6 Negative control

`control-no-change` runs the same reading session and the same `registration.update()` with the same build, in both pairs: no reload, scroll preserved, no worker other than version 0. The reload is caused by a **new** worker activating.

### 6.7 What is not claimed

- That users meet this often. The browser finds a new worker on navigation to the scope and, when the registration is stale, on functional events (the usual interval is 24 hours; `PLATFORM_KNOWLEDGE`, not measured). `main` received eight merges between 2026-10-21 18:48 and 2026-10-22 11:58 (-03:00), about 17 hours (`REPO_VERIFIED`); merges are not deploys, so deploy cadence is `NOT_MEASURED`.
- Behavior on iOS WebKit or Android Chrome. Not run.
- The runtime effect on Undo. Not measured.
- Anything about the production build's update behavior. Production was not observed; the no-date pair is the controlled stand-in.

### 6.8 Build metadata, the update-check warning and the three mechanisms (`UPDATE_CHECK_BUILD_METADATA_01`)

**Report.** The PM reported (`PM_REPORTED`) that the build of `68b39798` printed that the commit date was unavailable and that update checks were disabled for the build. Status: `NEEDS_DIAGNOSTIC`. Nothing was fixed here.

Three things are distinct, and none was assumed to be the same as another:

| #   | Mechanism                                                                                | What it does                                                                                                                                                                                     | Inputs                                                                                                                           | Depends on the commit date?                                                                                                                                                                                          | Reload or callback                                                                                                     |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | **Service worker lifecycle and update**                                                  | The browser finds a changed `sw.js`; `skipWaiting` and `clientsClaim` activate it; the register code reloads the page on `activated`.                                                            | The bytes of `sw.js`, which derive from the precache manifest (hashed file names and revisions).                                 | **No.** No import path leads from `vite.config.js`, `src/main.jsx` or the worker to `version-info.json` (`REPO_VERIFIED`). Metadata only changes the bytes of a build (see below).                                   | `window.location.reload()` on `activated`; `vite:preloadError` reload.                                                 |
| 2   | **Application revision and update check** (`useVersionCheck`, `AppNotifications`)        | Opt-in. Asks the GitHub compare API whether `main` is ahead of the build commit and, if non-documentation files differ, shows a notification with "Check" (opens the commit list) and "Dismiss". | A commit hash that is not `unknown`; the `checkForUpdates` setting (**default `false`**); server info ready; a production build. | **No.** The hook reads only `gitFullHash` or `gitHash` (`REPO_VERIFIED`). Observed: builds `A` and `XA`, with the setting on, attempted the identical request `GET …/compare/68b39798…...main` (`LOCAL_EXPERIMENT`). | **None.** No reload and no service worker call. Dismissal writes the `localStorage` key `updateNotificationDismissed`. |
| 3   | **Build metadata** (`src/scripts/version-info.js` → git-ignored `src/version-info.json`) | Writes `{gitHash, gitFullHash, gitDate}` at the `prebuild` step.                                                                                                                                 | `SOURCE_COMMIT` (required by the `Dockerfile` default), `.git` when present, `SOURCE_COMMIT_DATE`, `SOURCE_DATE_EPOCH`.          | Produces `gitDate`. Its **only consumer** is the About dialog's "Build date" row, which shows `Unknown` when the date is null (`REPO_VERIFIED`; observed on `XA`).                                                   | n/a                                                                                                                    |

Findings for the report (`REPO_VERIFIED` unless stated):

- **Which mechanism depends on the commit date:** only the About dialog's build-date row (`src/components/About/AboutModal.jsx`), plus the script that normalizes it.
- **Which feature was disabled:** none by the date **today**. The sentence _"Commit date unavailable; update checks will be disabled for this build."_ is printed by `version-info.js`, but no code path disables the update check when the date is null. The check **was** date-gated in the past, and the sentence was true then: commit `f75cd681` (2026-08-31) added `!buildInfo.gitDate` to the guard of `useVersionCheck` and added the sentence to `version-info.js`. Commit `07989972` (2026-10-15, "ignore documentation-only NewsFlux updates") rewrote the hook to compare by commit hash through the GitHub compare API and removed both the date guard and the date comparison, but **left the sentence behind**. The sentence has been stale since 2026-10-15 (`REPO_VERIFIED` from the commit history, read after unshallowing the checkout).
- **Service worker update affected:** no. The reload path was exercised on builds without a date with the same result (§6.2), and a metadata-only difference (`A` versus `XA`: same source, different date) produces a different entry chunk hash and a different `sw.js` (`LOCAL_EXPERIMENT`); the cascade from the embedded value through the chunk graph into the precache manifest is an `INFERENCE`. The worker itself reads no metadata.
- **Only polling or version comparison affected:** neither is affected by the date. The comparison is hash-based and opt-in; its only observable difference without a date is the About row.
- **Callbacks or reloads that depend on this mechanism:** none.
- **How the date goes missing:** the Docker build context excludes `.git` (`.dockerignore`), so unless `SOURCE_COMMIT_DATE` is passed as a build argument the date is `null`. The CI deploy workflow passes it (`git show -s --format=%cI`); a local build that omits it prints the warning. Build `XA` reproduces the production warning exactly (`LOCAL_EXPERIMENT`). That the production image was built without the argument is an `INFERENCE`: the production build command is `NOT_MEASURED`.
- **Side effect worth noting:** because a commit hash is embedded in a chunk, every new commit produces a new `sw.js`, including documentation-only commits (`INFERENCE` from the `A` versus `XA` result; not run on a documentation-only diff). Each deploy of a new commit therefore triggers the update path of §6.

```text
UPDATE_CHECK_BUILD_METADATA_01=NEEDS_DIAGNOSTIC
UPDATE_CHECK_DEPENDS_ON_COMMIT_DATE=NO
SERVICE_WORKER_UPDATE_AFFECTED=NO
APP_REVISION_CHECK_AFFECTED=NO            # the check logic; the About "Build date" row shows Unknown
CONTROL_BUILD_SOURCE_COMMIT=68b39798fa6d823b2e5b1286aa42d4309c21c2ca      # build A (B uses a synthetic successor commit)
CONTROL_BUILD_SOURCE_COMMIT_DATE=2026-10-22T11:58:06-03:00                 # stored as 2026-10-22T14:58:06.000Z
BUILD_REVISION_METADATA_GATE=PASS
UPDATE_CHECK_FEATURE_ENABLED=YES          # in code and in builds A and XA when the user setting is on; the setting defaults to off
PRODUCTION_UPDATE_CHECK_STATE=COMMIT_DATE_NULL (PM_REPORTED); CHECK_NOT_DATE_GATED (REPO_VERIFIED); USER_SETTING_NOT_MEASURED
```

Routing, not implemented: passing `SOURCE_COMMIT_DATE` in the production build and aligning the warning text belong to a separate decision outside PWA-00.

## 7. Phase E — manifest and installability (`LOCAL_EXPERIMENT`, Chromium 141)

Revalidated on `68b39798`: the manifest is byte-equivalent in content and the figures are unchanged.

```text
MANIFEST_FETCH=PASS                 # parsed with errors=[] even though local Caddy sends no Content-Type (I3)
MANIFEST_VALID=PASS
START_URL_VALID=PASS                # "/" inside scope "/", same origin
SCOPE_VALID=PASS
ICON_BASELINE=favicon.ico (declared 64x64 32x32 24x24 16x16, decoded 64x64), logo192.png (192x192), logo512.png (512x512); no purpose on any icon
MASKABLE_ICON=NO
THEME_COLOR_CONSISTENCY=MISMATCH    # manifest vs runtime; the runtime metas and the page background agree with each other
BROWSER_INSTALLABILITY_DIAGNOSTIC=ONLY "in-incognito" (environmental: a fresh Playwright context); no other installability error
```

| Source                                                            | Light                | Dark / OLED       |
| ----------------------------------------------------------------- | -------------------- | ----------------- |
| Manifest `theme_color`                                            | `#1F2327`            | `#1F2327`         |
| Manifest `background_color`                                       | `#ffffff`            | `#ffffff`         |
| Runtime `meta[name=theme-color]` (rewritten by the app per theme) | `#f2f3f5`            | `#0b0d10`         |
| Computed `body` / `#root` / `html` background                     | `rgb(242, 243, 245)` | `rgb(11, 13, 16)` |
| `apple-mobile-web-app-status-bar-style`                           | `default`            | `black`           |

Both runtime `theme-color` entries (the light and the dark `media` variants) are rewritten to the same value by the app, so the page follows the app theme. The manifest values match neither. Consequences on a device (a white launch splash on the OLED theme; the title-bar tint) are `PLATFORM_KNOWLEDGE` and were not observed. The manifest has no `id`; Chromium derives the app identity `http://127.0.0.1:2000/` from `start_url`.

## 8. Phase F — topology and Miniflux origin

```text
NEWSFLUX_ORIGIN=https://news.jfsdias.ddns.net   # PM_REPORTED; not reached
MINIFLUX_ORIGIN=NOT_MEASURED                     # the configured value lives in each user's localStorage; no real session was accessible
ORIGIN_RELATION=NOT_MEASURED
CORS_BASELINE=APP_SIDE_CONTRACT_ONLY
PWA_TOPOLOGY_MEASURED=PARTIAL
```

App-side contract (what the application requires of any Miniflux origin; observed on the `326f9be1` build, not rerun because the API client and login code are not in the PR #87 diff):

- The server value is a user-supplied absolute URL (`isURL` with a required protocol, `REPO_VERIFIED`), used as `baseURL`.
- Every API call carries `X-Auth-Token` or `Authorization: Basic` (`LOCAL_EXPERIMENT`, both modes observed). A custom header makes a cross-origin call a preflighted request, and preflights were observed.
- With a **cross-origin Miniflux that sends no CORS headers**, the app stops at the "Version check failed" gate (`LOCAL_EXPERIMENT` control).
- Consequence: because production works, the production Miniflux is either same-origin with the page that loads the app or CORS-enabled for `X-Auth-Token`/`Authorization`. **Which one is `NOT_MEASURED`.** The PWA architecture must keep treating it as potentially cross-origin (D4 stays partially resolved).

## 9. Phase G — storage and privacy observation (`LOCAL_EXPERIMENT`)

Names and shapes only; no value was printed. Revalidated on `68b39798`.

| Store                                                                   | Observed                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage`                                                          | Two keys: `auth` and `settings`. `updateNotificationDismissed` is written only when the update notification is dismissed (`REPO_VERIFIED`). |
| `localStorage.auth` after a username/password login through the real UI | Keys `server`, `username`, `password`; `password` is **present and non-empty** (plaintext). A token login stores the token instead.         |
| `sessionStorage`                                                        | Empty after login. `reactflux:preload-error-reload` is written only by the preload-error path (`REPO_VERIFIED`).                            |
| Cookies                                                                 | None.                                                                                                                                       |
| IndexedDB                                                               | `workbox-expiration` only.                                                                                                                  |
| Cache Storage                                                           | `workbox-precache-v2-<origin>/` and `runtime-build-assets`; **no** API response (§5).                                                       |
| `navigator.storage.persisted()`                                         | `false`. The usage and quota figures describe the sandbox and are not recorded.                                                             |

- **Icon fallback** (`F8`, observed on the `326f9be1` build; `FeedIcon` is not in the PR #87 diff): for a feed whose `icon_id` is 0 and whose site is `https://www.bbc.co.uk/news`, the app requested `GET https://icons.duckduckgo.com/ip3/co.uk.ico`. The destination was blocked in the browser, so nothing was sent. This confirms both a third-party request that carries a followed site's hostname and the `getSecondHostname` defect (`co.uk` instead of `bbc.co.uk`).
- State is per browser profile; the separate storage container of an installed iOS web app is `PLATFORM_KNOWLEDGE` and not run (`F9`).
- The historical finding of a plaintext password in `localStorage` stays a **pre-existing** finding; it was observed, not changed.

## 10. Findings decision matrix

Identifiers are the real ones from [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) §4; none was renumbered. The left column maps the labels requested for this task.

| Requested label                    | Real ID | Finding                                                         | PWA-00 status         | Basis                                                                                                                     |
| ---------------------------------- | ------- | --------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| –                                  | F1      | PWA exists in `main`                                            | `CONFIRMED`           | `REPO_VERIFIED`, `LOCAL_EXPERIMENT`                                                                                       |
| `PWA_F2_THEME_MISMATCH`            | F2      | Manifest colors disagree with runtime palette                   | `CONFIRMED`           | Values observed (§7). Device effect is `PLATFORM_KNOWLEDGE`.                                                              |
| `PWA_F3_MASKABLE_ICON`             | F3      | No maskable icon; touch icon is 192 px                          | `CONFIRMED`           | No `purpose` on any icon (§7). Device masking is `PLATFORM_KNOWLEDGE`.                                                    |
| `PWA_F4_UPDATE_RELOAD_RISK`        | F4      | Update can reload mid-reading                                   | `CONFIRMED`           | §6, `LOCAL_EXPERIMENT` on metadata-verified builds and on no-date builds; production frequency `NOT_MEASURED`.            |
| `PWA_F5_SPA_FALLBACK`              | F5      | Missing asset answered with HTML 200                            | `PARTIALLY_CONFIRMED` | Internal Caddy confirmed, with the browser consequence (§6.5). Through NPM `NOT_MEASURED`.                                |
| `PWA_F7_SW_MANIFEST_HEADERS`       | F5      | No explicit `Cache-Control` for `sw.js`, manifest, `index.html` | `PARTIALLY_CONFIRMED` | Absent on internal Caddy (§4.2). Public/NPM `NOT_MEASURED`. F5 holds both halves; the requested label has no separate ID. |
| `PWA_F6_ORIGIN_TOPOLOGY`           | F6      | Shared-origin and Miniflux topology                             | `NOT_MEASURED`        | App-side contract only (§8). Live origin and NPM not reachable.                                                           |
| `PWA_F8_LOCALSTORAGE_AUTH_FINDING` | F7      | Plaintext `password` in `localStorage`                          | `CONFIRMED`           | Observed after a normal login (§9). Pre-existing; not fixed.                                                              |
| `PWA_F9_ICON_HOSTNAME_PRIVACY`     | F8      | DuckDuckGo fallback discloses hostnames; bad hostname           | `CONFIRMED`           | Requested URL observed (§9).                                                                                              |
| –                                  | F9      | State is per browser profile                                    | `PARTIALLY_CONFIRMED` | Only `localStorage` and caches observed; the iOS container split is `PLATFORM_KNOWLEDGE`.                                 |

```text
PWA_F2=CONFIRMED
PWA_F3=CONFIRMED
PWA_F4=CONFIRMED
PWA_F5=PARTIALLY_CONFIRMED
PWA_F6=NOT_MEASURED
PWA_F7=CONFIRMED
PWA_F8=CONFIRMED
PWA_F9=PARTIALLY_CONFIRMED
```

### PWA-00 gate map (`PWA_ARCHITECTURE.md` §7 and §9)

| Gate                                                                                       | Result                                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `PWA_MANIFEST_VALID`                                                                       | `PASS` (local). Content type on the public origin `NOT_MEASURED`.                                                     |
| `PWA_INSTALL_ANDROID` / `_IOS` / `_IPADOS`, `PWA_STANDALONE_LAUNCH`, `PWA_SPLASH_NO_FLASH` | `NOT_RUN` (no device).                                                                                                |
| `PWA_SW_SCOPE`                                                                             | `PASS` (local): scope `/`, equal to the manifest scope.                                                               |
| `PWA_SW_UPDATE_LATENCY`                                                                    | Recorded locally: about 1.1 s from an explicit update to the new worker controlling. Production `NOT_MEASURED`.       |
| `PWA_SW_NO_MIDSESSION_RELOAD`                                                              | **`FAIL`** (local): the page reloads on activation.                                                                   |
| `PWA_STALE_ASSET_RECOVERY`                                                                 | Recorded: recovers, but through two reloads and with HTML cached under a `.js` URL.                                   |
| `PWA_NO_AUTH_CACHE`                                                                        | `PASS` (local): no API response in Cache Storage.                                                                     |
| `PWA_AUTH_PERSISTENCE`                                                                     | Recorded: plaintext password persisted in `localStorage`; standalone behavior `NOT_RUN`.                              |
| `PWA_SERVING_HEADERS`                                                                      | Internal Caddy recorded and not compliant (no revalidation headers; missing asset is not 404). Public `NOT_MEASURED`. |
| `PWA_TOPOLOGY_MEASURED`                                                                    | `PARTIAL`.                                                                                                            |
| Baseline performance numbers                                                               | `NOT_MEASURED` (no device; local timings carry no network or CPU constraints).                                        |

## 11. Incidental findings

Reported and **not fixed**. None touches Home or list behavior; **no Home/list functional problem was observed**, so nothing was sent to the `HOME_CURSOR_TIE_DRAIN_V1` lane.

| ID  | Finding                                                                                                                                                                                                                                                                                                                | Severity   | Routing                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| I1  | `runtime-build-assets` admits HTML responses under `.js` and `.css` URLs and keeps them for 30 days; a poisoned entry shadows the real file after it returns (§6.5, `LOCAL_EXPERIMENT`).                                                                                                                               | Medium     | Scope input for PWA-03A; the 404 half belongs to PWA-01C.                   |
| I2  | Two independent reload paths can fire back to back (preload error, then worker activation), seconds apart.                                                                                                                                                                                                             | Medium     | PWA-03A.                                                                    |
| I3  | `manifest.webmanifest` had **no `Content-Type`** from local Caddy because this host's MIME database has no `.webmanifest` entry; Chromium parsed it anyway. The production image and NPM value are `NOT_MEASURED`.                                                                                                     | Low        | Verify with the §4.4 runbook; PWA-01C.                                      |
| I4  | The login page reads `server`, `token`, `username` and `password` from the query string and **submits automatically** (`src/pages/Login.jsx`, `REPO_VERIFIED`). A URL carrying a password can reach browser history and proxy access logs. Pre-existing upstream behavior.                                             | Low–Medium | Backlog with F7 and D8; do not fix incidentally.                            |
| I5  | Offline, the shell boots and shows "Version check failed … Retry / Logout"; there is no offline-specific state.                                                                                                                                                                                                        | Info       | PWA-03B.                                                                    |
| I6  | `default-feed-icon.png` is neither precached nor runtime-cached; it was the only network request of a controlled reload.                                                                                                                                                                                               | Info       | PWA-03B / PWA-01C.                                                          |
| I7  | Internal Caddy does not compress (`encode` absent). Compression at NPM is `NOT_MEASURED`.                                                                                                                                                                                                                              | Low        | PWA-01C; measure with §4.4.                                                 |
| I8  | `UPDATE_CHECK_BUILD_METADATA_01`: the build prints that update checks are disabled when the commit date is missing, but no code gates the update check on the date any more; the sentence is stale since `07989972` (2026-10-15) (§6.8). The production build reportedly lacks the date, so About shows `Unknown`.     | Low        | `NEEDS_DIAGNOSTIC` (`PM_REPORTED`); separate decision; not fixed in PWA-00. |
| I9  | `REACT_HYDRATION_WARNING`: Chromium logs `No HydrateFallback element provided to render during initial hydration` on every load of builds `A` and `XA` (`LOCAL_EXPERIMENT`). The PM reported a React hydration warning in production; that they are the same warning is an `INFERENCE`. It invalidated no measurement. | Info       | `HOLD` / `NEEDS_DIAGNOSTIC`; not fixed in PWA-00.                           |

## 12. Not measured and inconclusive register

| Item                                                                      | Status               | Smallest step that closes it                                                                 |
| ------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| Public origin headers, redirects, NPM behavior, compression, `Age`/CDN    | `NOT_MEASURED`       | Run §4.4 from a host that can reach the origin (minutes; read-only).                         |
| Production runtime `newsflux-local:68b39798fa6d`: its own update behavior | `NOT_MEASURED`       | Open the public origin in a fresh Chrome profile and read Application → Service Workers.     |
| Whether production users have `checkForUpdates` on                        | `NOT_MEASURED`       | Read the `settings` key of one real session (name and one boolean only).                     |
| Real Miniflux origin and its CORS behavior                                | `NOT_MEASURED`       | Read the configured server from one real session's `localStorage` (names only) and probe it. |
| How often production users meet the reload                                | `NOT_MEASURED`       | Device runs in PWA-VAL-01 plus the real deploy cadence.                                      |
| iOS and iPadOS standalone behavior (update, storage container, splash)    | `NOT_RUN`            | One iPhone and one iPad, two real builds.                                                    |
| Android standalone behavior                                               | `NOT_RUN`            | One Android phone, two real builds.                                                          |
| WebKit and Gecko engines                                                  | `NOT_MEASURED`       | Not available here.                                                                          |
| Effect of the reload on a pending Mark-All-Read Undo                      | `NOT_MEASURED`       | Extend the experiment (needs a Mark-All action in the harness).                              |
| Whether a documentation-only commit also changes `sw.js`                  | `INFERENCE`          | Build two commits that differ only in `docs/` and compare `sw.js`.                           |
| The 24-hour stale-registration update trigger                             | `PLATFORM_KNOWLEDGE` | A device left open across a deploy for over 24 hours.                                        |
| Performance baselines (§9.2 of `PWA_ARCHITECTURE.md`)                     | `NOT_MEASURED`       | Device runs.                                                                                 |

The update question is not `INCONCLUSIVE`: it is answered by §6, on metadata-verified builds and on no-date builds. The items above are `NOT_MEASURED` or `NOT_RUN` because the evidence cannot exist in this environment.

## 13. Sequencing recommendation (recommendation only)

```text
MID_READING_UPDATE_DISRUPTION=CONFIRMED
PWA_03A_PRIORITY_RECOMMENDATION=YES
NEXT_RECOMMENDED=PWA-03A
PWA_01A_AUTHORIZED=NO
IMPLEMENTATION_AUTHORIZED=NO
```

Under the PM rule recorded in [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) §8 (correctness before cosmetic installability hardening), the measured, reproducible loss of reading state recommends `PWA-03A` ahead of `PWA-01A` and `PWA-01B`. **Authorization remains a PM decision.** `PWA-01A` is unchanged: not authorized.

Inputs this measurement gives `PWA-03A` (facts, not a design):

1. The reload is bound to `activated` in the generated register code (§3); changing that is a decision (D6: prompt, or defer to a safe moment).
2. A second reload path (preload error) exists and interacts with the first (I2); recovery must consider both.
3. The runtime cache accepts HTML for script and style URLs (I1); the candidate fix location is the Workbox configuration in `vite.config.js`.
4. A real `404` for a missing `/assets/*` file is a `Caddyfile` change and belongs to `PWA-01C` (gated by `ID-DEPLOY-01`).
5. The scenario table in §6.2 is the regression that `PWA-03A` must turn green: with build `A` → build `B`, a reading session must survive (`PWA_SW_NO_MIDSESSION_RELOAD`). A committed harness will be needed then; none is committed here.
6. Controlled update tests must build with explicit revision metadata (§2.4) and must not rely on a stale `src/version-info.json`.
7. Update behavior does not depend on the commit date (§6.8); the build-metadata anomaly is independent work.

In parallel, and without code: run the §4.4 runbook against the public origin and schedule the device gates (`PWA-VAL-01`). They close `PWA_SERVING_HEADERS` and `PWA_TOPOLOGY_MEASURED` and could change `PWA-01C` and `PWA-01B` scoping, not the `PWA-03A` recommendation.

## 14. Evidence inventory (not committed)

Scripts and outputs live in the session scratchpad; nothing is part of the diff.

| Artifact                    | Purpose                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builds `A`, `B`, `XA`, `XB` | `git archive` of `68b39798`, the prebuild step run explicitly with the metadata of §2.4, then `vite build`. `B` and `XB` add `globalThis.__PWA00_BUILD__ = "B"` at the top of `src/main.jsx`. A metadata gate checks the generated JSON and searches each bundle for the commit and the date.     |
| Discarded first-pass builds | Built from the working tree with `vite build` only; they bundled a stale `src/version-info.json`. Kept only to document the correction in §2.4.                                                                                                                                                   |
| Caddy 2.11.7 + `Caddyfile`  | The repository file with only the `root` line changed; serves a symlink that a "deploy" swaps atomically.                                                                                                                                                                                         |
| Synthetic Miniflux          | A small Node server: `/v1/version`, `/v1/me`, `/v1/feeds`, `/v1/categories`, `/v1/feeds/counters`, `/v1/entries`, `/v1/entries/:id`, `/v1/icons/:id`, `/v1/integrations/status`; CORS reflects the request origin; logs method, path and status only. Variants: no CORS; a feed with `icon_id` 0. |
| HTTP contract script        | Discovers artifact names from the served HTML and records headers for the ten URL classes plus conditional requests.                                                                                                                                                                              |
| Runtime and update scripts  | Chromium via Playwright with a CDP session recording `ServiceWorker.*` events, navigations and console errors; the scenarios of §6.2; manifest and storage observation; the update-check probe of §6.8, which blocks the GitHub host so that nothing leaves the sandbox.                          |

No secret, token, password value, cookie value or `Authorization` header appears in this document or in the saved outputs; credentials used were synthetic.
