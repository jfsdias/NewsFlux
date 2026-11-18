# NEWSFLUX-AI-SETTINGS-01 — installation and rollback gates

**PM state:** implementation completed in isolated feature PRs; **not merged, not deployed**. No real LiteLLM credentials, articles, Miniflux writes or production traffic used during automated tests. This is a controlled installation procedure, **not authority to execute a release**.

**Date:** 2026-11-17, America/Bahia.  
**Code tracks:** [backend PR #262](https://github.com/jfsdias/NewsFlux/pull/262), [UI PR #263](https://github.com/jfsdias/NewsFlux/pull/263), [trusted Caddy route PR #264](https://github.com/jfsdias/NewsFlux/pull/264).  
**Source design:** [PR #261](https://github.com/jfsdias/NewsFlux/pull/261).  
**Exact test-only combined tree:** `integration/newsflux-ai-settings-01-r1-validated-candidate`; **never merge this integration branch**. Build release images only from a **later explicitly approved, merged main SHA**, which must have the same combined functionality and pass the final SHA gates. Do not blindly deploy the integration branch or PR head.

## Delivered behavior

- Reader Settings → Reading → Article Intelligence gains admin-only **LiteLLM integration**: existing key status (never plaintext), transient masked paste/test/save new virtual key, refresh discovered models, explicit admin approve/revoke model policy. Existing primary and optional fallback controls remain; primary search added. Six UI locales supported.
- Summary API receives authenticated admin endpoints (Miniflux identity and admin allowlist), fixed trusted HTTPS Origin/Host, body cap, no-store, safe errors, no privileged LiteLLM admin API access.
- Owner-only `/data/newsflux-ai-settings` management storage is **disabled by default**. Before first successful save the existing `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE` remains bootstrap source of truth; after first save an atomic `settings.json` owner 10001 mode 0600 under directory 0700 is canonical. An `activated` marker prevents silent fallback if the managed record vanishes; `previous.json` is an owner-only rollback snapshot. `operator_restore_ai_settings.py` requires expected current revision + explicit exact confirmation, no secrets printed. Bootstrap key read-only mount remains intact.
- Model catalog continues to be approved policy **intersection** with actually discovered LiteLLM model IDs; broad `all-proxy-models` key scope does not automatically authorize transferring article data to any external model. Local-only and external provider consent and fallback restrictions from existing policy remain separate.
- The active production Reader must route `/api/ai/v1/admin/litellm/*` only from the trusted TLS edge to Summary API; PR #264 provides a scoped Caddy contract. Root `Caddyfile` does not itself provide AI routing; inspect actual deployed Caddy config before changing it.

## Required before any installation

1. **Git/PR gate**: review PRs #262/#263/#264 independently; complete required CI and security, UX and routing checks; obtain **explicit user merge authorization**, then merge in dependency order #262 → #263 and independently #264. No upstream sync, WallHop or PR260 changes in these PRs.
2. **Runtime read-only preflight** at `/dockerdata/compose/newsflux`: exact approved main SHA; running Summary/Reader image IDs/revision labels; health, volume owner UID10001 and `/data` write ACL; source and permission of existing 0600 key file (never print key); exact effective ordered Compose files; current trusted NPM/Caddy forwarding, read-only gateway association; Miniflux admin identity in allowlist and exact permitted Origin. Print only bounded status classifications; never upload env, live Compose files, DSNs or keys.
3. **App config gate**: set `NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED=true` **only with separate explicit operator authorization**, on Summary service alone, via governed release `--extra-override`. Continue `NEWSFLUX_AI_INFERENCE_ENABLED=false` and `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false` during initial installation. Do not alter the shared LiteLLM's model/keys/routes or restart it.
4. **Reader gate**: build with `--build-arg VITE_ARTICLE_INTELLIGENCE_ENABLED=1`, exact approved SHA, Caddy restricted routes from PR264 with confirmed real deployment mount/overrides; do not change NPM hosts 37/111, PR188 fallback, Miniflux, Reader persistent content or proxy host metadata.
5. **Build/gate**: build `services/article_intel_summary/Dockerfile` and root `Dockerfile` from the same approved exact SHA; verify label `org.opencontainers.image.revision`, Summary UID10001 and Reader health Caddy readiness; perform synthetic read-only key/catalog/admin auth checks against disposable services and device/harness tests on phone/tablet/Fold 884×1104; never use real key for synthetic canary.
6. **Governed deployment only after GO**: use `deploy/release-governance/release.py inspect → plan → promote`, one service at a time, exact **image ID** + approved SHA + hashed Compose override + manifest under `/dockerdata/compose/newsflux/.releases/`. Protected identities include NPM, Miniflux/DB, PR188 and whichever Reader/Summary is not being promoted. Reader may require `--ready-probe`; `release.py` rejects undefined readiness. Never use `ai-functional-release.sh all`, `latest` implicit, `docker compose up` broadly or merge upstream.
7. **Readback after canary**: admin session can read status without plaintext, non-admin gets 403, key test GET-only LiteLLM catalog no inference, save existing NewsFlux-specific key under explicit approval, model approve/revoke readback with CAS; selected primary/fallback may change without modifying code. Confirm no browser storage secrets, no log leakage, no stealth external fallback. Recheck protected Docker metadata unchanged.
8. **Rollback**: if Summary/Reader unhealthy or external content routing unverified, `release.py rollback --manifest` for the exact promoted service and verify previous config hash and image ID. If a managed credential/policy update must be reverted, use the service-local, revision-gated `python3 -B -m services.article_intel_summary.operator_restore_ai_settings --expected-revision <current-32-hex> --confirm RESTORE_PREVIOUS_NEWSFLUX_AI_CONFIG` **as the Summary UID10001 under supervised operator GO**, then read back status. Private previous.json/activated/status may not be printed. Key-material rollback and container rollback are separate scopes.
9. **PR260 remains independent and HOLD**: enabling _real article inference_, even for local Ollama, still requires R4B effective LiteLLM routing/privacy proof, #260's own review/merge and explicit flags/GO. Installing the dark admin settings UX is **not** authorization for article processing.

## Operator-safe release commands — illustration, not a runnable deployment authorization

```bash
# Prerequisite: current approved merged main SHA and exact staging checkout
# are established from GitHub. Never reuse the historical integration test SHA.
sudo python3 deploy/release-governance/release.py inspect --project newsflux
# After preflight and separate GO, release.py PLAN requires:
# --project newsflux --service summary-api|newsflux
# --candidate-image sha256:<EXACT_IMAGE_ID>
# --approved-sha <APPROVED_MERGED_MAIN_SHA>
# --protected <CONFIRMED_PROTECTED_CONTAINER> ...
# --release-dir /dockerdata/compose/newsflux/.releases/<APPROVED_RELEASE_ID>
# --extra-override <HASHED_CONFIG_ONLY_LAYER> as justified
# --ready-probe <READER_PROBE_JSON> when required.
# Only after validated manifest+GO:
# sudo python3 deploy/release-governance/release.py promote --manifest <HASHED_MANIFEST_PATH>
# On a supervised rollback:
# sudo python3 deploy/release-governance/release.py rollback --manifest <HASHED_MANIFEST_PATH>
```

**Never guess** the current Compose stack file order, NPM host settings, private key path, published network routes, Reader route mounts or approved operator SHA. If any is unresolved, `INSTALL_GATE=HOLD`; retain currently deployed images and flags OFF.

```ini
FEATURE=NEWSFLUX_AI_SETTINGS_01
CODE_TRACKS=BACKEND_262|UI_263|ROUTE_264
INTEGRATION_CANDIDATE=TEST_ONLY_NOT_FOR_MERGE
OMV_LIVE_PREFLIGHT=NOT_EXECUTED_BY_PM
REAL_DEVICE_GATE=NOT_EXECUTED_BY_PM
KEY_SAVE=NOT_EXECUTED
MODEL_APPROVAL_PRODUCTION=NOT_EXECUTED
INFERENCE_FLAGS=OFF_LAST_OPERATOR_RECEIPT
MERGE=NO
DEPLOY=NO
```
