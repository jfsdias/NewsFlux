# Fresh corpus content enrichment contract

**AUTHORIZED_NOW=CONTRACT DESIGN ONLY. AUTHORIZED_LATER=NOTHING UNTIL PM APPROVAL.** MINIFLUX CONTENT ACCESS IS NOT AUTHORIZED IN D2E1. PUBLISHER HTTP FETCH IS HOLD. NO ARTICLE CONTENT WAS FETCHED.

## Identity and storage

The frozen 500-record corpus remains byte-identical. Future enrichment is an immutable sidecar keyed by article ID, with exactly one row per original article, including failures. Preserve article ID, title, publication time, feed, category, original URL, corpus membership and ordering identity. Never replace articles or substitute a related story.

Tier 1 is Miniflux stored entry content, fetched by immutable entry ID only after separate authorization. Verify existence, exact entry ID, original URL consistency and title consistency. Do not silently repair a mismatch or require byte-identical title strings without evidence that equivalence is guaranteed. Identity statuses are IDENTITY_MATCH, IDENTITY_MISMATCH, ENTRY_NOT_FOUND and SOURCE_UNAVAILABLE. Only IDENTITY_MATCH can yield usable content.

Tier 2 is the original publisher URL and remains HOLD until a later explicit PM gate. Search snippets and caches, mirrors, generated or browser summaries, LLM reconstruction, readability proxies, archive services, social reposts, other articles and manually substituted URLs are prohibited without a new governance decision.

## Time and content

Keep original publication and creation timestamps separate from retrieval time. Retrieval after publication is recorded as provenance. Miniflux content represents MINIFLUX_STORED_ENTRY_STATE_AT_RETRIEVAL unless immutability is independently established; a later authorized publisher fetch represents LIVE_PAGE_AT_RETRIEVAL. Do not claim an original publication snapshot without proof.

Capture raw payloads separately from normalized research text. Raw bytes may be retained only as a private hashed artifact when reproducibility requires it. No raw or normalized article content is committed to Git or sent to external model or summarizer APIs. Local processing only.

Normalize deterministically in this order: identify source field, decode declared encoding, parse HTML without executing scripts, remove structural script/style/noscript/navigation/form controls, decode entities, normalize Unicode NFC, collapse whitespace, trim, then truncate to 8,192 Unicode code points. No token- or language-dependent truncation, translation, LLM cleaning or publisher-specific rule is authorized. Preserve content over cleanliness. The sidecar holds non-title content; a future benchmark may explicitly combine title, newline and normalized content. Title-only fallback is not enriched content.

Content status is USABLE, EMPTY_AFTER_NORMALIZATION, STRUCTURAL_ONLY, UNSUPPORTED_FORMAT, IDENTITY_FAILURE or SOURCE_FAILURE. Count enrichment only for USABLE plus IDENTITY_MATCH. Preserve original language metadata; do not discard languages.

## Coverage and routing

Usable coverage is usable articles divided by the original 500; never drop or replace failed records. At least 400/500 (0.80) routes to content-aware benchmark preparation. A positive result below 400 routes to a PM coverage decision; zero routes to a PM source-escalation decision. This is a research routing threshold, not a performance threshold. Publisher access does not become authorized automatically.

## Conditional HTTP security

The following applies only if publisher fetching is later explicitly authorized: HTTP/HTTPS only; reject file URLs, localhost, loopback, RFC1918 private, link-local and cloud metadata destinations; check resolved DNS addresses before each connection and every redirect destination. Follow at most five actual HTTP redirects; record the entire chain and keep original, requested and final URLs separate. Cross-origin redirects are permitted only when each hop passes network safety. HTML canonical-link metadata alone never triggers another fetch.

2xx is a candidate for extraction; 3xx follows only the redirect contract; 401/403 is SOURCE_RESTRICTED; 404/410 SOURCE_NOT_FOUND; 429 SOURCE_RATE_LIMITED; 5xx SOURCE_SERVER_FAILURE. Never bypass paywalls, authentication or bot protection. Require bounded concurrency and retries, per-host throttling, a global request ceiling, Retry-After compliance and an identifiable research user-agent. Exact operational limits require a later execution contract.

## Future artifacts and reproducibility

A unique private attempt under `~/NewsFlux-STORY00/private-p4/story02-a2d2c/p4-fresh-content-enrichment/` will contain `fresh-content-enrichment-v1.jsonl`, a capture receipt and a manifest. The sidecar has 500 unique IDs and preserves success and failure rows. Per-record provenance includes source tier/kind/identifier, original/requested/final URL, redirect count, HTTP status when applicable, retrieval time, content availability/status, raw and normalized hashes, normalized length, identity status and failure reason. Miniflux-irrelevant HTTP fields may be null.

The aggregate receipt records original corpus and contract hashes, source and identity counts, usable/failure counts, coverage, redirects when applicable and network-read counts. The manifest pins the original corpus, contract, source policy and normalization versions, sidecar and receipt hashes, count, coverage, temporal semantics and network mode. No content examples enter tracked files.

Pipeline replay requires the same identities, hierarchy, normalization and source payloads. Source-byte reproducibility is a separate question: Miniflux stored-content stability needs evidence, and live publisher pages are not assumed byte-stable.

## Next stage

After this contract is merged, a separately authorized D2E2 read-only, label-blind Miniflux capability probe may measure stored-content availability with a deterministic corpus-wide or identity sample. It performs no publisher fetch or benchmark. PM then decides whether Miniflux coverage warrants a full Miniflux-only capture, a partial-coverage decision or a separate proposal to release publisher fetch from HOLD.
