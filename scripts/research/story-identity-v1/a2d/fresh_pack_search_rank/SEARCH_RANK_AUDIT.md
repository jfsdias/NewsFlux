# Search rank V2 audit

The historical artifact SHA-256 is `bd50a4d4e316e2bdd0b6735c1df8c3fe52f6dc14878923325dd2794cfeb3eb14`. Both 18,953-row ordinal rankings reconstruct exactly using score descending and pair key descending on observed ties; best-rank minimum and rank-sum formulas have zero mismatches. The 1,250-rank frontiers intersect in 113 pairs, so their union contains 2,387 pairs. This confirms artifact semantics, not historical model lineage.

All specified frozen inputs passed SHA-256 verification. Offline V2 derivation produced 119,384 global ranks and joined all 33,135 P3 feature rows without changing their existing fields. Two derivations were byte-identical. The V2 ceiling is 15,036. The P3 frontier has 3,924 pairs, 377 articles, 50 feeds, 464 source pairs, and 135,945 two-edge chain seeds. Primary buckets are 1,712 positive-seeking and 2,212 hard-negative-seeking; the other two buckets have zero. This is an aggregate diagnostic, not a feasibility proof or a pack search.

The noncanonical absolute-1250 diagnostic has 360 P3 pairs. It was not used to set policy.

Private artifact SHA-256 values:

- global rank: `9df82e15d8fa65bba9bb726cb3c70b65871dc82f972fd91a5c86c24ce7e210d6`
- P3 derivative: `a6db023e7adf4e85b96222c2f21495a9f877ae85ed484e17a89950f3bda1ad02`
- audit: `01405c843da70a67fa5cfb17fd4f8a4fa99412f7758083f4e206bf05cbd0db8b`
- manifest: `c6a451a93dbd0f3d34e9d720f0462c1bf93a2be3aa484c1640883b76730db114`

No human decisions were parsed, no model inference was run, and no pairs were selected for annotation. Frozen outputs were verified after making them read-only.
