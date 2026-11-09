# LimeSurvey CE Isolated Dummy Runtime Gate 01

- **Repository:** `jfsdias/NewsFlux`
- **Prepared from live main:** `9c3f0ef8a47d7838b79ad26c67d45de9db4f7dd3`
- **Track:** personalization research only
- **Mode:** read-only environment preflight plus synthetic preparation
- **Human collection:** not started or authorized
- **LimeSurvey installation:** not authorized or performed
- **Personalization V2:** HOLD

## Purpose and boundaries

Prepare a reproducible, disposable LimeSurvey Community Edition (CE) rehearsal that checks the existing PR #197–#199 blinded-session and response-export contract using fictitious data only.

This preparation does not install LimeSurvey, create a VM, create containers, alter host networking, contact Miniflux, access a NewsFlux account, collect human responses, or make a production change. Installation remains blocked until a separate explicit owner authorization identifies the target environment.

The earlier `LIMESURVEY_CE_TECHNICAL_GATE_01.md` and its mock CSV contract remain historical source material. Its 7.7.0 “current stable” note is corrected by an appended erratum because the official release list shows 7.9.1 was released on 2026-11-02. This document records the verified current software-version snapshot and isolated runtime plan. It does not rewrite prior evidence or claim that the real integration gate passed.

## Live project prestate

- GitHub `main` at preparation start: `9c3f0ef8a47d7838b79ad26c67d45de9db4f7dd3`.
- PR #197: merged; PR #198: merged; PR #199: merged. PR #199 merge SHA equals the audited main.
- No open LimeSurvey/runtime integration PR was found. PR #195 and Story research PRs are outside this scope.
- New isolated branch was based on that exact main SHA. No existing PR #199 branch/worktree was reused or changed.
- Existing offline fixtures and adapter remain the only executable contract evidence. The adapter deliberately accepts `MOCK_CSV_CONTRACT`, not real LimeSurvey exports.

## Current official release snapshot

Checked against official LimeSurvey sources on 2026-11-08:

| Item                                                       | Verified value                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Current stable LimeSurvey CE                               | 7.9.1; release date 2026-11-02                                               |
| Official archive                                           | `https://download.limesurvey.org/latest-master/limesurvey7.9.1%2B261102.zip` |
| Official published SHA-256                                 | `c90a1dae4b0b3e265d20de08185a74f5d68f1af3e78fa5e33772f82f550d6891`           |
| Archive download / local digest recomputation in this task | Not performed                                                                |
| Runtime versions of this instance                          | None; no instance installed or contacted                                     |

The checksum is the value published at the official checksum endpoint for this archive, not a locally computed digest. At a future authorized installation, download the archive and checksum file from the official downloads page, recompute SHA-256 locally, require an exact match before extraction, and save the verification receipt with the VM build record.

Official CE installation requirements for LimeSurvey 7.x include PHP 8.1.29 or newer (tested through PHP 8.5.x), at least 128 MB PHP memory limit, at least 500 MB disk for the unpacked application, and a supported database: MariaDB 10.3.38+, MySQL 8+, PostgreSQL 14+, or Microsoft SQL Server 2019+. Required PHP modules include mbstring, the relevant PDO driver, GD, Zip, Zlib, cURL, fileinfo and JSON. The official manual also recommends `max_input_vars >= 5000`, `post_max_size >= 32M`, and `upload_max_filesize >= 32M`. These are software minimums, not a complete VM sizing recommendation.

The current workstation preflight reports Darwin/macOS. No `multipass`, `qemu-system-aarch64`, `vmrun`, or `virsh` executable was found on PATH. This does not prove there is no VM product installed elsewhere; it means no existing isolated Linux target was identified or verified. No Home Server, Docker, Compose, firewall, DNS, NPM, Authelia, or production network configuration was inspected or changed.

## Recommended isolated target

Use a **new disposable Linux VM**, selected and provisioned only after owner authorization. Do not reuse the NewsFlux Home Server or its Compose stack.

Proposed shape:

