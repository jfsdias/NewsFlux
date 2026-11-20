# WallHop W1 — provider and source contract (evidence status)

Status: `W0_PRODUCT_DIRECTION=APPROVED`, `W0_PROVIDER_CONTRACT=HOLD`, `WALLHOP_ACTIVATION=NO_GO`. Docs only.
This page records what is known about the provider, how sure we are, and what must exist before any real
use of either path. It authorizes nothing.

## 1. Evidence collected (R5 owner GO R2 "pesquisa documental pública", 2026-11-20 UTC)

Only informational pages were fetched (homepage, robots.txt, sitemap.xml and the usual legal paths). No `/raw/`,
`/api/` or `wallhop.io/https://…` request, no article URL, no login, no bypass. The implementer re-checked the
key facts independently (robots.txt, `/terms` 403, `/privacy` 403, page title, operator name).

| Topic                                                                                                         | Evidence (short quote)                                                                                                              | URL · HTTP                                                        | Class                                                                |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Official site                                                                                                 | "wallhop · Free Paywall Bypass – Read Any Article"; "Paste a link. Get the story. No paywall, no signup."                           | `https://wallhop.io/` · 200                                       | CONFIRMED_PRIMARY_SOURCE                                             |
| Operator                                                                                                      | "a wafflehacker.dev project"; JSON-LD creator "WaffleHacker"; donation link. No legal entity, address or jurisdiction               | `/` · 200                                                         | pseudonym CONFIRMED_PRIMARY_SOURCE; legal identity NOT_AVAILABLE     |
| Terms of use                                                                                                  | none published ("That address isn't allowed.")                                                                                      | `/terms`, `/tos` · 403                                            | NOT_AVAILABLE                                                        |
| Privacy policy                                                                                                | none published                                                                                                                      | `/privacy`, `/privacy-policy` · 403                               | NOT_AVAILABLE                                                        |
| About, FAQ, legal, DMCA, contact                                                                              | none published                                                                                                                      | `/about`, `/faq`, `/legal`, `/dmca`, `/contact` · 403             | NOT_AVAILABLE                                                        |
| Content rights                                                                                                | informal note only: "Paywalls pay for journalism… please subscribe… WallHop is for the one-off article"; no DMCA process            | `/` · 200                                                         | note CONFIRMED_PRIMARY_SOURCE; process NOT_AVAILABLE                 |
| URL handling                                                                                                  | "Put [host]/ in front of any URL"; `/raw/https://…`, `/api/https://…`; the page redirects the browser to `/` + the full article URL | `/` · 200                                                         | CONFIRMED_PRIMARY_SOURCE                                             |
| Automated use                                                                                                 | `User-agent: *` … `Allow: /$` … `Disallow: /` (every proxy path disallowed to bots)                                                 | `/robots.txt` · 200                                               | CONFIRMED_PRIMARY_SOURCE                                             |
| Upstream code                                                                                                 | "heavily modified and tuned from the open-source everywall/ladder (GPL-3.0)"                                                        | `/` · 200                                                         | CONFIRMED_PRIMARY_SOURCE                                             |
| Upstream behaviour (ladder defaults: Googlebot user agent, Google crawler `X-Forwarded-For`, `LOG_URLS=true`) | ladder README                                                                                                                       | `raw.githubusercontent.com/everywall/ladder/main/README.md` · 200 | REPORTED_SECONDARY_SOURCE for WallHop (its configuration is unknown) |
| Retention, logging, data sharing, usage limits                                                                | no statement (homepage loads Google Fonts)                                                                                          | —                                                                 | NOT_AVAILABLE / UNVERIFIED                                           |
| Backend path B sends the publisher URL to `/raw/<url>`                                                        | our code                                                                                                                            | `services/content_fallback/service.py`                            | CONFIRMED (our code)                                                 |
| Path A sends the article URL from the browser                                                                 | our code                                                                                                                            | PR #257 `src/utils/wallhop-external.js`                           | CONFIRMED (our code)                                                 |

Advertised features ("paywall bypass") are product claims, not authorization from any publisher.

## 2. What this means

- **Path B (server-side `/raw/` calls) is not compatible with the provider's own published rule:** robots.txt
  disallows every proxy path to automated clients, and there are no terms that grant API use. Server-side use
  stays HOLD regardless of source approval unless the operator obtains written permission.
