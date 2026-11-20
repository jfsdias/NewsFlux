# WallHop W1 — provider and source contract (evidence status)

Status: `W0_PRODUCT_DIRECTION=APPROVED`, `W0_PROVIDER_CONTRACT=HOLD`, `WALLHOP_ACTIVATION=NO_GO`. Docs only.
This page records what is known about the provider, how sure we are, and what must exist before any real
use of either path. It authorizes nothing.

## 1. Evidence collected (2026-11-20, agent environment)

| Source                                                               | Result                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `https://wallhop.io/` (and `/terms`, `/privacy`)                     | **not reachable** from the agent environment (egress proxy refuses the host); `/tos`, `/faq`, `/about` therefore not attempted |
| Web search "wallhop.io terms of service privacy policy"              | no wallhop.io result                                                                                                           |
| Third-party descriptions (search snippets only; pages not reachable) | everydev.ai `/tools/wallhop/llms.txt`; zeli.app story 50038634                                                                 |

| Fact                                                                                                                   | Class                | Source                                  |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------- |
| Terms of use, permitted use, automated/API use rules                                                                   | **UNKNOWN**          | no document found                       |
| Privacy policy, data retention, URL logging, analytics                                                                 | **UNKNOWN**          | no document found                       |
| Rate limits, DMCA/takedown process, publisher rights                                                                   | **UNKNOWN**          | no document found                       |
| WallHop fetches an article from a pasted link; offers a bookmarklet, an iPhone Shortcut, `/raw/<url>` and `/api/<url>` | UNVERIFIED           | everydev.ai snippet                     |
| It is derived from the open-source everywall/ladder proxy (GPL-3.0) and listed as free                                 | UNVERIFIED           | everydev.ai snippet                     |
| It is publicly described as a paywall-bypass tool created after 12ft.io shut down                                      | UNVERIFIED           | zeli.app snippet                        |
| The backend path B sends the publisher URL to `https://wallhop.io/raw/<url>`                                           | CONFIRMED (our code) | `services/content_fallback/service.py`  |
| Path A sends the article URL from the user's browser to `https://wallhop.io/<url>`                                     | CONFIRMED (our code) | PR #257 `src/utils/wallhop-external.js` |

**Confirmed provider facts: none.**

## 2. What this means

- The provider is publicly described as a paywall-bypass service and publishes no terms that we could read.
  NewsFlux must not use it to get around publisher access controls (owner direction W0). Real use is
  therefore limited to content the user may legitimately access, under the source policy
  (`WALLHOP_SOURCE_POLICY.md`: public without login, terms allow automated retrieval, evidence on file,
  `ON_DEMAND` only), and stays on HOLD until the provider's own terms are on file.
- Both paths transfer a URL to a third party whose retention and logging are unknown. Consent texts must say
  so (they do: path A per click, path B per article), but consent does not replace the missing contract.
- Credentials, cookies, Miniflux tokens and private URLs are never sent (enforced in code for both paths).

## 3. Required to lift `W0_PROVIDER_CONTRACT=HOLD`

1. Saved copies of the provider's terms and privacy pages (URL, date, sha256) — or a written statement that
   none exist, in which case the owner decides explicitly whether to accept an undocumented provider.
2. For path B: at least one source approved in `WALLHOP_SOURCE_POLICY.md` with its own terms evidence, then
   the operator-run contract audit (`deploy/wallhop-isolated/wallhop_contract_audit.py`, ≤ 3 GETs).
3. For path A: the real-device gate (`docs/ops/WALLHOP_EXTERNAL_OPEN_GATE.md` in the path A PR) and the
   owner's acceptance that the user's browser contacts the provider directly.

Options to obtain item 1 without owner mechanical work: a PM-approved, read-only network allowance for
`wallhop.io` in an agent environment to save the pages (no article URL sent), or the PM saving them.

## 4. Status

`WALLHOP_PROVIDER_CONTRACT=HOLD_NO_PROVIDER_TERMS_AVAILABLE`; `WALLHOP_READY_FOR_CONTROLLED_CANARY=NO`.
