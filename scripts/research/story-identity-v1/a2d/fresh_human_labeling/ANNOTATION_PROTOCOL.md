# Human labeling session protocol

The human reviewer receives only the neutral review CSV and its annotation guide. The prepared blank files are immutable; human review must use a separate writable copy. The private mapping and all mining, component and search metadata must remain withheld during review. The order uses the hash of the P3 freeze-manifest hash and pair key, independent of source pack or model features. No agent, language model or automatic classifier may enter or infer decisions.

The reviewer uses only visible titles, feeds and publication times. The guide defines SAME_EVENT, RELATED_TOPIC, DIFFERENT_EVENT and UNCERTAIN, with false merges treated as more costly than false splits. Article bodies and historical decisions are outside the evidence boundary.

After a later separately authorized validated ingestion, DEV labels may be opened. BLIND labels must remain sealed after annotation and cannot be used for threshold tuning, provider selection, feature changes, search redesign or error-driven development until a separately authorized final-evaluation gate. This stage performs no ingestion, annotation or evaluation.
