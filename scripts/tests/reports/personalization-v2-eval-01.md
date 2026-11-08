# Personalization V2 Evaluation 01 — post-PR191 reconciliation

- Audited main/base: 17135332f2948a3739b285cbcff112ea07f0996e
- Prior PR #190 head: 74a6f0ffc5681d0520c562e492eed9fb94847e15; the branch includes current main through a normal merge commit.
- Historical pre-PR191 report: main 430026000f2fe8c7f4e823e17ab39b38254198bf, source head 74a6f0ffc5681d0520c562e492eed9fb94847e15. Its exact original JSON report is retained unchanged under `historicalPre191.report` in the JSON receipt.
- Baseline: Phase 2C projection composed through current Home category/session helpers.
- Candidate: Current Phase 2D V1 personalization projection composed through the same helpers and PR191 generation commit contract.
- Data: deterministic synthetic entries and starred-profile rows only. No Miniflux access, mutations, persistent state, telemetry, or product-code changes.
- Fixed before evaluation: Top-N=12; 12 scenario identities; 101 composition measurements per arm.
- Top-N definition: first 12 article IDs in final visual order (up to 3 Highlights + 9 category-lane slots).
- Latency measures local projection, composition and disclosure helpers only; excludes network and browser rendering.

## Updated disclosure contract

The offline evaluator uses the production helpers `hasHomeEditorialCompositionChanged` and `commitHomePersonalizationSnapshot` from PR #191. It distinguishes intermediate order change, projection application, committed final composition, and visible disclosure.

For `intermediate_order_change_without_final_composition_change`:

- Intermediate order changed: YES.
- Projection applied: YES.
- Final presentation changed: NO.
- Disclosure visible: NO.
- Disclosure mismatch: NO.
- Top-N deltas (sources, categories, adjacent same-source pairs): {"distinctSources":0,"distinctCategories":0,"consecutiveSameSourcePairs":0}.

The old pre-PR191 report remains attached as a historical record. It records the prior mismatch for this scenario; the current run verifies that disclosure follows the committed final composition.

## Direct-star re-evaluation

Scenario: `secondary_highlight_changed_by_current_star` (synthetic observation; not a product relevance judgment).

- Primary Highlight: 5001 → 5001 (unchanged: true).
- Secondary Highlights: 5002, 5004 → 5007, 5004.
- Final visible IDs: 5001, 5002, 5004, 5003, 5005, 5006, 5007 → 5001, 5007, 5004, 5002, 5003, 5005, 5006.
- Eligible coverage: 7/7; missing=0; extra=0; no duplicates=true.
- Top-N source diversity: 6 → 6; category diversity: 6 → 6.
- Adjacent same-source pairs: 0 → 1; longest run: 1 → 2.
- Promoted item age displacement: {"promoted":[{"id":5007,"fromRank":7,"toRank":2,"ageFromPrimaryMinutes":30}],"rankPositionAgeComparisons":[{"rank":2,"baselineId":5002,"personalizedId":5007,"personalizedOlderByMinutes":25},{"rank":4,"baselineId":5003,"personalizedId":5002,"personalizedOlderByMinutes":-5},{"rank":5,"baselineId":5005,"personalizedId":5003,"personalizedOlderByMinutes":-10},{"rank":6,"baselineId":5006,"personalizedId":5005,"personalizedOlderByMinutes":-5},{"rank":7,"baselineId":5007,"personalizedId":5006,"personalizedOlderByMinutes":-5}],"maximumOlderByMinutesAtSameRank":25}.
- Reader order parity: true; disclosure visible: true.
- Classification: `SYNTHETIC_OBSERVATION_NO_DIVERSITY_GAIN_MORE_REPETITION`. No diversity gain was measured; repeated-source adjacency increased by one pair. This fixture does not estimate real-user editorial value.

## Per-fixture results

