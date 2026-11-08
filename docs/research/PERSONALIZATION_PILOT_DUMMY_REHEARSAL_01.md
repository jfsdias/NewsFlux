# Personalization Pilot Dummy Rehearsal 01

- Repository: `jfsdias/NewsFlux`
- Reference base: `35446e1ab5d8e0e82bbef285835244ac4ab80181`
- Mode: offline, synthetic-only protocol rehearsal
- Human data collection: not started or authorized
- Personalization V2: HOLD

## Purpose and limits

This rehearsal checks that the pilot-preparation contract can be executed locally: a frozen synthetic stimulus set is composed through the production Phase 2C and Personalization V1 projection helpers, a synthetic profile is applied, X/Y and presentation order are allocated independently, both compositions are frozen into receipts, synthetic responses are validated, and a synthetic export is reconciled. It does not assess human relevance or prove that V1 benefits readers.

The script reads only the checked-in `SYNTHETIC_ONLY` fixtures and the existing empty response JSON Schema. It has no HTTP client, Miniflux connection, LimeSurvey connection, account data, analytics, external AI, or production write path. The synthetic article text, feed/category names, IDs, profile seeds, responses, and timestamps are fictitious.

## Frozen inputs and per-session freeze

Before any hypothetical recruitment, the stimulus fixture freezes the article set and content/metadata, eligibility and exclusion rules, scenario IDs, algorithm revision labels, renderer revision, locale, theme, and viewport. The resulting pre-recruitment manifest records canonical SHA-256 hashes for the article set, each article's content and metadata, and the manifest body.

For this rehearsal only, each synthetic session then chooses profile-seed keys from that fixed stimulus manifest. Production `createHomePersonalizationProfile` and `projectHomePersonalization` create the V1 composition; the existing Home editorial session/projection helpers create Phase 2C. Each session receipt freezes both arms, source/category metadata, article coverage, Reader order, X/Y mapping, presentation order, profile-seed references, pair receipts, and a session hash before the synthetic response is constructed.

Allocation is generated separately from profile choices. Production generation uses Node's `crypto.randomBytes` for opaque session/allocation keys and `crypto.randomInt` for Fisher-Yates counterbalancing and X/Y mapping. The checked-in allocation fixture was generated once from those cryptographic APIs and is frozen so tests and reports are reproducible. The fixed fixture demonstrates behavior and uniqueness; it is not evidence that a future live allocation service, survey export, or LimeSurvey integration is operational or secure.

## Validation and integrity

The validator first parses raw JSON with a strict recursive parser that rejects duplicate object keys, including escaped-equivalent and nested keys. It then validates response rows against the existing Draft 2020-12 schema using Ajv 8.20.0, and applies additional referential checks that JSON Schema alone cannot express: known and scheduled scenario IDs, complete versus partial scenario sets, allocation/session joins, X/Y mapping, presentation order, profile-seed references, pair/session hashes, article coverage and uniqueness, Reader order, and source/category identity.

For this schema, a scenario preference of `null` means unanswered/omitted; the explicit string `CANNOT_JUDGE` is a separate response. A scenario omitted from a `PARTIAL` response is also distinct from an included scenario whose preference is null. Complete responses must contain every scheduled scenario. Scenario preference remains separate from the final session-level `overallPreference`.

SHA-256 receipts detect changes when compared with the separately retained frozen receipts. They are not digital signatures and do not provide authenticity if an actor can replace both the artifact and its expected hash. The rehearsal therefore does not claim tamper-proof storage, participant identity, or a production chain of custody. A future study needs an owner-approved process to preserve the pre-recruitment manifest, allocation key, and session receipts independently from response exports before unblinding.

The reconciler rejects invalid response rows with specific machine-readable error codes and no response contents in diagnostics. The frozen demonstration export contains three valid synthetic responses and one deliberately altered pair hash; its deterministic report records four sessions, eight pairs, a 2/2 presentation-order balance, six accepted pairs, and one rejection for `PAIR_RECEIPT_HASH_MISMATCH`. The response export intentionally contains no arm mapping.

## Reproduce

Run the focused contract tests:

```sh
node --test scripts/personalization-pilot-dummy-rehearsal-01.test.js
```

Print the deterministic summary without writing files:

```sh
node scripts/personalization-pilot-dummy-rehearsal-01.js
```

Regenerate the four synthetic artifacts at their fixed repository paths:

```sh
node scripts/personalization-pilot-dummy-rehearsal-01.js --write-artifacts
```

The writer accepts no output-path argument. It can write only the pre-recruitment manifest, session receipts, synthetic export, and report under `scripts/tests/fixtures/` and `scripts/tests/reports/`. Re-run the focused test afterward; it compares generated values against the committed artifacts.

The repository's full Node gate includes the rehearsal through `pnpm test:scripts` / `pnpm test`. Ajv is declared directly at the exact version already present in the frozen lockfile dependency graph so the Draft 2020-12 implementation does not rely on an undeclared transitive import; no dependency version was upgraded.

## Rehearsal evidence

The frozen report is `scripts/tests/reports/personalization-pilot-dummy-rehearsal-01.json`. It is generated solely from the checked-in synthetic fixtures and states `humanRelevanceMeasured=false`, `limeSurveyIntegrationGate=NOT_TESTED`, `externalDataTransfer=false`, `minifluxAccess=false`, and `productChanges=false`.

This task does not install or configure LimeSurvey, submit survey forms, collect participant data, render or usability-test stimuli with people, establish consent/privacy/retention approval, or compare human preferences. A local synthetic export is not a LimeSurvey export. Required status remains:

```text
LIMESURVEY_INTEGRATION_GATE=NOT_TESTED
HUMAN_RELEVANCE_GATE=NOT_MEASURED
HUMAN_DATA_COLLECTION=NOT_STARTED
PERSONALIZATION_V2=HOLD
```

## Residual risks

- The synthetic sample verifies protocol mechanics, not relevance, preference quality, statistical power, representativeness, or V1 benefit.
- A fixture's `generatedBy` marker documents its origin but is not independently attested; production allocation and export behavior still require a separate authorized integration rehearsal.
- A hash provides integrity comparison only when the expected frozen receipt is retained separately; signing, access control, retention, deletion, consent, and operational privacy controls remain unresolved.
- LimeSurvey's actual field mapping, export shape, and preservation of omissions have not been tested.
- The script uses production projection helpers locally, but does not validate browser rendering, real account state, runtime session races, or physical devices.
