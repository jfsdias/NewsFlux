# Fresh prospective pack search

The label-blind P2 universe contains 33,135 pairs, with the verified Search Rank V2 derivative joined exactly. The unrestricted universe remains the general pool. Only chain edges use `search_rank_v2 <= 15036`: 3,924 edges and 135,945 two-edge seeds. Historical article and pair exclusion continuity is established through the hash-verified P2 manifest.

The historical component-first MILP search was used with seed 20261026 and V2 rank adapted locally to its historical rank input. The preregistered nested frontier schedule was 80, 160 and 240 chain edges, respectively, plus 75, 125 and 175 pairs per primary bucket, ordered by a stable seeded hash. Each frontier used one restart, one motif variant per seed, one solver attempt, a 500-node cap and a 20-second solver limit. No global optimality or corpus infeasibility claim is made.

The first frontier contained 323 candidate edges, 129 chain seeds and 635 chain-component motifs. SciPy 1.18.1 reported an optimal solution within this bounded library. An independent search replay yielded the same DEV, BLIND and designated-chain identities. An independent validator recomputed all quotas, isolation, diversity, graph, chain and rank gates.

DEV has 80 pairs, 122 unique articles, and exact buckets 28/28/16/8. Maximum feed endpoint, source-pair and category shares are 0.11875, 0.0375 and approximately 0.45902. BLIND has 48 pairs, 90 unique articles, and exact buckets 16/16/8/8. Its maximum shares are approximately 0.10417, 0.04167 and 0.50. BLIND has 42 components, 36 independent pairs, six multi-pair components and six designated disjoint chains, with no chain bridges. Maximum component size is two edges and three articles. Maximum designated-chain rank is 11,677.

Review packs and audit sidecars are private. Their semantic artifacts were rebuilt twice, blinding was checked, and files were rehashed after changing modes to 0444. No human decisions, inference calls, or Miniflux writes were made. Pack contents and source identities are not committed. No annotation was performed.
