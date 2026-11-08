# End-to-end QA suite

Playwright scenarios exercise a production build against a **synthetic Miniflux**. The frozen E2E contract is version 6 and contains 46 stable scenario identities, including the QA-001 viewport matrix and the resolved QA-004 scenario. The inventory validates identities and outcomes; each executed invocation must produce a fresh inventory tied to its run ID.

- **Evidence type:** emulated (Chromium) and synthetic (mock backend). A pass here is not a physical-device, Safari/WebKit or real-Miniflux verification. For PR #193, the owner reported PASS for the harness in four physical conditions: Duo closed/Light, closed/Dark-OLED, open/Light, and open/Dark-OLED. This covers only that harness, not general production Safari, installed-PWA, Service Worker, or application-component validation. See [`QA_CHARTER.md`](./QA_CHARTER.md).
- **Where:** `e2e/*.spec.js`, support code in `e2e/support/`, configuration in `playwright.config.js`.

## Running

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once; CI does this too
pnpm test:e2e                           # build, provenance receipts, then one verified scenario run
pnpm test:e2e:run                       # verify and test the existing build/ (or E2E_BUILD_DIR)
pnpm test:e2e:stability                 # build once, then run and compare three verified invocations
```

Set `E2E_API_PORT` (default 8081) or `E2E_APP_PORT` (default 4173) if those ports are busy, and `PLAYWRIGHT_BROWSERS_PATH` to use an existing browser install. The scenarios must use the Playwright version pinned in `package.json`, because it is tied to a browser revision.

For an isolated build output, use a new directory strictly below `test-results/e2e-builds/`:

```bash
run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
E2E_BUILD_DIR="test-results/e2e-builds/manual-${run_id}" pnpm test:e2e
```

This command builds into that unique directory and runs one verified scenario set against it. To run `pnpm test:e2e:run` separately against the same build, pass the same `E2E_BUILD_DIR` value and retain the build receipt. The allowed destinations are exactly `build/` or a strict descendant of `test-results/e2e-builds/`; path traversal, symlinks, protected repository paths, and external paths are rejected before build commands start. A non-empty target is replaced only when it is verified as a prior E2E build with an intact matching receipt and digest. In particular, an ordinary non-empty `build/` with no valid E2E receipt is not cleared automatically.

## How it is built

- **Source snapshot:** the build wrapper requires a clean committed checkout and records the full source commit SHA and Git tree SHA. It checks the source again when writing the build receipt. The verified runner compares the current checkout with the receipt before Playwright and again after it, so the tested source and built source must remain the same.
- **Build integrity:** every regular file served from the build is included in a stable, path-sorted SHA-256 digest and file count (the receipt itself is excluded). Symlinks and non-regular files make provenance verification fail. Changed, mixed, stale, or missing-receipt builds are rejected before Playwright starts.
- **Receipts and invocation identity:** `build/e2e-build-provenance.json` (or the equivalent file in `E2E_BUILD_DIR`) records source SHA/tree and build digest/count. Each verified invocation gets a unique `RUN_ID`, its own inventory and summary paths, and a server receipt bound to that run ID and the same source SHA/digest/count. The runner verifies the server receipt and rechecks the served build after the test.
- **Runtime versions:** each verified run records Node, pnpm, Playwright, Chromium, and platform versions. Missing version evidence blocks the provenance gate.
- **Fail-closed ordering:** build-directory and clean-source preflights happen before `prebuild`, Vite, or Playwright. Build/source/server/inventory provenance failures do not fall back to an older inventory and prevent a verified pass.
- **Synthetic Miniflux** (`e2e/support/mock-miniflux.js`): 150 entries, 8 feeds, 4 categories, icons and SVG images, `before_entry_id` pagination, a mutation ledger, and a control API under `/__e2e/` to reset state, inject faults (`500`, `401`, `badjson`, `html200`, `empty`, `missing`, `emptyobject`, `nullcontent`, `dup`, `slow`), switch the whole backend `down` and inject new entries. A missing entry answers 404 as a real Miniflux does.
- **App server** (`e2e/support/start-app-server.js`): serves the verified configured build directory (default `build/`) like the repository `Caddyfile` (SPA fallback, real 404 for missing assets, no CORS headers). `vite preview` is not used because its `Vary: Origin` header broke the offline PWA scenario.
- **One worker, no retries.** The scenarios share one backend, and retries would hide flakiness. A scenario must end in the same state on every run.

## Known defects and pending requirements are never plain passes

A scenario whose subject is an unapproved requirement is wrapped by `requirementPending(...)` (`e2e/support/classification.js`). The wrapper:

1. runs the scenario asserting the **correct or proposed** behavior;
2. requires it to fail **for the recorded reason** (a message signature), so an unrelated failure is not hidden;
3. records a `REQUIREMENT_PENDING` annotation, which `e2e/reporters/inventory-reporter.js` includes in the scenario inventory;
4. fails the test when the behavior starts to pass, so the marker and the entry in [`FINDINGS_REGISTER.md`](./FINDINGS_REGISTER.md) are removed deliberately.

A green run lists any known-defect or pending-requirement classifications still present in the frozen contract. Contract version 6 preserves 46 scenario identities and currently expects 46 `PASSED`, zero `KNOWN_DEFECT`, zero `REQUIREMENT_PENDING`, zero `FAILED`, and zero `SKIPPED` outcomes. QA-004/F15-4 was resolved by merged PR #183; it is no longer a pending requirement. Acceptance uses fresh verified inventories from the exact tested head. Each executed run's evidence is preserved under `test-results/verified-e2e/run-*/inventory.json` with the matching run identifier.

## Stability

The GitHub Actions E2E workflow runs `pnpm test:e2e:stability` on pull requests. The stability command builds once, then invokes the shared verified executor three times. Every invocation receives a unique run ID, a separate output directory, and an explicit reporter output path. A run passes only when Playwright exits zero and the fresh artifact from that invocation is valid against the frozen schema and scenario contract. Stability additionally requires three distinct verified run IDs and artifact paths with matching source/build/runtime provenance; it never falls back to an older inventory. Branch-protection requirements are configured separately from this workflow and are not changed by the E2E job.

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
| F15 Deep links and reopening       | F15-1, F15-2, F15-3, F15-4 (QA-004 invalid-response and recovery contract)                            |
| F16 Long feed                      | F16-1                                                                                                 |
| QA-001 viewport matrix             | QA-001-466, -597, -704, -884 (also resizes through 768/769/992/993), -939, -1024, -1440, QA-001-mouse |

(The original suite had no F10: persistence is covered by F08-1.)

## Limitations

- Viewports for foldables are **estimates** from the official physical resolutions and assumed device pixel ratios.
- Touch is emulated (`hasTouch`, `isMobile`); there is no hinge, safe-area inset, system bar, virtual keyboard or WebKit.
- The mock implements the endpoints NewsFlux calls; its `before_entry_id` semantics are simplified.
- The real-browser gates under `scripts/tests/` are separate, legacy and not deterministic (QA-005); they are not part of this suite.