| Fixture                                                    | Primary 2C→V1 | Highlights IDs 2C→V1                | Category lanes (category(article IDs))                                                                                                    | Top-N sources→ / categories→ | Adjacent pairs / longest run 2C→V1 | Coverage V1                          | Reader parity | PR191 state: applied/final/disclosure     | Latency p50/p95 ms 2C / V1          |
| ---------------------------------------------------------- | ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- | ------------------------------------ | ------------- | ----------------------------------------- | ----------------------------------- |
| balanced_sources_and_categories                            | 1000 → 1000   | 1000, 1001, 1002 → 1000, 1001, 1002 | 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011) → 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011)       | 6→6 / 3→3                    | 0/1 → 0/1                          | 18/18; missing 0; extra 0; unique 18 | PASS          | applied=false; final=false; visible=false | 0.0939/0.1645 ms / 0.1915/0.3364 ms |
| star_profile_concentrated_in_one_source                    | 2000 → 2000   | 2000, 2013, 2014 → 2000, 2013, 2014 | 21(2001, 2004, 2007); 22(2002, 2005, 2008); 20(2003, 2006, 2009) → 21(2001, 2004, 2007); 22(2002, 2005, 2008); 20(2012, 2015, 2021)       | 3→6 / 3→3                    | 8/9 → 5/6                          | 24/24; missing 0; extra 0; unique 24 | PASS          | applied=true; final=true; visible=true    | 0.102/0.1545 ms / 0.2624/0.3859 ms  |
| star_profile_concentrated_in_one_category                  | 2000 → 2000   | 2000, 2013, 2014 → 2000, 2013, 2014 | 21(2001, 2004, 2007); 22(2002, 2005, 2008); 20(2003, 2006, 2009) → 21(2016, 2019, 2022); 22(2017, 2020, 2023); 20(2012, 2015, 2021)       | 3→6 / 3→3                    | 8/9 → 1/2                          | 24/24; missing 0; extra 0; unique 24 | PASS          | applied=true; final=true; visible=true    | 0.0943/0.1095 ms / 0.2598/0.3567 ms |
| different_sources_covering_the_same_category               | 3000 → 3000   | 3000, 3001, 3002 → 3000, 3001, 3002 | 60(3003, 3004, 3005) → 60(3003, 3004, 3005)                                                                                               | 6→6 / 1→1                    | 0/1 → 0/1                          | 12/12; missing 0; extra 0; unique 12 | PASS          | applied=false; final=false; visible=false | 0.0408/0.044 ms / 0.0806/0.1384 ms  |
| exact_60_minute_freshness_boundary                         | 4001 → 4001   | 4001, 4002, 4003 → 4001, 4003, 4002 | — → —                                                                                                                                     | 6→6 / 6→6                    | 0/1 → 0/1                          | 6/6; missing 0; extra 0; unique 6    | PASS          | applied=true; final=true; visible=true    | 0.0173/0.0194 ms / 0.0325/0.086 ms  |
| secondary_highlight_changed_by_current_star                | 5001 → 5001   | 5001, 5002, 5004 → 5001, 5007, 5004 | — → 200(5002, 5003)                                                                                                                       | 6→6 / 6→6                    | 0/1 → 1/2                          | 7/7; missing 0; extra 0; unique 7    | PASS          | applied=true; final=true; visible=true    | 0.0186/0.0231 ms / 0.0365/0.0829 ms |
| empty_star_profile                                         | 1000 → 1000   | 1000, 1001, 1002 → 1000, 1001, 1002 | 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011) → 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011)       | 6→6 / 3→3                    | 0/1 → 0/1                          | 18/18; missing 0; extra 0; unique 18 | PASS          | applied=false; final=false; visible=false | 0.068/0.089 ms / 0.1018/0.1544 ms   |
| invalid_profile_fallback                                   | 1000 → 1000   | 1000, 1001, 1002 → 1000, 1001, 1002 | 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011) → 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011)       | 6→6 / 3→3                    | 0/1 → 0/1                          | 18/18; missing 0; extra 0; unique 18 | PASS          | applied=false; final=false; visible=false | 0.0682/0.1 ms / 0.068/0.0845 ms     |
| late_profile_fallback                                      | 1000 → 1000   | 1000, 1001, 1002 → 1000, 1001, 1002 | 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011) → 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011)       | 6→6 / 3→3                    | 0/1 → 0/1                          | 18/18; missing 0; extra 0; unique 18 | PASS          | applied=false; final=false; visible=false | 0.0679/0.0947 ms / 0.0684/0.0972 ms |
| stale_session_profile_fallback                             | 1000 → 1000   | 1000, 1001, 1002 → 1000, 1001, 1002 | 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011) → 10(1003, 1006, 1009); 11(1004, 1007, 1010); 12(1005, 1008, 1011)       | 6→6 / 3→3                    | 0/1 → 0/1                          | 18/18; missing 0; extra 0; unique 18 | PASS          | applied=false; final=false; visible=false | 0.0703/0.0944 ms / 0.0685/0.0936 ms |
| same_category_title_different_ids                          | 6001 → 6001   | 6001, 6003, 6002 → 6001, 6003, 6004 | 72(6004, 6006) → 71(6002, 6005)                                                                                                           | 6→6 / 2→2                    | 0/1 → 0/1                          | 6/6; missing 0; extra 0; unique 6    | PASS          | applied=true; final=true; visible=true    | 0.0156/0.0174 ms / 0.0329/0.0403 ms |
| intermediate_order_change_without_final_composition_change | 7001 → 7001   | 7001, 7002, 7003 → 7001, 7002, 7003 | 701(7004, 7007, 7010); 702(7005, 7008, 7011); 703(7006, 7009, 7012) → 701(7004, 7007, 7010); 702(7005, 7008, 7011); 703(7006, 7009, 7012) | 3→3 / 3→3                    | 6/3 → 6/3                          | 12/12; missing 0; extra 0; unique 12 | PASS          | applied=true; final=false; visible=false  | 0.0451/0.0684 ms / 0.0931/0.1549 ms |

