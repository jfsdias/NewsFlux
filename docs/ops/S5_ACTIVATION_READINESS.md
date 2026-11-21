# S5 (AI summary) — remaining activation readiness (R3B, Sprint A8)

Reconciliation only. Nothing here changes the key, the S5 contract or D1, runs inference, or activates
S5. `D1=OWNER_OPEN` (D1-B PM-recommended), `S5_PREFLIGHT=BLOCKED`, `S5_ACTIVATION=NO_GO`.

Classes: `ALREADY_IMPLEMENTED` (code and tests exist), `READY_FOR_OFFLINE_ENGINEERING` (can be built and
tested now without a pending decision), `BLOCKED_BY_LIVE_EVIDENCE`, `BLOCKED_BY_OWNER_DECISION`,
`BLOCKED_BY_PROVIDER_EVIDENCE`. A requirement can have an implemented check and still be blocked on
its live value.

| #   | Requirement                 | Class                                                                                     | What exists                                                                                                            | What is missing                                                                                                            |
| --- | --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Real read-only diagnostic   | `BLOCKED_BY_LIVE_EVIDENCE`                                                                | auditor (strict binding, flags, receipt contract), wrapper, executor, G2 remote/local                                  | legitimate OMV access, G2 evidence admitted by the PM, a GO for the run                                                    |
| 2   | D1-B model catalog contract | `BLOCKED_BY_OWNER_DECISION`                                                               | direction recorded: the LiteLLM virtual key governs which models may appear                                            | the owner's D1 decision; no contract change before a formal GO                                                             |
| 3   | Existing key policy         | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` value                            | `KEY_POLICY_GATE`, `KEY_POLICY_GATE_R3` (scope, validity, routes, schema, version class)                               | the live receipt                                                                                                           |
| 4   | RPM / TPM / budget          | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` value                            | `KEY_RPM`, `KEY_TPM`, `KEY_RATE_LIMITS`, `KEY_MAX_BUDGET`, `KEY_BUDGET_DURATION`, `KEY_SPEND_VS_MAX`, `APP_BUDGET_CAP` | live values; if the app caps are missing, an owner decision on the caps                                                    |
| 5   | Fallback                    | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` value                            | `FALLBACK_*`, `FALLBACK_GATE` (alias, context-window, content-policy, default rules; general settings)                 | live receipt                                                                                                               |
| 6   | JWT                         | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` value                            | `JWT_AUTH`; R3 reason `JWT_AUTH_NOT_DISABLED`                                                                          | live receipt                                                                                                               |
| 7   | Inherited permissions       | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` value                            | `KEY_INDIRECTION` (team, access groups, policies, object permission), `KEY_EXTRA_INDIRECTION`, `OBJPERM_*`             | live receipt                                                                                                               |
| 8   | Provider route              | `ALREADY_IMPLEMENTED` check / `BLOCKED_BY_LIVE_EVIDENCE` + `BLOCKED_BY_PROVIDER_EVIDENCE` | `PROVIDER_FAMILY`, `ENDPOINT_CLASS`, `MODEL_ROUTE_GATE`; auth-surface lab (7/7 per image)                              | live deployment list; provider documentation for the chosen route                                                          |
| 9   | Official attestation        | `BLOCKED_BY_OWNER_DECISION`                                                               | the auditor always reports `OFFICIAL_ATTESTATION=HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE` by design                      | an accepted attestation source (owner/PM decision), then the key-write GO                                                  |
| 10  | Pricing                     | `BLOCKED_BY_PROVIDER_EVIDENCE`                                                            | `CONFIGURED_PRICE`, `PUBLISHED_PRICE_MAP`, `PRICING_GATE` (never PASS from local data alone)                           | provider price terms for the exact model                                                                                   |
| 11  | Privacy                     | `BLOCKED_BY_PROVIDER_EVIDENCE`                                                            | `PROVIDER_PRIVACY_GATE=NOT_VERIFIED_OPERATOR_TERMS_REQUIRED`, `CALLBACK_GATE`                                          | provider retention/training terms; callbacks reviewed live                                                                 |
| 12  | Consent                     | `BLOCKED_BY_OWNER_DECISION`                                                               | external-transfer flag effectively OFF (two parsers + runtime)                                                         | the owner's consent to send article text to the provider                                                                   |
| 13  | Canary                      | `READY_FOR_OFFLINE_ENGINEERING` (plan) / execution blocked                                | flag gating, preflight, release tooling                                                                                | a one-article canary procedure with stop conditions, rehearsed in the lab; run only after items 1–12 and an `enable-s5` GO |
| 14  | Rollback                    | `ALREADY_IMPLEMENTED`                                                                     | flags OFF by default and revertible; release rollback rehearsed (workflow steps 7, 9, 10)                              | rehearse "flags back OFF" as part of the canary procedure (item 13)                                                        |

## Order of gates to activation

1. PM review of R3B and of the `G2_LOCAL_INDEPENDENT` evidence (or Actions credits for a remote run).
2. PM admits G2 evidence → GO for the read-only diagnostic → live receipt (items 3–8).
3. Owner: D1 decision (item 2), attestation source (9), consent (12); provider price and privacy terms (10, 11).
4. Key-write GO (only if the live receipt shows a gap) → official attestation.
5. `enable-s5` GO → canary (13) with rollback (14).

Offline work that can proceed without any of these: the canary procedure and its lab rehearsal
(item 13), as a separate change after PM review of R3B.
