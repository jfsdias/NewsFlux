# STORY-02 P4-D2A-R2 graph-context retrieval protocol

## Scope

This stage tests whether local multi-source graph context can retrieve concrete event identity more effectively than isolated pair scoring. It is research-only. It does not select a final fresh pack, annotate new pairs, change product code, run model inference, evaluate BLIND human labels, deploy, or canary.

## Frozen inputs

The runner requires the pinned fresh P2 feature universe, fresh corpus, existing pre-label DEV/BLIND annotation packs, historical Home-200 corpus/pair universe, historical stored vectors, P4-D open DEV diagnostics, Gold V2, and the P4-C ingestion manifest. Every known artifact is SHA-verified before use.

The historical/fresh Qwen numerical bridge is re-established from the tracked `fresh_feature_v2/FUNCTIONAL_BRIDGE_REPORT.md`, pinned by SHA-256. The bridge evidence requires 200/200 exact vectors, 18,953 pair-score deltas of 0.0, and Spearman rho 1.0. No model call is made.

## BLIND firewall

The sealed BLIND human-label file is never opened, hashed, copied, parsed, joined, or evaluated. A runtime guard rejects `builtins.open`, `io.open`, `Path.open`, `Path.read_text`, and `Path.read_bytes` for that filename. Pre-label BLIND identities are read only from the frozen P3 annotation pack to exclude already-reviewed articles.

All new fresh candidate endpoints and support nodes must be unused articles. For old-DEV diagnostics, each already-open DEV pair may temporarily admit only its own two endpoints; every other reviewed DEV/BLIND article remains excluded from contextual support and ranking.

## Graph contract

The graph uses only frozen cross-feed pairs with temporal delta <= 24h.

- support edge: Qwen >= 0.34703578961316583 and delta <= 12h;
- direct strategy floor: Qwen >= 0.29742977850168295 and delta <= 12h.

Neighbor ordering is deterministic: Qwen descending, temporal delta ascending, pair key ascending.

Sampling-only contextual features:

- reciprocal neighbor rank;
- shared third-source support article count;
- shared third-source feed count;
- common top-5 and top-10 neighbor counts;
- support degree per endpoint and minimum support degree;
- shared-support burst span.

These are retrieval-research-only values and are not production Story features.

## Frozen strategy catalog

The canonical strategy catalog is embedded in `graph_context.py` and hashed before any Gold or old-DEV label is read. Current expected catalog SHA-256 is:

`70dd2bcb55bbd36a9bf4327ef8bd3c980e5a10b9a5f4af0ade4e12472f2b8a9c`

Event strategies are E0-E5 exactly as predeclared in the PM contract. Near-miss strategies are N0-N1 exactly as predeclared. The global direct floor applies to all E/N strategies.

## Freeze-before-label order

`run_audit()` performs the following sequence:

1. verify label-blind inputs and sealed-state manifest;
2. derive fresh and historical graph context twice;
3. require byte-identical replay;
4. freeze fresh context, historical context, and strategy catalog read-only;
5. verify the frozen historical context and catalog again;
6. only then parse open DEV labels and Gold V2;
7. validate all Gold pair identities against the historical source and context, and all Gold article identities against Home-200; fail before family or strategy diagnostics on any missing identity;
8. derive aggregate diagnostics, capacity, and G40/G48 feasibility twice;
9. require identical aggregate bytes;
10. freeze the aggregate Gold coverage receipt, diagnostics, audit, and manifest read-only.

## Gold diagnostics

Gold V2 is validated fail-fast at 233 unique pairs with exact class counts:

- SAME_EVENT 57
- RELATED_TOPIC 27
- DIFFERENT_EVENT 149
- UNCERTAIN 0

SAME_EVENT families are recomputed as connected components and must equal 10.

An event strategy passes the evidence floor only with at least 8 SAME_EVENT matches across at least 4 families. A near-miss strategy passes only with at least 4 RELATED_TOPIC matches. These are challenge-set evidence floors, not production precision/recall estimates.

## Fresh feasibility

For each E0-E5 and N0-N1 strategy, the audit reports aggregate raw capacity and exact maximum article-disjoint matching.

For each E/N pair it evaluates both fixed templates:

- G40 = 20 event + 12 near + 8 control;
- G48 = 24 event + 16 near + 8 control.

Lane priority is EVENT -> NEAR -> CONTROL so quotas do not overlap. Exact MILP feasibility enforces:

- article disjointness;
- already-reviewed article exclusion;
- cross-feed pairs;
- <=24h temporal ceiling;
- max feed share <=20% of endpoints;
- max source-pair share <=10% of pairs;
- max category share <=50% of endpoints;
- exact quotas and no spillover.

Feasibility witnesses remain memory-only.

## Decision

`GRAPH_CONTEXT_SIGNAL_GATE=PASS` requires at least one E/N pair for which:

- the event strategy passes the Gold event-signal floor;
- the near strategy passes the Gold near-miss floor;
- G40 or G48 is feasible.

PASS recommends `STORY_02_A2D2C_P4_D2A_R3_GRAPH_RETRIEVAL_CONTRACT_FREEZE_AND_SELECTION`.

FAIL recommends `STORY_02_A2D2C_P4_D2A_R3_RICHER_EVENT_SIGNAL_DESIGN`.

R2 itself never chooses or freezes the final retrieval configuration.

## Gold identity containment

The coverage receipt records aggregate counts and deterministic hashes of identity sets, without exposing identities. Gold article identities must be a subset of Home-200. A subsequent selection drawn from a fresh corpus independently verified disjoint from Home-200 is therefore also disjoint from Gold, without reading Gold labels during selection.
