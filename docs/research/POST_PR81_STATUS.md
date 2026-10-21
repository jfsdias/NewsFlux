# Post-PR81 Research Status

- **Date:** 2026-10-21
- **Current NewsFlux main / production baseline:** `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`
- **Purpose:** reconcile the historical research archive with subsequent empirical and product developments without rewriting the archived reports or the independent engineering review.
- **IMPLEMENTATION_AUTHORITY:** NO

## What changed after the archived review

The archived R1/R2/R3 reports and `NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md` remain historical snapshots at their stated refs. In particular, statements that Add Feed did not use Miniflux `/v1/discover` were correct for the reviewed `b6b7246` baseline.

Subsequent work changed the narrow Add Feed path:

- PR #81 implemented website-URL feed discovery through Miniflux `POST /v1/discover`.
- Zero candidates produce a no-results state and no subscription.
- One candidate requires explicit confirmation.
- Multiple candidates require explicit selection and confirmation.
- Subscription still occurs only after confirmation through the existing `POST /v1/feeds` flow.
- Existing category and full-text/crawler choices are preserved.
- Direct valid feed URL subscription remains supported.

This shipped feature is **feed resolution for an explicitly entered website URL**. It is not broad source discovery, recommendation ranking, automatic following, or a new personalization architecture.

## Empirical benchmark status

Discovery Benchmark V1 was subsequently run against the real local Miniflux corpus under its constrained read-only research design.

Project-level conclusion:

- the corpus was sufficient for the benchmark;
- G1 candidate generation produced enough signal to justify continued research;
- product-ranking quality was insufficient for product adoption;
- G2 produced no useful signal;
- broad Source Discovery and recommendation ranking remain **HOLD**.

No final candidate generator, recommendation algorithm, ranking weights, or external discovery service is approved by this result.

Raw benchmark outputs are intentionally not archived here. Derived candidate domains and links can reveal private interests, so this repository contains no raw corpus data, private candidate list, API key, authentication material, or benchmark artifact containing those values.

## Fetch-security status

Before PR #81, the deployed Miniflux environment's fetch-security prerequisite was resolved operationally so the narrow `/v1/discover` path could be enabled without relying on global private-network fetching.

That operational prerequisite is considered resolved for PR #81. It does **not** authorize unrestricted candidate fetching, crawling, RSS-Bridge expansion, or external discovery providers.

## Architecture gates that remain open

The following still require explicit architecture/product decisions before broader recommendation or discovery work:

1. **Durable preference storage / source of truth / privacy** — ownership, persistence, synchronization, export and deletion of declared interests, mutes or saved-view descriptors.
2. **Source identity** — how feeds, hostnames and publishers relate without unsafe automatic merging.
3. **Broader recommendation/discovery architecture** — candidate validation, ranking, diversity, repetition controls and any external-query path.

## Preserved product constraints

```text
AUTO_FOLLOW=REJECTED
UNIVERSAL_SOURCE_SCORE=REJECTED
BROAD_SOURCE_DISCOVERY=HOLD
RECOMMENDATION_RANKING=HOLD
ALL_AND_UNREAD=chronological and predictable; no silent personalization
MINIFLUX=source of truth for feeds, categories, read state and starred
```

This addendum changes no roadmap or implementation authority. It exists only so readers do not mistake historical research statements for the current shipped product state.
