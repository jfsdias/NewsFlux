# D2F7 preregistration

Use only B1 membership from the pinned canonical D2F6 artifacts. Verify all five source bytes and modes before parsing. Selection is label-blind and article-disjoint; no human decisions, titles, content, network, model, benchmark or review session are permitted.

Rank all B1 pairs by Qwen descending, support descending, lexical overlap descending, gap ascending, and numeric article IDs ascending. Choose exactly k=11, with no quotas or secondary objectives. Process ranked edges in order: skip occupied endpoints; tentatively include each eligible edge and use NetworkX 3.4.2 solely as a maximum-cardinality oracle over later eligible edges with occupied endpoints removed. Accept only when the remaining matching can complete k. The result is the lexicographically minimum sorted rank vector among exact-k matchings; fail if k is infeasible. Proof uses exhaustive small synthetic graphs and an independent feasibility implementation.

The source B1 must have 36 pairs, 25 articles, exact maximum matching 11, Q70 0.2297840754548002 and the direct residual Q70 policy. Confirm prior-review article exclusion using only frozen pre-label identities. Recompute selection twice; independent pre- and post-freeze validation must include source hashes, identities, rank, exact-k optimality and all output hashes/modes. Stop on mismatch; never adjust k or switch strategies.

The selection is a private identity pack, not a reviewer pack. Freeze only in a new mode-0700 private attempt with mode-0444 files, without overwrite; tracked material contains aggregate label-blind facts only. The count deficit of five is not an expected yield. No human review is authorized in this track.
