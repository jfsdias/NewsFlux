# NEWSFLUX-AI-SETTINGS-01 — R4.3A operator result

Date: 2026-11-18 · Verdict: **NO-GO** · Merges: none · Deploy: none · Production mutations: 0

Real OMV run of the R4.3A command (`OMV_HOST_IDENTITY=63df3cffe1fc0223`) against the checkout pinned to
`4c3e07529d706ffc37115aa8de808f36cccdc244`, with `CHECKOUT_INTEGRITY=PASS`.
Result: `PREFLIGHT=HOLD`, `HOLD_COUNT=1`, `EXIT_CODE=3`, `RECEIPT_GATE=NO_GO`. Wrapper safety held:
`PROD_REPO_HEAD_UNCHANGED=YES`, `WRITES_PERFORMED=NO`, `SECRET_PRINTED=NO`, `STAGING_CLEANED=YES`.

## HOLD classification (read-only, against the preflight source at 4c3e075)

| Predicate         | Value   | Source                                                                                             | Class                                         |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `ADMIN_ALLOWLIST` | `EMPTY` | `check_env`: `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` unset or blank in the running Summary container | Configuration precondition, not a code defect |

- The variable already exists on `main` (`services/article_intel_auth/config.py`). Install docs R3/R4 §4 say it "must list the admin(s)".
- The current state fails closed: no Miniflux user is an AI-settings admin, so the admin surface would deny every request. There is no exposure, but the feature can't be administered.
- Resolution is an operator decision: which Miniflux user ID(s) to authorize. The value is non-secret, but it goes into the production Summary environment and needs a container recreate, so it's outside this campaign (no restart, no flag or config change). The preflight is **not** changed to accept `EMPTY`.

## Other gates (all non-HOLD)

```ini
SUMMARY_GATE=PASS            # unique, healthy, UID10001, 0 published ports, not host network; revision = main d54eda2b
DATA_GATE=PASS               # bind RW, dir 700, owner UID10001, not world-writable
FLAGS_GATE=PASS              # 4 canary flags OFF; local processing OFF = baseline (MATCH)
ORIGINS_GATE=PASS            # VALID_COUNT_1, backend validator VALID
CADDY_GATE=PASS              # regular file 600, 56d434b9… = STAGE1_ACCEPTED_PRIOR, container readback MATCH
PROTECTED_SERVICES_GATE=PASS # by HOLD arithmetic, see below
WALLHOP_BASELINE_GATE=CAPTURED_NOT_PROVEN   # 0 resources; inventory e3b0c442… (empty set); UNVERIFIED_NO_BASELINE
OTHER=MANAGED_SETTINGS_DIR ABSENT, ENV_MODEL_POLICY ABSENT_LEGACY, BOOTSTRAP_KEY_FILE YES, TRUSTED_PROXY_IP CONFIGURED, RELEASE_LOCK ABSENT
```

- **Protected services.** The 3 lines in `PREFLIGHT_NONKV_STDOUT_LINES=3` are the `PROTECTED_miniflux`, `PROTECTED_miniflux-db` and `PROTECTED_npm` lines. The wrapper's uppercase `KEY=VALUE` filter drops them because their keys are lowercase and their values contain a space (`RUNNING <image>`). Any `ABSENT` or `NOT_RUNNING` would have added a HOLD, and `HOLD_COUNT=1` is fully accounted for by `ADMIN_ALLOWLIST`, so all three were running. The line text itself was not displayed.
- **WallHop.** The digest `e3b0c442…b855` (empty inventory) is recorded as the reference for post-promotion `NEWSFLUX_WALLHOP_EXPECTED_SHA256`. Capturing the inventory does not prove historical integrity.

## Decision

```ini
MERGE_READY_CHAIN=NO
NEXT_GATE=operator sets NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS (governed config change, outside this campaign), then re-runs the same R4.3A command unchanged and returns RECEIPT_GATE=PASS
```
