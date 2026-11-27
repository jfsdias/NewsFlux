# Story 02 prospective feature pipeline V2

This forward-looking research contract does not establish the historical model lineage or the historical text preprocessing contract. Those historical provenance gates remain failed.

- Model: `qwen3-embedding:0.6b`; manifest digest `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d`; model blob SHA256 `06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439`.
- Ollama reference: `0.40.11`. The runner verifies the installed manifest and blob before and after inference; it does not pull models.
- Text: title only, Python `title.strip()`, reject empty. Internal whitespace, Unicode, case, markup and newlines are not otherwise transformed.
- Request: `/api/embed`, ordered title list, `truncate=false`, dimension 1024.
- Store raw returned vectors without unit normalization. Pair score is cosine with explicit L2 norms. Reject zero-norm, non-finite and incorrectly sized vectors.
- Canonical serialization is Python `json.dumps` with `ensure_ascii=False`, `sort_keys=True`, `separators=(',', ':')`, `allow_nan=False`, encoded as UTF-8; array order and returned float values are preserved.
- Three synthetic runs, including a fresh process, must produce identical canonical vector hashes before the historical functional bridge is run.
- The runner takes its already-configured SSH destination from `STORY_V2_SSH_TARGET`; private output must remain within the designated research root.

The full historical bridge produced exact vector values and equal pair scores. This supports transfer of the specified fixed thresholds under the PM decision; it does not prove historical lineage. No fresh corpus inference, pack selection or human-label access is part of this phase.

Synthetic canary receipt SHA256: `540eb9f303262370e1ace5ab702dbbb99ec62b631d3089b66cf1263679a43d68`.
