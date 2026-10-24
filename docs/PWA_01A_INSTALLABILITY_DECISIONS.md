# PWA-01A — Cross-Platform Installability & Provisional Decision Package

**Status:** Draft Implementation + Decision Package (`PWA_01A_INSTALLABILITY`)
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

## 2. Provisional Product Decisions (`D1`, `D2`, `D3`)

The following three areas are implemented as **reversible `PROVISIONAL` candidates** with zero persistent-state impact, awaiting explicit PM sign-off before merge:

### Decision D1 — Manifest `id` Policy

| Option                                         | Specification                                              | Trade-offs                                                                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1-A (Recommended & Provisional Candidate)** | `id: basePath` (`"/"` at root, `"/newsflux/"` at sub-path) | Matches `start_url` and `scope` identically per W3C Manifest Identity rules; supports multiple side-by-side origin deployments at distinct base paths without identity collision. |
| **D1-B**                                       | `id: `${basePath}?standalone=1``                           | Distinguishes installed PWA identity from bare root URL, but diverges from the previously installed default identity (`start_url`) on existing installations.                     |
| **D1-C**                                       | Fixed `id: "/"` regardless of `VITE_BASE_PATH`             | Violates same-scope alignment when deployed under a sub-path such as `/newsflux/`.                                                                                                |

### Decision D2 — Manifest `theme_color` & `background_color` (Standalone Launch Splash)

| Option                                         | Specification                                                           | Trade-offs                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D2-A (Recommended & Provisional Candidate)** | `theme_color: "#0B0D10"`, `background_color: "#0B0D10"`                 | Matches NewsFlux's signature OLED-dark surface token (`#0B0D10` in `index.html` dark `theme-color` and `src/index.css`) and eliminates the blinding `#ffffff` white splash flash when launching in dark mode on Android/ChromeOS. |
| **D2-B**                                       | `theme_color: "#F2F3F5"`, `background_color: "#F2F3F5"`                 | Matches the light-theme shell background (`#F2F3F5`), but causes a bright splash flash for dark/OLED users before `useTheme` hydrates.                                                                                            |
| **D2-C**                                       | Preserve legacy `theme_color: "#1F2327"`, `background_color: "#ffffff"` | `#1F2327` and `#ffffff` do not match either runtime theme (`#0B0D10` dark or `#F2F3F5` light), causing a visible color jump on every standalone launch.                                                                           |

### Decision D3 — Maskable Icon Artwork & Safe-Zone Padding

- **Measured Geometry of Existing `public/logo512.png` (`512×512`):**
  - Background: solid `#212122` (`rgb(33, 33, 34)`).
  - Foreground glyph (`#F1F2F3` folded RSS/page mark): bounding box `X: 123..388` (`24.0%` horizontal margins), `Y: 94..426` (`18.4%` top, `16.6%` bottom), maximum radial distance from center = `200.31px` (`39.12%` of width — only `4.5px` inside the W3C `40.0%` safe-zone circle radius `204.80px`).
- **Provisional Mechanical Derivation (`public/maskable-icon-192.png`, `public/maskable-icon-512.png`):**
  - Scales the existing glyph by `0.86` centered on the exact `#212122` background canvas, reducing the maximum foreground radial distance to `33.6%` of icon width (providing a `> 6.4%` buffer inside the W3C `40%` safe-zone circle across Android circle, squircle, and teardrop masks) without inventing a new brand identity.

| Option                                         | Specification                                                                                                                                                                         | Trade-offs                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D3-A (Recommended & Provisional Candidate)** | Separate `maskable-icon-192.png` (`5.1 KiB`) and `maskable-icon-512.png` (`29.0 KiB`) with `purpose: "maskable"`, mechanically padded (`0.86` scale) from `logo512.png` on `#212122`. | Zero brand invention; `33.6%` max foreground radius passes W3C 40% safe-zone geometry with generous margin; keeps `logo192.png` and `logo512.png` untouched as `purpose: "any"`. |
| **D3-B**                                       | Commission new bespoke vector brand artwork (`logo.svg`) and regenerate all icons.                                                                                                    | Requires explicit PM/design brand artwork sign-off (`HOLD_PRODUCT_DECISION` for new brand mark).                                                                                 |
| **D3-C**                                       | Declare only `purpose: "any"` icons and omit `purpose: "maskable"` until new artwork is designed.                                                                                     | Android launchers place the square icon inside a white circle plate ("white-plate fallback") instead of a full-bleed adaptive icon.                                              |
