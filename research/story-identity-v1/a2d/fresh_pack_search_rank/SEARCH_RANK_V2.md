# STORY-02 search rank V2

The immutable, hash-verified historical pair artifact uses two-model ranks: `best_rank` is the minimum of the global Qwen and Mistral ordinal ranks, and `rank_sum` is their sum. The historical producer was not versioned; its formula and observed tie ordering were recovered from that artifact. Its `best_rank <= 1250` frontier has 2,387 of 18,953 pairs.

Feature V2 intentionally uses pinned Qwen only; Mistral is not reintroduced. A literal transfer of 1250 is rejected: the new universe and number of rankings differ. Instead transfer the historical frontier mass, taking the ceiling of 2387 / 18953 times the fresh 168-hour pair count. For 119,384 pairs the ceiling is 15,036.

`search_rank_v2` is a one-based global ordinal over the complete fresh 168-hour universe, ordered by Qwen cosine descending and canonical pair key ascending. The historical tied scores used pair key descending; the V2 tie policy is explicitly prospective. The two rank definitions are not identical; they preserve a functional purpose, not methodological identity. No labels, model inference, pair selection, or pack search are involved.