- One VM with a pinned OS image, Apache 2.4+, PHP 8.1.29+ and the required PHP extensions.
- A dedicated PostgreSQL 14+ database and user for this rehearsal. Database and application credentials are independent, generated uniquely for the disposable instance, and never embedded in source, PR text, shell history, screenshots, or logs.
- No route to the NewsFlux/Miniflux LAN, no public inbound listener, no public DNS, and no reverse-proxy integration. The survey application is bound for local-only access inside the isolated VM. If a host-to-VM console path requires host networking changes, stop for a separately authorized network design.
- Disable outbound email, participant/token tables, IP/referrer collection, analytics, and integrations. The survey contains no real accounts, real stimuli, private feed data, or direct identifiers.
- Use only checked-in `SYNTHETIC_ONLY` fixtures and a local static stimulus pack. Any hidden/prefilled identifiers are still treated as untrusted and revalidated against frozen receipts.

The present environment check did not identify or reserve such a VM. Therefore environment availability, resource sizing, and network isolation are **proposed, not verified**.

## Package and installation procedure for a later authorized run

This is a reviewable procedure, not an executed installation script.

1. Owner chooses a disposable VM and approves its OS image, storage, CPU/RAM allocation, access method and isolation boundary. Confirm no route to production/private NewsFlux or Miniflux networks.
2. Build from a pinned, clean OS image with only the required Apache/PHP extensions and PostgreSQL. Record OS image identifier and package versions. Do not use a community Docker image as an assumed official deployment artifact.
3. Obtain the official CE 7.9.1 ZIP and official checksum file. Verify the archive using `sha256sum` before extraction. If the official stable version has advanced by then, stop and update this version snapshot and the compatibility review before installation.
4. Extract into a new dedicated application directory. Configure LimeSurvey with an isolated database/user and a new administrator password. Keep secrets in the approved password manager or secret store; do not print them. Restrict admin access to the isolated console and disable mail.
5. Complete the installer checks, verify app/database health locally, confirm the survey is inactive, and inspect the effective network bindings from inside the VM. Do not expose a port or route it through a home proxy.
6. Import or build the synthetic survey as described below. Create exactly the four pre-defined synthetic session trials; do not invite participants.
7. Submit only the fixture's fictional values in the isolated instance. Export both incomplete and completed records as needed for the matrix. Keep all output inside the disposable VM until reviewed.
8. Compare the exported file to the exact versioned field map. Do not feed a real CE export to the mock-only PR #199 adapter or report a real integration PASS. If the output differs, preserve the export as synthetic-only evidence in the restricted rehearsal workspace and propose a separately versioned adapter contract; do not widen the current mock map.
9. Stop the application, perform the restore check described below, and capture a redacted receipt containing software versions, archive digest, question-code parity, export options, test results and zero-network/write assertions—no responses, credentials, participant metadata or private data.

### Blueprint and import limitation

The machine-readable blueprint is `../../scripts/tests/fixtures/limesurvey-ce-dummy-instrument-blueprint-01.json`. It references the existing field map and synthetic fixtures; it covers four synthetic sessions, two scenarios per session, two arms per scenario, independent arm ratings, per-scenario and overall preferences, omissions and explicit `CANNOTJUDGE`, consent, order and integrity receipts.

This JSON is **not** a LimeSurvey import file. LimeSurvey's official survey-structure import uses `.lss` XML generated/exported by LimeSurvey (and the manual also documents other legacy/import formats). The current official materials do not make the NewsFlux mock field map itself an importable survey. Because no authorized 7.9.1 runtime exists here, this task does not hand-author an unvalidated `.lss` and call it ready.

After installation authorization, create the survey from the blueprint in the isolated instance using the exact question codes. Export its survey structure as `.lss`, import that export into a clean second survey slot on the same exact CE version, and retain the import summary. The actual export/re-import is a required runtime gate. Do not activate either survey.

## Instrument flow and synthetic run

Use the blueprint to create these groups in order:

