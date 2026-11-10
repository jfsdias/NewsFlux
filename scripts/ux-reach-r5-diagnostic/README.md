# UX-REACH-R5 fine-pointer diagnosis

This Draft PR contains test-only diagnostics for the intermittent pen-drag assertion in UX-REACH-01 scenario 11. It does not modify application sources, the UX-REACH assertion, or the functional PR #225.

PR #220 was reviewed first. Its exact-source checkout and artifact collection pattern is reused, while its observer is not: it covers a coarse-pointer article hit target, pins main at `70f0d0c3…`, and does not observe the fine-pointer desktop pen gesture or pointer capture.

The workflow checks out exact main and the live PR #225 merge candidate, verifies both identities and the PR head before browser work, then runs the unchanged scenario 20 times per tree without retries. It runs a separate instrumented copy 20 times per tree. The instrumented copy sends the same mouse and CDP pen inputs and preserves the original `x > afterMouseDrag.x + 24` assertion. Its observers record event delivery, hit targets, pointer-capture events, geometry, animation state, browser errors, and synthetic mutation counts. Browser observations are stored locally as workflow artifacts; no telemetry is sent to an application or external analytics service.

A successful workflow means only that both source trees were tested and diagnostic evidence was collected. It does not convert a failed UX observation into a passing product gate. The JSON artifact preserves individual pass/fail results and the logs preserve the complete Playwright report for each bounded run.

The workflow uses the synthetic Miniflux fixture and does not use production credentials, Miniflux, WallHop, LiteLLM, or deployment permissions.
