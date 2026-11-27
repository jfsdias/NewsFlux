# D2F6 threshold reporting schema erratum

SCHEMA_ERRATUM_TIMING=POST_PREREGISTRATION_POST_IDENTITY_PROCESSING_PRE_VALIDATED_CANONICAL_FREEZE

THIRD_FAILURE_CLASS=REPORTING_SCHEMA_AMBIGUITY

APPROVED_SCHEMA_OPTION=NULLABLE_SCALAR_PLUS_STRUCTURED_POLICY

SCHEMA_VERSION=D2F6_THRESHOLD_REPORTING_V2

SCIENTIFIC_SELECTION_CHANGE_REQUIRED=NO

CANDIDATE_MEMBERSHIP_CHANGE_REQUIRED=NO

PREREGISTRATION_RULE_CHANGE_REQUIRED=NO

ORIGINAL_PREREGISTRATION_HASH_MUST_REMAIN_UNCHANGED=YES

Each strategy reports QWEN_THRESHOLD_USED and QWEN_THRESHOLD_POLICY. B1, B2, B3 and B4 use numeric residual-universe Q70, Q60, Q80 and Q80 respectively, with DIRECT_RESIDUAL_QUANTILE policy and the corresponding quantile ID. B0 and B5 use null: it means no single scalar describes the complete composite rule, not missing or unknown data.

B0 inherits the frozen D2F1 pool's lane-specific historical thresholds: STRONG_CONSENSUS D2F1_Q90, GRAPH_SUPPORTED_EVENT D2F1_Q75, CROSS_SOURCE_PARAPHRASE D2F1_Q90, POSITIVE_BOUNDARY D2F1_Q90. These are not residual D2F6 quantiles. B5 is the exact union of B1_GRAPH_Q70, B2_GRAPH_Q60_ANCHORED, B3_CONSENSUS_Q80 and B4_PARAPHRASE_Q80, referenced as constituents rather than copied predicates.

This post-preregistration reporting clarification does not change any candidate, threshold, exclusion, ranking, capacity, matching, dominance or scientific rule. The original preregistration and previously invalid private attempt remain unchanged.
