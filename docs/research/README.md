# NewsFlux Research Archive

This directory preserves the research chain behind NewsFlux's recommendation and source-discovery thinking, and adds an independent engineering review of it. **Nothing here is a product decision.** The canonical sequencing and decisions remain in [NEWSFLUX_ROADMAP.md](../NEWSFLUX_ROADMAP.md) and [NEWSFLUX_PROJECT_STATE.md](../NEWSFLUX_PROJECT_STATE.md), which this archive does not modify.

The archived reports and independent review are historical snapshots at their stated repository refs. Later product and empirical developments are recorded separately in [POST_PR81_STATUS.md](POST_PR81_STATUS.md) rather than rewriting their original findings.

```text
CURRENT_RESEARCH_BASELINE=R2 (recommendation) + R3 (source discovery), preserved as historical research baselines
CURRENT_ADD_FEED_DISCOVERY_STATUS=SHIPPED through PR #81
CURRENT_BROAD_SOURCE_DISCOVERY_STATUS=HOLD
CURRENT_RECOMMENDATION_RANKING_STATUS=HOLD
EMPIRICAL_DISCOVERY_BENCHMARK=COMPLETED
IMPLEMENTATION_AUTHORITY=NO (every document in this directory)
FINAL_RECOMMENDATION_ALGORITHM=NOT_APPROVED
FINAL_SOURCE_DISCOVERY_ALGORITHM=NOT_APPROVED
FINAL_RANKING_WEIGHTS=NOT_APPROVED
```

## Current status after PR #81

As of 2026-10-21, NewsFlux `main` and the production baseline reached `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8` after PR #81.

- Add Feed now supports website URLs through Miniflux `POST /v1/discover`.
- A single discovered candidate requires explicit confirmation; multiple candidates require explicit selection and confirmation.
- Direct valid feed URL subscription remains supported.
- This narrow Add Feed capability does **not** approve broad source discovery, recommendation ranking, automatic following, or silent ranking changes in All/Unread.
- Discovery Benchmark V1 was run empirically against the local corpus. Candidate generation produced enough signal to justify further research, but ranking quality was insufficient for product adoption and G2 produced no useful signal. Broad source discovery and recommendation ranking therefore remain **HOLD**.
- The Miniflux fetch-security prerequisite for `/v1/discover` was resolved operationally before PR #81. No secrets, API keys, raw benchmark output, private candidate domains, or derived corpus data are archived here.

See [POST_PR81_STATUS.md](POST_PR81_STATUS.md) for the dated reconciliation and the remaining architecture gates.

## Document lineage

```text
R1  initial synthesis                          (SUPERSEDED)
 └─ R2  deep reverse engineering + falsification of R1     (ACCEPTED_RESEARCH_BASELINE)
     └─ R3  NewsFlux-grounded source discovery             (ACCEPTED_SOURCE_DISCOVERY_BASELINE)
         └─ Benchmark V1  empirical harness                 (not archived here — not supplied)
             └─ Red team  adversarial review                (not archived here — not supplied)
Independent engineering review (this directory)             (separate historical track; verifies and extends the reports)
Post-PR81 status reconciliation                              (current-status addendum; no implementation authority)
```

### Archived documents

