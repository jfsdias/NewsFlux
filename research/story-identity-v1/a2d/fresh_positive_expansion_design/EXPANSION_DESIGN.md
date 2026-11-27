# D2F6 preregistration

Scope: label-blind expansion design and capacity frontier only. No review pack, annotations, model, benchmark, content, or network. The global count deficit of five is a governance fact, not an expected yield, budget, probability, or selection input.

Eligible universe: the frozen P3 cross-feed at most 24-hour universe with pinned D2F1 features and graph context, D2E2 usability metadata and both endpoints USABLE. Exclude at article level all identities in the frozen old DEV, BLIND pre-label, graph DEV and D2F2 selected sets. BLIND decisions remain sealed. Validate canonical identities, unique pairs, exact universe membership, required finite fields and frozen input hashes and modes. Title-equivalent endpoints remain eligible and are reported separately. No labels, raw payloads or article text are read.

Quantiles Q60, Q70, Q75, Q80, Q90 use linear interpolation over all eligible residual Qwen scores. Lexical floor is 0.05. ANY_ANCHOR means entity, number or date overlap greater than zero. Numeric temporal anchor means number or date overlap greater than zero; it is not substituted for ANY_ANCHOR in these strategies.

- B0: exact D2F1 pool after excluding D2F2 reviewed articles; preserve all prior exclusions.
- B1: Qwen >= Q70 and supporting feeds >= 2.
- B2: Qwen >= Q60 and supporting feeds >= 2 and ANY_ANCHOR.
- B3: Qwen >= Q80 and lexical >= 0.05 and ANY_ANCHOR.
- B4: Qwen >= Q80 and lexical < 0.05 and supporting feeds >= 1 and ANY_ANCHOR.
- B5: exact deduplicated union B1 through B4.

Sort each by Qwen descending, supporting feeds descending, lexical descending, time gap ascending, then ascending numeric pair identity. Each strategy reports candidate count, unique articles, connected components, largest component pair count/share, exact NetworkX 3.4.2 maximum-cardinality article matching, distinct feed/category pairs and maximum shares, title equivalence, usability, threshold and logical capacity gate (capacity >= 5). The gate is necessary only and provides no estimate of yield.

Dominance requires another strategy to have at least equal matching capacity and at least as strict score, support, and anchor constraints, with at least one strict improvement, in the same comparable lexical family. Unconstrained unions and the historical union are not single predicate families and are retained when strictness is ambiguous. Lexical >= and < families are incomparable. PM selects a strategy and budget later.

Tracked disclosure: aggregate label-blind metrics only. No candidate identities, review IDs, titles, URLs, private paths, human decisions, or private D2F5 results. Private files are immutable 0444 in a unique 0700 attempt; no overwrite. Replay must yield identical canonical bytes. An independent validator checks source integrity, exclusions, predicates, ordering, matching, aggregates, output hashes and permissions. A strict allowlist firewall blocks other input files and network. Stop on any source hash mismatch, forbidden access, overlap, pre-commit identity processing, changed thresholds, privacy leakage, replay mismatch or validator failure. Do not repair inputs or relax exclusions.
