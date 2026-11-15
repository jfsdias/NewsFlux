# S5 key gate: contract and evidence for release

## Why `/key/info` returns HTTP 403

The Summary API's LiteLLM virtual key should only be allowed to call inference routes
(`allowed_routes: ["llm_api_routes"]`). LiteLLM checks `allowed_routes` before it runs the
`/key/info` handler. A key restricted this way therefore gets:

| Route             | Least-privilege key | Meaning                                         |
| ----------------- | ------------------- | ----------------------------------------------- |
| `GET /v1/models`  | 200                 | The key can list the catalog                    |
| `GET /key/info`   | **403**             | "Virtual key is not allowed to call this route" |
| `GET /model/info` | 200                 | Model listing (prices only if configured)       |

The 403 is expected. It does **not** mean the key is invalid for inference, and it does not prove the
key's scope, budget or limits either. Confirmed against a real LiteLLM proxy
(`rehearse-s5-key-gate.sh`, image `litellm/litellm@sha256:11175975…`).

The previous preflight had two defects:

- **403 reported as a key failure.** It read the 403 as `KEY_GATE=FAIL`, with no way to supply the
  evidence through another channel.
- **"All models" read as authorized.** In LiteLLM, an empty or missing `models` list means the key
  may call **every** model. The old check passed in that case (`KEY_SCOPE=ALL_MODELS`). It also
  accepted `GATEWAY_PRICE_GATE=NOT_PUBLISHED` and passed with no gateway budget. Against synthetic
  input, an unrestricted key with no published price and no budget produced `S5_PREFLIGHT=PASS`.

## Gates (all must be `PASS`; `NOT_VERIFIED` blocks)

| Gate                      | Evidence required                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CATALOG_ACCESS_GATE`     | `/v1/models` lists the S5 alias. Proves catalog access only, never scope.                                                                                                                                                                         |
| `KEY_VALIDITY_GATE`       | `status` active (when reported), not `blocked`, `expires` empty or in the future                                                                                                                                                                  |
| `KEY_SCOPE_GATE`          | `models` is exactly `[<S5 alias>]`. Empty, `*`, `all-proxy-models`, `all-team-models`, `provider/*` or extra models fail.                                                                                                                         |
| `KEY_BUDGET_GATE`         | `0 < max_budget <= NEWSFLUX_AI_MONTHLY_BUDGET_USD`, a `budget_duration`, `spend < max_budget`                                                                                                                                                     |
| `KEY_RATE_LIMIT_GATE`     | positive `tpm_limit` and `rpm_limit` on the key                                                                                                                                                                                                   |
| `KEY_ALLOWED_ROUTES_GATE` | `allowed_routes` is exactly `["llm_api_routes"]`. Absent → `NOT_VERIFIED`; `null` or `[]` (no restriction in LiteLLM), any administrative route (e.g. `/key/generate`), other route group or wildcard → `FAIL`. Applies to both evidence sources. |
| `PRICING_GATE`            | every S5 deployment publishes explicit `0` input and output cost **and** the operator confirmed the provider's real cost is zero. `NOT_PUBLISHED` is not zero.                                                                                    |
| `LOGGING_GATE`            | LiteLLM success callbacks within `NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS`                                                                                                                                                                          |
| local gates               | unchanged: key file, policy ready, configured S5 price 0, app budget/limits, Mistral blocked                                                                                                                                                      |

A price of zero in LiteLLM only means LiteLLM records zero spend. Whether the provider bills nothing
cannot be checked technically, so `PRICING_GATE` also needs the operator's confirmation and a
reference (for example, the provider's free-tier terms).

## Key evidence sources

1. **`SELF_INTROSPECTION`**: the key reads its own `/key/info`. This only works when the key is not
   route-restricted. If the gateway answers, its live answer wins over any document.
2. **`ADMIN_ATTESTATION`**: the operator runs `deploy/release-governance/s5_key_audit.py` on the host:
   - **Credential:** a read-only admin credential, preferably a key whose user has role
     `proxy_admin_viewer`. That role can read keys and models but gets 403 on `/key/generate`.
   - **Requests:**
     - `POST /v2/key/info {"keys": [<token hash>]}`: the hash is in the TLS body, never in a URL or an access log.
     - `GET /model/info`.
   - **Output:** `$RELEASE_DIR/s5-key-attestation.json`, mode 0600, holding only the policy fields,
     unit costs and the operator's confirmation.
   - **Binding:** the file carries the fingerprint `sha256("newsflux-s5-key-attestation-v1\0" ||
sha256(key))`. LiteLLM's token hash (`sha256(key)`) is equivalent to a credential, so it is never
     written anywhere.
   - **Validity:** the attestation is rejected if it belongs to another key, is older than 24 h, is
     dated in the future, has the wrong schema or alias, or is not a live read.
   - **Delivery:** `ai-functional-release.sh s5-preflight` passes the file on stdin. The admin
     credential never enters the Summary or Reader container.

Not done, by design:

- **No widened virtual key:** the key keeps `llm_api_routes` only.
- **No admin key in the app:** neither the master key nor any admin key goes in the Summary or
  Reader container.
- **No "free model" claim from `/v1/models`.**
- **No inference during the preflight.**

## Operator procedure (read-only)

The attestation must be written to the exact path the release script reads:
`$RELEASE_DIR/s5-key-attestation.json`, which by default is
`/dockerdata/compose/newsflux/.releases/ai-functional-<first 12 hex of APPROVED_SHA>/s5-key-attestation.json`
(`NEWSFLUX_RELEASE_ROOT` overrides the root). Ask the script for it instead of typing it; any other
path is silently not found and the preflight stays `BLOCKED` with `ATTESTATION=NONE`.

```bash
export APPROVED_SHA=<40-hex SHA being released>
ATTESTATION="$(sudo -E bash deploy/release-governance/ai-functional-release.sh s5-attestation-path)"
sudo python3 deploy/release-governance/s5_key_audit.py \
  --gateway-url https://<litellm host> \
  --admin-key-file /root/secrets/litellm-admin-viewer.key \
  --virtual-key-file <host path of the Summary key file> \
  --alias <S5 alias> \
  --out "$ATTESTATION" \
  --confirm-provider-cost-zero --reference "<provider free-tier terms, date reviewed>"
sudo -E bash deploy/release-governance/ai-functional-release.sh s5-preflight
```

Both key files must be mode `0600`/`0400`. Omit `--confirm-provider-cost-zero` if you have not
reviewed the provider's terms; the preflight then stays `BLOCKED` with `PRICING_GATE=NOT_VERIFIED`.

If the live key fails a gate, fix it in LiteLLM (an admin action outside this repository). For
example, `allowed_routes: ["llm_api_routes"]`, `models: ["<S5 alias>"]`, `max_budget`, `budget_duration`, `tpm_limit`, `rpm_limit`, and
explicit `input_cost_per_token: 0` / `output_cost_per_token: 0` on the S5 deployment. Then repeat
the audit.

## Evidence

| Kind                     | Where                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| Unit, preflight          | `services/article_intel_summary/tests/test_s5_preflight.py`                      |
| Unit, audit tool         | `deploy/release-governance/test_s5_key_audit.py`                                 |
| Real LiteLLM, disposable | `deploy/release-governance/rehearse-s5-key-gate.sh` (CI: `synthetic-release`)    |
| Upgrade from Stage 1     | `deploy/release-governance/rehearse-stage1-upgrade.sh` (CI: `synthetic-release`) |
| Live gateway             | operator only, after authorization; nothing in this repository is live evidence  |
