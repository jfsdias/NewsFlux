# NewsFlux Independent Engineering Review

- **Author:** Claude (independent reviewer). These conclusions are **not** REA conclusions and are not attributed to the REA reports.
- **Date:** 2026-10-21.
- **NewsFlux base:** `main` at `b6b7246642aa5ff15f3f8e7015d2efbd83a47be5` (live GitHub state at the time of review; no open issues; draft PRs #76, #77 and #78 were open and are **not** dependencies of this work).
- **IMPLEMENTATION_AUTHORITY:** NO. This is research documentation. It changes no roadmap, project-state or product decision.
- **Inputs reviewed:** R1, R2 and R3 (archived beside this file). The benchmark harness and the in-session red-team report were not supplied as files and are not archived here (see [README.md](README.md)).

## Method

The review follows `REPORT → VERIFY → REVERSE ENGINEER → FALSIFY → RECONCILE → DOCUMENT`.

| Source of evidence                             | Tool used                                                                            | Used for                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NewsFlux repository (live)                     | GitHub MCP, `git`, `rg`                                                              | Current code, open PRs, issues, docs                                                                                                                                                                                                                |
| Open-source reference implementations          | Read-only partial git clones at the refs below, read with `git`/`rg`                 | Files, functions, constants, tests, `git log` history                                                                                                                                                                                               |
| Issues and pull requests of external projects  | `WebFetch` of the GitHub pages                                                       | Intent, state and outcome of a small sample of items already cited by R2                                                                                                                                                                            |
| Closed-source products                         | `WebSearch` result summaries                                                         | Vendor-documented behaviour only. Direct fetching of the vendors' documentation hosts was blocked by the sandbox, so none of these pages was read in full and every closed-source statement below is limited to what the search summaries reported. |
| NewsFlux behaviour that depends on the browser | Not used in this track (documentation-only; no UI conclusion depends on the browser) | n/a                                                                                                                                                                                                                                                 |

**Tool limitation, stated plainly:** the "REA MCP" requested for external code archaeology is **not available in this session** (no such tool is exposed). The equivalent work was done with direct, read-only git clones and `rg`. That means the code-level findings below were produced by this review, not by REA, and the REA-specific claims in R2 about its own file counts (52 files, 21 issues) were **not** independently recounted. A sample of R2's specific claims was re-verified instead (see "Verification of the research reports").

No external software was executed. No test suite of an external project was run. No NewsFlux product code was changed.

## Evidence classification

| Label                  | Meaning in this document                                                         |
| ---------------------- | -------------------------------------------------------------------------------- |
| `CODE_VERIFIED`        | Read in source at the stated repository and ref                                  |
| `TEST_VERIFIED`        | A test at the stated ref asserts the behaviour (the test was read, not executed) |
| `HISTORY_VERIFIED`     | Commit, issue or pull-request history at the stated ref or page                  |
| `DOC_VERIFIED`         | Stated in the project's own documentation or source comments                     |
| `OBSERVED`             | Behaviour seen from a running product (none in this review; reserved)            |
| `RESEARCH_REPORT_ONLY` | Stated by R1/R2/R3 and **not** re-verified here                                  |
| `INFERENCE`            | Reasoned from verified facts                                                     |
| `HYPOTHESIS`           | Plausible and untested                                                           |
| `UNKNOWN`              | Not determined                                                                   |

Closed-source statements use the vocabulary `CURRENT_FACT`, `HISTORICAL_FACT`, `OBSERVABLE_BEHAVIOR`, `MARKETING_CLAIM`, `INFERENCE`, `UNKNOWN`. A vendor statement is never reported as a known implementation.

## References reviewed

| Project                                                                 | Ref (commit)                                                                                                        | Ref date   | License                                                            | Depth                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| NewsFlux (`jfsdias/NewsFlux`)                                           | `b6b7246642aa5ff15f3f8e7015d2efbd83a47be5`                                                                          | 2026-10-21 | see repository                                                     | Relevant source, tests, docs                                            |
| Miniflux (`miniflux/v2`)                                                | `bdd8087d9cf7a20ca7e800948389e8a7e86445da` (also read at tag `v2.3.4` = `238c5614e584ebc87894e7d9f10bc91373a0b2c2`) | 2026-10-20 | Apache-2.0                                                         | Finder, discovery API, fetcher/SSRF, filters, dedup hash, search, tests |
| NewsBlur (`samuelclay/NewsBlur`)                                        | `af6bf230472a0cdbba1a8b50f3ddf10bf0a64a58`                                                                          | 2026-10-20 | MIT                                                                | Clustering, classifiers, briefing, discover, tests, history             |
| FreshRSS (`FreshRSS/FreshRSS`, branch `edge`)                           | `0addf32b36bc90cc038bc518d7a14096efc3bd55`                                                                          | 2026-10-20 | AGPL-3.0                                                           | Saved queries, filter actions, priority, tests, history                 |
| NetNewsWire (`Ranchero-Software/NetNewsWire`)                           | `d732f6dc7693d748bf5b95e185c62281a260c746`                                                                          | 2026-10-20 | MIT                                                                | FeedFinder, scoring heuristic, tests                                    |
| RSS-Bridge (`RSS-Bridge/rss-bridge`)                                    | `e57fc55e560bacd2947abbff3a6c7a0f335a87a8`                                                                          | 2026-10-19 | Unlicense (public domain); dependencies carry their own licenses   | `findfeed`, `detectParameters`, SSRF configuration, tests               |
| Nextflux (`electh/nextflux`)                                            | `6fe3f83f6ecdbb55a63292d5908d7101d38a48fc`                                                                          | 2026-10-17 | **No license file; README gives an informal permission statement** | Storage, search, recommendation-related search                          |
| Feedbin (`feedbin/feedbin`) — found by this review                      | `f7f0bef0e2e0f4200f45ede26a40c835054cb18b`                                                                          | 2026-10-17 | MIT                                                                | Query-based actions, saved searches, suggested categories               |
| feedsearch-crawler (`DBeath/feedsearch-crawler`) — found by this review | `30fc66455f3f2d6e49266fb47dbb400e777e801b`                                                                          | 2026-09-24 | MIT                                                                | Feed-resolution scoring, crawler limits                                 |

History for the shallow-risk files was read through full-history partial clones (commits and trees, blobs on demand). Upstream ReactFlux was checked only for its head (`ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036`, identical to `LAST_FORMALLY_REVIEWED_UPSTREAM_SHA` in the project state); no upstream audit was performed.

## NewsFlux current architecture

All items below are `CODE_VERIFIED` at `b6b7246`.

- **Frontend only.** React client talking to Miniflux's `/v1` API. State: `settingsState`, `authState` and `hotkeysState` are `persistentAtom`s (browser storage); `dataState`, `contentState` and search are in memory (`src/store/*.js`). There is no NewsFlux backend or database.
- **Home** requests only `status=unread`, ordered by `published_at desc` (`src/utils/home-entry-request.js`). Personalization is Home-only and deterministic: at most `HOME_STARRED_PROFILE_LIMIT = 75` currently starred entries feed a per-session source/category count profile; a `HOME_PERSONALIZATION_FRESHNESS_WINDOW` of one hour bounds reordering (`src/utils/home-personalization-constants.js`, `home-personalization-profile.js`, `home-personalization-projection.js`).
- **Search** is source-scoped article search. The text is sent as Miniflux's `search` parameter and held in `contentState.filterString` (in memory; it is **not** reflected in the URL).
- **Add Feed** checks duplicates by literal string equality (`feeds.some((feed) => feed.feed_url === url)`, `src/components/Main/Main.jsx` line 105) and then calls `POST /v1/feeds` (`src/apis/feeds.js`). It never calls `/v1/discover`.
- **Feed rules** (FILTER-RULES-01) edit the **legacy regex fields** `blocklist_rules` and `keeplist_rules` on a feed (`src/apis/feeds.js` and `feeds.test.js`). NewsFlux does not use the newer `block_filter_entry_rules` / `keep_filter_entry_rules` fields (see Rules).
- **Duplicates.** `removeDuplicates` is a user setting (`none` by default, `hash`, `title`, `url`; `src/utils/settings-schema.js`) implemented by `removeDuplicateEntries` (`src/utils/deduplicate.js`). Unread duplicates are then **marked read on Miniflux** (`markDuplicatesAsRead`, `src/hooks/useEntryActions.js`). It never applies to Home or to Starred/History.
- **Visibility.** `hide_globally` is already used for feeds and categories (`src/apis/feeds.js`, `src/apis/categories.js`).
- **Existing capability that overlaps proposed work:** feed health (`src/utils/feed-health.js`), bulk read operations, selective multi-select, reader previous/next, PWA service worker, settings export/import (`src/utils/settings-transfer.js`).

## Verification of the research reports

Only claims that could be checked against code or history here are listed. Everything else keeps the status the report gave it.

| Claim (report)                                                                                                          | Verdict                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NewsBlur fuzzy clustering uses overlap coefficient, not Jaccard (R2)                                                    | **CONFIRMED**                                              | `CODE_VERIFIED`: `find_title_clusters` in NewsBlur `apps/clustering/models.py` computes `intersection / min(len(a), len(b))`; constants `FUZZY_SIMILARITY_THRESHOLD = 0.6`, `FUZZY_MIN_INTERSECTION = 3`, `FUZZY_MIN_WORDS = 5`. The docstring still says "Jaccard" (stale). `HISTORY_VERIFIED`: commit `51e1ece3a` (2026-02-23) "Fix fuzzy title clustering for aggregator-style headlines".                                                                    |
| NewsBlur Briefing caps stories per feed (R2 refutes R1's "no caps")                                                     | **CONFIRMED**                                              | `CODE_VERIFIED`: `max_per_feed = 3` at `apps/briefing/scoring.py` line 321.                                                                                                                                                                                                                                                                                                                                                                                      |
| NewsBlur semantic layer queries with the title only                                                                     | **CONFIRMED**                                              | `CODE_VERIFIED`: `find_semantic_clusters` uses `query_text = story.get("story_title")`, `more_like_this` over fields `title` and `content`, `size: 5`, `max_query_terms: 25`. Acceptance floors `SEMANTIC_MIN_TITLE_INTERSECTION = 4` and `SEMANTIC_MIN_OVERLAP_COEF = 0.45`.                                                                                                                                                                                    |
| NewsBlur classifier scope is eligibility; precedence is prompt > `-2` veto > best positive > worst negative > feed (R2) | **CONFIRMED**                                              | `CODE_VERIFIED`: `compute_story_score` in `apps/analyzer/models.py`. Classifier documents carry `scope` in `feed`/`folder`/`global` and `folder_name`. `TEST_VERIFIED`: `apps/analyzer/tests.py` (82 test methods in the file; the specific tests R2 cites were not re-read).                                                                                                                                                                                    |
| NewsBlur Discover Sites uses OpenAI embeddings plus Elasticsearch, not local computation (R2)                           | **CONFIRMED**                                              | `CODE_VERIFIED`: `generate_feed_content_vector` in `apps/search/models.py` builds text from feed title, tagline, story titles and tags and calls `text-embedding-3-small`; `discover_feeds` in `apps/discover/views.py` returns up to five feeds with five preview stories each.                                                                                                                                                                                 |
| Miniflux does **not** always try native feeds before RSS-Bridge (R2 refutes R1)                                         | **CONFIRMED**                                              | `CODE_VERIFIED`: `FindSubscriptions` order is direct feed → canonical URL → YouTube → GitHub → HTML meta tags → RSS-Bridge (if configured) → well-known paths.                                                                                                                                                                                                                                                                                                   |
| NetNewsWire PR #5327 (page-specific feed vs `<head>` feed)                                                              | **CONFIRMED, with a correction to the outcome**            | `HISTORY_VERIFIED`: the page shows the PR closed without merge on 2026-08-02; the maintainer fixed the case with a site-specific special case instead of a general rule. R2's "documenta" is accurate; a reader should not infer the general fix was adopted.                                                                                                                                                                                                    |
| FreshRSS #8619 "mostra duplicação de URL/OPML" (R2)                                                                     | **CONFIRMED, with a sharper reading**                      | `HISTORY_VERIFIED`: open since 2026-03-20; a dynamic OPML re-adds feeds roughly daily because permanent (301) redirects make FreshRSS store the redirected URL, so the original URL looks new. This is a source-identity failure, not only a URL-equality one.                                                                                                                                                                                                   |
| Miniflux #2991 "registra lacunas de descoberta" (R2)                                                                    | **CONFIRMED**                                              | `HISTORY_VERIFIED`: open since 2024-12-08; asks Miniflux to adopt discovery techniques (autodiscovery, alternates, sitemaps, common suffixes). Its sitemap PR (#2996) was closed unmerged on 2025-07-01 with no maintainer review recorded.                                                                                                                                                                                                                      |
| RSS-Bridge #4889 (R2: "alerta de token em findfeed")                                                                    | **CONFIRMED, with a correction of nature**                 | `HISTORY_VERIFIED`: it is a usability bug (the access token is not passed by the "Find Feed from URL" action), not a security alert. Open; a maintainer notes a fix needs refactoring.                                                                                                                                                                                                                                                                           |
| Nextflux has no standard license (R2)                                                                                   | **CONFIRMED**                                              | `CODE_VERIFIED`: no `LICENSE`/`COPYING` file; the README licence section is an informal permission statement. `COPY_ALLOWED=NO` until the owner clarifies.                                                                                                                                                                                                                                                                                                       |
| NewsFlux Home profile uses at most 75 starred entries and a one-hour window (R3)                                        | **CONFIRMED**                                              | `CODE_VERIFIED`: `src/utils/home-personalization-constants.js`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| NewsFlux Add Feed has a literal `feed_url` duplicate check and never calls `/v1/discover` (R3)                          | **CONFIRMED**                                              | `CODE_VERIFIED`: `src/components/Main/Main.jsx` line 105; `src/apis/feeds.js`; no `discover` call in `src/`.                                                                                                                                                                                                                                                                                                                                                     |
| NewsFlux has no persistent store for an interest map and `localStorage` is not a sync layer (R3)                        | **CONFIRMED**                                              | `CODE_VERIFIED`: only `settings`, `auth` and `hotkeys` are persisted.                                                                                                                                                                                                                                                                                                                                                                                            |
| "Miniflux `/v1/discover` resolves feed candidates, not interests" (R3)                                                  | **CONFIRMED, and narrower than implied**                   | `CODE_VERIFIED`: the response is `[{title, url, type}]` only (`internal/reader/subscription/subscription.go`). It returns **no entries**, so it cannot power a content preview.                                                                                                                                                                                                                                                                                  |
| R3: automatic `/v1/discover` on third-party URLs needs an SSRF review of the Miniflux instance                          | **PARTIAL — the risk is lower by default than R3 assumed** | `CODE_VERIFIED` at tag `v2.3.4`: `FETCHER_ALLOW_PRIVATE_NETWORKS` defaults to `false`; the fetcher checks the resolved IP at connect time (`internal/reader/fetcher/request_builder.go`, `Control` hook; `internal/http/client/client.go`, `DialContext`), which is DNS-rebinding-resistant by design. The risk returns if the operator enabled the flag, which homelab operators often do to follow internal feeds. The deployment's actual value is `UNKNOWN`. |
| R1's ARTICLE/SOURCE/DISCOVERY score formulas and all weights                                                            | **REFUTED (by R2) and agreed here**                        | `INFERENCE`: no repository reviewed publishes any weighted article-score formula transferable to a single-user reader. NewsBlur's visible scoring is rule precedence, not a weighted sum.                                                                                                                                                                                                                                                                        |
| R2/R3 count claims (52 files, 11 tests, 21 issues/PRs reviewed)                                                         | **UNVERIFIED**                                             | `RESEARCH_REPORT_ONLY`. Eleven of those items were spot-checked and none contradicted R2.                                                                                                                                                                                                                                                                                                                                                                        |

### Where this review disagrees with, or adds to, the reports

1. **Add Feed is not "native detection delegated to Miniflux".** `POST /v1/feeds` runs `CreateFeed`, which fetches and parses the given URL as a feed; the subscription finder is called only by `POST /v1/discover`, the Miniflux web UI and the Google-Reader-compatible endpoint (`internal/reader/handler/handler.go`; callers of `FindSubscriptions`). A user who pastes a site URL into NewsFlux therefore gets a failure, not discovery. `CODE_VERIFIED`. This is a concrete, already-available gap that no report singled out.
2. **Miniflux has user-level filter rules**, not only feed-level ones: `block_filter_entry_rules` and `keep_filter_entry_rules` exist on both the user and the feed models at `v2.3.4`. `CODE_VERIFIED`. R2/R3 do not mention them. They are evaluated at ingestion, not retroactively (see Rules).
3. **NewsBlur Discover works because NewsBlur has a global feed corpus** (every feed fetched for every user). `INFERENCE` from `discover_feeds` / `discover_stories`: both return feeds the requesting user does not subscribe to by querying that shared corpus. A single-user NewsFlux + Miniflux installation has only the user's own feeds, so the pattern is not portable without importing an external catalog (G5/G7 in R3).
4. **A Miniflux API user cannot preview an unsubscribed feed's items.** There is no preview endpoint in `internal/api/api.go`; discovery returns URLs and titles only. A preview needs either subscribe-then-delete (a mutation, rejected by the project's read-only principle), a client-side fetch (blocked by CORS), or a new server component. `CODE_VERIFIED` for the API surface; the conclusion is `INFERENCE`.

## Reverse-engineered reference implementations

The field list follows the requested standard. Fields that do not apply are omitted rather than padded.

### NewsBlur — story clustering

```text
FEATURE=Same-story clustering (title tier and semantic "related" tier)
PROJECT=NewsBlur   LICENSE=MIT   REF=af6bf230472a0cdbba1a8b50f3ddf10bf0a64a58
PRIMARY_FILES=apps/clustering/models.py, apps/clustering/tasks.py, apps/clustering/tests.py
CORE_FUNCTIONS=normalize_title, title_significant_words, find_title_clusters, find_semantic_clusters, merge_clusters, store_clusters_to_redis, apply_clustering_to_stories
DATA_MODEL=Redis sets/sorted sets: sCL:/zCL: (title + related merged) and sCLt:/zCLt: (title-only); member score encodes tier (1 title, 2 related)
PERSISTENCE=Redis with 14-day TTL (CLUSTER_TTL_SECONDS); cluster size capped at CLUSTER_MAX_SIZE = 10
INPUTS=Story title, story GUID hash, feed id, feed title, branch-of-feed mapping, story date
ALGORITHM=(1) exact normalized title; (2) significant-word overlap coefficient >= 0.6 with intersection >= 3 and >= 5 words, English stopword list, trailing-"s" stem, numeric tokens dropped, words that also appear in the feed title removed, words appearing in more than 50 candidates skipped; (3) Elasticsearch more_like_this on the title for a second "related" tier, accepted only with title intersection >= 4 and overlap >= 0.45; groups merged with union-find
EXECUTION_LOCATION=SERVER, Celery task after feed updates
TESTS=apps/clustering/tests.py — aggregator headlines, shared topic word (no cluster), same-feed not clustered, exact title, scientific jargon false positive, feed-name prefix false positive, numeric/date false positive, generic short title, same-feed folding
FAILURE_MODES=Transitive chaining through union-find; English-only stopwords; jargon-heavy feeds; aggregator titles twice as long as originals; cross-run merge pollution
PERFORMANCE_MODEL=Inverted index over title words to avoid O(n^2); Elasticsearch queries instrumented and capped
PRIVACY_MODEL=Server-side, operates on the shared corpus
WHY_IT_EXISTS=Many feeds report one event; the user asked to see it once
WHAT_CHANGED_HISTORICALLY=51e1ece3a (2026-02-23) Jaccard -> overlap coefficient for aggregator headlines; cfce6b570 (2026-03-18) numeric tokens dropped and >= 3 shared words required when merging into existing clusters ("Tested against 8391 production clusters: 95.2% unchanged"); 0e86d3726 (2026-04-10) separate Title and Title+Related modes with tier badges after a semantic false positive; ca728162d (2026-10-03) a feed's own distinct stories are no longer folded together through indirect links
NEWSFLUX_REUSE_POTENTIAL=Idea reuse high; code reuse none (Python/Redis/Elasticsearch)
COPY_ALLOWED=REIMPLEMENT_ONLY (MIT permits copying, but the design is infrastructure-bound)
```

The history is the most valuable finding: every threshold was moved by a measured false positive, and the maintainers split the product into **Title** and **Title+Related** modes rather than make the semantic tier invisible. `HISTORY_VERIFIED`.

### NewsBlur — explicit classifiers and scoring

```text
FEATURE=Explicit like/dislike rules (title, author, tag, text, URL, feed) with feed/folder/global scope
PRIMARY_FILES=apps/analyzer/models.py, apps/analyzer/tests.py
CORE_FUNCTIONS=compute_story_score, ScopedClassifiers, apply_classifier_*
DATA_MODEL=MongoDB documents with user_id, feed_id, score, scope in {feed, folder, global}, folder_name
ALGORITHM=prompt score (if non-zero) wins; otherwise any attribute score <= -2 wins; otherwise the maximum positive; otherwise the minimum negative; otherwise the feed's own score. Regex variants require a paid tier. Scope decides which rules apply, not which wins.
EXECUTION_LOCATION=SERVER (the client only displays the resulting score)
PERFORMANCE_MODEL=ScopedClassifiers pre-buckets rules by (scope, feed_id); added after a production time-limit incident for users with tens of thousands of rules (code comment)
PRIVACY_MODEL=Per-user rules on the server; no cross-user signal in this path
WHY_IT_EXISTS=Explicit, reversible, inspectable training instead of an opaque model
NEWSFLUX_REUSE_POTENTIAL=Idea: explicit, scoped, visible rules. Not code.
COPY_ALLOWED=REIMPLEMENT_ONLY
```

### NewsBlur — Briefing and Discover

```text
FEATURE=Briefing selection (explicit + implicit + collective signals, per-feed cap)
PRIMARY_FILES=apps/briefing/scoring.py (max_per_feed = 3 at line 321), apps/briefing/tasks.py, apps/briefing/tests.py
FAILURE_MODES/TRANSFER=Uses global reading statistics and feed engagement that a single-user deployment does not have. Not transferable as a formula.

FEATURE=Discover related sites and stories
PRIMARY_FILES=apps/discover/views.py, apps/search/models.py (generate_feed_content_vector, vector/hybrid queries), apps/rss_feeds/models.py (find_similar_feeds)
ALGORITHM=Feed vector from title + tagline + story titles + tags, URLs and punctuation stripped, embedded with a hosted model, stored in Elasticsearch; k-NN over the global corpus
EXECUTION_LOCATION=SERVER + third-party embedding API
PRIVACY_MODEL=Feed content (not personal reading) leaves the host; the official post states co-subscription is not used for this feature (DOC, not re-checked here)
NEWSFLUX_REUSE_POTENTIAL=Pattern only: show a few recent titles when proposing a source. Requires a catalog NewsFlux does not have.
```

### Miniflux — feed discovery, fetch safety, rules, dedup, search

```text
FEATURE=Subscription discovery
PROJECT=Miniflux   LICENSE=Apache-2.0   REF=bdd8087d9cf7a20ca7e800948389e8a7e86445da (and v2.3.4)
PRIMARY_FILES=internal/reader/subscription/finder.go, finder_test.go (621 lines), internal/api/subscription_handlers.go, internal/integration/rssbridge/rssbridge.go
ALGORITHM=Fetch the URL once; if it parses as a feed return it; else parse HTML, resolve canonical URL, special-case YouTube and GitHub, read <link rel=alternate> tags, ask RSS-Bridge (only if the user configured it), then probe well-known paths
INPUTS=URL plus optional user agent, cookie, basic auth, proxy, TLS and HTTP/2 flags
OUTPUTS=[{title, url, type}] — no items
EXECUTION_LOCATION=SERVER
PERFORMANCE_MODEL=One body fetch bounded by HTTPClientMaxBodySize and HTTPClientTimeout
PRIVACY_MODEL=The Miniflux host contacts the target site; NewsFlux never does
WHY_IT_EXISTS=Add-subscription UX; the API exposes it as POST /v1/discover
HISTORY=#2991 asks for more techniques; the sitemap PR #2996 was closed without maintainer review; RSS-Bridge was inserted before the well-known paths
NEWSFLUX_REUSE_POTENTIAL=Direct: call it. NewsFlux already holds the Miniflux session.
COPY_ALLOWED=Not needed (call the API)

FEATURE=Fetcher safety
PRIMARY_FILES=internal/reader/fetcher/request_builder.go (private-network check and dialer Control hook, around lines 207-215), internal/http/client/client.go (DialContext), internal/urllib/url.go (IsNonPublicIP), internal/config/options.go
ALGORITHM=Unless FETCHER_ALLOW_PRIVATE_NETWORKS is true, the dialer rejects non-public destination IPs at connect time, on the address actually dialed, so resolution cannot change between check and use. A separate INTEGRATION_ALLOW_PRIVATE_NETWORKS covers integrations.
DEFAULT=false at v2.3.4 (parsedBoolValue: false)
NEWSFLUX_IMPLICATION=Miniflux is the right place for candidate fetching; NewsFlux must not add its own fetcher.

FEATURE=Entry filter rules
PRIMARY_FILES=internal/reader/filter/filter.go (+ filter_test.go), internal/reader/processor/processor.go (call sites), internal/model/user.go, internal/model/feed.go
DATA_MODEL=Text, one rule per line, "Type=regex" with types EntryTitle, EntryURL, EntryCommentsURL, EntryContent, EntryAuthor, EntryTag, EntryDate; stored on the user and on the feed; the older blocklist_rules / keeplist_rules regex fields still exist on the feed
ALGORITHM=Order documented in the package comment: user block, feed block, user keep, feed keep; first match stops; invalid rules are ignored; RE2 syntax; compiled regexes are cached (up to 1024)
EXECUTION_LOCATION=SERVER at refresh time (processor.go lines 75 and 147)
FAILURE_MODES=Rules act on newly fetched entries only; they do not retroactively hide existing entries. Invalid lines are silently ignored.
HISTORY=Regex caching added in 651fbd15; parse-and-merge once per refresh in 0c3e2518
NEWSFLUX_REUSE_POTENTIAL=High for "mute topic/author/URL" without a NewsFlux store

FEATURE=Entry identity (hash) and dedup
ALGORITHM=Entry.Hash = SHA-256 of the GUID, or GUID+URL / GUID+index when GUIDs repeat, or of the URL, or of title+content (internal/reader/rss/adapter.go). The database enforces unique (feed_id, hash), so dedup is per feed only.
CONSEQUENCE=NewsFlux's removeDuplicates "hash" option can match across feeds only when two feeds publish the same GUID; "url" and "title" are exact-string comparisons. None of the three is near-duplicate or same-event detection.

FEATURE=Search
ALGORITHM=PostgreSQL full text: document_vectors @@ websearch_to_tsquery(...), ordered by ts_rank minus a small recency term (internal/storage/entry_query_builder.go)
CONSEQUENCE=Server-side search is already semantic enough for query-by-keyword and supports websearch syntax; no new index is needed for a saved query.

FEATURE=Pagination
API=entries accept before_entry_id, after_entry_id, published_before and globally_visible (internal/api/entry_handlers.go). Entry-id cursors are stable under inserts; published_before is not strictly unique.
```

### FreshRSS — saved queries, filter actions, priority

```text
FEATURE=Saved query ("user query")
PROJECT=FreshRSS   LICENSE=AGPL-3.0   REF=0addf32b36bc90cc038bc518d7a14096efc3bd55
PRIMARY_FILES=app/Models/UserQuery.php, app/Models/BooleanSearch.php, tests/app/Models/UserQueryTest.php
DATA_MODEL=Per-user configuration (not a database table): name, get (category / feed / label / important / favorites), order, state, search string, optional share token for an RSS/OPML export of the query
ALGORITHM=A query is a descriptor that expands into a normal search; it can be nested; queries that reference a category, feed or label that no longer exists are flagged deprecated (isDeprecated) instead of silently returning nothing
FAILURE_MODES/HISTORY=Search length and parenthesis nesting depth are limited (commit dc5cf822, #9277); fixes for unwanted expansion of nested queries (#8395)
NEWSFLUX_REUSE_POTENTIAL=The design lesson is the deprecated flag and the descriptor-only model. The storage (a per-user config) is exactly the decision NewsFlux has not made.
COPY_ALLOWED=NO (AGPL-3.0: reimplement the idea only)

FEATURE=Filter actions (search -> action)
PRIMARY_FILES=app/Models/FilterAction.php, app/Models/FilterActionsTrait.php
ALGORITHM=Each action is {search, actions[]} with actions read | star | label, applied to an entry at fetch time; updated entries are skipped so a user's manual action is never overruled (code comment)

FEATURE=Feed priority
PRIMARY_FILES=app/Models/Feed.php
DATA_MODEL=Constants PRIORITY_IMPORTANT = 20, MAIN_STREAM = 10, CATEGORY = 0, FEED = -5, HIDDEN = -10
NEWSFLUX_IMPLICATION=A user-chosen priority is an explicit, cheap, explainable signal; Miniflux has no equivalent field (INFERENCE from the model files reviewed).

FEATURE=Feed identity
HISTORY=#8619 (open): permanent redirects cause duplicate subscriptions from a dynamic OPML because only the redirected URL is stored.
```

### NetNewsWire — FeedFinder

```text
FEATURE=Feed finding from a URL
PROJECT=NetNewsWire   LICENSE=MIT   REF=d732f6dc7693d748bf5b95e185c62281a260c746
PRIMARY_FILES=Modules/FeedFinder/Sources/FeedFinder/FeedFinder.swift, FeedSpecifier.swift, HTMLFeedFinder.swift, Tests/FeedFinderTests/FeedFinderTests.swift
ALGORITHM=special-case table -> direct feed -> HTML <head> links -> body link candidates; candidates scored by FeedSpecifier.calculatedScore (user-entered = 1000; <head> +50; later-found -5 per position; "comments"/"podcast" -10; "rss" +5; /index.xml +5; /feed/ +5; /feed +4; "json" +3)
EXECUTION_LOCATION=CLIENT (the app is the fetcher; there is no CORS problem on native)
TESTS=4 test methods (an example test, two special-case tests, one body-links test)
FAILURE_MODES=Hard-coded special cases (a podcast-network blog and a personal blog are named in the source); PR #5327 shows the maintainer preferring a site-specific fix to a general rule because a general rule might break other sites
PRIVACY_MODEL=The user's device contacts the site; an Activity Log makes each fetch visible
NEWSFLUX_REUSE_POTENTIAL=Idea: show the user why a candidate feed was chosen. The heuristic constants are not evidence for NewsFlux.
```

### RSS-Bridge — feed conversion and fetch safety

```text
FEATURE=findfeed (URL -> bridge parameters)
PROJECT=RSS-Bridge   LICENSE=Unlicense   REF=e57fc55e560bacd2947abbff3a6c7a0f335a87a8
PRIMARY_FILES=actions/FindfeedAction.php, lib/BridgeAbstract.php, tests/BridgeImplementationTest.php, lib/contents.php, config.default.ini.php
ALGORITHM=Iterate every enabled bridge and call detectParameters($url); return all that claim the URL
COVERAGE=552 entries in bridges/, of which 43 files implement detectParameters and 15 declare TEST_DETECT_PARAMETERS fixtures (counted by grep) — so URL-to-bridge detection covers a small minority of bridges
FETCH SAFETY=Default allow_private_addresses = false and allow_reserved_addresses = false; the resolved address is checked and pinned for the request (DNS-rebinding comment in lib/contents.php); follow-redirects defaults to false with the comment "enabling this allows SSRF attack"; max_filesize = 20 MB. The resolver path reads A records through Ipv4Address; IPv6 handling was not examined (UNKNOWN).
NEWSFLUX_IMPLICATION=Fallback converter only; selection is by URL pattern, not by interest; "no bridge found" (404) is a normal result.
```

### Nextflux

```text
FEATURE=Miniflux client with local cache (comparison point for NewsFlux)
PROJECT=Nextflux   LICENSE=none (informal README statement)   REF=6fe3f83f6ecdbb55a63292d5908d7101d38a48fc
PRIMARY_FILES=src/db/database.js (IndexedDB via Dexie, versioned stores), src/db/repositories/articleRepository.js
FINDING=No recommendation, ranking, clustering or dedup code was found by searching the source tree and commit subjects.
COPY_ALLOWED=NO (no license grant)
```

### Feedbin (found by this review)

```text
FEATURE=Query-based actions (rules) with preview, and saved searches
PROJECT=Feedbin   LICENSE=MIT   REF=f7f0bef0e2e0f4200f45ede26a40c835054cb18b
PRIMARY_FILES=app/models/action.rb, app/models/saved_search.rb, app/models/suggested_category.rb, test/models/action_test.rb, test/models/saved_search_test.rb
DATA_MODEL=Action(user, feed ids / tag ids / all-feeds, query, action_type in {standard, notifier, mute}, status in {active, suspended, broken}); SavedSearch(user, name, query)
ALGORITHM=An action's query is stored as an Elasticsearch percolator document; each new entry is percolated and the matching actions applied; "apply to existing" runs a bulk job; action.results previews the matching entries before saving; both Action and SavedSearch validate the query on save (a source comment explains an unclosed quote otherwise "returns nothing forever with no error")
EXECUTION_LOCATION=SERVER + Elasticsearch
SUGGESTED_FEEDS=SuggestedCategory / SuggestedFeed are seeded tables: an editorial directory for cold start
NEWSFLUX_REUSE_POTENTIAL=Idea: preview-before-save and validate-on-save. Not the percolator.
COPY_ALLOWED=YES for ideas; code is infrastructure-bound
```

### feedsearch-crawler (found by this review)

```text
FEATURE=Feed resolution with scoring
PROJECT=feedsearch-crawler   LICENSE=MIT   REF=30fc66455f3f2d6e49266fb47dbb400e777e801b
PRIMARY_FILES=src/feedsearch_crawler/feed_spider/feed_info_parser.py (score_item), crawler/middleware/{robots,throttle,retry}.py, tests/feed_spider/*
ALGORITHM=Crawl from a URL to a bounded depth, collect feed candidates, score by host match (-20 if the feed host differs), path depth, malformed feed (-20), missing description (-10), "comments" (-15), feedburner (-10), https (+10), push hub (+10), "index" (+30)
SAFETY=robots, throttle and retry middleware exist; a search of the source for private-address or SSRF handling found none (UNKNOWN whether handled elsewhere)
NEWSFLUX_REUSE_POTENTIAL=Confirms that feed resolution is a heuristic with hand-set constants (as in NetNewsWire); neither set of constants is validated against a corpus.
```

## Closed-source products (qualified)

Evidence is limited to `WebSearch` summaries of the vendors' own pages. No page was read in full. The internal implementation of every product below is `UNKNOWN`.

| Product         | Statement                                                                                                                                                                                                                                                                                                                                                                                                                   | Class                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Feedly          | Help documentation says content-based deduplication treats articles with more than 85% content overlap as duplicates, looks back 31 days, applies only across different sources, cannot deduplicate entries under 200 characters, and does not work in third-party apps that use Feedly as a sync backend.                                                                                                                  | `CURRENT_FACT` (vendor-documented); algorithm `UNKNOWN`                  |
| Feedly          | A separate help article says clustering groups articles about the same topic or event instead of removing them, shows an "Also in" section, and offers marking all clustered versions read.                                                                                                                                                                                                                                 | `CURRENT_FACT` (vendor-documented)                                       |
| Feedly          | The vendor's 2018 engineering post describes a topic taxonomy built from how users name their feeds and says source recommendations are ranked on three criteria, the first being relevance defined as the share of users who added the source to a topic. The other two criteria were not visible in the summary.                                                                                                          | `HISTORICAL_FACT`; whether it still runs is `UNKNOWN`                    |
| Feedly          | Source sort options include "Best Match" described as a balance of popularity and relevance, with relevance emphasising focus.                                                                                                                                                                                                                                                                                              | `OBSERVABLE_BEHAVIOR` (documented)                                       |
| Inoreader       | Filters are of two kinds, content filters and duplicate filters; content filters keep or hide by title, content, author, URL, attachments, language or RSS category with AND/OR; duplicate filters take a source, conditions and a comparison window. Rules (separate) run actions such as tag, read-later, notify, mark read, webhook; "Run rule" tests a rule before saving; Pro includes 30 rules (a January 2026 post). | `CURRENT_FACT` (vendor-documented); limits may change                    |
| Google News     | Google's 2008 blog post says it groups articles about the same story into clusters and removed an earlier three-day cluster limit. Later "Full Coverage" descriptions come from third parties.                                                                                                                                                                                                                              | `HISTORICAL_FACT` (2008, primary); later mechanics `INFERENCE`/`UNKNOWN` |
| Reeder, ReadKit | R2 reports vendor pages describing smart folders (ReadKit), mark-as-read-on-scroll and server-backed read state. Not re-checked here.                                                                                                                                                                                                                                                                                       | `RESEARCH_REPORT_ONLY`                                                   |

Two consequences are drawn, both `INFERENCE`: (a) Feedly separates "duplicate" (>85% overlap) from "same event" (clustering) in two different products surfaces, so NewsFlux should not use one number for both; (b) Inoreader's "Run rule" and Feedbin's "View Results" both preview a rule's effect before saving, which two independent products suggests is a real need and not decoration.

## Curation and personalization

**How the references do it**

- **NewsBlur:** explicit scoped rules plus feed-level scores decide visibility tiers (Focus / Unread / Hidden). The state lives on the server. Rules are created by the user's own like/dislike actions. No weighted blend. Cold start is neutral (everything unread). Correction is deleting the rule. `CODE_VERIFIED`.
- **FreshRSS:** an explicit per-feed priority with five levels. State is feed configuration. No inference. `CODE_VERIFIED`.
- **Feedly / Inoreader:** per-user preference and collection mechanics exist but internals are `UNKNOWN`.
- **No reviewed open-source reader infers topic affinity from read/unread.** `INFERENCE` from the files reviewed (NewsBlur's implicit terms in Briefing come from opens and feed engagement, not from the read flag alone, per R2; not re-verified line by line here).

**NewsFlux mapping**

| Aspect                                    | Reference implementation                                            | Current NewsFlux                                                                           | Gap                                                  | Can reuse Miniflux                         | Client-only               | New persistence      | Server | Fetch security | Privacy                           | Complexity | Recommendation                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------ | ------------------------- | -------------------- | ------ | -------------- | --------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Explicit user-declared interests (topics) | NewsBlur classifiers; Feedly topics                                 | None. Home uses starred counts only (`src/utils/home-personalization-*`)                   | Declared interests                                   | Partly (categories, feed priority concept) | Yes if stored in settings | **Yes** if durable   | No     | No             | High if inferred; low if declared | Medium     | **ADAPT** — explicit only; requires the storage decision                           |
| Feed/source priority                      | FreshRSS `Feed::PRIORITY_*`                                         | None                                                                                       | A cheap explicit signal                              | No (no Miniflux field found)               | Yes in settings           | Yes (settings-level) | No     | No             | Low                               | Low        | **RESEARCH** — decide where the value lives                                        |
| Negative feedback / mute source           | NewsBlur `-2` veto; FreshRSS hidden priority; Feedbin `mute` action | `hide_globally` on feeds/categories exists                                                 | Mute **topic/author**                                | Yes (`block_filter_entry_rules`)           | n/a                       | No                   | No     | No             | Low                               | Low        | **ADAPT** (provider-backed)                                                        |
| Diversity and repetition control          | NewsBlur `max_per_feed = 3` (Briefing only)                         | Home has soft source/category diversity                                                    | Event-level repetition                               | n/a                                        | Yes                       | No                   | No     | No             | None                              | Medium     | **ALREADY_COVERED** for source/category; event-level depends on Story Intelligence |
| Explanation                               | NewsBlur displays rule/tier source                                  | One info affordance beside Highlights; no per-card reason by design (Phase 2D V1 spec §21) | Per-card reasons would reverse a documented decision | n/a                                        | Yes                       | No                   | No     | No             | None                              | Low        | **HOLD** until explicit signals exist                                              |
| Weighted article score                    | None found in any reviewed reader                                   | None                                                                                       | —                                                    | —                                          | —                         | —                    | —      | —              | —                                 | —          | **REJECT** (no precedent; R2 §9)                                                   |

**Falsification attempt.** The strongest argument for "declared interests" is that NewsBlur does it; the strongest argument against is that NewsBlur stores them server-side in a service built to hold them, and that every reviewed system that has them also has an account and a database. For NewsFlux the feature is only worth building after the persistence decision; before that it is a settings toggle that disappears with the browser profile.

## Story intelligence

**How the references do it**

| System           | Identity                                                        | Near-duplicate                                                | Same event                                                 | Where  | Persistence                                    |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ---------------------------------------------- |
| Miniflux         | `(feed_id, hash)` unique                                        | none                                                          | none                                                       | server | database                                       |
| NewsFlux (today) | optional exact `hash`/`title`/`url` match across loaded entries | none                                                          | none                                                       | client | none; marks unread duplicates read on Miniflux |
| NewsBlur         | GUID hash                                                       | none                                                          | normalized title; overlap coefficient; ES `more_like_this` | server | Redis, 14-day TTL                              |
| Feedly           | `UNKNOWN`                                                       | >85% content overlap, 31 days, cross-source only (documented) | "clustering" (documented)                                  | server | `UNKNOWN`                                      |
| Inoreader        | URL / title / near-title options (documented)                   | duplicate filter with a comparison window                     | none documented                                            | server | `UNKNOWN`                                      |
| FreshRSS         | `(id_feed, guid)`                                               | none                                                          | none                                                       | server | database                                       |

Techniques actually found in code: normalized exact title, token overlap coefficient with minimum intersection, inverted-index candidate generation, Elasticsearch `more_like_this`, union-find grouping with a size cap, tier provenance. **Not found in any reviewed open-source reader:** TF-IDF, MinHash/LSH, named entities, local embeddings (the NewsBlur embeddings are for feeds, not stories). R2 lists those techniques as options; this review found no deployed reference for them in the readers examined. `CODE_VERIFIED` negative, limited to the files read.

**NewsFlux mapping.** The reachable, client-only mechanism is the NewsBlur tier-1 pattern computed over the entries NewsFlux has already loaded: normalized-title equality, then an overlap coefficient with a minimum-intersection guard, restricted to different feeds and a time window, with the cluster shown as one row plus alternatives. No new persistence and no fetch. Its limits: it sees only the loaded page; the stopword list and stemming are language-specific (NewsFlux's users are not all English readers); and the thresholds must be measured on a real corpus, not copied. NewsBlur's own clustering rules were adjusted repeatedly in response to false positives: at least three of the four commits listed above (`51e1ece3a`, `cfce6b570`, `0e86d3726`) changed matching behaviour for that reason (`HISTORY_VERIFIED`).

**Recommendation:** `ADAPT` as a **research-then-spec** item, Home-first and display-only. `REJECT` auto-marking alternatives read (NewsFlux's existing `markDuplicatesAsRead` already does this for exact duplicates; it should not be extended to events). Reason to hesitate: a false merge hides a distinct article, a trust cost that NewsBlur answers with a visible "Title" versus "Title+Related" mode.

## Source discovery

Candidate generation, feed resolution, ranking and follow are separate steps in every reference; none ranks sources by a single score.

| Step                 | Found in code                                                                                                                   | Notes                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Candidate generation | NewsBlur Discover (vector similarity over a global corpus); Feedbin seeded suggested categories; RSS-Bridge none; Miniflux none | The only code-level generators found need a catalog. |
| Feed resolution      | Miniflux `FindSubscriptions`; NetNewsWire `FeedFinder`; feedsearch-crawler; RSS-Bridge `findfeed`                               | All start from a URL the user already has.           |
| Ranking              | NetNewsWire and feedsearch-crawler rank **feed URLs for one site**, with hand-set constants; NewsBlur ranks by vector distance  | None ranks editorial quality.                        |
| Follow               | Always a user action                                                                                                            | Matches NewsFlux's rule.                             |

**NewsFlux mapping**

| Aspect                                       | Current NewsFlux                       | Gap                                                        | Can reuse Miniflux                                 | Client-only                                | New persistence  | Server                                      | Fetch security                                                    | Privacy                             | Complexity | Recommendation                                                                                  |
| -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| Resolve a pasted site URL                    | Fails unless the URL is already a feed | **Real, available now**                                    | **Yes**: `POST /v1/discover` then `POST /v1/feeds` | Yes (two API calls)                        | No               | No                                          | Delegated to Miniflux; default blocks private networks (`v2.3.4`) | The Miniflux host contacts the site | Low        | **ADOPT** as its own change, after confirming the deployment's `FETCHER_ALLOW_PRIVATE_NETWORKS` |
| Duplicate subscription check                 | Literal `feed_url` equality            | Redirects, `http`/`https`, trailing slash, alternate URLs  | No                                                 | Yes                                        | No               | No                                          | No                                                                | None                                | Low        | **ADAPT** — normalise and compare; FreshRSS #8619 is the cautionary tale                        |
| Preview of a candidate                       | None                                   | Cannot be built from `/v1/discover` (no items)             | No                                                 | No (CORS)                                  | No               | **Yes** (or subscribe-first, which mutates) | **Yes**                                                           | Site contacted                      | High       | **HOLD**                                                                                        |
| Citation graph from followed sources (R3 G1) | None                                   | Extract outbound links from entry HTML already in Miniflux | Entries via API                                    | Yes (parse locally)                        | No for a session | No                                          | None for extraction; **Yes** for validation                       | Local                               | Medium     | **RESEARCH** — benchmark first (R3)                                                             |
| Blogroll / well-known OPML (R3 G2)           | None                                   | Needs fetching other sites                                 | No                                                 | No (CORS)                                  | No               | Yes                                         | Yes                                                               | Contacts sites                      | High       | **HOLD**                                                                                        |
| GDELT / web search / feed index (R3 G3–G5)   | None                                   | External query leaks interest                              | n/a                                                | Browser could call, but leaks IP and query | No               | Optional                                    | n/a                                                               | **High**                            | Medium     | **HOLD**, default off                                                                           |
| Source quality score                         | None                                   | —                                                          | —                                                  | —                                          | —                | —                                           | —                                                                 | —                                   | —          | **REJECT**                                                                                      |
| Auto-follow                                  | None                                   | —                                                          | —                                                  | —                                          | —                | —                                           | —                                                                 | —                                   | —          | **REJECT**                                                                                      |

**Falsification attempt for `/v1/discover`.** The reasons not to adopt it are: (1) it makes the Miniflux host fetch an arbitrary URL, so the operator's network configuration matters; (2) it returns nothing that helps choose between candidates; (3) its heuristics are incomplete (#2991 is an open request for more). None of these outweighs the fact that NewsFlux's current Add Feed fails on any site URL. The risk in (1) is mitigated by the default private-network block and `INFERENCE`d to be small for a user adding their own URLs.

## Feedback systems

| System   | Preference                                                           | Where persisted                | Scope                            | Conflict rule                                                         | Undo                                                       |
| -------- | -------------------------------------------------------------------- | ------------------------------ | -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| NewsBlur | like/dislike/super-dislike on title, author, tag, text, URL, feed    | Server database                | feed / folder / global           | veto, then best positive, then worst negative                         | delete the rule                                            |
| Feedbin  | Action: standard / notifier / mute with a query                      | Server database (+ percolator) | all feeds, tags, or chosen feeds | per-action                                                            | edit, suspend or delete the action; `broken` status exists |
| FreshRSS | filter action `{search, actions}`; feed priority; favourites; labels | Per-user config + database     | global search or feed            | evaluated in order; manual actions on updated items are not overruled | edit the config                                            |
| Miniflux | feed and user filter rules; `hide_globally`; star                    | Database                       | user or feed                     | block before keep; first match                                        | edit the rule                                              |
| NewsFlux | `hide_globally` (via Miniflux), filter rules per feed, star          | Miniflux                       | feed or category                 | Miniflux's                                                            | via Miniflux                                               |

**NewsFlux mapping.** "Mute" is already provider-backed. The missing pieces are (a) **user-level** rules via the user settings fields Miniflux already has, (b) a visible **preview** of what a rule would match among loaded entries, and (c) an **undo** that is honest about the fact that Miniflux rules do not retroactively un-hide entries. "More like this" and any learned feedback have no reference implementation that avoids a server-side store; in every example the store is part of the product's own backend. **Recommendation:** `ADAPT` the provider-backed subset; `HOLD` learned feedback; `REJECT` inferring feedback from read state.

## Rules and filtering

| Aspect         | Miniflux                                             | NewsBlur                            | Inoreader (vendor-documented)                               | Feedbin                                          | FreshRSS          | NewsFlux                         |
| -------------- | ---------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ | ----------------- | -------------------------------- |
| Fields         | title, URL, comments URL, content, author, tag, date | title, author, tag, text, URL, feed | title/content, author, URL, attachments, language, category | full-text query over title, content, author, URL | search expression | raw legacy regex fields per feed |
| Scope          | user and feed                                        | feed / folder / global              | feed or folder                                              | feeds, tags, or all                              | global or feed    | feed                             |
| Block and keep | yes, ordered                                         | like / dislike                      | keep or hide                                                | mute / standard                                  | actions           | block and keep (legacy fields)   |
| Preview        | none in the API                                      | UI                                  | "Run rule"                                                  | `results`                                        | none found        | none                             |
| Retroactive    | no                                                   | rules apply at scoring time         | filters change what is shown                                | optional bulk apply                              | at fetch          | no                               |

**Finding.** NewsFlux edits the legacy fields while Miniflux 2.3.x provides a richer typed syntax at user and feed level. The legacy fields still work (both models carry them at `v2.3.4`). Whether and when to move is a compatibility question for the maintainer, not a research conclusion. **Recommendation:** `RESEARCH` the typed-rules migration and a read-only preview; `ALREADY_COVERED` for per-feed raw block/keep.

## Smart views and search

| System   | What is persisted                                | Where           | URL-addressable       |
| -------- | ------------------------------------------------ | --------------- | --------------------- |
| FreshRSS | `{name, get, order, state, search, share token}` | per-user config | yes (`getUrl`)        |
| Feedbin  | `{name, query}`                                  | database        | yes (internal routes) |
| NewsFlux | nothing (search is in-memory and source-scoped)  | —               | no                    |

A saved view is a **descriptor** (a scope plus a query plus sort and state), not data. That makes two designs possible: (1) store descriptors (needs the persistence decision) or (2) make the live search/filter state addressable in the URL so the browser's own bookmark is the store. FreshRSS's `isDeprecated` shows the failure that either design must handle: a saved view that points to a deleted feed or category. **Recommendation:** `RESEARCH` the URL-addressable design (no new NewsFlux state); `HOLD` stored descriptors until the storage decision exists.

## Source management

- **Feed health:** `ALREADY_COVERED` (FEED-HEALTH-01).
- **Duplicate subscriptions:** current check is literal equality. FreshRSS #8619 (open) and NetNewsWire's special cases show that URL identity is the hard part. `ADAPT` as a client-only normalisation plus a "possible duplicates" report; do not auto-merge.
- **Stale feeds:** no reference found beyond health/error counters; Miniflux exposes `checked_at` and parsing error counts. A "no new entry in N days" report needs the newest `published_at` per feed. `RESEARCH`.
- **Source identity:** `HIGH` risk, unchanged from R3. The reviewed systems each keep identity as a feed URL (Miniflux, FreshRSS, Feedbin) or as a server-side record (NewsBlur). None models "publisher". Any NewsFlux publisher model would be new and local, and should not merge feeds automatically.

## Reader experience

Not investigated in depth. The reader, previous/next, next-unread, lazy media player (#70), keyboard parity and touch targets are already implemented in NewsFlux and no finding here suggests revisiting them. `ALREADY_COVERED`. Features that need persistence (reading position, offline queue, read-later list) stay behind the architecture gate already recorded in the roadmap.

## Competitive implementation matrix

| FEATURE                               | PRODUCT                          | IMPLEMENTATION_MECHANISM                        | PERSISTENCE       | SERVER_REQUIREMENT         | ALGORITHM                                              | TEST_EVIDENCE                                         | NEWSFLUX_STATUS                  | NEWSFLUX_DECISION                          | CONFIDENCE                                    |
| ------------------------------------- | -------------------------------- | ----------------------------------------------- | ----------------- | -------------------------- | ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Same-story clustering                 | NewsBlur                         | Celery task builds clusters from title tiers    | Redis, 14-day TTL | Yes                        | overlap coefficient + ES `more_like_this` + union-find | `apps/clustering/tests.py`                            | Not present                      | ADAPT (research first, client-only tier-1) | CODE_VERIFIED / HISTORY_VERIFIED              |
| Duplicate detection (content overlap) | Feedly                           | `UNKNOWN`                                       | `UNKNOWN`         | Yes (sync service)         | >85% overlap, 31 days (documented)                     | none (closed)                                         | exact only, optional             | RESEARCH                                   | CURRENT_FACT (vendor), implementation UNKNOWN |
| Explicit scoped rules                 | NewsBlur                         | Mongo classifiers                               | Server DB         | Yes                        | veto → positive → negative → feed                      | `apps/analyzer/tests.py`                              | Per-feed raw rules               | ADAPT (provider-backed)                    | CODE_VERIFIED                                 |
| Query-based actions with preview      | Feedbin                          | ES percolator + bulk job                        | Server DB         | Yes                        | stored query matched per entry                         | `test/models/action_test.rb`                          | None                             | ADAPT the preview idea only                | CODE_VERIFIED                                 |
| Search → action rules                 | FreshRSS                         | `FilterAction` at fetch time                    | per-user config   | Yes                        | boolean search + read/star/label                       | `tests/app/Models/SearchTest.php` (read by name only) | Per-feed raw rules               | RESEARCH                                   | CODE_VERIFIED                                 |
| Saved query descriptors               | FreshRSS                         | `UserQuery`                                     | per-user config   | Yes                        | expansion of a search string, deprecation flag         | `UserQueryTest.php`                                   | None                             | RESEARCH (URL design)                      | CODE_VERIFIED / TEST_VERIFIED (names)         |
| Feed priority                         | FreshRSS                         | integer constant per feed                       | config            | Yes                        | ordering/visibility                                    | model constants                                       | None                             | RESEARCH                                   | CODE_VERIFIED                                 |
| Feed discovery from a URL             | Miniflux                         | `FindSubscriptions`                             | none              | Yes                        | ordered probes                                         | `finder_test.go`                                      | **Missing in NewsFlux Add Feed** | **ADOPT**                                  | CODE_VERIFIED                                 |
| Feed discovery with scoring           | NetNewsWire / feedsearch-crawler | heuristic score of candidate URLs               | none              | No / Yes                   | hand-set constants                                     | 4 tests / several                                     | Not needed if Miniflux is used   | REJECT copying constants                   | CODE_VERIFIED                                 |
| URL → bridge                          | RSS-Bridge                       | `detectParameters` per bridge                   | none              | Yes                        | pattern match                                          | `TEST_DETECT_PARAMETERS` in 15 of 552 bridges         | None                             | HOLD                                       | CODE_VERIFIED                                 |
| Similar sites                         | NewsBlur                         | embedding + ES over a global corpus             | ES                | Yes + hosted embedding API | k-NN                                                   | `apps/discover/tests.py` (present, not read)          | None                             | HOLD (needs a catalog)                     | CODE_VERIFIED                                 |
| Suggested feeds directory             | Feedbin                          | seeded tables                                   | DB                | Yes                        | editorial                                              | none read                                             | None                             | RESEARCH (G7)                              | CODE_VERIFIED                                 |
| Fetch safety                          | Miniflux / RSS-Bridge            | connect-time or pinned-IP private-network block | config            | Yes                        | IP class check                                         | `client_test.go` (present)                            | n/a                              | Rely on Miniflux                           | CODE_VERIFIED                                 |

## Architecture implications

1. **Candidate fetching belongs in Miniflux.** Browser fetches are blocked by CORS; the two open-source fetchers reviewed that block private networks (Miniflux, RSS-Bridge) do it at the server. Adding a NewsFlux fetcher would create a second SSRF surface for no benefit. `INFERENCE`.
2. **A single source of truth for rules exists already.** Miniflux stores feed- and user-level rules and applies them at ingestion; a NewsFlux rule store would duplicate it. `INFERENCE`.
3. **Every reviewed system that offers learned or declared preference stores it on its own server.** There is no reviewed pattern that keeps durable preference in the browser alone. This supports the existing roadmap gate and does not by itself justify building a backend. `INFERENCE`.
4. **Story clustering and saved-view descriptors do not need storage** if they are computed from loaded entries or encoded in the URL. They do need storage the moment they must survive reloads or sync across devices. `INFERENCE`.
5. **What requires server-side persistence:** shared preference, discovery cache, any crawler. **What can stay client-only:** session clustering, URL-addressable views, duplicate-subscription report, rule preview over loaded entries.

## Features worth adapting

1. **Resolve a pasted site URL through Miniflux** (`POST /v1/discover`, then `POST /v1/feeds`). Mechanism: server probes in a fixed order and returns `[{title, url, type}]`. Why: the current Add Feed fails on site URLs. Dependency: confirm the deployment's `FETCHER_ALLOW_PRIVATE_NETWORKS`. Confidence: `CODE_VERIFIED`.
2. **Session-scoped same-story grouping, tier-1 only.** Mechanism: normalised-title equality, then overlap coefficient with a minimum-intersection guard, different feeds, time window, representative plus alternatives, visible "separate" action. Dependency: a measured corpus and a language strategy. Confidence: mechanism `CODE_VERIFIED`, suitability `HYPOTHESIS`.
3. **Provider-backed mute/keep including user-level rules.** Mechanism: Miniflux's typed rules on the user/feed. Dependency: a decision on migrating from the legacy fields; undo semantics that state "does not retroactively un-hide". Confidence: `CODE_VERIFIED`.
4. **Preview before save for rules and (later) views.** Mechanism: run the candidate query over loaded entries and show the match count and first matches. Seen in Feedbin and, per the vendor, Inoreader. Dependency: none beyond UI. Confidence: `CODE_VERIFIED` (Feedbin) / `CURRENT_FACT` (Inoreader).
5. **URL-addressable search and filter state.** Mechanism: the descriptor model of FreshRSS saved queries, with the browser bookmark as the store. Dependency: none. Confidence: design `INFERENCE`.
6. **Duplicate-subscription report with normalised URL comparison and a "deprecated reference" state for views.** Dependency: a normalisation spec; FreshRSS #8619 as the failure case. Confidence: `HISTORY_VERIFIED`.
7. **Show why a feed candidate was proposed** (NetNewsWire's activity log, R3's provenance). Dependency: discovery exists. Confidence: `CODE_VERIFIED` for the pattern.
8. **Citation-graph candidate generation (R3 G1), evaluated offline first.** Dependency: the benchmark and a source-identity model. Confidence: `HYPOTHESIS` — no reviewed reader does this.
9. **Explicit user priority per feed** (FreshRSS idea). Dependency: where the value is stored. Confidence: `CODE_VERIFIED` for the reference; value for NewsFlux `HYPOTHESIS`.
10. **A split between "exact duplicate" and "same event" in the UI vocabulary** (Feedly documents both separately; NewsBlur split Title versus Title+Related). Dependency: story clustering. Confidence: `CURRENT_FACT` / `HISTORY_VERIFIED`.

## Features worth rejecting

1. **Weighted article, source or discovery scores** (R1). No reviewed system publishes such a formula for a single user; NewsBlur's scoring is precedence, not a sum. `INFERENCE`.
2. **Copying NewsBlur's, NetNewsWire's or feedsearch-crawler's constants.** They are hand-set (and for NewsBlur, repeatedly corrected) against those products' own corpora.
3. **Server-side Elasticsearch / Redis / Celery or a hosted embedding service** just to match NewsBlur. The NewsBlur Discover design cannot be reproduced without a global corpus.
4. **Auto-marking event-level alternatives as read.** Exact duplicates are already auto-marked; extending it to events risks hiding distinct reporting.
5. **Copying FreshRSS code** (AGPL-3.0) or **Nextflux code** (no license).
6. **Interpreting read, scroll-read or star as preference** (R2 section 6; `markDuplicatesAsRead` in NewsFlux shows read can be set by the application itself).
7. **A NewsFlux-owned fetcher or crawler for candidate sources.**
8. **Treating RSS-Bridge or `/v1/discover` as a ranking mechanism.**

## Open questions

1. What is the deployment's value of `FETCHER_ALLOW_PRIVATE_NETWORKS`, and is an RSS-Bridge integration configured? (`UNKNOWN`; the answer decides the residual SSRF risk of enabling `/v1/discover`.)
2. Does NewsFlux's Miniflux target accept the typed user-level rules through the user-settings API, and are the legacy feed fields on a deprecation path? (Not confirmed; the documentation was not consulted in this review.)
3. What storage, if any, will hold declared interests or saved view descriptors? (The roadmap gate stands; this review adds no recommendation.)
4. What languages and feed overlap does the real corpus have? (Decides whether a tier-1 clustering threshold is even measurable. R3's benchmark was designed to collect this; it has not run.)
5. How does RSS-Bridge handle IPv6 destinations? (`UNKNOWN`.)
6. Does `feedsearch-crawler` or any other candidate crawler reviewed handle private destinations? (A source search found no handling; not proven absent.)

## Recommended research and development sequence

This is a sequence of **research outputs**, not a build order, and it does not amend the roadmap.

1. Record the deployment facts needed to size the fetch risk (open questions 1 and 2).
2. Run the existing discovery benchmark's local collection under its own safeguards (R3 section "RECOMMENDED_EXPERIMENT_01"), and add a labelled same-story sample to the same collection so clustering thresholds can be measured.
3. Specify (do not build) the `/v1/discover` Add Feed path, since it needs no new state and fixes a present failure.
4. Specify provider-backed mute/keep with preview and honest undo.
5. Specify URL-addressable views and the duplicate-subscription report.
6. Hold declared interests, learned feedback, discovery generators and previews until the persistence and fetch-security decisions exist.

## Corrections to earlier statements in this session

An earlier in-session review of the live repository (not archived here) contained statements this verification changes. They are listed so the trail is auditable and are not edited retroactively elsewhere.

| Earlier statement                                                           | Corrected finding                                                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add Feed "native detection" was "PARTIAL (delegated to Miniflux on signup)" | **Wrong.** `POST /v1/feeds` does not run the finder; NewsFlux's Add Feed requires a feed URL.                                                       |
| `/v1/discover` SSRF gate "REVIEW_REQUIRED"                                  | **Refined.** At `v2.3.4` the fetcher blocks private networks by default with a connect-time IP check; the deployment's flag value is the open item. |
| Global "mute topic" rules might exist in Miniflux "to be verified"          | **Confirmed.** User-level `block_filter_entry_rules` / `keep_filter_entry_rules` exist at `v2.3.4`.                                                 |
| "Miniflux offers no preview without subscribing"                            | **Confirmed**, with the API evidence above.                                                                                                         |

## Limitations

- The REA tool was unavailable; code archaeology was done directly. Counts in R2 were not independently reproduced.
- Test files were read but **not executed**.
- History beyond the sampled commits, issues and pull requests was not mined. Issue and pull-request items outside the nine pages fetched are unverified.
- Closed-source statements rest on search summaries, not full pages.
- Reader experience, Sidebar behaviour and the NewsFlux UI were not exercised in a browser for this track.
- Several positive claims about "no reviewed reader does X" are limited to the files and commit subjects read; they are not proofs of absence.
