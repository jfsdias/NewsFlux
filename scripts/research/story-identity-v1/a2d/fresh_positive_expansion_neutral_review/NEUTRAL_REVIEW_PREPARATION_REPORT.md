# D2F8 neutral review preparation

The frozen D2F7 sample is unchanged: 11 pairs and 22 articles. A cryptographically seeded permutation and per-pair side orientation were frozen privately, with review IDs R001–R011 assigned after permutation. The nonce and identity map remain private. The reviewer surface contains only neutral titles, source names and published times; all initial decisions are blank.

The local standalone interface is PREPARED_UNOPENED. It was not opened, no browser session or review server was started, and no completed export or human decision exists. Review uses the existing SAME_EVENT, RELATED_TOPIC, DIFFERENT_EVENT and UNCERTAIN taxonomy. Only SAME_EVENT is merge-positive; title-only insufficiency calls for UNCERTAIN. No historical human labels, BLIND labels, article content, model or benchmark were used.

The source identity, neutral metadata joins, seeded replay, independent presentation validation, exact CSV schema, private mapping, initial zero decisions, artifact hashes and modes passed. The reviewer guide instructs independent judgments without web searches. Human review remains subject to PM approval after this research-only PR.

REVIEW_METADATA_SHA256=4c78298281826a7a034340d3b817d110f4885ba2aee75e8777777a5e83037e9b

REVIEW_IDENTITY_MAP_SHA256=aa13aab2b5d9acf1cccb19cb1cd40f99b91ac19590f68b33f52c6d50029c077d

The first frozen attempt is preserved and noncanonical because later formatting changed its renderer template and broke byte replay. No review had started. The renderer-provenance correction pins the committed template and renderer source bytes and retains the previously frozen randomization. The new attempt preserves the sample, review mapping and metadata fingerprints and passes byte-identical HTML replay under the pinned renderer.
