# LimeSurvey CE Technical Gate 01

**Repository:** `jfsdias/NewsFlux`
**Audited main:** `d66046ad38741672b6add8ae6a17c5f39379b8c6`
**Track:** personalization research only
**Mode:** offline, synthetic-only contract validation
**Human collection:** not authorized or started
**LimeSurvey installation:** not authorized or performed
**Personalization V2:** HOLD

## Purpose and limits

This gate defines and tests a versioned mapping from a _mock_ LimeSurvey-style response CSV to the empty session-response schema and strict validator introduced by PR #197 and exercised by PR #198. All example identities, responses, ratings, article preferences, timestamps, and CSV content are synthetic. The adapter accepts only the checked-in `MOCK_CSV_CONTRACT` format. It deliberately rejects input labeled as a real LimeSurvey export.

This proves the adapter and NewsFlux validation contract against controlled CSV examples. It does **not** prove that LimeSurvey CE emits these exact headers, answer values, hidden fields, response states, or session receipts. No LimeSurvey instance was available with authorized access for a read-only inspection, and none was installed or contacted.

## Live state reviewed

- GitHub `main` was `d66046ad38741672b6add8ae6a17c5f39379b8c6`, matching the task's expected SHA.
- PRs #190, #196, #197, and #198 are merged. PR #198 includes the R1 2×2 label/order coverage.
- PR #195 is an open Draft for ARTICLE-INTEL-01 documentation. Open STORY-01B research PRs #134–#140 do not change this LimeSurvey adapter scope.
- No open LimeSurvey implementation or survey-collection PR was found.
- The initially selected local checkout had an invalid Git ref and could not fetch. No files or refs in that checkout were changed. Work proceeds from a fresh isolated clone at the exact live `main` SHA.

## Official LimeSurvey documentation reviewed

Reviewed on 2026-11-08:

