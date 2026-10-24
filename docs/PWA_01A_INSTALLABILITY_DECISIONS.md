# PWA-01A — Cross-Platform Installability & Decision Package

**Status:** Final Decision Package (`PWA_01A_INSTALLABILITY`) — APPROVED
**Scope:** Web App Manifest (`manifest.webmanifest`), iOS/iPadOS standalone metadata (`index.html`), and separated `any` / `maskable` icon assets (`public/`).

---

## 1. Non-Controversial Engineering Fixes (Determined)

1. **Explicit `start_url` and `scope` (`vite.config.js`):**
   - Previously omitted (`undefined` in `manifest.webmanifest`), causing browser heuristics to infer scope from manifest path.
   - Now explicitly set to `basePath` (`"/"` for root builds, `"/newsflux/"` for non-root builds).
2. **Explicit `purpose: "any"` on standard icons (`vite.config.js`):**
   - `favicon.ico`, `logo192.png` (`192×192`), and `logo512.png` (`512×512`) explicitly declare `purpose: "any"`.
   - No icon entry combines `"any maskable"` (which W3C and Lighthouse discourage because full-bleed maskable padding shrinks desktop/iOS icons when used as `any`).
3. **iOS / iPadOS Standalone Metadata & `180×180` Apple Touch Icon (`index.html`, `public/apple-touch-icon.png`):**
   - Added `<meta name="apple-mobile-web-app-title" content="NewsFlux" />` and `<meta name="application-name" content="NewsFlux" />`.
   - Generated `public/apple-touch-icon.png` (`180×180`, `5.8 KiB`) mechanically from `public/logo512.png` and updated `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />` (replacing the non-standard `192×192` reference).

---

## 2. Approved Product Decisions (`D1`, `D2`, `D3`)

The following three areas were validated and finalized by PM approval following real-device verification:

### Decision D1 — Manifest `id` Policy: APPROVED (`id: basePath`)

- **Selected Option:** **D1-A** (`id: basePath` — `"/"` at root, `"/newsflux/"` at sub-path).
- **Rationale:** Matches `start_url` and `scope` identically per W3C Manifest Identity rules; supports multiple side-by-side origin deployments at distinct base paths without identity collision.

| Option   | Specification                                              | Trade-offs                                                                                                                                                                        | Status       |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **D1-A** | `id: basePath` (`"/"` at root, `"/newsflux/"` at sub-path) | Matches `start_url` and `scope` identically per W3C Manifest Identity rules; supports multiple side-by-side origin deployments at distinct base paths without identity collision. | **APPROVED** |
| **D1-B** | `id: `${basePath}?standalone=1``                           | Distinguishes installed PWA identity from bare root URL, but diverges from the previously installed default identity (`start_url`) on existing installations.                     | Rejected     |
| **D1-C** | Fixed `id: "/"` regardless of `VITE_BASE_PATH`             | Violates same-scope alignment when deployed under a sub-path such as `/newsflux/`.                                                                                                | Rejected     |

### Decision D2 — Manifest `theme_color` & `background_color`: APPROVED (`#0B0D10`)

- **Selected Option:** **D2-A** (`theme_color: "#0B0D10"`, `background_color: "#0B0D10"`).
- **Rationale:** Matches NewsFlux's signature OLED-dark surface token (`#0B0D10` in `index.html` dark `theme-color` and `src/index.css`) and eliminates the blinding `#ffffff` white splash flash when launching in dark mode on Android/ChromeOS.

| Option   | Specification                                                           | Trade-offs                                                                                                                                                                                                                        | Status       |
| -------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **D2-A** | `theme_color: "#0B0D10"`, `background_color: "#0B0D10"`                 | Matches NewsFlux's signature OLED-dark surface token (`#0B0D10` in `index.html` dark `theme-color` and `src/index.css`) and eliminates the blinding `#ffffff` white splash flash when launching in dark mode on Android/ChromeOS. | **APPROVED** |
| **D2-B** | `theme_color: "#F2F3F5"`, `background_color: "#F2F3F5"`                 | Matches the light-theme shell background (`#F2F3F5`), but causes a bright splash flash for dark/OLED users before `useTheme` hydrates.                                                                                            | Rejected     |
| **D2-C** | Preserve legacy `theme_color: "#1F2327"`, `background_color: "#ffffff"` | `#1F2327` and `#ffffff` do not match either runtime theme (`#0B0D10` dark or `#F2F3F5` light), causing a visible color jump on every standalone launch.                                                                           | Rejected     |

