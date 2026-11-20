# Local-only consent in D1 key mode — verifiable identity and routing (proposal, not implemented)

Status: proposal for a separate change after #274. Today key mode is **fail-closed**: local-only consent
(`NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING`) admits no model, and every model needs the external-transfer consent
(`test_local_only_consent_never_admits_a_model_in_key_mode`). That keeps privacy but means local-only consent is not
functionally complete: a model that really is local stays unavailable to a user who consented only to local processing.

## What does not prove "local"

- An alias or model name (`ollama-*`, `local-*`) or the provider string `ollama` in `/model/info`.
- A zero or absent price. Price is a cost fact, not a routing fact.
- An `api_base` host name alone. A name like `ollama` resolves through Docker DNS, and any container can take
  that name on any network.
- The virtual key's own view. `/model/info` names one deployment. It does not show the router's fallbacks,
  the success/failure callbacks that may export the prompt, or indirect routes (aliases, access groups, team
  models).

## What can prove it, reusing what exists

The admitted auditor (57c536f) already classifies the deployments of the alias it audits, in the same read-only run
the D1 capture uses:

| Receipt fact                                | Needed value                                   | Covers                                                        |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `PROVIDER_FAMILY`                           | `OLLAMA`                                       | provider family of every deployment of the alias (DB + YAML)  |
| `ENDPOINT_CLASS`                            | `LOCAL_OLLAMA` (not `MIXED`/`CUSTOM_ENDPOINT`) | every deployment's `api_base` is a local Ollama host and port |
| `FALLBACK_GATE` with `FALLBACK_*_RULE=NONE` | `PASS`                                         | no router fallback can send the request elsewhere             |
| `CALLBACK_GATE` / `CALLBACKS_CONFIGURED`    | `PASS` / `NONE`                                | no logging or callback integration receives the payload       |
| `KEY_EXTRA_INDIRECTION`                     | `NONE`                                         | no alias, team or access-group indirection                    |

Three facts are missing today and would be added by the same root capture, without new signers:

1. **Network identity.** The Ollama container (ID, image digest) is the only endpoint of the `api_base`
   name on the LiteLLM network. That network is `internal: true`, so it has no egress. This is read with
   `docker network inspect` / `docker inspect` before and after the audit, as identity is today.
2. **Alias coverage.** The 57c536f auditor audits one alias (the Summary's configured alias). A per-model local proof
   for several key models needs an auditor revision. That revision needs its own admission (CI at the exact SHA, PM
   review). Until then the proof covers at most that one alias.
3. **Runtime re-check.** Before each local-only dispatch, as in #260's `pre_dispatch_check`: a fresh `/model/info`
   that still reports the same provider and `api_base` for the alias, and no change in the evidence digest. Any
   mismatch blocks that request (`InferenceUnavailable`). It never falls back to an external route.

## Proposed admission rule (key mode)

A model is admitted on local-only consent **only** when all of these hold:

- the evidence (v3, pinned digest) proves the facts above for **that exact alias**, with the network identity
  captured;
- the key fingerprint matches;
- the runtime pre-dispatch check passes.

Everything else keeps today's behaviour, which requires the external-transfer consent. Local-only consent never
authorizes a remote model.

## Legacy mode (#260 as written)

Before merge, #260's `_is_unpriced_local_ollama` must stop using "no price" as part of the local identity. Keep the
identity pin (`provider_identity == ollama@ollama:11434` in policy and in gateway) and the pre-dispatch check, and
move the price condition to the cost gate where it belongs.

## Next steps (each needs its own GO)

1. A small auditor revision (per-alias deployment classes plus Ollama network identity), admitted like 57c536f.
2. Evidence v3.1 fields for the local route. Same capture, same pin, same trust model.
3. Catalog: per-model `LOCAL_ROUTE_PROVEN` admission, plus the #260 pre-dispatch check in key mode.