- **Legal footing is absent:** no terms, no privacy policy, no retention or logging statement, no DMCA process, no
  legal operator identity. The upstream design fetches as Googlebot, which is an access-control circumvention
  technique, not a licence.
- **Path A (user-initiated external navigation)** sends the article URL from the user's browser to an
  undocumented, pseudonymous operator; consent text must say so plainly. Owner decision required.
- Legitimate full-text sources exist that need no WallHop at all (§4).

## 3. Required to lift `W0_PROVIDER_CONTRACT=HOLD`

1. Saved copies of the provider's terms and privacy pages (URL, date, sha256) — or a written statement that
   none exist, in which case the owner decides explicitly whether to accept an undocumented provider.
2. For path B: at least one source approved in `WALLHOP_SOURCE_POLICY.md` with its own terms evidence, then
   the operator-run contract audit (`deploy/wallhop-isolated/wallhop_contract_audit.py`, ≤ 3 GETs).
3. For path A: the real-device gate (`docs/ops/WALLHOP_EXTERNAL_OPEN_GATE.md` in the path A PR) and the
   owner's acceptance that the user's browser contacts the provider directly.

Item 1 was attempted on 2026-11-20 with the owner's GO: the provider publishes no terms (§1).

## 4. Legitimate source research (owner GO R3; nothing approved, `APPROVED_SOURCE_COUNT=0`)

Publishers' own licence/terms pages and their RSS indexes only; no article recovery calls.

| Source                                      | Licence / terms (primary)                                                                                                                                                                                 | Full text in RSS                           | Restrictions                                                           | AI summaries (derivative)                           | WallHop needed | Recommendation                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- | -------------- | --------------------------------------- |
| Global Voices (globalvoices.org)            | CC BY 3.0 ("all content created by Global Voices is published under a Creative Commons Attribution-Only license"); third-party media excluded                                                             | yes (`/feed/`, `content:encoded`)          | crawl-delay 10                                                         | allowed with attribution and link                   | no             | candidate for owner review              |
| Wikinotícias (pt.wikinews.org)              | CC BY 4.0 (site footer)                                                                                                                                                                                   | not confirmed (feeds tried were empty/404) | none                                                                   | allowed with attribution                            | no             | candidate for owner review (low volume) |
| Agência Brasil (agenciabrasil.ebc.com.br)   | own policy: "Reprodução autorizada para veículos de comunicação com fins jornalísticos, mediante indicação da fonte"; partner content (e.g. Reuters) not reproducible; commercial use needs EBC licensing | yes (`/rss/ultimasnoticias/feed.xml`)      | crawl-delay 10                                                         | unclear (wording covers journalistic outlets)       | no             | needs legal review / ask EBC            |
| The Conversation (theconversation.com, /br) | CC BY-ND 4.0; no systematic republication                                                                                                                                                                 | yes (Atom `content`)                       | robots.txt disallows AI agents (incl. anthropic-ai, ClaudeBot, GPTBot) | not allowed without author approval (ND)            | no             | not suitable without permission         |
| ProPublica                                  | CC BY-NC-ND 3.0 US; no automatic or wholesale republication                                                                                                                                               | yes (`content:encoded`)                    | none in robots                                                         | not allowed (NC + ND + automation ban)              | no             | not suitable as is; ask ProPublica      |
| gov.br (Secom)                              | CC BY-ND 3.0 (footer)                                                                                                                                                                                     | no full-text feed found                    | news portal moved to agenciagov.ebc.com.br (not reachable here)        | not allowed under ND; other legal bases need review | no             | needs legal review                      |

None of the six sources needs WallHop: each publishes full text openly and four provide it in RSS, so NewsFlux
can read it from the feed (Miniflux) or the publisher directly. Not confirmed: EBC's full terms, Agência Gov,
Wikinotícias feeds, ProPublica's AI principles, The Conversation's position on machine summarization.

## 5. Status

`WALLHOP_PROVIDER_CONTRACT=HOLD` (no terms; robots.txt disallows automated use);
`WALLHOP_PRIMARY_EVIDENCE=COLLECTED_2026-11-20`; `APPROVED_SOURCE_COUNT=0`; `WALLHOP_READY_FOR_CONTROLLED_CANARY=NO`.
