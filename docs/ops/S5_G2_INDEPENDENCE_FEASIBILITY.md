# G2_LOCAL_INDEPENDENT — independence feasibility and proportionate trust proposal (R4, Epic A)

Owner answer R1: "Não sei quais signatários indicar." Signer selection is therefore treated as an engineering
and governance task. Nothing here admits a signer: admission stays a PM decision (an admission-only commit,
see `S5_R3B_G2_LOCAL_INDEPENDENT.md` §5). The protected operation is **read-only and diagnostic** (no key, DB,
config or inference change), which is what makes a proportionate model reasonable.

## 1. What was actually checked (2026-11-20)

| Option                                                        | Status                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude as producer (this session, cloud environment "Padrão") | AVAILABLE                      | R3B producer runs, 18/18                                                                                                                                                                                                                                                                                                                                                                |
| Separate isolated lab with separate key custody               | **AVAILABLE, verified**        | a second cloud session in a different environment ("Default"), its own container (4 CPU, 15 GiB, Docker 29.10.0 started there, `busybox` run OK, GitHub and both registries reachable). It generated `ssh-ed25519 … newsflux-g2-replayer-cloud` (`SHA256:8D2uwmJ3XQuJRd+wavg9b0/BIu6h18vW9xu4ITJLjLg`); the private key never left that container and is not readable from this session |
| Codex as independent executor                                 | NOT AVAILABLE to this session  | no Codex tool or environment is reachable from here; not assumed                                                                                                                                                                                                                                                                                                                        |
| The owner's own computer (bridge environments)                | NOT USED                       | it exists, but using it would move mechanical work and risk onto the owner's machine; excluded unless the owner asks                                                                                                                                                                                                                                                                    |
| GitHub Actions                                                | UNAVAILABLE (no credits)       | not dispatched; no purchase                                                                                                                                                                                                                                                                                                                                                             |
| Self-hosted runner on OMV                                     | FORBIDDEN                      | not considered                                                                                                                                                                                                                                                                                                                                                                          |
| PM review                                                     | AVAILABLE as a governance step | the PM reviews published artifacts and decides admission                                                                                                                                                                                                                                                                                                                                |

What a second cloud session does **and does not** give:

- It gives: a different container and daemon, its own clone, its own run, and **separate key custody** (the
  producer cannot read the replayer's private key).
- It does not give: a different vendor, account or human. Both sessions belong to the same account and the
  producer writes the replayer's instructions. A replay that agrees with the producer is still meaningful
  because the replayer recomputes everything from the public commit; a malicious producer cannot forge the
  replayer's signature, but could in principle instruct it badly. The approval step addresses that.

## 2. Proposed proportionate trust model (for PM approval)

| Role      | Who                                                                                                       | Custody                                                | Why acceptable for a read-only diagnostic                                          |
| --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Producer  | this Claude session                                                                                       | key in this session's container                        | does the engineering; never approves                                               |
| Replayer  | a separate cloud session in another environment                                                           | key generated and kept in its own container            | independent execution and recomputation at the exact commit                        |
| Reviewer  | a third separate cloud session, briefed with the code and artifacts only (not the producer's conclusions) | key in its own container                               | independent review; signs only if both bundles verify and its own checks pass      |
| Admission | the PM                                                                                                    | an admission-only commit listing the three public keys | human governance; the PM reads the published bundles, the approval and this record |

Controls that stay in force: exact commit and tree; bound file hashes; all 18 steps; no skip; counts; images;
cleanup; clean checkout after the run; secret scan; signatures with namespaces; self-approval refused by name
and by key; replay by a distinct key and run; admission-only delta. Residual risk accepted by this model: the
three agents share a vendor and an account. That is proportionate to a read-only diagnostic whose output is
itself contract-validated and printed only after post-run identity checks; it would **not** be proportionate
for a write to the key, a deploy or an S5 activation.

Alternatives if the PM rejects it: (a) Actions credits for one remote run (`G2_REMOTE_CI`); (b) a human
replayer on hardware the owner chooses; (c) keep `G2=HOLD`.

## 3. Status

`G2_ADMISSION_FEASIBILITY=FEASIBLE_PROPORTIONATE_MODEL_PROPOSED`, `G2_SIGNER_CUSTODY=SEPARATE_CONTAINERS_DEMONSTRATED`,
no signer admitted, `G2=HOLD` until the PM admits signers.