### Decision D3 — Maskable Icon Artwork & Safe-Zone Padding: APPROVED

- **Measured Geometry of `public/logo512.png` (`512×512`):**
  - Background: solid `#212122` (`rgb(33, 33, 34)`).
  - Foreground glyph (`#F1F2F3` folded RSS/page mark): bounding box `X: 123..388` (`24.0%` horizontal margins), `Y: 94..426` (`18.4%` top, `16.6%` bottom), maximum radial distance from center = `200.31px` (`39.12%` of width — within W3C `40.0%` safe-zone circle radius `204.80px`).
- **Mechanical Derivation (`public/maskable-icon-192.png`, `public/maskable-icon-512.png`):**
  - Scales the existing glyph by `0.86` centered on the exact `#212122` background canvas, reducing the maximum foreground radial distance to `33.6%` of icon width (providing a `> 6.4%` buffer inside the W3C `40%` safe-zone circle across Android adaptive icon masks).
- **Real-Device Gate Result:** **PASS** (tested on Samsung Fold Android launcher; icon appearance verified with no clipping, acceptable centering and apparent size, and no white-plate fallback).

| Option   | Specification                                                                                                                                                                         | Trade-offs                                                                                                                                                                       | Status       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **D3-A** | Separate `maskable-icon-192.png` (`5.1 KiB`) and `maskable-icon-512.png` (`29.0 KiB`) with `purpose: "maskable"`, mechanically padded (`0.86` scale) from `logo512.png` on `#212122`. | Zero brand invention; `33.6%` max foreground radius passes W3C 40% safe-zone geometry with generous margin; keeps `logo192.png` and `logo512.png` untouched as `purpose: "any"`. | **APPROVED** |
| **D3-B** | Commission new bespoke vector brand artwork (`logo.svg`) and regenerate all icons.                                                                                                    | Requires explicit PM/design brand artwork sign-off (`HOLD_PRODUCT_DECISION` for new brand mark).                                                                                 | Not required |
| **D3-C** | Declare only `purpose: "any"` icons and omit `purpose: "maskable"`.                                                                                                                   | Android launchers place the square icon inside a white circle plate ("white-plate fallback") instead of a full-bleed adaptive icon.                                              | Rejected     |

---

## 3. Real-Device Verification Summary

- **Device:** Samsung Galaxy Z Fold (Android Launcher / One UI)
- **Install & Appearance Gate:** **PASS**
  - Installed successfully as standalone PWA.
  - Launcher icon displayed without clipping, centered, with acceptable apparent size and zero white-plate fallback.
- **Standalone Launch Gate:** **PASS**
  - Standalone launch in Samsung Internet: PASS (dark splash `#0B0D10` displayed without white flash, Android navigation bar integrated cleanly).
  - NewsFlux dark canvas color fidelity preserved.

---

## 4. Residual Risks

### A. CHROME_ANDROID_3_BUTTON_NAV_BAR

- **Observation:** When installed via Google Chrome on Android with 3-button navigation enabled, the system navigation bar rendered with a white background on the tested Fold. Samsung Internet did not reproduce this issue.
- **Classification:** Browser/platform-specific implementation residual.
- **Decision:** Does not block PR #114. No brittle browser-specific CSS workarounds are attempted in this PR.

### B. OLED_SYSTEM_BAR_CANVAS_SEAM

- **Observation:** Android system bars use pure black (`#000000`), whereas NewsFlux's approved dark surface token is `#0B0D10`, resulting in a subtle seam between the system navigation bar and the canvas.
- **Classification:** Intentional current design choice / future design backlog.
- **Decision:** Does not block PR #114. The `#0B0D10` palette is preserved consistently across web and PWA manifests.
