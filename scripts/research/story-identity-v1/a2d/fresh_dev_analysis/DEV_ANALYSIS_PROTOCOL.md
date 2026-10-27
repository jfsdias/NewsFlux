# DEV analysis protocol

Only the hash-verified DEV labels, DEV pack and DEV metadata are joined with frozen P2 features and Search Rank V2. The sealed BLIND artifact and its sidecar are never opened; sealed state and its expected hash are checked through the P4-C manifest only. A path guard covers file opens and text/byte reads.

SAME_EVENT is merge-positive; RELATED_TOPIC and DIFFERENT_EVENT are distinct merge-negative classes; UNCERTAIN is excluded from confusion matrices. No scalar false-merge cost is imposed. Candidate A/B/C and deterministic Qwen-only thresholds are compared by Pareto dominance on false merges and false splits. Undefined precision or recall remains null.

This challenge sample is deliberately stratified, not a random sample of the 33,135-pair universe. Its class proportions are not corpus prevalence; challenge precision and recall are not production precision or population recall. No model, learned rule, new feature, final policy or BLIND evaluation is created here.

Sufficiency requires at least eight SAME_EVENT, eight RELATED_TOPIC, 60 non-UNCERTAIN records and positives in at least two buckets. The thresholds are fixed before analysis.