## Session and fallback stability

- loadMoreAppendsOnlyToLatest: PASS
- readMutationDoesNotRecompose: PASS
- refreshDoesNotRecompose: PASS
- readerReturnDoesNotRecompose: PASS
- starDoesNotRecompose: PASS
- unstarDoesNotRecompose: PASS
- lateProfileDoesNotRecompose: PASS
- invalidProfileFallsBack: PASS
- lateProfileFallsBack: PASS
- staleSessionProfileFallsBack: PASS
- staleRevisionIgnored: PASS
- staleGenerationIgnored: PASS
- lateProfileAfterCommitIgnored: PASS
- categoryIdentityPreserved: PASS
- freshnessBoundaryPreserved: PASS

The suite covers Load More, read, star/unstar, refresh, Reader return, late/invalid/stale profile fallback, late profile after commit, stale generation/session revision rejection, category ID identity, and the 60-minute freshness boundary. Invalid/late/stale profile fixtures are deterministic offline fallback scenarios, not live asynchronous/browser race tests.

## Quality and interpretation limits

- Across all 12 fixtures, primary highlight, eligible article coverage, no duplicate IDs, category identity, and Reader order parity are checked; current gates pass.
- Metrics describe synthetic fixtures only. They do not establish relevance, user satisfaction, or population-level improvement.
- No human review, private account data, live Miniflux, browser rendering, physical-device, or network-latency evaluation was performed.
- All/Unread routes are not ranked or changed by this evaluator.
- Personalization V2 remains unauthorized; this reconciliation does not activate it or assert production readiness.

## Reproduction

- Focused gate: `node --test scripts/personalization-v2-eval-01.test.js`
- Full Node gate: `pnpm test`
- Current JSON receipt: `scripts/tests/reports/personalization-v2-eval-01.json`
- The complete pre-PR191 JSON report is nested in the current receipt, preserving prior per-fixture metrics, latency samples, and session-stability output.
