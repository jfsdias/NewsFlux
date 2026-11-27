# D2E3 Miniflux content capture

This research-only stage captures the frozen 500-article corpus from Miniflux
stored entries. It does not modify Miniflux, access publisher pages, open human
labels, run a model or change product runtime. A new network run requires a
separate authorization; this tooling is not a scheduler.

The initial attempt stopped after one authentication and one entry request. Its
response bytes and status were not retained, so its precise cause cannot be
recovered. It remains noncanonical and is recorded in the replacement receipt
and manifest. The replacement restarted the full corpus and consumed one
authentication request and 500 entry requests with no retries. Cumulative D2E3
accounting is two authentication requests and 501 entry requests.

Exact safe final response bytes are frozen to a private content-addressed vault
before JSON parsing or derivation. An independent validator and an offline
source-payload replay verify the private sidecar, hashes, identity membership
and content classification. See `ERROR_STAGES.md` for the failure-stage map.
The secret scan precedes all payload writes; diagnostic output contains no
exception messages or article text.

The replacement recorded 499 identity matches and one mismatch. It found 486
usable entries out of the original 500, nine empty entries and four
structural-only entries. Fourteen usable entries had content equal to the title;
this remains a separate diagnostic under the frozen contract. Identity status,
content status and title-equivalence counts did not change from D2E2.

Source bytes and normalized text are private-only. The captured bytes can be
replayed offline, but future Miniflux source-byte stability is unknown. The
source represents stored entry state at retrieval, not the original publication
snapshot. Publisher fetching remains on hold. Coverage only supports recommending
benchmark design; it does not authorize running a benchmark or a model.

Focused synthetic tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/research/story-identity-v1/a2d/miniflux_content_enrichment_capture -p 'test_*.py'
```
