# STORY-02 graph retrieval DEV selection report

The fixed E0/N1/G40 research contract yielded a label-blind, unannotated, article-disjoint DEV expansion. Candidate lane counts were 167 event, 17 near, and 2,385 control. Lexicographic feasibility locking with SciPy MILP 1.18.1 produced the same ordered selection and identical pack and sidecar bytes in two independent runs.

| Gate                                        | Result                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| Event / near / control selected             | 20 / 12 / 8                                          |
| Unique pairs / articles                     | 40 / 80                                              |
| Fresh corpus versus Home-200 overlap        | 0                                                    |
| Existing DEV pair / article overlap         | 0 / 0                                                |
| Existing BLIND pair / article overlap       | 0 / 0                                                |
| Gold isolation                              | Transitive via R2A receipt and Home-200 disjointness |
| Maximum feed / source-pair / category share | 0.10 / 0.05 / 0.3875                                 |
| Same-feed pairs                             | 0                                                    |
| Maximum stored temporal difference          | 23.1069 hours                                        |
| Replay / independent validator              | PASS / PASS                                          |

The validator separately verified the exact 24-hour ceiling against unrounded publication times. The Gold isolation statement is inferred; Gold labels were not read in this stage. No new human labels were created, and human review has not started.

## Private artifact hashes

- Contract: `0236f1671bf13a83d4c64aeacf46b9077caa81b67dc4ba54e6eb1c81ed81ae30`
- Pack: `d6d2a0531f6a94ef283831ee256ee3381945ea376643eeba275c5eb7f17380fe`
- Sidecar: `98a7dd67e21b7b0c3a96c031f3df1e25c61add04b4e84845acc2d7d8a9107e36`
- Audit: `77aa3f88ea7a4f01fdde8aa9f0af5254c349d2edd789121fa5451e71ca32d6f9`
- Manifest: `356dccd3e754085df8f2b46786240082f33563e3d1548ef66f5f3c898a4af2f5`

These are research artifacts, not a production policy or an estimate of production precision and recall. The next stage must separately prepare a neutral reviewer surface without exposing selection metadata.