- [NEWSFLUX_REA_RECOMMENDATION_R1.md](NEWSFLUX_REA_RECOMMENDATION_R1.md) — 2026-10-20; **SUPERSEDED**. First synthesis of recommendation approaches and formulas. Its later-refuted claims were partly re-checked in code. Implementation authority: **NO**.
- [NEWSFLUX_REA_RECOMMENDATION_R2.md](NEWSFLUX_REA_RECOMMENDATION_R2.md) — 2026-10-20; **ACCEPTED_RESEARCH_BASELINE**. Reverse engineering of reference products and falsification of R1. A sample of its code and history claims was independently re-verified; its original aggregate counts were not recounted. Implementation authority: **NO**.
- [NEWSFLUX_REA_SOURCE_DISCOVERY_R3.md](NEWSFLUX_REA_SOURCE_DISCOVERY_R3.md) — 2026-10-21; **ACCEPTED_SOURCE_DISCOVERY_BASELINE**. Source-discovery architecture grounded in NewsFlux commit `b6b7246` and benchmark design. Its NewsFlux code claims were partly re-verified; coverage comparisons remain hypotheses. Implementation authority: **NO**.
- [NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md](NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md) — 2026-10-21; **HISTORICAL independent review** at NewsFlux `b6b7246`. Every conclusion carries an evidence label. The file is preserved unchanged. Implementation authority: **NO**.
- [POST_PR81_STATUS.md](POST_PR81_STATUS.md) — 2026-10-21; **CURRENT STATUS ADDENDUM**. Reconciles the archive with the benchmark run, fetch-security gate, and shipped PR #81. It does not re-grade historical evidence labels. Implementation authority: **NO**.

The benchmark harness and the in-session red-team report are part of the lineage but were not supplied as files for this archive, so no raw benchmark artifact or placeholder is added here. The post-PR81 addendum records only the project-level outcome needed to prevent stale current-state claims.

## Independent review

[NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md](NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md) is authored separately from the three reports. Its conclusions are not attributed to the REA reports, and where it disagrees with them it says so explicitly. It reads open-source reference implementations at pinned commits, qualifies closed-source behaviour as vendor-documented rather than implemented, and maps each feature onto what NewsFlux contained at its stated `b6b7246` base.

The review itself is preserved unchanged as a historical snapshot. Statements such as Add Feed not calling `/v1/discover` describe that historical base, not the post-PR81 product. Current status is recorded in [POST_PR81_STATUS.md](POST_PR81_STATUS.md).

## Decisions preserved

These decisions come from the accepted baselines and the project's product principles. Nothing in the independent review or post-PR81 status reconciliation reverses them.

```text
READ_AS_PREFERENCE=REJECTED
STAR_AS_STRONG_PREFERENCE=REJECTED
HOME_PROFILE_AS_DURABLE_INTEREST_MAP=REJECTED
AUTO_FOLLOW=REJECTED
UNIVERSAL_SOURCE_SCORE=REJECTED
BROAD_SOURCE_DISCOVERY=HOLD
EXTERNAL_DISCOVERY=GATED (default off; explicit consent; public queries only)
ALL_AND_UNREAD=chronological and predictable; no silent personalization
MINIFLUX=source of truth for feeds, categories, read state and starred
```

## Architecture gates and resolved prerequisite

The roadmap requires an explicit decision before any first-party persistent state. The following architecture gates remain open:

- **Preference storage / source of truth / privacy:** where declared interests, mutes and saved-view descriptors would live, who owns them, how they sync, and how they are exported or deleted.
- **Source identity:** how hostnames, feeds and publishers are related, without automatic merging.
- **Broader recommendation and discovery architecture:** candidate generation, validation, ranking, diversity and any external discovery path remain research topics rather than approved product algorithms.

The **fetch-security prerequisite for the narrow Miniflux `/v1/discover` integration is resolved operationally** for the deployed environment. That resolution enabled PR #81 but does not authorize arbitrary candidate fetching or external discovery services.

## Conventions

- **Evidence labels** (`CODE_VERIFIED`, `TEST_VERIFIED`, `HISTORY_VERIFIED`, `DOC_VERIFIED`, `OBSERVED`, `RESEARCH_REPORT_ONLY`, `INFERENCE`, `HYPOTHESIS`, `UNKNOWN`) are defined in the independent review.
- **Archived reports are not rewritten.** Their status banners and bodies remain historical snapshots. Later findings and product changes are documented separately.
- **Code references** in the independent review use commit SHAs, not branch names.
- **Private benchmark material is not archived.** Raw output, derived candidate domains/links and credentials remain outside the repository.
