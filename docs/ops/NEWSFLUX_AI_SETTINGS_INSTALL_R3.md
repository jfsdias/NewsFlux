# NEWSFLUX-AI-SETTINGS-01 — installation package R3 (supersedes R2; R1/R2 kept as history)

**Date:** 2026-11-18, America/Bahia. **State:** code, release tooling and synthetic gates complete in feature
PRs; **not merged, not deployed**. This document is a controlled procedure, **not a GO**. No real LiteLLM key,
real article, Miniflux write, Home Server access or production change was used to produce it.

## 1. Exact source

| Track                                                                 | PR                                                   | Branch                                               | HEAD                                       | Base           |
| --------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ | -------------- |
| main                                                                  | —                                                    | `main`                                               | `d54eda2bdb8bc5c3d1bd58d40236f48da762e852` | —              |
| Backend: admin API, managed store, policy, preflight, restore         | [#262](https://github.com/jfsdias/NewsFlux/pull/262) | `codex/newsflux-ai-settings-backend-r1`              | `683d60cf791046060ce0b3405ef77fd0ef5b28f7` | main           |
| UI: admin section, selectors, 6 locales, harness                      | [#263](https://github.com/jfsdias/NewsFlux/pull/263) | `codex/newsflux-ai-settings-ui-r2`                   | `8b7960d6e49b91d29f0666a0834b6c238a11d8ec` | #262 (stacked) |
| Caddy admin route contract                                            | [#264](https://github.com/jfsdias/NewsFlux/pull/264) | `codex/newsflux-ai-settings-caddy-route-r1`          | `2641010b78839150b4c227f9939d7e373462f971` | main           |
| Release governance: Stage 1 → new Caddyfile transition, OMV preflight | [#265](https://github.com/jfsdias/NewsFlux/pull/265) | `codex/newsflux-ai-settings-stage1-caddy-release-r1` | `e54df537078784653a0733ac905b90263ea34a74` | main           |
| Spec and install docs                                                 | [#261](https://github.com/jfsdias/NewsFlux/pull/261) | `codex/newsflux-ai-settings-01-spec-r1`              | this branch                                | main           |
| Test-only combined tree (**never merge**)                             | —                                                    | `claude/intelligent-edison-5053ez`                   | `1ccc7a2ce673a2886be04fde79887ebdb14bda94` | main           |

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
- #265: `deploy/release-governance/{ai-functional-release.sh,release.py,rehearse-stage1-upgrade.sh,ai-settings-readonly-preflight.sh,test_caddy_transition.py,test_readonly_preflight.py,test_release_failure_io.py}`, `.github/workflows/summary-release-rehearsal.yaml` (adds `workflow_dispatch`), `docs/ops/ARTICLE_INTELLIGENCE_PROMOTION.md`.

## 4. Images, volumes, permissions, configuration

- **Images:** `newsflux-summary:<APPROVED_SHA>` (`services/article_intel_summary/Dockerfile`, user `10001:10001`)
  and `newsflux-reader:<APPROVED_SHA>` (root `Dockerfile`, `VITE_ARTICLE_INTELLIGENCE_ENABLED=1`), both with
  `org.opencontainers.image.revision=<APPROVED_SHA>`, built by `ai-functional-release.sh build` (includes the
  isolated candidate start gate).
- **Volumes:** Summary `/data` persistent, owned by UID 10001, writable; the managed store is created on the
  first authorized save at `/data/newsflux-ai-settings` (0700; `settings.json`, `previous.json`, `activated`,
  `write.lock` 0600). Bootstrap key stays the existing read-only 0600 file `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE`.
  Reader `/etc/caddy/Caddyfile` stays a single-file bind mount (regular file, not a symlink).
- **Initial flags (Summary):** `NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED=false` (first canary),
  `NEWSFLUX_AI_INFERENCE_ENABLED=false`, `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false`,
  `NEWSFLUX_AI_ALLOW_PAID_INFERENCE=false`, `NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING` unchanged (PR #260 scope).
  `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` must list the admin(s); `NEWSFLUX_AI_ALLOWED_WEB_ORIGINS` HTTPS only.
  Reader: `NEWSFLUX_PILOT_TRUSTED_PROXY_IP` = the NPM container IP (unchanged).
- **Source of truth:** before the first admin save, key = bootstrap file and policy = `NEWSFLUX_AI_MODEL_POLICY_JSON`
  or, if absent, the legacy S5/Mistral env definitions (unchanged behaviour). **After the first save** the
  managed record is the only authority for key **and** policy: an absent env policy is stored as an explicit
  empty allowlist (R3 P1 fix); env policy and legacy definitions are ignored; corruption or a missing record
  with `activated` present fails closed (no model available). Models are then approved in the admin UI.

## 5. Read-only preflight (operator; writes nothing)

```bash
sudo bash deploy/release-governance/ai-settings-readonly-preflight.sh
```

Run from a checkout of the approved SHA (or copy that single file). Expected: `PREFLIGHT=PASS`, `CADDY_STATE`
`STAGE1_ACCEPTED_PRIOR` (or `PRE_STAGE1_ACCEPTED_PRIOR`), `CADDY_CONTAINER_READBACK=MATCH`,
`SUMMARY_USER=UID10001`, `DATA_OWNER=UID10001`, `ADMIN_ALLOWLIST=CONFIGURED`, `ALLOWED_ORIGINS=HTTPS_COUNT_n`,
`TRUSTED_PROXY_IP=CONFIGURED`, every flag `OFF`, protected services `RUNNING`, `WALLHOP_RESOURCES=0`,
`SECRET_PRINTED=NO`, `WRITES_PERFORMED=NO`. Record `ENV_MODEL_POLICY` (PRESENT or ABSENT_LEGACY): with
ABSENT_LEGACY, the first admin save replaces the legacy S5/Mistral catalog with an empty allowlist until models
are approved. **Any `HOLD` stops the release.** Then, after `prepare`:

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
2. Re-run `ai-settings-readonly-preflight.sh` with `NEWSFLUX_TARGET_CADDY_SHA=<target>`:
   `CADDY_STATE=TARGET_ALREADY_APPLIED`, `PREFLIGHT=PASS`.
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
  release governance 64 (incl. new: Caddy transition 18, RED 14/18 on the old script → GREEN; read-only preflight 6; crash-loop forensics 3, RED → GREEN).
- Frontend 703 + 316, ESLint/Prettier/knip clean, production build; Playwright admin harness 23 (real
  Summary app + real store + real `gateway_getter`, synthetic LiteLLM/Miniflux transports), pilot 7,
  `reader-ai-e2e` 19 (4 skipped: need content-fallback env).
- Docker rehearsal (`Summary release isolated rehearsal`, real Docker in GitHub Actions) on the combined tree:
  operator script, R12F-09, S5 key gate, **Stage 1 upgrade with real Stage 1 → admin-route Caddy transition**,
  scoped promotion.

## 10. HOLD conditions

Any preflight `HOLD`; live Caddy hash outside the closed list; `/data` not UID 10001; admin allowlist empty;
any red CI on the merged main SHA; protected service identity change; inference or external/paid flag
not OFF; a receipt without both revisions on `APPROVED_SHA`.

## 11. Residual risks

- Home Server facts (`PENDING_OPERATOR_GATE`): live Caddy hash, mount type, `/data` owner, admin allowlist,
  trusted proxy IP, env policy presence. The package is **conditionally ready**: a value outside the
  documented expectations is a HOLD, not a guess.
- Real devices (phone, tablet, Fold 884×1104) not tested; emulated viewports only.
- `previous.json` keeps one prior key (0600) in the `/data` volume; volume backups must be protected.
- The admin browser session inherits the app's existing Miniflux API-key model.
- PR #260 contract: approving a local model sets `transfer_authorized=true`; with #260's local-only consent the
  local path must be re-reviewed when #260 is merged.
- Pre-existing, out of scope: `%{rpm}` literal in the user catalog when a model has no RPM limit.

## 12. CI evidence (GitHub Actions, exact SHAs)

| Head                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined tree `1ccc7a2` | **all green**: `Summary release isolated rehearsal` [run 44215688823](https://github.com/jfsdias/NewsFlux/actions/runs/44215688823) (operator 21/21, R12F09 18/18, S5 key gate 17/17, **Stage 1 upgrade 44/44 with the real #264 admin-route Caddyfile**), pilot image + exact-source Compose gate [44215693245](https://github.com/jfsdias/NewsFlux/actions/runs/44215693245), E2E [44215697525](https://github.com/jfsdias/NewsFlux/actions/runs/44215697525), fallback [44215702359](https://github.com/jfsdias/NewsFlux/actions/runs/44215702359) |
| #265 `e54df53`          | all green incl. `synthetic-release` [44215667055](https://github.com/jfsdias/NewsFlux/actions/runs/44215667055) (synthetic comment-only transition on main)                                                                                                                                                                                                                                                                                                                                                                                           |
| #262 `683d60c`          | all green (Python, quality, linter, pilot image, exact-source Compose gate, E2E, fallback)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| #263 `8b7960d`          | AI settings gates green (backend, frontend, admin-harness [44212058290](https://github.com/jfsdias/NewsFlux/actions/runs/44212058290)); **exact-source Compose gate fails by design while stacked** (`base == live main`); passes on the combined tree; re-run after retarget                                                                                                                                                                                                                                                                         |
| #264 `2641010`          | route contract, quality, pilot, E2E green; `synthetic-release` stays red **until #265 is on main** (old script), then green as shown on the combined tree                                                                                                                                                                                                                                                                                                                                                                                             |

Gates of the Stage 1 upgrade rehearsal on the combined tree include: `CADDY_PREFLIGHT_ACCEPTS_STAGE1`,
`CADDY_PREFLIGHT_BLOCKS_DRIFT`, `CADDY_FAULT_BEFORE_WRITE_SAFE`, `CADDY_FAULT_DURING_WRITE_RESTORED`,
`CADDY_FAULT_RELOAD_RESTORED`, `CADDY_UPDATE_FROM_STAGE1`, `CADDY_TARGET_HASH_SAME_INODE`,
`CADDY_READBACK_IN_CONTAINER`, `READER_NOT_RECREATED_BY_CADDY_UPDATE`, `CADDY_BACKUP_EXACT_AND_PRIVATE`,
`CADDY_UPDATE_IDEMPOTENT`, `ADMIN_ROUTES_METHODS_AND_CATCHALL_403`, `CADDY_ROLLBACK_TO_STAGE1`,
`ROLLBACK_IDEMPOTENT`, `CADDY_DRIFT_DETECTED`, `INFERENCE_FLAG_PRESERVED_AFTER_ROLLBACK`,
`MINIFLUX_NPM_LITELLM_FALLBACK_UNCHANGED`, `NO_WALLHOP_RESOURCES` — all PASS. The five gates that failed in R2
(`UPGRADE_PREFLIGHT_ON_STAGE1`, `UPGRADE_CADDY_ALREADY_APPLIED`, `ROLLBACK_CADDY_NOOP_VERIFIED`,
`ROLLBACK_IDEMPOTENT`, `CADDY_DRIFT_DETECTED`) are covered by `CADDY_PREFLIGHT_ACCEPTS_STAGE1`,
`UNCHANGED_CADDY_RELEASE_IS_NOOP`, `UNCHANGED_CADDY_ROLLBACK_NOOP_VERIFIED`, `ROLLBACK_IDEMPOTENT` and
`CADDY_DRIFT_DETECTED`, all PASS.

Real vs simulated: Docker rehearsals use real Docker, Caddy, Compose and the real operator/release scripts with
stand-in Summary/Reader images; the Summary image start-up uses real images (R12F09). The Playwright admin
harness uses the real Summary app/store/getter with synthetic Miniflux and LiteLLM transports. No real
Miniflux, LiteLLM, key, article or Home Server.

## 13. Verdict

`INSTALL_READY=CONDITIONAL`: no open implementation or release-tooling blocker. Remaining before production:
(1) authorized merges in the order of section 2 with the two post-merge CI re-runs (#263 exact-source gate after
retarget; #264 rehearsal after #265 on main); (2) `PENDING_OPERATOR_GATE` read-only OMV preflight with every
check PASS; (3) separate production GO. Real-device checks follow promotion.

## 14. Operations requiring a separate GO

Each merge (#265, #262, #263, #264, #261); OMV read-only preflight execution; build and promotion; enabling
admin writes; saving the existing key through the UI; any model approval in production; any inference flag;
real-device test sessions; merging the central ledger branch.

```ini
FEATURE=NEWSFLUX_AI_SETTINGS_01
INSTALL_PACKAGE=R3
MERGE=NO
DEPLOY=NO
KEY_ROTATED=NO
REAL_CREDENTIAL_CHANGED=NO
PRODUCTION_MUTATIONS=0
INSTALL_READY=CONDITIONAL
```
