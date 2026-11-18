# NEWSFLUX-AI-SETTINGS-01 — installation package R4 (supersedes R3; R1–R3 kept as history)

**Date:** 2026-11-18, America/Bahia. **State:** code, release tooling and synthetic gates complete in feature
PRs; **not merged, not deployed**. This document is a controlled procedure, **not a GO**. No real LiteLLM key,
real article, Miniflux write, Home Server access or production change was used to produce it.

**R4 change (PM Red Team, [#265 6978348016](https://github.com/jfsdias/NewsFlux/pull/265#issuecomment-6978348016) +
[addendum 6978400994](https://github.com/jfsdias/NewsFlux/pull/265#issuecomment-6978400994)):** the R3 read-only
preflight printed flag, health, port, origin and `/data` classifications without failing on unsafe values
(reproduced: four canary flags ON and an HTTPS+HTTP origin list still gave `PREFLIGHT=PASS`, exit 0). R4 makes
every gate in section 5 fail closed, resolves the R3 ambiguity on `ALLOW_LOCAL_ARTICLE_PROCESSING` (preserve a
reviewed baseline, never force it) and replaces the unconditional `WALLHOP_RESOURCES=0` with a no-touch
inventory comparison. No functional code (#262/#263/#264) changed in R4.

## 1. Exact source

| Track                                                                 | PR                                                   | Branch                                               | HEAD                                       | Base           |
| --------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ | -------------- |
| main                                                                  | —                                                    | `main`                                               | `d54eda2bdb8bc5c3d1bd58d40236f48da762e852` | —              |
| Backend: admin API, managed store, policy, preflight, restore         | [#262](https://github.com/jfsdias/NewsFlux/pull/262) | `codex/newsflux-ai-settings-backend-r1`              | `683d60cf791046060ce0b3405ef77fd0ef5b28f7` | main           |
| UI: admin section, selectors, 6 locales, harness                      | [#263](https://github.com/jfsdias/NewsFlux/pull/263) | `codex/newsflux-ai-settings-ui-r2`                   | `8b7960d6e49b91d29f0666a0834b6c238a11d8ec` | #262 (stacked) |
| Caddy admin route contract                                            | [#264](https://github.com/jfsdias/NewsFlux/pull/264) | `codex/newsflux-ai-settings-caddy-route-r1`          | `2641010b78839150b4c227f9939d7e373462f971` | main           |
| Release governance: Stage 1 → new Caddyfile transition, OMV preflight | [#265](https://github.com/jfsdias/NewsFlux/pull/265) | `codex/newsflux-ai-settings-stage1-caddy-release-r1` | `805e6d14d77c1602850ebe26be0b37d4830e6a2e` | main           |
| Spec and install docs                                                 | [#261](https://github.com/jfsdias/NewsFlux/pull/261) | `codex/newsflux-ai-settings-01-spec-r1`              | this branch                                | main           |
| Test-only combined tree (**never merge**)                             | —                                                    | `claude/intelligent-edison-5053ez`                   | `3df26f1addb1691ac42d3c866c22b8f378a7a29a` | main           |

PR #260 (local Ollama privacy) is in **none** of these trees and remains OPEN/DRAFT, privacy HOLD.
`integration/newsflux-ai-settings-01-r1-validated-candidate` is obsolete. Images are built only from the
**merged `main` SHA** (`APPROVED_SHA`), never from a PR head or the integration branch.

## 2. Merge order (each step needs explicit owner authorization; none executed)

1. **#265** (release tooling). Alone on main its rehearsal exercises a synthetic Caddyfile transition.
2. **#262** (backend).
3. Retarget **#263** to `main`, merge `main` into it, re-run its "Exact-source Docker Compose pilot gate"
   (requires `base == live main`; structurally impossible while stacked), then merge.
4. Merge `main` into **#264**, re-run `Summary release isolated rehearsal` (now with #265 → real Stage 1 →
   admin-route transition), then merge.
5. **#261** (docs) last, with the final `APPROVED_SHA` recorded.

## 3. Files changed (vs `main`)

- #262: `services/article_intel_summary/{admin_api,admin_settings,app,catalog,operator_restore_ai_settings,operator_preflight_ai_settings}.py`, `tests/test_admin_settings.py`, `tests/test_operator_preflight.py`.
- #263: `src/components/Settings/{ArticleIntelligence.jsx,ArticleIntelligence.css,LiteLlmAdminSettings.jsx,LiteLLMAdminSettings.css}`, `src/apis/article-intelligence-admin{,.test}.js`, `src/utils/litellm-admin-state{,.test}.js`, `src/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,zh-CN}.json`, `scripts/pilot-e2e/{admin_backend.py,ai-settings-admin.spec.js,playwright-admin.config.js,vite-admin.config.js}`, `scripts/tests/ai-settings-admin.{html,jsx}`, `.github/workflows/ai-settings-tests.yaml`, `knip.json`.
- #264: `deploy/article-intel-pilot/Caddyfile`, `scripts/pilot-e2e/test-caddy-route.mjs`, `.github/workflows/ai-admin-caddy-gates.yaml`.
- #265: `deploy/release-governance/{ai-functional-release.sh,release.py,ai-settings-flag-baseline.json,rehearse-stage1-upgrade.sh,ai-settings-readonly-preflight.sh,test_caddy_transition.py,test_readonly_preflight.py,test_release_failure_io.py}`, `.github/workflows/summary-release-rehearsal.yaml` (adds `workflow_dispatch`), `docs/ops/ARTICLE_INTELLIGENCE_PROMOTION.md`.

## 4. Images, volumes, permissions, configuration

- **Images:** `newsflux-summary:<APPROVED_SHA>` (`services/article_intel_summary/Dockerfile`, user `10001:10001`)
  and `newsflux-reader:<APPROVED_SHA>` (root `Dockerfile`, `VITE_ARTICLE_INTELLIGENCE_ENABLED=1`), both with
  `org.opencontainers.image.revision=<APPROVED_SHA>`, built by `ai-functional-release.sh build` (includes the
  isolated candidate start gate).
- **Volumes:** Summary `/data` persistent, owned by UID 10001, writable; the managed store is created on the
  first authorized save at `/data/newsflux-ai-settings` (0700; `settings.json`, `previous.json`, `activated`,
  `write.lock` 0600). Bootstrap key stays the existing read-only 0600 file `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE`.
  Reader `/etc/caddy/Caddyfile` stays a single-file bind mount (regular file, not a symlink).
- **Flag contract for the initial canary (Summary).** The backend reads a flag as ON only when its value is
  `true` (trimmed, case-insensitive); the preflight accepts only `true`, `false` or unset and classifies anything
  else as `MALFORMED` (HOLD).

  | Flag                                          | Required                | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED`     | OFF                     | ON or MALFORMED → HOLD (writes need a separate GO, section 7)                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `NEWSFLUX_AI_INFERENCE_ENABLED`               | OFF                     | ON or MALFORMED → HOLD                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER` | OFF                     | ON or MALFORMED → HOLD                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `NEWSFLUX_AI_ALLOW_PAID_INFERENCE`            | OFF                     | ON or MALFORMED → HOLD                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING`  | **= reviewed baseline** | owned by PR #260; this release never changes it. Baseline read only from `deploy/release-governance/ai-settings-flag-baseline.json` in the approved checkout (currently `OFF`: #260 OPEN/DRAFT, R4B privacy HOLD; last operator receipt AI flags OFF). Environment cannot override it. Missing/invalid baseline file → HOLD; live value ≠ baseline → `LOCAL_PROCESSING_BASELINE_GATE=DRIFT` HOLD. Changing the baseline requires a reviewed commit citing the separate #260 GO. |

  `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` must list the admin(s); `NEWSFLUX_AI_ALLOWED_WEB_ORIGINS` HTTPS only.
  Reader: `NEWSFLUX_PILOT_TRUSTED_PROXY_IP` = the NPM container IP (unchanged).

- **Source of truth:** before the first admin save, key = bootstrap file and policy = `NEWSFLUX_AI_MODEL_POLICY_JSON`
  or, if absent, the legacy S5/Mistral env definitions (unchanged behaviour). **After the first save** the
  managed record is the only authority for key **and** policy: an absent env policy is stored as an explicit
  empty allowlist (R3 P1 fix); env policy and legacy definitions are ignored; corruption or a missing record
  with `activated` present fails closed (no model available). Models are then approved in the admin UI.

## 5. Read-only preflight (operator; writes nothing; fail-closed)

```bash
sudo bash deploy/release-governance/ai-settings-readonly-preflight.sh
```

Run from a clean checkout of the approved SHA: the flag baseline and the target Caddyfile are read from that
checkout. A copied lone script has no baseline and returns HOLD. Docker is used only read-only (`ps`,
`inspect`, `image inspect`, `network ls`, `exec` of `stat`, `sha256sum` and one backend origin check). The
output prints only classifications, counts, identifiers and non-secret hashes. Exit `0` = `PREFLIGHT=PASS`,
exit `3` = `PREFLIGHT=HOLD` with `HOLD_COUNT=n`.

| Gate                                               | PASS only when                                                                                                                                                                                                                            | HOLD on                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Docker                                             | daemon answers                                                                                                                                                                                                                            | `DOCKER=UNAVAILABLE`                                                                                          |
| Summary container                                  | exactly one, inspectable                                                                                                                                                                                                                  | `NOT_UNIQUE`, `INSPECT_FAILED`                                                                                |
| `SUMMARY_HEALTH`                                   | `healthy`                                                                                                                                                                                                                                 | `unhealthy`, `starting`, `none`, `UNKNOWN`                                                                    |
| `SUMMARY_USER`                                     | `UID10001`                                                                                                                                                                                                                                | `NOT_10001`                                                                                                   |
| `SUMMARY_PUBLISHED_PORTS(_GATE)`                   | `0` in both `HostConfig.PortBindings` and runtime `NetworkSettings.Ports`                                                                                                                                                                 | any host binding                                                                                              |
| `SUMMARY_NETWORK_MODE`                             | `NOT_HOST`                                                                                                                                                                                                                                | `HOST`, `UNKNOWN`                                                                                             |
| `DATA_MOUNT` / `DATA_MOUNT_RW`                     | `bind` or `volume`, `RW`                                                                                                                                                                                                                  | `ABSENT`, `TYPE_NOT_ALLOWED`, `RO`                                                                            |
| `DATA_OWNER` / `DATA_TYPE` / `DATA_WORLD_WRITABLE` | `UID10001`, `DIRECTORY` (not a symlink), `NO`                                                                                                                                                                                             | `NOT_10001`, `NOT_DIRECTORY`, `YES`                                                                           |
| `DATA_WRITABLE_BY_UID10001`                        | `PROVEN_BY_METADATA` (owner 10001 + owner rwx + RW mount; no test write)                                                                                                                                                                  | `UNVERIFIED` (incl. `DATA_STAT=UNVERIFIED/MALFORMED`)                                                         |
| `MANAGED_SETTINGS_DIR`                             | `ABSENT` or `PRESENT_PRIVATE` (10001, 0700, directory)                                                                                                                                                                                    | `PRESENT_UNSAFE`                                                                                              |
| `ADMIN_ALLOWLIST`                                  | `CONFIGURED_COUNT_n` (decimal IDs, no empty entry)                                                                                                                                                                                        | `EMPTY`, `INVALID`                                                                                            |
| `ALLOWED_ORIGINS`                                  | `VALID_COUNT_n`: every entry `https://host[:port]`, valid hostname/IP, no credentials, path, query, fragment, wildcard or empty entry                                                                                                     | `EMPTY`, `INVALID` (one bad entry invalidates all)                                                            |
| `ALLOWED_ORIGINS_BACKEND`                          | `VALID` (the running Summary's own `canonicalize_web_origin`)                                                                                                                                                                             | `INVALID`, `UNVERIFIED`                                                                                       |
| `BOOTSTRAP_KEY_FILE_CONFIGURED`                    | `YES` (existing key preserved; value never read)                                                                                                                                                                                          | `NO`                                                                                                          |
| Flags                                              | section 4 contract                                                                                                                                                                                                                        | `ON`, `MALFORMED`, `DRIFT`, baseline `UNAVAILABLE`                                                            |
| `READER_CONTAINER` / `TRUSTED_PROXY_IP`            | `PRESENT` / `CONFIGURED` (valid unicast IP)                                                                                                                                                                                               | `INSPECT_FAILED` / `ABSENT`, `INVALID`                                                                        |
| `CADDYFILE_MOUNT` / `CADDY_CONTAINER_READBACK`     | `REGULAR_FILE` / `MATCH`                                                                                                                                                                                                                  | `ABSENT`, `SYMLINK`, `NOT_REGULAR_FILE` / `MISMATCH`                                                          |
| `CADDY_STATE`                                      | `STAGE1_ACCEPTED_PRIOR`, `PRE_STAGE1_ACCEPTED_PRIOR`, or `TARGET_ALREADY_APPLIED` (hash of the checkout's own Caddyfile; no env override)                                                                                                 | `UNKNOWN_DRIFT`                                                                                               |
| `PROTECTED_<name>` (miniflux, miniflux-db)         | `RUNNING <image>`                                                                                                                                                                                                                         | `ABSENT`, `NOT_RUNNING`                                                                                       |
| WallHop (no-touch)                                 | not a release dependency: `WALLHOP_RESOURCES=n` and `WALLHOP_INVENTORY_SHA256` are recorded; with `NEWSFLUX_WALLHOP_EXPECTED_SHA256` from an earlier run: `WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY`, `WALLHOP_UNAUTHORIZED_MUTATIONS=0` | `CHANGED_SINCE_PRIOR_INVENTORY` (`…MUTATIONS=DETECTED`), `EXPECTED_DIGEST_MALFORMED`, inventory `UNAVAILABLE` |

Without an earlier digest the result is `WALLHOP_INTEGRITY=UNVERIFIED_NO_BASELINE`. That is not a HOLD, because
existing legitimate WallHop resources are allowed, but integrity is **not** claimed. Keep the digest from the
pre-install run and pass it to the post-promotion run. Record `ENV_MODEL_POLICY` (PRESENT or ABSENT_LEGACY):
with ABSENT_LEGACY, the first admin save replaces the legacy S5/Mistral catalog with an empty allowlist until
models are approved. **Any HOLD stops the release.** Then, after `prepare`:

```bash
export APPROVED_SHA=<merged main SHA>
sudo -E bash deploy/release-governance/ai-functional-release.sh prepare
sudo -E bash deploy/release-governance/ai-functional-release.sh preflight
sudo python3 deploy/release-governance/release.py inspect --project newsflux
```

(`prepare` creates only `$RELEASE_ROOT/ai-functional-<sha12>/source`; `preflight` and `inspect` are read-only.)

## 6. Promotion (only after merge authorization and a separate production GO)

One subcommand at a time; never `all`, never `docker compose up`, `latest`, fork sync or upstream merge.
Summary and Reader promotions go through `release.py` (exact image ID, drift checks, host lock, readiness,
automatic rollback); the Caddyfile transition is the governed `update-caddy` (#265).

```bash
sudo -E bash deploy/release-governance/ai-functional-release.sh build
sudo -E bash deploy/release-governance/ai-functional-release.sh promote-summary
sudo -E bash deploy/release-governance/ai-functional-release.sh update-caddy
sudo -E bash deploy/release-governance/ai-functional-release.sh promote-reader
sudo -E bash deploy/release-governance/ai-functional-release.sh smoke
```

`update-caddy` contract: host release lock; mount source must be a regular file; live hash must be in the
closed list (`6970ee…`, `56d434b…`) or already the target; container readback must match; new file validated
with the running Reader image (`--network none`) before any write; exact backup in `$RELEASE_DIR/caddy` (0700,
0600); in-place rewrite (same inode); `caddy reload` inside the Reader only; failed write or reload restores
the exact prior bytes; success requires inode, hash and in-container readback. Expected output
`CADDY_FROM_SHA256=56d434b…`, `ACTIVE_CADDY_SHA256=<#264 Caddyfile sha>`, `CADDY_UPDATE=PASS`.

## 7. Post-promotion functional checks (writes still disabled)

1. `smoke` PASS; receipt shows both revisions = `APPROVED_SHA`, `INFERENCE_ENABLED=false`, target Caddy hash.
2. Re-run `ai-settings-readonly-preflight.sh` from the same checkout with
   `NEWSFLUX_WALLHOP_EXPECTED_SHA256=<pre-install digest>`: `CADDY_STATE=TARGET_ALREADY_APPLIED`,
   `WALLHOP_UNAUTHORIZED_MUTATIONS=0`, canary flags still `OFF`, local flag still equal to baseline, `PREFLIGHT=PASS`.
   (This script gates the writes-disabled canary only. After the separate writes GO it reports
   `ADMIN_CONFIG_WRITES_ENABLED=ON` → HOLD by design; from then on use the in-container check in item 3.)
3. In-container: `docker exec -u 10001 <summary> python3 -B -m services.article_intel_summary.operator_preflight_ai_settings`
   → `PREFLIGHT=PASS`, `KEY_SOURCE=BOOTSTRAP`, `WRITES_PERFORMED=NO`; with `--check-gateway` (GET-only discovery,
   no inference) → `GATEWAY_DISCOVERY=PASS_MODELS_n`.
4. Browser, admin: Settings → Reading → Article intelligence shows "LiteLLM integration", status
   **Connected**, "Server-provisioned key", empty masked field, "Changes are disabled on the server".
   Non-admin: section absent; `POST /api/ai/v1/admin/litellm/save-key` → 403.
5. Edge: `POST …/status`, `GET …/save-key`, unknown actions → 403 at the Reader.

**Separate GO — enable admin writes:** `release.py plan … --extra-override` with
`NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED=true` for the Summary service only, promote, then: test and save the
**existing** NewsFlux key (no rotation, no new key); preflight shows `KEY_SOURCE=MANAGED`; approve the intended
local model; user catalog lists it as **Disabled** while inference flags stay OFF. Article processing remains
blocked by PR #260 / R4B privacy HOLD and the inference flags.

## 8. Rollback (each idempotent, reverse order, same `APPROVED_SHA`)

```bash
sudo -E bash deploy/release-governance/ai-functional-release.sh rollback-reader
sudo -E bash deploy/release-governance/ai-functional-release.sh rollback-caddy
sudo -E bash deploy/release-governance/ai-functional-release.sh rollback-summary
```

`rollback-caddy` restores the exact backup only if the live file is exactly what this release installed
(`DRIFT_SINCE_RELEASE` otherwise, file untouched), verifies the backup hash first, reloads and reads back;
a repeated run reports `ALREADY_RESTORED`. Summary/Reader rollback restores image ID, Compose config hash
and file sequence (release.py manifests).

**Managed configuration** (operator, supervised, inside the Summary container as UID 10001):

```bash
docker exec -u 10001 <summary> python3 -B -m services.article_intel_summary.operator_restore_ai_settings --expected-revision <CURRENT_32_HEX> --confirm RESTORE_PREVIOUS_NEWSFLUX_AI_CONFIG
```

Restores the previous record under a new revision; a restored bootstrap snapshot keeps the managed authority
(empty allowlist, never legacy). To return entirely to bootstrap (operator decision): with writes disabled,
move `/data/newsflux-ai-settings` aside (keep it 0700; never print it). Container rollback does not delete the
managed store; an older image ignores it.

## 9. Evidence and success criteria (synthetic; see PR comments for run links)

- Backend 257 tests (incl. P1 policy-null RED→GREEN, red-team API matrix), auth 30, content-fallback 151,
  release governance 95 (incl. Caddy transition 18, RED 14/18 on the old script → GREEN; crash-loop forensics 3, RED → GREEN; **R4 fail-closed read-only preflight 37**, RED on the R3 script → GREEN).
- Frontend 703 + 316, ESLint/Prettier/knip clean, production build; Playwright admin harness 23 (real
  Summary app + real store + real `gateway_getter`, synthetic LiteLLM/Miniflux transports), pilot 7,
  `reader-ai-e2e` 19 (4 skipped: need content-fallback env).
- Docker rehearsal (`Summary release isolated rehearsal`, real Docker in GitHub Actions) on the combined tree:
  operator script, R12F-09, S5 key gate, **Stage 1 upgrade with real Stage 1 → admin-route Caddy transition**,
  scoped promotion.

## 10. HOLD conditions

Any `PREFLIGHT=HOLD` from section 5, including:

- unsafe or malformed flag;
- local flag drift or unavailable baseline;
- Summary not healthy, not UID 10001, published port, host network;
- `/data` absent, RO, wrong type, owner, mode or kind, or unverifiable;
- invalid or empty origins or admin allowlist;
- Caddyfile unknown state or symlink;
- protected service absent or down;
- WallHop changed since the recorded inventory;
- Docker unavailable.

Also a HOLD:

- any red CI on the merged main SHA;
- protected service identity change between runs;
- a receipt without both revisions on `APPROVED_SHA`.

## 11. Residual risks

- Home Server facts (`PENDING_OPERATOR_GATE`): live Caddy hash, mount type, `/data` owner and mode, Summary
  health and port bindings, admin allowlist, origins, trusted proxy IP, env policy presence, local-processing
  flag value versus the reviewed baseline.
- WallHop integrity is `UNVERIFIED_NO_BASELINE` on the first run by design. It becomes verifiable only by
  comparing two runs (before/after promotion). The release never touches WallHop. The package is **conditionally ready**: a value outside the
  documented expectations is a HOLD, not a guess.
- Real devices (phone, tablet, Fold 884×1104) not tested; emulated viewports only.
- `previous.json` keeps one prior key (0600) in the `/data` volume; volume backups must be protected.
- The admin browser session inherits the app's existing Miniflux API-key model.
- PR #260 contract: approving a local model sets `transfer_authorized=true`; with #260's local-only consent the
  local path must be re-reviewed when #260 is merged.
- Pre-existing, out of scope: `%{rpm}` literal in the user catalog when a model has no RPM limit.

## 12. CI evidence (GitHub Actions, exact SHAs)

| Head                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined tree `3df26f1` (main + #263 ⊃ #262 + #264 + #265) | **all green**: `Summary release isolated rehearsal` [run 44305867740](https://github.com/jfsdias/NewsFlux/actions/runs/44305867740): governance unit tests 95, Docker release tests 15, operator 21/21, R12F09 18/18, S5 key gate 17/17, **Stage 1 upgrade 44/44 with the real #264 admin-route Caddyfile** (`KIND=b-changes-caddy`). Pilot image + exact-source Compose gate [44305874170](https://github.com/jfsdias/NewsFlux/actions/runs/44305874170), E2E [44305880823](https://github.com/jfsdias/NewsFlux/actions/runs/44305880823), fallback [44305886169](https://github.com/jfsdias/NewsFlux/actions/runs/44305886169) |
| #265 `805e6d1`                                             | **all green** (15 checks), including `synthetic-release` [run 44305846833](https://github.com/jfsdias/NewsFlux/actions/runs/44305846833): governance 95, Stage 1 upgrade 44/44 (synthetic comment-only transition)                                                                                                                                                                                                                                                                                                                                                                                                               |
| #262 `683d60c`                                             | all green (unchanged since R3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #263 `8b7960d`                                             | AI settings gates green; exact-source Compose gate **structural** while stacked (`base == live main`), green on the combined tree; re-run after retarget                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| #264 `2641010`                                             | route contract, quality, pilot, E2E green; `synthetic-release` red until #265 is on `main` (old script), green on the combined tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The five gates that failed in R2 remain covered and PASS in both rehearsals: `CADDY_PREFLIGHT_ACCEPTS_STAGE1`,
`UNCHANGED_CADDY_RELEASE_IS_NOOP`, `UNCHANGED_CADDY_ROLLBACK_NOOP_VERIFIED`, `ROLLBACK_IDEMPOTENT`,
`CADDY_DRIFT_DETECTED`. Rollback gates (`CADDY_ROLLBACK_TO_STAGE1`, `ROLLBACK_IDEMPOTENT`,
`INFERENCE_FLAG_PRESERVED_AFTER_ROLLBACK`) and on the combined tree `ADMIN_ROUTES_METHODS_AND_CATCHALL_403`
also PASS. R4 did not change any Caddy route or functional code.

Preflight TDD evidence (local, Python 3.12 and 3.13):

- RED: the unchanged R3 script under its own R3 test fake returned `PREFLIGHT=PASS`, exit 0, with
  `INFERENCE_ENABLED=ON`, `ADMIN_CONFIG_WRITES_ENABLED=ON`, `ALLOW_EXTERNAL_ARTICLE_TRANSFER=ON`,
  `ALLOW_PAID_INFERENCE=ON` and an HTTPS+HTTP origin list. The new 37-test matrix fails 67 assertions on the R3
  script.
- GREEN: 37/37 on `805e6d1`. Every case also asserts:
  - no file is created or modified and the Caddyfile is untouched;
  - only read-only Docker calls were made;
  - no secret, URL, IP or host path appears in the output;
  - exit code 3 whenever the result is HOLD.

## 13. Verdict

`INSTALL_READY=CONDITIONAL`; `MERGE_READY=YES_PENDING_OWNER_GO` in the order of section 2.

- No open code, release-tooling or preflight blocker.
- The read-only preflight now fails closed on every gate in section 5.
- Remaining before production:
  1. authorized merges in the order of section 2, with the two post-merge CI re-runs (#263 exact-source gate
     after retarget; #264 rehearsal after #265 is on main);
  2. `PENDING_OPERATOR_GATE`: the read-only OMV preflight with `PREFLIGHT=PASS`;
  3. a separate production GO.
- Real-device checks follow promotion. `DEPLOY_READY` is **not** declared.

## 14. Operations requiring a separate GO

Each merge (#265, #262, #263, #264, #261); OMV read-only preflight execution; build and promotion; enabling
admin writes; saving the existing key through the UI; any model approval in production; any inference flag;
real-device test sessions; merging the central ledger branch.

```ini
FEATURE=NEWSFLUX_AI_SETTINGS_01
INSTALL_PACKAGE=R4
MERGE=NO
DEPLOY=NO
KEY_ROTATED=NO
REAL_CREDENTIAL_CHANGED=NO
PRODUCTION_MUTATIONS=0
INSTALL_READY=CONDITIONAL
```
