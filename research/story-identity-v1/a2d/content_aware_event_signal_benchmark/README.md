# D2F benchmark contract

This package contains a design-only preregistration and an independent
validator. It contains no benchmark runner, real pair scores, human labels,
article content or model inference. See `BENCHMARK_DESIGN.md` for evidence
boundaries and unresolved PM decisions. BLIND remains sealed.

Run the synthetic contract tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/research/story-identity-v1/a2d/content_aware_event_signal_benchmark -p 'test_*.py'
```
