# WallHop source policy: candidate matrix (proposal, nothing enabled)

Owner direction W0 (2026-11-20): both paths, separate buttons (backend in-Reader recovery and external
open). This matrix governs only the backend path (B); the external open (A) never contacts a source from
the server.

`SOURCE_POLICY=BLOCKED`. `CONTENT_FALLBACK_POLICIES_JSON` stays `{"enabled": false}`. This page
only proposes; **the operator decides**, source by source, after checking the current terms.

**Evidence status (2026-11-15):** none of these sites could be read from the agent environment.
The egress proxy refused `CONNECT` to `wallhop.io` and to every candidate host (`connect_rejected`).
The "terms" column therefore records **what must be verified**, not verified facts. Recollections
of a site's terms are not evidence and must not be used to enable anything.

## Rules for any source

1. **Public without login:** publicly readable without login, subscription or metering. A paywall,
   a "free articles left" meter, or a login wall excludes the source. Nothing is ever retrieved to
   get around access control.
2. **Terms allow it:** the site's current terms (and robots.txt) allow automated retrieval and
   allow showing the retrieved text to the subscriber who asked for it, as a transient copy.
3. **Evidence on file:** the terms evidence is saved (URL, date, sha256 of the saved page) in the
   ledger before approval.
4. **On demand only:** never `AUTO`. The user's explicit consent per article stays required (#241).
5. **One audit:** the operator runs one audit of the real contract with
   `deploy/wallhop-isolated/wallhop_contract_audit.py` (3 GET requests at most, authorization token for
   the current date) against one public article of an approved source.

## Candidate matrix

| SOURCE_DOMAIN                       | PUBLIC_WITHOUT_LOGIN           | AUTOMATED_RETRIEVAL_ALLOWED                                                       | TERMS_EVIDENCE | PAYWALL_STATUS          | RECOMMENDED_POLICY                                                                                                                                 | OPERATOR_APPROVED |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- | -------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `agenciabrasil.ebc.com.br`          | to verify                      | to verify (an open content licence is expected; confirm the current licence page) | PENDING        | none expected           | `ON_DEMAND` candidate after verification. Check first whether the Miniflux feed already carries the full text; if it does, WallHop is unnecessary. | NO                |
| `www.gov.br` (news sections)        | to verify                      | to verify per agency (licences vary)                                              | PENDING        | none expected           | `ON_DEMAND` candidate per sub-site after verification                                                                                              | NO                |
| `pt.wikinews.org` / `wikipedia.org` | to verify                      | to verify (CC BY-SA content; bot policy applies)                                  | PENDING        | none                    | Low value for news; only if the operator actually needs it                                                                                         | NO                |
| `apnews.com`                        | to verify                      | expected to be restricted by the publisher's terms; verify                        | PENDING        | metering possible       | `DISABLED` unless a licence is confirmed                                                                                                           | NO                |
| `reuters.com`                       | partial (registration prompts) | expected to be restricted; verify                                                 | PENDING        | registration wall       | `DISABLED`                                                                                                                                         | NO                |
| `bbc.com` / `bbc.co.uk`             | to verify                      | expected to be restricted; verify                                                 | PENDING        | geo/registration varies | `DISABLED`                                                                                                                                         | NO                |
| `theguardian.com`                   | to verify                      | expected to be restricted outside its official API; verify                        | PENDING        | none (donation prompts) | `DISABLED` for WallHop; use the official API instead if ever needed                                                                                | NO                |
| `nytimes.com`                       | **no**                         | n/a                                                                               | n/a            | **paywall**             | **DO NOT ENABLE**                                                                                                                                  | NO                |
| `bloomberg.com`                     | **no**                         | n/a                                                                               | n/a            | **paywall**             | **DO NOT ENABLE**                                                                                                                                  | NO                |
| `wsj.com`                           | **no**                         | n/a                                                                               | n/a            | **paywall**             | **DO NOT ENABLE**                                                                                                                                  | NO                |
| `folha.uol.com.br`                  | **no**                         | n/a                                                                               | n/a            | **paywall**             | **DO NOT ENABLE**                                                                                                                                  | NO                |
| `economist.com`                     | **no**                         | n/a                                                                               | n/a            | **paywall**             | **DO NOT ENABLE**                                                                                                                                  | NO                |

The audit tool also refuses any article on a paywalled domain (built-in denylist), even if it is
placed in the approved list.

## How an approval becomes configuration (later, with authorization)

1. The operator saves the terms evidence and records `OPERATOR_APPROVED=YES` for a domain in the
   homeserver ledger.
2. The operator runs the contract audit once (OMV, authorized date token) and records the result.
3. Only then is a policy with exactly those domains, all `ON_DEMAND`, proposed as a governed
   configuration change to the isolated recovery service of `deploy/wallhop-isolated/` (PR254 topology).
   The change must be reversible to `{"enabled": false}` in one step (`g5-dark-teardown.sh` restores the
   dark state) and must not touch NPM host 111 or the PR188 container (`topology_guard.py`).

Ported from PR244 (whose network override of the PR188 container is NO_GO and is **not** ported). The
`wallhop-activation.sh` flow of topology B is obsolete; any future activation tooling targets the
isolated topology.
