# Graph DEV retrieval analysis protocol

This stage joins the frozen DEV human-label artifact with the frozen graph sidecar by exact pair identity, validates source IDs and lane quotas, and reports aggregate descriptive evidence. Gold, old row-level DEV, raw reviewer exports and sealed BLIND labels are prohibited. The historical comparison uses only hash-pinned tracked aggregate documents.

SAME_EVENT is the only merge-positive class. RELATED_TOPIC and DIFFERENT_EVENT are merge-negative; UNCERTAIN is excluded from confusion denominators. The event lane is a diagnostic merge proxy only, not a production classifier. Undefined precision or recall remains null.

Pre-existing evidence thresholds are eight SAME_EVENT, eight RELATED_TOPIC and 60 non-uncertain records. Positive buckets from different selection designs are not compared. This analysis performs no tuning, strategy search, training, model inference or production-policy selection.

The graph DEV pack is a constrained challenge sample. Its label proportions are not corpus prevalence; challenge precision is not production precision and challenge recall is not population recall. RELATED_TOPIC feature summaries have very small N and make no inferential claim.

The join, lane diagnostics and analysis are derived twice in memory. Frozen private artifacts are atomically written, hashed, made read-only and rehashed; an independent validator reconstructs the join, summaries, arithmetic and decision gates from authorized inputs. Only aggregates and artifact hashes enter the tracked report.
