# NF-CONTENT-EXTRACTION-R1 — offline comparison admission

Base: `8789d43ce523fe248cd2be6bf27958640c74eff9`. Scope: improve readability of content already lawfully accessible to the user, not acquire new content or bypass access controls.

## Existing implementation (source readback)

- The existing native Miniflux extraction and content-fallback contracts are distinct from display. Do not replace Miniflux ownership or introduce a new fetcher.
- `services/content_fallback/content.py` assesses text structure/completeness and reconstructs escaped paragraph-only HTML. Existing tests cover incomplete, duplicate and unavailable content and preservation of the original.
- `services/content_fallback/README.md`, `SECURITY.md` and ADR 0001 constrain the service. Preserve policy, network, identity, provenance and original-body fallback. No changes to a deployed sidecar, provider, reverse proxy or schema.

## Reuse-first decision

Mozilla Readability (Apache-2.0) is a candidate for **offline DOM parsing of already authorized visible HTML**, not a content retrieval mechanism. Official README: https://github.com/mozilla/readability/blob/main/README.md — the library extracts readable content from a DOM; it is not a sanitizer. Any subsequent runtime integration requires independent output sanitization, bounded inputs and a comparison against the existing native extractor. No dependency added yet.

## Qualification plan

Use invented, locally authored public-style articles only, with known expected visible paragraphs, no network, no accounts, no publisher documents or external providers. Compare the existing native extraction flow and Readability on the same eligible already-visible inputs, including prose, article headings, generic navigation, captions, short legitimate articles, duplicate decorative blocks and malformed markup. Measure content coverage against the authored expected text, unrelated chrome retention, false-empty results, deterministic repeatability and elapsed time. Preserve the original on ambiguity, insufficient content or any rejection. Inputs indicating restricted or unavailable access are excluded before parsing; they must not be recovered by the candidate.

Run in the isolated Mac mini lab with exact pinned library/dependency versions, scripts and resource fetching disabled, and no real data. Do not treat a parser result as permission to display markup. Compare text-only output before considering any integration; explicitly reject if quality gain is not material or dependency/runtime cost is disproportionate.

## Evidence status

Official Readability documentation and current repository contracts reviewed. No local Readability/DOM dependency in npm cache; direct GitHub DNS inaccessible. No benchmark executed, no implementation or integration approved by this document. Next: qualify a synthetic fixture comparison against exact dependencies off-host. No production, provider calls, changes to PR188/NPM111, or merge/deploy authorized.

## Comparative reuse assessment — Fetch Content P0

Sources: official Mozilla Readability README (https://github.com/mozilla/readability/blob/main/README.md), Trafilatura documentation (https://trafilatura.readthedocs.io/en/stable/index.html and https://trafilatura.readthedocs.io/en/stable/extraction-overview.html), its Apache-2.0 LICENSE (https://github.com/adbar/trafilatura/blob/master/LICENSE), UnWall (https://unwall.app/) and WallHop (https://wallhop.io/) public product descriptions. Reviewed product descriptions only; no provider content retrieval or access-control evasion analysis. Neither hosted service provides verified reusable service code in this review.

Decision: REUSE approved extraction concepts only, using already authorized visible HTML; prefer maintained independent parsers. Keep current Miniflux retrieval, existing content assessor and Reader provenance boundaries. Readability is a candidate for optional Reader presentation; Trafilatura is a second comparison candidate because the existing fallback service is Python and its extraction supports structure and configurable output. No new dependency until benchmark demonstrates material improvement. Do not add crawling or retrieval mechanisms.

Benchmark additions: compare existing display baseline, Readability and Trafilatura against the same authored visible-only fixtures; measure paragraph preservation, intrusions from navigation/footer, heading/list/table/code/caption preservation, false-empty outputs, elapsed time and dependency footprint. Run only on prequalified fixtures already known to be accessible, with network disabled. Preserve original article, reader continuity, AI input, media behavior and Miniflux identity. The output must be independently sanitized before any later display integration. No parser result establishes completeness or access authorization. On ambiguous, incomplete or restricted input, display the available original and offer a normal publisher link; separate open-access locator #315 may offer an expressly licensed academic copy.

Status: RESEARCH_COMPLETE / BENCHMARK_PENDING. No provider calls, code for circumventing restrictions, deployment, merge, or production changes.

## Offline benchmark checkpoint

Run from repository root in an isolated environment with approved, pinned optional dependencies installed:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/fetch-content-benchmark/benchmark.py --baseline services/content_fallback/content.py
```

Harness uses six authored fixtures, exact expected text/repetition and semantic-tag coverage, decorative noise and deterministic output over five runs. Only already visible synthetic content; no input URLs, credentials, provider calls or network retrieval. It reports missing engines rather than substituting a mock. Optional Readability requires a DOM implementation; optional Trafilatura requires its Python package. Pin versions and record runtime/dependency identities before comparative qualification.

Local checkpoint: exact existing assessor blob 3e41c2a4111bb8b2ddedced11233e13062dfec59; Python 3.14.7, Node 26.13.0. Existing assessor retained 22/22 expected text occurrences, 0/3 decorative noise markers, 6/15 expected semantic tag types aggregated across fixtures, 6/6 deterministic and non-empty. It is deliberately a paragraph-only recovery overlay; this does not establish a Reader rendering defect. Readability BLOCKED_DEPENDENCY_OR_RUNTIME; Trafilatura BLOCKED_DEPENDENCY. No comparative winner; no runtime integration. The NYT URL was not used because access was unverified.

## Owner-provided comparative report review

The report records direct, already-open publisher-page comparisons and provides useful evidence of structural fidelity loss. Its empirical results are reported by the author, not independently reproduced here. Candidate comparisons do not establish universal completeness; a longer output may include chrome. Prioritize visible text preservation and semantic structure, then measure noise and performance. Readability discovery is consistent with its published contract; no hosted-service source/license admission established.

Do not copy the report's snippets that recover non-visible content or use acquisition behavior to bypass access restrictions. Do not adopt the proposed permissive sanitizer settings: current bridge accepts only escaped paragraphs, so richer recovered output requires a separately versioned strict schema and end-to-end security/compatibility gate, with no remote assets or arbitrary active markup by default. Never interpret HTML or metadata presence as authority. Preserve original body, provenance and AI input.

First incremental implementation: #316 is Reader-only, preserves existing visible figure-caption line breaks, has no change to the recovery service/contract and no new acquisition mechanism. Synthetic browser gate pending. The report supports a future richer semantic representation of already authorized visible content, subject to separate qualification. No broad implementation or deployment is claimed.