1. **Session control:** synthetic session code, allocation key, session-manifest hash and consent answer. Keep the identity/integrity fields hidden from the respondent; hiding is not a security boundary.
2. **Study-only profile seed:** use the existing four synthetic seed keys. Leave unset when the fixture says no choices. Do not request free-form interests or sensitive preferences.
3. **Scenario: `synthetic_transit`:** show frozen X and Y stimuli from the separate local static pack in the assigned order. Record whether shown, scenario code, pair hash, visible order, per-scenario preference and independent rubric ratings for X/Y.
4. **Scenario: `synthetic_library`:** repeat the same structure using its own frozen pair receipt.
5. **Session closeout:** capture optional overall X/Y/TIE/NEITHER/CANNOTJUDGE preference separately from the per-scenario preferences, plus optional bounded rationale.

For dummy submissions, use the four checked-in allocation/session fixtures and synthetic response fixture. Do not fabricate new participant profiles or labels. The static stimulus display—not LimeSurvey randomization—must follow the frozen session receipt. LimeSurvey randomization settings alone are not evidence of the actual X/Y assignment or visible order.

## CSV export and acceptance matrix

Official LimeSurvey export supports completed, incomplete, or all response states; answer codes; question-code headings; and an ExpressionScript variable-name option. The exact generated headers, completion column, encoding/BOM, delimiter, and preservation of incomplete/omitted fields remain version- and configuration-dependent until observed in the runtime.

For the isolated dummy export, choose and record:

- CSV format, UTF-8 output; explicitly record whether a BOM is present.
- One configured delimiter (first trial: comma); repeat with semicolon/tab only if that gate is part of the authorized rehearsal.
- Export answer codes, question-code headings, ExpressionScript variable names, and all relevant response columns.
- Export all states and then completed/incomplete subsets separately; compare row membership against the synthetic fixture.
- No participant/token columns. No email, IP, referrer, response URL, or external identifier.

| Gate                      | Positive synthetic case                                      | Negative/tamper case                                       | Current evidence                                                             |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Header and question code  | Exact question-code map                                      | Unknown, missing, blank, duplicate or renamed code         | Mock-only tests PASS; actual export NOT_TESTED                               |
| Answer codes              | Exact configured codes for choices/ratings                   | Text labels, invalid code, code-case drift                 | Mock-only tests PASS; CE output NOT_TESTED                                   |
| UTF-8/BOM/delimiter       | Valid UTF-8 with or without one BOM, configured comma        | Invalid UTF-8, malformed quoting or wrong delimiter        | Mock parser tests PASS; CE output NOT_TESTED                                 |
| Completion state          | Completed row maps only from pinned `submitdate`             | Missing marker or alternate system column                  | Mock contract pinned; CE completion semantics NOT_TESTED                     |
| Partial responses         | Incomplete synthetic response remains distinguishable        | Partial row dropped or treated as complete                 | Reconciler behavior tested on fixtures; CE persistence/export NOT_TESTED     |
| Omission vs cannot judge  | Blank → omitted/null; explicit `CANNOTJUDGE` → explicit enum | Blank coerced to cannot-judge or vice versa                | Mock tests PASS; CE output NOT_TESTED                                        |
| Scenario/session identity | Known scenario, session and receipt join                     | Unknown/unshown scenario, duplicate session/allocation key | Strict validator negative tests PASS; CE hidden-field persistence NOT_TESTED |
| X/Y order and blinding    | Exact order/hash receipt, no algorithm field in response     | Tampered order/hash or visible arm mapping                 | Mock tests PASS; actual rendering/export NOT_TESTED                          |
| Sensitive fields          | Only allowlisted fields exported                             | token, email, IP/referrer or unknown system field          | Mock allowlist rejects; CE export selection NOT_TESTED                       |

No gate in the last column can be upgraded to a LimeSurvey integration PASS based on the mock fixtures.

## Credentials, backup, recovery and rollback

### Secrets

- Generate a unique administrator password and a unique database password only after the instance is authorized.
- Store them in the owner-approved password manager/secret store; never commit or include in a receipt.
- Do not enable SMTP, participant invitations, tokens or external authentication.
- Use a separate local browser profile for the isolated VM; no production cookies or session reuse.

### Backup and restore

- Before importing the survey, snapshot the disposable VM and make a database backup restricted to that VM.
- After the synthetic run, take a second backup only if needed for evidence retention. It must contain synthetic values only, be access-restricted, and have an owner-approved expiration.
- Restore the pre-run snapshot into a disposable copy and verify that it opens and contains only the expected baseline survey state.
- No backup goes to the NewsFlux server, Miniflux, shared cloud storage, or an unapproved synchronization folder.

