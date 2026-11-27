# Device matrix smoke (simulated)

Browser-emulation smoke for the foldable and phone viewports the project ships to. It drives the
production build against the synthetic Miniflux mock, the same servers the canonical E2E uses.

This is emulation, not physical-device evidence. Playwright WebKit approximates Safari; it is not
iOS Safari, and the foldable viewports below are derived from published panel sizes.

## Run

```bash
pnpm build
node tests/aux/device-matrix/device-matrix.js "$PWD" 4683 8591 test-results/device-matrix
```

Arguments: repository root, app port, mock API port, output directory. The script starts and stops
its own servers. It needs the Chromium and WebKit Playwright browsers
(`pnpm exec playwright install chromium webkit`).

`load-profile.js` (same arguments, without the output directory) prints the JS and CSS bytes fetched
on Login, Home and the first Reader open.

## Matrix

| Device                 | Engine   | CSS viewport | DPR | Source                                    |
| ---------------------- | -------- | ------------ | --- | ----------------------------------------- |
| iPhone Duo closed      | WebKit   | 466 × 678    | 3   | Derived from published panel, DPR assumed |
| iPhone Duo open        | WebKit   | 626 × 890    | 3   | Derived from published panel, DPR assumed |
| Galaxy Z Fold 8 closed | Chromium | 416 × 657    | 3   | Derived from published panel, DPR assumed |
| Galaxy Z Fold 8 open   | Chromium | 924 × 1224   | 2   | Derived from published panel, DPR assumed |
| Reference phone        | WebKit   | 390 × 844    | 3   | Project reference size                    |
| Reference foldable     | Chromium | 884 × 1104   | 2   | Project reference size                    |

Each device runs in Dark and Light color schemes. Measure the real `innerWidth`, `innerHeight` and
`devicePixelRatio` on hardware and update the table when they differ.

## Checks per run

Login to Home time, Home, Reader and All screens, no horizontal overflow, no page or console errors
(the mock's deliberately broken image and aborted superseded requests are expected), headlines fully
visible on the first Home screen, whether Home tools appear before Highlights, small touch targets in
the first screen, and service-worker registration. Results go to `results.json` with screenshots.
