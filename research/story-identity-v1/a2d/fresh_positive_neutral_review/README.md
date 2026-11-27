# Neutral review session preparation

D2F2 freezes a private 40-pair, article-disjoint review session from the D2F1 frozen pool. Two singleton components are mandatory; the large components contribute 21 and 17 pairs. The selected identities are frozen and validated before frozen title, feed and published-time metadata are read. The reviewer page reuses the neutral D2B template. It serves no private identity map and records no human decisions during preparation.

The recorded private session uses deterministic blind SHA-256 ordering, 40 sequential neutral IDs and blank decisions. It is discovery and development evidence only, not a population sample or generalization evidence. No benchmark, model inference, article content, or human labels are used in this stage. The D2E3 representation truncation cap remains undecided.

Governance rules, outside the reviewer surface: discovery requires at least one SAME_EVENT and at least two positive components; calibration requires at least 12 SAME_EVENT, three positive components, and largest positive-component share at most 0.50. Neither rule is evaluated during session preparation. The review itself requires separate authorization.

Matching semantics and proof are preregistered in `EXACT_K_METHOD.md`. The feasibility oracle uses NetworkX 3.4.2 only for cardinality. No product dependency is added. Run focused synthetic tests with Python 3.14.7 and NetworkX 3.4.2 via `python -m unittest discover -s scripts/research/story-identity-v1/a2d/fresh_positive_neutral_review -p 'test*.py'`.
