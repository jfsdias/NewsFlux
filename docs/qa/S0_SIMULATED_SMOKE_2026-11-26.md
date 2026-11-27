# Sprint 0 simulated device smoke (2026-11-26)

- **Status:** simulated (browser emulation). Not physical-device evidence.
- **Checkpoint:** Sprint 0 (NF-E00) closed with simulated smoke by owner instruction on 2026-11-26. Physical-device smoke remains an EVIDENCE_GAP backlog item (NF-0005).
- **Baseline:** `main` `664e404197e1eb9d9aeb52f921690a95b6559190` (PR #321).
- **Candidate:** branch `qd/integration`, gates run on `fa56a12b`; the harness was added in the harness-only commit `b2633a99`.
- **Harness:** `tests/aux/device-matrix/` (method and run instructions in its [README](../../tests/aux/device-matrix/README.md)).

## Method

The harness drives the production build against the synthetic Miniflux mock, the same servers the canonical E2E uses. It runs each device profile in Dark and Light color schemes. Playwright 1.63 WebKit runs the iPhone profiles and Chromium runs the Galaxy profiles.

Checks per run:

- Login to Home time, and the Home, Reader and All screens.
- No horizontal overflow.
- No page or console errors. The mock's deliberately broken image and aborted superseded requests are expected.
- Headlines fully visible on the first Home screen.
- Whether Home tools appear before Highlights.
- Small touch targets in the first screen.
- Service-worker registration.

Results are written to `results.json`, with screenshots.

## Matrix

| Device                 | Engine   | CSS viewport | DPR | Viewport source                           |
| ---------------------- | -------- | ------------ | --- | ----------------------------------------- |
| iPhone Duo closed      | WebKit   | 466 × 678    | 3   | Derived from published panel, DPR assumed |
| iPhone Duo open        | WebKit   | 626 × 890    | 3   | Derived from published panel, DPR assumed |
| Galaxy Z Fold 8 closed | Chromium | 416 × 657    | 3   | Derived from published panel, DPR assumed |
| Galaxy Z Fold 8 open   | Chromium | 924 × 1224   | 2   | Derived from published panel, DPR assumed |
| Reference phone        | WebKit   | 390 × 844    | 3   | Project reference size                    |
| Reference foldable     | Chromium | 884 × 1104   | 2   | Project reference size                    |

The iPhone Duo and Z Fold 8 viewports are derived from published panel sizes with an assumed device pixel ratio. They must be replaced by measured `innerWidth`, `innerHeight` and `devicePixelRatio` on hardware.

## Results

### Run outcome (pass count per run)

| Build              | Run               | Result | Notes                                                        |
| ------------------ | ----------------- | ------ | ------------------------------------------------------------ |
| Baseline `664e404` | 1                 | 11/12  | Intermittent WebKit page error on iPhone Duo (see Stability) |
| Baseline `664e404` | 2                 | 12/12  |                                                              |
| Candidate          | 1                 | 12/12  |                                                              |
| Candidate          | 2                 | 11/12  | Same intermittent WebKit page error on iPhone Duo            |
| Candidate          | 3 (final harness) | 12/12  |                                                              |

### Headlines fully visible on the first Home screen

Baseline → candidate. Dark and Light are averaged where they are equal.

| Profile                | Viewport   | Baseline | Candidate |
| ---------------------- | ---------- | -------- | --------- |
| iPhone Duo closed      | 466 × 678  | 0        | 2         |
| iPhone Duo open        | 626 × 890  | 2        | 3         |
| Galaxy Z Fold 8 closed | 416 × 657  | 0        | 2         |
| Galaxy Z Fold 8 open   | 924 × 1224 | 8–9      | 9         |
| Reference phone        | 390 × 844  | 1        | 2         |
| Reference foldable     | 884 × 1104 | 6        | 8         |

### Home tools before Highlights

- Baseline: true in every profile.
- Candidate: false in every profile.

### Overflow and errors

- No horizontal overflow on Home, Reader or All in any profile, in either build.

## Stability

The only failures, in both baseline and candidate, are an intermittent WebKit page error on the iPhone Duo profiles: `… due to access control checks.`. It involved either same-origin assets or the cross-origin mock request. It was never reproduced twice in a row.

**Hypothesis H-S0-1 (to verify):** the error comes from WebKit's access-control handling of a cross-origin or same-origin request in the emulated environment. It is not a product defect in the evidence so far. Verify in real iOS Safari with Web Inspector.

## Hypotheses

- **H-S0-1 (above):** intermittent WebKit access-control page error on iPhone Duo profiles. Verify on real Safari.
- **H-S0-2:** in WebKit emulation, the compact bottom navigation shows the content beneath it without blur. The CSS already declares `-webkit-backdrop-filter` and a 54% fill. Headless WebKit probably does not composite the blur. Reduced-transparency mode already switches to an opaque fill. Verify on a real iPhone.
- **H-S0-3:** the headline gain on the iPhone Duo and Z Fold 8 profiles depends on the derived viewports. Confidence is low until measured on hardware.

## Limitations

- Emulation only. No physical device was used.
- Playwright WebKit approximates Safari; it is not iOS Safari.
- The iPhone Duo and Galaxy Z Fold 8 viewports are derived from published panel sizes with assumed pixel ratios.
- The iOS Simulator runtime is unavailable on the host, so no simulator run was made.
- Synthetic data only ("News N" entries, flat placeholder images). Real images, real error and empty states, and real Fetch Content on live sites were not measured.
- Installed-PWA behavior, Service Worker update flow on iOS, and light/OLED themes on a real device were not measured.

## Sprint 0 dispositions

| Item                          | Disposition                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-0001 Summary review        | COMPLETED. Code-level consent, cost and cache criteria verified on `main` by read-only review. Python summary suite 432 tests OK, 4 skipped. Live authorized-model smoke remains gated: EVIDENCE_GAP. |
| NF-0002 Governance / #260     | HOLD_ARCHITECTURE. #260 is parked; the flag baseline is OFF. Reopen only after the read-only key and egress audit and a rebase.                                                                       |
| NF-0003 QA maintenance / #289 | COMPLETED. Retained gates (#289) verified in `quality.yaml`. #293 is superseded by #297.                                                                                                              |
| NF-0004 Source vs runtime     | COMPLETED for source identity. Runtime parity remains OPERATOR_REPORTED; live parity is NOT_VERIFIED.                                                                                                 |
| NF-0005 Reader journey smoke  | COMPLETED with simulated smoke. Physical device (iPhone Safari, installed PWA, Galaxy Fold) is EVIDENCE_GAP in the backlog.                                                                           |
| Checkpoint S0                 | COMPLETED, closed with simulated smoke by owner instruction on 2026-11-26.                                                                                                                            |

Product decision recorded the same day: the interface stays English-only.
