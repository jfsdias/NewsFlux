# NEWSFLUX-AI-SETTINGS-01 — installation package R2 (supersedes R1 for SHAs and gates)

**Date:** 2026-11-17, America/Bahia. **State:** code complete in feature PRs, validated in an isolated
combined tree; **not merged, not deployed**. This document is a controlled procedure, **not a GO**.
No real LiteLLM key, real article, Miniflux write or production host was used.

## 1. Exact source

| Track                                                                       | PR                                                   | Branch                                      | HEAD                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Base                                                                        | —                                                    | `main`                                      | `d54eda2bdb8bc5c3d1bd58d40236f48da762e852` |
| Backend (API, store, policy, preflight, restore)                            | [#262](https://github.com/jfsdias/NewsFlux/pull/262) | `codex/newsflux-ai-settings-backend-r1`     | `7b14929958c4401a86caa59794478c3da13dcaf3` |
| UI (stacked on #262, merged forward, diff vs #262 is frontend/harness only) | [#263](https://github.com/jfsdias/NewsFlux/pull/263) | `codex/newsflux-ai-settings-ui-r2`          | `d1ae23cbd0c32b958cec7b9fec179638df84a059` |
| Caddy route                                                                 | [#264](https://github.com/jfsdias/NewsFlux/pull/264) | `codex/newsflux-ai-settings-caddy-route-r1` | `2641010b78839150b4c227f9939d7e373462f971` |
| Test-only combined tree (never merge)                                       | —                                                    | `claude/intelligent-edison-5053ez`          | `dfb44a4a03c2fb5b166c7f4de0bff1e53bd92bf2` |

PR #260 (local Ollama privacy) is **not** in any of these trees and stays independent / HOLD.
The R1 branch `integration/newsflux-ai-settings-01-r1-validated-candidate` (`f66567e`) is **stale**: it was
built from an older backend snapshot and does not contain the R2 fixes. Do not use it.

**Images must be built from the merged `main` SHA**, never from a PR head or the integration branch.

## 2. What R2 changed (audit result)

Backend (#262):

- First-activation partial write no longer bricks the store: if `settings.json` fails after the
  `activated` marker is written, the marker is withdrawn and the bootstrap key stays authoritative.
- Next record is validated **before** it is written; decimal parse errors map to `POLICY_INVALID` (422),
  not 503.
- Concurrent first save: `mkdir` race returned `CONFIG_UNAVAILABLE` (reproduced 1/60); fixed, 0/150.
- Admin inventory exposes `price_class` (`free|paid|unknown`) only, never amounts.
- New read-only `operator_preflight_ai_settings` (classifications only, no writes, no secrets).
- New tests: activation rollback, CAS race, symlinked root/file, world-readable record, plain HTTP,
  oversized body, error-body leak, runtime catalog approval/revocation, env-policy precedence,
  corruption fail-closed, preflight.

UI (#263): four connection states (`Connected` only after authenticated discovery; `Not configured`,
`Validation failed`, `Status not verified`), price class, paid consent only for paid models, unpriced
external models cannot be approved, code-specific errors, credential cleared after every test failure
and every save attempt, admin 5xx shown as failure instead of silently hidden. 6 locales.
Real-backend Playwright harness (`scripts/pilot-e2e/ai-settings-admin.spec.js`) + CI job.

Caddy (#264): exact action allowlist with per-action method (GET status/models/policy; POST
test-key/save-key/save-policy/approve-model/remove-model; OPTIONS on those only). Unknown actions,
suffixes and wrong methods get 403 at the edge.

## 3. Canonical configuration and precedence (single source of truth)

- **Before first admin save:** key = `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE` (existing 0600 mount);
  policy = `NEWSFLUX_AI_MODEL_POLICY_JSON`. Nothing is written.
- **After first admin save:** `/data/newsflux-ai-settings/settings.json` (UID 10001, 0600, dir 0700) is the
  only authority for **both** key and model policy. The env policy is copied once at activation and is
  **ignored afterwards** (tested). Editing the env policy later has no effect; use the admin UI.
- `activated` marker: if the record disappears or is corrupt, the catalog fails closed (no model
  available) and never reverts to the bootstrap key.
- Consent flags remain env-only and independent: `NEWSFLUX_AI_INFERENCE_ENABLED`,
  `NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING` (PR #260), `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER`,
  `NEWSFLUX_AI_ALLOW_PAID_INFERENCE`. Model approval never turns any of them on.

## 4. Required production configuration (Summary service only)

| Variable                                                                                 | Initial install value                                                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED`                                                | `false` for the first canary; `true` only with a separate operator GO                                             |
| `NEWSFLUX_AI_ADMIN_SETTINGS_DIR`                                                         | unset (default `/data/newsflux-ai-settings`)                                                                      |
| `NEWSFLUX_AI_INFERENCE_ENABLED` / `..._EXTERNAL_ARTICLE_TRANSFER` / `..._PAID_INFERENCE` | unchanged (`false`)                                                                                               |
| Auth admin allowlist                                                                     | Miniflux admin user ID(s) present and `configured`                                                                |
| `/data` volume                                                                           | owned by UID 10001, writable                                                                                      |
| Reader                                                                                   | built with `VITE_ARTICLE_INTELLIGENCE_ENABLED=1`; Caddy route from #264 in the **actually deployed** Caddy config |

## 5. Preflight (read-only)

```bash
sudo python3 deploy/release-governance/release.py inspect --project newsflux
```

```bash
docker exec -u 10001 <summary-container> python3 -B -m services.article_intel_summary.operator_preflight_ai_settings
```

```bash
docker exec -u 10001 <summary-container> python3 -B -m services.article_intel_summary.operator_preflight_ai_settings --check-gateway
```

Expected `PREFLIGHT=PASS`, `BOOTSTRAP_KEY_READABLE=YES`, `MANAGED_DIR=ABSENT_CREATABLE|PRESENT_PRIVATE`,
`SECRET_PRINTED=NO`, `WRITES_PERFORMED=NO`. `--check-gateway` performs GET-only discovery with the current
key (no inference). Any `HOLD` stops the release. The module only exists in images built from a SHA that
contains #262; on the current production image, run it after the candidate image is created.

Also confirm read-only, without printing contents: effective Compose file order, the Caddy file mounted in
the running Reader (it must contain `@pilotAiAdminRead/Write/Preflight`), NPM forwarding for the Reader
host, and that hosts 37/111, PR188, Miniflux and LiteLLM are not part of the change set.

## 6. Promotion (only after merge authorization and GO)

Order: merge #262 → retarget #263 to `main` and merge → merge #264 (independent). Then build both
images from the **same merged main SHA** and use only governed release:

```bash
sudo python3 deploy/release-governance/release.py plan --project newsflux --service summary-api --candidate-image sha256:<SUMMARY_IMAGE_ID> --approved-sha <MERGED_MAIN_SHA> --protected <CONFIRMED_PROTECTED_CONTAINER> --release-dir /dockerdata/compose/newsflux/.releases/<RELEASE_ID>
```

```bash
sudo python3 deploy/release-governance/release.py promote --manifest <HASHED_MANIFEST_PATH>
```

Repeat for the Reader (`--service newsflux`, `--ready-probe` if required). Never `docker compose up -d`,
`latest`, `ai-functional-release.sh all`, fork sync or upstream merge.

## 7. Readback after canary

Admin: status shows `Connected` + `Server-provisioned key`, empty masked field. Non-admin: section
absent and API 403. With writes still disabled, `Test connection`/`Save key` are disabled with the
"Changes are disabled" notice. After a separate GO enabling writes: re-save the **existing** NewsFlux key
(no rotation), approve the local model, confirm the user catalog lists it but inference stays OFF, run the
preflight again (`KEY_SOURCE=MANAGED`). Confirm no key in browser storage, logs or responses.

## 8. Rollback

- **Container:** `sudo python3 deploy/release-governance/release.py rollback --manifest <HASHED_MANIFEST_PATH>`
  for the promoted service; verify previous image ID and config hash.
- **Managed record (operator, supervised, inside the Summary container as UID 10001):**

```bash
docker exec -u 10001 <summary-container> python3 -B -m services.article_intel_summary.operator_restore_ai_settings --expected-revision <CURRENT_32_HEX> --confirm RESTORE_PREVIOUS_NEWSFLUX_AI_CONFIG
```

The current revision is shown by the admin status API. The previous record is restored under a new
revision. Rolling back the container does **not** remove `/data/newsflux-ai-settings`; an older image
ignores it.

- **Return to bootstrap entirely (operator decision):** with the Summary stopped or writes disabled, move
  the whole `/data/newsflux-ai-settings` directory aside (do not delete it; keep it 0700). The bootstrap
  key file and env policy become authoritative again. This is also the recovery for the
  "marker present, record missing" state reported by the preflight as `STORE=HOLD_CONFIG_UNAVAILABLE`.

## 9. Residual risks

- Production Caddy/NPM paths, `/data` ownership and admin allowlist are `PENDING_OPERATOR_GATE` (no OMV access).
- Real-device gate (phone, tablet, Fold 884×1104) not executed; only Playwright viewport emulation.
- `previous.json` keeps one prior key on the server (0600) for supervised restore; it is in the `/data`
  volume and thus in any volume backup — protect backups accordingly.
- The admin browser session uses the existing Miniflux API key model (stored by the existing app login);
  this feature adds no new browser secret but inherits that model.
- The pilot image workflow's "Exact-source Docker Compose pilot gate" fails by design on #263 while it is
  stacked (base ≠ main); it is validated on the integration tree via `workflow_dispatch` and must pass on
  #263 again after retargeting to `main`.
- Pre-existing, out of scope: user catalog shows a literal `%{rpm}` when a discovered model has no RPM limit.
- PR #260 not reconciled: approving a local model sets `transfer_authorized=true` in the policy; with
  #260's local-only consent the local path must be re-reviewed when #260 is merged.

```ini
FEATURE=NEWSFLUX_AI_SETTINGS_01
INSTALL_PACKAGE=R2
MERGE=NO
DEPLOY=NO
KEY_ROTATED=NO
REAL_CREDENTIAL_CHANGED=NO
PRODUCTION_MUTATIONS=0
```
