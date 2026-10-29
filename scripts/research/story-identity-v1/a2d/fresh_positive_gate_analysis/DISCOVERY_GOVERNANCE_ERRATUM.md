# Fresh positive discovery governance erratum

GOVERNANCE_ERRATUM_TIMING=POST_ANNOTATION_PRE_STRATIFIED_ANALYSIS

LEGACY_DISCOVERY_RULE=SAME_EVENT_COUNT>=1 AND POSITIVE_COMPONENT_COUNT>=2

LEGACY_DISCOVERY_RULE_STATUS=SUPERSEDED_SEMANTICALLY_INCONSISTENT

CANONICAL_FRESH_DISCOVERY_RULE_V2: PASS iff SAME_EVENT_COUNT >= 1.

Discovery is an existence claim. Component diversity is a calibration claim. One positive establishes existence even when two positive components are impossible. This correction is post-annotation, not preregistered, and uses no component-level label results. It is not population inference; it changes neither human labels nor the selected sample. The historical contract remains unchanged.

The historical calibration heuristic remains SAME_EVENT_COUNT >= 12 AND POSITIVE_COMPONENT_COUNT >= 3 AND LARGEST_POSITIVE_COMPONENT_SHARE <= 0.50. Its thresholds are heuristic, not a statistically derived sample-size proof. Its result does not automatically authorize a benchmark, even if it passes. Benchmark authorization remains a separate PM decision.
