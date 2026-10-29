# D2F1 frozen capacity report

The label-blind selection rules and tooling were committed before processing
real pair identities at preregistration commit
`2a4ea7a4f0a51d61954dcc27e6b8c230bad4078a`. The private pool was generated
and replayed from the same pinned non-label inputs. Independent validation
checked pair-universe membership, all three prior-pack exclusions, content
metadata, lane and rank rules, components, matching and frozen artifacts.

## Frontier

| Aggregate                                                  | Count |
| ---------------------------------------------------------- | ----: |
| Eligible pairs after strict prior-pack exclusions          | 5,175 |
| Both endpoints content-scoreable                           | 4,947 |
| Scoreable with possible non-title-equivalent content gain  | 4,944 |
| Unique pairs in union of lanes                             |   525 |
| Unique articles in pool                                    |   109 |
| Article-sharing components                                 |     4 |
| Largest component, pairs                                   |   408 |
| Exact maximum article-disjoint pairs                       |    54 |
| Maximum pairs choosing at most one per component           |     4 |
| Pool pairs with a title-equivalent endpoint                |     9 |
| Pool pairs with possible non-title-equivalent content gain |   525 |

Lane membership is nonexclusive: strong consensus 26, graph-supported event
514, cross-source paraphrase 1 and positive boundary 0. Sixteen pairs belong to
multiple lanes. Under the frozen primary-lane priority, 26 pairs are strong
consensus and 499 graph-supported. These are selection descriptions, not
human labels or claims of SAME_EVENT.

The component pair sizes are 408, 115, 1 and 1. The largest contains about
77.7% of the pool. There are 187 distinct feed-pair combinations; the largest
accounts for 4.0% of pool pairs. There are 31 category-pair combinations; the
largest accounts for about 26.5%. These distributions do not remove the
component-concentration concern.

## Review-size diagnostics

A 40-pair article-disjoint witness exists. The deterministic matching witness
contains 80 articles across four components, 28 feeds and nine categories;
its primary lanes are 8 strong consensus and 32 graph-supported, and all
40 pairs are content-scoreable. An 80-pair article-disjoint witness is
impossible because the exact maximum is 54.

Neither option is an approved budget or review pack. With only four disconnected
pool components, the 40-pair witness cannot deliver 40 independent components.
No positive-evidence component minimum was authorized, so the scientific
adequacy of that concentration is a PM decision rather than a fabricated pass
or fail threshold. Lane quotas also remain undecided.

## Frozen artifacts

- Pool SHA-256: `8316724ca107055bf77079399e6998546eb26c09b8ec1609bec9496c26e5c024`
- Capacity frontier SHA-256: `7e37d1feb78e10e8849f793388bb401beec7facb53e1a3cb0cd67bf1377d1954`
- Receipt SHA-256: `13f3683abd9d6e441c09d2e07a01481bf2a9cfbaba7412fe68d63faa4126fff9`
- Manifest SHA-256: `bb11378dc3e9ef45c48b6049d9964801d3e245076e09d61d1c8455e48018bb61`

No human decisions, D2E3 article content, source payload, model inference,
benchmark, live source or publisher access occurred. BLIND remains sealed.
