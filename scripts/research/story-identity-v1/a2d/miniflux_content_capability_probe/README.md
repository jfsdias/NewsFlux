# Miniflux stored-content capability probe

Research-only, read-only and label-blind. This stage measures stored Miniflux
content for the frozen 500-entry corpus; it does not fetch publisher pages,
request `/fetch-content`, modify Miniflux, or retain article text. A separate
PM authorization is required for any future run. The already-consumed PM
authentication preflight is included in the request accounting; the runner does
not make another authentication request.

The runner validates immutable corpus and contract hashes, checks the private
credential-file permissions, allows only GET on an entry-by-ID endpoint, and
uses at most one retry per retryable entry. A 401 or 403 stops the run. Each
response is processed in memory into an exact, metadata-only schema. The
independent validator verifies identity membership, schema, status accounting,
length aggregates and fixed-denominator coverage. Private files are atomically
written, made read-only and checked again; they are never committed.

## D2E2 execution

The authorized run returned 500 HTTP 200 responses, with no retries. Identity
matched for 499 records; one mismatch was excluded. Of the 500 original
entries, 486 met the frozen usable-content definition (coverage 0.972). Nine
were empty and four contained structural material only. Fourteen usable
entries had normalized content equal to the normalized title; this is a
separate diagnostic and was not silently removed from the prescribed gate.

The aggregate and manifest can be rederived from frozen metadata without a
second network run. The stored source was observed at retrieval time, and no
claim is made that its contents match the original publication snapshot.
Publisher access and the next enrichment stage remain subject to separate PM
authorization.

Run synthetic tests without network access:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/research/story-identity-v1/a2d/miniflux_content_capability_probe -p 'test_*.py'
```
