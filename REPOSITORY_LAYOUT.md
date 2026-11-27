# Repository layout

NewsFlux keeps the reader product separate from operations, research and auxiliary QA tooling. A
change should land in exactly one of these areas; if it needs two, split it.

| Area       | Path                                                                                                                                                   | What belongs here                                                                                                                                                                                                                 | Owner / gate                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Product    | `src/`, `public/`, `index.html`, `vite.config.js`, `package.json`, `pnpm-*`, `Dockerfile`, `Caddyfile`, `docker-compose.yml`, lint/format/knip configs | The reader web app and its build.                                                                                                                                                                                                 | Product; `quality.yaml`, `linter.yaml`                                                                                      |
| Product QA | `e2e/`, `playwright.config.js`, `scripts/`                                                                                                             | Canonical Playwright suite (`pnpm test:e2e`) and the build/test/font tooling the product CI uses. `scripts/tests/` holds the browser harness pages served by Vite.                                                                | Product; `quality.yaml`, `e2e.yaml`                                                                                         |
| Services   | `services/`                                                                                                                                            | Product backends (summary API, auth, content fallback, story ranker) with their own tests.                                                                                                                                        | Product; per-service workflows                                                                                              |
| Ops        | `ops/deploy/`, `ops/scripts/`                                                                                                                          | Release governance, rehearsals, preflights, operator and host scripts, compose bundles, image gates.                                                                                                                              | Operators; ops workflows (`summary-release-rehearsal`, `wallhop-isolated`, `npm111-g2c-readonly`, `content-fallback-image`) |
| Research   | `research/`                                                                                                                                            | Studies, pilots and evaluations that are not part of the product build: story identity benchmarks, personalization pilot and LimeSurvey tooling, WallHop reader pilot.                                                            | Research; `pnpm test:research`                                                                                              |
| Aux tests  | `tests/aux/`                                                                                                                                           | Non-canonical Playwright configs and suites: `playwright/` (configs), `reader-ai-e2e/`, `ux-reach-e2e/`, `ux-reach-01/`, `pilot-e2e/`, `synthetic/`. Run with `pnpm exec playwright test --config=tests/aux/playwright/<config>`. | QA; `e2e.yaml` jobs and `ai-*` workflows                                                                                    |
| Archive    | `archive/`                                                                                                                                             | Retired CI definitions kept for local review (`archive/retired-ci`). Never executed by CI.                                                                                                                                        | Nobody; do not extend                                                                                                       |
| Docs       | `docs/`                                                                                                                                                | Roadmap, project state, QA and ops write-ups, research notes. `docs/evidence/` is frozen.                                                                                                                                         | Whoever changes the code it describes                                                                                       |

`.github/workflows/` stays where GitHub requires it. Workflows that gate ops, research or aux paths
name those paths in their `paths:` filters.

## Ownership rules

1. Product code never imports from `ops/`, `research/`, `tests/aux/` or `archive/`. Dependencies
   point inward: ops, research and aux tests may read product code; the reverse is forbidden.
2. `pnpm test` runs `test:src`, `test:scripts`, `test:ops` and `test:research`. Anything that gates a
   product pull request belongs in `scripts/` or `e2e/`, not in `research/`.
3. `playwright.config.js` is the only canonical E2E config and owns the frozen scenario inventory.
   Auxiliary configs under `tests/aux/playwright/` set their own `testDir`, `outputDir` and
   web-server `cwd` from the repository root; they never widen the canonical inventory.
4. Files in `ops/deploy/` are hash-pinned or SHA-bound in places. Paths inside `git show <sha>:...`
   and `git archive <sha>` calls name the layout of that historical revision (`deploy/...`) and must
   not be rewritten.
5. `research/` holds frozen, pre-registered artifacts. Do not reformat or relocate them casually;
   record new studies in a new directory.
6. `archive/` is read-only history. Delete it only by an explicit decision, not as cleanup.
7. Generated output (`test-results/`, `build/`, `__pycache__/`) is never committed.
