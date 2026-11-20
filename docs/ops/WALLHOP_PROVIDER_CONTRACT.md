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
| Terms of use                                                                                                  | not found at the usual paths ("That address isn't allowed."); a 403 does not prove that no terms exist                              | `/terms`, `/tos` · 403                                            | NOT_FOUND_AT_USUAL_PATHS                                             |
| Privacy policy                                                                                                | not found at the usual paths (403)                                                                                                  | `/privacy`, `/privacy-policy` · 403                               | NOT_FOUND_AT_USUAL_PATHS                                             |
| About, FAQ, legal, DMCA, contact                                                                              | not found at the usual paths (403)                                                                                                  | `/about`, `/faq`, `/legal`, `/dmca`, `/contact` · 403             | NOT_FOUND_AT_USUAL_PATHS                                             |
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

- **Path B (server-side `/raw/` calls) conflicts with the provider's published crawler rule:** robots.txt
  disallows every proxy path to automated clients. robots.txt is a technical access preference, not by itself a
  legal prohibition; NewsFlux does not work around it (standing rule), and no terms granting API use were found.
  Server-side use stays HOLD regardless of source approval unless the operator obtains written permission.
- **Legal footing was not found:** no terms, privacy policy, retention or logging statement, DMCA process or legal
  operator identity at the usual paths (403 answers there show only that those paths are refused, not that no
  terms exist anywhere). The upstream design fetches as Googlebot, which is an access-control circumvention
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

Item 1 was attempted on 2026-11-20 with the owner's GO: no terms were found at the usual paths (§1); asking the
operator directly is the remaining step.

## 4. Legitimate source research (owner GO R3; nothing approved, `APPROVED_SOURCE_COUNT=0`)

Publishers' own licence/terms pages and their RSS indexes only; no article recovery calls.

| Source                                      | Licence / terms (primary)                                                                                                                                                                                 | Full text in RSS                      | Restrictions                                                           | AI summaries (derivative)                                                                                                | WallHop needed | Recommendation                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------- |
| Global Voices (globalvoices.org)            | CC BY 3.0 ("all content created by Global Voices is published under a Creative Commons Attribution-Only license"); third-party media excluded; its AI policy (2026-09) governs its own editorial work     | yes (`/feed/`, `content:encoded`)     | crawl-delay 10                                                         | licence allows adaptation with attribution; the AI policy neither grants nor forbids third-party summaries: not inferred | no             | CANDIDATE_ONLY (owner review)          |
| Wikinotícias (pt.wikinews.org)              | CC BY 4.0 (site footer); Wikinews projects closed on 2026-05-04 (Wikimedia Meta, links supplied in the R6 review)                                                                                         | no new content (feeds empty/404)      | none                                                                   | allowed with attribution (archive)                                                                                       | no             | ARCHIVE_ONLY (not a news source)       |
| Agência Brasil (agenciabrasil.ebc.com.br)   | own policy: "Reprodução autorizada para veículos de comunicação com fins jornalísticos, mediante indicação da fonte"; partner content (e.g. Reuters) not reproducible; commercial use needs EBC licensing | yes (`/rss/ultimasnoticias/feed.xml`) | crawl-delay 10                                                         | unclear (wording covers journalistic outlets)                                                                            | no             | needs legal review / ask EBC           |
| The Conversation (theconversation.com, /br) | CC BY-ND 4.0; no systematic republication                                                                                                                                                                 | yes (Atom `content`)                  | robots.txt disallows AI agents (incl. anthropic-ai, ClaudeBot, GPTBot) | ND forbids sharing adaptations; a private, unshared summary is not automatically excluded: legal review                  | no             | not suitable without review/permission |
| ProPublica                                  | CC BY-NC-ND 3.0 US; no automatic or wholesale republication                                                                                                                                               | yes (`content:encoded`)               | none in robots                                                         | republication terms ban automated/wholesale reuse; NC + ND: legal review                                                 | no             | not suitable as is; ask ProPublica     |
| gov.br (Secom)                              | CC BY-ND 3.0 (footer)                                                                                                                                                                                     | no full-text feed found               | news portal moved to agenciagov.ebc.com.br (not reachable here)        | ND alone is not an automatic ban on private summaries; legal review                                                      | no             | needs legal review                     |

None of these sources needs WallHop: each publishes full text openly and most provide it in RSS, so NewsFlux can
read it from the feed (Miniflux) or from the publisher directly. **Direct full-text recovery** (feed
`content:encoded` or the publisher's own page, per approved source, robots.txt respected) is a complementary
option independent of both WallHop paths and is evaluated per source under `WALLHOP_SOURCE_POLICY.md`; it is not
enabled here. Not confirmed: EBC's full terms, Agência Gov, ProPublica's AI principles, The Conversation's
position on machine summarization. A licence's ND clause, a robots.txt rule or a 403 is recorded as evidence of
that fact only; none is read as more (or less) than it says.

## 5. Status

`WALLHOP_PROVIDER_CONTRACT=HOLD` (no terms found; robots.txt disallows automated use); `WIKINEWS=ARCHIVE_ONLY`;
`GLOBAL_VOICES=CANDIDATE_ONLY`; `WALLHOP_ROADMAP=RETAIN_BOTH` (path A external open and path B in-reader recovery
stay on the roadmap, gated, P2; Summary is P0 and not blocked by WallHop);
`WALLHOP_PRIMARY_EVIDENCE=COLLECTED_2026-11-20`; `APPROVED_SOURCE_COUNT=0`; `WALLHOP_READY_FOR_CONTROLLED_CANARY=NO`.
