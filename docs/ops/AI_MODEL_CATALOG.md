# Dynamic AI model catalog (Track A)

The Summary API no longer limits the catalog to the two hard-coded models (`s5-free`,
`mistral-small`). The catalog is built from three independent inputs. None of them grants anything
on its own.

| Input                    | Owner                                      | What it decides                                                                                                                                         |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model policy             | Operator (`NEWSFLUX_AI_MODEL_POLICY_JSON`) | Which gateway aliases may be used for article summaries, their catalog ID, label, declared price, and whether paid use and article transfer are allowed |
| Read-only discovery      | Summary API, virtual key                   | Which aliases the key may call (`GET /v1/models`), their mode, limits and the price the gateway charges (`GET /model/info`)                             |
| Global switches / budget | Operator (existing variables)              | Inference on/off, external transfer, paid inference, ledger, rate and token limits                                                                      |

**Discovery is not authorization.** A model is `AVAILABLE` only when all of these hold:

1. **Approved:** the model is listed in the policy.
2. **Discovered:** the virtual key can call it.
3. **Compatible:** the gateway reports `mode: chat` and the policy says `compatible_for_summary: true`.
4. **Price verified:** the gateway publishes exactly the operator-declared input and output price.
5. **Authorized:** both the global and per-model flags allow it, which includes paid use for a paid model.
6. **Configured:** the gateway, key, budget, limits and ledger are all valid.

## States shown in Settings

| `status`                      | Typical `unavailable_reason`                                                                                                                   | Meaning                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AVAILABLE`                   | —                                                                                                                                              | Selectable                                                                                                   |
| `DISABLED`                    | `INFERENCE_DISABLED`, `EXTERNAL_TRANSFER_NOT_AUTHORIZED`, `TRANSFER_NOT_AUTHORIZED`, `NOT_CONFIGURED`, `RUNTIME_UNAVAILABLE`, `POLICY_INVALID` | Switched off or misconfigured                                                                                |
| `UNVERIFIED`                  | `DISCOVERY_DISABLED`, `GATEWAY_UNAVAILABLE`, `COMPATIBILITY_UNVERIFIED`, `PRICE_NOT_VERIFIED`, `PRICE_MISMATCH`                                | Not enough evidence; never a presumed price or capability                                                    |
| `NOT_DISCOVERED`              | `NOT_DISCOVERED`                                                                                                                               | Approved, but the gateway no longer offers it. It is not replaced.                                           |
| `OPERATOR_APPROVAL_REQUIRED`  | `OPERATOR_APPROVAL_REQUIRED`                                                                                                                   | Discovered with the key but not in the policy. Listed under an opaque ID `gw-<12 hex>` and never selectable. |
| `PAID_AUTHORIZATION_REQUIRED` | `PAID_NOT_AUTHORIZED`                                                                                                                          | Paid, and paid use is not authorized (globally or per model)                                                 |
| `UNSUPPORTED`                 | `NOT_COMPATIBLE`                                                                                                                               | Not a chat model, or the operator marked it unsuitable                                                       |

Each model also carries `checks` (`discovered`, `compatible`, `operator_approved`,
`pricing_verified`, `paid_authorized`, `transfer_authorized`). `null` means unknown.

## Policy format

```json
{
  "version": 1,
  "models": [
    {
      "id": "s5-free",
      "alias": "newsflux-s5-free",
      "label": "S5",
      "provider": "LiteLLM",
      "compatible_for_summary": true,
      "input_usd_per_million": "0",
      "output_usd_per_million": "0",
      "paid_authorized": false,
      "transfer_authorized": true,
      "max_output_tokens": 2048
    }
  ]
}
```

**Validation rules:**

- IDs match `^[a-z0-9][a-z0-9._-]{0,63}$`.
- Aliases are gateway model names.
- Prices are decimal strings in USD per million tokens.
- At most 32 models; IDs and aliases must be unique.
- Unknown keys are rejected.

**Fail-closed behavior:** an invalid policy disables every model (`POLICY_INVALID`). It never falls
back to the legacy pair.

**Legacy mode:** if `NEWSFLUX_AI_MODEL_POLICY_JSON` is absent, the two legacy IDs are synthesized
from the existing `NEWSFLUX_AI_LITELLM_S5_FREE_*` / `NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_*`
variables with their exact previous semantics. Stored user choices (`s5-free`, `mistral-small`,
`auto`) keep working.

**Adding or removing a model** is a gateway and policy change, never a code change:

- **Adding:** approve the alias in the policy.
- **Removing:** take it off the gateway or the policy. The catalog reports `NOT_DISCOVERED` or drops it.
- **Saved user choices:** a choice that becomes unavailable stays saved and produces a clear error.
  It is never swapped for another model.

## Discovery

| Variable                                  | Default                                   | Notes                                                                                      |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED`     | `false`                                   | When `false`, no gateway call is made and every model is `UNVERIFIED / DISCOVERY_DISABLED` |
| `NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS` | `300`                                     | Cache lifetime (max 3600). A failed discovery is retried after at most 30 s                |
| `NEWSFLUX_AI_DEFAULT_MODEL_ID`            | legacy `NEWSFLUX_AI_LITELLM_MODEL_CHOICE` | Advertised only if that model is `AVAILABLE`                                               |

How discovery requests are made:

- **Routes and method:** only `GET /v1/models` and `GET /model/info`, both inside `llm_api_routes`.
  The virtual key's `allowed_routes` are not widened. A real LiteLLM confirmed both return 200 for
  a key restricted to `["llm_api_routes"]` (`rehearse-s5-key-gate.sh`).
- **Connection:** HTTPS gateway only; no redirects; no retries; 5 s timeout; 256 KiB response cap.
  Responses are strictly parsed, and a malformed listing fails closed (`GATEWAY_UNAVAILABLE`).
- **Run-time revalidation:** the catalog is rebuilt from the cached discovery for each catalog
  request and each summary request.
- **Data exposure:** only whitelisted fields are kept. The browser never receives the gateway URL,
  the key, `litellm_params` or provider endpoints.

`enable-s5` now also sets `NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED=true`. Without discovery, S5 would
stay `UNVERIFIED` because its price could not be checked against the gateway.

## Separate gates (not changed here)

- **`MODEL_SCOPE_EXPANSION`:** the live virtual key is meant to list only the S5 alias, and
  `s5_preflight` enforces `KEY_SCOPE_GATE = exactly [S5 alias]`. Offering more models needs two
  things:
  1. An operator change to the key's `models` list (never its routes) in LiteLLM.
  2. A matching preflight change that requires `key models ⊆ approved policy aliases`.

  Neither is done automatically.

- **Paid models:** require `NEWSFLUX_AI_ALLOW_PAID_INFERENCE=true` plus per-model
  `paid_authorized: true`, and a separate authorization.
- **Primary/fallback selection:** Track B.

## Rollback

Unset `NEWSFLUX_AI_MODEL_POLICY_JSON` to return to legacy mode. Set
`NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED=false` to make no gateway calls; every model then becomes
unavailable. Both are configuration-only changes applied with the governed `release.py` override.
