# Fresh positive-evidence pool

Research-only preregistration and offline tooling. The pool is prospectively
label-blind and private; it is not a review pack or a claim that any pair is
SAME_EVENT. `POSITIVE_EVIDENCE_DESIGN.md` and
`positive-evidence-contract-v1.json` freeze the sources, four lanes, ranking,
exclusions and capacity semantics before real pair selection.

The offline runner rejects human-label and D2E3 content paths and disables
network connections. It requires Python 3.14.7 and NetworkX 3.4.2, verifies the
pinned input hashes and a clean committed preregistration, then creates an
atomic private attempt with deterministic replay and independent validation.
A future rerun, review budget and labeling require separate authorization.

Synthetic tests can be run with NetworkX 3.4.2 on the Python import path:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/research/story-identity-v1/a2d/fresh_positive_evidence -p 'test_*.py'
```
