# Design red team

| Risk                                        | Design barrier / required stop                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old labels leak into validation             | Only a new post-merge window may enter the validation frame. Provenance, timestamp and ID-disjointness failure stops validation.                                      |
| Thresholds change after capture             | Freeze executable rule, extractor versions, commit, seeds and analysis before the window. Any post-capture change invalidates that window for validation.             |
| Inclusion probabilities become unknowable   | Freeze the entire frame and SRSWOR method. Unknown frame or incomplete sampled component means INCONCLUSIVE.                                                          |
| Correlated pairs inflate sample size        | Primary unit is the full pre-label graph component; exact finite-population component inference and worst-case edge weighting avoid treating edges as independent.    |
| UNCERTAIN conceals unsafe merges            | Treat UNCERTAIN as unconfirmed and count it against confirmed safety.                                                                                                 |
| One story dominates                         | Entire components are sampled and reviewed; the largest component weights enter the conservative bound. Oversized components stop for PM.                             |
| Pairwise PASS hides cluster contamination   | Require the preregistered false-family guard and adjudicated component review in addition to the edge bound.                                                          |
| Reviewer disagreement invalidates inference | Require two independent reviewers, adjudication and the preregistered agreement gate; failure is INCONCLUSIVE.                                                        |
| Silent old-corpus fallback                  | Reject pre-window/backfilled entries, require provenance and fixed time bounds; no fallback.                                                                          |
| Dense capture favors syndicated events      | Capture all eligible entries; use a complete component frame and a conservative edge-weight bound. Any extrapolation beyond that window requires a separate decision. |

All barriers are required conditions, not evidence that future validation will succeed. Exact interval implementation and coverage tests, event adjudication, volume and review caps, reviewer agreement threshold and the catastrophic-failure rule require independent review and PM approval before capture. Failure to resolve any prerequisite stops future validation. No fixed design-effect multiplier is assumed.
