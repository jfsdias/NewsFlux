# Validated human label ingestion

The ingestion verifies the frozen blank session, mapping, P3 pack membership and the exact completed human CSV hash before processing. It requires the complete ordered annotation-ID sequence, unchanged reviewer-visible fields and an allowed manual decision on every row. It routes 80 DEV and 48 BLIND records without publishing individual records or any combined or BLIND class distribution.

DEV transitions to `ANNOTATED_OPEN_FOR_DEVELOPMENT` after validated ingestion; this stage performs no DEV analysis. BLIND transitions to `ANNOTATED_SEALED`. Its decisions must not be opened for threshold tuning, provider selection, feature changes, search redesign, error-driven development or qualitative inspection before a separately authorized final-evaluation gate.

Separate private replay destinations must contain byte-identical DEV, sealed BLIND and manifest artifacts. The final ingestion destination is new and read-only. Only aggregate validation and artifact hashes may appear in tracked reports; labels, examples and private mapping records remain outside Git.