### Rollback / teardown

1. Stop the web server and database VM.
2. Export only a redacted runtime receipt and approved synthetic contract artifacts.
3. Destroy the VM, application volume, database volume, snapshots and test browser profile.
4. Revoke/delete the disposable administrator/database credentials from the approved secret store.
5. Verify that no DNS, proxy, firewall, container, database or production-service changes exist.
6. Record teardown confirmation without copying synthetic answer contents into the PR.

## Authorization gate before installation

The PM/owner must explicitly identify and authorize:

- The disposable Linux VM or isolated host and its owner.
- OS image, allocation/resources, application/database versions and local access method.
- The exact no-public-ingress/no-production-route boundary.
- Permission to provision packages and create a temporary database **inside that target only**.
- Credential storage and expiry.
- Backup location, restore test, retention and destruction.
- Whether to prepare/import a LimeSurvey-generated `.lss` after the versioned survey is built.
- Whether the task is still synthetic-only. Human collection remains separately unauthorized.

Until that decision exists, no installer, package extraction, database, container, survey submission or runtime export is authorized.

## Local reproducibility

Existing synthetic contract gates:

```sh
node --test scripts/personalization-pilot-dummy-rehearsal-01.test.js
node --test scripts/limesurvey-ce-export-adapter-01.test.js
node --test scripts/limesurvey-ce-dummy-instrument-blueprint-01.test.js
```

The first two tests remain the authoritative offline rehearsal and mock-export contract. The third checks that the blueprint maps exactly to the existing field map and four synthetic sessions; it does not emulate LimeSurvey.

## Evidence status

```text
PRESTATE=PASS
MAIN_SHA_GATE=PASS
SCOPE_ISOLATION=PASS
OFFICIAL_SOURCE_VERIFIED=PASS
OFFICIAL_CHECKSUM_RETRIEVED=PASS
OFFICIAL_PACKAGE_VERIFICATION=NOT_EXECUTED
ARCHIVE_BYTES_DOWNLOADED_OR_REHASHED=NO
ISOLATED_ARCHITECTURE=PASS_WITH_TARGET_UNSELECTED
NO_PUBLIC_EXPOSURE_PLAN=PASS
SECRETS_HANDLING_PLAN=PASS
BACKUP_RESTORE_PLAN=PASS_WITH_RUNTIME_TEST_PENDING
ROLLBACK_PLAN=PASS
SYNTHETIC_INSTRUMENT_BLUEPRINT=PASS
LIMESURVEY_NATIVE_IMPORT=NOT_TESTED
EXPORT_TEST_MATRIX=PASS_AS_PLAN
ACTUAL_LIMESURVEY_EXPORT=NOT_TESTED
INSTALLATION_SCRIPT_PREPARED=NO
LIMESURVEY_RUNTIME_INSTALLATION=NOT_EXECUTED
HUMAN_DATA_COLLECTION=NOT_STARTED
HUMAN_RELEVANCE=NOT_MEASURED
MINIFLUX_ACCESS=NO
NEWSFLUX_COMPOSE_CHANGE=NO
PRODUCTION_NETWORK_MUTATION=NO
PERSONALIZATION_V2=HOLD
```

## Sources

- [Official stable releases](https://community.limesurvey.org/releases/)
- [Official LimeSurvey CE downloads and published checksum](https://community.limesurvey.org/downloads/)
- [Official CE installation requirements](https://www.limesurvey.org/manual/Installation_-_LimeSurvey_CE)
- [Official survey import formats and steps](https://www.limesurvey.org/manual/manual/Surveys_-_introduction)
- [Official survey import details and version compatibility](https://help.limesurvey.org/portal/en/kb/articles/import-a-survey)
- [Official response export options](https://www.limesurvey.org/manual/Export_responses)

## Outcome

This branch prepares an auditable isolated dummy-runtime proposal. It does not prove the LimeSurvey runtime contract. Installation requires a separate owner authorization; actual LimeSurvey export remains a hard gate before any human data or Personalization V2 decision.
