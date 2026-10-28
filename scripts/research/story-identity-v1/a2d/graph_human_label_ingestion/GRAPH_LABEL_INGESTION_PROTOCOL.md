# Graph DEV human-label ingestion protocol

This stage validates and freezes an already completed human review. It performs no scientific analysis, strategy comparison, new selection, model inference, or product change.

The exact completed CSV, the frozen neutral session and the label-free R3 pack are hash-verified. The completed CSV must use the exact schema and review ID sequence, valid nonblank decisions and the pinned integrity counts. Every reviewer metadata field must equal the frozen neutral CSV. Blanking only the decisions and using the original CSV serialization must reproduce the neutral CSV hash.

The frozen private map must be a bijection between review IDs, source IDs and pair identities. Each source ID and pair is cross-checked against the R3 pack. Output is sorted by source ID and contains only the review ID, source ID, pair identity and human decision. The R3 sidecar is not read. Gold, old DEV and sealed BLIND human-label files are blocked by a local access guard.

The raw completed input, canonical JSONL, aggregate audit and manifest are privately written using temporary files, fsync, atomic rename, readback, read-only permissions and rehash. Derivation is replayed in memory and frozen outputs are independently re-opened and checked against the pinned inputs. All inputs are rehashed after ingestion. The earlier session manifest remains a historical pre-review snapshot.
