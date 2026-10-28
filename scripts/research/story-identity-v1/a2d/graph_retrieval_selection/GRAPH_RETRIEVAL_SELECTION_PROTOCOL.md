# STORY-02 graph retrieval DEV selection protocol

This research-only selection freezes E0/N1/G40 with exact 20/12/8 quotas. It does not freeze a production policy. The pinned R2A receipt establishes Gold identity containment in Home-200; this stage checks the full fresh corpus is disjoint from Home-200 and the selected articles belong to that corpus. Gold isolation therefore follows transitively, without opening Gold labels.

Before candidate ordering, the canonical contract is written and frozen. The existing R2 lane classifier applies event, near, then residual control priority. Within each lane, ordering is SHA-256 of `STORY02-R3|<contract hash>|<lane>|<pair key>`; graph metrics are not used as further selection objectives. Lexicographic feasibility locking uses a binary MILP feasibility oracle, fixes each decision in priority order, and stops on an undecided solver result. Two independent runs must yield identical pack and sidecar bytes.

A separate validator checks lane membership, exact quotas, pair identities, article disjointness, fresh membership, prior-pack and Home-200 exclusions, cross-feed and actual timestamp limits, and diversity caps. Stored temporal differences are rounded to four decimal hours by the original feature pipeline; the 24-hour bound is independently checked against unrounded corpus timestamps.

Private artifacts are atomically written, hashed, made read-only and rehashed. The frozen CSV is unannotated and is not a reviewer interface. The human-label firewall blocks the named Gold, DEV, BLIND, and review-session label files. Only pre-label DEV/BLIND pack identities are used for exclusion. No inference, network access, human review, product change, deploy, or canary occurs.
