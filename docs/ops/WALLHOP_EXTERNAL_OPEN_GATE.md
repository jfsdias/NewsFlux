# WallHop path A — explicit external open: dark-ship gate and real-device checklist

Stacked on PR #257 (`6850cf43`), reusing its implementation unchanged: URL safety filter, localized consent,
`noopener,noreferrer`, More-menu entry. This change only makes the action **ship dark** and documents the
gate. `WALLHOP_ACTIVATION=NO_GO`; provider contract HOLD.

## UX contract for the two paths (owner direction W0)

|                        | A. Open in WallHop (this PR lineage)                                     | B. Fetch full article (backend, isolated PR)                                                 |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Where                  | Reader "More" menu, item `open-with-wallhop`                             | inline recovery block in the article body                                                    |
| What happens           | the user's browser opens `https://wallhop.io/<article URL>` in a new tab | the server fetches through the isolated service; sanitized text replaces the teaser in place |
| What leaves            | the article URL, from the user's browser                                 | the publisher URL, from the isolated service via the relay allowlist                         |
| Consent                | per click (`article_card.wallhop_external_consent`)                      | per article (`content.recovery_consent_*`)                                                   |
| Enabled by             | build flag `VITE_WALLHOP_EXTERNAL_OPEN_ENABLED=true` (exactly)           | build flag `VITE_CONTENT_FALLBACK_READER_BASE_PATH` + server policy                          |
| Failure                | nothing happens in NewsFlux; the external page may fail                  | error/unavailable state in the block; the original stays                                     |
| Fallback between paths | **never** automatic                                                      | **never** automatic                                                                          |

## Real-device gate (to run before any promotion; not run here)

Build with `VITE_WALLHOP_EXTERNAL_OPEN_ENABLED=true` on a non-production preview, synthetic feed with a
public HTTPS article on an example publisher, then on each device:

| Device / viewport                                         | Checks                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| iPhone (Safari), Android (Chrome)                         | item visible in More; consent text readable; Cancel does nothing; OK opens a new tab; no referrer (inspect on the opened page) |
| Galaxy Fold folded and unfolded; **884×1104**             | menu fits; no horizontal overflow; consent dialog readable                                                                     |
| Desktop Chrome, Firefox, Safari                           | popup blockers: the open happens inside the click handler; keyboard: item reachable and activatable with Enter                 |
| Screen reader (VoiceOver / TalkBack)                      | item announced with its label; icon hidden (`aria-hidden`)                                                                     |
| Each shipped locale (de, en, es, fr, ja, zh)              | label and consent text present and not truncated                                                                               |
| Unsafe URLs (http, IP, localhost, credentials, `?token=`) | item absent                                                                                                                    |

Record the result per row (PASS/FAIL, device, OS, browser version, date) in the PM ledger.

## Tests in this change

- `src/utils/wallhop-external.test.js`: flag exactness (absent, empty, `false`, `1`, `yes`, `TRUE`, ` true` all
  hidden), the flag never accepts an unsafe URL, default disabled.
- `scripts/wallhop-external-reader.test.js`: the component uses the gated helper.
