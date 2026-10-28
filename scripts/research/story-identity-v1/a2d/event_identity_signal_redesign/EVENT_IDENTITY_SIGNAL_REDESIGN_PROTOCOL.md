# Event identity signal redesign protocol

D2E is label-free research design. It preserves the D2D failure and audits only the schema and aggregate metadata of the frozen fresh corpus. It neither benchmarks a candidate nor selects thresholds, pairs, labels, models or a production policy.

The D2D joined artifact is hash-verified through a hash-only byte stream and is never decoded or parsed. Only the D2D aggregate analysis and manifest are read for scientific context. A local guard blocks the named Gold, old DEV, graph DEV, raw reviewer and BLIND human-label files and the joined artifact through common file APIs. The V1 candidate specification is verified by Git blob hash and remains unchanged.

The field inventory reports presence, nonempty count and share, type consistency, and aggregate string lengths. Whitespace-only strings and empty containers are empty; numeric zero is nonempty. Rich text is YES when at least one recognized non-title article-text field is nonempty for at least 80% of records; PARTIAL when its best coverage is positive but below 80%; otherwise NO. The 80% value is an input-routing rule, not a performance threshold. P90 uses the nearest-rank convention.

The audit is derived twice, independently validated against the corpus, atomically frozen, made read-only and rehashed. No raw article values or examples enter the private audit or tracked report. No external content is fetched.

The V2 candidate specification preregisters content-aware semantics, event anchors, their hybrid and a HOLD pairwise reference. Title-only signals remain a frozen benchmark; graph context is secondary corroboration. Future D2F evaluation must use component-group leakage controls, train-only parameter selection, false-merge safety first and no full-Gold fit. Fresh graph DEV is only a negative challenge after selection is frozen. BLIND stays sealed.
