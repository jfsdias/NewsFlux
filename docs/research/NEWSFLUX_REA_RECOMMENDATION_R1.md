# NEWSFLUX_REA_RECOMMENDATION_HANDOFF

> **ARCHIVE NOTICE — R1 — initial recommendation synthesis**
>
> - **STATUS:** SUPERSEDED
> - **SUPERSEDED_BY:** NEWSFLUX_REA_RECOMMENDATION_R2.md (falsification) and NEWSFLUX_REA_SOURCE_DISCOVERY_R3.md
> - **IMPLEMENTATION_AUTHORITY:** NO. This is research input, not a specification, roadmap decision or authorization to build.
> - **FINAL_RECOMMENDATION_ALGORITHM / FINAL_SOURCE_DISCOVERY_ALGORITHM / FINAL_RANKING_WEIGHTS:** NOT_APPROVED.
> - **Original file name:** `NEWSFLUX_REA_RECOMMENDATION_HANDOFF.md`. The body below is the report as received; its conclusions are not rewritten.
> - **Context:** R1 was written without access to the NewsFlux repository (the available checkout was a different product). The ARTICLE_SCORE_V1, SOURCE_SCORE_V1 and DISCOVERY_SCORE_V1 formulas, every numeric weight and every threshold in this document were rejected as unjustified parameters in R2 section 9. They must not be reused.
> - **Independent verification:** see [NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md](NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md). Later findings are recorded there, not here.
> - **Archive normalization:** Markdown formatting by the project Prettier; 0 local filesystem path(s) replaced with a placeholder; this notice added. Nothing else was changed.

**Research date:** 20/10/2026. **Nature:** architectural research, read-only. **Status:** proposal for validation; no code, PR, merge or deploy in NewsFlux. The available checkout is `organizAI`, a different product; the proposed PR file paths are conceptual surfaces, not confirmed NewsFlux paths.

## Method and limits of the evidence

- `OBS` = open-source code examined; `DOC` = official documentation/blog; `DESIGN` = NewsFlux proposal. A dash in the matrix means **not evidenced in the sources consulted**, not proven absence in the product.
- Code files were examined via the GitHub connector and official documents via web search. The connected REA MCP inspects artifacts and pages, but offers no tool for exploring GitHub repositories; the REA skill itself directs normal tools for repositories with source code. No third-party software was executed and no proprietary binary was examined. Code coverage is focal, not a full audit of all repositories.
- No third-party ranking weight is inferred. The V1 weights below are **explicit product hypotheses**, motivated by the observed components and subject to offline testing and adjustment with the owner's feedback. They are not learned metrics nor numbers extracted from competing products.
- "Reeder" was interpreted as **Reeder Classic**, the RSS reader documented by its maker; the newer Reeder product has different positioning. This choice avoids transferring functions between homonymous products. No proprietary implementation was inferred.

### Coverage of the nine research questions

| Question          | Status                      | Supported answer / gap                                                                                                                                    |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Curation       | Partial                     | Explicit NewsBlur rules, Inoreader/FreshRSS filters and signals available in Miniflux are observed; internal formulas of the closed products are unknown. |
| 2. Discovery      | Partial                     | Directories/topics and content similarity are documented; proprietary ranking of candidates has not been published.                                       |
| 3. Clustering     | Answered for patterns       | NewsBlur code and documentation show two layers; Feedly/Inoreader document dedup. No proven universal algorithm exists.                                   |
| 4. Feedback       | Partial                     | NewsBlur makes scopes and precedence explicit; Miniflux stars/read state exist; effect of clicks/dwell in competitors is unknown.                         |
| 5. Bubble         | Material gap                | MMR comes from academic research; no reader examined provided evidence of MMR, caps or perspective balancing.                                             |
| 6. Cold start     | Answered for patterns       | Directories/bundles, topic choice, URL and OPML are evidenced; comparative effectiveness has not yet been measured.                                       |
| 7. Quality        | Partial                     | There is topical focus and technical signals; reliable criteria for originality and spam must be validated on real samples.                               |
| 8. Explainability | Partial                     | Rules and previews are visible; a detailed "why this article?" has not been demonstrated for all products.                                                |
| 9. Self-hosted    | Answered for V1 feasibility | Miniflux API and discovery + RSS-Bridge support the proposed path; performance depends on real NewsFlux volume/version.                                   |

### Evidence register

