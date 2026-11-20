# WallHop — in-Reader backend recovery: isolated readiness (path B)

Status: offline engineering only. `WALLHOP_ACTIVATION=NO_GO`, `W0_PROVIDER_CONTRACT=HOLD`. Nothing here is
deployed, enabled or run against wallhop.io. Path A (external open, PR #257 lineage) is a separate PR and
never contacts a source from the server.

Owner direction W0 (2026-11-20, [PR257 comment 7047495821](https://github.com/jfsdias/NewsFlux/pull/257#issuecomment-7047495821)):
both paths, distinct buttons, independent consent and failure semantics, no automatic fallback between them,
only legitimately accessible content, no credentials or private URLs, no evasion of publisher access controls.

## 1. Baseline and what this PR adds

- **Baseline on main (reused, unchanged):** `services/content_fallback/*` (PR188 core: entry-ID recovery,
  sanitizer, validation, SSRF guard, egress relay, per-domain `ON_DEMAND` policy, reader bridge disabled by
  default), Reader UI (PR241, hidden unless `VITE_CONTENT_FALLBACK_READER_BASE_PATH` is set), and the isolated
  topology `deploy/wallhop-isolated/` (PR254/255/256: separate recovery service, HAProxy SNI allowlist,
  tmpfs, read-only, `cap_drop: ALL`, policy `{"enabled":false}`, `topology_guard.py`, dark deploy/teardown).
- **Added here (safe parts of PR244 only):** `deploy/wallhop-isolated/wallhop_contract_audit.py` (+ tests):
  operator-run, ≤ 3 GETs, dated authorization token, approved-sources file, paywall denylist, no cookies or
  credentials; `docs/ops/WALLHOP_SOURCE_POLICY.md` (candidate matrix, nothing approved); the example config
  without any domain (the paywalled examples are removed); two synthetic failure tests.
- **Not ported:** PR244's `sidecar.override.yaml` and `activate-infra` (they move the PR188 container off
  `npm-proxyyml_default` and break NPM host 111), topology B, PR239.

## 2. Synthetic end-to-end matrix (C5) — every case maps to an executed test

| Case                                  | Test (all synthetic; no provider call)                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| synthetic provider, synthetic content | `test_wallhop.py`: full-text pass, provider chrome cleanup, validation                                                                                                                                                |
| invalid responses                     | `test_wallhop_block_page_http_200_is_rejected`, `test_wallhop_partial_text_preserves_original`, `test_wallhop_repeated_teaser_is_not_accepted_as_full_text`, `test_content.py`                                        |
| unsafe HTML                           | `test_provider_chrome_cleanup_keeps_html_sanitization`, `test_structural_markup_and_scripts_do_not_become_article_content`                                                                                            |
| timeout                               | `test_wallhop_timeout_fails_closed_after_bounded_attempts`                                                                                                                                                            |
| DNS failure / network unavailable     | `test_invalid_address_and_dns_errors_fail_with_controlled_errors`, **new** `test_network_unreachable_or_dns_failure_fails_closed_and_preserves_the_original`                                                          |
| gateway 5xx                           | `test_wallhop_unavailable_fails_closed_after_bounded_attempts`                                                                                                                                                        |
| private URLs                          | `test_private_and_loopback_source_destinations_are_blocked_before_wallhop`, `test_private_ipv4_loopback_link_local_and_cloud_metadata_are_blocked`, `test_private_publisher_address_is_still_refused`                 |
| credentials / secrets in URL          | `test_url_credentials_are_rejected_before_wallhop_request`, `test_sensitive_source_url_is_never_sent_to_wallhop`                                                                                                      |
| unauthorized redirects                | `test_wallhop_unsafe_redirect_is_blocked`, `test_redirect_to_non_allowlisted_host_is_refused_before_connecting`, `test_https_downgrade_redirect_is_refused`, `test_private_redirect_is_rejected_before_request`       |
| egress outside the allowlist          | `test_egress_relay.py` (8 tests)                                                                                                                                                                                      |
| identity, ownership, revocation       | `test_reader_bridge.py`, `test_service.py` reader-scope tests                                                                                                                                                         |
| consent denied                        | `e2e/reader-content-recovery.spec.js` (consent precedes any external request) — Playwright, not run here                                                                                                              |
| Reader regression / flags OFF         | Reader UI hidden without the build flag (`content-fallback-reader.test.js`), bridge disabled by default (`test_runtime_bridge_is_disabled_by_default…`), topology guard refuses any enabled flag (`test_topology.py`) |
| rollback and cleanup                  | `test_g5_dark_teardown.py`, `test_g5_dark_deploy.py`                                                                                                                                                                  |
| NPM111 / PR188 protection             | `test_topology.py`, `test_g4_operator.py` (no `deploy/wallhop-b/` use), `rehearse-npm111.sh` (Docker, not run here)                                                                                                   |

Results in this campaign: `services/content_fallback` 1 pre-existing environment failure on main
(`test_ipv4_mapped_ipv6_uses_the_mapped_ipv4_classification`, Python formatting of IPv4-mapped IPv6; fails
identically on unmodified main), everything else passes; `deploy/wallhop-isolated` unit tests pass; contract
audit tests pass.

## 3. Gates W1–W6 to `WALLHOP_READY_FOR_CONTROLLED_CANARY`

| Gate                 | What                                                                                                                            | Evidence required                                                            | Status                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| W1 provider contract | WallHop terms, privacy, retention, URL processing, permitted automated use; per-domain source rights                            | saved official pages (URL, date, sha256) in the ledger; owner/PM decision    | **HOLD** — official pages unreachable from agent environments; only unverified third-party descriptions found |
| W1b source policy    | approved domains, `ON_DEMAND` only, legitimately accessible content                                                             | `WALLHOP_SOURCE_POLICY.md` rows marked `OPERATOR_APPROVED=YES` with evidence | HOLD (no domain approved)                                                                                     |
| W2 isolated backend  | this PR on the PR254 topology, no PR188/NPM111 change                                                                           | CI + `topology_guard` + NPM111 rehearsal                                     | READY_FOR_REVIEW (offline)                                                                                    |
| W3 contract audit    | one operator-run audit of one approved public article                                                                           | audit receipt in the ledger                                                  | BLOCKED by W1/W1b and a dated GO                                                                              |
| W4 lab rehearsal     | full path in a disposable lab with a synthetic provider: relay allowlist, consent, failure, Reader regression, rollback to dark | rehearsal log, cleanup proof                                                 | READY_FOR_ENGINEERING (synthetic provider harness)                                                            |
| W5 release candidate | Reader build with the base path set, exact-image CI, preflight, digest check                                                    | release receipt                                                              | BLOCKED by W1–W4                                                                                              |
| W6 controlled canary | one approved domain, one user, one article, explicit consent, rollback armed                                                    | canary receipt                                                               | BLOCKED by W1–W5 and an owner GO                                                                              |

`WALLHOP_READY_FOR_CONTROLLED_CANARY` cannot be declared while W1 is HOLD.

## 4. Canary plan (for a future GO; nothing runs now)

1. Preconditions: W1–W5 PASS; dark deploy healthy; `topology_guard` PASS; NPM111 → PR188 audit unchanged.
2. Policy change (governed): `{"enabled": true, "domains": {"<one approved domain>": {"state": "ON_DEMAND",
"provider": "wallhop"}}}` for the isolated service only.
3. One user opens one article from that domain, presses **Fetch full article**, confirms consent; expect the
   sanitized recovered text, the "recovered from WallHop" label and the show-original toggle.
4. Acceptance: response within the timeout; no provider chrome; text passes validation; logs contain only
   entry ID, host and status; no URL, cookie or credential leaves except the publisher URL to wallhop.io via
   the relay; NPM111 and PR188 unchanged; Reader without the flag unchanged.
5. Stop conditions (any → rollback): validation failure on a legitimately accessible article, any request
   outside the allowlist, any log containing a URL or token, any NPM111/PR188 drift, user-visible error.
6. Rollback: policy back to `{"enabled": false}`, then `g5-dark-teardown.sh`; Reader build without the base
   path.

## 5. Protections (unchanged by this PR)

`NPM111_MUTATIONS=0`, `PR188_PRODUCTION_MUTATIONS=0`, `MINIFLUX_MUTATIONS=0`, no live call, no real article
URL, no deploy, no enablement.
