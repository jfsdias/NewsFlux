# D2F5 positive evidence gate analysis

TRACKED_DISCLOSURE_POLICY=GLOBAL_NON_STRATIFIED_ONLY

The governance erratum was committed after annotation and before stratified analysis. The historical contract is unchanged; the correction was not preregistered. Discovery is an existence claim: the corrected rule passes when at least one fresh SAME_EVENT decision exists.

Global frozen decisions: SAME_EVENT=7, RELATED_TOPIC=1, DIFFERENT_EVENT=32, UNCERTAIN=0. The exact pair sets match. FRESH_POSITIVE_DISCOVERY_GATE_V2=PASS; FRESH_SAME_EVENT_EXISTENCE_ESTABLISHED=YES; FRESH_SAME_EVENT_PREVALENCE=UNKNOWN. The enriched review sample is not population prevalence, precision, recall, or production performance evidence. RELATED_TOPIC is merge-negative; SAME_EVENT is merge-positive. False merges are costlier than false splits.

LEGACY_CALIBRATION_COUNT_CONDITION=FAIL. LEGACY_CALIBRATION_RULE_RESULT=FAIL: seven is below the historical minimum of twelve, independently of the other conditions. This does not invalidate the positive decisions. CALIBRATION_GOVERNANCE_STATUS=LEGACY_HEURISTIC_NOT_AUTOMATIC_BENCHMARK_AUTHORIZATION. No benchmark is authorized by this analysis.

The reviewed sample contains very small strata, including singleton strata. Derived stratified aggregates can permit reconstruction of individual decisions through differencing or combination with known sample composition. This report therefore publishes global non-stratified counts and conclusions established from those counts alone. Component and lane analyses are complete privately and not disclosed.

RESEARCH_RECOMMENDATION=FRESH_POSITIVE_EVIDENCE_EXISTS_BUT_CALIBRATION_HEURISTIC_NOT_MET. Recommend a separately authorized STORY_02_A2D2C_P4_D2F6_FRESH_POSITIVE_EVIDENCE_EXPANSION_DESIGN; do not start it automatically.

POSITIVE_COMPONENT_COUNT=SUPPRESSED_PRIVACY  
LARGEST_POSITIVE_COMPONENT_COUNT=SUPPRESSED_PRIVACY  
LARGEST_POSITIVE_COMPONENT_SHARE=SUPPRESSED_PRIVACY  
SAME_EVENT_COMPONENT_COVERAGE=SUPPRESSED_PRIVACY  
LEGACY_CALIBRATION_COMPONENT_CONDITION=PRIVATE_NOT_DISCLOSED  
LEGACY_CALIBRATION_CONCENTRATION_CONDITION=PRIVATE_NOT_DISCLOSED  
STRATIFIED_COMPONENT_ANALYSIS=PRIVATE_COMPLETE_NOT_DISCLOSED  
STRATIFIED_LANE_ANALYSIS=PRIVATE_COMPLETE_NOT_DISCLOSED