| ID  | Primary evidence                                                                                                                                                                                                                                                                         | Finding                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | [NewsBlur `reader_utils.js`](https://github.com/samuelclay/NewsBlur/blob/main/media/js/newsblur/reader/reader_utils.js) and [post on scopes](https://blog.newsblur.com/2026/02/02/global-and-folder-scoped-intelligence-training/)                                                       | Explicit rules by title, author, tag, text, URL and feed; feed/folder/global scope; super downvote takes priority.                                                   |
| E2  | [NewsBlur `clustering/models.py`](https://github.com/samuelclay/NewsBlur/blob/main/apps/clustering/models.py) and [official description](https://blog.newsblur.com/2026/03/18/story-clustering/)                                                                                         | Normalized title, overlap of significant words, semantic layer and representative with visible alternatives.                                                         |
| E3  | [NewsBlur Discover Sites](https://blog.newsblur.com/2025/02/02/discover-related-stories-and-sites/) and [client `discover_feeds.js`](https://github.com/samuelclay/NewsBlur/blob/main/media/js/newsblur/models/discover_feeds.js)                                                        | Similarity by feed title/description and recent titles, with article preview before following; the author states the feature does not use personal co-subscriptions. |
| E4  | [Feedly discovery](https://feedly.com/new-features/posts/new-ai-driven-discovery-experience), [following sources](https://docs.feedly.com/article/768-follow-sources-in-feedly)                                                                                                          | Catalog by topics, topical focus, volume, popularity/engagement, bundles and URL search. The internal formula is not public.                                         |
| E5  | [Feedly deduplication](https://docs.feedly.com/article/218-how-does-deduplication-work)                                                                                                                                                                                                  | Content comparison and time window; it is a public product description, not code.                                                                                    |
| E6  | [Inoreader Discovery](https://www.inoreader.com/blog/2015/02/inoreader-how-to-find-great-new-content.html), [collections](https://www.inoreader.com/blog/2025/03/discover-quality-content-with-our-new-global-search-update.html), [filters](https://www.inoreader.com/features/filters) | Directories, editorial collections, filters with scope and duplicates by URL/title/approximate title.                                                                |
| E7  | [FreshRSS OPML](https://github.com/FreshRSS/FreshRSS/blob/edge/docs/en/developers/OPML.md), [filtering](https://freshrss.github.io/FreshRSS/en/users/10_filter.html)                                                                                                                     | Explicit feed priority, queries/filters and configurable uniqueness criteria.                                                                                        |
| E8  | [NetNewsWire `FeedFinder.swift`](https://github.com/Ranchero-Software/NetNewsWire/blob/main/Modules/FeedFinder/Sources/FeedFinder/FeedFinder.swift)                                                                                                                                      | Direct feed validation, discovery via `<head>`, HTML candidates and known paths; confirms candidates before adding them.                                             |
| E9  | [Miniflux `finder.go`](https://github.com/miniflux/v2/blob/main/internal/reader/subscription/finder.go), [API](https://miniflux.app/docs/api.html)                                                                                                                                       | Discovery by URL, HTML, RSS-Bridge and known paths; API exposes feed/category/article, status, star, times and parsing errors.                                       |
| E10 | [Nextflux `articleRepository.js`](https://github.com/electh/nextflux/blob/main/src/db/repositories/articleRepository.js), [README](https://github.com/electh/nextflux)                                                                                                                   | Miniflux client: title search, read/favorite filter and temporal sorting; no recommendation algorithm observed in the examined file.                                 |
| E11 | [ReadKit](https://readkit.app/), [Reeder Classic](https://www.reeder.app/classic/)                                                                                                                                                                                                       | Clients with organization, smart folders (ReadKit) and reading/sync (Reeder); details of proprietary ranking not published in the sources consulted.                 |
| E12 | [RSS-Bridge README](https://github.com/RSS-Bridge/rss-bridge/blob/master/README.md)                                                                                                                                                                                                      | Generates feeds for sites without RSS; bridge catalog, cache and Atom/JSON outputs.                                                                                  |
| E13 | [Goldstein & Carbonell, MMR](https://aclanthology.org/X98-1025/)                                                                                                                                                                                                                         | Academic basis for reranking that balances relevance and redundancy. There is no evidence of MMR implemented in the readers studied.                                 |
| E14 | [NewsBlur licensing](https://github.com/samuelclay/NewsBlur/blob/main/LICENSE.md), [Miniflux](https://github.com/miniflux/v2), [NetNewsWire](https://github.com/Ranchero-Software/NetNewsWire), [FreshRSS](https://github.com/FreshRSS/FreshRSS)                                         | MIT, Apache-2.0, MIT and AGPL-3.0, respectively.                                                                                                                     |

## DELIVERABLE 1 — NEWSFLUX_RECOMMENDATION_RESEARCH_MATRIX

Abbreviations: OS = OPEN_SOURCE; PS = PARTIAL_SOURCE; CS = CLOSED_SOURCE; `—` = no evidence in the consulted scope. Classification refers to the code of the main product, not to published API clients.

| APP            | SOURCE_AVAILABLE | CURATION                                    | SOURCE_DISCOVERY                              | TOPIC_MODEL                                      | STORY_CLUSTERING                                     | FEEDBACK                                         | DIVERSITY                                           | COLD_START                      | EXPLAINABILITY                            | QUALITY_SCORING                                      | NOTABLE_IDEA                                | REUSABLE_PATTERN                                  | RISKS                                                                     |
| -------------- | ---------------- | ------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Feedly         | CS               | AI Feeds, priorities and mutes (DOC)        | Topics, URL, bundles (E4)                     | Hierarchical taxonomy (E4)                       | Content deduplication (E5)                           | Mutes/saved (DOC)                                | Discovery sorting by focus/popularity/volume; MMR — | Bundles and topics (E4)         | Visible search criteria; internal score — | Focus, followers and engagement announced; formula — | Source topical focus                        | Adapt visible criteria, without copying the model | Dependence on a massive catalog and collective signals                    |
| Inoreader      | CS               | Content rules/filters (E6)                  | Directory, collections and global search (E6) | Suggested categories and tags (DOC)              | Duplicates URL/title/near title (E6)                 | Rules, stars and tags (E6)                       | Editorial collections; MMR —                        | Directory by category (E6)      | Inspectable rules                         | Curated collections; formula —                       | Scope-explainable filter                    | Filter before ranking                             | Filters can hide useful coverage                                          |
| NewsBlur       | OS               | Explicit classifiers and Focus (E1)         | Similar sites with previews (E3)              | Content similarity; attribute classifier (E1/E3) | Title + semantics, visible alternatives (E2)         | Scoped likes/dislikes (E1)                       | Alternatives by source; MMR —                       | Follow feeds and discovery (E3) | Rules and source of the match             | Feed statistics, no public quality formula           | Attribute training + sample-based discovery | Use explanation and scope                         | Operational complexity of the NewsBlur stack                              |
| Reeder Classic | CS               | Feed reading/organization (E11)             | Adding feeds; recommendation algorithm —      | —                                                | —                                                    | Star/state via service, depending on integration | —                                                   | Manual addition                 | Source is explicit                        | —                                                    | Reader without opaque ranking               | Preserve chronological mode                       | Do not attribute unpublished algorithm                                    |
| ReadKit        | CS               | Query-based smart folders (E11)             | Feed management via providers (E11)           | User queries                                     | —                                                    | Tags/saved via services                          | —                                                   | Existing feeds/providers        | Smart folder criteria                     | —                                                    | User's saved views                          | "Saved query" mode parallel to the feed           | Functionality varies by provider                                          |
| NetNewsWire    | OS               | RSS/reading; personalized ranking —         | `FeedFinder` validated (E8)                   | —                                                | —                                                    | Read/favorite; learned rule —                    | —                                                   | Initial URL                     | Feed origin is traceable in the finder    | —                                                    | Robust discovery by URL                     | Flow adaptation, not Swift                        | Avoid arbitrary fetch/SSRF on the server                                  |
| Nextflux       | OS               | Filters and date sorting (E10)              | Management via Miniflux                       | Miniflux categories                              | —                                                    | Status/star (E10)                                | —                                                   | OPML/Miniflux feeds (README)    | Visible sorting                           | —                                                    | Simple UX over Miniflux                     | Client decoupled from the backend                 | Repository license not identified as a standard license; do not copy code |
| FreshRSS       | OS               | Priority per feed, queries/filters (E7)     | Adding/OPML; topical catalog —                | Category/tag/queries                             | Configurable uniqueness, story cluster not evidenced | Explicit star/filter                             | —                                                   | OPML (E7)                       | Visible rules                             | —                                                    | Priority controlled by the user             | Priority levels                                   | AGPL if code is copied; do not assume logic isolation                     |
| Miniflux       | OS               | Temporal, status, favorite and filters (E9) | Feed discovery by URL (E9)                    | Category/tag                                     | Entry dedup in the backend, story cluster —          | Read/favorite (E9)                               | —                                                   | OPML, URL, categories           | Clear source/status                       | Parsing/check error (E9)                             | Reliable data backend                       | Integrate existing API                            | Retention limits history; API does not provide reliable dwell             |

**Reading the matrix:** we found no evidence of MMR, explicit source/topic caps or perspective balancing in these nine products. The research was focal; this is an evidence gap, not proof of absence. We also do not treat "number of outlets covering the story" as universal importance: it may reflect republication by the same agency.

## DELIVERABLE 2 — BEST IDEAS

| IDEA                                     | ORIGIN                     | HOW_IT_WORKS                                                 | EVIDENCE  | WHY_USEFUL_FOR_NEWSFLUX                        | ADAPTATION_REQUIRED                                   | COMPLEXITY | PRIVACY_COST | IMPLEMENTATION_COST |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------ | --------- | ---------------------------------------------- | ----------------------------------------------------- | ---------- | ------------ | ------------------- |
| Explicit preferences with scope          | NewsBlur                   | Rules for attribute at feed/folder/global level; strong veto | E1        | User controls noise without invisible training | Use topic/source and predictable precedence           | Low        | Low          | Low                 |
| Source preview before following          | NewsBlur                   | Show recent sample and reason for similarity                 | E3        | Reduces bad subscriptions                      | Local/curated candidates and Miniflux at confirmation | Medium     | Low          | Medium              |
| Find real RSS before bridge              | Miniflux/NetNewsWire       | URL → direct feed/HTML → validate → fallback                 | E8/E9     | Reuses available infrastructure                | Use Miniflux endpoint and SSRF policy                 | Medium     | Low          | Low                 |
| Deduplicate without erasing perspectives | NewsBlur/Inoreader         | Group articles and expose alternative sources                | E2/E6     | Less repetition, coverage preserved            | Conservative multilingual limits                      | Medium     | Low          | Medium              |
| Source focus on topic                    | Feedly                     | Source assessed by topical concentration, not just audience  | E4        | Favors useful niches                           | Measure on a local sample, without global followers   | Medium     | Low          | Medium              |
| Post-ranking diversification             | Academic MMR               | Sequential selection penalizes similar items                 | E13       | Avoids top dominated by one topic/source       | Simple penalty, transparent caps                      | Low        | None         | Low                 |
| Saved queries and clear filters          | ReadKit/FreshRSS/Inoreader | Selections declared by the user                              | E6/E7/E11 | Explainable and useful with little history     | NewsFlux presets                                      | Low        | Low          | Low                 |

## DELIVERABLE 3 — NEWSFLUX_RECOMMENDATION_ENGINE_V1

### Contract and signals

**Unit:** recommendation of _story_ represented by a main article with alternatives; use an isolated article when there is no reliable cluster. **Universe:** entries from followed feeds, typically the last 14 days; window adjustable. **Never** recommend an item from a muted source/topic, removed, without a safe URL, already read when the view asks for "unread", or a candidate that exactly duplicates an item already shown. Do not treat "did not click" or batch marking as a dislike. Favorite is a weak positive signal; explicit rule dominates.

1. **INPUT SIGNALS:** Miniflux: feed, category, tags, title, URL, author, available content, `published_at`, `created_at`, `status`, `starred`, `reading_time`, `checked_at`, `parsing_error_count`; OPML selected by the user; NewsFlux feedback only if opt-in. Do not collect dwell or browser history.
2. **USER INTEREST PROFILE:** sparse vector of topics from the chosen taxonomy, initialized by topics/categories/OPML. Updated by favorites and explicit actions, with age decay and per-source saturation; exclude "mark all as read" events. Allow editing/exporting/deleting. If there is no history, a uniform vector across the chosen interests.
3. **ARTICLE TOPIC REPRESENTATION:** V1 deterministic: normalized tokens from title, categories, tags and short text; versioned dictionary per language, declared synonyms and n-grams; topic vector normalized to sum 1. No reliable topic = "unknown", not "irrelevant". Do not force a political opinion.
4. **CANDIDATE GENERATION:** fetch recent entries from Miniflux, paginated, with an explicit limit per feed; merge the collections "recently followed", "favorites of the same topic" and "exploration of adjacent topics" from already-followed sources. External discovery generates _source_ proposals; it never injects an external article as a subscription. A newly followed source receives controlled sampling to escape zero history.
5. **ARTICLE SCORING:** formula below, without inventing unavailable signals. Missing metadata receives a neutral value and the reason is not displayed.
6. **SOURCE SCORING:** topic/technical quality/originality/cadence, with low confidence if the sample is small. Do not use an opaque "political credibility".
7. **STORY CLUSTERING:** exact canonical URL and GUID first; then normalized title + time window + entities/terms, with a conservative threshold; see algorithm below. Show all versions and never mark alternatives as read automatically in V1.
8. **SOURCE DISCOVERY:** topic → candidates from local catalog/chosen public OPML/manual entries, source links found in articles and specific queries approved by the user; validate via Miniflux and RSS-Bridge only after a concrete URL. No "crawling the whole Web".
9. **NOVELTY:** topic little represented in the last N _displayed_ items, not a preference against favorite topics. Only an ephemeral aggregated summary of the session. Configurable half-life of the topic.
10. **DIVERSITY:** sequential MMR-type reranking, caps per domain/source/topic and a small exploration quota. "Diversity of viewpoints" is not inferred from political bias; when several sources report the same story, show the alternatives without claiming ideological plurality.
11. **REPETITION PENALTY:** similarity with stories already shown in the session and recent volume of the same topic/source. Reset in a new session; do not irreversibly penalize repetition of an important alert.
12. **QUALITY:** feed integrity, valid date, useful content, sample without identical titles; detect republication without automatically penalizing legitimate syndication. A dead source falls under feasibility, not reputation.
13. **EXPLICIT FEEDBACK:** "more/less of this topic", follow/mute source and save. Exact rules precede the score; mild dislikes reduce affinity; mute removes. Show the scope and offer undo.
14. **COLD START:** choose up to five topics and three feeds, or import OPML; chronological feed and a sample per topic. Without choices, only trends from an opt-in local editorial catalog, with the selection explained; do not presume interests.
15. **EXPLAINABILITY:** for each card: up to two positive reasons and one diversity/duplicate warning; e.g. "From your feed X", "Topic Y chosen by you", "Other coverage: 3 sources". Reasons are derived from computed contributions, never generated by an LLM.
16. **FAILURE MODES:** future/invalid timestamp → use arrival time for ordering, with an internal warning; voluminous feeds → candidate cap; article without text → title/tag with low confidence; language without dictionary → source/chronology; false cluster → option to separate; unstable RSS-Bridge → do not recommend following; Miniflux unavailable → explicit state and no fabricated candidates; feed with a malicious private URL → block SSRF, redirects to private IPs and credentials in the URL.

### ARTICLE_SCORE_V1

All terms `T, E, F, R, N, Q, I, P` are in `[0,1]` and are testable. `clip(x)=min(1,max(0,x))`.

```text
base = 0.24*T + 0.20*E + 0.16*F + 0.12*R + 0.10*N + 0.10*Q + 0.08*I
ARTICLE_SCORE_V1 = round(100 * clip(base - 0.18*P))
```

- `T`: affinity between the user's topic vector and the article's (cosine of sparse vectors, clipped). `E`: applicable explicit positive preferences, with neutral value 0.5 when there is no rule; strong explicit dislikes are a veto applied before the score. `F`: source affinity by follow/folder/favorites, smoothed with neutral prior 0.5 and sample size. `R=exp(-ln(2)*idade_horas/48)` for general news, with half-life per category configurable. `N=1/(1+exposições_recentes_tópico)` normalized for the session. `Q=SOURCE_SCORE/100`, limited for a new source by uncertainty. `I`: explicit importance term: user alert/saved query, or a story covered by distinct original sources; default 0.5, no external popularity. `P=max(similaridade_história_exibida, saturação_fonte_tópico)`.
- Initial weights give greater weight to thematic intent and explicit preference (NewsBlur/Feedly), then source, time and novelty. They were chosen for a positive sum of 1 and for auditability, **not measured**. Validate with 30–50 paired comparisons of "do you prefer to read A or B?", coverage by topic/source and rate of hidden items. Freeze the weights version; any change must be tested against regression cases.
- Guardrails applied before the score: source/topic mute, exact duplicate, invalid URL, unread policy. An explicit veto does not become a weak number that recency can overcome. If a field is not available, redistribute its weight proportionally among the available components, preserving explicit priority and recording the version/terms used.

### SOURCE_SCORE_V1 and DISCOVERY_SCORE_V1

```text
SOURCE_SCORE_V1 = round(100 * (0.40*focus + 0.25*health + 0.20*originality + 0.15*cadence))
DISCOVERY_SCORE_V1 = round(100 * (0.60*SOURCE_SCORE_V1/100 + 0.25*coverage_gap + 0.15*preview_match))
```

`focus`: fraction of the last up to 20 sampled articles that satisfy the requested topic, with Beta(2,2) smoothing; `health`: fraction of valid checks/items in a recent sample, or 0.5 when not measured; `originality`: fraction of items without a URL/title/content nearly identical to other sources, with a neutral value for inconclusive syndication; `cadence`: proximity of the observed frequency to the range **chosen by the user**, without rewarding raw volume. `coverage_gap`: how much the source adds of little-covered topics/subtopics or language; `preview_match`: fraction of up to five titles/excerpts that the user would mark as relevant or that match explicit topics. Everything limited to `[0,1]`; show the sample `n` and a confidence range. A source with fewer than five items receives a score of 50 on the unmeasured terms and the label "insufficient data". An invalid feed receives no discovery score.

### STORY_CLUSTERING_V1

1. Normalize the URL (remove known tracking parameters, preserve semantic parameters), resolve the canonical only from a safe page; group identical URLs/GUIDs.
2. Within a 72 h interval, block by language and main entities/names when available; compute the significant words of the titles after removing stopwords by language. Candidate link if Jaccard ≥ 0.75 **and** intersection ≥ 3; for short titles, require an exact URL or entity match. These numbers are initial NewsFlux thresholds, not thresholds taken from NewsBlur.
3. Avoid blind transitive chaining: every member must match the medoid/representative; limit the cluster to a specific event. Elect the representative by ARTICLE_SCORE, then greater useful content, with a stable tie-break. The same domain may have legitimate updates: preserve them as revisions and do not collapse them automatically.
4. Display "same publication" (URL/nearly identical content) separately from "same story" (independent coverage). Show the grouping reason and a separate action. Measure false positives on a multilingual corpus and on recurring news before widening the thresholds.

### Diversification V1

After scoring, choose up to 20 stories sequentially, maximizing `0.75*score_normalizado - 0.25*max_similaridade_com_já_selecionadas` (proposed MMR, E13), with at most 2 from the same source and 4 from the same topic in the top 10, relaxing the limits when candidates are lacking. Reserve 1 slot in the top 10 for exploration of an adjacent topic **from an already-followed source**, only if base ≥ 0.45 and there is no mute. Weights/caps are NewsFlux hypotheses to validate. The exploration reason is visible. The user may request "chronological only", with no algorithm.

## DELIVERABLE 4 — ALGORITHM TIERS

| Level                        | Expected gain                                                                        | Cost/privacy                                                                               | When not to advance                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 deterministic             | Control, auditable ranking, title dedup, sample-based discovery                      | Light CPU; local data                                                                      | It is the initial default.                                                                                                                                     |
| V2 optional local embeddings | Recovers paraphrases and semantically close sources; improves cross-title clustering | Model download, CPU/RAM and derived vectors persisted or recomputed; keep everything local | Do not advance if the corpus is small, V1 is already satisfactory, RAM is scarce, or semantic false positives do not drop in paired evaluation.                |
| V3 optional learning-to-rank | Adjusts weights to real feedback, possibly improves order                            | Labeled data, temporal evaluation, drift and harder explanation                            | Do not advance with few explicit examples, offline gain below the defined margin (proposal: +5% NDCG@10 with confidence interval), or loss of control/privacy. |

Do not require V2/V3 to fix V1 bugs. Embeddings do not replace explicit filters or source verification. No dependency on a proprietary model at any level.

## DELIVERABLE 5 — SOURCE DISCOVERY ENGINE

```text
Interesses escolhidos/OPML/categorias Miniflux
→ expansão local de tópicos (sinônimos e um salto na taxonomia)
→ candidatos: catálogo curado versionado + URLs submetidas + links de fontes identificados
→ dedup por domínio/feed e excluir já seguidas/silenciadas
→ validação URL: http(s), DNS/redirect/SSRF, content type, tamanho/tempo
→ amostra de até 20 artigos e saúde do feed
→ SOURCE_SCORE e lacuna de cobertura
→ diversificar por domínio, tópico e idioma; mostrar prévia e motivo
→ detecção nativa Miniflux (`/v1/discover`), preferir RSS/Atom/JSON
→ fallback RSS-Bridge configurado, somente quando não houver feed nativo adequado
→ recomendação com estado “feed direto” ou “via bridge”, confiança e frequência
→ clique humano Follow
→ criação de assinatura no Miniflux; confirmação da resposta
```

The current Miniflux `finder.go` already queries RSS-Bridge before known paths under certain conditions; NewsFlux should use the API result and **verify the native-feed preference** in its own decision, without duplicating the internal implementation or assuming a fixed order in future versions. RSS-Bridge is a converter for sources without RSS, not a relevance engine. Limit the bridge allowlist, timeout, cache and source terms; do not send private data to a public instance. Do not follow sources automatically.

## DELIVERABLE 6 — STORAGE / PRIVACY

- **V1 without a new DB: yes, with bounded scope.** Ranking can be computed on demand from the Miniflux API; chosen topics are kept as local configuration controlled by the user; the curated catalog is versioned. It can use `starred` as a weak signal, `status` for filtering, `category/tags`, `published_at/created_at`, `feed_id`, `checked_at/parsing_error_count`. There will be no "less like this", no persistent NewsFlux global mute and no exposure history between sessions in this mode.
- **Persist only if the user enables their own feedback:** explicit preferences (`topic/source`, action, scope, date), onboarding topics, rejected candidate sources with short retention, taxonomy version and weights. In the recurring clustering step, persist only cluster identity/representative and the algorithm version with a TTL, or recompute for a small universe. Do not duplicate full content that already exists in Miniflux.
- **Compute on demand:** article score, justifications, MMR, aggregated profile for a short window, small quality samples; in-memory cache with short expiration. Limit historical search to the necessary period. Never log article content, API tokens, URLs with credentials or a full reading trail.
- **Miniflux does not provide:** negative intent, reason for a favorite, reliable dwell, exposures within NewsFlux, and subjective quality assessment. Read status may come from batch marking; do not infer a negative preference from it.
- **Privacy:** local processing; no profile exported; feedback can be deleted/exported; configurable retention; minimal behavior data, no fingerprinting and no political inference. Sanitize Miniflux responses before sending them to the client, since API feed models may contain sensitive configuration fields.

## DELIVERABLE 7 — IMPLEMENTATION PLAN

Each PR is isolated and starts with a failing behavior test (RED), then implementation (GREEN), refactoring and a new verification. **Real paths depend on inspecting the NewsFlux repository**, which is absent from this checkout. Do not execute PRs in this research.

| PR                             | GOAL                                                              | DEPENDENCIES        | FILES/SURFACES LIKELY                        | TEST STRATEGY                                                    | RISK      | EXPECTED USER GAIN                       |
| ------------------------------ | ----------------------------------------------------------------- | ------------------- | -------------------------------------------- | ---------------------------------------------------------------- | --------- | ---------------------------------------- |
| NF-REC-01 contracts & fixtures | Candidate, score, reason and read-only Miniflux adapter contracts | None                | API adapter, recommendation domain, fixtures | RED for pagination, missing fields, stable order, redacted token | Low       | Verifiable foundation                    |
| NF-REC-02 topic profile        | Small taxonomy, onboarding and OPML/categories                    | 01                  | Profile, configuration, onboarding UI        | RED for cold start, language, opt-out, import                    | Medium    | Relevant recommendations without history |
| NF-REC-03 article ranking      | ARTICLE_SCORE with versioned weights and explanations             | 01–02               | Pure functions, read-only API, feed UI       | RED for veto, weights, recency, missing fields, tie-break        | Medium    | Useful “what to read now”                |
| NF-REC-04 cluster & diversity  | Conservative clustering and MMR/caps reranking                    | 03                  | Grouper, selector, alternatives UI           | Counterexample corpus, false clusters, scarce sources            | High      | Less repetition, more coverage           |
| NF-DISC-01 candidate sources   | Catalog/URL and local sample                                      | 01–02               | Discovery, versioned catalog, URL validation | SSRF/redirect/timeout, dedup, sample, dead source                | High      | Relevant new sources                     |
| NF-DISC-02 score & preview     | SOURCE/DISCOVERY_SCORE, reasons and preview                       | DISC-01, REC-02     | Scoring, Discover UI                         | New feed, syndication, cadence, domain caps                      | Medium    | Informed decision to follow              |
| NF-DISC-03 follow integration  | Native RSS preference, optional bridge, Follow in Miniflux        | DISC-02             | Miniflux adapter, Follow screen              | Idempotency, bridge error, never follow without a click          | High      | Complete discovery→subscription flow     |
| NF-FB-01 explicit feedback     | “More/less”, mute, undo, minimal storage                          | REC-03              | Versioned migration if DB, feedback API, UI  | Precedence/veto, delete/export, retention and user isolation     | High      | Direct control of the feed               |
| NF-SEM-01 optional local V2    | Local embeddings and comparative evaluation                       | 04 + labeled corpus | Local model, optional index/cache            | Measure cluster precision, memory/time, V1 fallback              | High      | Better paraphrase if there is real gain  |
| NF-LTR-01 optional V3          | Opt-in learning and metrics gate                                  | Sufficient feedback | Local training/evaluation                    | Temporal split, diversity regression, explanations               | Very high | More personal order only if demonstrated |

**Verification per PR:** unit tests of pure functions, integration with a test Miniflux/fake faithful to the API, URL security cases and the reasons UI; lint/typecheck/build of the real stack. After REC-03 and DISC-03, blind human evaluation with a set of titles and explanations; compare with chronological order and the previous V1. The first PR must keep read-only calls to Miniflux.

## DELIVERABLE 8 — BUILD VS BORROW

| Decision    | Component                                                                                                                                                                                                          | License / reason                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REUSE       | Miniflux API and database; RSS-Bridge already available                                                                                                                                                            | Miniflux Apache-2.0; RSS-Bridge declares code in the public domain/Unlicense, with its own dependencies; integrate as services without copying code.                                                                                       |
| ADAPT       | URL discovery flows from Miniflux/NetNewsWire; NewsBlur scoped rules; visible dedup                                                                                                                                | Ideas and own interface; Miniflux Apache-2.0, NetNewsWire MIT, NewsBlur MIT. If excerpts are copied, keep notices/licenses and review dependencies.                                                                                        |
| REIMPLEMENT | Ranking, local profile, quality, MMR, cluster and explanations                                                                                                                                                     | NewsFlux-specific composite algorithm, with its own tests and parameters. MMR is an academic concept, not a competitor's code.                                                                                                             |
| AVOID       | Copy code from Feedly/Inoreader/Reeder/ReadKit; copy FreshRSS AGPL into the core without review; copy Nextflux without a clear license; use Elasticsearch/Redis/Celery/cloud service just because NewsBlur uses it | Closed products do not license their implementation; FreshRSS AGPL-3.0 requires analysis of distribution/network obligations; the Nextflux README has informal text, with no clearly identified standard license in the sources consulted. |

## Compact handoff

```text
REPOS_REVIEWED=NewsBlur; Miniflux v2; FreshRSS; NetNewsWire; Nextflux; RSS-Bridge (integração)
OPEN_SOURCE_APPS=NewsBlur; NetNewsWire; Nextflux; FreshRSS; Miniflux
CLOSED_SOURCE_APPS=Feedly; Inoreader; Reeder Classic; ReadKit
KEY_DISCOVERIES=Preferência explícita escopada; descoberta por conteúdo da fonte e prévia; agrupamento preservando alternativas; API Miniflux suficiente para ranking inicial
BEST_CURATOR_IDEA=NewsBlur: atributos explícitos com veto e escopo
BEST_SOURCE_DISCOVERY_IDEA=NewsBlur prévia + Miniflux/NetNewsWire validação URL + Feedly foco temático
BEST_CLUSTERING_IDEA=NewsBlur: título + camada semântica com versões alternativas; V1 NewsFlux só heurística conservadora
BEST_FEEDBACK_IDEA=Regras explícitas e reversíveis; estrela Miniflux como sinal fraco
BEST_DIVERSITY_IDEA=MMR e caps transparentes propostos pelo NewsFlux, não atribuídos aos apps
NEWSFLUX_RECOMMENDATION_ENGINE_V1=Ranking determinístico local de histórias de fontes seguidas; descoberta separada de fontes, com Follow humano
ARTICLE_SCORE_V1=100*clip(.24T+.20E+.16F+.12R+.10N+.10Q+.08I-.18P)
SOURCE_SCORE_V1=100*(.40focus+.25health+.20originality+.15cadence)
DISCOVERY_SCORE_V1=100*(.60source+.25coverage_gap+.15preview_match)
STORY_CLUSTERING_V1=URL/GUID exatos; título/entidade/janela conservadores; representante + alternativas; sem auto-read
COLD_START_V1=Tópicos/OPML/feeds escolhidos e vista cronológica
EXPLAINABILITY_MODEL=Contribuições determinísticas; até dois motivos e um aviso; score e regra auditáveis
STORAGE_REQUIREMENTS=V1 mínimo sem DB; preferências negativas/mute persistentes requerem store próprio
NEW_DB_REQUIRED_V1=NO para V1 básico; YES para feedback NewsFlux durável e clusters cacheados persistentes, se ativados
PRIVACY_MODEL=Processamento local, sem dwell, sem coassinaturas, sem nuvem, retenção curta e opt-in para feedback
RSS_BRIDGE_ROLE=Fallback controlado para site sem feed nativo; nunca motor de ranking
MINIFLUX_ROLE=Fonte de feeds, artigos, estados e assinatura após Follow
IMPLEMENTATION_SEQUENCE=NF-REC-01→02→03→04; NF-DISC-01→02→03; NF-FB-01; V2/V3 só após gates
TOP_5_HIGH_GAIN_FEATURES=Ranking explicável; cold start por tópicos/OPML; cluster com alternativas; Discover com prévia; mute/menos como isto
RISKS=Cluster falso; ranking preso a fontes seguidas; feed spam; SSRF na descoberta; bridge frágil; histórico curto; score de qualidade confundir sindicância
OPEN_QUESTIONS=Repo NewsFlux/stack real? Versão Miniflux/RSS-Bridge? Número de feeds/idiomas? Catálogo inicial de fontes aprovado? Critério de sucesso UX? Retenção do histórico?
RECOMMENDED_FIRST_PR=NF-REC-01 (contratos, fixtures e adaptador Miniflux read-only)
CODE_CHANGES=NONE
MERGES=NONE
DEPLOYS=NONE
NEXT=Reconciliar com desenvolvimento noturno e red-team Claude; validar pesos/limiares em corpus do NewsFlux antes de implementar.
```
