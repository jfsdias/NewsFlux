# Private pack schema incident

The first frozen attempt contained textual category metadata, which violated the already-authorized private-pack schema. Its selection was deterministic and article-disjoint, but its validator lacked an exact row-schema check. The attempt remains preserved and noncanonical; a new attempt is required.

The correction adds exact-key and type validation and projects the selected rows to the minimal permitted schema without feed or category metadata. Tests first reproduced the missing rejection. Disposable regeneration from the frozen source independently confirmed the old and new identity projections and rank vectors are identical. No strategy, ranking, exclusion, matching or selection rule changed.