- The official download page listed LimeSurvey CE **7.7.0** as the current stable release. It provides the release package and SHA-256 checksum; the version should be rechecked when a future instance is approved. [LimeSurvey downloads](https://community.limesurvey.org/downloads/)
- The current CE installation manual lists MariaDB 10.3.38+, MySQL 8+, SQL Server 2019+, or PostgreSQL 14+; LimeSurvey 7.x requires PHP 8.1.29 or later and is tested through PHP 8.5.x. The manual describes installing the downloaded package into a dedicated application directory. [CE installation requirements](https://www.limesurvey.org/manual/Installation_-_LimeSurvey_CE)
- The response-export UI offers CSV and configurable comma, semicolon, or tab separators; it allows export of full answer text or answer codes, and question-code headings with ExpressionScript variable naming. It also distinguishes completed, incomplete, and all responses. [Export responses](https://www.limesurvey.org/manual/Export_responses)
- Question codes are intended to identify questions in exports and logic, are unique within a survey, are not ordinarily shown to respondents, and are case-sensitive. ExpressionScript variable names can include question/subquestion identifiers. [Question and answer codes](https://help.limesurvey.org/portal/en/kb/articles/question-and-answer-codes), [Expression Manager Qcode naming](https://www.limesurvey.org/manual/Expression_Manager/en)
- LimeSurvey supports hidden questions and URL-prefilled answers. Hidden/prefilled fields are therefore transport conveniences, not confidentiality or integrity controls; values supplied through a link must be treated as untrusted until compared with the frozen receipt. [URL fields and prefilling](https://www.limesurvey.org/manual/URL_fields), [hidden question setting](https://www.limesurvey.org/manual/QS%3AHidden)
- LimeSurvey randomization-group settings can randomize question groups with the same group name. That mechanism alone does not provide the NewsFlux assignment receipt or prove which content was actually shown; the precomputed assignment/session receipt remains authoritative. [Question groups](https://www.limesurvey.org/manual/Creating_a_question_group)
- LimeSurvey's official installation guidance is package-based. The community forum also states that LimeSurvey CE does not have an officially supported Docker image; third-party images are not selected for this plan. [Installation manual](https://www.limesurvey.org/manual/Installation_-_LimeSurvey_CE), [community discussion](https://forums.limesurvey.org/forum/installation-a-update-issues/134190-docker-compose-issues)

The manuals document supported options, not a byte-for-byte export contract for a particular CE release and survey. In particular, UTF-8 BOM behavior, localized/system-column labels, incomplete-page persistence, and hidden-field persistence need verification against the selected version's actual export before any real integration can pass.

## Instrument and blinded-data contract

The participant-facing instrument must never display the arm mapping (`X/Y → Phase 2C/V1`). The restricted assignment/receipt store retains that mapping. A response contains only a pseudonymous session code, opaque allocation key, manifest hash, per-scenario X/Y presentation order and pair hash, responses, and (if approved) study-only preference choices. The CSV contract must not contain the arm mapping or an algorithm name.

Pseudonymous identifiers are still joinable data. Keep the assignment key, receipts, and response export access-controlled and separate. Do not use account IDs, emails, Miniflux IDs, direct identifiers, or real account/article state. A non-consenting participant must not create an analyzable response row. Do not include LimeSurvey token, email, IP address, referrer, or participant-table fields in the export.

The checked-in field map is [`limesurvey-ce-export-field-map-01.json`](../../scripts/tests/fixtures/limesurvey-ce-export-field-map-01.json), version `LIMESURVEY_CE_RESPONSE_CSV_MOCK_V1`. It is a mock contract, not an imported LimeSurvey survey definition. It fixes one header row, question-code/ExpressionScript headings, answer codes, and a configured delimiter. It uses synthetic qcodes for:

| Data                             | Mock columns                           | Conversion                                                                                             |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Session identity                 | `NFSess`, `NFAlloc`, `NFMani`          | Pseudonymous session code, allocation join key, frozen session-manifest hash                           |
| Consent and session choice       | `NFConsent`, `NFOverall`               | Only affirmative consent is accepted; overall preference remains separate from per-scenario preference |
| Study-only sample-item choices   | `NFSeed_*` subquestion columns         | Selected `Y` values map to the fixed synthetic seed-key vocabulary and are checked against the receipt |
| Scenario identity and exposure   | `TrCode`/`LiCode`, `TrShown`/`LiShown` | Scenario code must match the versioned map; `Y` means presented; blank means not presented             |
| Pair integrity and visible order | `TrHash`/`LiHash`, `TrOrder`/`LiOrder` | Compared to the corresponding frozen pair receipt; only `X_THEN_Y` or `Y_THEN_X` can validate          |
| Scenario preference              | `TrPref`/`LiPref`                      | `X`, `Y`, `TIE`, `NEITHER`, `CANNOTJUDGE`; empty is omitted and maps to JSON `null`                    |
| Independent arm ratings          | `TrX*`, `TrY*`, `LiX*`, `LiY*`         | Each X and Y rubric field is mapped independently; blank → `null`; `CANNOTJUDGE` → `CANNOT_JUDGE`      |
| Optional rationale               | `NFRationale`                          | Blank → `null`; otherwise preserved in the validated response, never echoed in diagnostics             |
| Completion state                 | system column `submitdate`             | Empty → `PARTIAL`; non-empty → `COMPLETE`; real-export semantics are unverified                        |

The existing schema's `declaredContextTags` is optional and is not populated by this mock fixture. The topic vocabulary and its LimeSurvey representation remain owner decisions; this work does not invent or approve that vocabulary. `WITHDRAWN` is not inferred from an export row. A withdrawn response must be handled under a separately approved withdrawal/deletion procedure and must not be silently represented as a partial response.

## CSV acceptance rules

The adapter in [`limesurvey-ce-export-adapter-01.js`](../../scripts/tests/limesurvey-ce-export-adapter-01.js) accepts only the versioned mock map and applies these rules:

1. Input must decode as strict UTF-8. A single leading UTF-8 BOM is allowed. The configured separator is explicit (`comma`, `semicolon`, or `tab`); the adapter never guesses it.
2. Quoted delimiters, doubled quotes, CR/LF/CRLF records, and line breaks inside quoted fields are parsed without splitting response content.
3. Headers are matched exactly by stable question-code/ExpressionScript names, not visible question text. Header order does not affect mapping. Blank, duplicate, missing, and unknown headers are rejected. V1 has a closed system-column allowlist: `submitdate` is the required completion field, and only `id`, `lastpage`, `startlanguage`, and `seed` may be ignored. `token`, `email`, and any other unlisted system field are rejected with `CSV_SYSTEM_COLUMN_UNAPPROVED`; duplicates use `CSV_SYSTEM_COLUMN_DUPLICATE`. This list cannot be widened without a new contract version. Participant/tracking columns are not implicitly ignored.
4. Every data row must have the same number of fields as the header. Empty response cells remain empty values; they are not converted into `CANNOT_JUDGE`.
5. The `presented` marker controls whether a scenario-rating object is emitted. A blank marker with any preference/rating answer is rejected. A shown scenario requires its exact scenario code, pair hash, and X/Y order. These are checked against the session receipt even when hidden values are present on an unshown scenario.
6. Duplicate session codes or allocation keys are rejected. Each row's session code, allocation key, and manifest hash are joined against exactly one frozen session. The X/Y algorithm mapping is not copied into the participant response.
7. Answer codes are converted only through the explicit map. Blank ratings/preferences become `null`; explicit `CANNOTJUDGE` becomes `CANNOT_JUDGE`. Invalid codes are rejected by the existing schema/validator, not coerced.
8. The transformed rows are wrapped as in-memory synthetic contract input and passed to the existing PR #198 `reconcileSyntheticExport` path, which invokes the strict JSON parser, Draft 2020-12 schema, response validation, and manifest/pair reconciliation. If any row is rejected, import fails with machine-readable rejection code(s); no raw answer text, identifiers, or free text is included in the error.

`submitdate` and the four ignored system headers in the fixture are mock identifiers, validated against the fixed V1 allowlist. The real export may name or position those columns differently depending on export mode/version/language. A real integration must first save and review a dummy export, then version a separate exact field map against that artifact; it must not widen the mock map permissively.

## Offline evidence

All adapter tests derive from the PR #198 synthetic stimuli, allocation, session receipts, and response fixtures. No service client exists in the adapter. It reads bytes/text supplied by the caller and the caller-provided frozen in-memory manifests only. No Miniflux, LimeSurvey, network, human response, or production data path is used.

The focused test covers:

- UTF-8/BOM, delimiter mapping, quoting, escaped quotes, embedded newlines, malformed quoting, invalid UTF-8, and row-width rejection;
- strict versioned headers, duplicate/missing/blank/unknown header rejection;
- X/Y order, scenario identity, pair-receipt validation, duplicate session/allocation rejection, and session-manifest reconciliation;
- empty versus `CANNOT_JUDGE` responses, unpresented versus presented-but-skipped scenarios, independent X/Y ratings, consent, completion status, and bounded rationale handling;
- explicit `MOCK_CSV_CONTRACT` labeling and `LIMESURVEY_INTEGRATION_GATE=NOT_TESTED` in the returned report.

The adapter's return value is an audit report for the **mock** file. It is not a LimeSurvey runtime receipt and must not be cited as one.

## Future isolated dummy rehearsal plan (not executed)

### Environment

1. Obtain owner authorization for a disposable isolated Linux VM/host. Do not modify the NewsFlux Compose project, host reverse proxy, DNS, production network, or any existing service.
2. Download the then-current stable LimeSurvey CE archive only from the official download page; verify its published SHA-256 before extraction. Pin the archive hash, PHP runtime, OS image, and database image/version in the rehearsal record. The page reviewed for this gate listed CE 7.7.0; recheck support and current stable version immediately before a separately approved install.
3. Install CE from the official package in a dedicated application directory. Use a dedicated PostgreSQL 14+ database and separate database credentials. Keep the database and app on a private, non-public network; bind the survey only to loopback/internal access through an approved tunnel. No public DNS/port, NewsFlux container network, Miniflux route, SMTP, analytics, or external AI integration.
4. Use dedicated random administrator/database credentials, not NewsFlux credentials. Disable IP/referrer/token collection where supported and verify exported columns. Enable no participant recruitment. Configure only a synthetic test survey and synthetic session links.
5. Persist only the dedicated LimeSurvey database, upload directory, and minimal configuration needed for the rehearsal. Take an encrypted, access-restricted backup before survey activation; verify restoration in the same isolated environment. No account or article data is loaded.

### Test and acceptance sequence

1. Import the frozen mock survey/instrument and display four synthetic session slots, including both algorithm-first orders and both X/Y-first orders. Check that the arm mapping is absent from all participant-visible content and the export.
2. Submit synthetic test cases only: consented complete, consented partial, omitted answer, explicit CANNOT_JUDGE, both X/Y display orders, one not-yet-presented scenario, and one deliberately tampered scenario/order/receipt.
3. Export responses in the exact selected CSV mode. Save the untouched export and its SHA-256 with the LimeSurvey version/export settings. Record the header, delimiter, charset/BOM, line endings, completion fields, and hidden field behavior. Do not edit the export in a spreadsheet.
4. Version a real-export field map only after comparing those actual headers/codes to the expected map. Parse the export, convert to schema records, run the strict schema and manifest validator, reconcile every session and pair, and produce a redacted report. Tampered/missing/ambiguous data must stop the run; no manual column guessing.
5. Pass only if exact row/session counts reconcile, every presented pair joins to one receipt, no arm mapping is exported, omitted and CANNOT_JUDGE remain distinct, the altered receipt is rejected, and a restored backup can read the synthetic survey/response. This future flow is currently `NOT_TESTED`.

### Rollback/removal

Do not activate for recruitment. After the synthetic gate, export only the fake test data, record the test receipt, stop the isolated app/database, and wait for the owner to authorize removal. On authorization, delete the VM and its dedicated database/upload/config volumes and backups, revoke rehearsal credentials, and verify that no public listener or integration remains. No LimeSurvey installation or resource was removed by this task.

## Owner decisions still required

- Whether and where to authorize a disposable LimeSurvey CE instance, and who operates/maintains it.
- Whether the study uses public item choices as the profile proxy, and the approved topic vocabulary.
- Exact consent/withdrawal and deletion handling, retention period, backup retention, data controller/contact, access roles, and whether institutional/privacy review is required.
- Whether complete/incomplete rows are included in the export and the approved rules for excluding a withdrawn or non-consenting session.
- Approval of the survey code/question-code map, export version, delimiter, charset, anonymous settings, hidden-field transport, and the actual export verification procedure.
- The transport/security mechanism for a session-code/allocation join that cannot be altered or guessed by a respondent. Hidden fields and URL-prefilled values alone do not provide integrity or confidentiality.

Until those decisions and an authorized runtime test exist:

```text
ACTUAL_LIMESURVEY_EXPORT=NOT_TESTED
LIMESURVEY_RUNTIME=NOT_DEPLOYED_BY_THIS_TASK
HUMAN_DATA_COLLECTION=NOT_STARTED
HUMAN_RELEVANCE=NOT_MEASURED
PERSONALIZATION_V2=HOLD
```

## Reproduce offline adapter tests

```sh
node --test scripts/limesurvey-ce-export-adapter-01.test.js
```

The full adapter accepts only `MOCK_CSV_CONTRACT`; use of actual LimeSurvey exports requires a new owner-approved gate after runtime installation and actual dummy export capture.
