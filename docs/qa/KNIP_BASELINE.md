# Knip configuration and accepted baseline

- **Status:** introduced by STABILIZATION-01 (S01-3A) against audited HEAD `1e7e39ce27ca15c0242e98d83e0c5d0ad865a1ba`.
- **Purpose:** separate _missing configuration_ from _genuinely unused code_, and make `knip` usable as a blocking gate without deleting product or Story-02 code.

## What changed

Before this change `pnpm knip` exited 1 with 56 unused files, 38 unused exports and 9 duplicate exports, and there was no configuration file. 54 of the 56 "unused files" were browser harness pages and scripts under `scripts/tests/` that nothing declared as an entry point.

`knip.json` now declares:

- **Entries:** `scripts/tests/**/*.{js,jsx}` (browser harness pages and real-browser gates) and `scripts/*.js` (tooling), in addition to the entries knip detects itself (Vite, ESLint, `node --test`).
- **Ignored:** `scripts/research/**` (Story-01B/02 research tooling, not part of the product bundle).
- **Ignored unresolved:** imports that start with `/src/`, which are browser-served URLs used by `scripts/tests/pwa-chunk-recovery-focus.js`, not Node module paths.

## Result

| Finding type                      | Before | After | Treatment                          |
| --------------------------------- | ------ | ----- | ---------------------------------- |
| Unused files                      | 56     | 0     | blocking; never baselined          |
| Unresolved imports                | 0 (\*) | 0     | blocking; never baselined          |
| Dependencies / unlisted / bins    | 0      | 0     | blocking; never baselined          |
| Unused exports                    | 38     | 34    | accepted baseline, can only shrink |
| Duplicate exports (named+default) | 9      | 10    | accepted baseline, can only shrink |

(\*) The `/src/` unresolved import only appeared after the harness files became entries.

The accepted findings are recorded in [`knip-baseline.json`](../../knip-baseline.json) (44 entries). `pnpm knip:check` (`scripts/check-knip-baseline.js`) fails when:

1. any **blocking** finding appears (unused file, dependency, unlisted dependency, unresolved import, binary...);
2. a **new** unused or duplicate export appears that is not in the baseline;
3. a baseline entry **no longer reproduces** (the baseline must be shrunk in the same change that fixes it).

To accept a reviewed change run `node scripts/check-knip-baseline.js --update`; the command refuses to record a baseline while blocking findings exist.

## Classification of the 44 accepted entries

| Category              | Entries | Notes                                                                                                                                                                                           |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story research / HOLD | 15      | `src/utils/story-identity/*` (default + named export pairs), `storyCandidateState`, `STORY_CANDIDATE_ENDPOINT`, and the Story harness. **Not removed:** the feature is held and off by default. |
| Product API surface   | 29      | Utilities that expose helpers no other module imports today (for example `markCategoryAsRead`, `getUTCDate`, `isDarkMode`, `extractCardDeck`). None were removed in this phase.                 |

Each entry is a **candidate for a later, separately authorized cleanup**, not a defect. Removing an export can break tests that import it, so every removal needs its own change, the suite and the build.

## Known limitation: code used only by harnesses

Because the browser harness files are now entries, knip counts them as users. `src/components/ui/FeedIcon.jsx` is imported only by `scripts/tests/nnw01-p-feed-icon-network.jsx` (a harness that asserts the component does not make network requests), so it no longer appears as unused even though no product file imports it. A production-only analysis (`knip --production` with the product entries) still reports it, together with `src/utils/feed-icon.js`. Treat both as cleanup candidates, but do not delete them without confirming the harness is still wanted.
