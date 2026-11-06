# End-to-end QA suite

Playwright scenarios that exercise the real production build against a **synthetic Miniflux**. They replace the ad hoc QA harness used during STABILIZATION-00 and keep its 37 scenarios (plus the QA-001 viewport matrix and one scenario for QA-004).

- **Evidence type:** emulated (Chromium) and synthetic (mock backend). A pass here is not a physical-device, Safari/WebKit or real-Miniflux verification. See [`QA_CHARTER.md`](./QA_CHARTER.md).
- **Where:** `e2e/*.spec.js`, support code in `e2e/support/`, configuration in `playwright.config.js`.

## Running

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once; CI does this too
pnpm test:e2e                           # builds, then runs one verified scenario set
pnpm test:e2e:run                       # verifies scenarios against the existing build/
pnpm test:e2e:stability                 # three independent verified runs, compared
```

Set `E2E_API_PORT` (default 8081) or `E2E_APP_PORT` (default 4173) if those ports are busy, and `PLAYWRIGHT_BROWSERS_PATH` to use an existing browser install. The scenarios must use the Playwright version pinned in `package.json`, because it is tied to a browser revision.

## How it is built

- **Synthetic Miniflux** (`e2e/support/mock-miniflux.js`): 150 entries, 8 feeds, 4 categories, icons and SVG images, `before_entry_id` pagination, a mutation ledger, and a control API under `/__e2e/` to reset state, inject faults (`500`, `401`, `badjson`, `html200`, `empty`, `missing`, `emptyobject`, `nullcontent`, `dup`, `slow`), switch the whole backend `down` and inject new entries. A missing entry answers 404 as a real Miniflux does.
- **App server** (`e2e/support/start-app-server.js`): serves `build/` like the repository `Caddyfile` (SPA fallback, real 404 for missing assets, no CORS headers). `vite preview` is not used because its `Vary: Origin` header broke the offline PWA scenario.
- **One worker, no retries.** The scenarios share one backend, and retries would hide flakiness. A scenario must end in the same state on every run.

## Known defects and pending requirements are never plain passes

A scenario whose subject is an unapproved requirement is wrapped by `requirementPending(...)` (`e2e/support/classification.js`). The wrapper:

1. runs the scenario asserting the **correct or proposed** behavior;
2. requires it to fail **for the recorded reason** (a message signature), so an unrelated failure is not hidden;
3. records a `REQUIREMENT_PENDING` annotation, which `e2e/reporters/inventory-reporter.js` includes in the scenario inventory;
4. fails the test when the behavior starts to pass, so the marker and the entry in [`FINDINGS_REGISTER.md`](./FINDINGS_REGISTER.md) are removed deliberately.

A green run lists any known-defect or pending-requirement classifications still present in the frozen contract. Contract version 5 keeps the same 46 scenario identities and expects 45 `PASSED`, zero `KNOWN_DEFECT`, and one `REQUIREMENT_PENDING` outcome after the QA-003 emulated closure. Each executed run's evidence is preserved under `test-results/verified-e2e/run-*/inventory.json` with the matching run identifier.

## Stability

Both the single-run CI command and `pnpm test:e2e:stability` use the shared verified executor. Every invocation receives a collision-resistant output directory, a unique run ID, and an explicit reporter output path. It passes only when Playwright exits zero and the exact artifact created for that invocation is valid against the frozen schema and scenario contract. The stability checker additionally requires three distinct verified run IDs and artifact paths. It never falls back to an older inventory file. Do not make a browser gate required before three-run stability passes, and do not mark GitHub checks as required automatically.

## Scenario inventory

| Group                              | IDs                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| F01 Startup                        | F01-1, F01-2, F01-3                                                                                   |
| F02 Feed loading and refresh       | F02-1, F02-2, F02-3                                                                                   |
| F03 Categories and feeds           | F03-1, F03-2                                                                                          |
| F04 Opening and closing an article | F04-1, F04-2, F04-3                                                                                   |
| F05 Full content                   | F05-1                                                                                                 |
| F06 Read and unread                | F06-1, F06-2, F06-3 (QA-002 direct-link read-state)                                                   |
| F07 Search                         | F07-1                                                                                                 |
| F08 Sorting and persistence        | F08-1                                                                                                 |
| F09 Images and fallbacks           | F09-1                                                                                                 |
| F11 Navigation and history         | F11-1                                                                                                 |
| F12 Miniflux failures              | F12-1 to F12-11, F12-10b (QA-003 retained-list recovery)                                              |
| F13 PWA                            | F13-1                                                                                                 |
| F14 Fold and unfold                | F14-1                                                                                                 |
| F15 Deep links and reopening       | F15-1, F15-2, F15-3, F15-4 (QA-004 pending)                                                           |
| F16 Long feed                      | F16-1                                                                                                 |
| QA-001 viewport matrix             | QA-001-466, -597, -704, -884 (also resizes through 768/769/992/993), -939, -1024, -1440, QA-001-mouse |

(The original suite had no F10: persistence is covered by F08-1.)

## Limitations

- Viewports for foldables are **estimates** from the official physical resolutions and assumed device pixel ratios.
- Touch is emulated (`hasTouch`, `isMobile`); there is no hinge, safe-area inset, system bar, virtual keyboard or WebKit.
- The mock implements the endpoints NewsFlux calls; its `before_entry_id` semantics are simplified.
- The real-browser gates under `scripts/tests/` are separate, legacy and not deterministic (QA-005); they are not part of this suite.
