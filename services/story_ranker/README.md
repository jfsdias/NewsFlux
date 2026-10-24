# NewsFlux local story candidate ranker

This sidecar implements only the validated candidate-ranking stage of STORY01:

`Qwen3-Embedding-0.6B Top-250 -> Qwen3-Reranker-0.6B -> ranked pairs`

It does **not** decide whether two entries are the same story, cluster entries, merge entries, or persist story state.

## Frozen model contract

- embedding model: `qwen3-embedding:0.6b`
- embedding digest: `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d`
- embedding dimension: 1024
- pair scope: cross-feed only
- pair window: 168 hours
- embedding candidate K: 250
- reranker: `Qwen/Qwen3-Reranker-0.6B`
- reranker revision: `e61197ed45024b0ed8a2d74b80b4d909f1255473`
- scoring: mean of raw A->B and B->A logits

The service refuses an Ollama embedding model whose digest does not match the frozen R3C baseline. The reranker checkpoint is downloaded at image build and runtime model loading defaults to offline mode.

## Runtime

The service listens on port `8787` and exposes:

- `GET /healthz`
- `POST /v1/rank`

`POST /v1/rank` accepts at most 200 entries containing only:

- `id`
- `feed_id`
- `published_at`
- `title`

The response contains only ranked entry pairs and model provenance. It deliberately contains no `SAME`, cluster, merge, or story-identity decision.

`OLLAMA_BASE_URL` must point to the approved Ollama runtime. No database or persistent volume is used by this service.

The Caddy frontend route `/api/story-candidates/v1/rank` proxies to `{$STORY_RANKER_UPSTREAM}`; the default upstream is `story-ranker:8787`. If the sidecar is unavailable, Home fails open and keeps its existing projection.

## Research boundary

R3C validated this component as a candidate ranker, not an auto-merge rule. Corpus-wide recall was not measured. Any later clustering or identity-decision stage requires a separate authorization and PR.
