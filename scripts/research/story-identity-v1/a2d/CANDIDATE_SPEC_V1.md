# STORY-02-A2D Candidate Specification V1

This versioned preregistration was committed before any A2D outer-test candidate evaluation. It contains no Gold row identifiers, labels, titles, URLs, or observed test errors.

## Frozen evaluation

- Outer split: `COMPONENT_GROUP_3FOLD; unchanged A2C fold assignment and fingerprint`.
- Inner selection uses only the two non-outer component folds in each outer training partition; the outer test fold is never passed to selection.
- Selection order: minimize inner OOF P3 hard-negative contamination, then false-family/cross-family merges; maximize SAME_EVENT capture, then F0.5 and precision; use the preregistered conservative parameter tie-break.
- P3 is frozen at cluster size 10, maximum temporal span 24h, strong multi-member support, and no multi-cluster bridging.
- Coverage remains at least 15 SAME_EVENT pairs; safety requires zero hard-negative contamination, false-family merges, and cross-family clusters.

## Candidate families

### 1. A_SEMANTIC_LEXICAL_CONFIRMATION

- Features: qwen_embedding_cosine, title_overlap_coefficient.
- Rule/model: monotonic conjunction: qwen >= T_sem AND title overlap >= T_lex.
- Train-only parameters: {"T_lex_grid": "0.10 through 0.65 inclusive in 0.05 increments", "T_sem_grid": "0.50 through 0.85 inclusive in 0.025 increments"}.
- Rationale: Require semantic similarity and independent lexical corroboration..
- Runtime dependency: local Qwen embedding feature plus deterministic title-token overlap.

### 2. B_SEMANTIC_TEMPORAL_CONFIRMATION

- Features: qwen_embedding_cosine, published_delta_hours.
- Rule/model: monotonic conjunction: qwen >= T_sem AND publication delta <= T_hours.
- Train-only parameters: {"T_hours_grid": [1, 2, 4, 8, 12, 24], "T_sem_grid": "0.50 through 0.85 inclusive in 0.025 increments"}.
- Rationale: Test whether temporal proximity adds within-P3 separation without relaxing P3's frozen 24h maximum span..
- Runtime dependency: local Qwen embedding feature plus existing article timestamps.

### 3. C_SEMANTIC_LOW_CORROBORATION_VETO

- Features: qwen_embedding_cosine, title_overlap_coefficient, entity_anchor_overlap, number_overlap, date_overlap.
- Rule/model: qwen threshold followed by a general veto when lexical overlap < 0.25, entity-anchor overlap < 0.25, number overlap == 0, and date overlap == 0.
- Train-only parameters: {"T_sem_grid": "0.50 through 0.85 inclusive in 0.025 increments", "veto_constants": "fixed in this preregistration; not fitted to any outer fold"}.
- Rationale: Reject semantic-only matches that lack every existing deterministic title corroboration signal..
- Runtime dependency: local Qwen embedding feature plus deterministic title-derived features.

### 4. D_LIGHTWEIGHT_LOGISTIC_REFERENCE

- Features: title_overlap_coefficient, title_jaccard_similarity, number_overlap, date_overlap, entity_anchor_overlap, published_delta_hours, same_calendar_day_utc, qwen_embedding_cosine.
- Rule/model: StandardScaler plus L2 LogisticRegression; threshold selected from inner OOF scores using the same safety-first selection order.
- Train-only parameters: {"max_iter": 1000, "random_state": 20261025, "regularization_C": 1.0, "solver": "lbfgs"}.
- Rationale: Small learned reference using already materialized pair features; no model-class escalation..
- Runtime dependency: scikit-learn research dependency plus local Qwen embedding feature; research-only.

## Evaluation boundary

- Fixed points, if reported for direct rules, are descriptive summaries of outer-fold train-derived parameters: strict uses the conservative extreme, median uses the median, and permissive uses the permissive extreme.
- Component bootstrap uses the existing fixed-component method (1,000 draws, seed 42).
- Home-200 runs only for candidates passing OOF safety and coverage; Gold/Home observations remain incomplete and are not exhaustive product guarantees.
- No full-Gold final fit, product integration, persistent state, Miniflux write, deployment, or canary.
- No label, family, pair universe, or fold changes; no model download, external article-content request, or pair-specific rule.
