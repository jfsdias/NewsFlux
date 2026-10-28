# Graph DEV human-label ingestion report

Forty previously completed human decisions were validated and ingested. The source CSV matched the pinned completed-input hash and the frozen reviewer metadata; removing decisions reconstructed the neutral session hash. The private mapping was bijective and matched the label-free R3 pack. All canonical outputs were frozen and independently checked.

Integrity counts: SAME_EVENT 0; RELATED_TOPIC 2; DIFFERENT_EVENT 38; UNCERTAIN 0. These are integrity checks only. No retrieval performance analysis was performed.

| Artifact                  | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Human input               | `c0a4bff64ec287f750229aad5d75cceeb19ae6a28dd7d4badc875eca54d22977` |
| Canonical human labels    | `561d857e73eb74e8ef9603e2699a5168ea4be5b7b117dcafb4fc2d5789ff57b1` |
| Aggregate ingestion audit | `0920f9a9143802b343b4279b6bb3a3fda68030d893d0c393d93d15492fdc2cf3` |
| Ingestion manifest        | `fef244105cfcfb129de5763a72d13392686e17d58700c402e4fcf927a03f855b` |

No new decisions were generated. Gold, old DEV and sealed BLIND labels and the R3 sidecar were not accessed. The D2B session and R3 artifacts remain unchanged.
